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

test('canUseTool allows normal tools and declines AskUserQuestion / ExitPlanMode', async () => {
  let canUse;
  const fakeQuery = (args) => { canUse = args.options.canUseTool; return (async function* () {})(); };
  createSdkDriver('C:/x', 'id', {}, { query: fakeQuery });
  assert.deepStrictEqual(await canUse('Write', { file_path: 'a' }), { behavior: 'allow', updatedInput: { file_path: 'a' } });
  assert.strictEqual((await canUse('AskUserQuestion', { questions: [] })).behavior, 'deny');
  assert.strictEqual((await canUse('ExitPlanMode', {})).behavior, 'deny');
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
