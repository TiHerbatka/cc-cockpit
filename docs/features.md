# Features (current state)

Entries are `FEAT-<slug>`. Conventions (format, handles, freshness): see [README.md](./README.md). Keep facts here only — do not duplicate them in CLAUDE.md.

**Last verified: 2026-06-29**

### FEAT-multi-session-cockpit — Multi-session cockpit

**What it does:** Presents every Claude Code session the cockpit owns in one window: the left sidebar lists them all and clicking one focuses it instantly, switching the main pane (conversation, header controls, compose box) to that session. You can type into whichever session is focused without losing the others.

**Key facts:**
- One browser window holds all live sessions at once; switching is a single click, with no reload.
- Clicking a session focuses it, moves the cursor into its compose box, and shows its conversation and controls.
- A turn is sent as one structured message to the focused session (no keystroke emulation).
- New sessions are started from the cockpit (the New-session and Resume buttons), not from terminal tabs.

**Area:** the cockpit web client and the session registry.

**Last verified: 2026-06-29**

### FEAT-sidebar-grouping — Sidebar grouping & session rows

**What it does:** Groups the sidebar's sessions by project, with a clear header per group, and shows each session's live state as a small status dot. Each row also carries a remove control for tidying the list.

**Key facts:**
- Groups are ordered named-projects-first (alphabetical), then a Temporary group, then an "Other" group last.
- Within a group, sessions are listed alphabetically by display name; the order stays stable when a session changes state — only its dot changes, not its position (state is shown, not sorted to the top).
- Each row shows a state-specific dot (working, needs-you, your-move, idle, exited) and the session's display name.
- Each row has a ✕ control: on a live session it kills the running Claude (after a confirm prompt); on an exited session it removes the row from the cockpit.
- Right-clicking a row opens a context menu (Quick preview, Open folder, Rename).

**Area:** the sidebar render in the web client and the registry's per-session project/temp tagging and status derivation.

**Last verified: 2026-06-29**

### FEAT-session-state — Session states & attention signals

**What it does:** Shows, for every session, which of a few states it is in, so you can tell at a glance which sessions are waiting on you. The state appears as a distinct dot shape in the sidebar and in the focused session's header.

**Key facts:**
- States and their dots: Working (spinning gear), Needs-you (pulsing triangle — any gated interaction is open and awaiting your answer: a tool-permission, AskUserQuestion, plan-review, or MCP-elicitation prompt), Your-move (steady dot — a background session finished its turn and is waiting), Idle (hollow dot), Exited (✕).
- Your-move is the signal that a session you weren't looking at has finished and wants you; focusing that session acknowledges it and clears the signal.
- The Stop/interrupt control in the header appears only while a session is Working.

**Area:** the registry's status derivation and the sidebar/header state render.

**Last verified: 2026-06-29**

### FEAT-projects — Projects & create-and-start picker

**What it does:** Lets you start a new session inside a project without typing a path. The New-session picker lists your cockpit projects (and, on a second scope, other discovered folders), and a single click starts a fresh session in that folder; you can also create a brand-new project and start in it in one step.

**Key facts:**
- Two scopes: "Cockpit projects" (folders under the cockpit projects root) and "Discovered folders" (other folders found from past sessions).
- Projects are grouped into last-used time bands (Last 24h / 1–3 days / 3–7 days), with an "Older than 7 days" view; each row shows the project's last-used time.
- A "Create & start" field makes a new project by name and immediately opens a session in it.
- A warning chip flags projects that were created but never used, and clicking it lists them.
- A "+ Temporary session" button starts a one-off session instead (see FEAT-temp-sessions).

**Area:** the New-session picker in the web client and the projects API.

**Last verified: 2026-06-29**

### FEAT-resume-discovery — Resume past sessions

**What it does:** Opens a modal that discovers past Claude Code sessions across the machine and lets you bring one back as a new live session in its original folder.

**Key facts:**
- A scope switch chooses where to look: Global discovery (everywhere), Cockpit (only sessions under the cockpit projects root), or Temporary (only one-off temporary sessions).
- Recent sessions are shown in age-band columns (Last 24h / 1–3 days / 3–7 days), grouped by folder and titled from each session's own title; an "Older than 7 days" toggle reveals the rest.
- A search box filters by session title, project, or folder path.
- Clicking a listed session resumes it in its original working directory as a new live session in the cockpit.

**Area:** the Resume picker in the web client and the recent-session discovery scan.

**Last verified: 2026-06-29**

### FEAT-temp-sessions — Temporary sessions

**What it does:** Creates throwaway, one-off sessions that don't need a project. Each gets its own auto-named folder under the cockpit's temporary-sessions area and is kept visually separate from project work.

**Key facts:**
- Started from the "+ Temporary session" button in the New-session picker.
- Appear in their own "Temporary" group in the sidebar and a separate "Temporary" section of the Resume modal.
- Auto-labeled (a timestamp-style name initially, upgraded to a real title once one is available).
- Not auto-deleted — they persist and can be resumed later.

**Area:** the temp-session creation in the projects layer and the New-session picker.

**Last verified: 2026-06-29**

### FEAT-rename — Rename a session

**What it does:** Lets you give any session a custom display name from its right-click menu, overriding the auto-generated title in the sidebar and header.

**Key facts:**
- Reached via the session row's right-click context menu (Rename), opening a small modal pre-filled with the current name.
- The custom name takes precedence over the auto-title and the folder name.
- The custom name is persisted to disk — a flat JSON file (`<projectsRoot>/.cockpit-renames.json`) keyed by the Claude Code session id — so it survives a server restart and is restored when the same session is resumed. Clearing the name (empty rename) removes its entry. An absent or malformed file is treated as "no renames" and never blocks startup; a failed write is swallowed (the in-memory rename still applies).

**Area:** the registry rename plus its disk-backed rename store, and the rename modal in the web client.

**Last verified: 2026-06-30**

### FEAT-quick-preview — Read-only quick preview

**What it does:** Shows a live, read-only view of any session's conversation in a modal, without focusing or disturbing that session, so you can glance at what another session is doing while staying where you are.

**Key facts:**
- Opened from a session row's right-click menu (Quick preview).
- Renders the session's conversation model (messages, thinking, tool cards, todos) read-only — it is a view of the rendered conversation, not a terminal replay.
- Stays current via the same live conversation updates the cockpit already receives; it does not focus, acknowledge, or send anything to the session.
- Has no compose box; closes with its ✕ or Escape.

**Area:** the `peek` protocol path and the preview modal in the web client.

**Last verified: 2026-06-29**

### FEAT-navigation — Navigation conveniences

**What it does:** A set of small conveniences for getting around: opening a session's folder, filtering long lists, browsing projects by recency, and dismissing dialogs quickly.

**Key facts:**
- "Open folder" (in a session's right-click menu) opens that session's working directory in the OS file explorer.
- The New-session and Resume modals each have a search box that filters live by name, title, or path.
- Projects and recent sessions are organized into last-used time bands (Last 24h / 1–3 days / 3–7 days) with an "Older than 7 days" view.
- Modals close on Escape.

**Area:** the web-client modals and the open-folder handler.

**Last verified: 2026-06-29**

### FEAT-image-paste — Image paste & upload in compose

**What it does:** Lets you put images into a message: paste an image from the clipboard or drag an image file into the compose box, and it is uploaded and represented as an inline image token in the message you send.

**Key facts:**
- Pasting or dropping one or more images uploads each and inserts a labeled image token (e.g. "[Image #1]") at the caret; a single paste/drop carrying several images attaches them all, in order.
- Tokens can be dragged to reposition them within the message before sending.
- Right-clicking a token offers "Open in default app" to view the image.
- On send, each token is serialized into the message as the uploaded file's path (quoted if it contains spaces).
- Uploads are capped at 25 MB (decoded); a larger image is rejected (HTTP 413).

**Area:** the compose editor and the image-upload path.

**Last verified: 2026-06-29**

### FEAT-paste-handling — Smart paste in the compose box

**What it does:** Cleans up text pasted into the compose box so common patterns land the way you intend: it strips the quotes Windows adds to copied paths, and collapses a large pasted block into a compact, expandable chip instead of flooding the editor.

**Key facts:**
- When the entire paste is a single Windows-quoted path (Explorer's "Copy as path" wraps it in double quotes, e.g. `"C:\dir\file.txt"`), the wrapping quotes are stripped so the bare path is inserted. Detection is conservative — only a single token that has no embedded quote and looks like a filesystem path (drive letter, UNC prefix, or any backslash) is unwrapped, so ordinary quoted prose and multiple space-separated quoted paths are left untouched.
- A large pasted block (more than 8 lines or over 800 characters) is collapsed into a numbered chip ("[Pasted text #1 · N lines]") rather than inserted in full; clicking the chip toggles a read-only preview popup of the block, and on send the chip expands back to its verbatim text. Short pastes insert inline as before.
- Long file paths wrap rather than overflow in both the compose editor and the chat log: the editor, user/assistant messages, tool-output blocks, and fenced code blocks all wrap (`word-break: break-word`, with `white-space: pre-wrap` on the preformatted ones) rather than scrolling horizontally, so a long unbroken path — or a skill's output echoed as a code block — breaks onto the next line instead of overflowing the width. Indentation inside code blocks is preserved. (Verified — no dedicated path-wrapping code is needed beyond these rules.)

**Area:** the compose editor's paste handler, the pure paste helpers, and the word-break / white-space rules on the compose and chat surfaces.

**Last verified: 2026-07-01**

### FEAT-interaction-modal — Blocking interaction modal

**What it does:** Surfaces every "Claude is waiting on you" moment as one blocking modal over the focused session's conversation, with the right controls for the kind of request, so you can answer it inline.

**Key facts:**
- Handles four kinds: tool-permission, AskUserQuestion, plan review, and MCP elicitation.
- Permission requests show the tool and its input human-readably — the command for a shell tool, the file path (and replace/with strings for an edit) for a file tool, the pattern for a search, otherwise a tidy labeled key/value list — with the full raw JSON kept in a collapsed "Raw input" details for fidelity. Actions: Allow once / Allow, don't ask again / Deny.
- Plan review shows the plan text with Approve / Approve & auto-accept edits / Keep planning.
- AskUserQuestion shows each question's options (single- or multi-select) with a Submit button; MCP elicitation shows the requested fields (or a link) with Submit / Decline.
- The modal overlays only the conversation pane — the sidebar stays usable — and a pending request is re-shown if you switch away and back to that session.

**Area:** the interaction modal in the web client and the SDK control channel.

**Last verified: 2026-07-01**

### FEAT-usage-chip — Usage chip

**What it does:** Shows a compact usage readout on its own thin row directly below the focused session's header — recent token counts plus how much of your rolling rate-limit windows and the model's context window are used. The row sits on its own line (rather than amid the header buttons) so the header stays uncluttered.

**Key facts:**
- Segments shown: per-turn tokens (in ↓ / out ↑), context-window percent, and the 5-hour and 7-day rolling-window percents.
- The window segments are color-coded by utilization (green under 70%, yellow 70–90%, red at/above 90%) and carry a "resets at" tooltip.
- The chip is per-session and resets when you switch sessions; each incoming figure updates only its own segment.
- The whole row is hidden until there is at least one segment to show (no empty strip), and collapses again on a session switch.
- The client-side accumulator fold (each incoming meta updates only its own segment, never blanking the others) plus the token/percent formatting are a pure, unit-tested module; the header view only turns the resulting segment descriptors into DOM spans.

**Area:** the usage row below the header (its pure accumulator/format module + the DOM view) and the usage-window computation.

**Last verified: 2026-06-30**

### FEAT-header-controls — Header controls (model, effort, permission mode, stop)

**What it does:** Gives the focused session a row of controls in the header to change its model, reasoning effort, and permission mode, and to interrupt a running turn.

**Key facts:**
- Model selector: Opus 4.8, Sonnet 4.6, Haiku 4.5.
- Effort selector: low, medium, high (default), xhigh, max.
- Permission-mode chip opens a dropdown of all six modes — default, acceptEdits, plan, bypassPermissions, dontAsk, auto — each with a one-line "?" tooltip explaining it.
- A Stop control interrupts the current turn; it appears only while the session is working.
- Changing any control acts on the focused session and the header updates to reflect the new value.

**Area:** the header controls and the session control channel.

**Last verified: 2026-06-29**

### FEAT-overflow-menu — Header overflow (⋯) menu

**What it does:** A ⋯ button at the end of the header opens a small menu of rarely-used per-session actions — one low-clutter place to grow into as more such actions are added.

**Key facts:**
- **Copy session ID** — copies the focused session's Claude Code session id (`ccSessionId`) to the clipboard, with a brief "Session ID copied" toast on success; a clipboard failure is routed to the error center (see FEAT-error-center). The session id is already carried on every session the client receives, so the copy is a pure client action (no server round-trip).
- **Display** override — Focus / Normal / Verbose radio-style items (the active one checked) that override the detail level the cockpit renders at, on top of the setting read from your Claude config (see FEAT-display-mode).
- The button is disabled when no session is focused; the menu closes on outside-click or Escape.

**Area:** the header overflow menu in the web client.

**Last verified: 2026-07-01**

### FEAT-display-mode — Display detail level (focus / normal / verbose)

**What it does:** Renders the conversation at the detail level you already use in the terminal, by reading your Claude Code display settings — a quiet folded view, the normal view, or a fully expanded view — with a manual override in the ⋯ menu.

**Key facts:**
- Seeded from your Claude settings: `viewMode: "focus"` → the folded **focus** view; `verbose: true` → the fully expanded **verbose** view; neither → **normal**. `verbose` wins when both are set, matching Claude's own documented precedence. (Mechanism + precedence source: MECH-display-mode.)
- **Focus** collapses each turn's intermediate reasoning to a one-line summary (kept expandable) and folds tool activity into collapsed groups, while keeping your prompts and each turn's final answer expanded. **Verbose** expands tool input/output and thinking. **Normal** is the default rendering.
- The ⋯ menu's Display items override the seeded mode for the session; the override wins until changed.

**Area:** the conversation render in the web client, driven by the display-mode read from Claude settings.

**Last verified: 2026-07-01**

### FEAT-float-panels — Floating todo / topic panels

**What it does:** Provides three header buttons that float a small overlay panel over the conversation for quick reference: this session's in-progress task list, its tracked topics, and the session folder's TODO.md.

**Key facts:**
- "In-session todo" shows the focused session's live task list (with status glyphs).
- "Topics" shows the session's tracked topics (code, name, status dot, and summary).
- "TODO.MD" fetches and shows the session folder's TODO.md (sections and checkbox items).
- A fourth header button among the doc-buttons, "📄 Docs", does NOT float a panel: it opens the focused session's `local-docs.md` (in the session cwd) in the OS default app. A missing file yields a "not found" error routed to the error center (see FEAT-error-center).
- The panel floats over the chat without shrinking it, only one source is open at a time, and it closes with its ✕ or Escape.

**Area:** the floating panels in the web client and the topics/todo/TODO.md feeds.

**Last verified: 2026-06-29**

### FEAT-conversation-render — Conversation rendering

**What it does:** Renders the focused session's conversation as a structured log — user and assistant messages, thinking, tool activity, and todo lists — plus a status line and a waiting indicator, all driven from the session's live conversation model.

**Key facts:**
- Renders distinct item types: user messages, assistant messages, collapsible thinking blocks, collapsible tool cards, and todo blocks.
- Assistant messages are rendered as Markdown — fenced and inline code, bold/italic/strikethrough, headings, ordered/unordered lists (with multi-level nesting), GitHub-flavored pipe tables (with column alignment), blockquotes, horizontal rules, and links (single newlines become line breaks). Rendering is XSS-safe (all text is HTML-escaped before any markup is built, and link schemes are sanitized). User messages stay plain text.
- Tool cards show a short labeled header (e.g. the command or file path), a status dot, and expandable input and output.
- A run of 3+ back-to-back tool cards is collapsed into a single group (showing the count, any failure count, and the distinct tool names); the group is collapsed by default and its left border reflects the run's worst status (pending > error > ok). Unfolding it reveals the individual tool cards, each still independently expandable. Runs of 1–2 tools stay inline.
- Expand/collapse state of tool cards and tool groups is **remembered across re-renders**: the log rebuilds on every streaming delta, but a card or group you've opened (or collapsed) stays that way as new tokens/messages arrive, so reading one isn't interrupted. State is keyed by the tool's stable id and reset on a session switch.
- A status line summarizes the conversation title, the currently running tool, and todo progress. When it has none of these (an idle session with no title yet), the bar is hidden entirely rather than showing a misleading idle placeholder.
- A "Waiting for Claude…" spinner covers the gap between sending a turn and Claude's first output, clearing on the first response item, a focus change, an interaction prompt, or an error.
- The log auto-scrolls to the newest item when you're already at the bottom.

**Area:** the conversation render in the web client and the normalize fold.

**Last verified: 2026-07-01**

### FEAT-error-center — GUI error center

**What it does:** Collects every client-side error into one toggleable list in the sidebar, so problems that would otherwise vanish into the browser console are visible and reviewable inside the cockpit.

**Key facts:**
- A ⚠ button with an error count sits in the sidebar header, hidden until the first error; clicking it toggles a panel listing every error newest-first.
- Each entry shows a wall-clock timestamp and, when a stack trace is available, an expandable "stack" button that opens the trace in a modal.
- Captures window 'error' events, unhandled promise rejections, WebSocket failures ("WebSocket connection error" on error, "WebSocket disconnected" on close), server-pushed errors (shown prefixed "Server: "), and image-upload failures.
- A new error re-arms an unread pulse on the button unless the panel is already open; the list caps at 200 entries (oldest dropped); a "clear" button empties it.

**Area:** the GUI error center in the web client.

**Last verified: 2026-06-29**
