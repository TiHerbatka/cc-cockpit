const { test } = require('node:test');
const assert = require('node:assert');
const { parseUsage } = require('../public/usageparse');

test('parses ctx, 5h (+rel/reset), 7d', () => {
  const u = parseUsage('Opus | ~/x | ctx 4% | 5h 39% (1h6m/14:40) | 7d 26%');
  assert.deepStrictEqual(u, { ctx: 4, fiveHourPct: 39, fiveHourRel: '1h6m', fiveHourReset: '14:40', sevenDayPct: 26 });
});
test('5h without the (rel/reset) detail', () => {
  const u = parseUsage('ctx 10% | 5h 5% | 7d 1%');
  assert.deepStrictEqual([u.ctx, u.fiveHourPct, u.fiveHourRel, u.fiveHourReset, u.sevenDayPct], [10, 5, null, null, 1]);
});
test('missing segments -> nulls', () => {
  const u = parseUsage('Opus | ~/x');
  assert.deepStrictEqual([u.ctx, u.fiveHourPct, u.sevenDayPct], [null, null, null]);
});
test('empty input -> all null', () => {
  const u = parseUsage('');
  assert.deepStrictEqual([u.ctx, u.fiveHourPct, u.fiveHourRel, u.fiveHourReset, u.sevenDayPct], [null, null, null, null, null]);
});
