# Rich interactive frontend — GUI mode (B1 / TPC3) — design

**Status:** spec (not yet built). Supersedes the "Approach B" sketch in the 2026-06-24 handoff. Depends on the B2 fix (cockpit sessions now persist a transcript) being live.

## Problem

The cockpit today shows each session as a raw `xterm` mirror of Claude Code's full-screen TUI. That is faithful but terse: to know what a session is *doing* you must read the terminal; todo progress, the in-flight tool, and "what is it waiting on" are buried in a scrolling TUI. The whole reason to build our own GUI is to present a richer, normalized, interactive view than the terminal can — while never trapping the user if that richer view misbehaves.

Now that cockpit-spawned sessions persist a transcript JSONL (B2 fix), we can drive a normalized GUI by **tailing that transcript** plus the existing turn-boundary hooks. This spec defines a per-session **GUI mode** (the new default) with a raw-**Terminal mode** fallback, a one-click **MODE switch** between them, a **compose box** that types into the session, and **GUI-native permission Allow/Deny** handled through a blocking `PreToolUse` hook.

## Key findings that shape this design (from research)

- **Tailing the transcript JSONL is the only real-time structured source** for an *interactive* (TUI) session. `--output-format stream-json` is print-mode (`-p`) only. So the GUI reads `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` as it grows.
- The transcript is richly structured: `user` / `assistant` messages, `thinking`, `tool_use` + `tool_result` (correlated by `id`), todos (TodoWrite / Task* tool calls), subagents (Agent/Task tool calls), `ai-title`, and `system` `turn_duration` metadata. Everything the pane needs — both the conversation and the live status — is derivable from it.
- **Permission prompts have no documented keystroke model** — injecting `"1\r"` to answer the TUI prompt is fragile and version-dependent, so we do **not** build on keystroke injection.
- **`PreToolUse` hooks are a robust programmatic permission gate.** The hook receives the full `tool_name` + `tool_input` on stdin and returns `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny"|"ask"|"defer","permissionDecisionReason":"…"}}`. This is how the GUI answers permissions the right way: a blocking hook calls back to the cockpit, the GUI shows Allow/Deny, and the decision returns through the hook so the TUI prompt is bypassed. Caveat (documented): hook decisions do **not** bypass a user's own `deny`/`ask` permission *rules* — those still apply.

## Design

### Modes (per session)

- **GUI mode** — the new rich pane (default for every session).
- **Terminal mode** — the existing raw `xterm` view (today's behavior), unchanged.
- A prominent **MODE switch** flips a single session between the two. It lives in a per-session **header bar** at the top of the main pane (always visible in both modes) as a segmented control: `[ GUI | Terminal ]`, right-aligned; the session label + state badge sit on the left. Keyboard shortcut `Ctrl+\`` toggles the focused session's mode.
- The mode is chosen on the client and synced to the **server** via `set-mode` (the server must know it, because the permission policy below gates only in GUI mode). It is **not persisted** across server restart / page reload in v1. New sessions open in GUI mode.
- **The switch is the safety valve.** If anything about the GUI or the permission flow misbehaves, the user flips to Terminal mode and the raw PTY takes over with zero interception (see "defer in Terminal mode" below) — work continues uninterrupted. This is a hard requirement.

### GUI pane layout (top → bottom)

1. **Header bar** — session label, state badge (`working`/`idle`/`your-move`/`needs-you`/`exited`), MODE switch. (Shown in Terminal mode too, so switching back is one click.)
2. **Live status strip** — the at-a-glance readout: current activity (the latest `tool_use` with no matching `tool_result`, e.g. "Running Bash: `npm test`", "Reading app.js", "Subagent: …"), todo progress (`n/m done`, from the latest todo state), and turn-elapsed when working.
3. **Conversation log** (scrollable main area) — normalized render:
   - **Human prompts** (a `user` record with plain typed text; `origin.kind = human`, `promptSource = typed`) as prompt bubbles.
   - **Assistant text** rendered as Markdown; **thinking** blocks collapsed/expandable.
   - **Tool calls** as compact cards (icon + tool name + key arg) pairing `tool_use` ↔ `tool_result` by `id`, with status (pending / ok / error) and expand-to-see full input + output.
   - **Todos** as a live checklist; **subagents** as a card (description + agent type).
   - A `user` record that carries `tool_result` content renders as the result of its matching tool card, **not** as a human prompt.
4. **Compose box** (bottom) — a textarea + Send. **Enter** sends the text followed by `\r` to the PTY via the existing `input` WS message (so it drives the underlying `claude`); **Shift+Enter** inserts a newline.
5. **Permission panel** — appears inline when a permission request is pending for this session: shows the tool name + input and **Allow once** / **Allow & don't ask again (this tool)** / **Deny (+ optional reason)**.

### Data flow & architecture

**Deterministic transcript correlation.** The cockpit generates a UUID per spawned session and passes `--session-id <uuid>` (resumed sessions already have an id via `--resume <id>`). The transcript file is then `<uuid>.jsonl`; the server locates it by scanning `<claudeDir>/projects/*/<uuid>.jsonl` (cheap — exact basename known) and stores the path in the registry. No cwd-encoding guesswork.

**Server-side tailer** (one per GUI-watched session): waits for the file to appear (a brand-new session writes it after its first turn), then reads appended bytes from a tracked byte offset on change (`fs.watch` with a polling fallback), buffering a partial trailing line until its newline. New complete lines are parsed and handed to the normalizer.

**Normalizer** (pure): converts raw JSONL records into a normalized event/model the client renders, and maintains derived live status (current in-flight tool, todo progress). Pure and dependency-free so it is unit-tested against real sample records — this is the core unit and is kept isolated.

**Permission subsystem (blocking `PreToolUse` hook → cockpit IPC).**
- A new `PreToolUse` hook is added to the injected cockpit settings (synchronous, **not** `async`, long `timeout` so the user has time to decide). The hook script reads stdin (`tool_name`, `tool_input`, `session_id`), POSTs them to the cockpit (correlated via `CC_COCKPIT_SESSION`), **blocks** on the HTTP response, and emits the returned decision JSON to stdout.
- Cockpit `POST /permission`: resolves the session, then applies this policy:
  - Session **not** in GUI mode, or **no client watching**, or **timeout** → respond **`defer`** (Claude's normal flow / TUI prompt runs; zero behavior change in Terminal mode or with the browser closed).
  - Session matches a **read-only auto-allow default** (Read/Glob/Grep/etc.) or a **session-scoped allow rule** (from a prior "don't ask again") → respond **`allow`** immediately (no GUI prompt).
  - Otherwise → broadcast `permission-request` to clients, **hold the response open**, and resolve it when the user clicks in the GUI (a `permission-decision` WS message): **`allow`** / **`allow` + remember tool / `deny`** (+ reason).
- **Over-gating note.** Because the hook fires for every tool and can't replicate Claude's permission engine, GUI mode routes *all* not-pre-allowed tools through the GUI. The read-only auto-allow default + "don't ask again" tame this so it converges to roughly the prompts you'd see natively. This is the accepted cost of GUI-native permissions and is documented for the user. The documented rule-precedence caveat (user `deny`/`ask` rules still apply) is surfaced as-is.

### WebSocket / HTTP protocol additions

- client→server (WS): `gui-attach {id}` (start tailing; reply with backlog), `gui-detach {id}`, `set-mode {id, mode}`, `permission-decision {id, requestId, decision, reason?, remember?}`. (Compose uses the existing `input`.)
- server→client (WS): `gui-snapshot {id, model}` (normalized backlog on attach), `gui-event {id, event}` (incremental), `permission-request {id, requestId, tool, input}`, `permission-resolved {id, requestId}`.
- HTTP: `POST /permission` (from the hook; blocks for the decision).

## Components / changes

- `server/pty.js` — `buildSpawn` adds `--session-id <uuid>` (uuid generated in the registry on create).
- `server/transcript.js` *(new)* — locate transcript by session id; incremental tailer (offset + partial-line buffering; watch/poll).
- `server/normalize.js` *(new)* — pure JSONL-record → normalized model + derived live status.
- `server/permissions.js` *(new)* — pending-request registry, decision policy (defer conditions, auto-allow defaults, session allowlist), timeout handling.
- `server/hooks.js` — add the blocking `PreToolUse` hook entry (synchronous, long timeout).
- `hooks/cockpit-pretooluse.ps1` *(new)* — read stdin, POST `/permission`, block, emit the decision.
- `server/sessions.js` — store `sessionId` (uuid), `transcriptPath`, and `mode`; manage tailer lifecycle on gui-attach/detach; expose them on the public session.
- `server/app.js` — `POST /permission`; new WS messages + broadcasts above.
- `public/gui.js` *(new)* — GUI pane: header bar + MODE switch, status strip, conversation renderer, compose box, permission panel; consumes `gui-snapshot`/`gui-event`/`permission-request`. (Split out so `app.js` doesn't balloon.)
- `public/app.js` — mode state per session; mount GUI pane vs the existing terminal; wire the switch.
- `public/styles.css` — pane, header/switch, status strip, conversation, tool cards, compose box, permission panel.

## Testing

- **Unit (`normalize`)** — table-driven against real sample records: human prompt vs tool_result-bearing user record; assistant text/thinking/tool_use; tool_use↔tool_result pairing + status; todo progress; subagent card; in-flight-tool derivation.
- **Unit (`transcript`)** — offset tracking, partial-trailing-line buffering, file-appears-later, via an injected fake file/fs.
- **Unit (`permissions`)** — defer when not GUI/no watcher/timeout; auto-allow read-only; session allowlist match; hold-then-resolve on decision.
- **Integration (`app.test.js`)** — `gui-attach` → snapshot; appended line → `gui-event`; `POST /permission` → `permission-request` broadcast → `permission-decision` → hook response (fake transcript file + fake hook POST; following the existing fake-PTY harness).
- **Browser** — GUI mode renders a live session; compose box drives it; MODE switch flips to the raw terminal and back; a real permission request shows the panel and Allow/Deny works; Terminal mode / closed browser falls back to the native TUI prompt.

## Acceptance criteria

1. A new session opens in **GUI mode** showing the normalized conversation + live status, updating live as the session works.
2. The **MODE switch** flips that session to the raw terminal and back, one click, always reachable; the terminal continues the same live session.
3. Typing in the **compose box** and pressing Enter sends the prompt to the session (visible in both modes).
4. When the session requests a tool that isn't auto-allowed, a **permission panel** appears in the GUI; **Allow** lets it proceed and **Deny** blocks it, without using the terminal.
5. In **Terminal mode**, with **no browser open**, or on **timeout**, permissions fall back to Claude's normal TUI prompt (the hook returns `defer`) — nothing hangs.
6. All existing tests still pass; the new units are covered.

## Non-goals (deliberately out of scope for v1)

- **Select-text-to-reference-into-the-next-prompt** and **path/link tooltips** — the next spec.
- Driving other interactive TUI states from the GUI (slash-command autocomplete, model picker, `/resume` list, arrow-key menus) — use Terminal mode for these.
- Persisting mode or the session allowlist across server restart / page reload.
- Re-implementing Claude Code's full permission engine (rules, modes) — we gate via the hook with a simple allow/deny + remember model and `defer` to native otherwise.
- Editing/replaying history; rich diff rendering inside tool cards beyond basic input/output.

## Amendment 2026-06-25 — permissions reworked to a parity model

The original permission design (above) used a **blocking `PreToolUse` hook that bypassed** Claude's native prompt — returning allow/deny when the session was "GUI-active", deferring to the native TUI otherwise. Live review found this **breaks GUI/Terminal parity**: when it bypassed, the terminal showed nothing (looked auto-approved); when it deferred, the prompt appeared only in the terminal and the GUI missed it. The split was also timing/focus-dependent and inconsistent.

**New model (parity): Claude ALWAYS prompts natively in the PTY**, and the GUI mirrors + answers it — the GUI is a functional wrapper, never hiding or replacing terminal content.

- The `PreToolUse` hook is now **non-blocking notify-only**: it POSTs the pending tool's `{sessionId, toolName, toolInput}` to `POST /tool-pending` and emits nothing, so Claude's native permission flow runs (prompt shows in the terminal). The cockpit remembers the latest tool per session. No per-tool latency, no over-gating, no blocking.
- When the native prompt fires, the existing `Notification:permission_prompt` hook (`/hook` `needs-you`) makes the cockpit broadcast `permission-request {id, tool, input}` (tool details from the last `/tool-pending`). The GUI shows a panel; the session also flags `needs-you` in the sidebar.
- The GUI's **Allow once / Allow, don't ask again / Deny** buttons send `permission-answer {id, key}` where `key` ∈ `1|2|3` — the cockpit writes that keystroke to the PTY, selecting Claude's native option (validated empirically: a bare number key selects+confirms; `1`=Yes, `2`=Yes+always-allow, `3`=No; Esc cancels). The terminal reflects the same answer (parity).
- **Robust fallback**: because the prompt is always native in the PTY, you can always answer in Terminal mode — so even if a future Claude version changes the prompt keys, you're never stuck; the GUI buttons are a convenience layer over a robust base.

Removed in this rework: the blocking `POST /permission` endpoint, the `permissions.js` broker/classify, per-session allowlist, `guiWatchers` gating, and the `permission-decision` message. The panel auto-hides on answer (and when the focused session leaves `needs-you`). Also added: a terminal re-`attach` (buffer refresh) when switching into Terminal mode, since a full-screen TUI can show a stale frame after being overlaid by the GUI pane.
