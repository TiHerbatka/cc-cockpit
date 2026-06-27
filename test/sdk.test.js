const { test } = require('node:test');
const assert = require('node:assert');
const { sdkMessageToRecords, scrubChildEnv } = require('../server/sdk');

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
