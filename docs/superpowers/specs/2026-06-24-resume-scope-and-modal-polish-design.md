# Resume scope switch + temp name format + uniform modals — design

**Status:** built (branch `feat/resume-scope-and-modal-polish`).

## A. Resume modal — 3-way scope switch

A segmented control at the top of the Resume modal: **Global discovery / Cockpit / Temporary**.
- **Global** — every session on the machine (the existing behaviour; includes legacy CC sessions).
- **Cockpit** — only sessions whose cwd is under the cockpit projects root but not temp.
- **Temporary** — only temp sessions.

`/api/recent` now tags each group `temp` and `cockpit` (`cockpit = isUnderProjectsRoot && !temp`, via `projects.isUnderProjectsRoot`). The client filters the flattened sessions by the active scope before bucketing into the time-band columns. Search composes with the scope.

## B. Temp folder name format

`createTempSession` now names the subfolder `YYYY-MM-DD HH-MM-SS` (was `YYYY-MM-DD_HHMMSS`). This is only the on-disk/placeholder name; the displayed label still becomes Claude Code's `aiTitle` once generated.

## C. Uniform interactive-modal size

All interactive modals — **New session, Resume, Rename** — now share one fixed size (`min(94vw, 1040px) x min(82vh, 760px)`), regardless of content; inner regions (`.modal-list`, `.resume-col-list`) scroll when content overflows. The per-modal `modal-md`/`modal-wide` width classes were removed. The Quick-preview modal is intentionally separate (it sizes to the session grid). Also: `openModal` now closes on **Escape**.

## Investigated, not a code change: cockpit sessions missing from discovery

Reported as "Resume doesn't list cockpit sessions" and "new project shows 'never used' though I just used it". Root cause (confirmed by reproducing a cockpit spawn in a fresh empty folder): Claude Code shows its **workspace-trust prompt** ("Is this a project you created or one you trust? 1. Yes / 2. No") in any brand-new folder and **writes no transcript until it's accepted** — so untrusted cockpit/temp folders produce nothing for discovery to find. The discovery code itself is correct. **Decision: leave the trust prompt as-is** (user accepts "1, Enter" once per new folder); no auto-trust / config editing. Trust is stored at `~/.claude.json → projects[path].hasTrustDialogAccepted`; there is no narrow CLI flag to pre-trust without disabling all permissions.

## Components / changes

- `server/projects.js` — temp name format; `isUnderProjectsRoot`.
- `server/app.js` — `/api/recent` tags `cockpit` alongside `temp`.
- `public/app.js` — Resume scope switch + scope-aware render; drop the per-modal width classes; (Escape-close already added previously).
- `public/styles.css` — uniform `.modal` size + inner scroll; `.scope-switch`; removed `modal-md`/`modal-wide`.

## Testing

- `projects.test.js` — temp name format regex; `isUnderProjectsRoot` true/false.
- `app.test.js` — `/api/recent` classifies temp / cockpit / neither.
- Browser-verified: scope filtering (Global→all, Cockpit→cockpit only, Temporary→temp only) and all three interactive modals measuring an identical 1040×722.
