// public/usage.js — pure helpers for the header usage chip: the per-session accumulator
// fold and the display formatting. The browser-only DOM building stays in app.js; this
// module is the testable core (dual export, same pattern as compose.js/markdown.js).

function emptyUsage() { return { tok: null, ctx: null, fiveHour: null, sevenDay: null }; }

// Compact token count: 1234 -> "1.2k".
function kTok(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

// Utilization color class: <70 green, 70–90 yellow, >=90 red.
function utilClass(pct) { return pct >= 90 ? 'u-red' : pct >= 70 ? 'u-yellow' : 'u-green'; }

// Fold one {type:'meta'} message into the accumulator (mutated in place). Each meta
// carries only the fields it updates, so a later rate/ctx message never blanks the
// token segment. Returns { changed } — whether any segment moved (-> chip re-render).
function foldUsageMeta(acc, meta) {
  let changed = false;
  if (meta && meta.usage) {
    const u = meta.usage;
    const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    acc.tok = { in: inTok, out: u.output_tokens || 0 };
    changed = true;
  }
  if (meta && 'ctx' in meta) { acc.ctx = meta.ctx; changed = true; }
  if (meta && meta.rate) { acc.fiveHour = meta.rate.fiveHour || null; acc.sevenDay = meta.rate.sevenDay || null; changed = true; }
  return { changed };
}

// Build the ordered display segments from the accumulator. Each is
// { text, cls? (color class for the rolling-window segments), resetsAt? (for a tooltip) }.
function usageSegments(acc) {
  const segs = [];
  if (acc.tok) segs.push({ text: `tok ${kTok(acc.tok.in)}↓ ${kTok(acc.tok.out)}↑` });
  if (acc.ctx) segs.push({ text: `ctx ${Math.round(acc.ctx.pct)}%` });
  const win = (label, w) => {
    if (!w) return;
    const seg = { text: `${label} ${Math.round(w.pct)}%`, cls: utilClass(w.pct) };
    if (w.resetsAt) seg.resetsAt = w.resetsAt;
    segs.push(seg);
  };
  win('5h', acc.fiveHour);
  win('7d', acc.sevenDay);
  return segs;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { emptyUsage, kTok, utilClass, foldUsageMeta, usageSegments };
if (typeof window !== 'undefined') {
  window.emptyUsage = emptyUsage;
  window.foldUsageMeta = foldUsageMeta;
  window.usageSegments = usageSegments;
}
