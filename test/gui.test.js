const test = require('node:test');
const assert = require('node:assert');
const { groupConsecutiveTools } = require('../public/gui');

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
