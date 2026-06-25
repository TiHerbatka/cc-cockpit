// server/uploads.js — pure helpers for image-upload storage. The only I/O is the
// fs existence check in resolveUploadName; everything else is string/path math.
const path = require('node:path');
const fs = require('node:fs');

const UPLOAD_DIRNAME = 'uploaded-images';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB decoded cap

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp',
  'image/svg+xml': '.svg', 'image/tiff': '.tiff',
};

const normMime = (mime) => String(mime || '').toLowerCase().split(';')[0].trim();
function extFromMime(mime) { return MIME_EXT[normMime(mime)] || '.png'; }
function isImageMime(mime) { return /^image\//.test(normMime(mime)); }

function safeName(name) {
  if (!name || typeof name !== 'string') return '';
  const base = name.replace(/\\/g, '/').split('/').pop();
  return base.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim();
}

const pad = (n) => String(n).padStart(2, '0');
function buildAutoName(date, ext) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}${ext}`;
}

function resolveUploadName(dir, desiredName) {
  const ext = path.extname(desiredName);
  const stem = desiredName.slice(0, desiredName.length - ext.length);
  let candidate = desiredName, n = 2;
  while (fs.existsSync(path.join(dir, candidate))) { candidate = `${stem} (${n})${ext}`; n += 1; }
  return candidate;
}

function isWithinUploads(cwd, candidate) {
  const root = path.resolve(cwd, UPLOAD_DIRNAME);
  const rel = path.relative(root, path.resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  UPLOAD_DIRNAME, MAX_BYTES, extFromMime, isImageMime, safeName,
  buildAutoName, resolveUploadName, isWithinUploads,
};
