const { test } = require('node:test');
const assert = require('node:assert');
const { SessionRegistry } = require('../server/sessions');

function makeFakePty() {
  const o = { _data: null, _exit: null, written: [], resized: [] };
  o.onData = (cb) => { o._data = cb; };
  o.onExit = (cb) => { o._exit = cb; };
  o.write = (d) => o.written.push(d);
  o.resize = (cols, rows) => o.resized.push([cols, rows]);
  o.kill = () => { o.killed = true; };
  return o;
}

function makeRegistry(projectsRoot = 'C:/root') {
  const ptys = [];
  const reg = new SessionRegistry({
    spawnPty: () => { const p = makeFakePty(); ptys.push(p); return p; },
    projectsRoot,
  });
  return { reg, ptys };
}

test('create reuses the cockpit id as ccSessionId, defaults mode to gui, and passes the id to spawn', () => {
  const calls = [];
  const reg = new SessionRegistry({
    spawnPty: (cwd, id, opts) => { calls.push({ cwd, id, opts }); return makeFakePty(); },
    projectsRoot: 'C:/root',
  });
  const s = reg.create('C:/root/proj');
  assert.match(s.ccSessionId, /^[0-9a-f-]{36}$/i);
  assert.strictEqual(s.ccSessionId, s.id);          // fresh session: ccSessionId === cockpit id
  assert.strictEqual(s.mode, 'gui');                // GUI is the default mode
  assert.strictEqual(calls[0].opts.ccSessionId, s.ccSessionId); // forwarded to the spawn
});

test('create on a resume uses the resumeId as ccSessionId', () => {
  const reg = new SessionRegistry({ spawnPty: () => makeFakePty(), projectsRoot: 'C:/root' });
  const s = reg.create('C:/root/proj', { resumeId: 'resumed-abc-123' });
  assert.strictEqual(s.ccSessionId, 'resumed-abc-123');
});

test('setMode updates the session mode (gui/terminal) and emits sessions only on change', () => {
  const reg = new SessionRegistry({ spawnPty: () => makeFakePty(), projectsRoot: 'C:/root' });
  const s = reg.create('C:/root/p');
  assert.strictEqual(reg.get(s.id).mode, 'gui');
  let emitted = 0; reg.on('sessions', () => { emitted += 1; });
  reg.setMode(s.id, 'terminal');
  assert.strictEqual(reg.get(s.id).mode, 'terminal');
  assert.strictEqual(emitted, 1);
  reg.setMode(s.id, 'terminal');           // no change -> no emit
  assert.strictEqual(emitted, 1);
  reg.setMode(s.id, 'bogus');              // invalid -> ignored
  assert.strictEqual(reg.get(s.id).mode, 'terminal');
  assert.strictEqual(emitted, 1);
});

test('setTopics stores topics and emits sessions only on change', () => {
  const reg = new SessionRegistry({ spawnPty: () => makeFakePty(), projectsRoot: 'C:/root' });
  const s = reg.create('C:/root/p');
  assert.deepStrictEqual(reg.get(s.id).topics, []);
  let emitted = 0; reg.on('sessions', () => { emitted += 1; });
  reg.setTopics(s.id, [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]);
  assert.strictEqual(reg.get(s.id).topics.length, 1);
  assert.strictEqual(emitted, 1);
  reg.setTopics(s.id, [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]); // same -> no emit
  assert.strictEqual(emitted, 1);
});

test('create returns a session labelled by folder basename, status working', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/zabbix');
  assert.strictEqual(s.label, 'zabbix');
  assert.strictEqual(s.status, 'working');
  assert.strictEqual(reg.list().length, 1);
});

test('appendOutput buffers data and emits output without changing status', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);             // focus it so turn-end settles to idle
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
  const outputs = [];
  reg.on('output', (id, data) => outputs.push([id, data]));
  ptys[0]._data('hello');
  assert.strictEqual(reg.bufferOf(s.id), 'hello');
  assert.deepStrictEqual(outputs, [[s.id, 'hello']]);
  assert.strictEqual(reg.get(s.id).status, 'idle'); // output did NOT flip status
});

test('markIdle on an unfocused session yields your-move', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');       // never focused
  reg.markWorking(s.id);
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'your-move');
});

test('markIdle on the focused session yields idle (already acknowledged)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);                    // focus it
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
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

test('a turn holds working across output bursts, then ends to your-move when unfocused', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');       // unfocused
  reg.markWorking(s.id);
  ptys[0]._data('burst one');
  assert.strictEqual(reg.get(s.id).status, 'working');
  ptys[0]._data('burst two after a pause');
  assert.strictEqual(reg.get(s.id).status, 'working'); // still working, never idle
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'your-move');
});

test('focusing a your-move session flips it to idle and is sticky', () => {
  const { reg } = makeRegistry();
  const a = reg.create('C:/proj/a');
  const b = reg.create('C:/proj/b');
  reg.acknowledge(b.id);                    // user is on b; a is in the background
  reg.markIdle(a.id);                       // a finishes its turn unfocused
  assert.strictEqual(reg.get(a.id).status, 'your-move');
  reg.acknowledge(a.id);                    // user opens a
  assert.strictEqual(reg.get(a.id).status, 'idle');
  reg.acknowledge(b.id);                    // user leaves again; a stays idle
  assert.strictEqual(reg.get(a.id).status, 'idle');
});

test('redundant turn-end transitions cause no extra sessions broadcast', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);                       // working -> your-move (one change)
  let emits = 0;
  reg.on('sessions', () => { emits += 1; });
  reg.markIdle(s.id);                       // already ended -> no change
  reg.markIdle(s.id);                       // (e.g. Stop then idle_prompt) -> no change
  assert.strictEqual(emits, 0);
});

test('signalWaiting marks an unfocused session needs-you', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
});

test('signalWaiting on the focused session yields idle (already acknowledged)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);             // focus it
  reg.signalWaiting(s.id);           // hook fires while focused
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('a needs-you turn that then ends (unfocused) becomes your-move', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);                  // unfocused permission prompt
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  reg.markIdle(s.id);                       // the turn finally ends, still unfocused
  assert.strictEqual(reg.get(s.id).status, 'your-move');
});

test('acknowledge flips a needs-you session to idle and is sticky', () => {
  const { reg } = makeRegistry();
  const a = reg.create('C:/proj/a');
  const b = reg.create('C:/proj/b');
  reg.signalWaiting(a.id);
  assert.strictEqual(reg.get(a.id).status, 'needs-you');
  reg.acknowledge(a.id);             // focus a -> idle
  assert.strictEqual(reg.get(a.id).status, 'idle');
  reg.acknowledge(b.id);             // focus elsewhere; a stays idle
  assert.strictEqual(reg.get(a.id).status, 'idle');
});

test('markWorking clears a pending your-move (next turn started)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'your-move');
  reg.markWorking(s.id);
  assert.strictEqual(reg.get(s.id).status, 'working');
});

test('markWorking clears a pending needs-you (next turn started)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  reg.markWorking(s.id);
  assert.strictEqual(reg.get(s.id).status, 'working');
});

test('output does not clear a pending needs-you or your-move', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  ptys[0]._data('trailing output');
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'your-move');
  ptys[0]._data('more output');
  assert.strictEqual(reg.get(s.id).status, 'your-move');
});

test('pty exit marks the session exited and ignores later output/input', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  ptys[0]._exit();
  assert.strictEqual(reg.get(s.id).status, 'exited');
  reg.write(s.id, 'typed');
  ptys[0]._data('late');
  assert.deepStrictEqual(ptys[0].written, []);  // write ignored after exit
  assert.strictEqual(reg.bufferOf(s.id), '');    // output ignored after exit
});

test('all hook transitions are ignored after exit', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  ptys[0]._exit();
  reg.markWorking(s.id);
  reg.markIdle(s.id);
  reg.signalWaiting(s.id);
  reg.acknowledge(s.id);
  assert.strictEqual(reg.get(s.id).status, 'exited');
});

test('write forwards input to the pty for a live session', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.write(s.id, 'ls\r');
  assert.deepStrictEqual(ptys[0].written, ['ls\r']);
});

test('resize forwards dimensions to the pty for a live session', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.resize(s.id, 100, 40);
  assert.deepStrictEqual(ptys[0].resized, [[100, 40]]);
});

test('resize is ignored after the session has exited', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  ptys[0]._exit();
  reg.resize(s.id, 100, 40);
  assert.deepStrictEqual(ptys[0].resized, []);
});

test('projectOf returns the first segment under the projects root', () => {
  const { reg } = makeRegistry('C:/root');
  assert.strictEqual(reg.projectOf('C:/root/alpha'), 'alpha');
  assert.strictEqual(reg.projectOf('C:/root/alpha/sub/dir'), 'alpha');
});

test('projectOf returns null for the root itself or paths outside it', () => {
  const { reg } = makeRegistry('C:/root');
  assert.strictEqual(reg.projectOf('C:/root'), null);
  assert.strictEqual(reg.projectOf('C:/elsewhere/x'), null);
  assert.strictEqual(reg.projectOf(''), null);
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
  assert.strictEqual(reg.get(t.id).label, 'x');          // folder-basename default
  reg.setAutoTitle(t.id, 'Fix the thing');
  assert.strictEqual(reg.get(t.id).label, 'Fix the thing');
  reg.rename(t.id, 'My name');
  assert.strictEqual(reg.get(t.id).label, 'My name');    // customName wins
  reg.rename(t.id, '   ');                               // clearing falls back to autoTitle
  assert.strictEqual(reg.get(t.id).label, 'Fix the thing');
});

test('rename a normal session emits sessions only when the label changes', () => {
  const { reg } = makeRegistry('C:/root');
  const s = reg.create('C:/root/alpha');
  let emits = 0; reg.on('sessions', () => { emits += 1; });
  reg.rename(s.id, 'Renamed');
  assert.strictEqual(reg.get(s.id).label, 'Renamed');
  assert.strictEqual(emits, 1);
  reg.rename(s.id, 'Renamed');                            // no change -> no emit
  assert.strictEqual(emits, 1);
});

test('remove kills a live session, deletes it, clears focus, and broadcasts', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/root/alpha');
  reg.acknowledge(s.id);                 // focus it
  let emitted = 0;
  reg.on('sessions', () => { emitted += 1; });
  reg.remove(s.id);
  assert.strictEqual(ptys[0].killed, true);
  assert.strictEqual(reg.get(s.id), null);
  assert.strictEqual(reg.focusedId, null);
  assert.strictEqual(emitted, 1);
  assert.strictEqual(reg.list().length, 0);
});

test('remove on an exited session just deletes it (no kill needed)', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/root/alpha');
  ptys[0]._exit();
  ptys[0].killed = false;                // reset after exit bookkeeping
  reg.remove(s.id);
  assert.strictEqual(ptys[0].killed, false);
  assert.strictEqual(reg.get(s.id), null);
});

test('remove on an unknown id is a no-op', () => {
  const { reg } = makeRegistry();
  let emitted = 0;
  reg.on('sessions', () => { emitted += 1; });
  reg.remove('nope');
  assert.strictEqual(emitted, 0);
});
