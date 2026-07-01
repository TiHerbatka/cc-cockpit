const test = require('node:test');
const assert = require('node:assert');
const { groupConsecutiveTools, finalAnswerItems, modeCfg, DISPLAY_MODES } = require('../public/gui');

const tool = (id) => ({ kind: 'tool', id, name: 'Bash', status: 'ok' });
const user = (text) => ({ kind: 'user', text });
const asst = (text) => ({ kind: 'assistant', text });

test('groupConsecutiveTools: empty / nullish -> []', () => {
  assert.deepEqual(groupConsecutiveTools([]), []);
  assert.deepEqual(groupConsecutiveTools(null), []);
  assert.deepEqual(groupConsecutiveTools(undefined), []);
});

test('groupConsecutiveTools: runs of 1-2 tools stay inline (the >2 boundary)', () => {
  assert.deepEqual(groupConsecutiveTools([tool(1)]), [{ type: 'item', item: tool(1) }]);
  // exactly 2 must NOT group
  assert.deepEqual(groupConsecutiveTools([tool(1), tool(2)]), [
    { type: 'item', item: tool(1) },
    { type: 'item', item: tool(2) },
  ]);
});

test('groupConsecutiveTools: a run of 3+ collapses into one group', () => {
  const segs = groupConsecutiveTools([tool(1), tool(2), tool(3)]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'group');
  assert.equal(segs[0].items.length, 3);
});

test('groupConsecutiveTools: non-tool items break runs and pass through in order', () => {
  const items = [user('hi'), tool(1), tool(2), tool(3), asst('done'), tool(4), tool(5)];
  const segs = groupConsecutiveTools(items);
  assert.deepEqual(segs.map((s) => s.type), ['item', 'group', 'item', 'item', 'item']);
  assert.equal(segs[1].items.length, 3);           // the 3-run grouped
  assert.deepEqual(segs[0].item, user('hi'));
  assert.deepEqual(segs[2].item, asst('done'));
  // the trailing 2-run stays inline
  assert.deepEqual(segs[3].item, tool(4));
  assert.deepEqual(segs[4].item, tool(5));
});

test('groupConsecutiveTools: threshold 1 folds every run (focus mode)', () => {
  const segs = groupConsecutiveTools([tool(1), tool(2)], 1);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].type, 'group');
  assert.equal(segs[0].items.length, 2);
  // a lone tool also groups at threshold 1
  assert.equal(groupConsecutiveTools([tool(9)], 1)[0].type, 'group');
});

test('groupConsecutiveTools: threshold Infinity never groups (verbose mode)', () => {
  const segs = groupConsecutiveTools([tool(1), tool(2), tool(3), tool(4)], Infinity);
  assert.deepEqual(segs.map((s) => s.type), ['item', 'item', 'item', 'item']);
});

test('modeCfg: known modes + fallback to normal', () => {
  assert.strictEqual(modeCfg('focus'), DISPLAY_MODES.focus);
  assert.strictEqual(modeCfg('verbose'), DISPLAY_MODES.verbose);
  assert.strictEqual(modeCfg('normal'), DISPLAY_MODES.normal);
  assert.strictEqual(modeCfg(undefined), DISPLAY_MODES.normal);
  assert.strictEqual(modeCfg('bogus'), DISPLAY_MODES.normal);
});

test('finalAnswerItems: last assistant of each turn is the final answer', () => {
  // turn 1: reasoning a1, final a2 ; turn 2: only a3 (final)
  const a1 = asst('reasoning'), a2 = asst('answer 1'), a3 = asst('answer 2');
  const items = [user('q1'), a1, tool(1), a2, user('q2'), a3];
  const finals = finalAnswerItems(items);
  assert.ok(finals.has(a2) && finals.has(a3));
  assert.ok(!finals.has(a1));
  assert.equal(finals.size, 2);
});

test('finalAnswerItems: trailing assistant with no following prompt is final', () => {
  const a = asst('only answer');
  const finals = finalAnswerItems([user('q'), a]);
  assert.ok(finals.has(a));
});

test('finalAnswerItems: empty / no assistant -> empty set', () => {
  assert.equal(finalAnswerItems([]).size, 0);
  assert.equal(finalAnswerItems([user('q'), tool(1)]).size, 0);
});
