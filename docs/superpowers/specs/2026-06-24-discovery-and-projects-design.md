# cc-cockpit — Session Discovery & Projects (Design)

Date: 2026-06-24
Status: Approved (brainstorm), pending implementation

## Problem & goal

Today the cockpit can only start a brand-new session by typing a folder path, and offers no way to find or continue past Claude Code sessions. This adds two GUI-first capabilities — **no manual path entry anywhere** — plus a reorganization of the live view and per-session lifecycle control:

1. **Projects** — a *project* is a folder under a fixed root. Create projects and start new sessions inside them by **picking**, never typing a path.
2. **Session discovery & resume** — browse recent past sessions (time-filtered) across the machine and **continue** any of them from the GUI.
3. **Live view by project** — the always-visible sidebar groups *running* sessions by the project they're in (state becomes the dot, not the grouping).
4. **Lifecycle button** — kill/remove a session from the GUI.

## Configuration

- **Projects root:** `COCKPIT_PROJECTS_ROOT` env, default `C:\claude_projects\cockpit`. A "project" is an immediate subdirectory of the root. The root is auto-created on first use.
- **Claude history dir:** `(process.env.CLAUDE_CONFIG_DIR || ~/.claude)/projects`. Sessions are stored as `<encoded-cwd>/<session-id>.jsonl`; subagent transcripts live under `<session-id>/subagents/agent-*.jsonl` and are **excluded** from discovery. The `<encoded-cwd>` folder name is **lossy** (path separators and `_`/`.`/spaces all collapse to `-`) and must NOT be reverse-engineered — the real cwd is read from a record *inside* the jsonl.

---

## Part A — Projects & live view (Plan 1)

### A1. Live view: live sessions grouped by project

- The always-visible sidebar shows only sessions currently in the registry (live or exited). Sessions removed via the lifecycle button are gone; historical/closed sessions never appear here.
- **Grouping by cwd:**
  - cwd equal to or under `<projectsRoot>\<name>` → group **`<name>`**.
  - cwd anywhere else (cc-cockpit itself, resumed ad-hoc sessions, …) → a single **"Other"** group.
- **Status** is shown as the per-session dot (needs-you amber / your-move blue / working green / idle grey). **Exited** shows a red **✕** instead of a dot.
- **Sort:** within a group, by attention priority `needs-you`(0) > `your-move`(1) > `working`(2) > `idle`(3) > `exited`(4). Groups are ordered by their top (lowest-number) session, so a group holding a `needs-you`/`your-move` session floats up. Ties broken by group name (`Other` always last).

### A2. Per-session lifecycle button

- On row hover, an **✕** icon-button appears at the right of the row.
- **Live** session → `confirm()` (it kills a running Claude), then kill the PTY and remove from the cockpit.
- **Exited** session → remove from the cockpit (no confirm — nothing running).
- Implemented as a WS message `remove {id}` → `registry.remove(id)`: if not exited, `pty.kill()`; delete the session; if it was `focusedId`, clear focus; broadcast `sessions`.

### A3. New session via project picker (no path typing)

- The **＋ New session** button opens a **picker modal**: lists existing projects + an inline "create new project" field.
- Pick an existing project → WS `create {cwd: <project path>}` (existing flow, unchanged).
- Create a new project → `POST /api/projects {name}` (mkdir), then `create` in it.
- The old `prompt()`-for-a-path flow is removed.

### A4. Server (Plan 1)

- **Registry** (`server/sessions.js`):
  - Constructor gains `projectsRoot`. `_public(s)` adds `project` = the derived project name, or `null` for the "Other" bucket. A pure helper `projectOf(cwd)` does the derivation.
  - `remove(id)`: kill the pty if `!exited`, `sessions.delete(id)`, clear `focusedId` if it matched, `emit('sessions')`. Idempotent (unknown id → no-op).
- **HTTP** (`server/app.js`):
  - `GET /api/projects` → `{ projects: [{ name, path }] }` — readdir the root (directories only), sorted by name. Creates the root if missing.
  - `POST /api/projects {name}` → `201 { name, path }`; `400` invalid name; `409` already exists. **Name rules:** non-empty after trim; no path separators (`/` `\`), no drive colon, no `..`, no characters illegal on Windows (`<>:"|?*` and control chars); not a reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
  - A small `server/projects.js` module holds `projectsRoot`, `listProjects()`, `createProject(name)`, `validateName(name)` — pure/testable.

---

## Part B — Discovery & resume (Plan 2)

### B1. Recent sessions

- `GET /api/recent?window=day|3d|week` → `{ window, groups: [{ cwd, project, sessions: [{ id, title, lastActivity }] }] }`.
- Scan `<claude>/projects/*/*.jsonl` (top-level only; exclude any path containing `/subagents/`). Filter by file **mtime** within the window (`day`=24h, `3d`=72h, `week`=7d). For each matched file, parse just enough to extract:
  - `id` = filename stem (the Claude session id),
  - `cwd` = first record carrying a `cwd`,
  - `title` = the `ai-title` record's content if present, else the first non-meta user message text, trimmed + truncated to ~80 chars; fallback `"(untitled)"`,
  - `lastActivity` = file mtime (ISO).
- Group by `cwd`; `project` derived as in A1 (else `null`/basename for display). Sort sessions within a group by `lastActivity` desc; groups by their most-recent session desc.
- A pure `server/recent.js` module (`listRecent(window, { claudeDir, now })`) does the scan/parse so it is testable against a fixtures dir.

### B2. Resume

- The **Resume** button opens a **modal** with window tabs (day / 3 days / week) → `GET /api/recent`. Rows grouped by folder, showing `title` + relative time. Click → WS `resume {id, cwd}`.
- WS `resume`: `registry.create(cwd, { resumeId: id })` → `spawnPty(cwd, cockpitId, { resumeId })` → `buildSpawn` prepends `--resume <id>`. Result is a new live cockpit session (its own cockpit id for hook correlation; Claude appends to the same jsonl). Hooks/state work unchanged because `CC_COCKPIT_SESSION` is independent of Claude's session id.

### B3. Server (Plan 2)

- `pty.buildSpawn`: when `opts.resumeId` is set, include `--resume <resumeId>` in the args (before `--settings`). `spawnClaude` passes it through.
- `registry.create(cwd, opts = {})` forwards `opts` to `spawnPty(cwd, id, opts)`; `index.js`'s `spawnPty` forwards `opts.resumeId` into `spawnClaude`.

---

## Testing

- **sessions.test:** `projectOf(cwd)` (under root → name; nested deeper → first segment; elsewhere → null); `remove()` on a live session kills the pty + deletes + clears focus + broadcasts; `remove()` on an exited session just deletes; `remove()` unknown id is a no-op; `_public` includes `project`.
- **projects.test:** `validateName` accept/reject table; `listProjects` over a temp root (dirs only, sorted); `createProject` makes the dir, returns path, rejects dup/invalid.
- **recent.test:** `listRecent` over a fixtures claude dir — window filter by mtime, subagents excluded, title from `ai-title` then user-message fallback, cwd extracted, grouping + sort.
- **app.test:** `GET /api/projects`, `POST /api/projects` (201 / 409 dup / 400 bad); `GET /api/recent` over a fixture dir; WS `remove` drops a session from the broadcast; WS `resume` reaches `spawnPty` with `resumeId` (fake factory records its args).
- **pty.test:** `buildSpawn` includes `--resume <id>` when `resumeId` is given, and still appends `--settings`.
- **UI:** live-verified — project grouping + sort, exited red ✕, hover remove button (live confirm / exited no-confirm), new-session picker (incl. create), resume modal with window tabs.

## Out of scope (v1)

Nested project groups (analiza/other style); rename/delete project; guarding against resuming an already-open session; a search box in the resume modal (time filter only); pagination of recents; tab colors/rename.

## Plan split

- **Plan 1 — Projects & live view:** Part A (A1–A4). Independently shippable: projects create/list, new-session picker (no path typing), live view grouped by project with sort + exited ✕, lifecycle remove button.
- **Plan 2 — Discovery & resume:** Part B (B1–B3). Builds on Plan 1's project derivation; adds recent-session discovery and `--resume` spawning.
