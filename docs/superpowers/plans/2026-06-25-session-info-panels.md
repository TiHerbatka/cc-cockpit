# Session Info Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface session info in the GUI — native Claude todos (D) and the assistant's topic tracking (B) as foldable panels, a usage chip (A), and buttons to open the session's docs/TODO files (C).

**Architecture:** D renders the already-broadcast `status.todos`; B adds a server-side poll of `~/.claude/topics/<id>.json` broadcast on the session; A parses the live terminal footer client-side (like the mode chip); C adds an `open-file` WS message that opens a cwd file via the OS default app.

**Tech Stack:** Plain Node, `node:test`, `ws`, vanilla DOM + xterm.js. Repo conventions.

## Global Constraints

- No new deps, no build step. `npm test` = `node --test --test-force-exit`.
- Per project guideline: restart the cockpit after changes (unconditional).
- Spec: `docs/superpowers/specs/2026-06-25-session-info-panels-design.md`. Branch `feat/gui-mode`.
- Build order = priority: **D, then B, then A, then C.**
- Known-unavailable: `7d $` and `7d` reset date (not exposed) — do not attempt.

---

## File structure

- `public/gui.js` *(modify)* — Todos panel (D) + Topics panel (B) render; both collapsible.
- `server/topics.js` *(new)* — `readTopics(ccSessionId, {claudeDir, fs})` pure file read.
- `server/sessions.js` *(modify)* — store `topics`; `setTopics(id, topics)`; expose `topics` on the public session.
- `server/app.js` *(modify)* — topics poll → `setTopics` (B); `open-file` WS handler (C).
- `public/usageparse.js` *(new)* — pure `parseUsage(footerText)`.
- `public/index.html` / `public/app.js` / `public/styles.css` *(modify)* — usage chip (A), doc buttons (C), panel wiring.
- Tests: `test/topics.test.js`, `test/usageparse.test.js` *(new)*; `test/sessions.test.js`, `test/app.test.js` *(extend)*.

---

## Task 1 (D): Native todos panel  *(client-only; priority)*

**Files:** Modify `public/gui.js`, `public/styles.css`. Browser-verified.

**Interfaces — Consumes:** the `gui-snapshot` model's `status.todos` (`[{content, status}]`, already produced by the normalizer). **Produces:** a collapsible Todos panel rendered in `update(model)`.

- [ ] **Step 1: Add the panel container** in `mountGui`'s innerHTML, between `.gui-status` and `.gui-perm`:

```js
+ '<div class="gui-todos-panel" hidden>'
+ '<div class="panel-head"><span class="panel-caret">▾</span> Todos <span class="panel-count"></span></div>'
+ '<ul class="panel-todos"></ul>'
+ '</div>'
```
Grab refs after the innerHTML: `const todosPanel = container.querySelector('.gui-todos-panel'); const todosHead = todosPanel.querySelector('.panel-head'); const todosList = todosPanel.querySelector('.panel-todos'); const todosCount = todosPanel.querySelector('.panel-count'); let todosCollapsed = false;` and wire the header to toggle: `todosHead.onclick = () => { todosCollapsed = !todosCollapsed; todosList.hidden = todosCollapsed; todosPanel.querySelector('.panel-caret').textContent = todosCollapsed ? '▸' : '▾'; };`

- [ ] **Step 2: Render in `update(model)`** — after `renderStatus`/`renderLog`, render the todos panel from `model.status.todos`:

```js
const todos = (model && model.status && model.status.todos) || null;
if (!todos || !todos.length) { todosPanel.hidden = true; }
else {
  todosPanel.hidden = false;
  const done = todos.filter((t) => t.status === 'completed').length;
  todosCount.textContent = `(${done}/${todos.length})`;
  todosList.innerHTML = '';
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = `todo-${esc(t.status)}`;
    li.textContent = `${TODO_GLYPH[t.status] || '•'} ${t.content}`;
    todosList.appendChild(li);
  }
}
```
(`TODO_GLYPH` and `esc` already exist in gui.js.)

- [ ] **Step 3: styles.css** — panel + collapsible:

```css
.gui-todos-panel, .gui-topics-panel { flex: 0 0 auto; margin: 6px 12px 0; border: 1px solid #2f2f33; border-radius: 6px; background: #232326; }
.panel-head { cursor: pointer; padding: 5px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9cdcfe; user-select: none; }
.panel-head:hover { background: #2a2a2e; }
.panel-caret { display: inline-block; width: 10px; }
.panel-count { color: #888; }
.panel-todos { list-style: none; margin: 0; padding: 4px 12px 8px; font-size: 12px; }
.panel-todos li { padding: 1px 0; color: #bbb; }
.panel-todos li.todo-completed { color: #5a7d5a; }
.panel-todos li.todo-in_progress { color: #d0d033; }
```

- [ ] **Step 4: Browser verify** — a session running TodoWrite/Task todos shows the Todos panel with the live list; the header toggles it collapsed/expanded; count = done/total.

- [ ] **Step 5: Commit** — `git add public/gui.js public/styles.css && git commit -m "feat(gui): collapsible native todos panel (TodoWrite/Task)"`

---

## Task 2 (B): `server/topics.js` — read the topics file

**Files:** Create `server/topics.js`, `test/topics.test.js`.

**Interfaces — Produces:** `readTopics(ccSessionId, { claudeDir, fs }) -> [{ code, name, status, summary }]` — reads `<claudeDir>/topics/<ccSessionId>.json`; returns `[]` on missing/malformed.

- [ ] **Step 1: Failing test** — `test/topics.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTopics } = require('../server/topics');

function dirWith(id, content) {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-topics-'));
  fs.mkdirSync(path.join(claudeDir, 'topics'), { recursive: true });
  if (content !== undefined) fs.writeFileSync(path.join(claudeDir, 'topics', `${id}.json`), content);
  return claudeDir;
}

test('reads the topics array', () => {
  const id = 'sess-1';
  const claudeDir = dirWith(id, JSON.stringify({ session_id: id, topics: [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }] }));
  assert.deepStrictEqual(readTopics(id, { claudeDir }), [{ code: 'TPC1', name: 'A', status: 'active', summary: 's' }]);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
test('missing file -> []', () => {
  const claudeDir = dirWith('sess-x', undefined);
  assert.deepStrictEqual(readTopics('nope', { claudeDir }), []);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
test('malformed json -> []', () => {
  const claudeDir = dirWith('sess-2', '{not json');
  assert.deepStrictEqual(readTopics('sess-2', { claudeDir }), []);
  fs.rmSync(claudeDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, verify FAIL** — `node --test --test-force-exit test/topics.test.js`.

- [ ] **Step 3: Implement `server/topics.js`:**

```js
// server/topics.js
// Read the assistant's per-session topic tracker (~/.claude/topics/<id>.json).
// Pure-ish: fs/claudeDir injectable; returns [] on any problem (purely additive).
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readTopics(ccSessionId, { claudeDir = defaultClaudeDir(), fs = nodeFs } = {}) {
  if (!ccSessionId) return [];
  try {
    const file = path.join(claudeDir, 'topics', `${ccSessionId}.json`);
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(obj && obj.topics) ? obj.topics : [];
  } catch { return []; }
}

module.exports = { readTopics, defaultClaudeDir };
```

- [ ] **Step 4: Run, verify PASS. Step 5: Commit** — `git add server/topics.js test/topics.test.js && git commit -m "feat(gui): read per-session topics file"`

---

## Task 3 (B): registry `setTopics` + expose on public session

**Files:** Modify `server/sessions.js`; Test `test/sessions.test.js`.

**Interfaces — Produces:** `registry.setTopics(id, topics)` — stores `topics` and emits `sessions` only when changed (JSON-compared); public session gains `topics` (default `[]`).

- [ ] **Step 1: Failing test** in `test/sessions.test.js`:

```js
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
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement** in `server/sessions.js`:
  - In `create`, add `topics: [],` to the session object (near `mode`).
  - Add the method (near `setMode`):

```js
setTopics(id, topics) {
  const s = this.sessions.get(id);
  if (!s) return;
  const next = Array.isArray(topics) ? topics : [];
  if (JSON.stringify(next) === JSON.stringify(s.topics)) return;
  s.topics = next;
  this.emit('sessions');
}
```
  - In `_public`, add `topics: s.topics,`.

- [ ] **Step 4: Run, verify PASS; `npm test` green. Step 5: Commit** — `git add server/sessions.js test/sessions.test.js && git commit -m "feat(gui): registry setTopics + topics on public session"`

---

## Task 4 (B): server topics poll + broadcast

**Files:** Modify `server/app.js`; Test `test/app.test.js`.

**Interfaces — Consumes:** `readTopics` (Task 2), `registry.setTopics` (Task 3). **Produces:** a low-frequency poll (alongside the temp-title poll) that calls `registry.setTopics(s.id, readTopics(s.ccSessionId, {claudeDir}))` for each live session, so the GUI receives topics via the `sessions` broadcast.

- [ ] **Step 1: Failing test** in `test/app.test.js`:

```js
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
  // seed the topics file for this session's ccSessionId
  fs.writeFileSync(path.join(claudeDir, 'topics', `${sess.ccSessionId}.json`),
    JSON.stringify({ session_id: sess.ccSessionId, topics: [{ code: 'TPC1', name: 'Build', status: 'active', summary: 'do it' }] }));
  const withTopics = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].topics && m.sessions[0].topics.length === 1);
  const sm = await withTopics;
  assert.strictEqual(sm.sessions[0].topics[0].code, 'TPC1');
  ws.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement** — in `server/app.js`, add the require `const { readTopics } = require('./topics');` and a poll near the existing `titlePoll` (use a short interval so the test passes promptly):

```js
const topicsPoll = setInterval(() => {
  for (const s of registry.list()) {
    try { registry.setTopics(s.id, readTopics(s.ccSessionId, { claudeDir })); } catch { /* ignore */ }
  }
}, 1500);
if (topicsPoll.unref) topicsPoll.unref();
server.on('close', () => clearInterval(topicsPoll));
```

- [ ] **Step 4: Run, verify PASS; `npm test` green. Step 5: Commit** — `git add server/app.js test/app.test.js && git commit -m "feat(gui): poll + broadcast per-session topics"`

---

## Task 5 (B): Topics panel (client)

**Files:** Modify `public/gui.js`, `public/app.js`, `public/styles.css`. Browser-verified.

**Interfaces — Consumes:** the focused session's `topics` (from the `sessions` broadcast). **Produces:** `gui.setTopics(topics)` → renders a collapsible Topics panel; rows fold/unfold to show the summary; a "show resolved" toggle; click-the-code copies it.

- [ ] **Step 1: gui.js panel container** — add after the Todos panel in `mountGui` innerHTML:

```js
+ '<div class="gui-topics-panel" hidden>'
+ '<div class="panel-head"><span class="panel-caret">▾</span> Topics <span class="panel-count"></span>'
+ '<label class="show-resolved"><input type="checkbox"> resolved</label></div>'
+ '<ul class="panel-topics"></ul>'
+ '</div>'
```
Refs + collapse toggle (same pattern as Todos). The `.show-resolved` checkbox toggles whether resolved topics are listed.

- [ ] **Step 2: gui.js `setTopics(topics)`** — render rows; clicking a row toggles a summary sub-line; clicking the code copies it:

```js
setTopics(topics) {
  const all = Array.isArray(topics) ? topics : [];
  const showResolved = topicsPanel.querySelector('.show-resolved input').checked;
  const shown = all.filter((t) => showResolved || t.status !== 'resolved');
  if (!all.length) { topicsPanel.hidden = true; return; }
  topicsPanel.hidden = false;
  topicsCount.textContent = `(${shown.length})`;
  topicsList.innerHTML = '';
  for (const t of shown) {
    const li = document.createElement('li');
    li.className = `topic-${esc(t.status)}`;
    const dot = t.status === 'active' ? '●' : t.status === 'parked' ? '◐' : '○';
    li.innerHTML = `<span class="topic-row"><span class="topic-code" title="copy code">${esc(t.code)}</span> <span class="topic-name">${esc(t.name)}</span> <span class="topic-dot">${dot}</span></span><div class="topic-summary" hidden></div>`;
    li.querySelector('.topic-summary').textContent = t.summary || '';
    li.querySelector('.topic-row').onclick = (e) => {
      if (e.target.classList.contains('topic-code')) { navigator.clipboard && navigator.clipboard.writeText(t.code); return; }
      const sum = li.querySelector('.topic-summary'); sum.hidden = !sum.hidden;
    };
    topicsList.appendChild(li);
  }
}
```
Wire the show-resolved checkbox `onchange` to re-call `setTopics(lastTopics)` (store the last topics passed).

- [ ] **Step 3: app.js** — in the `sessions` handler, after updating head, push the focused session's topics to the gui: `const fs2 = sessions.find((x) => x.id === focusedId); gui.setTopics(fs2 ? fs2.topics : []);`

- [ ] **Step 4: styles.css** — topic rows, dots (active green, parked dim, resolved muted), summary indent, code copy affordance:

```css
.panel-topics { list-style: none; margin: 0; padding: 4px 12px 8px; font-size: 12px; }
.panel-topics li { padding: 2px 0; }
.topic-row { cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline; }
.topic-code { color: #9cdcfe; cursor: copy; }
.topic-name { color: #ddd; }
.topic-dot { font-size: 10px; }
.topic-active .topic-dot { color: #4ec9b0; }
.topic-parked { opacity: 0.6; }
.topic-resolved { opacity: 0.5; }
.topic-summary { margin: 2px 0 4px 16px; color: #aaa; white-space: pre-wrap; }
.show-resolved { float: right; font-size: 10px; color: #888; text-transform: none; letter-spacing: 0; cursor: pointer; }
```

- [ ] **Step 5: Browser verify** — a session with topics shows the Topics panel; rows fold/unfold summaries; the resolved toggle reveals resolved; clicking a code copies it; panel header collapses the whole panel.

- [ ] **Step 6: Commit** — `git add public/gui.js public/app.js public/styles.css && git commit -m "feat(gui): foldable topics panel (summaries, show-resolved, copy code)"`

---

## Task 6 (A): `public/usageparse.js` — parse usage from the footer

**Files:** Create `public/usageparse.js`, `test/usageparse.test.js`.

**Interfaces — Produces:** `parseUsage(footerText) -> { ctx, fiveHourPct, fiveHourRel, fiveHourReset, sevenDayPct }` (fields `null` when absent). Footer format (known): `… | ctx 4% | 5h 39% (1h6m/14:40) | 7d 26% | …`.

- [ ] **Step 1: Failing test** — `test/usageparse.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseUsage } = require('../public/usageparse');

test('parses ctx, 5h (+rel/reset), 7d', () => {
  const u = parseUsage('Opus | ~/x | ctx 4% | 5h 39% (1h6m/14:40) | 7d 26%');
  assert.deepStrictEqual(u, { ctx: 4, fiveHourPct: 39, fiveHourRel: '1h6m', fiveHourReset: '14:40', sevenDayPct: 26 });
});
test('5h without the (rel/reset) detail', () => {
  const u = parseUsage('ctx 10% | 5h 5% | 7d 1%');
  assert.deepStrictEqual([u.ctx, u.fiveHourPct, u.fiveHourRel, u.fiveHourReset, u.sevenDayPct], [10, 5, null, null, 1]);
});
test('missing segments -> nulls', () => {
  const u = parseUsage('Opus | ~/x');
  assert.deepStrictEqual([u.ctx, u.fiveHourPct, u.sevenDayPct], [null, null, null]);
});
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement `public/usageparse.js`:**

```js
// public/usageparse.js
// Pure: parse Claude usage from the statusline footer text (xterm-translated).
// Format: "… | ctx N% | 5h N% (rel/reset) | 7d N% | …". Dual-exported for browser + node test.
function parseUsage(text) {
  const t = String(text || '');
  const ctx = (t.match(/\bctx\s+(\d+)%/i) || [])[1];
  const five = t.match(/\b5h\s+(\d+)%(?:\s*\(([^/)]+)\/([^)]+)\))?/i);
  const seven = (t.match(/\b7d\s+(\d+)%/i) || [])[1];
  return {
    ctx: ctx != null ? Number(ctx) : null,
    fiveHourPct: five ? Number(five[1]) : null,
    fiveHourRel: five && five[2] ? five[2].trim() : null,
    fiveHourReset: five && five[3] ? five[3].trim() : null,
    sevenDayPct: seven != null ? Number(seven) : null,
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseUsage };
if (typeof window !== 'undefined') window.parseUsage = parseUsage;
```

- [ ] **Step 4: Run, verify PASS. Step 5: Commit** — `git add public/usageparse.js test/usageparse.test.js && git commit -m "feat(gui): pure parseUsage (footer -> usage)"`

---

## Task 7 (A): Usage chip (client)

**Files:** Modify `public/index.html`, `public/app.js`, `public/styles.css`. Browser-verified.

**Interfaces — Consumes:** `parseUsage` (Task 6); the focused `term` buffer footer (read via the existing `readClaudeMode` mechanism).

- [ ] **Step 1: index.html** — load the script (`<script src="/usageparse.js"></script>` before app.js) and add a chip to `#session-head` (after `#claude-mode`): `<span id="usage-chip" class="usage-chip" title="Context / 5h / 7d usage"></span>`.

- [ ] **Step 2: app.js** — extend the existing footer reader to also update usage. In `refreshClaudeMode` (rename concept: it already reads the footer rows), after setting the mode, compute and render usage from the same `rows.join('\n')`:

```js
// inside the setTimeout body of refreshClaudeMode, reuse the footer text:
const footer = (() => { try { const b = term.buffer.active; const r = []; const start = Math.max(0, b.length - 12); for (let i = start; i < b.length; i++) { const ln = b.getLine(i); r.push(ln ? ln.translateToString(true) : ''); } return r.join('\n'); } catch { return ''; } })();
if (claudeModeEl) claudeModeEl.textContent = window.parseClaudeMode(footer);
const usageEl = document.getElementById('usage-chip');
if (usageEl) {
  const u = window.parseUsage(footer);
  const pc = (p) => (p == null ? '' : (p < 60 ? 'u-green' : p < 85 ? 'u-yellow' : 'u-red'));
  const parts = [];
  if (u.ctx != null) parts.push(`<span class="${pc(u.ctx)}">ctx ${u.ctx}%</span>`);
  if (u.fiveHourPct != null) parts.push(`<span class="${pc(u.fiveHourPct)}">5h ${u.fiveHourPct}%${u.fiveHourRel ? ` (${u.fiveHourRel} left· resets ${u.fiveHourReset})` : ''}</span>`);
  if (u.sevenDayPct != null) parts.push(`<span class="${pc(u.sevenDayPct)}">7d ${u.sevenDayPct}%</span>`);
  usageEl.innerHTML = parts.join(' · ');
}
```
(Refactor: extract the footer-rows read into one `readFooter()` helper used by both mode and usage, to keep it DRY.)

- [ ] **Step 3: styles.css** — `.usage-chip { font-size: 11px; color: #bbb; white-space: nowrap; } .u-green{color:#4ec9b0}.u-yellow{color:#e2c08d}.u-red{color:#f14c4c}`

- [ ] **Step 4: Browser verify** — a running session shows `ctx N% · 5h N% (… left· resets …) · 7d N%`, color-coded, updating as the session works.

- [ ] **Step 5: Commit** — `git add public/index.html public/app.js public/styles.css && git commit -m "feat(gui): usage chip (ctx / 5h / 7d) from footer"`

---

## Task 8 (C): server `open-file`

**Files:** Modify `server/app.js`; Test `test/app.test.js`.

**Interfaces — Consumes:** the injectable opener. **Produces:** WS `open-file {id, which}` (`which` ∈ `'docs'|'todo'`) → resolves `<cwd>/local-docs.md` or `<cwd>/TODO.md` and opens it via the OS default app; replies `error` if the file is missing. A new injectable `openFile(path)` (default uses the shell open).

- [ ] **Step 1: Failing test** in `test/app.test.js`:

```js
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

  ws.send(JSON.stringify({ type: 'open-file', id, which: 'docs' }));
  const errForTodo = nextMessage(ws, (m) => m.type === 'error');
  ws.send(JSON.stringify({ type: 'open-file', id, which: 'todo' })); // TODO.md missing
  await errForTodo;
  assert.deepStrictEqual(calls, [path.join(cwd, 'local-docs.md')]);

  ws.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement** in `server/app.js`:
  - Add a default opener + accept it in `createApp({ ..., openFile = defaultOpenFile })`:

```js
function defaultOpenFile(file) {
  if (!file) return;
  // `start` via cmd opens with the OS default app; "" is the title arg.
  try { spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
}
```
  - WS handler:

```js
} else if (m.type === 'open-file') {
  const s = registry.get(m.id);
  if (s) {
    const name = m.which === 'todo' ? 'TODO.md' : 'local-docs.md';
    const file = path.join(s.cwd, name);
    if (fs.existsSync(file)) openFile(file);
    else ws.send(JSON.stringify({ type: 'error', message: `${name} not found in ${s.cwd}` }));
  }
}
```

- [ ] **Step 4: Run, verify PASS; `npm test` green. Step 5: Commit** — `git add server/app.js test/app.test.js && git commit -m "feat(gui): open-file (local-docs/TODO) via OS default app"`

---

## Task 9 (C): Doc buttons (client)

**Files:** Modify `public/index.html`, `public/app.js`, `public/styles.css`. Browser-verified.

- [ ] **Step 1: index.html** — add to `#session-head` (before `#mode-switch`): `<button id="open-docs" class="doc-btn" title="Open local-docs.md">📄 Docs</button><button id="open-todo" class="doc-btn" title="Open TODO.md">✓ TODO</button>`.

- [ ] **Step 2: app.js** — wire:

```js
const od = document.getElementById('open-docs'); const ot = document.getElementById('open-todo');
if (od) od.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'open-file', id: focusedId, which: 'docs' })); };
if (ot) ot.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'open-file', id: focusedId, which: 'todo' })); };
```
(The existing `error` handler already shows `errorEl`, so a missing file surfaces a message.)

- [ ] **Step 3: styles.css** — `.doc-btn { background:#2d2d30; color:#bbb; border:1px solid #3c3c3c; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:12px; } .doc-btn:hover{background:#34343a}`

- [ ] **Step 4: Browser verify** — clicking Docs/TODO opens the cwd file in the OS default app; a missing file shows the error text.

- [ ] **Step 5: Commit** — `git add public/index.html public/app.js public/styles.css && git commit -m "feat(gui): Local docs / TODO open buttons"`

---

## Self-review notes (author)

- **Spec coverage:** A = Tasks 6–7; B = Tasks 2–5; C = Tasks 8–9; D = Task 1. The 7d$/reset non-goal is respected (parseUsage never reads them). Layout (header chips/buttons + GUI-pane panels) per spec.
- **Type consistency:** `topics` shape `{code,name,status,summary}` consistent across `readTopics` (T2), `setTopics`/public session (T3), broadcast (T4), `gui.setTopics` (T5). `status.todos` `{content,status}` consistent (T1, normalizer). `parseUsage` field names consistent (T6 producer, T7 consumer). `open-file {id, which}` consistent (T8 server, T9 client).
- **DRY:** T7 extracts a shared `readFooter()` used by both the mode chip and the usage chip.
- **Placeholders:** server/pure tasks carry full code + failing tests; client tasks carry concrete code + browser verification (repo norm).
