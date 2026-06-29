---
name: gui-map
description: Regenerate the cc-cockpit GUI glossary + interactive visual map (docs/gui-map.md + docs/gui-map/map.html). Use after the GUI changes, or whenever you need a shared, referenceable map of the cockpit's GUI elements (every element keyed by a GUI-<AREA>-<slug> handle). Auto-discovers elements straight from the live GUI — no hand-curated manifest, no live claude, no tokens.
---

# /gui-map — regenerate the GUI glossary & visual map

Produces two cross-linked artifacts:
- **`docs/gui-map.md`** — the generated GUI glossary: every area/element keyed by a `GUI-<AREA>-<slug>` handle, with an auto-derived name + description. (Generated — never hand-edit; a re-run overwrites it.)
- **`docs/gui-map/map.html`** — a self-contained visual map: each captured screenshot with hotspot overlays (hover → name/description; click → jump to the glossary entry). Screenshots live in `docs/gui-map/shots/`.

It drives the **real** cockpit GUI fed by **canned fixture data** and **auto-discovers** the on-screen elements from the live DOM — there is no hand-curated manifest. Everything it runs is dev-only tooling under this skill dir; nothing ships into the product.

## How it works (the pieces, all under `.claude/skills/gui-map/`)
- `fixture-server.js` — dev launcher: imports the real `createApp` with a fake driver, serving the genuine GUI from canned data on `127.0.0.1:4488` (+ an aux server on `4489` that serves `probe.js` with CORS). Regenerates its throwaway fixture-home each run.
- `fixture-data.js` — the canned session roster (covers every sidebar group/status-dot, conversation item kinds, the floating panels, all four interaction variants, both pickers, menus, modals, error center).
- `probe.js` — browser-side helper: `window.__guiMap.capture(state)` closes overlays, arranges the named state, and **auto-discovers** the significant visible elements (interactive / id'd / titled / labeled-leaf), deriving a handle/name/area/description + bounding rect for each.
- `build.js` — pure generator: `captures.json` → `docs/gui-map.md` + `docs/gui-map/map.html` (dedupes each element to the first state it appears in). Its unit test is `test/gui-map.test.js` (runs in `npm test`).

## Prerequisites
- The project Playwright MCP (`.mcp.json`, output dir `.playwright-mcp`). Use its `browser_*` tools.
- Node deps installed (`npm install`). No extra packages.

## Steps

1. **Start a fresh fixture.** Kill anything already on 4488, then launch in the background:
   `node .claude/skills/gui-map/fixture-server.js`
   Wait for `gui-map fixture listening on http://127.0.0.1:4488`.
   A fresh process matters: the `main` capture needs all five sidebar status dots, and focusing a `needs-you` session (which the interaction captures do) permanently clears its dot. The capture order already handles this — but only on a clean server.

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
- `docs/gui-map.md` lists all areas/elements; it contains **no** selectors/paths/code.
- Serve and open `docs/gui-map/map.html` over http (the Playwright MCP blocks `file://` — use a quick static server) and confirm: each state screenshot shows aligned hotspots; hover shows name + description; clicking a hotspot scrolls to its glossary entry.

## Notes
- **Fully auto-generated (A10):** the element list, handles, names, and descriptions are derived mechanically from the DOM — they are functional, not carefully worded. Class-only decorative elements without an id/title/short-text may not be captured; that is the accepted trade-off of zero hand-maintenance.
- To surface a **new on-screen situation** (a state the fixture doesn't yet reach), extend the fixture roster (`fixture-data.js`) + add an `arrange` case + `STATE_ORDER` entry in `probe.js`, then re-run. Individual elements within an already-captured state need no manual step — they are discovered automatically.
- Re-runnable by design: a fresh run re-screenshots and re-discovers, so the map stays current after layout/CSS/markup changes.
