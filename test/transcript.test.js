const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTailer, findTranscriptPath } = require('../server/transcript');

function tmpFile() {
  return path.join(os.tmpdir(), `cc-tail-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('createTailer emits initial records then appended records', async () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ type: 'a', n: 1 }) + '\n' + JSON.stringify({ type: 'b', n: 2 }) + '\n');
  const batches = [];
  const tailer = createTailer(p, { intervalMs: 30, onRecords: (recs, meta) => batches.push({ recs, meta }) });
  tailer.start();
  await sleep(90);
  fs.appendFileSync(p, JSON.stringify({ type: 'c', n: 3 }) + '\n');
  await sleep(120);
  tailer.stop();
  fs.unlinkSync(p);
  const initial = batches.find((b) => b.meta.initial);
  assert.ok(initial, 'expected an initial batch');
  assert.deepStrictEqual(initial.recs.map((r) => r.n), [1, 2]);
  const later = batches.filter((b) => !b.meta.initial).flatMap((b) => b.recs.map((r) => r.n));
  assert.deepStrictEqual(later, [3]);
});

test('createTailer buffers an incomplete trailing line until its newline', async () => {
  const p = tmpFile();
  fs.writeFileSync(p, '');
  const recs = [];
  const tailer = createTailer(p, { intervalMs: 20, onRecords: (r) => recs.push(...r) });
  tailer.start();
  await sleep(50);
  fs.appendFileSync(p, '{"type":"x"');            // partial, no newline
  await sleep(60);
  assert.deepStrictEqual(recs, []);                // nothing emitted yet
  fs.appendFileSync(p, ',"n":9}\n');               // completes the line
  await sleep(70);
  tailer.stop();
  fs.unlinkSync(p);
  assert.deepStrictEqual(recs.map((r) => r.n), [9]);
});

test('createTailer skips unparseable lines without throwing', async () => {
  const p = tmpFile();
  fs.writeFileSync(p, 'not json\n' + JSON.stringify({ n: 5 }) + '\n');
  const recs = [];
  const tailer = createTailer(p, { intervalMs: 20, onRecords: (r) => recs.push(...r) });
  tailer.start();
  await sleep(60);
  tailer.stop();
  fs.unlinkSync(p);
  assert.deepStrictEqual(recs.map((r) => r.n), [5]);
});

test('createTailer tolerates a file that does not exist yet, then appears', async () => {
  const p = tmpFile();
  const recs = [];
  const tailer = createTailer(p, { intervalMs: 20, onRecords: (r) => recs.push(...r) });
  tailer.start();                                  // file absent
  await sleep(50);
  fs.writeFileSync(p, JSON.stringify({ n: 7 }) + '\n');
  await sleep(60);
  tailer.stop();
  fs.unlinkSync(p);
  assert.deepStrictEqual(recs.map((r) => r.n), [7]);
});

test('findTranscriptPath locates <id>.jsonl under projects/*/', () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccdir-'));
  const proj = path.join(claudeDir, 'projects', 'C--some--proj');
  fs.mkdirSync(proj, { recursive: true });
  const id = 'abcdef01-2345-6789-abcd-ef0123456789';
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), '');
  assert.strictEqual(findTranscriptPath(id, { claudeDir }), path.join(proj, `${id}.jsonl`));
  assert.strictEqual(findTranscriptPath('no-such-id', { claudeDir }), null);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
