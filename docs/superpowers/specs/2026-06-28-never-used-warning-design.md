# "Never used" warning chip (New-session picker) — design

**Status:** planned (branch `feat/agent-sdk-rearch`). TODO item A3.

A warning affordance in the New-session picker that surfaces cockpit projects which have never recorded any session activity. Such projects are currently invisible in the picker's default view, and a project created but never run is also a plausible orphan/health signal.

## Purpose

Two concerns in one affordance:
- **Visibility** — the New-session picker's default view shows three recent time bands (Last 24h / 1–3d / 3–7d) and skips any project whose `lastActivity` is null; a never-used project only appears after toggling "Older than 7 days". The chip makes never-used projects discoverable without that toggle.
- **Health** — a project created but never used can indicate a session that never actually ran (the no-transcript failure class), so the affordance carries a warning tone rather than a neutral one.

## Scope

The chip lives only in the New-session picker, **Cockpit-projects scope**. The Discovered-folders scope is built from sessions that ran, so it has no never-used items; the chip is absent there and is removed on a scope switch. The Resume modal is explicitly out of scope: it lists sessions that already have transcripts, so "never used" has no meaning there (decided during brainstorming).

## Behavior

- **Never-used set** — the projects already loaded from `GET /api/projects` whose `lastActivity` is null, sorted by name. Computed client-side; no server change.
- **Chip** — a small amber chip reading `⚠ N never used`, placed in the existing toolbar row after the "Older than 7 days" toggle. Rendered only when the scope is cockpit and N > 0. Native tooltip: "N projects created but never used — click to list".
- **Popover** — clicking the chip opens a popover anchored under it, listing each never-used project as a button (project name). Clicking a project invokes the picker's existing start-in-folder path (spawns a session in that project's folder) and closes the modal — identical to clicking any project row.
- **Dismissal** — the popover closes on chip re-click, outside-click, Escape, or a scope switch.
- **Count source** — the chip count and popover list reflect the full never-used set and ignore the search box; the chip is a standing signal, not a filtered result.

## Components / changes

- `public/app.js` — in the New-session picker (`openNewSessionPicker`): compute the never-used set; render the chip in the toolbar (cockpit scope, N > 0); a click-to-toggle popover whose rows start a session on click; wire dismissal into the existing scope-switch and Escape handling.
- `public/styles.css` — `.never-used-chip` (amber warning accent over the existing muted modal aesthetic) and `.never-used-popover` (anchored list).

No server-side changes: `lastActivity` is already provided by `/api/projects`.

## Testing

Pure client view code with no server logic, so it follows the project's browser-verification convention; no new server unit tests are added because nothing server-side changes:
- the chip shows the correct count in cockpit scope and is absent when there are no never-used projects;
- clicking the chip lists exactly the never-used projects;
- clicking a listed project starts a session in that folder and closes the modal;
- the chip and popover are absent in the Discovered-folders scope and disappear on a scope switch.

## Out of scope

- The Resume modal (no meaningful never-used notion there).
- Deleting or cleaning up never-used projects (the chip only surfaces them and lets you start one).
- Orphan detection beyond "no recorded activity" (e.g. inspecting transcript depth).
