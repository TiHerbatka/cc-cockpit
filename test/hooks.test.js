const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { hookSettings } = require('../server/hooks');

function assertStateEntry(cmd, state) {
  assert.strictEqual(cmd.type, 'command');
  assert.strictEqual(cmd.command, 'powershell.exe');
  assert.strictEqual(cmd.async, true);
  const fileArg = cmd.args[cmd.args.indexOf('-File') + 1];
  assert.ok(path.isAbsolute(fileArg), `expected absolute path, got ${fileArg}`);
  assert.match(fileArg, /cockpit-hook\.ps1$/);
  const stateArg = cmd.args[cmd.args.indexOf('-State') + 1];
  assert.strictEqual(stateArg, state, `expected -State ${state}, got ${stateArg}`);
}

test('UserPromptSubmit hook is matcher-less and signals working', () => {
  const s = hookSettings();
  const entry = s.hooks.UserPromptSubmit[0];
  assert.strictEqual(entry.matcher, undefined);
  assertStateEntry(entry.hooks[0], 'working');
});

test('Stop hook is matcher-less and signals idle', () => {
  const s = hookSettings();
  const entry = s.hooks.Stop[0];
  assert.strictEqual(entry.matcher, undefined);
  assertStateEntry(entry.hooks[0], 'idle');
});

test('Notification splits idle_prompt -> idle and permission_prompt -> needs-you', () => {
  const s = hookSettings();
  const idle = s.hooks.Notification.find((e) => e.matcher === 'idle_prompt');
  const perm = s.hooks.Notification.find((e) => e.matcher === 'permission_prompt');
  assert.ok(idle, 'expected an idle_prompt entry');
  assert.ok(perm, 'expected a permission_prompt entry');
  assertStateEntry(idle.hooks[0], 'idle');
  assertStateEntry(perm.hooks[0], 'needs-you');
});

test('PreToolUse hook is matcher-less, non-blocking notify, runs cockpit-pretooluse.ps1', () => {
  const s = hookSettings();
  const entry = s.hooks.PreToolUse[0];
  assert.strictEqual(entry.matcher, undefined);
  const cmd = entry.hooks[0];
  assert.strictEqual(cmd.type, 'command');
  assert.strictEqual(cmd.command, 'powershell.exe');
  assert.strictEqual(cmd.async, true);             // non-blocking: native prompt still shows
  const fileArg = cmd.args[cmd.args.indexOf('-File') + 1];
  assert.ok(path.isAbsolute(fileArg), `expected absolute path, got ${fileArg}`);
  assert.match(fileArg, /cockpit-pretooluse\.ps1$/);
  assert.strictEqual(cmd.args.indexOf('-State'), -1); // reads stdin, not a -State arg
});

test('hookSettings contains only a hooks block (must not clobber other user settings)', () => {
  const s = hookSettings();
  assert.deepStrictEqual(Object.keys(s), ['hooks']);
});
