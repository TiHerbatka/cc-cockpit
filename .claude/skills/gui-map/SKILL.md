---
name: gui-map
description: Regenerate the cc-cockpit GUI glossary + interactive visual map (docs/gui-map.md + docs/gui-map/map.html). Use after the GUI changes, or whenever you need a shared, referenceable map of the cockpit's GUI elements (every element keyed by a GUI-<AREA>-<slug> handle). Auto-discovered from the cockpit's existing markup (interactive controls + a skill-side curated allowlist of durable id/classes) — zero product-code footprint, no hand-curated manifest, no live claude, no tokens; pure data/content is intentionally excluded.
---

# /gui-map — regenerate the GUI glossary & visual map

Produces two cross-linked artifacts:
- **`docs/gui-map.md`** — the generated GUI glossary: every area/element keyed by a `GUI-<AREA>-<slug>` handle, with an auto-derived name + description. (Generated — never hand-edit; a re-run overwrites it.)
- **`docs/gui-map/map.html`** — a self-contained visual map: each captured screenshot with hotspot overlays (hover → name/description; click → jump to the glossary entry). Screenshots live in `docs/gui-map/shots/`.

It drives the **real** cockpit GUI fed by **canned fixture data** and **auto-discovers** the on-screen elements from the live DOM — durable elements are identified from the cockpit's **existing** markup (a meaningful `id`/`class`/structure resolved through a skill-side curated allowlist), interactive controls by their stable label, and pure data/content is excluded. There is no hand-curated manifest and **zero product-code footprint**: the cockpit carries no mapping attributes — identity lives entirely in this skill (the allowlist in `probe.js`). Everything it runs is dev-only tooling under this skill dir.

## How it works (the pieces, all under `.claude/skills/gui-map/`)
- `fixture-server.js` — dev launcher: imports the real `createApp` with a fake driver, serving the genuine GUI from canned data on `127.0.0.1:4488` (+ an aux server on `4489` that serves `probe.js` with CORS). Regenerates its throwaway fixture-home each run.
- `fixture-data.js` — the canned session roster (covers every sidebar group/status-dot, conversation item kinds, the floating panels, all four interaction variants, both pickers, menus, modals, error center).
- `probe.js` — browser-side helper: `window.__guiMap.capture(state)` closes overlays, arranges the named state, and **auto-discovers** the durable visible elements (elements matched by the skill-side allowlist, plus interactive controls named by a stable label); repeated structures collapse to one representative and data is excluded — deriving a handle/name/area/description + bounding rect for each. **The allowlist (durable `id`/`class`/structural selector → stable slug + name) lives in this file — that is where a new durable element is registered, never in `public/`.**
- `build.js` — pure generator: `captures.json` (+ the captured screenshots) → `docs/gui-map.md` + `docs/gui-map/map.html`, **inlining each screenshot as a base64 data URI so `map.html` is a single self-contained file openable via `file://`** (dedupes each element to the first state it appears in). Its unit test is `test/gui-map.test.js` (runs in `npm test`).

## Prerequisites
- The project Playwright MCP (`.mcp.json`, output dir `.playwright-mcp`). Use its `browser_*` tools.
- Node deps installed (`npm install`). No extra packages.

## Steps

1. **Start a fresh fixture.** Kill anything already on 4488, then launch in the background:
   `node .claude/skills/gui-map/fixture-server.js`
   Wait for `gui-map fixture listening on http://127.0.0.1:4488`.
   A fresh process matters for clean screenshots. (The capture order — `main` first, interactions last — is now kept only so the `main` screenshot shows the full variety of status dots before the interaction captures focus/clear any; the handle set itself no longer depends on it, since all status values fold to one `status-icon` representative.)

2. **Size + open the browser.** `browser_resize` to 1440×900, then `browser_navigate` to `http://127.0.0.1:4488`.

3. **Inject the probe** with one `browser_evaluate` (no manifest to fetch anymore):
   ```js
   async () => {
     await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'http://127.0.0.1:4489/probe.js'; s.onload = res; s.onerror = () => rej(new Error('probe load failed')); document.head.appendChild(s); });
     return { ready: !!window.__guiMap, states: window.__guiMap.STATE_ORDER.length };
   }
   ```
   Expect `ready:true`.

4. **Capture every state, in order.** Iterate `window.__guiMap.STATE_ORDER` (it encodes the required ordering — `main` first, interactions last). For each `state`:
   a. `browser_evaluate` → `() => window.__guiMap.capture('<state>')`; the return `{discovered}` is the count of elements found in that state.
   b. `browser_take_screenshot` with `filename: "docs/gui-map/shots/<state>.png"` (PNG, default css scale so pixels match the discovered rects). Create `docs/gui-map/shots/` first if needed.

5. **Save the captures.** `browser_evaluate` → `() => window.__captures`, and write the returned JSON to `.claude/skills/gui-map/captures.json`.

6. **Generate the artifacts.** Run `node .claude/skills/gui-map/build.js`. It writes `docs/gui-map.md` + `docs/gui-map/map.html` and prints the element/area counts.

7. **Stop the fixture** (kill the background process).

8. **Report** the counts to the user (elements per area / total). Because discovery is fully automatic, there is no manual drift step: a re-run simply reflects whatever the live GUI now contains — new elements appear, removed ones drop out.

## Verifying the result
- `docs/gui-map.md` lists all areas/elements; it contains **no** selectors/paths/code, and **no data/content** (no session names, status strings, message text, counts, or timestamps — only durable element kinds).
- **Reproducibility (recommended):** before stopping the fixture, capture every state a second time and diff the two `window.__captures` handle lists — they must be **identical** (the transitions-off freeze + marker-based identity make the run deterministic). Any difference signals a residual non-determinism to fix, not ship.
- Open `docs/gui-map/map.html` directly — it is a **self-contained local file** (every screenshot inlined as a base64 data URI), so `file://` works with no static server. Confirm: each state screenshot shows aligned hotspots; hover shows name + description; clicking a hotspot scrolls to its glossary entry. (The Playwright MCP still can't load `file://`; to confirm inside Playwright, serve the file over a throwaway http server — but a human/OS browser opens it directly.)

## Notes
- **Auto-generated, durable-element-scoped:** the element list, handles, names, and descriptions are derived mechanically — functional, not carefully worded. **Data/content is deliberately not mapped.** Surfacing a NEW durable element means adding an **allowlist entry in `probe.js`** (durable `id`/`class`/structural selector → permanent slug + name), then re-running — never a marker in `public/`; the cockpit stays footprint-free.
- **Allowlist schema** (`ALLOWLIST` in `probe.js` — skill-side, the cockpit has no mapping attributes): each entry is `{ sel, slug, name, opaque?, area? }`. `el.matches(sel)` decides a hit and the **first** matching entry (list order) wins; `slug` becomes the handle tail (and repeated instances sharing one slug fold to a single entry); `name` is the display name; `area` constrains an entry to one region so a class shared across regions can't leak a handle into the wrong area; `opaque: true` means map this element but do **not** descend into its subtree (used for the read-only preview mirror). A hit OVERRIDES auto-control-labeling, so a control whose visible text is volatile data (a project row, mode row, ctx item, interaction option) gets a stable slug instead of its text.
- To surface a **new on-screen situation** (a state the fixture doesn't yet reach), extend the fixture roster (`fixture-data.js`) + add an `arrange` case + `STATE_ORDER` entry in `probe.js`, then re-run. Within an already-captured state, an element is discovered automatically once it is an interactive control or you add an allowlist entry for it; pure data stays excluded.
- **Re-runnable and reproducible:** the run injects a transitions-off stylesheet before capturing, so layout/visibility is frozen to final computed style and two identical runs produce **identical handle sets**. A fresh run re-screenshots and re-discovers, so the map stays current after layout/CSS/markup changes.
