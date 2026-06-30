const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRenameMap, saveRenameMap } = require('../server/rename-store');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-rename-')), 'renames.json');
}

test('loadRenameMap returns empty Map when file is absent', () => {
  const p = path.join(os.tmpdir(), 'cockpit-rename-nonexistent-xyz-' + Date.now() + '.json');
  const m = loadRenameMap(p);
  assert.strictEqual(m.size, 0);
});

test('loadRenameMap returns empty Map for malformed JSON', () => {
  const p = tmpFile();
  fs.writeFileSync(p, 'not json at all!!');
  assert.strictEqual(loadRenameMap(p).size, 0);
});

test('loadRenameMap returns empty Map for JSON that is not an object', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify([1, 2, 3]));
  assert.strictEqual(loadRenameMap(p).size, 0);
  fs.writeFileSync(p, JSON.stringify(null));
  assert.strictEqual(loadRenameMap(p).size, 0);
  fs.writeFileSync(p, JSON.stringify('a string'));
  assert.strictEqual(loadRenameMap(p).size, 0);
});

test('loadRenameMap returns empty Map when filePath is null/undefined', () => {
  assert.strictEqual(loadRenameMap(null).size, 0);
  assert.strictEqual(loadRenameMap(undefined).size, 0);
});

test('saveRenameMap + loadRenameMap round-trip', () => {
  const p = tmpFile();
  const m = new Map([
    ['ccid-abc', 'My Custom Name'],
    ['ccid-xyz', 'Another Name'],
  ]);
  saveRenameMap(p, m);
  const loaded = loadRenameMap(p);
  assert.strictEqual(loaded.size, 2);
  assert.strictEqual(loaded.get('ccid-abc'), 'My Custom Name');
  assert.strictEqual(loaded.get('ccid-xyz'), 'Another Name');
});

test('saveRenameMap omits empty/blank names', () => {
  const p = tmpFile();
  const m = new Map([
    ['ccid-a', 'Valid Name'],
    ['ccid-b', ''],   // empty — must not be persisted
    ['ccid-c', '   '], // whitespace — must not be persisted
  ]);
  saveRenameMap(p, m);
  const loaded = loadRenameMap(p);
  assert.strictEqual(loaded.size, 1);
  assert.strictEqual(loaded.get('ccid-a'), 'Valid Name');
});

test('saveRenameMap is a no-op when filePath is null/undefined', () => {
  // Should not throw
  saveRenameMap(null, new Map([['id', 'Name']]));
  saveRenameMap(undefined, new Map([['id', 'Name']]));
});

test('saveRenameMap silently ignores write errors (bad path)', () => {
  // An impossible path (nested inside a file) should not throw
  const p = path.join(os.tmpdir(), 'nonexistent-dir-' + Date.now(), 'deep', 'renames.json');
  // mkdirSync in saveRenameMap will create the parent; use a really broken path instead
  const badPath = process.platform === 'win32' ? 'Z:\\__impossible_drive__\\renames.json' : '/proc/1/mem/renames.json';
  assert.doesNotThrow(() => saveRenameMap(badPath, new Map([['id', 'Name']])));
});

test('loadRenameMap trims values and skips blank ones', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ 'ccid-a': '  Trimmed  ', 'ccid-b': '   ' }));
  const m = loadRenameMap(p);
  assert.strictEqual(m.get('ccid-a'), 'Trimmed');
  assert.strictEqual(m.has('ccid-b'), false); // blank after trim -> excluded
});

test('overwriting via saveRenameMap replaces prior content', () => {
  const p = tmpFile();
  saveRenameMap(p, new Map([['id1', 'First']]));
  saveRenameMap(p, new Map([['id2', 'Second']])); // replaces
  const m = loadRenameMap(p);
  assert.strictEqual(m.size, 1);
  assert.strictEqual(m.get('id2'), 'Second');
  assert.strictEqual(m.has('id1'), false);
});
