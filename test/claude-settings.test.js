const { test } = require('node:test');
const assert = require('node:assert');
const { readDisplayMode, deriveDisplayMode } = require('../server/claude-settings');

// A fake readFileSync returning a given settings.json body (or throwing to
// simulate an absent file).
const fakeReader = (body) => () => {
  if (body === undefined) { const e = new Error('ENOENT'); throw e; }
  return typeof body === 'string' ? body : JSON.stringify(body);
};

test('deriveDisplayMode: verbose overrides focus (documented precedence)', () => {
  assert.strictEqual(deriveDisplayMode({ viewMode: 'focus', verbose: true }), 'verbose');
  assert.strictEqual(deriveDisplayMode({ viewMode: 'focus', verbose: false }), 'focus');
  assert.strictEqual(deriveDisplayMode({ viewMode: 'normal', verbose: true }), 'verbose');
  assert.strictEqual(deriveDisplayMode({ viewMode: null, verbose: false }), 'normal');
  assert.strictEqual(deriveDisplayMode({}), 'normal');
});

test('readDisplayMode: focus setting yields focus mode', () => {
  const r = readDisplayMode({ readFileSync: fakeReader({ viewMode: 'focus' }) });
  assert.deepStrictEqual(r, { viewMode: 'focus', verbose: false, mode: 'focus' });
});

test('readDisplayMode: verbose beats focus when both set', () => {
  const r = readDisplayMode({ readFileSync: fakeReader({ viewMode: 'focus', verbose: true }) });
  assert.deepStrictEqual(r, { viewMode: 'focus', verbose: true, mode: 'verbose' });
});

test('readDisplayMode: neither set -> normal', () => {
  const r = readDisplayMode({ readFileSync: fakeReader({ outputStyle: 'x', model: 'y' }) });
  assert.deepStrictEqual(r, { viewMode: null, verbose: false, mode: 'normal' });
});

test('readDisplayMode: missing file degrades to normal', () => {
  const r = readDisplayMode({ readFileSync: fakeReader(undefined) });
  assert.deepStrictEqual(r, { viewMode: null, verbose: false, mode: 'normal' });
});

test('readDisplayMode: malformed JSON degrades to normal', () => {
  const r = readDisplayMode({ readFileSync: fakeReader('{ not json') });
  assert.deepStrictEqual(r, { viewMode: null, verbose: false, mode: 'normal' });
});

test('readDisplayMode: non-string viewMode is ignored', () => {
  const r = readDisplayMode({ readFileSync: fakeReader({ viewMode: 123 }) });
  assert.strictEqual(r.mode, 'normal');
});
