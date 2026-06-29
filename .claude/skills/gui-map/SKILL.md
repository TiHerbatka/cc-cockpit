---
name: gui-map
description: Regenerate the cc-cockpit GUI glossary + interactive visual map under features-gui-mapping/ (glossary.md + map.html + shots/). Use after the GUI changes, or whenever you need a shared, referenceable map of the cockpit's GUI elements (areas, features, every element with a stable GUI-<AREA>-<slug> handle). Drives the real GUI via canned fixture data — no live claude, no tokens.
---

# /gui-map — regenerate the GUI glossary & visual map

Produces two cross-linked artifacts under `features-gui-mapping/`:
- **`glossary.md`** — every GUI area/element with a stable `GUI-<AREA>-<slug>` handle and a role-level description (no code/selectors).
- **`map.html`** — a self-contained page: each captured screenshot with hotspot overlays (hover → name/description; click → jump to the glossary entry).

It drives the **real** cockpit GUI fed by **canned fixture data** (a dev-only launcher that reuses the app's `createApp` with a fake driver). Nothing here is product code.

## How it works (the pieces)
- `features-gui-mapping/manifest.json` — curated source of truth: areas, capture states, and every element `{handle, name, area, state, selector, description, featRef}`. The `selector` is used only to locate an element for measurement and is **never** emitted into the output.
- `features-gui-mapping/tooling/fixture-server.js` — the dev launcher (port 4488; aux probe/manifest server on 4489).
- `features-gui-mapping/tooling/probe.js` — browser-side helper: `window.__guiMap.capture(state)` arranges a state and measures its elements' bounding rects.
- `features-gui-mapping/build.js` — pure generator: manifest + `captures.json` → `glossary.md` + `map.html`, plus a drift report.

## Prerequisites
- The project Playwright MCP (`.mcp.json`, output dir `.playwright-mcp`). Use its `browser_*` tools.
- Node deps installed (`npm install`). No extra packages.

## Steps

1. **Start a fresh fixture.** Kill anything already on 4488, then launch in the background:
   `node features-gui-mapping/tooling/fixture-server.js`
   Wait for the line `gui-map fixture listening on http://127.0.0.1:4488`.
   A fresh process matters: the `main` capture needs all five sidebar status dots, and focusing a `needs-you` session (which the interaction captures do) permanently clears its dot. The capture order already handles this — but only on a clean server.

2. **Size + open the browser.** `browser_resize` to the manifest's viewport (1440×900), then `browser_navigate` to `http://127.0.0.1:4488`.

3. **Inject the probe + manifest** with one `browser_evaluate`:
   ```js
   async () => {
     await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'http://127.0.0.1:4489/probe.js'; s.onload = res; s.onerror = () => rej(new Error('probe load failed')); document.head.appendChild(s); });
     window.__M = await (await fetch('http://127.0.0.1:4489/manifest.json')).json();
     return { ready: !!window.__guiMap, states: window.__guiMap.STATE_ORDER.length, elements: window.__M.elements.length };
   }
   ```
   Expect `ready:true`.

4. **Capture every state, in order.** Iterate `window.__guiMap.STATE_ORDER` (it encodes the required ordering — `main` first, interactions last). For each `state`:
   a. `browser_evaluate` → `() => window.__guiMap.capture('<state>')`. The return `{captured, missing}` should have an empty `missing`. If `missing` is non-empty, note it (it becomes drift) and continue.
   b. `browser_take_screenshot` with `filename: "features-gui-mapping/shots/<state>.png"` (PNG, default css scale so pixels match the measured rects). Create `features-gui-mapping/shots/` first if needed.

5. **Save the captures.** `browser_evaluate` → `() => window.__captures`, and write the returned JSON to `features-gui-mapping/captures.json`.

6. **Generate the artifacts.** Run `node features-gui-mapping/build.js`. It writes `glossary.md` + `map.html` and prints a drift report.

7. **Stop the fixture** (kill the background process).

8. **Report** the drift summary to the user. Drift = a manifest element whose selector matched nothing this run (renamed/removed in the GUI). Resolve each by updating the element's `selector` (or removing the entry) in `manifest.json`, then re-run.

## Verifying the result
- `glossary.md` lists all areas/elements; it contains **no** selectors/paths/code.
- Open `features-gui-mapping/map.html` from disk: each state screenshot shows aligned hotspots; hovering shows name + description; clicking a hotspot scrolls to its glossary entry.
- The drift report is empty.

## Notes
- The fixture's canned roster (in `tooling/fixture-data.js`) covers every sidebar group, all five status dots, every conversation item kind, all three floating panels, all four interaction variants, both pickers, and the menus/modals/error-center. To map a **new** GUI element: add it to `manifest.json` (and, if it needs a new on-screen situation, extend the fixture roster + `probe.js` arrange step), then re-run.
- Re-runnable by design: a fresh run re-screenshots and re-measures, so the map stays correct after layout/CSS changes.
