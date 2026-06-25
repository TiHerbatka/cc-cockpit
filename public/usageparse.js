// public/usageparse.js
// Pure: parse Claude usage from the statusline footer text (xterm-translated).
// Format: "… | ctx N% | 5h N% (rel/reset) | 7d N% | …". Dual-exported for browser + node test.
function parseUsage(text) {
  const t = String(text || '');
  const ctx = (t.match(/\bctx\s+(\d+)%/i) || [])[1];
  const five = t.match(/\b5h\s+(\d+)%(?:\s*\(([^/)]+)\/([^)]+)\))?/i);
  const seven = (t.match(/\b7d\s+(\d+)%/i) || [])[1];
  return {
    ctx: ctx != null ? Number(ctx) : null,
    fiveHourPct: five ? Number(five[1]) : null,
    fiveHourRel: five && five[2] ? five[2].trim() : null,
    fiveHourReset: five && five[3] ? five[3].trim() : null,
    sevenDayPct: seven != null ? Number(seven) : null,
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseUsage };
if (typeof window !== 'undefined') window.parseUsage = parseUsage;
