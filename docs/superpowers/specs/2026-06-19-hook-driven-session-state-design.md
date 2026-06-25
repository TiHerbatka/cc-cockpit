# cc-cockpit — Hook-Driven Session State (Design)

Date: 2026-06-19
Status: Approved scope, pending spec review

Supersedes the working/idle parts of `2026-06-17-session-state-detection-design.md`. The `needs-you` acknowledgement model and the loopback `/hook` side-channel from that spec carry forward; this spec replaces how `working` and `idle` are determined and narrows what triggers `needs-you`.

## Problem & goal

The shipped session-state feature added a precise hook-driven `needs-you`, but left `working` vs `idle` on the original MVP heuristic: a session is `working` while output flowed in the last ~2s and flips to `idle` after 2s of silence (`tickStatus` + `IDLE_AFTER_MS`). Any session whose terminal emits output in bursts more than ~2s apart therefore visibly oscillates `working → idle → working` — observed live as a focused session "slipping between IDLE and WORKING" while Claude streams a reply, then settling on `idle`.

The root cause is that `idle` is *guessed from silence*. The goal is to eliminate the guess: drive `working`/`idle` from Claude Code's authoritative turn-boundary hooks (the same injection mechanism already used for `needs-you`), so a turn holds a solid `working` from start to finish with no mid-turn flicker, and `idle` means "Claude's turn has actually ended."

## Key research findings (grounding)

Confirmed against current official Claude Code docs (`code.claude.com/docs/en/hooks.md`, `hooks-guide.md`):

- **`UserPromptSubmit`** fires once at the start of a turn, before Claude processes the prompt. No matcher. Can block the prompt and its stdout is injected as context — so the cockpit hook must run `async: true` and write nothing to stdout.
- **`Stop`** fires once at every turn end (main agent only — not `SubagentStop`), immediately and reliably. No matcher. Carries no reason, so it cannot distinguish "finished, nothing needed" from "ended with a question for you" — both look identical.
- **`Notification` / `idle_prompt`** is documented as "Claude is done and waiting for your next prompt" with no timer — it fires immediately at turn end, essentially the notification-system twin of `Stop`. It is **not** a "you've been away a while" nudge. (This corrects an assumption in the v1 spec; the v1 spec mapped it to `needs-you`.)
- **`Notification` / `permission_prompt`** fires when Claude is blocked awaiting approval of a tool — the one precise "must act now" signal.
- **No hook marks "resumed after a permission approval"** (no `UserPromptSubmit`, since no prompt was submitted) and **no hook marks "ended with a question."** These are accepted blind spots, not bugs.
- Hooks **inherit the spawned process environment** (so `CC_COCKPIT_SESSION`/`CC_COCKPIT_PORT` are visible) and **merge across scopes** (so the user's `~/.claude` hooks, e.g. `notify-bump.ps1`, keep firing). Both already relied upon and unchanged.

## The states

Four states, unchanged in name: **working**, **needs-you**, **idle**, **exited**. What changes is how they are determined.

- **working** — a turn is in progress: `UserPromptSubmit` fired and `Stop`/`idle_prompt` has not yet ended it. Holds solid for the entire turn regardless of output cadence.
- **needs-you** — Claude is blocked awaiting a tool-permission decision (`permission_prompt`) on a session you have **not** focused since it began waiting.
- **idle** — the calm default: a finished turn (`Stop` or `idle_prompt`), a permission wait you have already acknowledged (focused), or a freshly spawned session with nothing pending.
- **exited** — the `claude` process ended (overrides all other states).

`needs-you` is now triggered **only** by `permission_prompt`. `idle_prompt` maps to `idle` (it is a turn-end signal, not an attention nudge).

### State model and derivation

Per-session flags: `working`, `waiting` (a permission prompt is pending), `acknowledged` (focused since `waiting` became true), `exited`. Plus the registry-level `focusedId` (most recently attached session; single-page v0).

Derivation, in priority order:

```
exited                       → 'exited'
waiting → acknowledged ? 'idle' : 'needs-you'
working                      → 'working'
else                         → 'idle'
```

Transitions (each from an authoritative hook, or focus/exit):

- `markWorking(id)` (`UserPromptSubmit`) → `working=true`, `waiting=false`, `acknowledged=false`.
- `markIdle(id)` (`Stop`, `Notification:idle_prompt`) → `working=false`, `waiting=false`. (→ `idle`)
- `signalWaiting(id)` (`Notification:permission_prompt`) → `working=false`, `waiting=true`, `acknowledged = (id === focusedId)`.
- `acknowledge(id)` (attach/focus) → `focusedId = id`; if that session is `waiting && !acknowledged`, set `acknowledged=true`. (→ `idle`)
- `markExited(id)` (pty exit) → `exited=true`.

All transitions are idempotent at the status level: the registry only broadcasts `sessions` when the derived status actually changes, so redundant hooks (e.g. `Stop` then `idle_prompt`) cause no churn.

### What is removed

Output timing is deleted as a state signal — this is what caused the flicker:

- `IDLE_AFTER_MS`, the `active` and `lastOut` flags, and `tickStatus()` in `server/sessions.js`.
- The `setInterval(() => registry.tickStatus(), 1000)` in `server/app.js`.
- `appendOutput` no longer mutates status; it reverts to pure buffer-append + `output` broadcast.

`output` is intentionally **not** a `working` trigger: trailing output after `Stop` (the prompt redraw) would otherwise flip a just-ended turn back to `working` and strand it there.

## Architecture

Unchanged in shape: a loopback HTTP side-channel. The cockpit spawns each `claude` with injected hooks (`--settings`) and per-session env; hooks POST state to the cockpit's existing `127.0.0.1` server; the registry updates and broadcasts; the browser regroups the sidebar. What changes is the number/shape of injected hooks and the `/hook` payload.

### Hook injection

The generated `--settings` file defines **four** hook entries (was one). `UserPromptSubmit` and `Stop` take no matcher; `Notification` splits into two matcher entries. Each entry runs the same bundled script with a literal target-state argument:

| Event | matcher | script argument | → state |
|---|---|---|---|
| `UserPromptSubmit` | (none) | `-State working` | working |
| `Stop` | (none) | `-State idle` | idle |
| `Notification` | `idle_prompt` | `-State idle` | idle |
| `Notification` | `permission_prompt` | `-State needs-you` | needs-you |

All entries are `type: command`, `powershell.exe ... -File <absolute path> -State <state>`, `async: true`, with a short timeout — fire-and-forget so they never block Claude. The file contains only a `hooks` block so it merges with the user's settings.

### `cockpit-hook.ps1`

Adds a `-State` parameter. POSTs `{ id: $env:CC_COCKPIT_SESSION, state: $State }` to `http://127.0.0.1:$env:CC_COCKPIT_PORT/hook`. Silent on stdout (required for the `UserPromptSubmit` case), `try/catch` swallowing all errors, short `-TimeoutSec` — the cockpit being down must never error or delay the `claude` session.

### `POST /hook`

Accepts JSON `{ id: string, state: 'working'|'idle'|'needs-you' }` (was `{ id }`). Validates `id` is a string and `state` is one of the three; dispatches to `markWorking`/`markIdle`/`signalWaiting` respectively; ignores unknown ids/states. Same loopback bind and port (no new exposure), same body bound, `204` on success / `400` on bad JSON.

## Accepted limitations (consequences of the chosen model)

- A turn that **ends with Claude asking you a question** shows **idle**, not `needs-you` — Claude Code exposes no signal distinguishing it from a plain finish.
- After you **approve a permission**, the session shows `idle`/`needs-you` (not `working`) until the turn's `Stop`, because no hook marks the resume. It self-corrects at turn end. (Accepted to avoid re-introducing output-as-signal.)
- A **missed hook POST** leaves a stale state until the next turn boundary corrects it; there is no timer backstop, by design (keeping the model purely hook-driven).
- **Initial state on spawn** is `working`; the first `Stop`/`idle_prompt` settles it to `idle`.

## Testing

- **Unit (`test/sessions.test.js`):** the derivation table and each transition — `markWorking`→working, `markIdle`→idle, `markWorking`→`markIdle`→`markWorking` (no intermediate idle), `signalWaiting` on an unfocused session→needs-you, `signalWaiting` on the focused session→idle, `acknowledge` flips needs-you→idle and is sticky, signals ignored after exit. Remove the obsolete `tickStatus`/`active`/`lastOut` tests.
- **Route (`test/app.test.js`):** `POST /hook` for each of the three states drives the matching broadcast; bad/unknown state is ignored; `attach` acknowledges a needs-you session (→idle).
- **Hooks (`test/hooks.test.js`):** the settings define exactly the four entries with correct matchers and `-State` arguments, an absolute script path, and only a `hooks` block.
- **Live:** spawn a session; confirm it holds solid `working` through a long multi-burst turn (no flicker), shows `idle` at turn end, shows amber `needs-you` only on a permission prompt for an unfocused session, focusing it acknowledges to idle, and the user's `notify-bump.ps1` toast still fires.

## Out of scope

A self-built "been idle a while" timer to escalate lingering idle sessions to `needs-you` (considered and declined in favor of the calmest precise model); detecting "ended with a question"; a missed-hook timer backstop; any change to the sidebar grouping or dot styling (the four-group rendering from v1 is reused as-is).

---

## Amendment 2026-06-24: the `your-move` state

Live use surfaced that the "calm" model under-serves the cockpit's purpose: a background (unfocused) session that finished its turn — including one that ended by asking the user a question in prose — showed `idle`, so the user had no signal it was waiting for them. Claude Code still exposes no way to distinguish "ended with a question" from "just finished" (both are a single turn-end signal), so rather than guess, the cockpit now surfaces **every** unfocused turn-end as a distinct, calmer attention state.

### New state

- **your-move** — an unfocused session has reached turn-end (`Stop`/`idle_prompt`) and you have not focused it since. Distinct from `needs-you`: `needs-you` (amber, pulsing) means *blocked on a permission decision*; `your-move` (blue, steady) means *the turn finished and it's your turn* (could be a question, could be a completed task — indistinguishable). Focusing the session clears it to `idle`.

Five states now: **working, needs-you, your-move, idle, exited**.

### Model & derivation (supersedes the v2 table)

Per-session flags add `ended` (turn ended, pending your-move). Derivation, in priority order:

```
exited                       → 'exited'
waiting → acknowledged ? 'idle' : 'needs-you'
ended   → acknowledged ? 'idle' : 'your-move'
working                      → 'working'
else                         → 'idle'
```

Transitions:

- `markWorking` (`UserPromptSubmit`): `working=true, waiting=false, ended=false, acknowledged=false`.
- `markIdle` (`Stop` / `idle_prompt`): `working=false, waiting=false, ended=true, acknowledged=(id===focusedId)`.
- `signalWaiting` (`permission_prompt`): `working=false, waiting=true, ended=false, acknowledged=(id===focusedId)`.
- `acknowledge` (attach/focus): `focusedId=id`; if `(waiting || ended) && !acknowledged` → `acknowledged=true`.
- `markExited` (pty exit): `exited=true`.

`waiting` and `ended` are mutually exclusive in time (each transition clears the other), so `needs-you` and `your-move` never compete.

### No hook/protocol change

The hook wire protocol is unchanged: turn-end still POSTs `state: 'idle'`. `your-move` vs `idle` is *derived* from focus in the registry; it is never sent over `/hook`. So `server/hooks.js` and `cockpit-hook.ps1` are untouched.

### UI

A fifth sidebar group **"Your move"** between *Needs you* and *Working*, with a steady blue dot (no pulse — calmer than the amber `needs-you` pulse).

### Supersedes

This replaces the v2 "accepted limitation" that a turn ending in a question shows `idle`, and the "out of scope" exclusion of escalating finished background sessions. The remaining limitation: the cockpit still cannot tell whether a finished turn truly needs you or merely completed — both show `your-move` when unfocused.
