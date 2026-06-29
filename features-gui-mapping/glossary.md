# cc-cockpit — GUI glossary

A stable vocabulary for the cockpit GUI: every area and element keyed by an immutable `GUI-<AREA>-<slug>` handle. Use these handles to point precisely at parts of the interface. Generated from the live GUI by the `/gui-map` skill — do not edit by hand.

_Last generated: 2026-06-29_

See the visual map (hover/click hotspots): [map.html](./map.html).

## SIDEBAR — The always-visible left rail: every session grouped by project (plus Temporary and Other), the create/resume actions, and the client-side error center.

### GUI-SIDEBAR-title — App title
The cockpit's name at the top of the rail.
Part of: `FEAT-multi-session-cockpit`

### GUI-SIDEBAR-group — Session group header
A heading that groups the sessions below it; projects come first, then Temporary, then Other.
Part of: `FEAT-sidebar-grouping`

### GUI-SIDEBAR-row — Session row
One session in the list; click to focus it, right-click for its actions. The focused row is highlighted.
Part of: `FEAT-sidebar-grouping`

### GUI-SIDEBAR-row-label — Session name
The session's display name (a rename wins over the auto-title, which wins over the folder name).
Part of: `FEAT-rename`

### GUI-SIDEBAR-row-remove — Remove-session button
Kills the session if live and drops it from the cockpit.
Part of: `FEAT-sidebar-grouping`

### GUI-SIDEBAR-dot-working — Working status dot
Marks a session whose turn is currently running.
Part of: `FEAT-session-state`

### GUI-SIDEBAR-dot-yourmove — Your-move status dot
Marks an unfocused session that finished its turn and is waiting for you to read it.
Part of: `FEAT-session-state`

### GUI-SIDEBAR-dot-needsyou — Needs-you status dot
Marks a session blocked on a decision from you.
Part of: `FEAT-session-state`

### GUI-SIDEBAR-dot-idle — Idle status dot
Marks a session with nothing pending.
Part of: `FEAT-session-state`

### GUI-SIDEBAR-dot-exited — Exited status dot
Marks a session whose underlying process has ended.
Part of: `FEAT-session-state`

### GUI-SIDEBAR-new — New-session button
Opens the picker to start a session in a project or a temporary folder.
Part of: `FEAT-projects`

### GUI-SIDEBAR-resume — Resume button
Opens the picker to reopen a past session from history.
Part of: `FEAT-resume-discovery`

### GUI-SIDEBAR-error-chip — GUI error chip
Appears when client-side errors occur; toggles the error list.
Part of: `FEAT-error-center`

### GUI-SIDEBAR-error-panel — GUI error panel
The list of recent client-side errors, with controls to clear or close it.
Part of: `FEAT-error-center`

### GUI-SIDEBAR-error-item — GUI error entry
One captured client-side error, with its time and an optional stack trace.
Part of: `FEAT-error-center`

## HEADER — The bar above the focused session: its name and state, the floating-panel buttons, the usage chip, and the per-session controls.

### GUI-HEADER-state — Focused-session state icon
The focused session's current state, shown as a shaped glyph.
Part of: `FEAT-session-state`

### GUI-HEADER-label — Focused-session name
The focused session's display name.
Part of: `FEAT-rename`

### GUI-HEADER-insession — In-session todo button
Toggles the panel showing the session's live task list.
Part of: `FEAT-float-panels`

### GUI-HEADER-topics — Topics button
Toggles the panel of topics tracked for the session.
Part of: `FEAT-float-panels`

### GUI-HEADER-usage — Usage chip
Per-turn tokens plus context fill and rolling 5-hour / 7-day usage.
Part of: `FEAT-usage-chip`

### GUI-HEADER-stop — Stop button
Interrupts the running turn; shown only while a turn is in progress.
Part of: `FEAT-header-controls`

### GUI-HEADER-mode — Permission-mode chip
The session's permission mode; click it to change it.
Part of: `FEAT-header-controls`

### GUI-HEADER-model — Model selector
Switches the model the session uses.
Part of: `FEAT-header-controls`

### GUI-HEADER-effort — Effort selector
Switches the reasoning-effort level.
Part of: `FEAT-header-controls`

### GUI-HEADER-docs — Docs button
Opens the session's local docs file in the OS default app.
Part of: `FEAT-navigation`

### GUI-HEADER-todomd — TODO.MD button
Toggles the panel showing the session's TODO.md.
Part of: `FEAT-float-panels`

## CONV — The scrolling conversation of the focused session, plus the one-line status summary above it.

### GUI-CONV-status — Status line
A one-line summary above the log: title, current tool, and todo progress.
Part of: `FEAT-conversation-render`

### GUI-CONV-status-todoprog — Todo progress
Completed-versus-total count of the session's todos.
Part of: `FEAT-conversation-render`

### GUI-CONV-status-current — Current-tool indicator
The tool the session is running right now.
Part of: `FEAT-conversation-render`

### GUI-CONV-user — User message
A turn you sent to the session.
Part of: `FEAT-conversation-render`

### GUI-CONV-assistant — Assistant message
Claude's text reply.
Part of: `FEAT-conversation-render`

### GUI-CONV-thinking — Thinking block
Claude's reasoning, collapsed by default.
Part of: `FEAT-conversation-render`

### GUI-CONV-tool-ok — Tool card (succeeded)
A tool call that succeeded; expand it for the input and result.
Part of: `FEAT-conversation-render`

### GUI-CONV-tool-error — Tool card (failed)
A tool call that returned an error.
Part of: `FEAT-conversation-render`

### GUI-CONV-todos — Todo-list block
A snapshot of the session's task list inline in the log.
Part of: `FEAT-conversation-render`

## COMPOSE — The message box at the bottom of the focused session.

### GUI-COMPOSE-input — Compose editor
Where you type a message; accepts pasted or dropped images.
Part of: `FEAT-image-paste`

### GUI-COMPOSE-send — Send button
Sends the composed message to the session.
Part of: `FEAT-conversation-render`

### GUI-COMPOSE-imgtoken — Image token
A placeholder chip standing in for an attached image inside the message.
Part of: `FEAT-image-paste`

### GUI-COMPOSE-spinner — Waiting spinner
Shown between sending a turn and Claude's first output of that turn.
Part of: `FEAT-conversation-render`

## PANEL — Floating panels shown over the conversation, one per header button.

### GUI-PANEL-float — Floating panel
The shared overlay that hosts topics, in-session todos, or the TODO.md view.
Part of: `FEAT-float-panels`

### GUI-PANEL-close — Panel close button
Closes the floating panel.
Part of: `FEAT-float-panels`

### GUI-PANEL-topic-row — Topic entry
One tracked topic: its code, name, status dot, and summary.
Part of: `FEAT-float-panels`

### GUI-PANEL-topic-status — Topic status dot
The topic's state: active, parked, or resolved.
Part of: `FEAT-float-panels`

### GUI-PANEL-insession-row — In-session todo entry
One task from the session's live todo list.
Part of: `FEAT-float-panels`

### GUI-PANEL-todomd-section — TODO.md section
A section heading from the session's TODO.md.
Part of: `FEAT-float-panels`

### GUI-PANEL-todomd-item — TODO.md item
A task line from the session's TODO.md, indented by its depth.
Part of: `FEAT-float-panels`

## INTERACTION — The blocking modal shown over the conversation when a session needs a decision from you.

### GUI-INTERACTION-card — Interaction card
The modal that overlays the conversation when the session is waiting on you.
Part of: `FEAT-interaction-modal`

### GUI-INTERACTION-perm-input — Permission tool input
The tool and arguments Claude is asking permission to run.
Part of: `FEAT-interaction-modal`

### GUI-INTERACTION-actions — Decision buttons
Allow once, allow and remember, or deny — and the per-kind equivalents.
Part of: `FEAT-interaction-modal`

### GUI-INTERACTION-plan — Plan text
The proposed plan awaiting your approval.
Part of: `FEAT-interaction-modal`

### GUI-INTERACTION-question-opt — Question option
A selectable answer to a question Claude asked.
Part of: `FEAT-interaction-modal`

### GUI-INTERACTION-elicit-field — Elicitation field
An input requested by an MCP server.
Part of: `FEAT-interaction-modal`

## MODAL — Centered modal dialogs: the new-session and resume pickers, rename, and quick preview.

### GUI-MODAL-newsession — New-session picker
Start a session: pick a cockpit project, a discovered folder, or a temporary session.
Part of: `FEAT-projects`

### GUI-MODAL-scope — Scope switch
Toggles between cockpit projects and discovered folders.
Part of: `FEAT-projects`

### GUI-MODAL-search — Picker search
Filters the list by name or path.
Part of: `FEAT-projects`

### GUI-MODAL-older — Older-than-7-days toggle
Switches from the recent time-bands to the older flat list.
Part of: `FEAT-projects`

### GUI-MODAL-neverused — Never-used chip
Lists projects that were created but never used.
Part of: `FEAT-projects`

### GUI-MODAL-band — Time-band column
A column of entries bucketed by how recently they were last used.
Part of: `FEAT-projects`

### GUI-MODAL-projectrow — Project row
A project to start a session in, with its last-used time.
Part of: `FEAT-projects`

### GUI-MODAL-create — Create-project field
Names and creates a new project, then starts a session in it.
Part of: `FEAT-projects`

### GUI-MODAL-temp — Temporary-session button
Starts a throwaway session in a temporary folder.
Part of: `FEAT-temp-sessions`

### GUI-MODAL-resume — Resume picker
Reopen a past session, grouped by folder within last-used bands.
Part of: `FEAT-resume-discovery`

### GUI-MODAL-resume-group — Resume folder group
Past sessions grouped by the folder they ran in.
Part of: `FEAT-resume-discovery`

### GUI-MODAL-resume-row — Resume row
A specific past session to reopen.
Part of: `FEAT-resume-discovery`

### GUI-MODAL-rename — Rename dialog
Sets a custom display name for the session.
Part of: `FEAT-rename`

### GUI-MODAL-preview — Quick-preview window
A read-only live view of a session without focusing it.
Part of: `FEAT-quick-preview`

### GUI-MODAL-preview-close — Preview close
Closes the quick-preview window.
Part of: `FEAT-quick-preview`

## MENU — Transient pop-up menus summoned by a click or right-click.

### GUI-MENU-context — Session context menu
Right-click actions for a session: quick preview, open folder, rename.
Part of: `FEAT-navigation`

### GUI-MENU-context-item — Context-menu item
One action in the session context menu.
Part of: `FEAT-navigation`

### GUI-MENU-mode — Permission-mode dropdown
The dropdown listing all six permission modes.
Part of: `FEAT-header-controls`

### GUI-MENU-mode-row — Mode option
One permission mode, with a help tooltip explaining it.
Part of: `FEAT-header-controls`
