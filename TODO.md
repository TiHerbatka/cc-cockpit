# cc-cockpit TODO

## Status — end of 2026-06-25 (big GUI build day)

Everything below is on branch **`feat/gui-mode`** (NOT merged to master; the main cockpit runs it via `npm start` on http://127.0.0.1:4477). **120/120 tests pass.** Each feature browser-verified. Standing guideline: the assistant restarts the cockpit after any change (no asking), even with live sessions.

Built on `feat/gui-mode` this session (specs/plans under `docs/superpowers/{specs,plans}/2026-06-25-*`):
- **B2 transcript-persistence bug — FIXED** (`scrubParentClaudeEnv` strips inherited `CLAUDE_CODE_CHILD_SESSION` etc.) — unblocked everything (sessions now persist transcripts, discovery, temp auto-naming).
- **GUI mode (B1)** — per-session **GUI (default) ⇄ Terminal** switch (`Ctrl+\``); normalized conversation by tailing the transcript (correlated via `--session-id`); compose box with reliable submit on freshly-opened sessions.
- **GUI-native permissions (parity model)** — Claude always prompts natively in the PTY; the cockpit mirrors it to a GUI panel (Allow / Allow-don't-ask / Deny → keystrokes `1`/`2`/`3`); non-blocking `PreToolUse` notify hook; Terminal mode is the fallback. (Reworked away from the earlier blocking-bypass after the parity requirement.)
- **Interaction controls** — live permission-mode chip + click-to-cycle (Shift+Tab); interrupt (Esc) Stop button.
- **Session info panels** — usage chip (ctx / 5h+reset / 7d), foldable **topics** panel (summaries, show-resolved, copy-code), native **todos** panel (TodoWrite + Task*), Open local-docs / TODO buttons.
- **Modals** — New-session 3-column layout, 90%×90% size, "Older than 7 days" toggle (Resume lazily fetches `window=all`).
- **GUI error center** — toggleable client-error list (timestamp + message) + stack-trace modal.

## Tomorrow — priorities (in order)

### T1. [TOP PRIORITY] Image paste / upload into a session
Let the user attach images directly instead of save-file-then-copy-path. Requirements:
- In GUI mode, **paste from clipboard** (and ideally **drag-and-drop a file**) onto the compose box attaches an image.
- The cockpit **saves the image into `<project-cwd>/uploaded-images/`** (create the dir if missing) — a nice side win (clipboard images get persisted).
- The saved file's path is **inserted into the prompt at the exact spot** where the user pasted/dropped it (so Claude receives the path reference, matching the flow Claude already understands).
- **Filename:** use the clipboard's name if present; otherwise auto-generate `YYYY-MM-DD HH-MM-SS.<ext>` (ext from the blob mime; default `.png`).
- Implementation sketch: client `paste`/`drop` listeners on the compose textarea → read image blob → POST to a new server endpoint (`upload-image {id, name?, dataBase64}`) → server resolves the session cwd, writes `uploaded-images/<name>`, returns the absolute path → client inserts the path at the cursor. Handle multiple images. (Native terminal Ctrl+V is separate — our value-add is the GUI compose + the uploaded-images save.)
- Flow: brainstorm (quick — it's concrete) → spec → plan → build → verify (paste a real screenshot, confirm file saved + path inserted + Claude can read it).

### T2. [priority] Finish the priority interactive mechanisms in the GUI
Build native GUI handling for these (the rest of the interactivity roadmap is deferred):
- **MCP-server-trust prompt** ("New MCP server found") — fires NO hook → detect via **terminal-parse** of the prompt signature; show panel + answer keys (validate empirically).
- **AskUserQuestion** — detectable via `PreToolUse` (tool_input has questions+options); render selectable options → keystrokes (validate the multi-question/multi-select driving).
- **Plan-accept (ExitPlanMode)** — `PreToolUse`; Approve / Approve+auto / Keep-planning (`1`/`2`/`3`).
- **MCP elicitation** — `Notification` type `elicitation_dialog` + the `Elicitation` hook (structured); render form/answer.
- **Trust-folder prompt** (brand-new folder) — likely no hook → terminal-parse.
- Approach (from research): hooks where they fire, **terminal-parse for the un-hooked ones**; extend the existing permission-panel pattern. Spec: `docs/superpowers/specs/2026-06-25-gui-interactivity-design.md` (Phases 2/4/6 + MCP/trust additions). NOTE the research finding: there is **no single standardized channel** to detect ALL prompts; the Agent SDK's `canUseTool` standardizes tool-permissions + AskUserQuestion but only by driving Claude via the SDK instead of a PTY — a big future pivot, NOT planned.

### T3. "Never used" warning in the session modals
- In the New-session and Resume modals, show a **warning banner / warning icon with a tooltip** when there are projects/sessions that were never used.
- **Tooltip on click → list the projects** containing those never-used sessions.
- Clarify when picking up: "never used" = projects with no recorded activity (New-session already has a "Never used" band); confirm the exact meaning for the Resume modal before building.

### T4. [priority — LAST in this list] Slash-commands / skills + in-TUI pickers in the GUI
- **Slash-command + skill autocomplete in the compose box** — typing `/` shows a filterable menu of commands/skills; selecting inserts it (and `@` file-mention picker alongside it). GUI-native autocomplete (the compose owns the input).
- **In-TUI pickers surfaced/answerable from the GUI** — `/model`, `/diff`, `/context`, interactive `/usage`, `/compact`, rewind (Esc-Esc), `/theme`, `/config`, `/effort` slider, extended-thinking/fast toggles. Detect + render (or surface + answer) rather than requiring a drop to Terminal mode.
- Do this after T1–T3.

### T5. [quick] Compose box: Ctrl+Enter = newline too
- In the GUI compose textarea, **both Shift+Enter and Ctrl+Enter insert a newline** (only a plain Enter submits). Today Shift+Enter already newlines, but Ctrl+Enter currently submits.
- Impl note (`public/gui.js`, the textarea `keydown` handler): submit only on Enter with **no** shift **and no** ctrl; for Ctrl+Enter, since a textarea inserts no newline by default on Ctrl+Enter, `preventDefault()` and insert `\n` at the caret manually (Shift+Enter keeps its native newline).

### T6. [quick] Topics panel: move the "resolved" checkbox left
- The **`resolved` filter checkbox** in the Topics panel header should sit **right after "Topics (X)"** (left-aligned), not floated to the far right — more convenient.
- Impl note (`public/styles.css`): drop `float: right;` from `.show-resolved` (the header is a normal inline/flex row, so it'll follow the count). Keep the small/muted styling.

### T7. [quick] Topics/Todos panels expand as a floating overlay (don't shrink the chat)
- Expanding the Topics section currently **shrinks the conversation area**, which breaks the user's visual tracking of where they were and hurts readability. The expanded panel should **float on top of** the chat/session area (overlay) instead of taking layout space. Apply the same to the Todos panel.
- Impl note (`public/gui.js` + `styles.css`): keep the panel header in flow but render the expanded body as a `position: absolute` overlay within `#gui-pane` (or a popover dropping from the header) so `.gui-log` is never resized.

### T8. [quick] Tool-card status as checkboxes
- In the conversation tool cards: **success → green checked box (☑ / ✓)**; **failed / anything non-success → red crossed box (☒ / [X])**. Replace the current colored status dot.
- Impl note (`public/gui.js` tool card + `styles.css`): ok → green ✓, error → red ✗, pending → neutral; update the `.tool-dot`/glyph.

### T9. New-session auto-naming "<project-name> new <#N>"
- A session created in a project is auto-named **"<project-name> new <N>"**, incrementing per newly-created session (create two in a row → "<proj> new 1", then "<proj> new 2"). N counts ONLY existing sessions already matching the "<project> new <#>" format — it must NOT count other (differently-named) active sessions.
- Impl note: on create-in-project, compute N = (max existing "<proj> new <k>" in that project) + 1 and set it as the session display name (customName-style). Server-side in `registry.create` / a naming helper (it can see the project's existing sessions). Skip for temp sessions.

### T10. [quick] Smaller conversation font + tighter line spacing
- Claude-side text and user-message bubbles are too tall (one line takes ~2 lines of vertical space). Make the **font a bit smaller**, fix the **line-height**, and make **user-message bubbles a little smaller** too.
- Impl note (`public/styles.css`): reduce `.gui-asst` / `.gui-user` `font-size`, set `line-height` ≈ 1.3, trim bubble padding.

### T11. [quick] local-docs/TODO "not found" → error list only (not the bottom-left corner)
- When `local-docs.md` / `TODO.md` don't exist, the missing-file error currently shows in the bottom-left `#error` element. It should appear **only in the error list** (error center), not the sidebar corner.
- Impl note (`public/app.js`): route these errors to `errorCenter.add(...)` only; stop setting `errorEl.textContent` for them (consider moving ALL errors to the error center per T12 and retiring the bottom-left `#error`).

### T12. [quick] Error-list icon → top-left next to the "cc-cockpit" title + blink
- Move the error-center toggle so it sits **next to the "cc-cockpit" header (top-left)** and make it **blink** while there are unread errors, so it's actually noticeable.
- Impl note (`index.html` + `styles.css`): relocate `#error-toggle` into the sidebar `<h1>` row; add a pulse/blink animation while error count > 0.

### T13. [VERIFY — not a build task] Statusline stats stay fresh
- Quick check (not a work task): confirm the usage chip (ctx / 5h / 7d) keeps updating during a session and never goes stale — it reads the footer on each output, so verify it reflects current values over time / after turns.

## Eventually
- **Review + merge `feat/gui-mode` → master.** Do a full live end-to-end pass over the GUI features first. The old A1–A5 master-feature review items (below) fold into this review.
- **Deferred interactivity long-tail** (still fine via Terminal mode): compose command history (↑/↓, Ctrl+R); external editor (Ctrl+G); voice; vim mode; background tasks (Ctrl+B).
- **SKIPPED — shell mode (`!`)**: not needed now that we have the GUI.

## Backlog / deferred
- [ ] C1. Persist session rename across server restart/resume (in-memory only today; needs a {ccSessionId: name} map).
- [ ] C2. Temporary-session cleanup / auto-deletion (temp sessions persist indefinitely).
- [ ] C3. Electron conversion milestone (browser-first now; Electron as a final additive milestone — its own brainstorm/spec/plan/branch).
- [ ] C4. Harden Windows path matching: make isTemp / isUnderProjectsRoot / lastActivityByPath / projectOf case-insensitive on win32.

## Old review items (fold into the feat/gui-mode merge review)
- A1 hook-driven session state; A2 Discovery & Projects; A3 passive preview + focus fix; A4 temp sessions + rename; A5 navigation + resume scope + uniform modals. (All merged to master earlier; the GUI work on feat/gui-mode sits on top.)

## Done (history)
- [x] B2. No-transcript bug — root cause = inherited `CLAUDE_CODE_CHILD_SESSION=1`; fix = `scrubParentClaudeEnv` in `server/pty.js`. (Full writeup: `docs/superpowers/worklog/2026-06-25-b2-no-transcript-rootcause.md`.)
