// features-gui-mapping/build.test.js
// Covers the pure generator functions. node --test picks this up via npm test
// (it matches **/*.test.js); it adds no product code to server/.
const { test } = require('node:test');
const assert = require('node:assert');
const { manifestToGlossary, buildMap, computeDrift, groupByArea } = require('./build');

const M = {
  meta: { viewport: { width: 1000, height: 500 } },
  areas: { AREA1: 'First area.', AREA2: 'Second area.' },
  states: {
    s1: { title: 'State one', screenshot: 's1.png' },
    s2: { title: 'State two', screenshot: 's2.png' },
  },
  elements: [
    { handle: 'GUI-AREA1-a', name: 'Alpha', area: 'AREA1', state: 's1', selector: '#secret-alpha', description: 'The alpha thing.', featRef: 'FEAT-x' },
    { handle: 'GUI-AREA1-b', name: 'Beta', area: 'AREA1', state: 's1', selector: '.secret-beta', description: 'The beta thing.', featRef: null },
    { handle: 'GUI-AREA2-c', name: 'Gamma', area: 'AREA2', state: 's2', selector: '#secret-gamma', description: 'The gamma thing.', featRef: 'FEAT-y' },
  ],
};

const CAP = {
  s1: {
    viewport: { width: 1000, height: 500 },
    rects: {
      'GUI-AREA1-a': { x: 100, y: 50, width: 200, height: 20 },
      'GUI-AREA1-b': { x: 0, y: 0, width: 1000, height: 40 },
    },
  },
  // s2 deliberately omitted -> GUI-AREA2-c is drift, and the s2 map section is skipped
};

const SELECTORS = ['#secret-alpha', '.secret-beta', '#secret-gamma'];

// ---- groupByArea -------------------------------------------------------------
test('groupByArea preserves area order and drops empty areas', () => {
  const g = groupByArea(M);
  assert.deepStrictEqual(g.map(([a]) => a), ['AREA1', 'AREA2']);
  assert.deepStrictEqual(g[0][1].map((e) => e.handle), ['GUI-AREA1-a', 'GUI-AREA1-b']);
});

// ---- manifestToGlossary ------------------------------------------------------
test('manifestToGlossary groups by area with handle, name, description, and Part-of', () => {
  const md = manifestToGlossary(M);
  assert.match(md, /## AREA1 — First area\./);
  assert.match(md, /### GUI-AREA1-a — Alpha\nThe alpha thing\.\nPart of: `FEAT-x`/);
  assert.match(md, /## AREA2 — Second area\./);
  assert.match(md, /### GUI-AREA2-c — Gamma/);
});

test('manifestToGlossary omits Part-of when there is no featRef', () => {
  const md = manifestToGlossary(M);
  assert.match(md, /### GUI-AREA1-b — Beta\nThe beta thing\./);
  assert.ok(!/The beta thing\.\nPart of/.test(md), 'Beta has no featRef, so no Part-of line');
});

test('manifestToGlossary never leaks selectors into the output', () => {
  const md = manifestToGlossary(M, { date: '2026-01-01' });
  for (const s of SELECTORS) assert.ok(!md.includes(s), `selector ${s} leaked into glossary`);
});

test('manifestToGlossary includes the date only when provided', () => {
  assert.ok(!manifestToGlossary(M).includes('Last generated'));
  assert.match(manifestToGlossary(M, { date: '2026-01-01' }), /Last generated: 2026-01-01/);
});

// ---- buildMap ----------------------------------------------------------------
test('buildMap positions hotspots as viewport-relative percentages', () => {
  const html = buildMap(M, CAP);
  // alpha: x100/1000=10%, y50/500=10%, w200/1000=20%, h20/500=4%
  assert.match(html, /href="#g-GUI-AREA1-a"[^>]*style="left:10\.000%;top:10\.000%;width:20\.000%;height:4\.000%"/);
  // beta: full-width banner at the origin
  assert.match(html, /href="#g-GUI-AREA1-b"[^>]*style="left:0\.000%;top:0\.000%;width:100\.000%;height:8\.000%"/);
});

test('buildMap embeds the glossary side-panel and references the screenshot', () => {
  const html = buildMap(M, CAP);
  assert.match(html, /id="g-GUI-AREA1-a"/);          // embedded glossary entry
  assert.match(html, /src="shots\/s1\.png"/);        // screenshot reference
  assert.match(html, /data-name="Alpha"/);
});

test('buildMap skips a state with no captured rects', () => {
  const html = buildMap(M, CAP);
  assert.ok(!html.includes('id="state-s2"'), 's2 has no rects and must be skipped');
  assert.ok(!html.includes('shots/s2.png'));
});

test('buildMap never leaks selectors into the output', () => {
  const html = buildMap(M, CAP, { date: '2026-01-01' });
  for (const s of SELECTORS) assert.ok(!html.includes(s), `selector ${s} leaked into map`);
});

test('buildMap escapes HTML in names/descriptions', () => {
  const m2 = JSON.parse(JSON.stringify(M));
  m2.elements[0].description = 'Has <b> & "quotes"';
  const html = buildMap(m2, CAP);
  assert.ok(html.includes('Has &lt;b&gt; &amp; &quot;quotes&quot;'));
  assert.ok(!html.includes('Has <b> &'));
});

// ---- computeDrift ------------------------------------------------------------
test('computeDrift lists elements whose state was not captured', () => {
  assert.deepStrictEqual(computeDrift(M, CAP), ['GUI-AREA2-c']);
});

test('computeDrift lists everything when there are no captures', () => {
  assert.deepStrictEqual(computeDrift(M, {}), ['GUI-AREA1-a', 'GUI-AREA1-b', 'GUI-AREA2-c']);
});

test('computeDrift is empty when every element has a rect', () => {
  const full = { s1: CAP.s1, s2: { rects: { 'GUI-AREA2-c': { x: 1, y: 1, width: 1, height: 1 } } } };
  assert.deepStrictEqual(computeDrift(M, full), []);
});
