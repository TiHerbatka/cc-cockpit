# cc-cockpit — GUI glossary/mapping skill (design)

Date: 2026-06-29 · TODO item: I2 / TPC2 · Status: design spec (point-in-time design record; the artifacts it produces live under `features-gui-mapping/`).

## Problem

There is no shared, referenceable map of the cockpit's GUI surface. To point precisely at "that chip", "that dot", "the panel", the user and Claude need a common vocabulary keyed to stable names, plus a visual map showing where each named element is. The new `docs/reference/` covers features/mechanisms/options as prose, but it is not an element-level visual map and is not regenerated from the live GUI.

## Goal

A re-runnable skill that produces two cross-linked artifacts under the project-root `features-gui-mapping/`:

- a Markdown **glossary** of GUI areas and elements, each with a stable ID + short handle and a one-line description;
- an interactive **HTML map** — screenshots of the GUI with clickable/hoverable hotspot overlays (hover → name + description; click → jump to the glossary entry).

The skill drives the real GUI (no mockups), regenerates the visuals on each run, and its OUTPUT contains no code/CSS/JS mapping (no selectors, file paths, or function names) — though the skill reads the DOM internally to locate elements.

## Decisions (from the approved brainstorm)

1. **Seeding: an isolated server fixture mode.** A flag-gated mode (`COCKPIT_FIXTURE=1`) launches the cockpit on a dedicated port with a handful of canned fake sessions, reusing the registry's existing injected-`spawnDriver` seam (confirmed in `server/sessions.js`). No real `claude`, no subscription cost, deterministic and repeatable. Chosen over real sessions (slow, costly, non-deterministic) and over Playwright-injecting render fragments (fragile, bypasses the real sidebar/header/modal wiring). Production code paths are untouched — the fixture is its own module plus a launch flag.
2. **Hotspots from the live DOM.** At capture time Playwright reads each element's `getBoundingClientRect()`, so overlays always align with the actual rendered layout. This is what makes the skill genuinely re-runnable: a re-run produces a fresh screenshot with correctly-repositioned hotspots, and any manifest element whose selector matches nothing is reported as drift.
3. **`GUI-<AREA>-<slug>` handle namespace, cross-linked to `FEAT-`.** A new element-level namespace (areas: SIDEBAR, HEADER, CONV, COMPOSE, PANEL, MODAL, PICKER), distinct from the capability-level `FEAT-` handles in `docs/reference/features.md`. Each element entry may carry an optional "part of `FEAT-…`" cross-reference — complementary, not 1:1.
4. **Semi-manual automation.** A curated `manifest.json` holds the human-meaningful content (handle, name, area, description, the internal selector, optional `FEAT-` ref). The screenshots, hotspot positions, and HTML are fully auto-regenerated each run. Names/descriptions are curated because they cannot be auto-derived meaningfully; everything visual is automated.

## Components (each small, single-responsibility)

- `features-gui-mapping/manifest.json` — the curated source of truth. An array of element entries `{ handle, name, area, description, selector, state, featRef? }` plus area definitions. The `selector` is skill-internal (used only to locate the element for measurement); it never appears in the output.
- `server/fixture.js` — builds canned fake sessions (across projects + a temp session, covering the conversation item types user/assistant/thinking/tool/todos) via a fake `spawnDriver` that emits the canned records, and can surface a canned interaction request (for the modal state). Flag-gated; production untouched. A `npm run fixture` script (or `COCKPIT_FIXTURE=1 npm start`) launches it.
- `features-gui-mapping/build.js` — the generator: pure functions `manifestToGlossary(manifest)` → `glossary.md` and `buildMap(manifest, captures, shots)` → `map.html`. No browser, no I/O beyond reading inputs and writing the two artifacts; unit-testable with `node --test`.
- The **skill** (`.claude/skills/gui-map/`) — the agent-run orchestration: launch fixture mode → drive the project Playwright MCP to arrange each state, screenshot (into `features-gui-mapping/shots/`), and capture the manifest elements' bounding rects → run `build.js` → report drift. Re-invoking the skill regenerates everything.

## Seeded states captured (YAGNI)

- **S1 main** — populated sidebar (grouped sessions + state dots) + a focused session's conversation (all item types + the waiting spinner state) + the header (chips, selects, buttons, the ⚠ error toggle).
- **S2 panel** — a floating panel open (Topics, showing code/name/summary).
- **S3 modal** — the blocking interaction modal (permission variant), via a fixture-seeded interaction request.
- **S4 picker** — the New-session project picker (time bands + create field).

Resume modal / quick-preview / context-menu are added only if cheap; not required for v1.

## Output format

- `glossary.md` — grouped by area; each entry: `### GUI-<AREA>-<slug> — <Name>`, a one-line description, and an optional "Part of: `FEAT-…`" cross-link. No selectors/paths/code.
- `map.html` — a self-contained page: each captured state's screenshot with absolutely-positioned hotspot `<div>`s at the captured rects; hover shows the element's name + description; clicking a hotspot highlights and scrolls to that element's entry in an embedded glossary side-panel within the same page (so `map.html` is browsable standalone, with no dependency on `glossary.md`). `glossary.md` remains the separate plain-markdown reference. Pure static HTML + inline JS, browsable from disk.

## Exclusions / single-source

The OUTPUT (glossary.md + the visible map) names elements by role only — no CSS selectors, DOM ids, file paths, or function names. Selectors live solely in `manifest.json` as skill-internal plumbing. The glossary does not duplicate `docs/reference/` prose; it cross-links by handle.

## Testing

- `build.js` pure functions get `node --test` coverage: a fake manifest + fake captured rects → expected glossary markdown and expected hotspot HTML positioning.
- `server/fixture.js` seeding is testable by constructing the registry with the fake driver and asserting the seeded session list/conversation (same DI pattern as the existing tests).
- The final `map.html` is browser-verified (open it, confirm hotspots align and links work).
- No real `claude` anywhere; the fixture mode keeps the whole pipeline deterministic.

## Coupling to docs/reference (I1)

`docs/reference/README.md` already reserves a link to `features-gui-mapping/`. The glossary's `GUI-` element handles and the `FEAT-` capability handles are complementary: `FEAT-` says what a capability does; `GUI-` says where its elements are and what they're called. The optional `featRef` on each element ties them together.

## Non-goals / YAGNI

- No exhaustive every-permutation state capture — the four states above cover the surface.
- No real-session or live-data capture (fixture only).
- No editing/authoring UI for the manifest — it is hand-maintained markdown/JSON.
- The fixture mode is for the map skill and manual demo/testing; it is not a product feature and stays flag-gated.
