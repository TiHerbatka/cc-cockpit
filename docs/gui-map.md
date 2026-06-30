# cc-cockpit — GUI glossary (generated)

A map of the cockpit GUI surface, auto-discovered from the live GUI by the `/gui-map` skill — **do not edit by hand** (a re-run overwrites it). Each entry is a durable element identified by an inert `data-gui` marker in the product markup or by a stable interactive-control label; repeated structures collapse to one representative and pure data is excluded. Every element is keyed by a stable `GUI-<AREA>-<slug>` handle for cross-reference.

**Last generated: 2026-06-30**

Visual map (hover/click hotspots): [gui-map/map.html](gui-map/map.html).

## SIDEBAR — The left rail: sessions grouped by project, the create/resume actions, and the error center.

### GUI-SIDEBAR-session-list — Session List
The "Session List" element.

### GUI-SIDEBAR-session-group-header — Session Group Header
The "Session Group Header" element.

### GUI-SIDEBAR-session-row — Session Row
The "Session Row" element.

### GUI-SIDEBAR-status-icon — Status Icon
The "Status Icon" element.

### GUI-SIDEBAR-new-session — + New Session
The "+ New Session" button.

### GUI-SIDEBAR-resume — Resume…
The "Resume…" button.

### GUI-SIDEBAR-gui-errors — GUI Errors
GUI errors

### GUI-SIDEBAR-error-panel — Error Panel
The "Error Panel" element.

### GUI-SIDEBAR-clear — Clear
The "Clear" button.

### GUI-SIDEBAR-error-close — Error Close
The "Error Close" button.

### GUI-SIDEBAR-error-list — Error List
The "Error List" element.

### GUI-SIDEBAR-error-row — Error Row
The "Error Row" element.

### GUI-SIDEBAR-stack — Stack
The "Stack" button.

## HEADER — The bar above the focused session: its name/state, the panel buttons, the usage chip, and the controls.

### GUI-HEADER-header-status-icon — Focused session status
The "Focused session status" element.

### GUI-HEADER-header-label — Focused session name
The "Focused session name" element.

### GUI-HEADER-in-session-todo — In-session todos
In-session todos (this session's live task list)

### GUI-HEADER-topics — Topics
Topics tracked for this session

### GUI-HEADER-mode — Permission mode
Permission mode — click to change

### GUI-HEADER-model — Model
The "Model" select.

### GUI-HEADER-effort — Reasoning effort
The "Reasoning effort" select.

### GUI-HEADER-docs — Docs
Open local-docs.md

### GUI-HEADER-todomd — TODO.md
Show TODO.md entries

### GUI-HEADER-interrupt — Interrupt turn
Interrupt (Esc)

## CONV — The focused session's conversation log and the status line above it.

### GUI-CONV-conv-status — Conv Status
The "Conv Status" element.

### GUI-CONV-conv-log — Conv Log
The "Conv Log" element.

### GUI-CONV-conv-user-message — Conv User Message
The "Conv User Message" element.

### GUI-CONV-conv-thinking — Conv Thinking
The "Conv Thinking" element.

### GUI-CONV-conv-assistant-message — Conv Assistant Message
The "Conv Assistant Message" element.

### GUI-CONV-conv-tool-card — Conv Tool Card
The "Conv Tool Card" element.

### GUI-CONV-conv-todos — Conv Todos
The "Conv Todos" element.

### GUI-CONV-conv-tool-group — Conv Tool Group
The "Conv Tool Group" element.

## COMPOSE — The message box at the bottom of the focused session.

### GUI-COMPOSE-compose-input — Compose Input
The "Compose Input" element.

### GUI-COMPOSE-send — Send
The "Send" button.

## PANEL — Floating panels over the conversation (topics / in-session todos / TODO.md).

### GUI-PANEL-floating-panel — Floating panel
The "Floating panel" element.

### GUI-PANEL-panel-title — Panel Title
The "Panel Title" element.

### GUI-PANEL-close-esc — Close (Esc)
The "Close (Esc)" button.

### GUI-PANEL-panel-topic — Panel Topic
The "Panel Topic" element.

### GUI-PANEL-panel-todo-item — Panel Todo Item
The "Panel Todo Item" element.

### GUI-PANEL-panel-todomd-section — Panel Todomd Section
The "Panel Todomd Section" element.

### GUI-PANEL-panel-todomd-item — Panel Todomd Item
The "Panel Todomd Item" element.

## INTERACTION — The blocking modal shown when a session needs a decision from you.

### GUI-INTERACTION-interaction-modal — Interaction modal
The "Interaction modal" element.

### GUI-INTERACTION-interaction-head — Interaction Head
The "Interaction Head" element.

### GUI-INTERACTION-interaction-sub — Interaction Sub
The "Interaction Sub" element.

### GUI-INTERACTION-interaction-input — Interaction Input
The "Interaction Input" element.

### GUI-INTERACTION-allow-once — Allow Once
The "Allow Once" button.

### GUI-INTERACTION-allow-don-t-ask-again — Allow, Don'T Ask Again
The "Allow, Don'T Ask Again" button.

### GUI-INTERACTION-deny — Deny
The "Deny" button.

### GUI-INTERACTION-approve — Approve
The "Approve" button.

### GUI-INTERACTION-approve-auto-accept-edits — Approve & Auto Accept Edits
The "Approve & Auto Accept Edits" button.

### GUI-INTERACTION-keep-planning — Keep Planning
The "Keep Planning" button.

### GUI-INTERACTION-interaction-option — Interaction Option
The "Interaction Option" button.

### GUI-INTERACTION-submit — Submit
The "Submit" button.

### GUI-INTERACTION-interaction-field — Interaction Field
The "Interaction Field" element.

### GUI-INTERACTION-input — Input
The "Input" input.

### GUI-INTERACTION-decline — Decline
The "Decline" button.

## MODAL — Centered dialogs: the new-session / resume pickers, rename, and quick preview.

### GUI-MODAL-modal-dialog — Modal dialog
The "Modal dialog" element.

### GUI-MODAL-modal-title — Modal Title
The "Modal Title" element.

### GUI-MODAL-rename-input — Rename Input
The "Rename Input" input.

### GUI-MODAL-save — Save
The "Save" button.

### GUI-MODAL-quick-preview-window — Quick-preview window
The "Quick-preview window" element.

### GUI-MODAL-preview-close — Preview Close
The "Preview Close" button.

### GUI-MODAL-preview-body — Preview Body
The "Preview Body" element.

### GUI-MODAL-cockpit-projects — Cockpit Projects
The "Cockpit Projects" button.

### GUI-MODAL-discovered-folders — Discovered Folders
The "Discovered Folders" button.

### GUI-MODAL-modal-search — Modal Search
The "Modal Search" input.

### GUI-MODAL-older-toggle — Older Toggle
The "Older Toggle" button.

### GUI-MODAL-never-used-chip — Never Used Chip
1 project created but never used — click to list

### GUI-MODAL-resume-col-head — Resume Col Head
The "Resume Col Head" element.

### GUI-MODAL-project-row — Project Row
The "Project Row" button.

### GUI-MODAL-new-project-name — New Project Name
The "New Project Name" input.

### GUI-MODAL-create-start — Create & Start
The "Create & Start" button.

### GUI-MODAL-temporary-session — + Temporary Session
The "+ Temporary Session" button.

### GUI-MODAL-global-discovery — Global Discovery
The "Global Discovery" button.

### GUI-MODAL-cockpit — Cockpit
The "Cockpit" button.

### GUI-MODAL-temporary — Temporary
The "Temporary" button.

### GUI-MODAL-recent-group — Recent Group
The "Recent Group" element.

### GUI-MODAL-recent-row — Recent Row
The "Recent Row" button.

## MENU — Transient pop-up menus.

### GUI-MENU-permission-mode-menu — Permission-mode menu
The "Permission-mode menu" element.

### GUI-MENU-mode-menu-option — Mode Menu Option
The "Mode Menu Option" button.

### GUI-MENU-mode-menu-help — Mode Menu Help
Prompts for anything not pre-approved.

### GUI-MENU-context-menu — Context menu
The "Context menu" element.

### GUI-MENU-context-menu-item — Context Menu Item
The "Context Menu Item" button.
