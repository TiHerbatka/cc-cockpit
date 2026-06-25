const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const uploads = require('../server/uploads');

test('extFromMime maps known mimes, strips params, defaults to .png', () => {
  assert.equal(uploads.extFromMime('image/png'), '.png');
  assert.equal(uploads.extFromMime('image/jpeg'), '.jpg');
  assert.equal(uploads.extFromMime('image/webp'), '.webp');
  assert.equal(uploads.extFromMime('image/gif'), '.gif');
  assert.equal(uploads.extFromMime('image/jpeg; charset=binary'), '.jpg');
  assert.equal(uploads.extFromMime('application/octet-stream'), '.png');
  assert.equal(uploads.extFromMime(''), '.png');
});

test('isImageMime', () => {
  assert.equal(uploads.isImageMime('image/png'), true);
  assert.equal(uploads.isImageMime('image/svg+xml'), true);
  assert.equal(uploads.isImageMime('text/plain'), false);
  assert.equal(uploads.isImageMime(''), false);
});

test('safeName reduces to a sanitized basename', () => {
  assert.equal(uploads.safeName('photo.png'), 'photo.png');
  assert.equal(uploads.safeName('../../etc/passwd'), 'passwd');
  assert.equal(uploads.safeName('C:\\Users\\x\\a.png'), 'a.png');
  assert.equal(uploads.safeName('a/b/c.png'), 'c.png');
  assert.equal(uploads.safeName('bad:name?.png'), 'badname.png');
  assert.equal(uploads.safeName(''), '');
  assert.equal(uploads.safeName(null), '');
});

test('buildAutoName formats with an injected date', () => {
  const d = new Date(2026, 5, 25, 9, 7, 3); // month is 0-based -> June
  assert.equal(uploads.buildAutoName(d, '.png'), '2026-06-25 09-07-03.png');
});

test('resolveUploadName suffixes on collision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a.png');
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a (2).png');
  fs.writeFileSync(path.join(dir, 'a (2).png'), 'x');
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a (3).png');
});

test('isWithinUploads guards the uploaded-images dir', () => {
  const cwd = path.resolve('/projects/demo');
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images', 'a.png')), true);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images', 'sub', 'a.png')), true);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'secret.txt')), false);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images')), false);
  assert.equal(uploads.isWithinUploads(cwd, '/etc/passwd'), false);
});
