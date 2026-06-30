const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listRecent, titleForCwd, lastActivityByPath } = require('../server/recent');

const NOW = Date.parse('2026-06-24T12:00:00Z');

function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function fixture() {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-recent-'));
  const proj = path.join(claudeDir, 'projects', 'C--proj-a');
  fs.mkdirSync(proj, { recursive: true });

  const recentFile = path.join(proj, 'sess-recent.jsonl');
  writeJsonl(recentFile, [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'hello there' } },
    { type: 'ai-title', aiTitle: 'Recent One' },
  ]);
  const oldFile = path.join(proj, 'sess-old.jsonl');
  writeJsonl(oldFile, [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'old prompt text' } },
  ]);
  // Subagent transcript that MUST be excluded.
  const sub = path.join(proj, 'sess-recent', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  writeJsonl(path.join(sub, 'agent-x.jsonl'), [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'agent work' } },
  ]);

  fs.utimesSync(recentFile, new Date(NOW - 3600e3), new Date(NOW - 3600e3));            // 1h ago
  fs.utimesSync(oldFile, new Date(NOW - 4 * 86400e3), new Date(NOW - 4 * 86400e3));     // 4d ago (in week, not day)
  return claudeDir;
}

test('listRecent(day) returns only recent sessions, excludes subagents, uses aiTitle', () => {
  const claudeDir = fixture();
  const { window, groups } = listRecent('day', { claudeDir, now: NOW });
  assert.strictEqual(window, 'day');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].cwd, 'C:\\proj\\a');
  assert.strictEqual(groups[0].sessions.length, 1);
  assert.strictEqual(groups[0].sessions[0].id, 'sess-recent');
  assert.strictEqual(groups[0].sessions[0].title, 'Recent One');
});

test('listRecent(week) includes the older session; title falls back to first user message', () => {
  const claudeDir = fixture();
  const { groups } = listRecent('week', { claudeDir, now: NOW });
  const ids = groups[0].sessions.map((s) => s.id);
  assert.deepStrictEqual(ids, ['sess-recent', 'sess-old']); // newest first
  const old = groups[0].sessions.find((s) => s.id === 'sess-old');
  assert.strictEqual(old.title, 'old prompt text');
});

test('listRecent returns empty groups when the claude dir is missing', () => {
  const { groups } = listRecent('week', { claudeDir: path.join(os.tmpdir(), 'does-not-exist-xyz'), now: NOW });
  assert.deepStrictEqual(groups, []);
});

test('titleForCwd returns the aiTitle for the matching cwd, null otherwise', () => {
  const claudeDir = fixture();
  assert.strictEqual(titleForCwd('C:\\proj\\a', { claudeDir, now: NOW }), 'Recent One');
  assert.strictEqual(titleForCwd('C:\\proj\\nope', { claudeDir, now: NOW }), null);
});

test('lastActivityByPath returns the latest session activity per project path', () => {
  const claudeDir = fixture();
  const m = lastActivityByPath(['C:\\proj\\a', 'C:\\proj\\nope'], { claudeDir });
  assert.strictEqual(m.get('C:\\proj\\a'), new Date(NOW - 3600e3).toISOString()); // newest of the two
  assert.strictEqual(m.has('C:\\proj\\nope'), false);                            // no sessions -> absent
});

// E4: case-insensitive path matching on win32
test('lastActivityByPath matches sessions regardless of path casing on win32', () => {
  if (process.platform !== 'win32') return; // case-sensitive platforms skip this
  const claudeDir = fixture();
  // The transcript records cwd as 'C:\\proj\\a'. Query with differently-cased paths.
  const upper = lastActivityByPath(['C:\\PROJ\\A'], { claudeDir });
  assert.ok(upper.has('C:\\PROJ\\A'), 'upper-cased query path should still find the session');
  const lower = lastActivityByPath(['c:\\proj\\a'], { claudeDir });
  assert.ok(lower.has('c:\\proj\\a'), 'lower-cased query path should still find the session');
});
