const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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

test('canUseTool parks a gated tool as a permission interaction; allow resolves it', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  const reqs = [];
  d.onInteraction((r) => reqs.push(r));
  const p = canUse('Write', { file_path: 'a' }, { toolUseID: 't1', suggestions: [{ type: 'addRules' }] });
  assert.deepStrictEqual(reqs, [{ requestId: 't1', kind: 'permission', toolName: 'Write', input: { file_path: 'a' }, suggestions: [{ type: 'addRules' }] }]);
  d.answerInteraction('t1', 'allow');
  assert.deepStrictEqual(await p, { behavior: 'allow', updatedInput: { file_path: 'a' } });
});

test('answerInteraction maps permission deny and allow-always', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  d.onInteraction(() => {});
  const pDeny = canUse('Bash', { command: 'x' }, { toolUseID: 'd1' });
  d.answerInteraction('d1', 'deny');
  assert.deepStrictEqual(await pDeny, { behavior: 'deny', message: 'Denied by the user.' });
  const pAlways = canUse('Bash', { command: 'y' }, { toolUseID: 'a1', suggestions: [{ type: 'addRules', x: 1 }] });
  d.answerInteraction('a1', 'allow-always');
  assert.deepStrictEqual(await pAlways, { behavior: 'allow', updatedInput: { command: 'y' }, updatedPermissions: [{ type: 'addRules', x: 1 }] });
});

test('AskUserQuestion resolves with answers as a record keyed by question text', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  const reqs = [];
  d.onInteraction((r) => reqs.push(r));
  const questions = [{ question: 'Pick?', header: 'X', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }];
  const p = canUse('AskUserQuestion', { questions }, { toolUseID: 'q1' });
  assert.strictEqual(reqs[0].kind, 'question');
  assert.deepStrictEqual(reqs[0].questions, questions);
  d.answerInteraction('q1', { answers: [{ question: 'Pick?', answer: 'A' }] });
  assert.deepStrictEqual(await p, { behavior: 'allow', updatedInput: { questions, answers: { 'Pick?': 'A' } } });
});

test('AskUserQuestion multi-select answers are comma-joined in the record', async () => {
  let canUse;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return (async function* () {})(); } });
  d.onInteraction(() => {});
  const p = canUse('AskUserQuestion', { questions: [] }, { toolUseID: 'q2' });
  d.answerInteraction('q2', { answers: [{ question: 'Which?', answer: ['X', 'Y'] }] });
  assert.deepStrictEqual((await p).updatedInput.answers, { 'Which?': 'X, Y' });
});

test('ExitPlanMode parks as kind plan; approve/keep-planning/approve-auto resolve correctly', async () => {
  let canUse;
  const modes = [];
  const fakeQ = Object.assign((async function* () {})(), { setPermissionMode: (m) => modes.push(m) });
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { canUse = a.options.canUseTool; return fakeQ; } });
  const reqs = [];
  d.onInteraction((r) => reqs.push(r));
  const pApprove = canUse('ExitPlanMode', { plan: 'do X' }, { toolUseID: 'pl1' });
  assert.strictEqual(reqs[0].kind, 'plan');
  assert.strictEqual(reqs[0].plan, 'do X');
  d.answerInteraction('pl1', 'approve');
  assert.strictEqual((await pApprove).behavior, 'allow');
  const pKeep = canUse('ExitPlanMode', { plan: 'y' }, { toolUseID: 'pl2' });
  d.answerInteraction('pl2', 'keep-planning');
  assert.strictEqual((await pKeep).behavior, 'deny');
  const pAuto = canUse('ExitPlanMode', { plan: 'z' }, { toolUseID: 'pl3' });
  d.answerInteraction('pl3', 'approve-auto');
  assert.strictEqual((await pAuto).behavior, 'allow');
  assert.deepStrictEqual(modes, ['acceptEdits']);
});

test('onElicitation parks as kind elicitation and resolves with the ElicitResult', async () => {
  let onElic;
  const d = createSdkDriver('C:/x', 'id', {}, { query: (a) => { onElic = a.options.onElicitation; return (async function* () {})(); } });
  const reqs = [];
  d.onInteraction((r) => reqs.push(r));
  const p = onElic({ serverName: 'srv', message: 'Need input', mode: 'form', elicitationId: 'e1' });
  assert.strictEqual(reqs[0].kind, 'elicitation');
  assert.strictEqual(reqs[0].request.message, 'Need input');
  d.answerInteraction('e1', { action: 'accept', content: { name: 'Bob' } });
  assert.deepStrictEqual(await p, { action: 'accept', content: { name: 'Bob' } });
});

test('setPermissionMode / setModel / setEffort / interrupt call through to the query object', () => {
  const calls = [];
  const fakeQ = Object.assign((async function* () {})(), {
    setPermissionMode: (m) => calls.push(['mode', m]),
    setModel: (m) => calls.push(['model', m]),
    applyFlagSettings: (s) => calls.push(['effort', s.effort]),
    interrupt: () => calls.push(['interrupt']),
  });
  const d = createSdkDriver('C:/x', 'id', {}, { query: () => fakeQ });
  d.setPermissionMode('plan'); d.setModel('claude-sonnet-4-6'); d.setEffort('high'); d.interrupt();
  assert.deepStrictEqual(calls, [['mode', 'plan'], ['model', 'claude-sonnet-4-6'], ['effort', 'high'], ['interrupt']]);
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
  assert.strictEqual(opts.allowDangerouslySkipPermissions, true);
  assert.ok(opts.abortController instanceof AbortController);
});

// ---- usage wrappers (the C1 5h/7d/context chip path; fake query injected) ----

test('getUsage / getContextUsage call through to the query object and return its value', async () => {
  const fakeQ = Object.assign((async function* () {})(), {
    getContextUsage: async () => ({ percentLeft: 42 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ five_hour: { utilization: 0.3 } }),
  });
  const d = createSdkDriver('C:/x', 'id', {}, { query: () => fakeQ });
  assert.deepStrictEqual(await d.getContextUsage(), { percentLeft: 42 });
  assert.deepStrictEqual(await d.getUsage(), { five_hour: { utilization: 0.3 } });
});

test('getUsage / getContextUsage degrade to null when the methods throw', async () => {
  const fakeQ = Object.assign((async function* () {})(), {
    getContextUsage: async () => { throw new Error('boom'); },
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => { throw new Error('boom'); },
  });
  const d = createSdkDriver('C:/x', 'id', {}, { query: () => fakeQ });
  assert.strictEqual(await d.getContextUsage(), null);
  assert.strictEqual(await d.getUsage(), null);
});

test('getUsage / getContextUsage degrade to null when the query object lacks the methods', async () => {
  const d = createSdkDriver('C:/x', 'id', {}, { query: () => (async function* () {})() });
  assert.strictEqual(await d.getContextUsage(), null);
  assert.strictEqual(await d.getUsage(), null);
});

// ---- contract smoke test against the REAL installed SDK (skips if absent) ----
// Converts the otherwise-fully-mocked SDK contract into a regression guard: if a
// dependency bump renames an option/method the driver relies on (e.g. the
// experimental usage method), this fails loudly instead of the chip silently
// going blank or a control silently no-opping.

test('smoke: the installed Agent SDK exposes query()', () => {
  let sdk;
  try { sdk = require('@anthropic-ai/claude-agent-sdk'); }
  catch { return; } // SDK (or a peer dep) not installed — nothing to verify here
  assert.strictEqual(typeof sdk.query, 'function', 'the SDK must export query()');
});

test('contract: the SDK type surface still declares the methods/options the driver depends on', () => {
  let entry;
  try { entry = require.resolve('@anthropic-ai/claude-agent-sdk'); }
  catch { return; } // SDK not installed — skip rather than fail
  let dts = '';
  try {
    const dir = path.dirname(entry);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.d.ts')) dts += fs.readFileSync(path.join(dir, f), 'utf8');
    }
  } catch { return; } // can't read the shipped types — skip
  if (!dts) return;
  for (const name of [
    'setPermissionMode', 'setModel', 'applyFlagSettings', 'getContextUsage', 'interrupt',
    'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET',
    'settingSources', 'canUseTool', 'onElicitation', 'allowDangerouslySkipPermissions',
  ]) {
    assert.ok(dts.includes(name), `SDK type surface should still declare "${name}" (server/sdk.js depends on it)`);
  }
});
