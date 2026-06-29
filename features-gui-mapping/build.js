// features-gui-mapping/build.js
// DEV-ONLY generator for the /gui-map skill. Two PURE functions plus a thin CLI.
// Pure functions take data and return strings (no I/O), so they are exhaustively
// unit-testable. The CLI (run directly) reads manifest.json + captures.json,
// writes glossary.md + map.html, and prints a drift report.
//
// The OUTPUT names every element by role only — the manifest's `selector` is
// skill-internal and is NEVER written into glossary.md or map.html.
//
//   capturesByState shape (produced by the skill via Playwright):
//     { [stateId]: { viewport: {width,height}, rects: { [handle]: {x,y,width,height} } } }

'use strict';

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Group elements by area, preserving the manifest's area order.
function groupByArea(manifest) {
  const order = Object.keys(manifest.areas || {});
  const groups = new Map(order.map((a) => [a, []]));
  for (const el of manifest.elements || []) {
    if (!groups.has(el.area)) groups.set(el.area, []);
    groups.get(el.area).push(el);
  }
  return [...groups.entries()].filter(([, els]) => els.length);
}

// Elements declared in the manifest but with no captured rect = drift (the
// selector matched nothing at capture time, e.g. the element was renamed/removed).
function computeDrift(manifest, capturesByState = {}) {
  const drift = [];
  for (const el of manifest.elements || []) {
    const cap = capturesByState[el.state];
    const rect = cap && cap.rects && cap.rects[el.handle];
    if (!rect) drift.push(el.handle);
  }
  return drift;
}

// ---- glossary.md (pure) ------------------------------------------------------
function manifestToGlossary(manifest, { date } = {}) {
  const lines = [];
  lines.push('# cc-cockpit — GUI glossary');
  lines.push('');
  lines.push('A stable vocabulary for the cockpit GUI: every area and element keyed by an immutable `GUI-<AREA>-<slug>` handle. Use these handles to point precisely at parts of the interface. Generated from the live GUI by the `/gui-map` skill — do not edit by hand.');
  if (date) { lines.push(''); lines.push(`_Last generated: ${date}_`); }
  lines.push('');
  lines.push('See the visual map (hover/click hotspots): [map.html](./map.html).');
  for (const [area, els] of groupByArea(manifest)) {
    lines.push('');
    lines.push(`## ${area} — ${manifest.areas[area]}`);
    for (const el of els) {
      lines.push('');
      lines.push(`### ${el.handle} — ${el.name}`);
      lines.push(el.description);
      if (el.featRef) lines.push(`Part of: \`${el.featRef}\``);
    }
  }
  return lines.join('\n') + '\n';
}

// ---- map.html (pure, self-contained) -----------------------------------------
function buildMap(manifest, capturesByState = {}, { date } = {}) {
  const states = manifest.states || {};
  // Embedded glossary side-panel.
  const glossaryHtml = groupByArea(manifest).map(([area, els]) => {
    const entries = els.map((el) => `
        <div class="g-entry" id="g-${escHtml(el.handle)}">
          <div class="g-name">${escHtml(el.name)} <code>${escHtml(el.handle)}</code></div>
          <div class="g-desc">${escHtml(el.description)}</div>
          ${el.featRef ? `<div class="g-feat">Part of <code>${escHtml(el.featRef)}</code></div>` : ''}
        </div>`).join('');
    return `
      <section class="g-area">
        <h2>${escHtml(area)}</h2>
        <p class="g-area-desc">${escHtml(manifest.areas[area])}</p>
        ${entries}
      </section>`;
  }).join('');

  // One map section per captured state (a state with no captures is skipped).
  const stateOrder = Object.keys(states);
  const mapsHtml = stateOrder.map((stateId) => {
    const cap = capturesByState[stateId];
    if (!cap || !cap.rects || !Object.keys(cap.rects).length) return '';
    const vw = (cap.viewport && cap.viewport.width) || (manifest.meta && manifest.meta.viewport && manifest.meta.viewport.width) || 1440;
    const vh = (cap.viewport && cap.viewport.height) || (manifest.meta && manifest.meta.viewport && manifest.meta.viewport.height) || 900;
    const elemsByState = (manifest.elements || []).filter((el) => el.state === stateId && cap.rects[el.handle]);
    const hotspots = elemsByState.map((el) => {
      const r = cap.rects[el.handle];
      const pc = (n, d) => (Math.max(0, n) / d * 100).toFixed(3);
      return `<a class="hot" href="#g-${escHtml(el.handle)}" data-handle="${escHtml(el.handle)}"`
        + ` data-name="${escHtml(el.name)}" data-desc="${escHtml(el.description)}"`
        + ` style="left:${pc(r.x, vw)}%;top:${pc(r.y, vh)}%;width:${pc(r.width, vw)}%;height:${pc(r.height, vh)}%"></a>`;
    }).join('\n        ');
    const shot = states[stateId].screenshot;
    return `
      <section class="map-state" id="state-${escHtml(stateId)}">
        <h3>${escHtml(states[stateId].title)} <span class="map-count">${elemsByState.length}</span></h3>
        <div class="shot" style="aspect-ratio:${vw} / ${vh}">
          <img src="shots/${escHtml(shot)}" alt="${escHtml(states[stateId].title)}" loading="lazy" />
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
  .g-name code, .g-feat code { font:11px ui-monospace,Consolas,monospace; color:var(--muted); }
  .g-desc { color:var(--fg); font-size:13px; }
  .g-feat { color:var(--muted); font-size:11px; margin-top:2px; }
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
    <p class="sub">${escHtml(date ? 'Generated ' + date + '. ' : '')}Hover a hotspot for its name; click it to jump to the glossary entry. ${manifest.elements ? manifest.elements.length : 0} elements.</p>
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
    // Clicking a glossary entry flashes its hotspot on the map.
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

module.exports = { manifestToGlossary, buildMap, computeDrift, groupByArea };

// ---- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const here = __dirname;
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const capturesPath = path.join(here, 'captures.json');
  let captures = {};
  try { captures = JSON.parse(fs.readFileSync(capturesPath, 'utf8')); }
  catch { console.warn('No captures.json found — run the /gui-map skill to capture screenshots + rects first. Generating glossary only.'); }

  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(here, 'glossary.md'), manifestToGlossary(manifest, { date: today }));
  fs.writeFileSync(path.join(here, 'map.html'), buildMap(manifest, captures, { date: today }));

  const drift = computeDrift(manifest, captures);
  console.log(`glossary.md + map.html written (${manifest.elements.length} elements).`);
  if (drift.length) {
    console.log(`\nDRIFT — ${drift.length} element(s) had no captured rect (selector matched nothing):`);
    for (const h of drift) console.log('  - ' + h);
  } else if (Object.keys(captures).length) {
    console.log('No drift: every manifest element was captured.');
  }
}
