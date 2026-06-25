// public/compose.js — pure helpers for the rich compose box. Dual export so
// node --test can require it and the browser gets globals (mirror modeparse.js).
function quotePath(p) {
  const s = String(p == null ? '' : p);
  return /\s/.test(s) ? '"' + s + '"' : s;
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
if (typeof module !== 'undefined' && module.exports) module.exports = { quotePath, serializeDescriptors };
if (typeof window !== 'undefined') { window.quotePath = quotePath; window.serializeDescriptors = serializeDescriptors; }
