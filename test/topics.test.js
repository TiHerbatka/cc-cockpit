const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTopics } = require('../server/topics');

function dirWith(id, content) {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-topics-'));
  fs.mkdirSync(path.join(claudeDir, 'topics'), { recursive: true });
  if (content !== undefined) fs.writeFileSync(path.join(claudeDir, 'topics', `${id}.json`), content);
  return claudeDir;
}

test('reads the topics array', () => {
  const id = 'sess-1';
  const claudeDir = dirWith(id, JSON.stringify({ session_id: id, topics: [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }] }));
  assert.deepStrictEqual(readTopics(id, { claudeDir }), [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
test('missing file -> []', () => {
  const claudeDir = dirWith('sess-x', undefined);
  assert.deepStrictEqual(readTopics('nope', { claudeDir }), []);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
test('malformed json -> []', () => {
  const claudeDir = dirWith('sess-2', '{not json');
  assert.deepStrictEqual(readTopics('sess-2', { claudeDir }), []);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
test('no ccSessionId -> []', () => {
  assert.deepStrictEqual(readTopics(null, { claudeDir: '/nope' }), []);
});
