const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createApp } = require('../server/app');

function fakePtyFactory() {
  const ptys = [];
  const factory = () => {
    const o = { written: [], resized: [] };
    o.onData = (cb) => { o._data = cb; };
    o.onExit = (cb) => { o._exit = cb; };
    o.write = (d) => o.written.push(d);
    o.resize = (cols, rows) => o.resized.push([cols, rows]);
    o.kill = () => {};
    ptys.push(o);
    return o;
  };
  return { factory, ptys };
}

function nextMessage(ws, predicate) {
  return new Promise((resolve) => {
    ws.on('message', function handler(raw) {
      const msg = JSON.parse(raw);
      if (predicate(msg)) { ws.off('message', handler); resolve(msg); }
    });
  });
}

// POST JSON to /hook using a one-shot (agent:false) socket. Avoids the global
// fetch/undici keep-alive socket, whose lingering timer races --test-force-exit
// on Windows and aborts with a libuv UV_HANDLE_CLOSING assertion.
function postHook(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port, path: '/hook', method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); },
    );
    req.on('error', reject);
    req.end(data);
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

test('create over WS produces a session and streams its output', async () => {
  const { factory, ptys } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const sessionsMsg = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sm = await sessionsMsg;
  assert.strictEqual(sm.sessions[0].label, 'demo');

  const outMsg = nextMessage(ws, (m) => m.type === 'output');
  ptys[0]._data('STREAMED');
  const om = await outMsg;
  assert.strictEqual(om.data, 'STREAMED');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('resize over WS forwards dimensions to the session pty', async () => {
  const { factory, ptys } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const sessionsMsg = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await sessionsMsg).sessions[0].id;

  // Send resize, then attach; awaiting the attach reply guarantees the prior
  // resize message was already processed (same-socket message ordering).
  ws.send(JSON.stringify({ type: 'resize', id, cols: 111, rows: 42 }));
  const attached = nextMessage(ws, (m) => m.type === 'attached' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await attached;

  assert.deepStrictEqual(ptys[0].resized, [[111, 42]]);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('POST /hook state=needs-you flips the session to needs-you and broadcasts', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const needsYou = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'needs-you');
  const res = await postHook(port, { id, state: 'needs-you' });
  assert.strictEqual(res.status, 204);
  const sm = await needsYou;
  assert.strictEqual(sm.sessions[0].status, 'needs-you');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('POST /hook state=idle on an unfocused session yields your-move; state=working yields working', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' })); // starts working, never focused
  const id = (await created).sessions[0].id;

  const yourMove = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'your-move');
  await postHook(port, { id, state: 'idle' }); // turn ends while unfocused
  await yourMove;

  const working = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'working');
  await postHook(port, { id, state: 'working' });
  const sm = await working;
  assert.strictEqual(sm.sessions[0].status, 'working');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('POST /hook state=idle on the focused session yields idle (not your-move)', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  // Focus the session, then end its turn; awaiting the attach reply guarantees
  // the acknowledge was processed before the idle hook arrives.
  const attached = nextMessage(ws, (m) => m.type === 'attached' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await attached;

  const idle = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'idle');
  await postHook(port, { id, state: 'idle' });
  const sm = await idle;
  assert.strictEqual(sm.sessions[0].status, 'idle');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('POST /hook with an unknown state is a no-op 204', async () => {
  const { factory } = fakePtyFactory();
  const { server, registry } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const res = await postHook(port, { id, state: 'bogus' });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(registry.get(id).status, 'working'); // unchanged from spawn

  ws.close();
  await new Promise((r) => server.close(r));
});

test('attach acknowledges a needs-you session (-> idle)', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  const needsYou = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'needs-you');
  await postHook(port, { id, state: 'needs-you' });
  await needsYou;

  const idle = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'idle');
  ws.send(JSON.stringify({ type: 'attach', id }));
  const sm = await idle;
  assert.strictEqual(sm.sessions[0].status, 'idle');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('GET /api/projects lists project folders under the root', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'alpha'));
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/projects');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.projects.map((p) => p.name), ['alpha']);

  await new Promise((r) => server.close(r));
});

test('POST /api/projects creates a project (201) and rejects a duplicate (409)', async () => {
  const root = tmpRoot();
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root });
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
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const bad = await postJson(port, '/api/projects', { name: 'a/b' });
  assert.strictEqual(bad.status, 400);

  await new Promise((r) => server.close(r));
});

test('WS remove drops the session from the broadcast', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
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
  fs.utimesSync(f, t, t); // now -> inside any window
  return claudeDir;
}

test('GET /api/recent returns grouped recent sessions', async () => {
  const claudeDir = recentFixture();
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/recent?window=week');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.window, 'week');
  assert.strictEqual(res.json.groups[0].cwd, 'C:\\proj\\a');
  assert.strictEqual(res.json.groups[0].sessions[0].title, 'Fixture Session');

  await new Promise((r) => server.close(r));
});

test('WS resume starts a session and passes resumeId to spawnPty', async () => {
  const calls = [];
  const factory = (cwd, id, opts) => {
    const o = { written: [], resized: [] };
    o.onData = (cb) => { o._data = cb; }; o.onExit = (cb) => { o._exit = cb; };
    o.write = () => {}; o.resize = () => {}; o.kill = () => {};
    calls.push({ cwd, id, opts });
    return o;
  };
  const { server } = createApp({ spawnPty: factory });
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

test('WS peek returns the session buffer without acknowledging or focusing', { timeout: 3000 }, async () => {
  const { factory, ptys } = fakePtyFactory();
  const { server, registry } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  ptys[0]._data('PEEK-BACKLOG'); // lands in the ring buffer

  // Drive it to needs-you while unfocused, so we can prove peek does NOT clear it.
  const needsYou = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'needs-you');
  await postHook(port, { id, state: 'needs-you' });
  await needsYou;

  // Resize first; peek must report the session's grid so the preview can match it.
  // Same-socket ordering guarantees the resize is processed before the peek.
  ws.send(JSON.stringify({ type: 'resize', id, cols: 100, rows: 40 }));

  const peeked = nextMessage(ws, (m) => m.type === 'peeked' && m.id === id);
  ws.send(JSON.stringify({ type: 'peek', id }));
  const pk = await peeked;

  assert.ok(pk.buffer.includes('PEEK-BACKLOG'));            // backlog returned
  assert.strictEqual(pk.cols, 100);                         // PTY grid size reported
  assert.strictEqual(pk.rows, 40);
  assert.strictEqual(registry.get(id).status, 'needs-you'); // NOT acknowledged
  assert.strictEqual(registry.focusedId, null);             // NOT focused

  ws.close();
  await new Promise((r) => server.close(r));
});

test('WS create-temp starts a temporary session (temp:true, project null)', async () => {
  const root = tmpRoot();
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root });
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
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
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

  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root, claudeDir });
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
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, openInExplorer: (dir) => calls.push(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const id = (await created).sessions[0].id;

  // Send open-folder, then attach; awaiting the attach reply proves open-folder
  // was already processed (same-socket ordering).
  ws.send(JSON.stringify({ type: 'open-folder', id }));
  const attached = nextMessage(ws, (m) => m.type === 'attached' && m.id === id);
  ws.send(JSON.stringify({ type: 'attach', id }));
  await attached;
  assert.deepStrictEqual(calls, ['C:/proj/demo']);

  ws.close();
  await new Promise((r) => server.close(r));
});

test('open-file opens the cwd doc via the injected opener; missing file -> error', async () => {
  const calls = [];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-of-'));
  fs.writeFileSync(path.join(cwd, 'local-docs.md'), '# hi');
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, openFile: (p) => calls.push(p) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd }));
  const id = (await created).sessions[0].id;

  ws.send(JSON.stringify({ type: 'open-file', id, which: 'docs' }));      // exists -> opens
  const errForTodo = nextMessage(ws, (m) => m.type === 'error');
  ws.send(JSON.stringify({ type: 'open-file', id, which: 'todo' }));      // TODO.md missing -> error
  await errForTodo;
  assert.deepStrictEqual(calls, [path.join(cwd, 'local-docs.md')]);

  ws.close();
  await new Promise((r) => server.close(r));
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('topics from the per-session file are broadcast on the session', { timeout: 6000 }, async () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-app-topics-'));
  fs.mkdirSync(path.join(claudeDir, 'topics'), { recursive: true });
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, claudeDir });
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

test('gui-attach streams a normalized snapshot from the session transcript', { timeout: 5000 }, async () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-gui-'));
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];
  const id = sess.id;
  // Fresh session: ccSessionId === id. Seed its transcript before attaching.
  const proj = path.join(claudeDir, 'projects', 'enc');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${sess.ccSessionId}.jsonl`),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello GUI' } }) + '\n'
    + JSON.stringify({ type: 'ai-title', aiTitle: 'Demo' }) + '\n');

  const snap = nextMessage(ws, (m) => m.type === 'gui-snapshot' && m.id === id && m.model.items.length > 0);
  ws.send(JSON.stringify({ type: 'gui-attach', id }));
  const sm = await snap;
  assert.strictEqual(sm.model.title, 'Demo');
  assert.deepStrictEqual(sm.model.items[0], { kind: 'user', text: 'Hello GUI' });

  ws.send(JSON.stringify({ type: 'gui-detach', id }));
  ws.close();
  await new Promise((r) => server.close(r));
});

test('set-mode over WS updates the broadcast session mode', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];
  assert.strictEqual(sess.mode, 'gui');

  const toTerminal = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].mode === 'terminal');
  ws.send(JSON.stringify({ type: 'set-mode', id: sess.id, mode: 'terminal' }));
  const sm = await toTerminal;
  assert.strictEqual(sm.sessions[0].mode, 'terminal');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('a native permission prompt is mirrored to the GUI with the pending tool details', { timeout: 5000 }, async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];

  // PreToolUse notifies the pending tool, then the native prompt fires (/hook needs-you).
  await postJson(port, '/tool-pending', { sessionId: sess.id, toolName: 'Bash', toolInput: { command: 'rm x' } });
  const reqMsg = nextMessage(ws, (m) => m.type === 'permission-request' && m.id === sess.id);
  await postHook(port, { id: sess.id, state: 'needs-you' });
  const r = await reqMsg;
  assert.strictEqual(r.tool, 'Bash');
  assert.deepStrictEqual(r.input, { command: 'rm x' });

  ws.close();
  await new Promise((r2) => server.close(r2));
});

test('permission-answer writes the chosen keystroke to the session PTY', async () => {
  const { factory, ptys } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];

  // Send the answer, then attach (same-socket ordering guarantees it was processed).
  ws.send(JSON.stringify({ type: 'permission-answer', id: sess.id, key: '1' }));
  const attached = nextMessage(ws, (m) => m.type === 'attached' && m.id === sess.id);
  ws.send(JSON.stringify({ type: 'attach', id: sess.id }));
  await attached;
  assert.deepStrictEqual(ptys[0].written, ['1']);

  ws.close();
  await new Promise((r2) => server.close(r2));
});

test('GET /api/projects includes lastActivity per project', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.mkdirSync(path.join(root, 'beta')); // no sessions -> lastActivity null
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-pa-'));
  const pd = path.join(claudeDir, 'projects', 'enc');
  fs.mkdirSync(pd, { recursive: true });
  const f = path.join(pd, 's.jsonl');
  fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd: path.join(root, 'alpha'), message: { role: 'user', content: 'hi' } }) + '\n');
  const t = new Date();
  fs.utimesSync(f, t, t);

  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory, projectsRoot: root, claudeDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const res = await getJson(port, '/api/projects');
  const alpha = res.json.projects.find((p) => p.name === 'alpha');
  const beta = res.json.projects.find((p) => p.name === 'beta');
  assert.ok(alpha.lastActivity, 'alpha should have a lastActivity');
  assert.strictEqual(beta.lastActivity, null);

  await new Promise((r) => server.close(r));
});
