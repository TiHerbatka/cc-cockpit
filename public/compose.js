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
// descriptors: Array<{type:'text', text} | {type:'br'} | {type:'token', path} | {type:'pastedtext', text}>
// A 'pastedtext' descriptor is a large pasted block that the editor collapsed into a
// chip (H5); on send it expands back to its verbatim text.
function serializeDescriptors(descriptors) {
  let out = '';
  for (const d of (descriptors || [])) {
    if (!d) continue;
    if (d.type === 'text') out += (d.text || '');
    else if (d.type === 'br') out += '\n';
    else if (d.type === 'token') out += quotePath(d.path);
    else if (d.type === 'pastedtext') out += (d.text || '');
  }
  return out;
}
// H5: decide whether a pasted block is large enough to collapse into a chip rather
// than inlining it. Long single-line pastes (by chars) and many-line pastes both
// qualify, so a giant blob doesn't flood the compose box.
function shouldCollapsePaste(text, opts) {
  const s = String(text == null ? '' : text);
  const maxLines = (opts && opts.maxLines) || 8;
  const maxChars = (opts && opts.maxChars) || 800;
  return s.split('\n').length > maxLines || s.length > maxChars;
}
// H5: short human summary for the collapsed-paste chip / popup header.
function pasteSummary(text) {
  const s = String(text == null ? '' : text);
  const lines = s.split('\n').length;
  return lines > 1 ? `${lines} lines` : `${s.length} chars`;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { quotePath, serializeDescriptors, stripPastedPathQuotes, shouldCollapsePaste, pasteSummary };
if (typeof window !== 'undefined') {
  window.quotePath = quotePath;
  window.serializeDescriptors = serializeDescriptors;
  window.stripPastedPathQuotes = stripPastedPathQuotes;
  window.shouldCollapsePaste = shouldCollapsePaste;
  window.pasteSummary = pasteSummary;
}
