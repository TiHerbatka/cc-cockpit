const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnClaude, resolveExecutable, buildSpawn } = require('../server/pty');

test('adapter streams output and reports exit (using node as a stand-in)', async () => {
  const handle = spawnClaude(process.cwd(), {
    command: process.execPath,            // node
    args: ['-e', "process.stdout.write('PTYOK')"],
  });
  let out = '';
  await new Promise((resolve) => {
    handle.onData((d) => { out += d; });
    handle.onExit(() => resolve());
  });
  assert.ok(out.includes('PTYOK'), `expected output to include PTYOK, got: ${JSON.stringify(out)}`);
});

// Regression: node-pty's Windows PATH search does NOT apply PATHEXT, so a bare
// command like `claude` (real file `claude.exe`) fails with "File not found:".
// resolveExecutable must resolve a bare name to its real on-disk path.
test('resolveExecutable resolves a bare PATH command to its real .exe on Windows',
  { skip: process.platform !== 'win32' }, () => {
    const resolved = resolveExecutable('node'); // on PATH only as node.exe
    assert.ok(path.isAbsolute(resolved), `expected absolute path, got: ${resolved}`);
    assert.ok(fs.existsSync(resolved), `expected an existing file, got: ${resolved}`);
    assert.match(resolved.toLowerCase(), /[\\/]node\.exe$/);
  });

test('resolveExecutable returns an absolute path unchanged', () => {
  assert.strictEqual(resolveExecutable(process.execPath), process.execPath);
});

test('buildSpawn appends --settings and sets cockpit env vars', () => {
  const r = buildSpawn({
    command: process.execPath,         // absolute -> returned as-is by resolveExecutable
    args: ['--no-warnings'],
    settingsPath: 'C:/cc/cockpit-settings.generated.json',
    sessionId: 'sess-123',
    port: 4477,
  });
  assert.strictEqual(r.file, process.execPath);
  assert.deepStrictEqual(r.args, ['--no-warnings', '--settings', 'C:/cc/cockpit-settings.generated.json']);
  assert.strictEqual(r.env.CC_COCKPIT_SESSION, 'sess-123');
  assert.strictEqual(r.env.CC_COCKPIT_PORT, '4477');
});

test('buildSpawn omits --settings and env when not provided', () => {
  const r = buildSpawn({ command: process.execPath });
  assert.deepStrictEqual(r.args, []);
  assert.strictEqual(r.env.CC_COCKPIT_SESSION, undefined);
  assert.strictEqual(r.env.CC_COCKPIT_PORT, undefined);
});

test('buildSpawn includes --resume before --settings when resumeId is given', () => {
  const r = buildSpawn({
    command: process.execPath,
    settingsPath: 'C:/cc/cockpit-settings.generated.json',
    sessionId: 'sess-1',
    port: 4477,
    resumeId: 'claude-abc',
  });
  assert.deepStrictEqual(r.args, ['--resume', 'claude-abc', '--settings', 'C:/cc/cockpit-settings.generated.json']);
});

test('buildSpawn omits --resume when no resumeId', () => {
  const r = buildSpawn({ command: process.execPath, settingsPath: 'C:/x.json' });
  assert.deepStrictEqual(r.args, ['--settings', 'C:/x.json']);
});

// GUI mode (B1): the cockpit passes a deterministic --session-id so it knows the
// exact transcript path (<id>.jsonl) to tail. Fresh sessions only — a --resume
// carries its own id, so the two are mutually exclusive.
test('buildSpawn appends --session-id (ccSessionId) for a fresh session', () => {
  const r = buildSpawn({
    command: process.execPath,
    ccSessionId: '11111111-2222-3333-4444-555555555555',
    settingsPath: 'C:/x.json',
  });
  assert.deepStrictEqual(r.args, ['--session-id', '11111111-2222-3333-4444-555555555555', '--settings', 'C:/x.json']);
});

test('buildSpawn omits --session-id when resuming (resume carries its own id)', () => {
  const r = buildSpawn({
    command: process.execPath,
    ccSessionId: 'should-be-ignored',
    resumeId: 'claude-abc',
    settingsPath: 'C:/x.json',
  });
  assert.deepStrictEqual(r.args, ['--resume', 'claude-abc', '--settings', 'C:/x.json']);
});

// Regression (TODO B2): when the cockpit server is launched from within a Claude
// Code session, it inherits that session's injected markers — notably
// CLAUDE_CODE_CHILD_SESSION=1, which makes a *nested* claude treat itself as a
// child session and write NO transcript to ~/.claude/projects. Copying the whole
// process.env into the spawn leaked those markers into every cockpit session, so
// none persisted (breaking Resume discovery, "never used" projects, temp naming).
// buildSpawn must scrub the parent Claude Code session env so each spawned claude
// behaves like a fresh top-level launch.
test('buildSpawn scrubs inherited parent Claude Code session env vars', () => {
  const leaked = {
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_EXECPATH: 'C:/whatever/claude.exe',
    CLAUDE_CODE_SESSION_ID: 'parent-session-id',
    CLAUDE_EFFORT: 'xhigh',
    AI_AGENT: 'claude-code_x_agent',
  };
  const saved = {};
  for (const k of Object.keys(leaked)) { saved[k] = process.env[k]; process.env[k] = leaked[k]; }
  try {
    const r = buildSpawn({ command: process.execPath, sessionId: 'sess-1', port: 4477 });
    for (const k of Object.keys(leaked)) {
      assert.strictEqual(r.env[k], undefined, `expected inherited ${k} to be scrubbed from spawn env`);
    }
    // cockpit's own vars and unrelated env must survive the scrub.
    assert.strictEqual(r.env.CC_COCKPIT_SESSION, 'sess-1');
    assert.strictEqual(r.env.CC_COCKPIT_PORT, '4477');
    assert.ok((r.env.Path || r.env.PATH), 'expected PATH to be preserved');
  } finally {
    for (const k of Object.keys(leaked)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});
