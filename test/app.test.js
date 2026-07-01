const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createApp } = require('../server/app');

// A fake SDK driver factory (mirrors server/sdk.js). Captured drivers let a test
// drive the message stream via drivers[i]._msg(...).
function fakeDriverFactory() {
  const drivers = [];
  const factory = () => {
    const o = { written: [], killed: false, interrupted: false, answered: [], modeSet: [], modelSet: [], effortSet: [], _msg: null, _exit: null, _error: null, _interaction: null };
    o.onMessage = (cb) => { o._msg = cb; };
    o.onExit = (cb) => { o._exit = cb; };
    o.onError = (cb) => { o._error = cb; };
    o.onInteraction = (cb) => { o._interaction = cb; };
    o.write = (t) => o.written.push(t);
    o.answerInteraction = (rid, ans) => o.answered.push([rid, ans]);
    o.interrupt = () => { o.interrupted = true; };
    o.setPermissionMode = (m) => o.modeSet.push(m);
    o.setModel = (m) => o.modelSet.push(m);
    o.setEffort = (l) => o.effortSet.push(l);
    o.kill = () => { o.killed = true; };
    drivers.push(o);
    return o;
  };
  return { factory, drivers };
}

const asstText = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (usage) => ({ type: 'result', subtype: 'success', usage });

function nextMessage(ws, predicate) {
  return new Promise((resolve) => {
    ws.on('message', function handler(raw) {
      const msg = JSON.parse(raw);
      if (predicate(msg)) { ws.off('message', handler); resolve(msg); }
    });
  });
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); req.end();
  });
}

function postJson(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); req.end(data);
  });
}

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-')); }

test('create over WS produces a session and broadcasts it', async () => {
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const sessionsMsg = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sm = await sessionsMsg;
  assert.strictEqual(sm.sessions[0].label, 'demo');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('a connecting client receives the display-mode from settings (J4)', { timeout: 10000 }, async () => {
  const { factory } = fakeDriverFactory();
  const { server } = createApp({
    spawnDriver: factory,
    readDisplayMode: () => ({ viewMode: 'focus', verbose: true, mode: 'verbose' }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  // display-mode is sent on connect, so attach the listener BEFORE the socket
  // opens — awaiting 'open' first would race the message and could miss it.
  const dm = await nextMessage(ws, (m) => m.type === 'display-mode');
  assert.strictEqual(dm.mode, 'verbose'); // verbose overrides focus (documented)
  assert.strictEqual(dm.viewMode, 'focus');
  assert.strictEqual(dm.verbose, true);
  ws.close();
  await new Promise((r) => server.close(r));
});

test('an assistant message from the driver broadcasts a gui-delta', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const delta = nextMessage(ws, (m) => m.type === 'gui-delta' && m.id === id);
  drivers[0]._msg(asstText('HELLO'));
  const d = await delta;
  assert.ok(d.ops.some((o) => o.op === 'append' && o.item.kind === 'assistant' && o.item.text === 'HELLO'));

  ws.close();
  await new Promise((r) => server.close(r));
});

test('attach sends a gui-snapshot reflecting the session model and acknowledges', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;
  drivers[0]._msg(asstText('HI THERE')); // build the model

  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  const s = await snap;
  assert.deepStrictEqual(s.model.items[0], { kind: 'assistant', text: 'HI THERE' });

  ws.close();
  await new Promise((r) => server.close(r));
});

test('gui-attach sends a gui-snapshot', async () => {
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id);
  ws.send(JSON.stringify({ type: 'gui-attach', id }));
  const s = await snap;
  assert.deepStrictEqual(s.model, { title: null, items: [], status: { currentTool: null, todos: null } });

  ws.close();
  await new Promise((r) => server.close(r));
});

test('a result message broadcasts your-move (unfocused); send then flips to working and reaches the driver', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' })); // unfocused, working
  const id = (await created).sessions[0].id;

  const yourMove = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'your-move');
  drivers[0]._msg(result({}));
  await yourMove;

  const working = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'working');
  ws.send(JSON.stringify({ type: 'send', id, text: 'do it' }));
  await working;

  // attach ordering proves the send was processed before we inspect the driver.
  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await snap;
  assert.deepStrictEqual(drivers[0].written, ['do it']);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('attach acknowledges a your-move session (-> idle)', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const yourMove = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'your-move');
  drivers[0]._msg(result({}));
  await yourMove;

  const idle = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'idle');
  ws.send(JSON.stringify({ type: 'attach', id }));
  const sm = await idle;
  assert.strictEqual(sm.sessions[0].status, 'idle');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('init and result messages broadcast meta (mode then usage)', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const modeMeta = nextMessage(ws, (m) => m.type === 'meta' && m.id === id && m.mode);
  drivers[0]._msg({ type: 'system', subtype: 'init', permissionMode: 'default', model: 'm' });
  assert.strictEqual((await modeMeta).mode, 'default');

  const usageMeta = nextMessage(ws, (m) => m.type === 'meta' && m.id === id && m.usage);
  drivers[0]._msg(result({ input_tokens: 3 }));
  assert.strictEqual((await usageMeta).usage.input_tokens, 3);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('a driver error is surfaced to the client as an error message', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  await created;

  const err = nextMessage(ws, (m) => m.type === 'error');
  drivers[0]._error(new Error('start failed'));
  assert.match((await err).message, /start failed/);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('an interaction request is broadcast and the answer reaches the driver', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const intReq = nextMessage(ws, (m) => m.type === 'interaction-request' && m.id === id);
  drivers[0]._interaction({ requestId: 't1', kind: 'permission', toolName: 'Write', input: { file_path: 'x' }, suggestions: [] });
  const r = await intReq;
  assert.strictEqual(r.kind, 'permission');
  assert.strictEqual(r.requestId, 't1');

  ws.send(JSON.stringify({ type: 'interaction-answer', id, requestId: 't1', answer: 'deny' }));
  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id); // attach ordering
  ws.send(JSON.stringify({ type: 'attach', id }));
  await snap;
  assert.deepStrictEqual(drivers[0].answered, [['t1', 'deny']]);

  ws.close();
  await new Promise((r2) => server.close(r2));
});

test('interrupt / set-permission-mode / set-model reach the driver', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  ws.send(JSON.stringify({ type: 'interrupt', id }));
  ws.send(JSON.stringify({ type: 'set-permission-mode', id, mode: 'plan' }));
  ws.send(JSON.stringify({ type: 'set-model', id, model: 'claude-sonnet-4-6' }));
  ws.send(JSON.stringify({ type: 'set-effort', id, level: 'high' }));
  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id); // attach ordering
  ws.send(JSON.stringify({ type: 'attach', id }));
  await snap;
  assert.strictEqual(drivers[0].interrupted, true);
  assert.deepStrictEqual(drivers[0].modeSet, ['plan']);
  assert.deepStrictEqual(drivers[0].modelSet, ['claude-sonnet-4-6']);
  assert.deepStrictEqual(drivers[0].effortSet, ['high']);

  ws.close();
  await new Promise((r2) => server.close(r2));
});

test('peek returns the session model without acknowledging or focusing', async () => {
  const { factory, drivers } = fakeDriverFactory();
  const { server, registry } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;
  drivers[0]._msg(asstText('HELLO PREVIEW'));

  const peeked = nextMessage(ws, (m) => m.type === 'peeked' && m.id === id);
  ws.send(JSON.stringify({ type: 'peek', id }));
  const pk = await peeked;
  assert.deepStrictEqual(pk.model.items[0], { kind: 'assistant', text: 'HELLO PREVIEW' });
  assert.strictEqual(registry.focusedId, null); // peek must not focus/acknowledge

  ws.close();
  await new Promise((r) => server.close(r));
});

test('GET /api/projects lists project folders under the root', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'alpha'));
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/projects');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.projects.map((p) => p.name), ['alpha']);

  await new Promise((r) => server.close(r));
});

test('POST /api/projects creates a project (201) and rejects a duplicate (409)', async () => {
  const root = tmpRoot();
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const ok = await postJson(port, '/api/projects', { name: 'gamma' });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.json.name, 'gamma');
  assert.ok(fs.statSync(path.join(root, 'gamma')).isDirectory());

  const dup = await postJson(port, '/api/projects', { name: 'gamma' });
  assert.strictEqual(dup.status, 409);

  await new Promise((r) => server.close(r));
});

test('POST /api/projects rejects an invalid name (400)', async () => {
  const root = tmpRoot();
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const bad = await postJson(port, '/api/projects', { name: 'a/b' });
  assert.strictEqual(bad.status, 400);

  await new Promise((r) => server.close(r));
});

test('WS remove drops the session from the broadcast', async () => {
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const emptied = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 0);
  ws.send(JSON.stringify({ type: 'remove', id }));
  const sm = await emptied;
  assert.strictEqual(sm.sessions.length, 0);

  ws.close();
  await new Promise((r) => server.close(r));
});

function recentFixture() {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-recent-'));
  const proj = path.join(claudeDir, 'projects', 'C--proj-a');
  fs.mkdirSync(proj, { recursive: true });
  const f = path.join(proj, 'sess-1.jsonl');
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Fixture Session' }),
  ].join('\n') + '\n');
  const t = new Date();
  fs.utimesSync(f, t, t);
  return claudeDir;
}

test('GET /api/recent returns grouped recent sessions', async () => {
  const claudeDir = recentFixture();
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/recent?window=week');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.window, 'week');
  assert.strictEqual(res.json.groups[0].cwd, 'C:\\proj\\a');
  assert.strictEqual(res.json.groups[0].sessions[0].title, 'Fixture Session');

  await new Promise((r) => server.close(r));
});

test('WS resume starts a session and passes resumeId to spawnDriver', async () => {
  const calls = [];
  const factory = (cwd, id, opts) => {
    const o = { written: [] };
    o.onMessage = () => {}; o.onExit = () => {}; o.onError = () => {};
    o.write = () => {}; o.interrupt = () => {}; o.kill = () => {};
    calls.push({ cwd, id, opts });
    return o;
  };
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'resume', id: 'claude-xyz', cwd: 'C:/proj/a' }));
  await created;

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cwd, 'C:/proj/a');
  assert.strictEqual(calls[0].opts.resumeId, 'claude-xyz');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('WS resume with a missing folder reports an error and does not spawn', async () => {
  const calls = [];
  const factory = (cwd, id, opts) => {
    calls.push({ cwd, id, opts });
    const o = { written: [] };
    o.onMessage = () => {}; o.onExit = () => {}; o.onError = () => {};
    o.write = () => {}; o.interrupt = () => {}; o.kill = () => {};
    return o;
  };
  const { server } = createApp({ spawnDriver: factory, dirExists: () => false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const settled = nextMessage(ws, (m) => m.type === 'error' || (m.type === 'sessions' && m.sessions.length >= 1));
  ws.send(JSON.stringify({ type: 'resume', id: 'claude-xyz', cwd: 'C:/gone/folder' }));
  const msg = await settled;

  assert.strictEqual(msg.type, 'error');
  assert.match(msg.message, /no longer exists/);
  assert.strictEqual(calls.length, 0);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('WS create with a missing folder reports an error and does not spawn', async () => {
  const calls = [];
  const factory = (cwd, id, opts) => {
    calls.push({ cwd, id, opts });
    const o = { written: [] };
    o.onMessage = () => {}; o.onExit = () => {}; o.onError = () => {};
    o.write = () => {}; o.interrupt = () => {}; o.kill = () => {};
    return o;
  };
  const { server } = createApp({ spawnDriver: factory, dirExists: () => false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const settled = nextMessage(ws, (m) => m.type === 'error' || (m.type === 'sessions' && m.sessions.length >= 1));
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/gone/folder' }));
  const msg = await settled;

  assert.strictEqual(msg.type, 'error');
  assert.match(msg.message, /no longer exists/);
  assert.strictEqual(calls.length, 0);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('WS read-todo returns parsed TODO.md entries for the focused session cwd', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-todo-'));
  fs.writeFileSync(path.join(cwd, 'TODO.md'), '# TODO\n\n## A. X\n- [ ] A1. first\n- [x] A2. second\n');
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd }));
  const id = (await created).sessions[0].id;

  const got = nextMessage(ws, (m) => m.type === 'todo-content');
  ws.send(JSON.stringify({ type: 'read-todo', id }));
  const res = await got;

  assert.strictEqual(res.id, id);
  assert.strictEqual(res.found, true);
  assert.deepStrictEqual(res.entries, [
    { kind: 'section', text: 'A. X' },
    { kind: 'item', done: false, depth: 0, text: 'A1. first' },
    { kind: 'item', done: true, depth: 0, text: 'A2. second' },
  ]);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('WS read-todo reports found:false when the session has no TODO.md', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-todo-none-'));
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd }));
  const id = (await created).sessions[0].id;

  const got = nextMessage(ws, (m) => m.type === 'todo-content');
  ws.send(JSON.stringify({ type: 'read-todo', id }));
  const res = await got;
  assert.strictEqual(res.found, false);
  assert.deepStrictEqual(res.entries, []);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('WS create-temp starts a temporary session (temp:true, project null)', async () => {
  const root = tmpRoot();
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create-temp' }));
  const sm = await created;
  assert.strictEqual(sm.sessions[0].temp, true);
  assert.strictEqual(sm.sessions[0].project, null);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('WS rename changes the session label in the broadcast', async () => {
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const renamed = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].label === 'My Session');
  ws.send(JSON.stringify({ type: 'rename', id, name: 'My Session' }));
  const sm = await renamed;
  assert.strictEqual(sm.sessions[0].label, 'My Session');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('GET /api/recent classifies groups as temp, cockpit, or neither', async () => {
  const root = tmpRoot();
  const tempCwd = path.join(root, '_temporary-sessions', '2026-01-01 00-00-00');
  const cockpitCwd = path.join(root, 'alpha');
  const otherCwd = 'C:\\legacy\\thing';
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-temp-'));
  let i = 0;
  const seed = (cwd) => {
    const proj = path.join(claudeDir, 'projects', 'enc' + (i++));
    fs.mkdirSync(proj, { recursive: true });
    const f = path.join(proj, 's.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hi' } }) + '\n');
    const t = new Date(); fs.utimesSync(f, t, t);
  };
  seed(tempCwd); seed(cockpitCwd); seed(otherCwd);

  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/recent?window=week');
  const byCwd = Object.fromEntries(res.json.groups.map((g) => [g.cwd, g]));
  assert.deepStrictEqual([byCwd[tempCwd].temp, byCwd[tempCwd].cockpit], [true, false]);
  assert.deepStrictEqual([byCwd[cockpitCwd].temp, byCwd[cockpitCwd].cockpit], [false, true]);
  assert.deepStrictEqual([byCwd[otherCwd].temp, byCwd[otherCwd].cockpit], [false, false]);

  await new Promise((r) => server.close(r));
});

test('WS open-folder invokes the explorer opener with the session cwd', async () => {
  const calls = [];
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, openInExplorer: (dir) => calls.push(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  ws.send(JSON.stringify({ type: 'open-folder', id }));
  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await snap;
  assert.deepStrictEqual(calls, ['C:/proj/demo']);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('open-file opens local-docs.md via the injected opener; missing file -> error', async () => {
  // open-file only targets local-docs.md now — the old "open TODO.md in the OS"
  // path was replaced by the in-cockpit TODO.MD panel (read-todo).
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-of-'));
  const calls = [];
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, openFile: (p) => calls.push(p) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd }));
  const id = (await created).sessions[0].id;

  // No local-docs.md yet -> error, opener not called.
  const errMsg = nextMessage(ws, (m) => m.type === 'error');
  ws.send(JSON.stringify({ type: 'open-file', id, which: 'docs' }));
  assert.match((await errMsg).message, /local-docs\.md not found/);
  assert.strictEqual(calls.length, 0);

  // Now it exists -> the opener is called with its path.
  fs.writeFileSync(path.join(cwd, 'local-docs.md'), '# hi');
  ws.send(JSON.stringify({ type: 'open-file', id, which: 'docs' }));
  for (let i = 0; i < 100 && calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(calls, [path.join(cwd, 'local-docs.md')]);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('topics from the per-session file are broadcast on the session', { timeout: 6000 }, async () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-app-topics-'));
  fs.mkdirSync(path.join(claudeDir, 'topics'), { recursive: true });
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];
  fs.writeFileSync(path.join(claudeDir, 'topics', `${sess.ccSessionId}.json`),
    JSON.stringify({ session_id: sess.ccSessionId, topics: [{ code: 'TPC1', name: 'Build', status: 'active', summary: 'do it' }] }));
  const withTopics = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].topics && m.sessions[0].topics.length === 1);
  const sm = await withTopics;
  assert.strictEqual(sm.sessions[0].topics[0].code, 'TPC1');
  ws.close();
  await new Promise((r) => server.close(r));
});

test('GET /api/projects includes lastActivity per project', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.mkdirSync(path.join(root, 'beta'));
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-pa-'));
  const pd = path.join(claudeDir, 'projects', 'enc');
  fs.mkdirSync(pd, { recursive: true });
  const f = path.join(pd, 's.jsonl');
  fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd: path.join(root, 'alpha'), message: { role: 'user', content: 'hi' } }) + '\n');
  const t = new Date();
  fs.utimesSync(f, t, t);

  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, projectsRoot: root, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/projects');
  const alpha = res.json.projects.find((p) => p.name === 'alpha');
  const beta = res.json.projects.find((p) => p.name === 'beta');
  assert.ok(alpha.lastActivity, 'alpha should have a lastActivity');
  assert.strictEqual(beta.lastActivity, null);

  await new Promise((r) => server.close(r));
});

test('POST /api/upload-image saves the file and auto-names it; rejects non-image/unknown-id', async () => {
  const sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-upload-'));
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: sessionCwd }));
  const id = (await created).sessions[0].id;

  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const ok = await postJson(port, '/api/upload-image', { id, mime: 'image/png', dataBase64: png });
  assert.strictEqual(ok.status, 201);
  assert.ok(path.isAbsolute(ok.json.path));
  assert.ok(fs.existsSync(ok.json.path));
  assert.match(ok.json.name, /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/);
  assert.strictEqual(path.dirname(ok.json.path), path.join(sessionCwd, 'uploaded-images'));

  const badMime = await postJson(port, '/api/upload-image', { id, mime: 'text/plain', dataBase64: png });
  assert.strictEqual(badMime.status, 400);
  const badId = await postJson(port, '/api/upload-image', { id: 'nope', mime: 'image/png', dataBase64: png });
  assert.strictEqual(badId.status, 400);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(sessionCwd, { recursive: true, force: true });
});

test('WS open-image opens the file via the injected opener; outside path -> error', async () => {
  const sessionCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-oi-'));
  const uploadDir = path.join(sessionCwd, 'uploaded-images');
  fs.mkdirSync(uploadDir, { recursive: true });
  const insidePath = path.join(uploadDir, 'x.png');
  fs.writeFileSync(insidePath, 'fake png');

  const calls = [];
  const { factory } = fakeDriverFactory();
  const { server } = createApp({ spawnDriver: factory, openFile: (p) => calls.push(p) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: sessionCwd }));
  const id = (await created).sessions[0].id;

  ws.send(JSON.stringify({ type: 'open-image', id, path: insidePath }));
  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await snap;
  assert.deepStrictEqual(calls, [insidePath]);

  const errMsg = nextMessage(ws, (m) => m.type === 'error');
  ws.send(JSON.stringify({ type: 'open-image', id, path: path.join(sessionCwd, 'secret.txt') }));
  await errMsg;
  assert.deepStrictEqual(calls, [insidePath]);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(sessionCwd, { recursive: true, force: true });
});
