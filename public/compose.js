// public/compose.js — pure helpers for the rich compose box. Dual export so
// node --test can require it and the browser gets globals (same dual-export pattern
// as the other pure helper modules).
function quotePath(p) {
  const s = String(p == null ? '' : p);
  return /\s/.test(s) ? '"' + s + '"' : s;
}
// Windows Explorer's "Copy as path" wraps the copied path in double quotes (e.g.
// `"C:\dir\my file.txt"`). When the whole pasted text is a single such quoted path,
// strip the wrapping quotes so the bare path lands in the editor. Conservative on
// purpose: only strips when the inner text has no embedded double-quote and looks
// like a filesystem path (drive letter, UNC prefix, or any backslash), so ordinary
// quoted prose like `"hello world"` is left untouched. Multiple space-separated
// quoted paths are left as-is (the inner would contain a quote).
function stripPastedPathQuotes(text) {
  const s = String(text == null ? '' : text);
  const t = s.trim();
  if (t.length < 3 || t[0] !== '"' || t[t.length - 1] !== '"') return s;
  const inner = t.slice(1, -1);
  if (inner.includes('"')) return s;
  const looksLikePath = /^[A-Za-z]:[\\/]/.test(inner) || inner.startsWith('\\\\') || inner.includes('\\');
  return looksLikePath ? inner : s;
}
// descriptors: Array<{type:'text', text} | {type:'br'} | {type:'token', path}>
function serializeDescriptors(descriptors) {
  let out = '';
  for (const d of (descriptors || [])) {
    if (!d) continue;
    if (d.type === 'text') out += (d.text || '');
    else if (d.type === 'br') out += '\n';
    else if (d.type === 'token') out += quotePath(d.path);
  }
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { quotePath, serializeDescriptors, stripPastedPathQuotes };
if (typeof window !== 'undefined') { window.quotePath = quotePath; window.serializeDescriptors = serializeDescriptors; window.stripPastedPathQuotes = stripPastedPathQuotes; }
