# Navigation improvements — design

**Status:** built (branch `feat/nav-improvements`).

Three session/project navigation conveniences.

## A. "Open folder" in the right-click context menu

A third context-menu entry (after Quick preview, before Rename) → WS `open-folder { id }` → the server resolves the session's cwd from the registry (authoritative, not client-supplied) and launches **Windows Explorer** there. The launcher is an injectable `openInExplorer` dependency on `createApp` (default spawns `explorer.exe`, fire-and-forget since it can exit non-zero on success) so tests don't open real windows. Works for any session, live or exited.

## B. Search in the New-session and Resume modals

Each modal gets a search box that filters its list **live** (case-insensitive substring) across **project name, session title, and folder path** — exactly the fields the user listed. Implemented as a `render(filter)` closure re-run on every `input` event.

## C. New-session project list redesign

The project picker no longer is a flat vertical list. Projects are:
- **divided into last-used time bands** like the Resume modal — **Last 24h / 1–3 days / 3–7 days / Older**, plus a **Never used** band for projects with no sessions yet (so brand-new/empty projects still appear, ready to start in);
- **alphabetical within each band** (the server already returns projects sorted);
- each row shows **when the project was last used** (relative time, or "never").

"Last used" = the most recent Claude Code session activity in the project: `GET /api/projects` now returns `lastActivity` per project, computed by `recent.lastActivityByPath` (newest mtime of any top-level session transcript whose recorded cwd is inside the project; a cheap first-chunk `cwdOf` read avoids parsing whole transcripts).

## Also

`openModal` now closes on **Escape** (and cleans up its listener) — previously only the preview/context-menu closed on Escape; the New-session/Resume/Rename modals did not.

## Components / changes

- `server/app.js` — `defaultOpenInExplorer` + injectable `openInExplorer`; WS `open-folder`; `/api/projects` augmented with `lastActivity`.
- `server/recent.js` — `cwdOf` (cheap cwd read) + `lastActivityByPath`.
- `public/app.js` — context-menu "Open folder"; New-session picker rewrite (search + banded list with last-used times); Resume search; `openModal` Escape-to-close.
- `public/styles.css` — `.modal-search`, `.modal-band`, `.modal-md`, `.project-row` flex + `.proj-row-name`/`.proj-row-time`.

## Testing

- `recent.test.js` — `lastActivityByPath` returns the newest activity per path; absent for paths with no sessions.
- `app.test.js` — WS `open-folder` calls the opener with the session cwd; `/api/projects` includes `lastActivity` (and null for project with no sessions).
- Browser-verified: banded project list with times + "Never used", project search, Resume search, Open-folder entry firing, Escape closing modals.
