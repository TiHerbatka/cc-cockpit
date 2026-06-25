// public/modeparse.js
// Pure: detect Claude's current permission mode from the terminal footer text
// (xterm-translated, no ANSI). No banner present => 'normal'. Dual-exported so it
// works as a browser <script> and is unit-testable in node.
function parseClaudeMode(text) {
  const t = String(text || '');
  if (/\baccept edits on\b/i.test(t)) return 'accept edits';
  if (/\bplan mode on\b/i.test(t)) return 'plan';
  if (/\bauto mode on\b/i.test(t)) return 'auto';
  if (/\bbypass(?:ing)? permissions\b/i.test(t)) return 'bypass';
  return 'normal';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseClaudeMode };
if (typeof window !== 'undefined') window.parseClaudeMode = parseClaudeMode;
