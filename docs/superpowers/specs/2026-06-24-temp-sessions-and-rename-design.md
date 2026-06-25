# Temporary sessions + rename — design

**Status:** building (branch `feat/temp-sessions-and-rename`).

Two related session-identity features.

## TPC5 — Temporary sessions

One-off sessions not tied to a project. "Temporary" is purely a **location**: a dedicated temp directory `…\cockpit\_temporary-sessions` (a sibling of project folders, inside the projects root). A session is temporary iff its cwd lives under that directory — sidebar grouping and resume listing are *derived* from that, no extra persisted state. Mirrors how projects already work.

- **Storage:** one temp root; each temp session gets its **own auto-created subfolder** (timestamp-named, e.g. `2026-06-24_153012`) so each one-off's files are isolated and individually resumable. The temp root is **excluded** from the project picker.
- **Create:** the New-session modal gets a **"+ Temporary session"** action → WS `create-temp` → server creates the subfolder and spawns there.
- **Sidebar:** temp sessions form a distinct **"Temporary"** group (sorted below projects, above/with "Other").
- **Resume:** temp sessions are listed in a separate **"Temporary"** sub-section within each time band, kept apart from project groups.
- **Naming:** temp sessions are labeled by Claude Code's auto `aiTitle`. In Resume that is free (we already read `aiTitle`). For the live sidebar, the server reads the title from the session's transcript and updates the label — so a temp session shows its **timestamp folder name as a placeholder** until CC generates a title, then switches to the title. No auto-deletion (persist + resume like any session).

## TPC6 — Rename any session

A user-set display name for **any** session, via the right-click context menu (reuses the TPC4 menu).

- **Interaction:** context menu → **Rename** → a small modal with the current name prefilled → WS `rename` → sets a custom label.
- **Precedence of displayed label:** `customName` (rename) > `autoTitle` (CC aiTitle, temp) > `label` (cwd basename / default).
- **Scope:** in-memory only (consistent with the cockpit not persisting sessions across restart) — a rename is lost on server restart or when the session is later resumed. Persisting across resume would require tracking the CC session id; deferred.

## Components / changes

- `server/projects.js` — `TEMP_DIR_NAME`, `tempRoot()`, `isTemp()`, `createTempSession()`; `listProjects` excludes the temp dir.
- `server/recent.js` — `titleForCwd(cwd, {claudeDir})` returns the CC `aiTitle` for the session whose recorded cwd matches (path-normalized), or null.
- `server/sessions.js` — session gains `autoTitle`/`customName`; `_public` exposes `temp` (and `project=null` when temp) and a computed `label`; `setAutoTitle(id,title)`, `rename(id,name)`.
- `server/app.js` — WS `create-temp` and `rename`; `/api/recent` tags each group `temp`; a low-frequency (`unref`'d) poll fills temp sessions' `autoTitle` from `titleForCwd`.
- `public/app.js` — sidebar "Temporary" group; "+ Temporary session" in the picker; Resume "Temporary" sub-section; context-menu "Rename" + rename modal.

## Testing

- `projects.test.js` — `createTempSession` makes a subfolder under the temp root; `listProjects` excludes it; `isTemp` true/false.
- `recent.test.js` — `titleForCwd` returns the matching session's `aiTitle`.
- `sessions.test.js` — temp session `_public` has `temp:true`, `project:null`; `setAutoTitle` updates the label but `rename` (customName) wins.
- `app.test.js` — WS `create-temp` yields a `temp:true` session; WS `rename` changes the broadcast label; `/api/recent` tags temp groups.
- Browser-verified (fake-pty): Temporary sidebar group, "+ Temporary session", Resume Temporary section, rename via context menu.

## Non-goals (now)

Auto-deletion / cleanup of temp sessions; persisting a rename across restart/resume; renaming the underlying CC session title.
