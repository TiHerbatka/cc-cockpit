// test/gui-map.test.js
// Covers the /gui-map generator's pure functions (the skill's build.js lives under
// .claude/skills/gui-map/, but its unit test lives here so `npm test` runs it).
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupe, groupByArea, toGlossary, buildMap, AREAS } = require('../.claude/skills/gui-map/build.js');

// Auto-discovered captures: GUI-SIDEBAR-alpha appears in BOTH states (should dedupe
// to its first state, s1); s2 also brings a fresh GUI-MODAL-gamma; s3 is all-dup.
const CAP = {
  s1: {
    title: 'State one', viewport: { width: 1000, height: 500 },
    elements: [
      { handle: 'GUI-SIDEBAR-alpha', name: 'Alpha', area: 'SIDEBAR', description: 'The "Alpha" button.', rect: { x: 100, y: 50, width: 200, height: 20 } },
      { handle: 'GUI-HEADER-beta', name: 'Beta', area: 'HEADER', description: 'The "Beta" select.', rect: { x: 0, y: 0, width: 1000, height: 40 } },
    ],
  },
  s2: {
    title: 'State two', viewport: { width: 1000, height: 500 },
    elements: [
      { handle: 'GUI-SIDEBAR-alpha', name: 'Alpha', area: 'SIDEBAR', description: 'dup ignored', rect: { x: 5, y: 5, width: 10, height: 10 } },
      { handle: 'GUI-MODAL-gamma', name: 'Gamma', area: 'MODAL', description: 'The "Gamma" element.', rect: { x: 10, y: 20, width: 100, height: 30 } },
    ],
  },
  s3: {
    title: 'State three', viewport: { width: 1000, height: 500 },
    elements: [
      { handle: 'GUI-HEADER-beta', name: 'Beta', area: 'HEADER', description: 'dup', rect: { x: 1, y: 1, width: 1, height: 1 } },
    ],
  },
};

// ---- dedupe ------------------------------------------------------------------
test('dedupe assigns each handle to the first state it appears in', () => {
  const { elementsByState, all } = dedupe(CAP);
  assert.deepStrictEqual(all.map((e) => e.handle), ['GUI-SIDEBAR-alpha', 'GUI-HEADER-beta', 'GUI-MODAL-gamma']);
  assert.deepStrictEqual(elementsByState.s1.map((e) => e.handle), ['GUI-SIDEBAR-alpha', 'GUI-HEADER-beta']);
  assert.deepStrictEqual(elementsByState.s2.map((e) => e.handle), ['GUI-MODAL-gamma']); // alpha deduped away
  assert.deepStrictEqual(elementsByState.s3, []); // all dups
  assert.strictEqual(all[0].state, 's1'); // representative state recorded
});

// ---- groupByArea -------------------------------------------------------------
test('groupByArea preserves the AREAS order and drops empty areas', () => {
  const { all } = dedupe(CAP);
  const g = groupByArea(all);
  assert.deepStrictEqual(g.map(([a]) => a), ['SIDEBAR', 'HEADER', 'MODAL']);
});

// ---- toGlossary --------------------------------------------------------------
test('toGlossary groups by area with handle, name, and description', () => {
  const { all } = dedupe(CAP);
  const md = toGlossary(all, { date: '2026-06-29' });
  assert.match(md, /# cc-cockpit — GUI glossary \(generated\)/);
  assert.match(md, /do not edit by hand/);
  assert.match(md, /\*\*Last generated: 2026-06-29\*\*/);
  assert.match(md, new RegExp('## SIDEBAR — ' + AREAS.SIDEBAR.slice(0, 12)));
  assert.match(md, /### GUI-SIDEBAR-alpha — Alpha\nThe "Alpha" button\./);
});

test('toGlossary omits the date line when none is given', () => {
  assert.ok(!toGlossary(dedupe(CAP).all).includes('Last generated'));
});

// ---- buildMap ----------------------------------------------------------------
test('buildMap positions hotspots as viewport-relative percentages', () => {
  const html = buildMap(CAP);
  // alpha @ s1: x100/1000=10%, y50/500=10%, w200/1000=20%, h20/500=4%
  assert.match(html, /href="#g-GUI-SIDEBAR-alpha"[^>]*style="left:10\.000%;top:10\.000%;width:20\.000%;height:4\.000%"/);
  // gamma @ s2: x10/1000=1%, y20/500=4%, w100/1000=10%, h30/500=6%
  assert.match(html, /href="#g-GUI-MODAL-gamma"[^>]*style="left:1\.000%;top:4\.000%;width:10\.000%;height:6\.000%"/);
});

test('buildMap embeds the glossary and references per-state screenshots', () => {
  const html = buildMap(CAP, { date: '2026-06-29' });
  assert.match(html, /id="g-GUI-HEADER-beta"/);
  assert.match(html, /src="shots\/s1\.png"/);
  assert.match(html, /src="shots\/s2\.png"/);
});

// Self-contained map.html (gui-map v2): when given inlined base64 images, buildMap
// emits `data:` URIs instead of shots/ paths, so the file opens via file:// alone.
test('buildMap inlines screenshots as data URIs when imagesByState is given', () => {
  const html = buildMap(CAP, { imagesByState: { s1: 'data:image/png;base64,AAA1', s2: 'data:image/png;base64,BBB2' } });
  assert.match(html, /src="data:image\/png;base64,AAA1"/);
  assert.match(html, /src="data:image\/png;base64,BBB2"/);
  assert.ok(!html.includes('shots/s1.png'));
  assert.ok(!html.includes('shots/s2.png'));
});

test('buildMap falls back to the shots/ path for a state missing an inlined image', () => {
  const html = buildMap(CAP, { imagesByState: { s1: 'data:image/png;base64,AAA1' } });
  assert.match(html, /src="data:image\/png;base64,AAA1"/); // s1 inlined
  assert.match(html, /src="shots\/s2\.png"/);               // s2 absent → path fallback
});

test('buildMap skips a state whose elements were all deduped away', () => {
  const html = buildMap(CAP);
  assert.ok(!html.includes('id="state-s3"'));
  assert.ok(!html.includes('shots/s3.png'));
});

test('buildMap does not render a dedicated alpha hotspot in s2 (deduped to s1)', () => {
  const html = buildMap(CAP);
  const s2 = html.slice(html.indexOf('id="state-s2"'));
  const s2section = s2.slice(0, s2.indexOf('</section>'));
  assert.ok(!s2section.includes('GUI-SIDEBAR-alpha'));
  assert.ok(s2section.includes('GUI-MODAL-gamma'));
});

test('buildMap escapes HTML in names/descriptions', () => {
  const cap = { s1: { title: 'S', viewport: { width: 100, height: 100 }, elements: [
    { handle: 'GUI-CONV-x', name: 'A <b> & "q"', area: 'CONV', description: 'has <i>', rect: { x: 0, y: 0, width: 1, height: 1 } },
  ] } };
  const html = buildMap(cap);
  assert.ok(html.includes('A &lt;b&gt; &amp; &quot;q&quot;'));
  assert.ok(!html.includes('A <b> &'));
});
