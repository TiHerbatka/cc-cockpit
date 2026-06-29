// server/todomd.js
// Parse a TODO.md (the structure the /todo skill maintains) into flat display
// entries the cockpit's TODO.MD floating panel renders. Pure + dependency-free so
// it is unit-testable; the file read lives in the WS handler (server/app.js).
//   { kind: 'section', text }            ## A. Section Name
//   { kind: 'item', done, depth, text }  - [ ] A1. task   /   - [x] ... (depth from indent)
//   { kind: 'text', text }               any other non-empty, non-H1 line
function parseTodoMd(text) {
  const entries = [];
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m;
    if ((m = /^##\s+(.*)$/.exec(line))) { entries.push({ kind: 'section', text: m[1].trim() }); continue; }
    if (/^#\s+/.test(line)) continue; // the H1 file title ("# TODO") — not an entry
    if ((m = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      const indent = m[1].replace(/\t/g, '  ').length;
      entries.push({ kind: 'item', done: m[2].toLowerCase() === 'x', depth: Math.floor(indent / 2), text: m[3].trim() });
      continue;
    }
    entries.push({ kind: 'text', text: line.trim() });
  }
  return entries;
}

module.exports = { parseTodoMd };
