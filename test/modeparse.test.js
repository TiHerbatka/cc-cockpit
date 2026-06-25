const { test } = require('node:test');
const assert = require('node:assert');
const { parseClaudeMode } = require('../public/modeparse');

test('detects accept edits', () => {
  assert.strictEqual(parseClaudeMode('⏵⏵ accept edits on (shift+tab to cycle) · ← for agents'), 'accept edits');
});
test('detects plan mode', () => {
  assert.strictEqual(parseClaudeMode('⏸ plan mode on (shift+tab to cycle)'), 'plan');
});
test('detects auto mode', () => {
  assert.strictEqual(parseClaudeMode('⏵⏵ auto mode on (shift+tab to cycle)'), 'auto');
});
test('no banner => normal', () => {
  assert.strictEqual(parseClaudeMode('← for agents | 5h 53% (26m/14:40) | 7d 1%'), 'normal');
  assert.strictEqual(parseClaudeMode(''), 'normal');
});
test('a banner anywhere in the footer region wins', () => {
  assert.strictEqual(parseClaudeMode('some older line\n⏵⏵ accept edits on (shift+tab to cycle)\n  status'), 'accept edits');
});
