# GUI interactivity — surfacing terminal mechanisms in the GUI — design

**Status:** spec (not yet built). Extends the GUI-mode work (`2026-06-25-rich-frontend-gui-mode-design.md`). Builds on the parity permission model already shipped.

## Problem

The GUI renders from the transcript JSONL, but Claude Code's interactive TUI has **~50 live mechanisms** (permission prompts, the AskUserQuestion selection UI, the permission-mode footer + Shift+Tab cycle, plan-accept, slash/`@` menus, pickers, Esc-interrupt, …) and **almost none are written to the transcript** — they're live TUI state. So today the GUI can't show the current mode, can't answer an interactive question, etc.; the user must drop to the terminal. We want the GUI to convey and drive these mechanisms natively.

## Approach (chosen: per-mechanism native widgets)

For each mechanism: **detect it → render a native GUI widget → answer it by sending the matching keystroke(s) to the PTY.** Claude's native TUI element still renders in the terminal underneath, so the GUI and Terminal stay in **parity** (same model as the shipped permission flow). Anything not (yet) covered falls back to **Terminal mode** — always one click away, so the user is never stuck.

Build order is **most-used → least-used** (below). Each mechanism is an independent, shippable increment.

### Detection toolbox (what's available)

- **`PreToolUse` hook** (non-blocking notify, already wired to `POST /tool-pending`) delivers `tool_name` + `tool_input` before a tool runs. This is the structured source for **tool-driven** interactions: `AskUserQuestion` (carries the questions+options), `ExitPlanMode` (carries the plan), MCP tools.
- **`Notification` hook** (`permission_prompt`) → already used for permission prompts and `needs-you`.
- **PTY footer parse** — the permission **mode** is shown only in the footer (no transcript record until a turn): `⏵⏵ accept edits on …`, `⏸ plan mode on …`, and **no banner** = normal/default. Parsed from the session's terminal output.
- **Keystroke answering** (validated empirically): permission/plan prompts take a bare number key (`1`/`2`/`3`, `Esc` cancels); mode cycle is `\x1b[Z` (Shift+Tab); interrupt is `\x1b` (Esc). Each new widget's keys are validated against a real prompt before shipping.

### Already shipped

- Compose input (incl. multiline via Shift+Enter; reliable submit on fresh sessions).
- **Permission prompts** — native panel mirroring the prompt + Allow/Allow-remember/Deny → keystroke; native TUI parity; Terminal fallback.

## Roadmap (phases, most-used → least-used)

Each phase is a self-contained increment with its own plan + tests + browser verification.

### Phase 1 — Permission-mode indicator + Shift+Tab cycle button  *(VERY FREQUENT; explicit user ask)*
- **Show** the current mode in the GUI header/status (normal / accept-edits / plan), so the user needn't drop to the terminal to see it.
- **Cycle** it with a one-click button that sends `\x1b[Z` to the PTY (same as Shift+Tab).
- **Detection/source:** parse the mode from the session's PTY output footer. The cockpit tracks `claudeMode` per session (scanning output for the banner; absence ⇒ `normal`) and includes it in the session broadcast; the GUI renders it + the cycle button. Validated: `\x1b[Z` cycles; footer formats known.

### Phase 2 — AskUserQuestion widget  *(FREQUENT; reported gap)*
- **Detect** via `PreToolUse` `tool_name === 'AskUserQuestion'`; `tool_input` carries `questions[]` (each `{question, header, options:[{label, description}], multiSelect}`).
- **Render** the question(s) + options as buttons in the GUI; clicking sends the keystroke(s) to drive the native selection list.
- **Risk/validation:** the native AskUserQuestion list is multi-question / possibly multi-select with an "Other" free-text path — driving it via keystrokes is more involved than 1/2/3. The exact key sequence (number keys vs arrow+Enter, multi-select toggling, submit) **must be validated empirically** against a real AskUserQuestion prompt at the start of this phase; if reliable single-question single-select is the only robustly drivable case, ship that and fall back to Terminal mode for multi-select.

### Phase 3 — Interrupt button (Esc)  *(COMMON; trivial)*
- A **Stop/Interrupt** control in the GUI that sends `\x1b` (Esc) to the PTY to halt a running turn. Visible/active while the session is `working`.

### Phase 4 — Plan-accept widget (ExitPlanMode)  *(FREQUENT when planning)*
- **Detect** via `PreToolUse` `tool_name === 'ExitPlanMode'` (`tool_input.plan`). Render the plan + **Approve & stay / Approve & auto-accept / Keep planning** buttons → keystrokes `1`/`2`/`3` (Esc rejects). Validate keys against a real plan prompt.

### Phase 5 — Slash-command + `@` file autocomplete in the compose box  *(VERY FREQUENT typing aids)*
- In the GUI compose box, typing `/` shows a filterable slash-command menu; typing `@` shows a file-path picker. Selecting inserts into the compose text (the prompt is then sent normally). This is GUI-native autocomplete (not driving the TUI menu), since compose input is GUI-owned.

### Phase 6 — MCP elicitation forms  *(OCCASIONAL)*
- **Detect** via the elicitation notification / hook; render the requested form fields; submit back. Lower priority; scope confirmed when reached.

### Phase 7 — Long tail → Terminal mode  *(deferred; not replicated)*
- `/model`, `/diff`, `/context`, `/usage`, `/theme`, rewind (Esc Esc), Ctrl+R history, vim mode, voice, `/resume` (cockpit already has Resume), etc. — low-frequency, read-only, or duplicating existing cockpit features. The GUI surfaces a clear **"open Terminal for this"** affordance rather than a bespoke widget. When the GUI detects an interactive state it doesn't handle (e.g., an unrecognized prompt), it nudges the user to Terminal mode.

## Components / changes (per phase, summary)

- `server/sessions.js` / `server/app.js` — Phase 1: track + broadcast `claudeMode` (footer parse on output). Phases 2/4/6: extend the `/tool-pending` + broadcast path so tool-driven interactions surface their details to the GUI (reuse the existing `permission-request`-style broadcast, generalized to an "interaction" message carrying `kind` + payload).
- `server/modeparse.js` *(new, Phase 1)* — pure: given a PTY output/footer string, return the current mode (`normal|acceptEdits|plan|...`). Unit-tested against the captured footer formats.
- `public/gui.js` / `public/app.js` / `public/styles.css` — the widgets (mode chip + cycle button, AskUserQuestion panel, interrupt button, plan-accept panel, compose autocomplete) and routing of the interaction messages → keystrokes.
- `hooks/cockpit-pretooluse.ps1` — unchanged (already notifies tool details); the cockpit just needs to surface AskUserQuestion/ExitPlanMode/MCP details to the GUI (not only remember them for permissions).

## Testing

- **Unit:** `modeparse` (footer → mode, incl. normal/absent); the server interaction-broadcast logic (a `PreToolUse` for AskUserQuestion/ExitPlanMode → an interaction broadcast carrying the payload); keystroke routing (`permission-answer`/new `interaction-answer` → PTY write).
- **Empirical keystroke validation** per phase (mode ✓ done; AskUserQuestion, plan-accept, interrupt validated against real prompts before shipping each).
- **Browser-verified** widgets (render + click → correct keystroke), per the project norm.

## Non-goals

- Replicating read-only pickers / the long tail (Phase 7 → Terminal mode).
- Full slash/`@` autocomplete parity with the TUI (Phase 5 is GUI-native compose assist, not driving the TUI menu).
- Perfect multi-select AskUserQuestion driving if the keystrokes prove unreliable (fall back to Terminal mode for that case).
