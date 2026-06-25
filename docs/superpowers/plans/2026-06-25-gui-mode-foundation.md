# GUI Mode — Foundation Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session GUI mode (default) that renders a normalized conversation + live status by tailing the session's transcript JSONL, with a raw-terminal fallback mode and a one-click MODE switch, plus a compose box that types into the session. (Permissions are Plan 2.)

**Architecture:** The server resolves each session's transcript by a deterministic `--session-id`, tails it incrementally, normalizes records into a model, and pushes that model to the browser over the existing WebSocket. The client renders GUI mode from the model and keeps the existing xterm for Terminal mode; a header-bar switch flips between them per session.

**Tech Stack:** Plain Node (no bundler), `node:test`, `ws`, `node-pty`, vanilla DOM + xterm.js. Same conventions as the rest of the repo.

## Global Constraints

- Node v22+ (machine has v24). No new runtime dependencies; no build step.
- Test runner: `npm test` = `node --test --test-force-exit`. Keep core logic dependency-injected and pure where possible so it is unit-testable without spawning a real `claude`.
- Server binds `127.0.0.1` only; never expose the port.
- Files small and single-responsibility. One commit per task (frequent commits).
- Spec: `docs/superpowers/specs/2026-06-25-rich-frontend-gui-mode-design.md`.
- Branch: `feat/gui-mode` (already created; spec committed there).

---

## File structure (this plan)

- `server/pty.js` *(modify)* — `buildSpawn` appends `--session-id <uuid>` when given.
- `server/sessions.js` *(modify)* — generate a session UUID on `create`, store `sessionId` + `mode` (default `'gui'`), expose them on the public session; add `setMode(id, mode)`; pass the uuid to the spawn.
- `server/transcript.js` *(new)* — `findTranscriptPath(sessionId, {claudeDir})` and `createTailer(filePath, { onRecords, ... })` (incremental offset read, partial-line buffering, watch + poll fallback, start/stop).
- `server/normalize.js` *(new)* — `normalize(records)` → `{ items, status, title }` (pure).
- `server/app.js` *(modify)* — WS `gui-attach` / `gui-detach` / `set-mode`; broadcast `gui-snapshot`; per-watched-session tailer+record-accumulator lifecycle.
- `public/gui.js` *(new)* — render the GUI pane from a model: header bar + MODE switch, status strip, conversation, compose box.
- `public/app.js` *(modify)* — per-session mode, mount GUI pane vs terminal, route `gui-snapshot`, wire the switch + compose.
- `public/styles.css` *(modify)* — pane / header / switch / status / conversation / tool card / compose styles.
- `public/index.html` *(modify)* — load `gui.js`; add the header-bar + gui-pane containers.
- Tests: `test/pty.test.js`, `test/sessions.test.js`, `test/transcript.test.js` *(new)*, `test/normalize.test.js` *(new)*, `test/app.test.js`.

---

## Task 1: Spawn with a deterministic `--session-id`

**Files:**
- Modify: `server/pty.js` (`buildSpawn`)
- Modify: `server/sessions.js` (`create`)
- Test: `test/pty.test.js`, `test/sessions.test.js`

**Interfaces:**
- Consumes: existing `buildSpawn({ command, args, settingsPath, sessionId, port, resumeId })`, `scrubParentClaudeEnv`.
- Produces: `buildSpawn` appends `--session-id <ccSessionId>` (a new option, distinct from the existing cockpit `sessionId` used for `CC_COCKPIT_SESSION`). Registry stores `ccSessionId` (uuid) on each session and passes it to the spawn; public session gains `ccSessionId` and `mode`.

- [ ] **Step 1: Failing test — buildSpawn appends `--session-id`**

In `test/pty.test.js` add:

```js
test('buildSpawn appends --session-id (ccSessionId) before --settings', () => {
  const r = buildSpawn({
    command: process.execPath,
    ccSessionId: '11111111-2222-3333-4444-555555555555',
    settingsPath: 'C:/x.json',
  });
  assert.deepStrictEqual(r.args, ['--session-id', '11111111-2222-3333-4444-555555555555', '--settings', 'C:/x.json']);
});

test('buildSpawn omits --session-id when no ccSessionId', () => {
  const r = buildSpawn({ command: process.execPath, settingsPath: 'C:/x.json' });
  assert.deepStrictEqual(r.args, ['--settings', 'C:/x.json']);
});
```

- [ ] **Step 2: Run it, verify FAIL**

Run: `node --test --test-force-exit --test-name-pattern="session-id" test/pty.test.js`
Expected: FAIL (args don't include `--session-id`).

- [ ] **Step 3: Implement in `buildSpawn`**

In `server/pty.js`, extend the signature and arg composition. `--session-id` must precede `--resume`/`--settings` ordering is not significant to claude, but keep it first for readability and to match the test:

```js
function buildSpawn({ command = 'claude', args = [], settingsPath, sessionId, port, resumeId, ccSessionId } = {}) {
  const finalArgs = [...args];
  if (ccSessionId && !resumeId) finalArgs.push('--session-id', ccSessionId);
  if (resumeId) finalArgs.push('--resume', resumeId);
  if (settingsPath) finalArgs.push('--settings', settingsPath);
  const env = scrubParentClaudeEnv({ ...process.env });
  if (sessionId) env.CC_COCKPIT_SESSION = sessionId;
  if (port != null) env.CC_COCKPIT_PORT = String(port);
  return { file: resolveExecutable(command), args: finalArgs, env };
}
```

(Note: `--session-id` is only added for fresh sessions; a `--resume` carries its own id, so they are mutually exclusive.)

- [ ] **Step 4: Run it, verify PASS** — `node --test --test-force-exit --test-name-pattern="session-id" test/pty.test.js` → PASS.

- [ ] **Step 5: Failing test — registry generates + exposes ccSessionId and default mode**

In `test/sessions.test.js` add (use the existing fake spawn factory in that file; check its name — likely `fakePty`/factory). Capture the opts passed to `spawnPty`:

```js
test('create generates a ccSessionId (uuid), defaults mode to gui, and passes the id to spawn', () => {
  const calls = [];
  const spawnPty = (cwd, sessionId, opts) => { calls.push({ cwd, sessionId, opts }); return fakeHandle(); };
  const reg = new SessionRegistry({ spawnPty, projectsRoot: 'C:/claude_projects/cockpit' });
  const s = reg.create('C:/claude_projects/cockpit/proj');
  assert.match(s.ccSessionId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(s.mode, 'gui');
  assert.strictEqual(calls[0].opts.ccSessionId, s.ccSessionId);
});
```

(`fakeHandle` = the minimal `{ onData, onExit, write, resize, kill }` stub already used in that test file; reuse whatever helper exists. If the registry's `spawnPty` signature differs, match the real one — read `server/sessions.js` `create` first.)

- [ ] **Step 6: Run it, verify FAIL** — `node --test --test-force-exit --test-name-pattern="ccSessionId" test/sessions.test.js` → FAIL.

- [ ] **Step 7: Implement in `server/sessions.js` `create`**

Add `const { randomUUID } = require('node:crypto');` at the top. In `create`, generate the id, store it and `mode: 'gui'` on the session record, and forward it to the spawn opts. (Read the current `create` to merge correctly — preserve `resumeId` handling: if resuming, set `ccSessionId` to the resumeId so correlation still works.)

```js
// inside create(cwd, opts = {})
const ccSessionId = opts.resumeId || randomUUID();
// ...when building the session object:
//   ccSessionId, mode: 'gui',
// ...when spawning:
//   this.spawnPty(cwd, id, { ...opts, ccSessionId })
```

Ensure `list()` / the public session shape includes `ccSessionId` and `mode`.

- [ ] **Step 8: Run it, verify PASS**, then run the full suite: `npm test` → all green.

- [ ] **Step 9: Commit**

```bash
git add server/pty.js server/sessions.js test/pty.test.js test/sessions.test.js
git commit -m "feat(gui): spawn sessions with a deterministic --session-id and default mode"
```

---

## Task 2: Transcript locator + incremental tailer

**Files:**
- Create: `server/transcript.js`
- Test: `test/transcript.test.js`

**Interfaces:**
- Produces:
  - `findTranscriptPath(ccSessionId, { claudeDir }) -> string | null` — scans `<claudeDir>/projects/*/` for `<ccSessionId>.jsonl`.
  - `createTailer(filePath, { onRecords, intervalMs = 250, fs = require('node:fs') }) -> { start(), stop() }` — on start, reads the whole file once (offset 0), parses complete JSON lines, calls `onRecords(records, { initial: true })`; then watches and on growth reads only appended bytes, buffering an incomplete trailing line until its newline, calling `onRecords(records, { initial: false })` for each new batch. Tolerates the file not existing yet (waits and retries) and unparutable lines (skips). `stop()` clears watchers/timers.

- [ ] **Step 1: Failing test — tailer reads initial content then appended lines**

`test/transcript.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTailer, findTranscriptPath } = require('../server/transcript');

function tmpFile() {
  const p = path.join(os.tmpdir(), `cc-tail-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  return p;
}

test('createTailer emits initial records then appended records', async () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ type: 'a', n: 1 }) + '\n' + JSON.stringify({ type: 'b', n: 2 }) + '\n');
  const batches = [];
  const tailer = createTailer(p, { intervalMs: 30, onRecords: (recs, meta) => batches.push({ recs, meta }) });
  tailer.start();
  await new Promise((r) => setTimeout(r, 80));
  fs.appendFileSync(p, JSON.stringify({ type: 'c', n: 3 }) + '\n');
  await new Promise((r) => setTimeout(r, 120));
  tailer.stop();
  fs.unlinkSync(p);
  const initial = batches.find((b) => b.meta.initial);
  assert.ok(initial, 'expected an initial batch');
  assert.deepStrictEqual(initial.recs.map((r) => r.n), [1, 2]);
  const later = batches.filter((b) => !b.meta.initial).flatMap((b) => b.recs.map((r) => r.n));
  assert.deepStrictEqual(later, [3]);
});

test('createTailer buffers an incomplete trailing line until its newline', async () => {
  const p = tmpFile();
  fs.writeFileSync(p, '');
  const recs = [];
  const tailer = createTailer(p, { intervalMs: 20, onRecords: (r) => recs.push(...r) });
  tailer.start();
  await new Promise((r) => setTimeout(r, 50));
  fs.appendFileSync(p, '{"type":"x"');            // partial, no newline
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(recs, []);                // nothing emitted yet
  fs.appendFileSync(p, ',"n":9}\n');               // completes the line
  await new Promise((r) => setTimeout(r, 60));
  tailer.stop();
  fs.unlinkSync(p);
  assert.deepStrictEqual(recs.map((r) => r.n), [9]);
});
```

- [ ] **Step 2: Run it, verify FAIL** — `node --test --test-force-exit test/transcript.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `server/transcript.js`**

```js
// server/transcript.js
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Locate <ccSessionId>.jsonl under <claudeDir>/projects/*/. The basename is the
// exact session id, so this is a cheap one-level scan of the project folders.
function findTranscriptPath(ccSessionId, { claudeDir = defaultClaudeDir(), fs = nodeFs } = {}) {
  if (!ccSessionId) return null;
  const projectsDir = path.join(claudeDir, 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return null; }
  for (const d of dirs) {
    const f = path.join(projectsDir, d.name, `${ccSessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Incremental tailer: reads the whole file once (initial), then only appended
// bytes on each tick, buffering an incomplete trailing line until its newline.
function createTailer(filePath, { onRecords, intervalMs = 250, fs = nodeFs } = {}) {
  let offset = 0;
  let carry = '';
  let timer = null;
  let initialDone = false;

  const tick = () => {
    let st;
    try { st = fs.statSync(filePath); } catch { return; } // not created yet
    if (st.size < offset) { offset = 0; carry = ''; }       // truncated/rotated
    if (st.size === offset && initialDone) return;
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const len = st.size - offset;
      if (len <= 0) { initialDone = true; return; }
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, offset);
      offset += n;
      carry += buf.toString('utf8', 0, n);
    } catch { return; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }

    const parts = carry.split('\n');
    carry = parts.pop();                 // last element is the incomplete remainder
    const records = [];
    for (const ln of parts) {
      const s = ln.trim();
      if (!s) continue;
      try { records.push(JSON.parse(s)); } catch { /* skip unparseable */ }
    }
    const wasInitial = !initialDone;
    initialDone = true;
    if (records.length && typeof onRecords === 'function') onRecords(records, { initial: wasInitial });
  };

  return {
    start() { tick(); timer = setInterval(tick, intervalMs); if (timer.unref) timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { findTranscriptPath, createTailer, defaultClaudeDir };
```

- [ ] **Step 4: Run it, verify PASS** — `node --test --test-force-exit test/transcript.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/transcript.js test/transcript.test.js
git commit -m "feat(gui): transcript locator + incremental JSONL tailer"
```

---

## Task 3: Normalizer (records → model)

**Files:**
- Create: `server/normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Produces: `normalize(records) -> { title, items, status }` (pure), where:
  - `items[]` in order, each one of:
    - `{ kind: 'user', text }` — a human prompt (`type:'user'`, `message.content` is a plain string OR an array of `{type:'text'}`, and NOT a tool_result; ignore content that starts with `<` system-reminder markers).
    - `{ kind: 'assistant', text }` — assistant prose (concatenated `text` blocks of an `assistant` message; empty if none).
    - `{ kind: 'thinking', text }` — a `thinking` block.
    - `{ kind: 'tool', id, name, input, status, resultText }` — a `tool_use` merged with its matching `tool_result` (by `tool_use_id`); `status` = `'pending'` until a result arrives, then `'ok'` or `'error'` (from the result's `is_error`).
    - `{ kind: 'todos', todos: [{content, status}] }` — the latest todo write (TodoWrite `input.todos`, or the project's Task* tools if present; see below).
  - `status` = `{ currentTool: { name, input } | null, todos: [...] | null }` — `currentTool` is the latest `tool` item still `pending`.
  - `title` = the last `ai-title` `aiTitle`, else `null`.

- [ ] **Step 1: Failing tests — core normalization cases**

`test/normalize.test.js` (use small synthetic records mirroring the real shapes observed in `~/.claude/projects/.../*.jsonl`):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../server/normalize');

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

test('assistant text + thinking split into items', () => {
  const m = normalize([asst([
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Doing it.' },
  ])]);
  assert.deepStrictEqual(m.items, [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'assistant', text: 'Doing it.' },
  ]);
});

test('tool_use merges with its tool_result and resolves status', () => {
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

test('TodoWrite produces a todos item and status.todos', () => {
  const todos = [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }];
  const m = normalize([asst([toolUse('t3', 'TodoWrite', { todos })])]);
  const todoItem = m.items.find((i) => i.kind === 'todos');
  assert.deepStrictEqual(todoItem.todos, todos);
  assert.deepStrictEqual(m.status.todos, todos);
});

test('ai-title sets title', () => {
  const m = normalize([{ type: 'ai-title', aiTitle: 'My Session' }]);
  assert.strictEqual(m.title, 'My Session');
});
```

- [ ] **Step 2: Run it, verify FAIL** — `node --test --test-force-exit test/normalize.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `server/normalize.js`**

```js
// server/normalize.js
// Pure: turn raw transcript JSONL records into a render model.
function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('').trim();
  }
  return '';
}
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
  return '';
}

function normalize(records) {
  const items = [];
  const toolIndex = new Map(); // tool_use_id -> item
  let title = null;

  for (const r of records || []) {
    if (!r || !r.type) continue;
    if (r.type === 'ai-title' && r.aiTitle) { title = r.aiTitle; continue; }

    if (r.type === 'user' && r.message) {
      const content = r.message.content;
      // tool_result-bearing user records resolve a pending tool, not a prompt.
      if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) {
        for (const c of content) {
          if (c && c.type === 'tool_result') {
            const it = toolIndex.get(c.tool_use_id);
            if (it) { it.status = c.is_error ? 'error' : 'ok'; it.resultText = resultText(c.content); }
          }
        }
        continue;
      }
      const text = textFromContent(content);
      if (text && !text.startsWith('<')) items.push({ kind: 'user', text });
      continue;
    }

    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const c of r.message.content) {
        if (!c || !c.type) continue;
        if (c.type === 'thinking') { if (c.thinking) items.push({ kind: 'thinking', text: c.thinking }); }
        else if (c.type === 'text') { if (c.text && c.text.trim()) items.push({ kind: 'assistant', text: c.text }); }
        else if (c.type === 'tool_use') {
          if (c.name === 'TodoWrite' && c.input && Array.isArray(c.input.todos)) {
            items.push({ kind: 'todos', todos: c.input.todos });
          } else {
            const it = { kind: 'tool', id: c.id, name: c.name, input: c.input, status: 'pending', resultText: null };
            items.push(it);
            toolIndex.set(c.id, it);
          }
        }
      }
      continue;
    }
  }

  let currentTool = null;
  let todos = null;
  for (const it of items) {
    if (it.kind === 'tool' && it.status === 'pending') currentTool = { name: it.name, input: it.input };
    if (it.kind === 'todos') todos = it.todos;
  }
  return { title, items, status: { currentTool, todos } };
}

module.exports = { normalize };
```

- [ ] **Step 4: Run it, verify PASS** — `node --test --test-force-exit test/normalize.test.js` → PASS.

- [ ] **Step 5: Reality check against a real transcript (manual, no commit yet)**

Run a one-off to confirm the normalizer survives a real file (replace with any real id under the cc-cockpit project dir):

```bash
node -e "const{normalize}=require('./server/normalize');const fs=require('fs');const recs=fs.readFileSync(process.argv[1],'utf8').split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);const m=normalize(recs);console.log('items',m.items.length,'title',m.title,'kinds',JSON.stringify(m.items.reduce((a,i)=>(a[i.kind]=(a[i.kind]||0)+1,a),{})));" "$HOME/.claude/projects/C--temp-powershell-cc-cockpit/<SOME_ID>.jsonl"
```

Expected: a sane kind histogram (user/assistant/thinking/tool/todos), no throw. If a real shape differs from the synthetic tests, add a failing test for it and fix `normalize` before continuing.

- [ ] **Step 6: Commit**

```bash
git add server/normalize.js test/normalize.test.js
git commit -m "feat(gui): pure transcript normalizer (records -> model)"
```

---

## Task 4: Server GUI wiring (attach/detach/mode + snapshot push)

**Files:**
- Modify: `server/sessions.js` (add `setMode`; expose `ccSessionId`/`mode` on the public session — done in Task 1; here add `setMode` + a `sessions` emit on change)
- Modify: `server/app.js` (WS handlers + tailer/normalizer lifecycle)
- Test: `test/app.test.js`, `test/sessions.test.js`

**Interfaces:**
- Consumes: `findTranscriptPath`, `createTailer` (Task 2), `normalize` (Task 3); registry `get(id)`, `list()`, public session `{ ccSessionId, mode }`.
- Produces:
  - WS client→server: `{type:'gui-attach', id}`, `{type:'gui-detach', id}`, `{type:'set-mode', id, mode}`.
  - WS server→client: `{type:'gui-snapshot', id, model}` (sent on attach and on each new-records batch while watched).
  - `registry.setMode(id, mode)` → updates the session's `mode`, emits `sessions`.
  - Per cockpit client connection: a map of watched session id → `{ tailer, records }`. On `gui-attach`, resolve the transcript path (retry-tolerant via the tailer), start a tailer that accumulates `records` and re-normalizes, and send `gui-snapshot`. On `gui-detach` or socket close, stop the tailer.

- [ ] **Step 1: Failing test — setMode updates mode and broadcasts**

In `test/sessions.test.js`:

```js
test('setMode updates the session mode and emits sessions', () => {
  const reg = new SessionRegistry({ spawnPty: (c, id, o) => fakeHandle(), projectsRoot: 'C:/claude_projects/cockpit' });
  const s = reg.create('C:/claude_projects/cockpit/p');
  let emitted = 0; reg.on('sessions', () => emitted++);
  reg.setMode(s.id, 'terminal');
  assert.strictEqual(reg.get(s.id).mode, 'terminal');
  assert.ok(emitted >= 1);
});
```

- [ ] **Step 2: Run it, verify FAIL**, then implement `setMode` in `server/sessions.js`:

```js
setMode(id, mode) {
  const s = this.sessions.get(id);
  if (!s || (mode !== 'gui' && mode !== 'terminal') || s.mode === mode) return;
  s.mode = mode;
  this.emit('sessions');
}
```

(Match the registry's internal field names — read the file; it may store sessions in `this.sessions` Map and emit via `this.emit`.) Verify PASS.

- [ ] **Step 3: Failing test — gui-attach returns a snapshot from a fake transcript**

In `test/app.test.js`, add a test that injects a `claudeDir` pointing at a temp projects tree containing `<ccSessionId>.jsonl`. `createApp` already accepts `claudeDir`. Use the existing fake-PTY harness and a real temp file:

```js
test('gui-attach streams a normalized snapshot from the session transcript', async () => {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccdir-'));
  const projDir = path.join(claudeDir, 'projects', 'proj'); fs.mkdirSync(projDir, { recursive: true });
  const { factory } = fakePtyFactory();
  // Force a known ccSessionId by stubbing randomUUID via opts: capture the id the registry generated.
  const app = createApp({ spawnPty: factory, claudeDir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  // create a session, learn its ccSessionId from the sessions broadcast
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  // ... send create, await 'sessions', read ccSessionId, write the transcript file at projDir/<ccSessionId>.jsonl,
  //     send gui-attach, await 'gui-snapshot', assert model.items includes the user prompt.
  // (Full wiring mirrors existing app.test.js patterns.)
});
```

(If precisely driving `randomUUID` is awkward, prefer reading the `ccSessionId` from the `sessions` broadcast after `create`, then writing the transcript file at that id — deterministic and side-effect-free. Keep the assertion minimal: snapshot arrives and contains the seeded prompt.)

- [ ] **Step 4: Run it, verify FAIL**, then implement in `server/app.js`.

Add near the top: `const { findTranscriptPath, createTailer } = require('./transcript'); const { normalize } = require('./normalize');` and accept `claudeDir` (already in `createApp` args). Inside `wss.on('connection')`, per-socket:

```js
const watched = new Map(); // sessionId -> { tailer, records }

const startWatch = (id) => {
  if (watched.has(id)) return;
  const s = registry.get(id);
  if (!s || !s.ccSessionId) return;
  const entry = { tailer: null, records: [] };
  const pushSnapshot = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'gui-snapshot', id, model: normalize(entry.records) })); };
  // The transcript file may not exist yet for a brand-new session; the tailer
  // tolerates that and starts emitting once it appears. Resolve lazily on each tick.
  let resolved = null;
  entry.tailer = {
    _poll: setInterval(() => {
      if (resolved) return;
      const p = findTranscriptPath(s.ccSessionId, { claudeDir });
      if (!p) return;
      resolved = createTailer(p, { onRecords: (recs) => { entry.records.push(...recs); pushSnapshot(); } });
      resolved.start();
    }, 300),
    stop() { clearInterval(this._poll); if (resolved) resolved.stop(); },
  };
  if (entry.tailer._poll.unref) entry.tailer._poll.unref();
  watched.set(id, entry);
  pushSnapshot(); // empty model immediately so the pane shows "waiting…"
};
const stopWatch = (id) => { const e = watched.get(id); if (e) { e.tailer.stop(); watched.delete(id); } };
```

Add message handlers:

```js
} else if (m.type === 'gui-attach') {
  startWatch(m.id);
} else if (m.type === 'gui-detach') {
  stopWatch(m.id);
} else if (m.type === 'set-mode') {
  registry.setMode(m.id, m.mode);
```

And on close: `ws.on('close', () => { for (const id of [...watched.keys()]) stopWatch(id); clients.delete(ws); });`

- [ ] **Step 5: Run it, verify PASS**, then `npm test` → all green.

- [ ] **Step 6: Commit**

```bash
git add server/app.js server/sessions.js test/app.test.js test/sessions.test.js
git commit -m "feat(gui): server attach/detach/set-mode + normalized snapshot streaming"
```

---

## Task 5: Client — MODE switch + pane mounting (terminal vs GUI)

**Files:**
- Modify: `public/index.html` (header bar + gui-pane containers; load `gui.js`)
- Modify: `public/app.js` (per-session mode, mount logic, switch wiring)
- Create: `public/gui.js` (exports `mountGui(container, handlers)` returning `{ update(model), destroy() }` — render filled in Task 6; here a stub that shows "GUI mode" + the model item count is fine to prove mounting)
- Modify: `public/styles.css` (header bar + switch)
- Verify: browser

**Interfaces:**
- Consumes: `gui-snapshot` WS messages (Task 4); existing `sessions`, `output`, `attached`.
- Produces: a per-session `modeById` map (default `'gui'`); a header bar with `[ GUI | Terminal ]`; when focused session is in GUI mode, hide the xterm container and show the gui-pane (driven by `gui-snapshot` models); when in Terminal mode, the existing xterm behavior is unchanged. Switching sends `set-mode` and `gui-attach`/`gui-detach` appropriately. `Ctrl+\`` toggles the focused session's mode.

- [ ] **Step 1: index.html** — add a header bar above `#terminal` and a sibling `#gui-pane` container; add `<script src="gui.js"></script>` before `app.js`. (Header: `<div id="session-head"><span id="head-label"></span><span id="head-state"></span><span id="mode-switch"><button data-mode="gui">GUI</button><button data-mode="terminal">Terminal</button></span></div>`.)

- [ ] **Step 2: gui.js stub** — `function mountGui(container, handlers){ container.innerHTML='<div class="gui-status"></div><div class="gui-log"></div><form class="gui-compose"><textarea></textarea><button>Send</button></form>'; ... return { update(model){ /* Task 6 */ container.querySelector('.gui-status').textContent = model && model.items ? model.items.length+' items' : 'waiting…'; }, destroy(){ container.innerHTML=''; } }; }` Wire the compose form's submit to `handlers.onSend(text)`.

- [ ] **Step 3: app.js mounting** — add `const modeById = new Map();` (default gui). On `focus(id)`: set header label/state; read mode (default 'gui'); if gui → show `#gui-pane`, hide `#terminal`, send `gui-attach`, ensure a `mountGui` instance bound to this id, send compose via `{type:'input', id, data: text + '\r'}`; if terminal → hide gui-pane, show terminal, send `gui-detach`, and do the existing `attach` flow. Route `gui-snapshot` (id===focusedId) to the gui instance `update(model)`. Switch buttons + `Ctrl+\`` call `setMode(id, mode)` which updates `modeById`, sends `set-mode`, and re-runs the mount logic.

- [ ] **Step 4: styles.css** — style `#session-head` (flex row, label left, switch right), `#mode-switch button` (segmented, active state), `#gui-pane` (fills the main area, column layout), and the stub `.gui-status/.gui-log/.gui-compose`.

- [ ] **Step 5: Browser verify** — `npm start`; create a session. Expect: header bar with the switch; GUI pane shows "waiting…" then an item count as the session writes its transcript; clicking **Terminal** reveals the live xterm and typing works; clicking **GUI** returns; `Ctrl+\`` toggles. (No unit test — UI, browser-verified per repo norm.)

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/gui.js public/styles.css
git commit -m "feat(gui): MODE switch + GUI/terminal pane mounting (render stub)"
```

---

## Task 6: Client — GUI rendering (status strip + conversation + compose)

**Files:**
- Modify: `public/gui.js` (full render), `public/styles.css`
- Verify: browser

**Interfaces:**
- Consumes: the model `{ title, items, status }` from `gui-snapshot`.
- Produces: a rendered status strip (current tool / todo progress / title), a scrollable conversation (user / assistant(markdown-ish) / collapsible thinking / tool cards with expand / todos checklist), and the working compose box. Re-render is idempotent from the latest model (replace innerHTML of the log; cheap for v1; preserve scroll-at-bottom).

- [ ] **Step 1: Implement `update(model)`** — render status strip from `model.status` (`currentTool` → "Running {name}: {key arg}"; `todos` → "{done}/{total}"); render `model.items` into `.gui-log`:
  - `user` → `<div class="gui-user">` text
  - `assistant` → `<div class="gui-asst">` text (basic: escape + preserve newlines; full markdown is a later polish, keep minimal+safe now)
  - `thinking` → `<details class="gui-think"><summary>thinking</summary>…</details>`
  - `tool` → `<details class="gui-tool gui-{status}"><summary>{icon} {name} {keyArg}</summary><pre>{input}</pre><pre>{resultText}</pre></details>`
  - `todos` → a `<ul>` with ✓/▸/○ per status
  Always escape text (no innerHTML injection from session content). Keep "stick to bottom if already at bottom" scroll behavior.

- [ ] **Step 2: keyArg helper** — Bash→`input.command`, Read/Edit/Write→`input.file_path`, Glob/Grep→`input.pattern`, Task/Agent→`input.description`, else `''` (truncate to ~80 chars).

- [ ] **Step 3: styles** — conversation bubbles, monospace `pre` for tool input/output (scroll on overflow), tool status colors (ok/err/pending), thinking dimmed, status strip bar.

- [ ] **Step 4: Browser verify** — run a real session through a few turns; confirm prompts, assistant text, tool cards (expand shows input+output), todo progress, and current-tool indicator all render and update live; compose box drives the session; switching to Terminal and back stays consistent.

- [ ] **Step 5: Commit**

```bash
git add public/gui.js public/styles.css
git commit -m "feat(gui): render status strip, normalized conversation, and compose box"
```

---

## Self-review notes (author)

- **Spec coverage (Plan 1 portion):** modes + MODE switch (T5), normalized conversation + status (T3/T6), compose box (T5/T6), deterministic correlation via `--session-id` (T1), tailing (T2), server push (T4). Permission subsystem + the `defer`/Terminal-mode fallback are **Plan 2** (not in this plan) — called out so coverage gaps here are intentional.
- **Type consistency:** `ccSessionId` used consistently (T1 spawn opt, T4 lookup). Model shape `{title, items, status:{currentTool, todos}}` consistent across T3 (producer) and T4/T6 (consumers). `mode` ∈ `{'gui','terminal'}` consistent (T1 default, T4 setMode guard, T5 client).
- **Placeholders:** UI tasks (T5/T6) intentionally specify contract + representative code rather than every line, matching the repo's browser-verified (non-unit-tested) UI convention; server/logic tasks (T1–T4) carry complete code + failing tests.
- **Known v1 simplification:** T4 re-normalizes the accumulated records on each batch (O(n) per update). Acceptable at personal scale with the tailer avoiding file re-reads; a stateful incremental normalizer is a future optimization (noted in the spec).
