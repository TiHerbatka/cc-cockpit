---
name: gui-map
description: Regenerate the cc-cockpit GUI glossary + interactive visual map (docs/gui-map.md + docs/gui-map/map.html). Use after the GUI changes, or whenever you need a shared, referenceable map of the cockpit's GUI elements (every element keyed by a GUI-<AREA>-<slug> handle). Auto-discovered from author-marked durable elements (data-gui) plus interactive controls — no hand-curated manifest, no live claude, no tokens; pure data/content is intentionally excluded.
---

# /gui-map — regenerate the GUI glossary & visual map

Produces two cross-linked artifacts:
- **`docs/gui-map.md`** — the generated GUI glossary: every area/element keyed by a `GUI-<AREA>-<slug>` handle, with an auto-derived name + description. (Generated — never hand-edit; a re-run overwrites it.)
- **`docs/gui-map/map.html`** — a self-contained visual map: each captured screenshot with hotspot overlays (hover → name/description; click → jump to the glossary entry). Screenshots live in `docs/gui-map/shots/`.

It drives the **real** cockpit GUI fed by **canned fixture data** and **auto-discovers** the on-screen elements from the live DOM — durable elements are identified by an inert `data-gui` marker in the product markup, interactive controls by their stable label, and pure data/content is excluded. There is no separate hand-curated manifest; identity lives in the markup, co-located with the elements. The only product-markup footprint is those inert `data-gui` attributes (like `data-testid` — no styling or behavior keys off them); everything else it runs is dev-only tooling under this skill dir.

## How it works (the pieces, all under `.claude/skills/gui-map/`)
- `fixture-server.js` — dev launcher: imports the real `createApp` with a fake driver, serving the genuine GUI from canned data on `127.0.0.1:4488` (+ an aux server on `4489` that serves `probe.js` with CORS). Regenerates its throwaway fixture-home each run.
- `fixture-data.js` — the canned session roster (covers every sidebar group/status-dot, conversation item kinds, the floating panels, all four interaction variants, both pickers, menus, modals, error center).
- `probe.js` — browser-side helper: `window.__guiMap.capture(state)` closes overlays, arranges the named state, and **auto-discovers** the durable visible elements (elements carrying a `data-gui` marker, plus interactive controls named by a stable label); repeated structures collapse to one representative and data is excluded — deriving a handle/name/area/description + bounding rect for each.
- `build.js` — pure generator: `captures.json` → `docs/gui-map.md` + `docs/gui-map/map.html` (dedupes each element to the first state it appears in). Its unit test is `test/gui-map.test.js` (runs in `npm test`).

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
- Serve and open `docs/gui-map/map.html` over http (the Playwright MCP blocks `file://` — use a quick static server) and confirm: each state screenshot shows aligned hotspots; hover shows name + description; clicking a hotspot scrolls to its glossary entry.

## Notes
- **Auto-generated, durable-element-scoped:** the element list, handles, names, and descriptions are derived mechanically — functional, not carefully worded. **Data/content is deliberately not mapped.** Surfacing a NEW durable element means adding a `data-gui` marker in `public/` (a small inert footprint, like `data-testid`), then re-running — not just re-running.
- **Marker schema** (inert attributes in `public/`; nothing in CSS/JS keys off them): `data-gui="<permanent-slug>"` is the element's fixed identity — the `<slug>` becomes the handle tail, and repeated instances share one slug so they fold to a single entry; `data-gui-name="<Display Name>"` is an optional human name (else the slug is humanized); `data-gui-opaque` means map this element but do **not** descend into its subtree (used for the read-only preview mirror).
- To surface a **new on-screen situation** (a state the fixture doesn't yet reach), extend the fixture roster (`fixture-data.js`) + add an `arrange` case + `STATE_ORDER` entry in `probe.js`, then re-run. Within an already-captured state, an element is discovered automatically once it carries a `data-gui` marker (or is an interactive control); pure data stays excluded.
- **Re-runnable and reproducible:** the run injects a transitions-off stylesheet before capturing, so layout/visibility is frozen to final computed style and two identical runs produce **identical handle sets**. A fresh run re-screenshots and re-discovers, so the map stays current after layout/CSS/markup changes.
