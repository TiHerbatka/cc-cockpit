// server/claude-settings.js
// Read the user's persisted Claude Code display preferences so the cockpit can
// render at the same detail level the terminal would (FEAT-display-mode). Two
// settings in ~/.claude/settings.json drive it:
//   - viewMode: "focus"  -> the /focus quiet view (fold reasoning + tool detail)
//   - verbose:  true     -> full turn-by-turn output
// Claude's DOCUMENTED precedence is verbose-over-viewMode: the CLI reference says
// `--verbose` "shows full turn-by-turn output. Overrides the viewMode setting for
// this session." So the derived mode is verbose ? 'verbose' : focus-or-normal.
// Best-effort by design: a missing / malformed file or absent keys degrades to
// 'normal'. (v1 reads the user-level settings file only — the tier merge across
// project/local settings is a later refinement; viewMode is a global per-user
// preference, so the user-level file is where /focus writes it.)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pure precedence rule, kept separate so it is trivially unit-testable.
function deriveDisplayMode({ viewMode, verbose } = {}) {
  if (verbose === true) return 'verbose';       // documented: verbose overrides viewMode
  if (viewMode === 'focus') return 'focus';
  return 'normal';
}

function readClaudeSettings({ claudeDir, readFileSync = fs.readFileSync } = {}) {
  const dir = claudeDir || path.join(os.homedir(), '.claude');
  try {
    const json = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    return (json && typeof json === 'object') ? json : {};
  } catch { return {}; } // absent file / bad JSON -> no preferences
}

// { viewMode, verbose, mode } — the raw settings plus the derived display mode.
function readDisplayMode(opts = {}) {
  const s = readClaudeSettings(opts);
  const viewMode = typeof s.viewMode === 'string' ? s.viewMode : null;
  const verbose = s.verbose === true;
  return { viewMode, verbose, mode: deriveDisplayMode({ viewMode, verbose }) };
}

module.exports = { readDisplayMode, deriveDisplayMode, readClaudeSettings };
