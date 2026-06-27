# cc-cockpit TODO

> Structured for the `/todo` skill (`Manage-Todo.ps1`): sections `## X.`, tasks `- [ ] X1.`, sub-tasks `  - [ ] X1.1.`. Everything in this blockquote/status prose is ignored by the parser — only the lettered sections below are tracked. Edit tasks via the script, not by hand.

## Status — end of 2026-06-25 (big GUI build day)

Everything below is on branch **`feat/gui-mode`** (NOT merged to master; the main cockpit runs it via `npm start` on http://127.0.0.1:4477). **120/120 tests pass.** Each feature browser-verified. Standing guideline: the assistant restarts the cockpit after any change (no asking), even with live sessions.

Built on `feat/gui-mode` this session (specs/plans under `docs/superpowers/{specs,plans}/2026-06-25-*`):
- **B2 transcript-persistence bug — FIXED** (`scrubParentClaudeEnv` strips inherited `CLAUDE_CODE_CHILD_SESSION` etc.) — unblocked everything (sessions now persist transcripts, discovery, temp auto-naming).
- **GUI mode (B1)** — per-session **GUI (default) ⇄ Terminal** switch (`Ctrl+\``); normalized conversation by tailing the transcript (correlated via `--session-id`); compose box with reliable submit on freshly-opened sessions.
- **GUI-native permissions (parity model)** — Claude always prompts natively in the PTY; the cockpit mirrors it to a GUI panel (Allow / Allow-don't-ask / Deny → keystrokes `1`/`2`/`3`); non-blocking `PreToolUse` notify hook; Terminal mode is the fallback.
- **Interaction controls** — live permission-mode chip + click-to-cycle (Shift+Tab); interrupt (Esc) Stop button.
- **Session info panels** — usage chip (ctx / 5h+reset / 7d), foldable **topics** panel, native **todos** panel (TodoWrite + Task*), Open local-docs / TODO buttons.
- **Modals** — New-session 3-column layout, 90%×90% size, "Older than 7 days" toggle (Resume lazily fetches `window=all`).
- **GUI error center** — toggleable client-error list (timestamp + message) + stack-trace modal.

## A. Priorities (in order)

- [x] A1. [TOP PRIORITY] Image paste / upload into a session — let the user attach images directly instead of save-file-then-copy-path.
  - [x] A1.1. In GUI mode, paste from clipboard (and ideally drag-and-drop a file) onto the compose box attaches an image.
  - [x] A1.2. The cockpit saves the image into `<project-cwd>/uploaded-images/` (create the dir if missing) — clipboard images get persisted as a side win.
  - [x] A1.3. The saved file's path is inserted into the prompt at the exact spot where the user pasted/dropped it (Claude receives the path reference).
  - [x] A1.4. Filename: use the clipboard's name if present; else auto-generate `YYYY-MM-DD HH-MM-SS.<ext>` (ext from blob mime; default `.png`).
  - [x] A1.5. Impl sketch: client `paste`/`drop` listeners on the compose textarea → read image blob → POST `upload-image {id, name?, dataBase64}` → server resolves the session cwd, writes `uploaded-images/<name>`, returns the absolute path → client inserts the path at the cursor. Handle multiple images.
  - [x] A1.6. Flow: brainstorm (quick — it's concrete) → spec → plan → build → verify (paste a real screenshot, confirm file saved + path inserted + Claude can read it).
  - [x] A1.7. [deferred follow-up] Drag a token to reposition it within the editor: dragstart carries the token identity; on drop inside the editor place the caret at the drop point and move the token node there. Token already ships draggable=true, so additive.
- [ ] A2. [priority] Native GUI handling of interactive prompts, NOW delivered via the Agent SDK control channel from G1 (not terminal-parse + keystrokes). The SDK channel standardizes tool-permissions (canUseTool) + AskUserQuestion + plan-accept. Spec docs/superpowers/specs/2026-06-25-gui-interactivity-design.md (revisit under G1). Feature list below; non-tool TUI prompts (MCP-trust, trust-folder, elicitation) surfacing through the SDK is TBD by the G1.2 spike.
  - [ ] A2.1. MCP-server-trust prompt - NOT a tool call; whether stream-json surfaces it is uncertain (resolve in G1.2 spike). Feature preserved: show panel + answer.
  - [ ] A2.2. AskUserQuestion - covered by the control channel (questions+options exposed); render selectable options + return structured answer (delivered by G1.5).
  - [ ] A2.3. Plan-accept (ExitPlanMode) - covered by the control channel as a tool/permission. Approve / Approve+auto / Keep-planning (delivered by G1.5).
  - [ ] A2.4. MCP elicitation - Notification elicitation_dialog + Elicitation hook (structured); render form/answer. Confirm surfacing under stream-json in G1.2.
  - [ ] A2.5. Trust-folder prompt - NOT a tool call; surfacing under stream-json uncertain (resolve in G1.2). Feature preserved.
- [ ] A3. "Never used" warning in the session modals.
  - [ ] A3.1. In the New-session and Resume modals, show a warning banner / warning icon with a tooltip when there are projects/sessions that were never used.
  - [ ] A3.2. Tooltip on click → list the projects containing those never-used sessions.
  - [ ] A3.3. Clarify when picking up: "never used" = projects with no recorded activity (New-session already has a "Never used" band); confirm the exact meaning for the Resume modal before building.
- [ ] A4. [priority - LAST in this list] Slash-commands / skills + in-TUI pickers in the GUI - do after A2-A3; reshaped by G1 (some pickers become SDK control ops: /model -> setModel, interrupt via abortController, permission-mode via setPermissionMode).
  - [ ] A4.1. Slash-command + skill autocomplete in the compose box — typing `/` shows a filterable menu; selecting inserts it; plus an `@` file-mention picker. GUI-native autocomplete (the compose owns the input).
  - [ ] A4.2. In-TUI pickers surfaced/answerable from the GUI — `/model`, `/diff`, `/context`, interactive `/usage`, `/compact`, rewind (Esc-Esc), `/theme`, `/config`, `/effort` slider, extended-thinking/fast toggles. Detect + render (or surface + answer) rather than requiring a drop to Terminal mode.

## B. Quick wins

- [ ] B1. [quick] Compose box: Ctrl+Enter = newline too — both Shift+Enter and Ctrl+Enter insert a newline; only a plain Enter submits (today Ctrl+Enter submits). Impl (`public/gui.js` textarea `keydown`): submit only on Enter with no shift and no ctrl; for Ctrl+Enter `preventDefault()` and insert `\n` at the caret manually (Shift+Enter keeps its native newline).
- [ ] B2. [quick] Topics panel: move the `resolved` checkbox left — it should sit right after "Topics (X)" (left-aligned), not floated far right. Impl (`public/styles.css`): drop `float: right;` from `.show-resolved`; keep the small/muted styling.
- [ ] B3. [quick] Topics/Todos panels expand as a floating overlay (don't shrink the chat) — the expanded panel should float on top of the chat/session area instead of taking layout space; same for the Todos panel. Impl (`public/gui.js` + `styles.css`): keep the panel header in flow but render the expanded body as a `position: absolute` overlay within `#gui-pane` so `.gui-log` is never resized.
- [ ] B4. [quick] Tool-card status as checkboxes — success → green checked box (✓); failed / non-success → red crossed box (✗); pending → neutral. Replace the current colored status dot. Impl (`public/gui.js` tool card + `styles.css`): update the `.tool-dot`/glyph.
- [ ] B5. New-session auto-naming "<project-name> new <N>" — a session created in a project is auto-named "<project> new <N>", incrementing per newly-created session. N counts ONLY existing sessions already matching the "<project> new <#>" format (NOT other differently-named active sessions). Impl: on create-in-project compute N = (max existing "<proj> new <k>") + 1 and set it as the display name (customName-style), server-side in `registry.create` / a naming helper. Skip for temp sessions.
- [ ] B6. [quick] Smaller conversation font + tighter line spacing — Claude-side text and user bubbles are too tall (one line ≈ 2 lines of height). Impl (`public/styles.css`): reduce `.gui-asst` / `.gui-user` `font-size`, set `line-height` ≈ 1.3, trim bubble padding.
- [ ] B7. [quick] local-docs/TODO "not found" → error list only (not the bottom-left corner) — route the missing-file error to the error center only, not the sidebar `#error` element. Impl (`public/app.js`): use `errorCenter.add(...)` only; stop setting `errorEl.textContent` for these (consider moving ALL errors to the error center per B8 and retiring the bottom-left `#error`).
- [ ] B8. [quick] Error-list icon → top-left next to the "cc-cockpit" title + blink — move the error-center toggle next to the "cc-cockpit" header (top-left) and make it blink while there are unread errors. Impl (`index.html` + `styles.css`): relocate `#error-toggle` into the sidebar `<h1>` row; add a pulse/blink animation while error count > 0.

## C. Verify (not build tasks)

- [ ] C1. [VERIFY post-G1] Usage chip (ctx / 5h / 7d) stays fresh from the SDK message stream (rate_limit_event + result.usage), NOT footer-scrape - the footer-scrape source is removed by G1.5.

## D. Eventually

- [ ] D1. Review + merge `feat/gui-mode` → master — do a full live end-to-end pass over the GUI features first. The old A1–A5 master-feature review items fold in here: A1 hook-driven session state; A2 Discovery & Projects; A3 passive preview + focus fix; A4 temp sessions + rename; A5 navigation + resume scope + uniform modals (all merged to master earlier; the GUI work sits on top).
- [ ] D2. Deferred interactivity long-tail (still fine via Terminal mode): compose command history (↑/↓, Ctrl+R); external editor (Ctrl+G); voice; vim mode; background tasks (Ctrl+B).
- [ ] D3. SKIPPED — shell mode (`!`): not needed now that we have the GUI.

## E. Backlog / deferred

- [ ] E1. Persist session rename across server restart/resume (in-memory only today; needs a {ccSessionId: name} map).
- [ ] E2. Temporary-session cleanup / auto-deletion (temp sessions persist indefinitely).
- [ ] E3. Electron conversion milestone (browser-first now; Electron as a final additive milestone — its own brainstorm/spec/plan/branch).
- [ ] E4. Harden Windows path matching: make isTemp / isUnderProjectsRoot / lastActivityByPath / projectOf case-insensitive on win32.

## F. Done (history)

- [x] F1. B2 no-transcript bug — root cause = inherited `CLAUDE_CODE_CHILD_SESSION=1`; fix = `scrubParentClaudeEnv` in `server/pty.js`. (Full writeup: `docs/superpowers/worklog/2026-06-25-b2-no-transcript-rootcause.md`.)

## G. Re-architecture: PTY-driving -> Claude Agent SDK [TOP PRIORITY]
- [ ] G1. [TOP PRIORITY] Re-found cockpit interaction on the Claude Agent SDK (query() driving the user's own subscription-auth claude; verified 2026-06-27); PTY demoted to fallback. Foundational - reshapes A2 (interactive prompts -> SDK control channel), A4 (pickers -> SDK control ops), C1 (usage chip re-sourced from the SDK message stream). Process: brainstorm -> design spec (docs/) -> plan -> phased build.
  - [x] G1.1. Archive the current PTY implementation to a separate branch before mutating code (so we can return / pull from it).
  - [x] G1.2. Control-protocol spike: confirm the Agent SDK query() shapes for send-prompt (streamInput), answer-permission (canUseTool / setPermissionMode), and interrupt (abortController); confirm subscription auth through the SDK (five_hour subscription rate-limit already verified).
  - [ ] G1.3. Brainstorm -> write the design spec (docs/superpowers/specs/) + implementation plan; decide what the GUI renders when PTY is no longer primary, and the terminal-fallback behavior.
  - [ ] G1.4. Swap session spawn from node-pty to the Agent SDK query() (it spawns and owns the child claude over stdio); preserve subscription-only auth and enforce scrubParentClaudeEnv via the SDK env option (which REPLACES, not merges, the child env); keep PTY spawn as the fallback path.
  - [ ] G1.5. Structured output + input + control channel via the SDK: the live SDK message stream (reuse server/normalize.js mapping) replaces the transcript-tail poll; structured input (streamInput) replaces the text+CR typing + 3x bare-Enter nudge timer; SDK control answers tool-permissions / AskUserQuestion / plan-accept (canUseTool, replaces 1/2/3 keystrokes) and powers A2; re-source mode + usage chips from the SDK stream (rate_limit_event + result.usage, replaces readFooter screen-scrape + modeparse/usageparse); interrupt (abortController) + permission-mode (setPermissionMode) + model via SDK control (replaces escape-code keystrokes); retire RingBuffer raw-byte replay + peek terminal replay behind the fallback.
