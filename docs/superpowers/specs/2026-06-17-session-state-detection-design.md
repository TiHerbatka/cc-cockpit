# cc-cockpit — Session State Detection (Design)

Date: 2026-06-17
Status: Approved scope, pending spec review

## Problem & goal

The sidebar shows `working` / `idle` / `exited` dots, but it cannot tell when a session is **waiting for the user** — e.g. an interactive question, a permission prompt, or simply the end of a turn. Today an interactive prompt looks identical to a quiet/idle session, so a session that needs you is indistinguishable at a glance. The goal: detect and visibly distinguish a **needs-you** state, and organize the sidebar so attention-needing sessions surface on their own.

This was a deliberate v0 non-goal ("precise needs-input detection") because a byte-stream observer cannot reliably tell "waiting for input" from "idle". The research below removes that blocker by using Claude Code's hooks as a precise signal, so the feature is now in scope.

## Key research findings (grounding)

Confirmed against official Claude Code docs (CLI v2.1.179 on this machine):

- **Raw byte heuristics are unreliable** (spinner glyphs, prompt characters, silence) — undocumented and version-fragile. Not used as the primary signal.
- **Hooks are the precise, documented signal.** `Notification` fires with matchers `idle_prompt` ("done and waiting for your next prompt") and `permission_prompt` ("needs you to approve a tool"). `idle_prompt` is **not** an idle timer — it fires immediately on turn completion.
- **In interactive use, "finished a turn" and "waiting for input" are the same instant.** There is no separate "done but not awaiting input" state. So `needs-you` vs `idle` is defined by *user acknowledgement*, not by Claude.
- **Hooks can be injected per-invocation without touching global settings:** `claude --settings <file>`. Hooks **merge across scopes** (they accumulate, not override), so the user's existing `~/.claude` `Notification` hooks (`notify-bump.ps1` toasts) keep firing alongside a cockpit hook.
- **Hook processes inherit the spawned process environment**, so the cockpit can set `CC_COCKPIT_SESSION`/`CC_COCKPIT_PORT` when spawning `claude` and the hook reports state back keyed to that exact session. (`CLAUDE_SESSION_ID` is also exposed but the cockpit's own id is simpler to correlate.)
- **Inline-OSC markers were rejected:** every allowlisted OSC (0/1/2/9/99/777/BEL) actually renders (toast or title-bar change), so an inline marker would have to be flawlessly stripped from the stream — fragile. A loopback HTTP side-channel avoids this entirely.

## The states

- **working** — output flowed recently.
- **needs-you** — a Notification hook (`idle_prompt` or `permission_prompt`, collapsed into one "needs you") fired and the session has **not** been acknowledged (focused) since it started waiting.
- **idle** — waiting but acknowledged (you've focused it since it started waiting), or simply quiet with nothing pending (the existing ~2s fallback).
- **exited** — the `claude` process ended (overrides all other states).

`permission_prompt` and `idle_prompt` are intentionally collapsed into a single `needs-you` (per the chosen "Working / Needs-you / Idle" model).

### Acknowledgement model (how needs-you differs from idle)

Because Claude signals "waiting" the instant a turn ends, the distinction is the user's attention:

- A hook firing for a session you are **not** looking at → **needs-you** (unacknowledged).
- Focusing a needs-you session → **idle** (acknowledged — you've seen it).
- A hook firing for the session you are **already** focused on → goes straight to **idle** (you're watching it finish).
- New output (you replied / it resumed) → **working**, and acknowledgement resets so the next turn-end produces a fresh **needs-you**.

State is derived from two per-session flags plus the registry's notion of the focused session:

- `waiting` (bool) — a Notification hook has fired and not yet been superseded by new output.
- `acknowledged` (bool) — the session has been focused since `waiting` became true.
- `focusedId` (registry-level) — the session most recently attached/focused (single-page v0).

Derivation (in priority order): `exited` → if `waiting && !acknowledged` then `needs-you` → if `waiting && acknowledged` then `idle` → if recent output then `working` → else `idle`.

Transitions:
- hook fires for `id` → `waiting=true`, `acknowledged = (id === focusedId)`.
- `attach(id)` → `focusedId = id`; if that session is `waiting`, set `acknowledged=true`.
- any output for `id` → `waiting=false`, `acknowledged=false`, status `working`, `lastOut=now`.
- `tickStatus` → flips `working`→`idle` after the quiet threshold, but never overrides `needs-you`.
- pty exit → `exited`.

## Architecture

A loopback HTTP **side-channel**. The cockpit spawns each `claude` with injected hooks (`--settings`) and per-session env. When Claude wants the user, the hook POSTs to the cockpit's existing server; the registry updates state and broadcasts it; the browser regroups the sidebar.

```
claude session (PTY)                         cockpit server (127.0.0.1)
  Notification[idle_prompt|permission_prompt]
        │ runs hook (inherits CC_COCKPIT_SESSION/PORT env)
        ▼
  cockpit-hook.ps1 ──POST /hook {id}──▶ app.js ─▶ registry.signalWaiting(id)
                                                    │ status → needs-you
                                                    ▼ emit 'sessions'
                                            WebSocket broadcast ─▶ browser
                                                                    regroup sidebar
```

## Components & responsibilities

- **SessionRegistry (`server/sessions.js`)** — owns the new `waiting`/`acknowledged` flags and `focusedId`. New methods: `signalWaiting(id)` (hook arrived) and `acknowledge(id)` (focus). `appendOutput` clears the flags. `_public` status now resolves to `working|needs-you|idle|exited`. `tickStatus` must not override `needs-you`.
- **App server (`server/app.js`)** — new `POST /hook` route (loopback only; the server already binds `127.0.0.1`) that parses a small JSON body `{ id }` and calls `registry.signalWaiting(id)`, ignoring unknown ids. The existing `attach` WS handler also calls `registry.acknowledge(id)` (and records `focusedId`).
- **PTY adapter (`server/pty.js`) + entry (`server/index.js`)** — `spawnClaude` gains options to add `--settings <cockpitSettingsPath>` to the args and `CC_COCKPIT_SESSION`/`CC_COCKPIT_PORT` to the env. `registry.create` passes the new session id into `spawnPty(cwd, id)`; `index.js` wires the settings path and port into the spawn closure.
- **Bundled hooks** — `hooks/cockpit-settings.generated.json` (written at server startup by `server/hooks.js`, gitignored) defines a `Notification` hook (matcher `idle_prompt|permission_prompt`) running `hooks/cockpit-hook.ps1` by absolute path. `cockpit-hook.ps1` reads `CC_COCKPIT_SESSION`/`CC_COCKPIT_PORT` and POSTs `{ id }` to `http://127.0.0.1:<port>/hook`. Async/fire-and-forget. **Windows/PowerShell only for v0.**
- **Sidebar (`public/app.js` + `styles.css`)** — render four dot styles (needs-you = prominent amber, optionally pulsing) and **group the list by state**: Needs-you → Working → Idle → Exited, preserving insertion order within each group. Clicking a row still sends `attach` (which now also acknowledges server-side).

## Data flow (the interactive-question case)

1. `claude` shows an interactive question / permission prompt → Claude Code fires `Notification` (`idle_prompt` or `permission_prompt`).
2. The cockpit hook runs, inheriting `CC_COCKPIT_SESSION`/`CC_COCKPIT_PORT`, and POSTs `{ id }` to `/hook`.
3. `registry.signalWaiting(id)` sets `waiting=true`; since the session is unfocused, status becomes `needs-you`; `sessions` is broadcast.
4. The browser regroups: the session moves to the **Needs-you** group with an amber dot.
5. You click it → `attach` → `acknowledge(id)` → status `idle` → it moves to the **Idle** group.
6. You answer; `claude` resumes → output → status `working` → **Working** group; acknowledgement resets for the next turn.

## Error handling & graceful degradation

- **Cockpit down / POST fails** — the hook is async and fire-and-forget; a failed POST is silently ignored and never blocks `claude` (the user's `notify-bump.ps1` toast still fires independently).
- **Unknown/stale session id at `/hook`** — ignored (no session row created or mutated).
- **Hooks/`--settings` unavailable** (older CLI, injection fails) — the feature degrades to today's `working`/`idle` behavior; `needs-you` simply never triggers. Not fatal.
- **Malformed `/hook` body** — rejected with a 4xx; no state change.
- **Security** — `/hook` is reachable only on `127.0.0.1` (same bind as the rest of the server) and accepts only a minimal JSON body. No new network exposure.

## Tech & dependencies

- No new npm dependencies. Reuses the existing `http`/`ws` server and `node-pty`.
- Requires Claude Code CLI ≥ v2.1.141 for `--settings` hook injection and the `Notification` matchers (this machine: v2.1.179).
- The bundled hook is PowerShell; v0 targets Windows only.

## File layout (changes)

```
cc-cockpit/
  server/
    sessions.js     # + waiting/acknowledged/focusedId, signalWaiting(), acknowledge()
    app.js          # + POST /hook route; attach -> acknowledge()
    pty.js          # + --settings arg + CC_COCKPIT_* env
    index.js        # wire settings path + port into spawn
  hooks/
    cockpit-settings.generated.json   # NEW — Notification hook definition, generated at startup (gitignored), injected via --settings
    cockpit-hook.ps1        # NEW — POSTs {id} to the cockpit on idle/permission prompt
  public/
    app.js          # 4-state dots + group-by-state sidebar
    styles.css      # needs-you dot styling
  test/
    sessions.test.js  # + state-derivation + acknowledgement tests
    app.test.js       # + POST /hook integration test
    pty.test.js       # + spawn-args/env composition test
```

## Acceptance criteria (definition of done)

1. A session showing an interactive question or permission prompt, while unfocused, appears as **needs-you** (amber dot) and is grouped under **Needs-you** in the sidebar.
2. Focusing a needs-you session moves it to **idle** (acknowledged); it does not bounce back to needs-you until a new turn ends.
3. When the session resumes producing output, it shows **working**.
4. A hook firing for the session you are already focused on yields **idle**, not needs-you.
5. The sidebar is grouped Needs-you → Working → Idle → Exited, insertion order preserved within each group.
6. The user's existing `notify-bump.ps1` toast still fires (hooks merged, not replaced); the cockpit signal works alongside it.
7. With the cockpit server stopped, spawning and using `claude` is unaffected (hook POST failures are silent).
8. Unit + integration tests cover state derivation, acknowledgement, `POST /hook`, and spawn-arg/env composition; the browser behavior is verified live (real interactive prompt → Needs-you → Idle on focus).

## Non-goals (v0 of this feature)

- Distinguishing `permission_prompt` from `idle_prompt` visually (collapsed into one `needs-you`).
- Non-Windows hook scripts (PowerShell only for now).
- Browser tab-title count, sound chimes, favicon badges, desktop notifications from the cockpit (OS toasts already come from the user's existing hook).
- Per-client focus tracking for multiple simultaneous browser tabs (single-page assumption).
- Idle/needs-you detection without hooks (no byte-stream heuristic fallback).
