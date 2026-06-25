const { test } = require('node:test');
const assert = require('node:assert');
const { RingBuffer } = require('../server/buffer');

test('returns what was pushed when under the cap', () => {
  const b = new RingBuffer(100);
  b.push('hello ');
  b.push('world');
  assert.strictEqual(b.getAll(), 'hello world');
});

test('keeps only the most recent bytes when over the cap', () => {
  const b = new RingBuffer(5);
  b.push('abcdefgh');
  assert.strictEqual(b.getAll(), 'defgh');
  assert.ok(b.getAll().length <= 5);
});
