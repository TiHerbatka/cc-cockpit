// .claude/skills/gui-map/build.js
// DEV-ONLY generator for the /gui-map skill. Pure functions (no I/O) plus a thin
// CLI. Input is the auto-discovered captures (no hand-curated manifest):
//   capturesByState = { [state]: { title, viewport:{width,height}, elements:[
//     { handle, name, area, description, rect:{x,y,width,height} } ] } }
// Output:
//   docs/gui-map.md            — the generated GUI glossary (GUI- handles)
//   docs/gui-map/map.html      — the interactive visual map (screenshots + hotspots)
// Screenshots live in docs/gui-map/shots/ and are written by the skill, not here.

'use strict';

// The only retained taxonomy: the eight GUI areas + a one-line description each
// (structural grouping, not a per-element manifest). Iteration order = display order.
const AREAS = {
  SIDEBAR: 'The left rail: sessions grouped by project, the create/resume actions, and the error center.',
  HEADER: 'The bar above the focused session: its name/state, the panel buttons, the usage chip, and the controls.',
  CONV: "The focused session's conversation log and the status line above it.",
  COMPOSE: 'The message box at the bottom of the focused session.',
  PANEL: 'Floating panels over the conversation (topics / in-session todos / TODO.md).',
  INTERACTION: 'The blocking modal shown when a session needs a decision from you.',
  MODAL: 'Centered dialogs: the new-session / resume pickers, rename, and quick preview.',
  MENU: 'Transient pop-up menus.',
};

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Assign each discovered handle to the FIRST state it appears in (state key order =
// capture order). Returns the per-state element lists (for hotspots) and the flat
// deduped list (for the glossary).
function dedupe(capturesByState = {}) {
  const seen = new Set();
  const elementsByState = {};
  const all = [];
  for (const state of Object.keys(capturesByState)) {
    const cap = capturesByState[state] || {};
    elementsByState[state] = [];
    for (const el of (cap.elements || [])) {
      if (!el || seen.has(el.handle)) continue;
      seen.add(el.handle);
      elementsByState[state].push(el);
      all.push({ ...el, state });
    }
  }
  return { elementsByState, all };
}

// Group a flat element list by AREA, preserving AREAS order (unknown areas appended).
function groupByArea(elements) {
  const order = Object.keys(AREAS);
  const groups = new Map(order.map((a) => [a, []]));
  for (const el of elements) {
    if (!groups.has(el.area)) groups.set(el.area, []);
    groups.get(el.area).push(el);
  }
  return [...groups.entries()].filter(([, els]) => els.length);
}

// ---- docs/gui-map.md (pure) --------------------------------------------------
function toGlossary(allElements, { date } = {}) {
  const lines = [];
  lines.push('# cc-cockpit — GUI glossary (generated)');
  lines.push('');
  lines.push('A map of the cockpit GUI surface, **auto-discovered from the live GUI** by the `/gui-map` skill — **do not edit by hand** (a re-run overwrites it). Element handles and names are derived mechanically from the DOM, so they are functional rather than carefully worded. Every area/element is keyed by a `GUI-<AREA>-<slug>` handle for cross-reference.');
  if (date) { lines.push(''); lines.push(`**Last generated: ${date}**`); }
  lines.push('');
  lines.push('Visual map (hover/click hotspots): [gui-map/map.html](gui-map/map.html).');
  for (const [area, els] of groupByArea(allElements)) {
    lines.push('');
    lines.push(`## ${area} — ${AREAS[area]}`);
    for (const el of els) {
      lines.push('');
      lines.push(`### ${el.handle} — ${el.name}`);
      lines.push(el.description);
    }
  }
  return lines.join('\n') + '\n';
}

// ---- docs/gui-map/map.html (pure, self-contained) ----------------------------
function buildMap(capturesByState = {}, { date } = {}) {
  const { elementsByState, all } = dedupe(capturesByState);

  const glossaryHtml = groupByArea(all).map(([area, els]) => {
    const entries = els.map((el) => `
        <div class="g-entry" id="g-${escHtml(el.handle)}">
          <div class="g-name">${escHtml(el.name)} <code>${escHtml(el.handle)}</code></div>
          <div class="g-desc">${escHtml(el.description)}</div>
        </div>`).join('');
    return `
      <section class="g-area">
        <h2>${escHtml(area)}</h2>
        <p class="g-area-desc">${escHtml(AREAS[area] || '')}</p>
        ${entries}
      </section>`;
  }).join('');

  const mapsHtml = Object.keys(capturesByState).map((state) => {
    const cap = capturesByState[state] || {};
    const els = elementsByState[state] || [];
    if (!els.length) return '';
    const vw = (cap.viewport && cap.viewport.width) || 1440;
    const vh = (cap.viewport && cap.viewport.height) || 900;
    const pc = (n, d) => (Math.max(0, n) / d * 100).toFixed(3);
    const hotspots = els.filter((el) => el.rect).map((el) => {
      const r = el.rect;
      return `<a class="hot" href="#g-${escHtml(el.handle)}" data-handle="${escHtml(el.handle)}"`
        + ` data-name="${escHtml(el.name)}" data-desc="${escHtml(el.description)}"`
        + ` style="left:${pc(r.x, vw)}%;top:${pc(r.y, vh)}%;width:${pc(r.width, vw)}%;height:${pc(r.height, vh)}%"></a>`;
    }).join('\n        ');
    return `
      <section class="map-state" id="state-${escHtml(state)}">
        <h3>${escHtml(cap.title || state)} <span class="map-count">${els.length}</span></h3>
        <div class="shot" style="aspect-ratio:${vw} / ${vh}">
          <img src="shots/${escHtml(state)}.png" alt="${escHtml(cap.title || state)}" loading="lazy" />
          ${hotspots}
        </div>
      </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>cc-cockpit — GUI map</title>
<style>
  :root { --bg:#1e1e1e; --fg:#ddd; --muted:#888; --accent:#3a7bd5; --card:#262626; --line:#363636; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif; background:var(--bg); color:var(--fg); display:flex; }
  aside { width:340px; min-width:340px; height:100vh; overflow:auto; border-right:1px solid var(--line); padding:16px; }
  main { flex:1; height:100vh; overflow:auto; padding:16px 24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 16px; font-size:12px; }
  .g-area h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); margin:18px 0 2px; }
  .g-area-desc { color:var(--muted); font-size:12px; margin:0 0 8px; }
  .g-entry { padding:6px 8px; border-left:2px solid transparent; border-radius:4px; }
  .g-entry:target, .g-entry.flash { background:var(--card); border-left-color:var(--accent); }
  .g-name { font-weight:600; }
  .g-name code { font:11px ui-monospace,Consolas,monospace; color:var(--muted); }
  .g-desc { color:var(--fg); font-size:13px; }
  .map-state { margin-bottom:28px; }
  .map-state h3 { font-size:14px; margin:0 0 8px; border-bottom:1px solid var(--line); padding-bottom:4px; }
  .map-count { color:var(--muted); font-weight:400; font-size:12px; }
  .shot { position:relative; width:100%; max-width:1440px; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .shot img { display:block; width:100%; height:auto; }
  .hot { position:absolute; border:1.5px solid rgba(58,123,213,.6); background:rgba(58,123,213,.12); border-radius:3px; cursor:pointer; transition:background .1s,border-color .1s; }
  .hot:hover, .hot.flash { background:rgba(58,123,213,.32); border-color:var(--accent); }
  #tip { position:fixed; z-index:10; pointer-events:none; background:#000; color:#fff; border:1px solid var(--accent); border-radius:4px; padding:6px 8px; max-width:320px; font-size:12px; display:none; }
  #tip b { display:block; }
  #tip code { color:var(--muted); font:10px ui-monospace,monospace; }
</style>
</head>
<body>
  <aside>
    <h1>cc-cockpit — GUI map</h1>
    <p class="sub">${escHtml(date ? 'Generated ' + date + '. ' : '')}Auto-discovered from the live GUI; hover a hotspot for its name, click to jump to the glossary entry. ${all.length} elements.</p>
    ${glossaryHtml}
  </aside>
  <main>
    ${mapsHtml}
  </main>
  <div id="tip"></div>
<script>
  (function () {
    var tip = document.getElementById('tip');
    function flash(el) { if (!el) return; el.classList.add('flash'); setTimeout(function(){ el.classList.remove('flash'); }, 1200); }
    document.querySelectorAll('.hot').forEach(function (h) {
      h.addEventListener('mousemove', function (e) {
        tip.innerHTML = '<b>' + h.dataset.name + '</b>' + h.dataset.desc + '<br><code>' + h.dataset.handle + '</code>';
        tip.style.display = 'block';
        var x = e.clientX + 14, y = e.clientY + 14;
        var r = tip.getBoundingClientRect();
        if (x + r.width > innerWidth) x = e.clientX - r.width - 14;
        if (y + r.height > innerHeight) y = e.clientY - r.height - 14;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      });
      h.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
      h.addEventListener('click', function () { setTimeout(function(){ flash(document.getElementById('g-' + h.dataset.handle)); }, 0); });
    });
    document.querySelectorAll('.g-entry').forEach(function (g) {
      g.addEventListener('click', function () {
        var hot = document.querySelector('.hot[data-handle="' + g.id.slice(2) + '"]');
        if (hot) { hot.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(hot); }
      });
    });
  })();
</script>
</body>
</html>
`;
}

module.exports = { dedupe, groupByArea, toGlossary, buildMap, AREAS };

// ---- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = __dirname;
  const root = path.join(here, '..', '..', '..');
  const docsDir = path.join(root, 'docs');
  const mapDir = path.join(docsDir, 'gui-map');

  let captures = {};
  try { captures = JSON.parse(fs.readFileSync(path.join(here, 'captures.json'), 'utf8')); }
  catch { console.warn('No captures.json — run the /gui-map skill to capture the live GUI first. Nothing generated.'); process.exit(0); }

  const today = new Date().toISOString().slice(0, 10);
  const { all } = dedupe(captures);
  fs.mkdirSync(mapDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'gui-map.md'), toGlossary(all, { date: today }));
  fs.writeFileSync(path.join(mapDir, 'map.html'), buildMap(captures, { date: today }));

  const byArea = {};
  for (const el of all) byArea[el.area] = (byArea[el.area] || 0) + 1;
  console.log(`docs/gui-map.md + docs/gui-map/map.html written: ${all.length} elements across ${Object.keys(captures).length} states.`);
  console.log('per area: ' + JSON.stringify(byArea));
}
