const { test } = require('node:test');
const assert = require('node:assert');
const { sdkMessageToRecords, scrubChildEnv, createSdkDriver } = require('../server/sdk');

test('sdkMessageToRecords maps assistant and user messages, ignores the rest', () => {
  assert.deepStrictEqual(
    sdkMessageToRecords({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    [{ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }],
  );
  assert.deepStrictEqual(
    sdkMessageToRecords({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }),
    [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }],
  );
  assert.deepStrictEqual(sdkMessageToRecords({ type: 'system', subtype: 'init' }), []);
  assert.deepStrictEqual(sdkMessageToRecords({ type: 'result', subtype: 'success' }), []);
  assert.deepStrictEqual(sdkMessageToRecords({ type: 'rate_limit_event' }), []);
  assert.deepStrictEqual(sdkMessageToRecords(null), []);
});

test('scrubChildEnv removes parent markers and direct-auth overrides, keeps PATH', () => {
  const env = scrubChildEnv({
    PATH: '/usr/bin', USERPROFILE: 'C:/Users/x',
    CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_EFFORT: 'high', AI_AGENT: '1',
    ANTHROPIC_API_KEY: 'sk-xxx', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'https://x',
  });
  assert.strictEqual(env.PATH, '/usr/bin');
  assert.strictEqual(env.USERPROFILE, 'C:/Users/x');
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_EFFORT', 'AI_AGENT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) {
    assert.ok(!(k in env), `${k} should be stripped`);
  }
});

// ---- createSdkDriver (fake query injected; no real claude) ----

test('driver relays SDK messages in order and fires onExit at the end', async () => {
  const fakeQuery = () => (async function* () {
    yield { type: 'system', subtype: 'init', session_id: 's', model: 'm', permissionMode: 'default' };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    yield { type: 'result', subtype: 'success', usage: {} };
  })();
  const got = [];
  const d = createSdkDriver('C:/x', 'id1', {}, { query: fakeQuery });
  d.onMessage((m) => got.push(m.type));
  await new Promise((r) => d.onExit(r));
  assert.deepStrictEqual(got, ['system', 'assistant', 'result']);
});

test('write delivers a wrapped streaming user message to the query input', async () => {
  let resolveGot; const got = new Promise((r) => { resolveGot = r; });
  const fakeQuery = ({ prompt }) => {
    (async () => { for await (const u of prompt) { resolveGot(u); break; } })();
    return (async function* () { await new Promise(() => {}); })(); // stays open
  };
  const d = createSdkDriver('C:/x', 'id', {}, { query: fakeQuery });
  d.write('hello');
  const u = await got;
  assert.deepStrictEqual(u, { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null });
  d.kill();
});

test('canUseTool parks a gated tool, surfaces it via onPermission, resolves on allow', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  const reqs = [];
  d.onPermission((r) => reqs.push(r));
  const p = canUse('Write', { file_path: 'a' }, { toolUseID: 't1', suggestions: [{ type: 'addRule' }] });
  assert.deepStrictEqual(reqs, [{ toolName: 'Write', input: { file_path: 'a' }, toolUseId: 't1', suggestions: [{ type: 'addRule' }] }]);
  d.answerPermission('t1', 'allow');
  assert.deepStrictEqual(await p, { behavior: 'allow', updatedInput: { file_path: 'a' } });
});

test('answerPermission maps deny and allow-always to the right PermissionResult', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  d.onPermission(() => {});
  const pDeny = canUse('Bash', { command: 'x' }, { toolUseID: 'd1' });
  d.answerPermission('d1', 'deny');
  assert.deepStrictEqual(await pDeny, { behavior: 'deny', message: 'Denied by the user.' });
  const pAlways = canUse('Bash', { command: 'y' }, { toolUseID: 'a1', suggestions: [{ type: 'addRule', x: 1 }] });
  d.answerPermission('a1', 'allow-always');
  assert.deepStrictEqual(await pAlways, { behavior: 'allow', updatedInput: { command: 'y' }, updatedPermissions: [{ type: 'addRule', x: 1 }] });
});

test('canUseTool declines AskUserQuestion / ExitPlanMode without parking', async () => {
  let canUse;
  createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  assert.strictEqual((await canUse('AskUserQuestion', { questions: [] }, {})).behavior, 'deny');
  assert.strictEqual((await canUse('ExitPlanMode', {}, {})).behavior, 'deny');
});

test('setPermissionMode / setModel / interrupt call through to the query object', () => {
  const calls = [];
  const fakeQ = Object.assign((async function* () {})(), {
    setPermissionMode: (m) => calls.push(['mode', m]),
    setModel: (m) => calls.push(['model', m]),
    interrupt: () => calls.push(['interrupt']),
  });
  const d = createSdkDriver('C:/x', 'id', {}, { query: () => fakeQ });
  d.setPermissionMode('plan'); d.setModel('claude-sonnet-4-6'); d.interrupt();
  assert.deepStrictEqual(calls, [['mode', 'plan'], ['model', 'claude-sonnet-4-6'], ['interrupt']]);
});

test('createSdkDriver builds subscription-only options (scrubbed env, settingSources, resume)', () => {
  let opts;
  const fakeQuery = (args) => { opts = args.options; return (async function* () {})(); };
  process.env.CLAUDECODE = '1'; // simulate a leaked parent marker
  createSdkDriver('C:/work', 'id', { resumeId: 'r1' }, { query: fakeQuery });
  delete process.env.CLAUDECODE;
  assert.strictEqual(opts.cwd, 'C:/work');
  assert.ok(!('CLAUDECODE' in opts.env), 'parent marker scrubbed');
  assert.ok(!('ANTHROPIC_API_KEY' in opts.env), 'auth override scrubbed');
  assert.deepStrictEqual(opts.settingSources, ['user', 'project', 'local']);
  assert.strictEqual(opts.resume, 'r1');
  assert.strictEqual(opts.permissionMode, 'default');
  assert.ok(opts.abortController instanceof AbortController);
});
