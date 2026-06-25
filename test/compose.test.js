const test = require('node:test');
const assert = require('node:assert');
const { quotePath, serializeDescriptors } = require('../public/compose');

test('quotePath quotes paths containing whitespace, leaves others bare', () => {
  assert.equal(quotePath('C:\\a\\b.png'), 'C:\\a\\b.png');
  assert.equal(quotePath('C:\\a b\\2026-06-25 09-07-03.png'), '"C:\\a b\\2026-06-25 09-07-03.png"');
  assert.equal(quotePath(''), '');
  assert.equal(quotePath(null), '');
});

test('serializeDescriptors: text + br->\\n + token->quoted path, in order', () => {
  assert.equal(serializeDescriptors([]), '');
  assert.equal(serializeDescriptors([{ type: 'text', text: 'hi' }]), 'hi');
  assert.equal(serializeDescriptors([{ type: 'br' }]), '\n');
  assert.equal(serializeDescriptors([
    { type: 'text', text: 'look ' },
    { type: 'token', path: 'C:\\imgs\\a b.png' },
    { type: 'text', text: ' here' },
  ]), 'look "C:\\imgs\\a b.png" here');
  assert.equal(serializeDescriptors([
    { type: 'token', path: '/p/one.png' }, { type: 'text', text: ' and ' }, { type: 'token', path: '/p/two.png' },
  ]), '/p/one.png and /p/two.png');
});
