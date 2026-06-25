# Session info panels — usage, topics, native todos, doc buttons — design

**Status:** spec (not yet built). Extends the GUI-mode work. Build order prioritizes **topics (B)** and **native todos (D)** per the user.

## Problem

The GUI session view should surface read-only session information the user currently can only get from the terminal:
- **A. Usage limits** — context %, 5-hour %, and 7-day %.
- **B. Topic tracking** *(priority)* — the assistant's per-session topics (the `~/.claude/topics/<id>.json` convention), foldable to see each summary.
- **C. Session files** — one-click open of the session's `local-docs.md` and `TODO.md`.
- **D. Native Claude todos** *(priority)* — Claude's own TodoWrite/Task todo list (NOT the `/todo` project file), visible with a hide/show toggle for active sessions.

## Findings (data availability)

- **Usage:** Claude feeds the statusline `context_window.used_percentage`, `rate_limits.five_hour.{used_percentage,resets_at}`, and `rate_limits.seven_day.used_percentage`. So the GUI can show **ctx %, 5h % + time-remaining + reset-clock, 7d %** by parsing the session's footer (the statusline format is known). **`7d $` and the `7d` reset date are NOT available** — neither the statusline output nor the JSON it receives exposes them; surfacing them would require adding them to `statusline-command.ps1` first. The GUI shows what's available and omits the rest.
- **Topics:** `~/.claude/topics/<ccSessionId>.json` = `{ session_id, topics: [{ code, name, status, summary }] }` (`status` ∈ `active|parked|resolved`). Structured — ideal for a foldable list. The cockpit knows each session's `ccSessionId`.
- **Native todos:** already normalized into the GUI model's `status.todos` (`[{content, status}]`) from both `TodoWrite` and the `TaskCreate/TaskUpdate` system — already broadcast to the GUI via `gui-snapshot`.
- **Files:** `<cwd>/local-docs.md` and `<cwd>/TODO.md`.

## Design

### A — Usage readout (footer parse, client-side)
A compact **usage chip** in the session header showing `ctx 4% · 5h 39% (1h6m left · resets 14:40) · 7d 26%`, color-coded by threshold (green <60, yellow <85, red ≥85 — matching the statusline). Parsed from the live terminal footer (same mechanism as the mode chip: read the xterm grid bottom rows). A pure `parseUsage(footerText)` function (unit-tested) extracts the values. `7d $` / `7d` reset are omitted (not available).

### B — Topics panel (priority; server-broadcast + GUI foldable list)
The cockpit reads `~/.claude/topics/<ccSessionId>.json` for each live session on a low-frequency poll (like the temp-title poll) and broadcasts the topics (a new `topics` field on the session, or a dedicated message). The GUI renders a **collapsible "Topics (N)" panel** in the GUI pane:
- One row per topic: `CODE · name` + a status dot (**active ●** green, **parked ◐** dimmed). Resolved hidden by default.
- **Click a row to fold/unfold its summary.**
- **Improvements (accepted):** a **show-resolved** toggle; status-colored dots; a count badge; **click the code to copy it**; live updates as the session edits topics.
- Purely additive: missing/empty/malformed file ⇒ panel shows "No topics".

### C — Doc buttons (OS default app)
Two buttons in the session view — **"Local docs"** and **"TODO"** — that open `<cwd>/local-docs.md` / `<cwd>/TODO.md` with the **OS default app** (`start`, via the same injectable opener pattern as "Open folder"). A new WS message `open-file {id, which: 'docs'|'todo'}`; the server resolves the path from the session's cwd and opens it. If the file doesn't exist, the server replies with an `error` (the GUI surfaces it) rather than creating it.

### D — Native todos panel (priority; renders existing model data)
A **collapsible "Todos (done/total)" panel** in the GUI pane, rendered from the existing `status.todos`, shown for active sessions. Each item: a status glyph (✓ completed / ▸ in-progress / ○ pending) + its content. **Hide/show toggle** (collapsed/expanded), remembered in client state. This reuses data already in `gui-snapshot` — no new server work; it's a dedicated, toggleable rendering distinct from the existing one-line "todos n/m" in the status strip (which becomes the panel's header/toggle).

### Layout
- **Header** (always visible): usage chip (A) + the Local docs / TODO buttons (C), alongside the existing mode chip, interrupt, and GUI/Terminal switch. If the header gets crowded, the doc buttons collapse into a small "⋯" menu.
- **GUI pane** (top, above the conversation log): the **Topics** panel (B) and **Todos** panel (D) as stacked collapsible sections, each with a header showing its count and a fold/unfold caret.

## Components / changes

- `public/usageparse.js` *(new)* — pure `parseUsage(footerText) -> { ctx, fiveHour:{pct,rel,reset}, sevenDay:{pct} } | null`. Dual-exported, unit-tested (like `modeparse.js`).
- `public/app.js` / `public/gui.js` / `public/styles.css` — usage chip (A, footer read like the mode chip); Topics panel (B); Todos panel (D); doc buttons (C) wiring.
- `server/app.js` — Topics poll + broadcast (B); `open-file` WS handler (C, reuses the injectable opener).
- `server/sessions.js` — expose `topics` on the public session (B); a `setTopics(id, topics)` updater (emits `sessions`), fed by the poll.
- `server/topics.js` *(new)* — pure-ish `readTopics(ccSessionId, {claudeDir, fs}) -> topics[]` (reads + parses the file; `[]` on any error). Unit-tested.
- `server/app.js` opener — extend `defaultOpenInExplorer` usage to also open a file (`start "" <file>` / `explorer <file>`); keep injectable for tests.

## Testing

- **Unit:** `parseUsage` (footer → usage, incl. missing segments); `topics.readTopics` (file → topics, incl. missing/malformed → `[]`); server `open-file` path resolution + injectable opener called with the right path; `setTopics` broadcast.
- **Browser-verified:** usage chip renders + updates; topics panel folds/unfolds summaries, show-resolved toggle, copy-code; todos panel toggles + reflects live todo changes; doc buttons open the files (and error on missing).

## Non-goals

- `7d $` and `7d` reset date (not exposed by the statusline / Claude's statusline JSON).
- Editing topics or todos from the GUI (read-only display).
- Rendering the doc/TODO files inside the cockpit (C opens them in the OS default app).
- The `/todo` project-file view (D is Claude's native TodoWrite/Task todos; the `TODO.md` file is only the C "open" button).
