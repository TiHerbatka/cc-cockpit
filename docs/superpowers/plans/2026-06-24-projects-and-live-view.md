# Projects & Live View Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the live sidebar by project, let the user create projects and start sessions inside them by picking (never typing a path), and add a per-session kill/remove button.

**Architecture:** A "project" is just a subdirectory of a fixed root (`C:\claude_projects\cockpit`), so projects need no database — the filesystem is the store. The registry derives each session's `project` from its cwd and gains a `remove()`. The HTTP server gains `/api/projects` (GET list, POST create). The browser replaces the path-`prompt()` with a project-picker modal and regroups the sidebar by project with attention-priority sorting.

**Tech Stack:** Plain Node.js (no bundler/build step), `ws` WebSockets, `node-pty`, built-in `node --test`.

**Reference spec:** `docs/superpowers/specs/2026-06-24-discovery-and-projects-design.md` (Part A).

## Global Constraints

- Node.js v22+. No bundler, no build step. Test runner: `npm test` (= `node --test --test-force-exit`; the flag is required for node-pty's lingering ConPTY handle on Windows).
- Server binds `127.0.0.1` only, default port `4477`. Never expose it.
- Tests must not use global `fetch`/undici (its keep-alive socket races `--test-force-exit` and aborts with a libuv `UV_HANDLE_CLOSING` assertion). Use the existing `postJson`/one-shot `http.request({ agent: false })` helper pattern in `test/app.test.js`.
- Projects root: `process.env.COCKPIT_PROJECTS_ROOT || 'C:\\claude_projects\\cockpit'`. A project is an immediate subdirectory; the root is auto-created on use.
- Keep files small and single-responsibility. One commit per task.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `server/projects.js` | Create | `projectsRoot()`, `validateName()`, `listProjects()`, `createProject()` — filesystem-backed project store. |
| `server/sessions.js` | Modify | `projectsRoot` ctor option; `projectOf(cwd)`; `project` in `_public`; `remove(id)`. |
| `server/app.js` | Modify | Wire `projectsRoot` into the registry; `GET`/`POST /api/projects`; WS `remove`. |
| `public/index.html` | Modify | Rename add button to "New session"; (no other markup — modal is built in JS). |
| `public/app.js` | Modify | Group sidebar by project + sort; exited red ✕; hover remove button; new-session picker modal. |
| `public/styles.css` | Modify | Exited mark, remove button, modal styles. |
| `test/sessions.test.js` | Modify | `projectOf`, `project` field, `remove`. |
| `test/projects.test.js` | Create | name validation, list, create. |
| `test/app.test.js` | Modify | `/api/projects` routes, WS `remove`. |
| `server/index.js`, `server/pty.js` | **Unchanged** | `createApp()` defaults `projectsRoot`; pty spawn unchanged in Plan 1. |

---

### Task 1: Registry — project derivation + `remove` (`server/sessions.js`)

**Files:**
- Modify: `server/sessions.js`
- Test: `test/sessions.test.js`

**Interfaces:**
- Produces:
  - `new SessionRegistry({ spawnPty, projectsRoot })` — `projectsRoot` optional (default `null`).
  - `projectOf(cwd) → string | null` — first path segment under `projectsRoot`, else `null`.
  - `_public(s)` now returns `{ id, cwd, label, status, project }`.
  - `remove(id)` — kill pty if live, delete session, clear `focusedId` if it matched, broadcast `sessions`. No-op on unknown id.

- [ ] **Step 1: Add tests for `projectOf`, the `project` field, and `remove`**

In `test/sessions.test.js`, first update the fake pty so `kill` is observable — change the `makeFakePty` body's `o.kill` line to record calls:

```javascript
  o.kill = () => { o.killed = true; };
```

Then update `makeRegistry` to accept a projectsRoot, and add tests:

```javascript
function makeRegistry(projectsRoot = 'C:/root') {
  const ptys = [];
  const reg = new SessionRegistry({
    spawnPty: () => { const p = makeFakePty(); ptys.push(p); return p; },
    projectsRoot,
  });
  return { reg, ptys };
}

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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- test/sessions.test.js`
Expected: FAIL — `reg.projectOf is not a function`, `reg.remove is not a function`, and `project` is `undefined` on public sessions.

- [ ] **Step 3: Implement in `server/sessions.js`**

Add `projectsRoot` to the constructor:

```javascript
  constructor({ spawnPty, projectsRoot = null }) {
    super();
    this.spawnPty = spawnPty;
    this.projectsRoot = projectsRoot;
    this.sessions = new Map();
    this.focusedId = null;
  }
```

Add `projectOf` and `remove` (place `remove` near `markExited`, `projectOf` near `_derive`):

```javascript
  // First path segment under projectsRoot, or null (root itself / outside / no root).
  projectOf(cwd) {
    if (!this.projectsRoot || !cwd) return null;
    const rel = path.relative(this.projectsRoot, cwd);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(/[\\/]/)[0];
  }

  // Kill (if live) and drop a session from the cockpit.
  remove(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!s.exited) { try { s.pty.kill(); } catch { /* already gone */ } }
    this.sessions.delete(id);
    if (this.focusedId === id) this.focusedId = null;
    this.emit('sessions');
  }
```

Update `_public` to include the project:

```javascript
  _public(s) {
    return { id: s.id, cwd: s.cwd, label: s.label, status: s.status, project: this.projectOf(s.cwd) };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/sessions.test.js`
Expected: PASS — all sessions tests green.

- [ ] **Step 5: Commit**

```bash
git add server/sessions.js test/sessions.test.js
git commit -m "feat: registry derives session project and supports remove()"
```

---

### Task 2: Projects module (`server/projects.js`)

**Files:**
- Create: `server/projects.js`
- Test: `test/projects.test.js`

**Interfaces:**
- Produces:
  - `projectsRoot() → string` — `COCKPIT_PROJECTS_ROOT` or the default.
  - `validateName(name) → { ok: true, name } | { ok: false, reason }` — trims; rejects empty, separators, `..`, Windows-illegal chars, reserved device names.
  - `listProjects(root = projectsRoot()) → [{ name, path }]` — directories only, sorted; creates root if missing.
  - `createProject(name, root = projectsRoot()) → { name, path }` — throws `Error` with `.status` 400 (invalid) or 409 (exists).

- [ ] **Step 1: Write the tests**

Create `test/projects.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateName, listProjects, createProject } = require('../server/projects');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-proj-'));
}

test('validateName accepts a normal name and trims it', () => {
  assert.deepStrictEqual(validateName('  my-proj '), { ok: true, name: 'my-proj' });
});

test('validateName rejects empty, separators, traversal, illegal chars, reserved names', () => {
  for (const bad of ['', '   ', 'a/b', 'a\\b', '..', 'x..y', 'a:b', 'a<b', 'a|b', 'CON', 'nul', 'LPT1']) {
    assert.strictEqual(validateName(bad).ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('listProjects returns only directories, sorted, and creates the root', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'beta'));
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x');
  const got = listProjects(root);
  assert.deepStrictEqual(got.map((p) => p.name), ['alpha', 'beta']);
  assert.strictEqual(got[0].path, path.join(root, 'alpha'));
});

test('createProject makes the directory and returns its path', () => {
  const root = tmpRoot();
  const p = createProject('gamma', root);
  assert.strictEqual(p.name, 'gamma');
  assert.strictEqual(p.path, path.join(root, 'gamma'));
  assert.ok(fs.statSync(p.path).isDirectory());
});

test('createProject throws 409 for an existing project', () => {
  const root = tmpRoot();
  createProject('dup', root);
  assert.throws(() => createProject('dup', root), (e) => e.status === 409);
});

test('createProject throws 400 for an invalid name', () => {
  const root = tmpRoot();
  assert.throws(() => createProject('a/b', root), (e) => e.status === 400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/projects.test.js`
Expected: FAIL — `Cannot find module '../server/projects'`.

- [ ] **Step 3: Implement `server/projects.js`**

```javascript
// server/projects.js
// A "project" is an immediate subdirectory of the projects root. No database —
// the filesystem is the store.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = 'C:\\claude_projects\\cockpit';
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function projectsRoot() {
  return process.env.COCKPIT_PROJECTS_ROOT || DEFAULT_ROOT;
}

function validateName(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'name required' };
  const n = name.trim();
  if (!n) return { ok: false, reason: 'name required' };
  if (/[\\/]/.test(n)) return { ok: false, reason: 'no path separators' };
  if (n.includes('..')) return { ok: false, reason: 'no ".."' };
  if (/[<>:"|?*]/.test(n)) return { ok: false, reason: 'illegal character' };
  if (/[\u0000-\u001f]/.test(n)) return { ok: false, reason: 'control character' };
  if (RESERVED.has(n.toUpperCase())) return { ok: false, reason: 'reserved name' };
  return { ok: true, name: n };
}

function listProjects(root = projectsRoot()) {
  fs.mkdirSync(root, { recursive: true });
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, path: path.join(root, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createProject(name, root = projectsRoot()) {
  const v = validateName(name);
  if (!v.ok) { const e = new Error(v.reason); e.status = 400; throw e; }
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, v.name);
  if (fs.existsSync(dir)) { const e = new Error('project already exists'); e.status = 409; throw e; }
  fs.mkdirSync(dir);
  return { name: v.name, path: dir };
}

module.exports = { projectsRoot, validateName, listProjects, createProject };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/projects.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/projects.js test/projects.test.js
git commit -m "feat: filesystem-backed projects module (list/create/validate)"
```

---

### Task 3: `/api/projects` routes + projectsRoot wiring (`server/app.js`)

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `projects.listProjects`, `projects.createProject`, `projects.projectsRoot`; `SessionRegistry({ projectsRoot })`.
- Produces: `createApp({ spawnPty, publicDir, projectsRoot })` (new option, default `projectsRoot()`). `GET /api/projects` → `200 { projects }`. `POST /api/projects {name}` → `201 { name, path }` / `400` / `409` with `{ error }`.

- [ ] **Step 1: Add a JSON helper + project route tests**

In `test/app.test.js`, add near the top imports:

```javascript
const fs = require('node:fs');
const os = require('node:os');
```

Add a GET helper next to `postHook` (reuse the one-shot agent:false pattern; do NOT use global fetch):

```javascript
function getJson(port, path_) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: path_, method: 'GET', agent: false }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); req.end();
  });
}

function postJson(port, path_, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: path_, method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); req.end(data);
  });
}

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-')); }
```

Add the tests:

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/app.test.js`
Expected: FAIL — `/api/projects` returns 404 (not implemented), so status assertions fail.

- [ ] **Step 3: Implement in `server/app.js`**

At the top, add the require:

```javascript
const projects = require('./projects');
```

Change the signature to accept and wire `projectsRoot`:

```javascript
function createApp({ spawnPty, publicDir = DEFAULT_PUBLIC_DIR, projectsRoot = projects.projectsRoot() } = {}) {
  const registry = new SessionRegistry({ spawnPty, projectsRoot });
```

In the `http.createServer` handler, add the API routes BEFORE the static-file block (right after the `/hook` block):

```javascript
    if (req.method === 'GET' && urlPath === '/api/projects') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ projects: projects.listProjects(projectsRoot) }));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/projects') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad json' })); return; }
        try {
          const created = projects.createProject(m && m.name, projectsRoot);
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify(created));
        } catch (e) {
          res.writeHead(e.status || 400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/app.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "feat: GET/POST /api/projects; wire projectsRoot into the registry"
```

---

### Task 4: WS `remove` (`server/app.js`)

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `registry.remove(id)` (Task 1).
- Produces: WS message `{ type: 'remove', id }` drops the session and broadcasts the new list.

- [ ] **Step 1: Add the test**

In `test/app.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/app.test.js`
Expected: FAIL — the `emptied` message never arrives (no `remove` handler), test times out.

- [ ] **Step 3: Implement in `server/app.js`**

In the `ws.on('message', ...)` dispatch, add a branch alongside `attach`:

```javascript
      } else if (m.type === 'remove') {
        registry.remove(m.id);
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/app.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "feat: WS remove to kill/drop a session"
```

---

### Task 5: UI — group by project, exited ✕, remove button, new-session picker

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`
- Test: none (UI verified live; logic exercised by Tasks 1–4).

**Interfaces:**
- Consumes: `session.project` field; `GET /api/projects`; `POST /api/projects`; WS `create {cwd}`; WS `remove {id}`.

- [ ] **Step 1: Rename the add button in `public/index.html`**

Change line 13:

```html
    <button id="add-btn">+ New session</button>
```

- [ ] **Step 2: Replace the grouping + add the picker in `public/app.js`**

Replace the grouping constants (the `GROUP_ORDER` / `GROUP_LABELS` lines) with a state-priority map:

```javascript
const STATE_PRIORITY = { 'needs-you': 0, 'your-move': 1, working: 2, idle: 3, exited: 4 };
const groupKey = (s) => s.project || 'Other';
```

Replace the entire `render()` function with project-grouped rendering:

```javascript
function render() {
  listEl.innerHTML = '';
  const groups = new Map();
  for (const s of sessions) {
    const k = groupKey(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (STATE_PRIORITY[a.status] ?? 9) - (STATE_PRIORITY[b.status] ?? 9));
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'Other' && b !== 'Other') return 1;
    if (b === 'Other' && a !== 'Other') return -1;
    const pa = STATE_PRIORITY[groups.get(a)[0].status] ?? 9;
    const pb = STATE_PRIORITY[groups.get(b)[0].status] ?? 9;
    return pa !== pb ? pa - pb : a.localeCompare(b);
  });
  for (const key of keys) {
    const header = document.createElement('li');
    header.className = 'group-header';
    header.textContent = key;
    listEl.appendChild(header);
    for (const s of groups.get(key)) {
      const li = document.createElement('li');
      if (s.id === focusedId) li.classList.add('active');
      const mark = document.createElement('span');
      if (s.status === 'exited') { mark.className = 'mark exited'; mark.textContent = '✕'; }
      else { mark.className = `dot ${s.status}`; }
      const label = document.createElement('span');
      label.className = 'sess-label';
      label.textContent = s.label;
      const rm = document.createElement('button');
      rm.className = 'remove-btn';
      rm.textContent = '✕';
      rm.title = s.status === 'exited' ? 'Remove from cockpit' : 'Kill and remove';
      rm.onclick = (e) => { e.stopPropagation(); removeSession(s); };
      li.append(mark, label, rm);
      li.onclick = () => focus(s.id);
      listEl.appendChild(li);
    }
  }
}

function removeSession(s) {
  if (s.status !== 'exited' && !confirm(`Kill session "${s.label}"? This ends the running Claude.`)) return;
  if (focusedId === s.id) { focusedId = null; term.reset(); }
  ws.send(JSON.stringify({ type: 'remove', id: s.id }));
}
```

Add a modal helper + the new-session picker, and rewire the button. Replace the existing `document.getElementById('add-btn').onclick = ...` block at the bottom with:

```javascript
function openModal(build) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal';
  overlay.appendChild(box);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  document.body.appendChild(overlay);
  build(box, () => { if (overlay.parentNode) document.body.removeChild(overlay); });
}

function openNewSessionPicker() {
  openModal(async (box, close) => {
    box.innerHTML =
      '<h2>New session</h2>' +
      '<div class="modal-list">Loading…</div>' +
      '<div class="modal-create"><input placeholder="new project name" /><button>Create &amp; start</button></div>';
    const listDiv = box.querySelector('.modal-list');
    const input = box.querySelector('.modal-create input');
    const createBtn = box.querySelector('.modal-create button');
    const startIn = (cwd) => { ws.send(JSON.stringify({ type: 'create', cwd })); close(); };

    try {
      const res = await fetch('/api/projects');
      const { projects } = await res.json();
      listDiv.innerHTML = '';
      if (!projects.length) listDiv.textContent = 'No projects yet — create one below.';
      for (const p of projects) {
        const b = document.createElement('button');
        b.className = 'project-row';
        b.textContent = p.name;
        b.onclick = () => startIn(p.path);
        listDiv.appendChild(b);
      }
    } catch { listDiv.textContent = 'Failed to load projects.'; }

    createBtn.onclick = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const res = await fetch('/api/projects', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); errorEl.textContent = e.error || 'Create failed'; return; }
        const p = await res.json();
        startIn(p.path);
      } catch { errorEl.textContent = 'Create failed'; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
  });
}

document.getElementById('add-btn').onclick = openNewSessionPicker;
```

(Browser `fetch` here is fine — the test-only undici/`--test-force-exit` concern does not apply to the browser.)

- [ ] **Step 3: Add styles in `public/styles.css`**

Append:

```css
.mark.exited { width: 10px; flex: 0 0 10px; text-align: center; color: #f14c4c; font-weight: bold; }
.sess-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.remove-btn { visibility: hidden; background: none; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 0 2px; }
#session-list li:hover .remove-btn { visibility: visible; }
.remove-btn:hover { color: #f14c4c; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.modal { background: #252526; border: 1px solid #3c3c3c; border-radius: 6px; padding: 16px; width: 360px; max-height: 70vh; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.modal h2 { margin: 0; font-size: 14px; color: #9cdcfe; }
.modal-list { display: flex; flex-direction: column; gap: 4px; }
.project-row { text-align: left; background: #2d2d30; border: none; color: #ddd; padding: 8px; border-radius: 4px; cursor: pointer; }
.project-row:hover { background: #094771; }
.modal-create { display: flex; gap: 6px; }
.modal-create input { flex: 1; background: #1e1e1e; border: 1px solid #3c3c3c; color: #ddd; padding: 6px; border-radius: 4px; }
.modal-create button { background: #0e639c; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
```

- [ ] **Step 4: Live-verify** (no unit tests for the DOM)

Use a fake-pty preview server (no real Claude) seeded with sessions in two projects + one "Other" + one exited, then drive it with Playwright (the pattern used for the your-move verification). Confirm:
- sessions grouped by project, "Other" last, attention states sorted to the top of each group;
- exited session shows a red ✕;
- hovering a row reveals the ✕ remove button; clicking it on an exited row removes it;
- the "+ New session" button opens the picker; it lists projects from `GET /api/projects`; "Create & start" posts a new project and starts a session.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: sidebar grouped by project; exited mark, remove button, new-session picker"
```

---

### Task 6: Full-suite + live verification + status doc

**Files:** `CLAUDE.md` (status), else verification only.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS (sessions + projects + app + hooks + buffer + pty), stable across two runs, exit 0.

- [ ] **Step 2: Boot smoke**

Boot the real app wiring (`writeHookSettings` + `createApp` + `spawnClaude` factory) on an ephemeral port and confirm `GET /` serves the app and `GET /api/projects` returns 200.

- [ ] **Step 3: Update `CLAUDE.md` status** with a Plan-1 bullet (projects + live-by-project view + remove button merged), and commit:

```bash
git add CLAUDE.md
git commit -m "docs: projects & live-by-project view (Plan 1) done"
```

---

## Self-Review

**Spec coverage (Part A):**
- A1 live view grouped by project + sort + exited ✕ → Task 1 (`project` field) + Task 5 (grouping/sort/✕).
- A2 lifecycle button (live kill+remove / exited remove) → Task 1 (`remove`) + Task 4 (WS) + Task 5 (button + confirm).
- A3 new-session picker (no path typing; create project) → Task 2/3 (projects API) + Task 5 (picker).
- A4 server (registry projectsRoot/project/remove; /api/projects; name rules) → Tasks 1–4.

**Placeholder scan:** none — every step has full code/commands.

**Type consistency:** `projectOf`, `project`, `remove`, `projectsRoot`, `validateName`, `listProjects`, `createProject` names match across server tasks, tests, and the UI's use of `session.project` and `/api/projects`. `createApp` gains `projectsRoot` (Task 3) consumed by the registry (Task 1).
