const test = require('node:test');
const assert = require('node:assert');
const { quotePath, serializeDescriptors, stripPastedPathQuotes } = require('../public/compose');

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

test('stripPastedPathQuotes unwraps a single quoted Windows path', () => {
  // Drive-letter paths (with and without spaces), UNC, and bare-backslash paths strip.
  assert.equal(stripPastedPathQuotes('"C:\\dir\\file.txt"'), 'C:\\dir\\file.txt');
  assert.equal(stripPastedPathQuotes('"C:\\my docs\\a b.png"'), 'C:\\my docs\\a b.png');
  assert.equal(stripPastedPathQuotes('"\\\\server\\share\\f.txt"'), '\\\\server\\share\\f.txt');
  assert.equal(stripPastedPathQuotes('"C:/dir/file.txt"'), 'C:/dir/file.txt');
  assert.equal(stripPastedPathQuotes('  "C:\\dir\\file.txt"  '), 'C:\\dir\\file.txt'); // surrounding whitespace trimmed
});

test('stripPastedPathQuotes leaves non-path / multi-token / unquoted text untouched', () => {
  assert.equal(stripPastedPathQuotes('"hello world"'), '"hello world"');       // quoted prose, not a path
  assert.equal(stripPastedPathQuotes('C:\\dir\\file.txt'), 'C:\\dir\\file.txt'); // no wrapping quotes
  assert.equal(stripPastedPathQuotes('"C:\\a.txt" "C:\\b.txt"'), '"C:\\a.txt" "C:\\b.txt"'); // multiple quoted paths
  assert.equal(stripPastedPathQuotes('"just text"'), '"just text"');
  assert.equal(stripPastedPathQuotes(''), '');
  assert.equal(stripPastedPathQuotes(null), '');
});
