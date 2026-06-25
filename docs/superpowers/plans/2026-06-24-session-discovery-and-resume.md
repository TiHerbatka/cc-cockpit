# Session Discovery & Resume Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover recent Claude Code sessions across the machine (time-filtered) and continue any of them from the GUI by spawning `claude --resume <id>` in its original folder.

**Architecture:** A pure `server/recent.js` scans `~/.claude/projects/*/*.jsonl` (top-level only), reads each matched file's `cwd`/`aiTitle`/timestamp, and returns recents grouped by folder. `GET /api/recent?window=` exposes it. `buildSpawn` gains `--resume`; the registry's `create(cwd, opts)` forwards spawn options; a new WS `resume {id, cwd}` starts a resumed session. The browser adds a Resume modal with day/3-days/week tabs.

**Tech Stack:** Plain Node.js (no bundler/build step), `ws`, `node-pty`, built-in `node --test`.

**Reference spec:** `docs/superpowers/specs/2026-06-24-discovery-and-projects-design.md` (Part B). Builds on Plan 1 (`projectOf`, `/api/projects`, project-grouped sidebar).

## Global Constraints

- Node.js v22+. No bundler. Test runner: `npm test` (= `node --test --test-force-exit`).
- Tests must not use global `fetch`/undici (races `--test-force-exit` on Windows → libuv `UV_HANDLE_CLOSING` abort). Use the `getJson`/`postJson`/`postHook` one-shot `http.request({ agent: false })` helpers already in `test/app.test.js`.
- Claude history dir: `process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')`; sessions under `<dir>/projects/<encoded-cwd>/<session-id>.jsonl`. Subagent transcripts under `<session-id>/subagents/agent-*.jsonl` must be excluded (they are not top-level `.jsonl` files in the project folder, so a `.jsonl`-only filter at the top level already excludes them).
- Session record fields used: `cwd` (string), `aiTitle` (on `{type:'ai-title'}` records), user text (on `{type:'user', message:{role,content}}`). Title precedence: `aiTitle` → first user message text → `'(untitled)'`, trimmed + truncated to 80 chars.
- Window sizes: `day`=24h, `3d`=72h, `week`=7d. Filter by file **mtime**; `lastActivity` = mtime ISO.
- Resume by Claude session id requires launching in the session's original cwd (Claude scopes id lookup to the project dir). The cockpit's `CC_COCKPIT_SESSION` hook-correlation id stays independent of Claude's session id.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `server/recent.js` | Create | `listRecent(window, { claudeDir, now })` — scan/parse/group recent sessions. |
| `server/pty.js` | Modify | `buildSpawn` adds `--resume <id>` when `opts.resumeId` is set. |
| `server/sessions.js` | Modify | `create(cwd, opts = {})` forwards `opts` to `spawnPty(cwd, id, opts)`. |
| `server/app.js` | Modify | `createApp({ claudeDir })`; `GET /api/recent`; WS `resume`. |
| `server/index.js` | Modify | `spawnPty(cwd, id, opts)` forwards `opts` (carrying `resumeId`) into `spawnClaude`. |
| `public/index.html` | Modify | Add a "Resume" button. |
| `public/app.js` | Modify | Resume modal: window tabs, grouped recents, click → WS `resume`. |
| `public/styles.css` | Modify | Window-tab + recent-row styles (reuse modal styles from Plan 1). |
| `test/recent.test.js` | Create | parser/scan/group/window/exclusion. |
| `test/pty.test.js` | Modify | `--resume` in `buildSpawn`. |
| `test/app.test.js` | Modify | `GET /api/recent`; WS `resume` reaches `spawnPty` with `resumeId`. |

---

### Task 1: `server/recent.js` — scan & group recent sessions

**Files:**
- Create: `server/recent.js`
- Test: `test/recent.test.js`

**Interfaces:**
- Produces: `listRecent(window, { claudeDir, now } = {}) → { window, groups: [{ cwd, sessions: [{ id, title, lastActivity }] }] }`. Sessions within a group sorted by `lastActivity` desc; groups sorted by their most-recent session desc.

- [ ] **Step 1: Write the tests**

Create `test/recent.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listRecent } = require('../server/recent');

const NOW = Date.parse('2026-06-24T12:00:00Z');

function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function fixture() {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-recent-'));
  const proj = path.join(claudeDir, 'projects', 'C--proj-a');
  fs.mkdirSync(proj, { recursive: true });

  const recentFile = path.join(proj, 'sess-recent.jsonl');
  writeJsonl(recentFile, [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'hello there' } },
    { type: 'ai-title', aiTitle: 'Recent One' },
  ]);
  const oldFile = path.join(proj, 'sess-old.jsonl');
  writeJsonl(oldFile, [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'old prompt text' } },
  ]);
  // Subagent transcript that MUST be excluded.
  const sub = path.join(proj, 'sess-recent', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  writeJsonl(path.join(sub, 'agent-x.jsonl'), [
    { type: 'user', cwd: 'C:\\proj\\a', message: { role: 'user', content: 'agent work' } },
  ]);

  fs.utimesSync(recentFile, new Date(NOW - 3600e3), new Date(NOW - 3600e3));            // 1h ago
  fs.utimesSync(oldFile, new Date(NOW - 8 * 86400e3), new Date(NOW - 8 * 86400e3));     // 8d ago
  return claudeDir;
}

test('listRecent(day) returns only recent sessions, excludes subagents, uses aiTitle', () => {
  const claudeDir = fixture();
  const { window, groups } = listRecent('day', { claudeDir, now: NOW });
  assert.strictEqual(window, 'day');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].cwd, 'C:\\proj\\a');
  assert.strictEqual(groups[0].sessions.length, 1);
  assert.strictEqual(groups[0].sessions[0].id, 'sess-recent');
  assert.strictEqual(groups[0].sessions[0].title, 'Recent One');
});

test('listRecent(week) includes the older session; title falls back to first user message', () => {
  const claudeDir = fixture();
  const { groups } = listRecent('week', { claudeDir, now: NOW });
  const ids = groups[0].sessions.map((s) => s.id);
  assert.deepStrictEqual(ids, ['sess-recent', 'sess-old']); // newest first
  const old = groups[0].sessions.find((s) => s.id === 'sess-old');
  assert.strictEqual(old.title, 'old prompt text');
});

test('listRecent returns empty groups when the claude dir is missing', () => {
  const { groups } = listRecent('week', { claudeDir: path.join(os.tmpdir(), 'does-not-exist-xyz'), now: NOW });
  assert.deepStrictEqual(groups, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/recent.test.js`
Expected: FAIL — `Cannot find module '../server/recent'`.

- [ ] **Step 3: Implement `server/recent.js`**

```javascript
// server/recent.js
// Scans Claude Code's on-disk session history and returns recent sessions
// grouped by folder. Pure (cwd/title read from inside each jsonl; never from the
// lossy folder name). Subagent transcripts live in subdirectories, so a
// top-level .jsonl filter excludes them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WINDOW_MS = { day: 24 * 3600e3, '3d': 72 * 3600e3, week: 7 * 24 * 3600e3 };

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function userText(message) {
  if (!message) return '';
  let c = message.content;
  if (Array.isArray(c)) c = c.map((x) => (x && x.type === 'text' ? x.text : '')).join(' ');
  return typeof c === 'string' ? c : '';
}

function parseSession(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return null; }
  let cwd = null; let aiTitle = null; let firstUser = null;
  for (const ln of lines) {
    if (!ln) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!cwd && o.cwd) cwd = o.cwd;
    if (!aiTitle && o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
    if (!firstUser && o.type === 'user') { const t = userText(o.message); if (t && !t.startsWith('<')) firstUser = t; }
    if (cwd && aiTitle) break;
  }
  const title = (aiTitle || firstUser || '(untitled)').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { cwd, title };
}

function listRecent(window, { claudeDir = defaultClaudeDir(), now = Date.now() } = {}) {
  const span = WINDOW_MS[window] || WINDOW_MS.day;
  const cutoff = now - span;
  const projectsDir = path.join(claudeDir, 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return { window, groups: [] }; }

  const entries = [];
  for (const pd of projectDirs) {
    const dir = path.join(projectsDir, pd.name);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < cutoff) continue;
      const meta = parseSession(full);
      if (!meta) continue;
      entries.push({
        id: f.replace(/\.jsonl$/, ''),
        cwd: meta.cwd,
        title: meta.title,
        lastActivity: new Date(st.mtimeMs).toISOString(),
        _mtime: st.mtimeMs,
      });
    }
  }

  const byCwd = new Map();
  for (const e of entries) {
    const key = e.cwd || '(unknown)';
    if (!byCwd.has(key)) byCwd.set(key, []);
    byCwd.get(key).push(e);
  }
  const groups = [...byCwd.entries()].map(([cwd, sessions]) => {
    sessions.sort((a, b) => b._mtime - a._mtime);
    return { cwd, sessions: sessions.map(({ _mtime, ...s }) => s) };
  });
  groups.sort((a, b) => Date.parse(b.sessions[0].lastActivity) - Date.parse(a.sessions[0].lastActivity));
  return { window, groups };
}

module.exports = { listRecent, defaultClaudeDir };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/recent.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/recent.js test/recent.test.js
git commit -m "feat: recent-session discovery scanner (grouped, time-filtered)"
```

---

### Task 2: `buildSpawn --resume` + registry/index passthrough

**Files:**
- Modify: `server/pty.js`, `server/sessions.js`, `server/index.js`
- Test: `test/pty.test.js`

**Interfaces:**
- Produces: `buildSpawn({ ..., resumeId })` includes `--resume <resumeId>` (before `--settings`). `registry.create(cwd, opts = {})` forwards `opts` to `spawnPty(cwd, id, opts)`. `index.js` `spawnPty(cwd, id, opts)` spreads `opts` into `spawnClaude`.

- [ ] **Step 1: Add the pty test**

In `test/pty.test.js`, add:

```javascript
test('buildSpawn includes --resume before --settings when resumeId is given', () => {
  const r = buildSpawn({
    command: process.execPath,
    settingsPath: 'C:/cc/cockpit-settings.generated.json',
    sessionId: 'sess-1',
    port: 4477,
    resumeId: 'claude-abc',
  });
  assert.deepStrictEqual(r.args, ['--resume', 'claude-abc', '--settings', 'C:/cc/cockpit-settings.generated.json']);
});

test('buildSpawn omits --resume when no resumeId', () => {
  const r = buildSpawn({ command: process.execPath, settingsPath: 'C:/x.json' });
  assert.deepStrictEqual(r.args, ['--settings', 'C:/x.json']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/pty.test.js`
Expected: FAIL — `--resume` not present in `r.args`.

- [ ] **Step 3: Implement**

In `server/pty.js`, update `buildSpawn`:

```javascript
function buildSpawn({ command = 'claude', args = [], settingsPath, sessionId, port, resumeId } = {}) {
  const finalArgs = [...args];
  if (resumeId) finalArgs.push('--resume', resumeId);
  if (settingsPath) finalArgs.push('--settings', settingsPath);
  const env = { ...process.env };
  if (sessionId) env.CC_COCKPIT_SESSION = sessionId;
  if (port != null) env.CC_COCKPIT_PORT = String(port);
  return { file: resolveExecutable(command), args: finalArgs, env };
}
```

In `server/sessions.js`, update `create` to forward options:

```javascript
  create(cwd, opts = {}) {
    const id = crypto.randomUUID();
    const label = path.basename(cwd) || cwd;
    const pty = this.spawnPty(cwd, id, opts);
```

(everything else in `create` unchanged.)

In `server/index.js`, update the `spawnPty` wiring to forward opts:

```javascript
const { server } = createApp({
  spawnPty: (cwd, sessionId, opts = {}) => spawnClaude(cwd, { settingsPath, sessionId, port: PORT, ...opts }),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/pty.test.js`
Expected: PASS. Also run `npm test -- test/sessions.test.js` — still green (create's new optional arg is backward compatible).

- [ ] **Step 5: Commit**

```bash
git add server/pty.js server/sessions.js server/index.js test/pty.test.js
git commit -m "feat: buildSpawn --resume; registry/index forward spawn opts"
```

---

### Task 3: `GET /api/recent` + WS `resume`

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `recent.listRecent`, `registry.create(cwd, { resumeId })`.
- Produces: `createApp({ ..., claudeDir })`. `GET /api/recent?window=day|3d|week` → `200 { window, groups }`. WS `resume {id, cwd}` → starts a resumed session.

- [ ] **Step 1: Add tests**

In `test/app.test.js` add (the fixture helper mirrors `test/recent.test.js`):

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/app.test.js`
Expected: FAIL — `/api/recent` 404; WS `resume` never creates a session (no handler), `created` times out.

- [ ] **Step 3: Implement in `server/app.js`**

Add the require at the top:

```javascript
const recent = require('./recent');
```

Add `claudeDir` to the signature:

```javascript
function createApp({ spawnPty, publicDir = DEFAULT_PUBLIC_DIR, projectsRoot = projects.projectsRoot(), claudeDir } = {}) {
```

Add the recent route next to the project routes (before the static block):

```javascript
    if (req.method === 'GET' && urlPath === '/api/recent') {
      const window = new URL(req.url, 'http://localhost').searchParams.get('window') || 'day';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(recent.listRecent(window, { claudeDir })));
      return;
    }
```

Add the WS branch next to `remove`:

```javascript
      } else if (m.type === 'resume') {
        try { registry.create(m.cwd, { resumeId: m.id }); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/app.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "feat: GET /api/recent and WS resume"
```

---

### Task 4: UI — Resume button + modal

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`
- Test: none (UI verified live).

**Interfaces:**
- Consumes: `GET /api/recent?window=`; WS `resume {id, cwd}`.

- [ ] **Step 1: Add the Resume button in `public/index.html`**

Change the button area (line with `add-btn`) to include a Resume button:

```html
    <button id="add-btn">+ New session</button>
    <button id="resume-btn">Resume…</button>
```

- [ ] **Step 2: Add the resume modal in `public/app.js`**

Append (reuses `openModal` from Plan 1):

```javascript
function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  const h = diff / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(diff / 60e3))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function openResumePicker() {
  openModal((box, close) => {
    box.innerHTML =
      '<h2>Resume a session</h2>' +
      '<div class="window-tabs"><button data-w="day">Day</button><button data-w="3d">3 days</button><button data-w="week">Week</button></div>' +
      '<div class="modal-list">Loading…</div>';
    const tabs = box.querySelector('.window-tabs');
    const listDiv = box.querySelector('.modal-list');

    async function load(window) {
      for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.w === window);
      listDiv.textContent = 'Loading…';
      try {
        const res = await fetch(`/api/recent?window=${window}`);
        const { groups } = await res.json();
        listDiv.innerHTML = '';
        if (!groups.length) { listDiv.textContent = 'No sessions in this window.'; return; }
        for (const g of groups) {
          const head = document.createElement('div');
          head.className = 'recent-group';
          head.textContent = g.cwd || '(unknown folder)';
          listDiv.appendChild(head);
          for (const s of g.sessions) {
            const b = document.createElement('button');
            b.className = 'recent-row';
            b.innerHTML = `<span class="recent-title"></span><span class="recent-time"></span>`;
            b.querySelector('.recent-title').textContent = s.title;
            b.querySelector('.recent-time').textContent = relTime(s.lastActivity);
            b.onclick = () => { ws.send(JSON.stringify({ type: 'resume', id: s.id, cwd: g.cwd })); close(); };
            listDiv.appendChild(b);
          }
        }
      } catch { listDiv.textContent = 'Failed to load sessions.'; }
    }

    tabs.onclick = (e) => { if (e.target.dataset.w) load(e.target.dataset.w); };
    load('day');
  });
}

document.getElementById('resume-btn').onclick = openResumePicker;
```

- [ ] **Step 3: Add styles in `public/styles.css`**

Append:

```css
#resume-btn { padding: 8px; background: #3a3d41; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
#resume-btn:hover { background: #4a4d51; }
.window-tabs { display: flex; gap: 4px; }
.window-tabs button { flex: 1; background: #2d2d30; border: none; color: #ddd; padding: 6px; border-radius: 4px; cursor: pointer; }
.window-tabs button.active { background: #0e639c; }
.recent-group { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-row { display: flex; justify-content: space-between; gap: 8px; text-align: left; background: #2d2d30; border: none; color: #ddd; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.recent-row:hover { background: #094771; }
.recent-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-time { color: #888; flex: 0 0 auto; }
```

- [ ] **Step 4: Live-verify** — fake-pty preview server with a temp `claudeDir` fixture (a couple of jsonl sessions with recent mtimes). Confirm the Resume button opens the modal; tabs switch windows; sessions show grouped by folder with titles + relative times; clicking a row sends `resume` and a new live session appears. (The fixture means no real Claude is launched.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: Resume modal with day/3d/week tabs and grouped recents"
```

---

### Task 5: Full-suite + live verification + status doc

**Files:** `CLAUDE.md` (status), else verification only.

- [ ] **Step 1: Full suite** — `npm test`, all green, stable across two runs, exit 0.
- [ ] **Step 2: Boot smoke** — boot the real app wiring on an ephemeral port; confirm `GET /`, `GET /api/projects`, and `GET /api/recent?window=day` all return 200.
- [ ] **Step 3: Update `CLAUDE.md`** with a Plan-2 bullet (discovery + resume done) and commit.

---

## Self-Review

**Spec coverage (Part B):**
- B1 recent scan (top-level only, subagents excluded, mtime window, aiTitle/user-msg title, group+sort) → Task 1.
- B2 resume (modal day/3d/week; WS resume; `--resume <id>` in original cwd; cockpit id independent) → Tasks 2–4.
- B3 server (`buildSpawn` resumeId; `create(cwd,opts)`; index passthrough) → Task 2.

**Placeholder scan:** none — full code/commands throughout.

**Type consistency:** `listRecent(window,{claudeDir,now})` shape matches the `/api/recent` route and the UI's `groups[].cwd`/`sessions[].{id,title,lastActivity}`. `resumeId` is the option name across `buildSpawn`, `create(cwd,opts)`, `index.js` passthrough, and the WS `resume` handler. `claudeDir` is the `createApp` option consumed by the recent route.
