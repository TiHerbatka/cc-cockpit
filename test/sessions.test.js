const { test } = require('node:test');
const assert = require('node:assert');
const { SessionRegistry } = require('../server/sessions');

// A fake SDK driver mirroring server/sdk.js's createSdkDriver shape. The registry
// registers onMessage/onExit/onError synchronously in create(), so a test drives
// the stream via driver._msg(...) / driver._exit() / driver._error(...).
function makeFakeDriver() {
  const o = { written: [], killed: false, interrupted: false, _msg: null, _exit: null, _error: null };
  o.onMessage = (cb) => { o._msg = cb; };
  o.onExit = (cb) => { o._exit = cb; };
  o.onError = (cb) => { o._error = cb; };
  o.write = (t) => o.written.push(t);
  o.interrupt = () => { o.interrupted = true; };
  o.kill = () => { o.killed = true; };
  return o;
}

function makeRegistry(projectsRoot = 'C:/root') {
  const drivers = [];
  const reg = new SessionRegistry({
    spawnDriver: () => { const d = makeFakeDriver(); drivers.push(d); return d; },
    projectsRoot,
  });
  return { reg, drivers };
}

const asstText = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (usage) => ({ type: 'result', subtype: 'success', usage });
const init = (permissionMode) => ({ type: 'system', subtype: 'init', permissionMode, model: 'm', session_id: 'x' });

test('create reuses the cockpit id as ccSessionId, defaults mode to gui, and passes the id to spawn', () => {
  const calls = [];
  const reg = new SessionRegistry({
    spawnDriver: (cwd, id, opts) => { calls.push({ cwd, id, opts }); return makeFakeDriver(); },
    projectsRoot: 'C:/root',
  });
  const s = reg.create('C:/root/proj');
  assert.match(s.ccSessionId, /^[0-9a-f-]{36}$/i);
  assert.strictEqual(s.ccSessionId, s.id);
  assert.strictEqual(s.mode, 'gui');
  assert.strictEqual(calls[0].opts.ccSessionId, s.ccSessionId);
});

test('create on a resume uses the resumeId as ccSessionId', () => {
  const reg = new SessionRegistry({ spawnDriver: () => makeFakeDriver(), projectsRoot: 'C:/root' });
  const s = reg.create('C:/root/proj', { resumeId: 'resumed-abc-123' });
  assert.strictEqual(s.ccSessionId, 'resumed-abc-123');
});

test('create returns a session labelled by folder basename, status working', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/zabbix');
  assert.strictEqual(s.label, 'zabbix');
  assert.strictEqual(s.status, 'working');
  assert.strictEqual(reg.list().length, 1);
});

test('send forwards text to the driver and marks the session working', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);
  drivers[0]._msg(result({}));               // turn ends -> idle (focused)
  assert.strictEqual(reg.get(s.id).status, 'idle');
  reg.send(s.id, 'hello');
  assert.deepStrictEqual(drivers[0].written, ['hello']);
  assert.strictEqual(reg.get(s.id).status, 'working');
});

test('send echoes the user text into the conversation model and emits an append delta', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  const deltas = [];
  reg.on('delta', (id, ops) => deltas.push(ops));
  reg.send(s.id, 'hello there');
  assert.deepStrictEqual(reg.modelOf(s.id).items, [{ kind: 'user', text: 'hello there' }]);
  assert.ok(deltas.some((ops) => ops.some((o) => o.op === 'append' && o.item.kind === 'user' && o.item.text === 'hello there')));
  assert.deepStrictEqual(drivers[0].written, ['hello there']);
});

test('a result message ends the turn -> your-move when unfocused', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');         // unfocused, working
  drivers[0]._msg(result({}));
  assert.strictEqual(reg.get(s.id).status, 'your-move');
});

test('a result message on the focused session -> idle', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);
  drivers[0]._msg(result({}));
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('an assistant message emits a delta and updates the model', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  const deltas = [];
  reg.on('delta', (id, ops) => deltas.push([id, ops]));
  drivers[0]._msg(asstText('hello'));
  assert.strictEqual(deltas.length, 1);
  assert.strictEqual(deltas[0][0], s.id);
  assert.ok(deltas[0][1].some((o) => o.op === 'append' && o.item.kind === 'assistant' && o.item.text === 'hello'));
  assert.deepStrictEqual(reg.modelOf(s.id).items, [{ kind: 'assistant', text: 'hello' }]);
});

test('an init message emits meta with the permission mode', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  const metas = [];
  reg.on('meta', (id, meta) => metas.push([id, meta]));
  drivers[0]._msg(init('default'));
  assert.deepStrictEqual(metas, [[s.id, { mode: 'default' }]]);
});

test('a result message emits meta with usage', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  const metas = [];
  reg.on('meta', (id, meta) => metas.push(meta));
  drivers[0]._msg(result({ input_tokens: 5 }));
  assert.ok(metas.some((m) => m.usage && m.usage.input_tokens === 5));
});

test('modelOf starts empty and reflects folded messages', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  assert.deepStrictEqual(reg.modelOf(s.id), { title: null, items: [], status: { currentTool: null, todos: null } });
  drivers[0]._msg(asstText('one'));
  assert.strictEqual(reg.modelOf(s.id).items.length, 1);
});

test('markWorking yields working; a focused turn ends to idle', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
  reg.markWorking(s.id);
  assert.strictEqual(reg.get(s.id).status, 'working');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('focusing a your-move session flips it to idle and is sticky', () => {
  const { reg } = makeRegistry();
  const a = reg.create('C:/proj/a');
  const b = reg.create('C:/proj/b');
  reg.acknowledge(b.id);
  reg.markIdle(a.id);
  assert.strictEqual(reg.get(a.id).status, 'your-move');
  reg.acknowledge(a.id);
  assert.strictEqual(reg.get(a.id).status, 'idle');
  reg.acknowledge(b.id);
  assert.strictEqual(reg.get(a.id).status, 'idle');
});

test('redundant turn-end transitions cause no extra sessions broadcast', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);
  let emits = 0;
  reg.on('sessions', () => { emits += 1; });
  reg.markIdle(s.id);
  reg.markIdle(s.id);
  assert.strictEqual(emits, 0);
});

test('signalWaiting marks an unfocused session needs-you; focused yields idle', () => {
  const { reg } = makeRegistry();
  const a = reg.create('C:/proj/a');
  reg.signalWaiting(a.id);
  assert.strictEqual(reg.get(a.id).status, 'needs-you');
  const b = reg.create('C:/proj/b');
  reg.acknowledge(b.id);
  reg.signalWaiting(b.id);
  assert.strictEqual(reg.get(b.id).status, 'idle');
});

test('markWorking clears a pending your-move (next turn started)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'your-move');
  reg.markWorking(s.id);
  assert.strictEqual(reg.get(s.id).status, 'working');
});

test('driver exit marks the session exited and ignores later send/messages', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  drivers[0]._exit();
  assert.strictEqual(reg.get(s.id).status, 'exited');
  reg.send(s.id, 'typed');
  drivers[0]._msg(asstText('late'));
  assert.deepStrictEqual(drivers[0].written, []);          // send ignored after exit
  assert.deepStrictEqual(reg.modelOf(s.id).items, []);     // messages ignored after exit
});

test('all turn transitions are ignored after exit', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  drivers[0]._exit();
  reg.markWorking(s.id);
  reg.markIdle(s.id);
  reg.signalWaiting(s.id);
  reg.acknowledge(s.id);
  assert.strictEqual(reg.get(s.id).status, 'exited');
});

test('driver error is surfaced as a session-error event', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/proj/a');
  const errs = [];
  reg.on('session-error', (id, msg) => errs.push([id, msg]));
  drivers[0]._error(new Error('spawn boom'));
  assert.deepStrictEqual(errs, [[s.id, 'spawn boom']]);
});

test('projectOf returns the first segment under the projects root, else null', () => {
  const { reg } = makeRegistry('C:/root');
  assert.strictEqual(reg.projectOf('C:/root/alpha'), 'alpha');
  assert.strictEqual(reg.projectOf('C:/root/alpha/sub/dir'), 'alpha');
  assert.strictEqual(reg.projectOf('C:/root'), null);
  assert.strictEqual(reg.projectOf('C:/elsewhere/x'), null);
});

test('create exposes the derived project on the public session', () => {
  const { reg } = makeRegistry('C:/root');
  const a = reg.create('C:/root/alpha');
  const b = reg.create('C:/elsewhere/zz');
  assert.strictEqual(reg.get(a.id).project, 'alpha');
  assert.strictEqual(reg.get(b.id).project, null);
});

test('a session under the temp dir is exposed as temp (project null)', () => {
  const { reg } = makeRegistry('C:/root');
  const t = reg.create('C:/root/_temporary-sessions/2026-01-01_000000');
  const pub = reg.get(t.id);
  assert.strictEqual(pub.temp, true);
  assert.strictEqual(pub.project, null);
  const n = reg.create('C:/root/alpha');
  assert.strictEqual(reg.get(n.id).temp, false);
});

test('setAutoTitle updates the label, but a rename (customName) wins', () => {
  const { reg } = makeRegistry('C:/root');
  const t = reg.create('C:/root/_temporary-sessions/x');
  assert.strictEqual(reg.get(t.id).label, 'x');
  reg.setAutoTitle(t.id, 'Fix the thing');
  assert.strictEqual(reg.get(t.id).label, 'Fix the thing');
  reg.rename(t.id, 'My name');
  assert.strictEqual(reg.get(t.id).label, 'My name');
  reg.rename(t.id, '   ');
  assert.strictEqual(reg.get(t.id).label, 'Fix the thing');
});

test('rename a normal session emits sessions only when the label changes', () => {
  const { reg } = makeRegistry('C:/root');
  const s = reg.create('C:/root/alpha');
  let emits = 0; reg.on('sessions', () => { emits += 1; });
  reg.rename(s.id, 'Renamed');
  assert.strictEqual(reg.get(s.id).label, 'Renamed');
  assert.strictEqual(emits, 1);
  reg.rename(s.id, 'Renamed');
  assert.strictEqual(emits, 1);
});

test('setTopics stores topics and emits sessions only on change', () => {
  const { reg } = makeRegistry('C:/root');
  const s = reg.create('C:/root/p');
  assert.deepStrictEqual(reg.get(s.id).topics, []);
  let emitted = 0; reg.on('sessions', () => { emitted += 1; });
  reg.setTopics(s.id, [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]);
  assert.strictEqual(reg.get(s.id).topics.length, 1);
  assert.strictEqual(emitted, 1);
  reg.setTopics(s.id, [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]);
  assert.strictEqual(emitted, 1);
});

test('remove kills a live session, deletes it, clears focus, and broadcasts', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/root/alpha');
  reg.acknowledge(s.id);
  let emitted = 0; reg.on('sessions', () => { emitted += 1; });
  reg.remove(s.id);
  assert.strictEqual(drivers[0].killed, true);
  assert.strictEqual(reg.get(s.id), null);
  assert.strictEqual(reg.focusedId, null);
  assert.strictEqual(emitted, 1);
  assert.strictEqual(reg.list().length, 0);
});

test('remove on an exited session just deletes it (no kill needed)', () => {
  const { reg, drivers } = makeRegistry();
  const s = reg.create('C:/root/alpha');
  drivers[0]._exit();
  drivers[0].killed = false;
  reg.remove(s.id);
  assert.strictEqual(drivers[0].killed, false);
  assert.strictEqual(reg.get(s.id), null);
});

test('remove on an unknown id is a no-op', () => {
  const { reg } = makeRegistry();
  let emitted = 0; reg.on('sessions', () => { emitted += 1; });
  reg.remove('nope');
  assert.strictEqual(emitted, 0);
});
