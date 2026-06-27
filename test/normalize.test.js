const { test } = require('node:test');
const assert = require('node:assert');
const { normalize, createConversation } = require('../server/normalize');

const userMsg = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const asst = (content) => ({ type: 'assistant', message: { role: 'assistant', content } });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const toolResultMsg = (id, text, isErr = false) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isErr }] },
});

test('human prompt becomes a user item; system-reminder-prefixed content is ignored', () => {
  const m = normalize([userMsg('Hello there'), userMsg('<system-reminder>noise</system-reminder>')]);
  assert.deepStrictEqual(m.items, [{ kind: 'user', text: 'Hello there' }]);
});

test('assistant text + thinking split into ordered items', () => {
  const m = normalize([asst([
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Doing it.' },
  ])]);
  assert.deepStrictEqual(m.items, [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'assistant', text: 'Doing it.' },
  ]);
});

test('tool_use merges with its tool_result and resolves status ok', () => {
  const m = normalize([
    asst([toolUse('t1', 'Bash', { command: 'ls' })]),
    toolResultMsg('t1', 'file1\nfile2'),
  ]);
  assert.deepStrictEqual(m.items, [
    { kind: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'ok', resultText: 'file1\nfile2' },
  ]);
  assert.strictEqual(m.status.currentTool, null);
});

test('a pending tool (no result yet) is the currentTool', () => {
  const m = normalize([asst([toolUse('t9', 'Read', { file_path: 'a.js' })])]);
  assert.strictEqual(m.items[0].status, 'pending');
  assert.deepStrictEqual(m.status.currentTool, { name: 'Read', input: { file_path: 'a.js' } });
});

test('is_error result yields error status', () => {
  const m = normalize([asst([toolUse('t2', 'Bash', { command: 'boom' })]), toolResultMsg('t2', 'nope', true)]);
  assert.strictEqual(m.items[0].status, 'error');
});

test('TodoWrite produces a todos item and the latest status.todos', () => {
  const todos = [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }];
  const m = normalize([asst([toolUse('t3', 'TodoWrite', { todos })])]);
  const todoItem = m.items.find((i) => i.kind === 'todos');
  assert.deepStrictEqual(todoItem.todos, todos);
  assert.deepStrictEqual(m.status.todos, todos);
});

test('ai-title sets the title (last one wins)', () => {
  const m = normalize([{ type: 'ai-title', aiTitle: 'First' }, { type: 'ai-title', aiTitle: 'Final' }]);
  assert.strictEqual(m.title, 'Final');
});

test('array-form user text (content blocks) is read as a prompt', () => {
  const m = normalize([{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hi from array' }] } }]);
  assert.deepStrictEqual(m.items, [{ kind: 'user', text: 'Hi from array' }]);
});

test('empty/whitespace assistant text blocks are dropped', () => {
  const m = normalize([asst([{ type: 'text', text: '   ' }, { type: 'text', text: 'real' }])]);
  assert.deepStrictEqual(m.items, [{ kind: 'assistant', text: 'real' }]);
});

// This environment's sessions use the TaskCreate/TaskUpdate tool system (not the
// native TodoWrite). The assigned id comes back in the TaskCreate *result*; later
// TaskUpdate references it. The normalizer reconstructs the live list.
const taskCreateUse = (id, subject) => asst([toolUse(id, 'TaskCreate', { subject })]);
const taskCreateRes = (id, n, subject) => toolResultMsg(id, `Task #${n} created successfully: ${subject}`);
const taskUpdate = (id, taskId, status) => asst([toolUse(id, 'TaskUpdate', { taskId, status })]);

test('Task* create/update aggregate into status.todos (id from the create result)', () => {
  const m = normalize([
    taskCreateUse('u1', 'Build X'), taskCreateRes('u1', 1, 'Build X'),
    taskCreateUse('u2', 'Test Y'), taskCreateRes('u2', 2, 'Test Y'),
    taskUpdate('u3', '1', 'in_progress'),
  ]);
  assert.deepStrictEqual(m.status.todos, [
    { content: 'Build X', status: 'in_progress' },
    { content: 'Test Y', status: 'pending' },
  ]);
});

test('TaskUpdate deleted removes the task; an empty Task list is [] not null', () => {
  const m = normalize([taskCreateUse('u1', 'A'), taskCreateRes('u1', 1, 'A'), taskUpdate('u2', '1', 'deleted')]);
  assert.deepStrictEqual(m.status.todos, []);
});

test('unknown record types are ignored', () => {
  const m = normalize([{ type: 'file-history-snapshot' }, { type: 'mode', mode: 'normal' }, userMsg('ok')]);
  assert.deepStrictEqual(m.items, [{ kind: 'user', text: 'ok' }]);
});

// ---- Incremental conversation fold (createConversation) ----

test('applyRecord appends a user item and returns just an append op', () => {
  const c = createConversation();
  const ops = c.applyRecord(userMsg('Hello'));
  assert.deepStrictEqual(c.model.items, [{ kind: 'user', text: 'Hello' }]);
  assert.deepStrictEqual(ops, [{ op: 'append', item: { kind: 'user', text: 'Hello' } }]);
});

test('a system-reminder-prefixed prompt yields no ops', () => {
  const c = createConversation();
  const ops = c.applyRecord(userMsg('<system-reminder>noise</system-reminder>'));
  assert.deepStrictEqual(ops, []);
  assert.deepStrictEqual(c.model.items, []);
});

test('applyRecord on ai-title returns a title op and sets the model title', () => {
  const c = createConversation();
  const ops = c.applyRecord({ type: 'ai-title', aiTitle: 'My Title' });
  assert.deepStrictEqual(ops, [{ op: 'title', title: 'My Title' }]);
  assert.strictEqual(c.model.title, 'My Title');
});

test('a tool_use then its tool_result updates the same item in place by id', () => {
  const c = createConversation();
  c.applyRecord(asst([toolUse('t1', 'Read', { file_path: 'a' })]));
  assert.strictEqual(c.model.items[0].status, 'pending');
  assert.deepStrictEqual(c.model.status.currentTool, { name: 'Read', input: { file_path: 'a' } });
  const ops = c.applyRecord(toolResultMsg('t1', 'FILE'));
  const tool = c.model.items.find((i) => i.kind === 'tool');
  assert.strictEqual(tool.status, 'ok');
  assert.strictEqual(tool.resultText, 'FILE');
  assert.ok(ops.some((o) => o.op === 'update' && o.id === 't1' && o.patch.status === 'ok' && o.patch.resultText === 'FILE'));
  // resolving the pending tool clears currentTool -> a status op rides along
  assert.ok(ops.some((o) => o.op === 'status' && o.status.currentTool === null));
});

test('appending a tool_use emits a status op reflecting the new currentTool', () => {
  const c = createConversation();
  const ops = c.applyRecord(asst([toolUse('t2', 'Bash', { command: 'ls' })]));
  assert.ok(ops.some((o) => o.op === 'append' && o.item.kind === 'tool'));
  assert.ok(ops.some((o) => o.op === 'status' && o.status.currentTool && o.status.currentTool.name === 'Bash'));
});

test('seed folds a batch and matches the legacy normalize output', () => {
  const records = [
    userMsg('hi'),
    asst([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hello' }]),
    asst([toolUse('t1', 'Bash', { command: 'ls' })]),
    toolResultMsg('t1', 'out'),
    { type: 'ai-title', aiTitle: 'T' },
  ];
  assert.deepStrictEqual(createConversation().seed(records), normalize(records));
});
