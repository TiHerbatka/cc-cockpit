// server/topics.js
// Read the assistant's per-session topic tracker (~/.claude/topics/<id>.json).
// Pure-ish: fs/claudeDir injectable; returns [] on any problem (purely additive).
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readTopics(ccSessionId, { claudeDir = defaultClaudeDir(), fs = nodeFs } = {}) {
  if (!ccSessionId) return [];
  try {
    const file = path.join(claudeDir, 'topics', `${ccSessionId}.json`);
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(obj && obj.topics) ? obj.topics : [];
  } catch { return []; }
}

module.exports = { readTopics, defaultClaudeDir };
