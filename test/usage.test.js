const test = require('node:test');
const assert = require('node:assert');
const { emptyUsage, kTok, utilClass, foldUsageMeta, usageSegments } = require('../public/usage');

test('emptyUsage is a fresh blank accumulator each call', () => {
  assert.deepEqual(emptyUsage(), { tok: null, ctx: null, fiveHour: null, sevenDay: null });
  assert.notStrictEqual(emptyUsage(), emptyUsage());
});

test('kTok formats thousands compactly', () => {
  assert.equal(kTok(0), '0');
  assert.equal(kTok(999), '999');
  assert.equal(kTok(1000), '1.0k');
  assert.equal(kTok(1234), '1.2k');
});

test('utilClass thresholds: <70 green, 70-90 yellow, >=90 red', () => {
  assert.equal(utilClass(0), 'u-green');
  assert.equal(utilClass(69.9), 'u-green');
  assert.equal(utilClass(70), 'u-yellow');
  assert.equal(utilClass(89.9), 'u-yellow');
  assert.equal(utilClass(90), 'u-red');
  assert.equal(utilClass(100), 'u-red');
});

test('foldUsageMeta updates only the segment a meta carries; never blanks the others', () => {
  const acc = emptyUsage();
  let r = foldUsageMeta(acc, { usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } });
  assert.equal(r.changed, true);
  assert.deepEqual(acc.tok, { in: 150, out: 20 });
  // a later ctx-only meta must NOT blank the token segment
  r = foldUsageMeta(acc, { ctx: { pct: 42 } });
  assert.equal(r.changed, true);
  assert.deepEqual(acc.tok, { in: 150, out: 20 });
  assert.deepEqual(acc.ctx, { pct: 42 });
  // a rate meta sets both rolling windows
  r = foldUsageMeta(acc, { rate: { fiveHour: { pct: 75 }, sevenDay: { pct: 10 } } });
  assert.equal(r.changed, true);
  assert.deepEqual(acc.fiveHour, { pct: 75 });
  assert.deepEqual(acc.sevenDay, { pct: 10 });
});

test('foldUsageMeta: a meta with no usage fields reports no change', () => {
  const acc = emptyUsage();
  assert.equal(foldUsageMeta(acc, { mode: 'default', model: 'm' }).changed, false);
  assert.equal(foldUsageMeta(acc, {}).changed, false);
  assert.equal(foldUsageMeta(acc, null).changed, false);
});

test('usageSegments builds ordered descriptors with color + resets', () => {
  assert.deepEqual(usageSegments(emptyUsage()), []); // empty -> no segments (row hidden)
  const acc = emptyUsage();
  acc.tok = { in: 1500, out: 300 };
  acc.ctx = { pct: 42.4 };
  acc.fiveHour = { pct: 95, resetsAt: '2026-07-01T00:00:00Z' };
  acc.sevenDay = { pct: 12 };
  const segs = usageSegments(acc);
  assert.equal(segs.length, 4);
  assert.ok(segs[0].text.startsWith('tok 1.5k') && segs[0].text.includes('300'));
  assert.equal(segs[1].text, 'ctx 42%');
  assert.ok(segs[2].text.startsWith('5h 95%'));
  assert.equal(segs[2].cls, 'u-red');
  assert.equal(segs[2].resetsAt, '2026-07-01T00:00:00Z');
  assert.ok(segs[3].text.startsWith('7d 12%'));
  assert.equal(segs[3].cls, 'u-green');
});
