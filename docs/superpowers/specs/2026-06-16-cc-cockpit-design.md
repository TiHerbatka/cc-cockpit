# cc-cockpit — Design (Absolute MVP)

Date: 2026-06-16
Status: Approved scope, pending spec review

## Problem & goal

Working across 3+ Claude Code sessions in separate PowerShell tabs is hard to manage and easy to lose (accidental tab close). Existing tools miss the mark: Agent View is too terse and slow to switch; kanban tools (Vibe Kanban, AI Agent Board) are task-centric (dispatch → autonomous work → review/merge), not interactive; claudecodeui is project-centric (browse/resume one project's history), not a simultaneous-sessions view. The goal is a personal **cockpit**: one window showing all live sessions at once, instant switching, and interactive input into any of them. The *session* is the unit, not the *project*.

## Non-goals (v0)

These are deliberately cut to keep v0 minimal; each is a candidate for a later version, not a gap to apologize for.

- Auto-discovering existing `~/.claude` sessions. You launch sessions inside the cockpit going forward; to resume old work, add a session and run `claude --resume` in it.
- Persistence if the server process dies; reconnect/scrollback restore after a browser refresh.
- Split/grid view (multiple terminals visible at once). v0 shows one focused terminal with instant switching.
- Precise "needs input" detection, desktop notifications, sound.
- Project browser, conversation history, diff/review, authentication, tab colors, renaming, drag-reorder.

## The one accepted behavior change

Sessions are started **from the cockpit**, not from terminal tabs. This is what makes "everything in one place" possible without fragile hijacking of other terminals' PTYs. Confirmed acceptable by the user.

## Architecture

A single local web app. A Node server owns the Claude Code processes and bridges them to a browser UI over WebSocket.

- Each session is a `claude` process spawned as a pseudo-terminal via `node-pty` (which uses Windows ConPTY). The server is the single source of truth for the set of live sessions.
- The browser renders one `xterm.js` terminal for the focused session plus a sidebar listing all sessions. Output streams server → browser; keystrokes stream browser → server.
- The server binds to `127.0.0.1` only. No authentication in v0 (localhost, single user), but note: the UI is equivalent to terminal/shell access to the machine, so it must never be exposed beyond localhost.

```
Browser (one page)                         Node server
┌──────────────┬────────────────┐          ┌───────────────────────────┐
│ sidebar      │ xterm.js        │  WS      │ session registry          │
│  ● proj-a    │ (focused        │ <======> │  id → { pty, cwd, label,  │
│  ○ zabbix    │  session's      │          │         status, lastOut } │
│  [+ add]     │  live I/O)      │          │ node-pty (ConPTY) procs   │
└──────────────┴────────────────┘          └───────────────────────────┘
```

## Components & responsibilities

- **Session registry (server):** create/destroy sessions; hold the `id → session` map; assign labels (folder basename). One clear job: own session lifecycle.
- **PTY adapter (server):** spawn `claude` in a given cwd via `node-pty`; expose `write(data)`, emit `data`, emit `exit`. Isolates the ConPTY dependency behind a small interface.
- **WebSocket hub (server):** one connection carries multiplexed, session-tagged messages. Client→server: `attach(id)`, `input(id, data)`, `create(cwd)`, `kill(id)`. Server→client: `output(id, data)`, `sessions(list)`, `status(id, state)`, `exited(id)`.
- **Static file server (server):** serve the single HTML/JS/CSS page.
- **Sidebar (client):** render the session list with an activity dot; clicking sets the focused session (sends `attach`). One job: navigation + status display.
- **Terminal view (client):** one `xterm.js` instance; on focus change, clear and replay the focused session's buffered output, route keystrokes as `input(focusedId, data)`.
- **Add-session control (client):** prompt for a folder path, send `create(cwd)`.

## Data flow

- Keystroke: xterm `onData` → WS `input(focusedId, data)` → `pty.write(data)`.
- Output: `pty.onData` → server records `lastOut = now`, sets status `working`, broadcasts `output(id, data)` → client writes to xterm if `id === focusedId`, else buffers.
- Switch: click → WS `attach(id)` → client clears xterm, replays that session's server-side buffer.
- Status: a timer (or the next output event) flips a session to `idle` when no output for N seconds (default N = 2). Dot filled = `working`, hollow = `idle`, red = `exited`.

## Session model

`{ id (uuid), cwd (abs path), label (basename of cwd), status ('working'|'idle'|'exited'), lastOut (timestamp), buffer (ring buffer of recent output for replay on attach, bounded to ~64 KB / last ~500 lines per session) }`.

## Error handling

- `claude` spawn fails (bad path, CLI missing): server emits an error message; client shows a small inline error on the add dialog; no session row is created.
- PTY exits (session ends or crashes): server marks status `exited`, broadcasts `exited(id)`; the sidebar row stays (red dot) so output remains viewable until the user removes it. No auto-restart in v0.
- WebSocket drops: client retries connection with backoff; on reconnect it requests the current `sessions` list and re-attaches the previously focused id. (Server-side PTYs keep running across a browser refresh because they live in the server process; full scrollback restore is out of scope — only the server-side ring buffer is replayed.)
- Server process dies: all sessions die (accepted v0 limitation; documented, mitigated later).

## Tech & dependencies

- Node.js (v22+; user has v24).
- `node-pty` (ConPTY on Windows).
- `ws` (WebSocket server).
- `xterm.js` + `xterm-addon-fit` (client, served as static assets).
- No build step required; plain HTML/JS page is acceptable for v0.

## Suggested file layout

```
cc-cockpit/
  server/
    index.js        # http + ws + static serving, wires the pieces
    sessions.js     # session registry
    pty.js          # node-pty adapter
  public/
    index.html
    app.js          # sidebar + terminal view + add control
    styles.css
  package.json
  docs/superpowers/specs/2026-06-16-cc-cockpit-design.md
```

## Acceptance criteria (definition of done for v0)

1. Running the server and opening `http://127.0.0.1:4477` (default port; configurable via a `PORT` env var) shows an empty cockpit with an "Add session" control.
2. Adding a session with a folder path spawns `claude` there; its live output appears in the terminal view and a row appears in the sidebar.
3. Adding a second and third session works; clicking a sidebar row switches the focused terminal in well under a second and routes typing to that session.
4. Typing in the terminal reaches the focused session's `claude` and its responses render live.
5. Each sidebar row shows an activity dot that is filled while the session is producing output and hollow shortly after it goes quiet.
6. When a session's `claude` exits, its row shows a red/exited state and stops accepting input.
7. The server binds only to `127.0.0.1`.

## v0.2+ backlog (explicitly deferred)

Auto-discovery of `~/.claude` sessions; split/grid multi-terminal view; precise "needs input" detection + desktop notifications; persistence across server restart and full scrollback restore; per-session labels/colors/reorder; optional auth for LAN access.
