# Hook-Driven Session State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `working`/`idle` session state from Claude Code's authoritative turn-boundary hooks (`UserPromptSubmit`/`Stop`/`Notification`) instead of guessing `idle` from output silence, eliminating the mid-turn `working → idle → working` flicker.

**Architecture:** The existing loopback HTTP side-channel is reused unchanged in shape: the cockpit spawns each `claude` with injected `--settings` hooks + per-session env; the hooks POST to the cockpit's `127.0.0.1` server; the registry updates and broadcasts; the browser regroups the sidebar. What changes: (1) the injected settings define **four** turn-boundary hook entries instead of one `Notification` entry, each passing a literal `-State` argument; (2) `POST /hook` accepts `{ id, state }` and dispatches to `markWorking`/`markIdle`/`signalWaiting`; (3) the registry's state model replaces the output-timing heuristic (`tickStatus`/`IDLE_AFTER_MS`/`active`/`lastOut`) with an explicit `working` flag set/cleared only by hooks.

**Tech Stack:** Plain Node.js (no bundler/build step), `ws` for WebSockets, `node-pty` (ConPTY) for sessions, PowerShell for the hook script, built-in `node --test` runner.

**Reference spec:** `docs/superpowers/specs/2026-06-19-hook-driven-session-state-design.md`

## Global Constraints

- Node.js v22+ (machine has v24). No bundler, no build step.
- Test runner is the built-in `node --test`. Run the suite with `npm test` (which is `node --test --test-force-exit`; the `--test-force-exit` flag is required because `node-pty` leaves a lingering ConPTY handle on Windows that otherwise hangs the runner).
- Server binds `127.0.0.1` only, default port `4477`. Never expose the port; the UI is equivalent to shell access.
- Keep files small and single-responsibility. One commit per task.
- The generated settings file must contain **only** a `hooks` block so it merges with (never clobbers) the user's own `~/.claude/settings.json` hooks.
- Hook command entries are exec-form (`command: 'powershell.exe'` + `args: [...]`), `type: 'command'`, `async: true`, `timeout: 10` (seconds). The hook script must write nothing to stdout (the `UserPromptSubmit` hook's stdout would otherwise be injected into Claude's context).
- Four states, names unchanged: `working`, `needs-you`, `idle`, `exited`. `needs-you` is triggered **only** by `permission_prompt`. `idle_prompt` maps to `idle`.

---

## File Structure

| File | Change | Responsibility after change |
|---|---|---|
| `server/sessions.js` | Modify | State model: per-session `working`/`waiting`/`acknowledged`/`exited` flags; `markWorking`/`markIdle`/`signalWaiting`/`acknowledge`/`markExited` transitions; `_derive` priority order. No output-timing logic. |
| `server/app.js` | Modify | `POST /hook` accepts `{ id, state }` and dispatches by state. No `tickStatus` interval. |
| `server/hooks.js` | Modify | Generate four hook entries (`UserPromptSubmit`, `Stop`, two `Notification` matchers), each with a `-State` argument. |
| `hooks/cockpit-hook.ps1` | Modify | Accept `-State`; POST `{ id, state }`. |
| `test/sessions.test.js` | Rewrite | Cover the new derivation table and transitions; drop timing tests. |
| `test/app.test.js` | Modify | `POST /hook` for each state; bad/unknown state ignored; attach acknowledges. |
| `test/hooks.test.js` | Modify | Assert the four entries, matchers, `-State` args, absolute path, hooks-only block. |
| `server/pty.js`, `server/index.js`, `public/*` | **Unchanged** | Env injection, `--settings` wiring, and the four-group sidebar are reused as-is. |

---

### Task 1: Registry state model (`server/sessions.js`)

**Files:**
- Modify: `server/sessions.js`
- Test: `test/sessions.test.js` (rewrite)

**Interfaces:**
- Consumes: `RingBuffer` from `./buffer` (unchanged).
- Produces (relied on by Task 2 and Task 3's contract):
  - `new SessionRegistry({ spawnPty })` — note: the `now` injection is removed (no timing left).
  - `create(cwd) → { id, cwd, label, status }`
  - `appendOutput(id, data)` — buffer-append + `emit('output', id, data)` **only**; never mutates status.
  - `markWorking(id)` — turn started: `working=true, waiting=false, acknowledged=false`.
  - `markIdle(id)` — turn ended: `working=false, waiting=false`.
  - `signalWaiting(id)` — permission prompt: `working=false, waiting=true, acknowledged=(id===focusedId)`.
  - `acknowledge(id)` — focus/attach: set `focusedId`; if `waiting && !acknowledged`, set `acknowledged=true`.
  - `markExited(id)` — `exited=true` (overrides all).
  - `get`, `bufferOf`, `list` — unchanged signatures.
  - Emits `'sessions'` only when a session's derived `status` actually changes.
  - `module.exports = { SessionRegistry }` — **`IDLE_AFTER_MS` is no longer exported.**

- [ ] **Step 1: Replace the test file with the new state-model tests**

Overwrite `test/sessions.test.js` entirely with:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { SessionRegistry } = require('../server/sessions');

function makeFakePty() {
  const o = { _data: null, _exit: null, written: [], resized: [] };
  o.onData = (cb) => { o._data = cb; };
  o.onExit = (cb) => { o._exit = cb; };
  o.write = (d) => o.written.push(d);
  o.resize = (cols, rows) => o.resized.push([cols, rows]);
  o.kill = () => {};
  return o;
}

function makeRegistry() {
  const ptys = [];
  const reg = new SessionRegistry({
    spawnPty: () => { const p = makeFakePty(); ptys.push(p); return p; },
  });
  return { reg, ptys };
}

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
  reg.markIdle(s.id);                 // settle to idle first
  assert.strictEqual(reg.get(s.id).status, 'idle');
  const outputs = [];
  reg.on('output', (id, data) => outputs.push([id, data]));
  ptys[0]._data('hello');
  assert.strictEqual(reg.bufferOf(s.id), 'hello');
  assert.deepStrictEqual(outputs, [[s.id, 'hello']]);
  assert.strictEqual(reg.get(s.id).status, 'idle'); // output did NOT flip to working
});

test('markWorking yields working; markIdle yields idle', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
  reg.markWorking(s.id);
  assert.strictEqual(reg.get(s.id).status, 'working');
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('a turn holds working across output bursts (no mid-turn flicker)', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markWorking(s.id);
  ptys[0]._data('burst one');
  assert.strictEqual(reg.get(s.id).status, 'working');
  ptys[0]._data('burst two after a pause');
  assert.strictEqual(reg.get(s.id).status, 'working'); // still working, never idle
  reg.markIdle(s.id);
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('redundant transitions cause no extra sessions broadcast', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.markIdle(s.id);                 // working -> idle (one change)
  let emits = 0;
  reg.on('sessions', () => { emits += 1; });
  reg.markIdle(s.id);                 // already idle -> no change
  reg.markIdle(s.id);                 // (e.g. Stop then idle_prompt) -> no change
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

test('markWorking clears a pending needs-you (next turn started)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  reg.markWorking(s.id);             // a new UserPromptSubmit
  assert.strictEqual(reg.get(s.id).status, 'working');
});

test('output does not clear a pending needs-you', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  ptys[0]._data('trailing output');  // output is not a state signal anymore
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- test/sessions.test.js`
Expected: FAIL — e.g. `reg.markWorking is not a function` / `reg.markIdle is not a function`, and the "no flicker" / "redundant transitions" tests fail against the old timing model. (The old `tickStatus`/`IDLE_AFTER_MS` tests are gone, so no import error from those.)

- [ ] **Step 3: Rework `server/sessions.js`**

Replace the entire contents of `server/sessions.js` with:

```javascript
// server/sessions.js
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { RingBuffer } = require('./buffer');

class SessionRegistry extends EventEmitter {
  constructor({ spawnPty }) {
    super();
    this.spawnPty = spawnPty;
    this.sessions = new Map();
    this.focusedId = null;
  }

  create(cwd) {
    const id = crypto.randomUUID();
    const label = path.basename(cwd) || cwd;
    const pty = this.spawnPty(cwd, id);
    const session = {
      id, cwd, label,
      status: 'working',
      buffer: new RingBuffer(),
      pty,
      working: true,       // a turn is in progress (UserPromptSubmit..Stop)
      waiting: false,      // a permission prompt is pending
      acknowledged: false, // focused since waiting began
      exited: false,
    };
    this.sessions.set(id, session);
    pty.onData((data) => this.appendOutput(id, data));
    pty.onExit(() => this.markExited(id));
    this.emit('sessions');
    return this._public(session);
  }

  // Output is a buffer signal only — never a state signal (that caused the flicker).
  appendOutput(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.buffer.push(data);
    this.emit('output', id, data);
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (s && !s.exited) s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (s && !s.exited) s.pty.resize(cols, rows);
  }

  // UserPromptSubmit: a turn started.
  markWorking(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = true;
    s.waiting = false;
    s.acknowledged = false;
    this._recompute(s);
  }

  // Stop / Notification:idle_prompt: the turn ended.
  markIdle(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = false;
    this._recompute(s);
  }

  // Notification:permission_prompt: blocked awaiting a tool-permission decision.
  signalWaiting(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = true;
    s.acknowledged = (id === this.focusedId); // focused = already seen
    this._recompute(s);
  }

  // The user focused/attached this session.
  acknowledge(id) {
    this.focusedId = id;
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    if (s.waiting && !s.acknowledged) {
      s.acknowledged = true;
      this._recompute(s);
    }
  }

  markExited(id) {
    const s = this.sessions.get(id);
    if (s && !s.exited) {
      s.exited = true;
      this._recompute(s);
    }
  }

  get(id) {
    const s = this.sessions.get(id);
    return s ? this._public(s) : null;
  }

  bufferOf(id) {
    const s = this.sessions.get(id);
    return s ? s.buffer.getAll() : '';
  }

  list() {
    return [...this.sessions.values()].map((s) => this._public(s));
  }

  _derive(s) {
    if (s.exited) return 'exited';
    if (s.waiting) return s.acknowledged ? 'idle' : 'needs-you';
    if (s.working) return 'working';
    return 'idle';
  }

  _recompute(s) {
    const next = this._derive(s);
    if (next !== s.status) {
      s.status = next;
      this.emit('sessions');
    }
  }

  _public(s) {
    return { id: s.id, cwd: s.cwd, label: s.label, status: s.status };
  }
}

module.exports = { SessionRegistry };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/sessions.test.js`
Expected: PASS — all sessions tests green.

- [ ] **Step 5: Commit**

```bash
git add server/sessions.js test/sessions.test.js
git commit -m "feat: hook-driven working/idle state model (drop output-timing flicker)"
```

---

### Task 2: `POST /hook` dispatch + remove the tick interval (`server/app.js`)

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `registry.markWorking(id)`, `registry.markIdle(id)`, `registry.signalWaiting(id)`, `registry.acknowledge(id)` from Task 1.
- Produces (the `/hook` contract Task 3 must satisfy): `POST /hook` with JSON body `{ id: string, state: 'working' | 'idle' | 'needs-you' }`. Valid id+state → corresponding transition, `204`. Malformed JSON → `400`. Unknown/missing state or non-string id → no transition, `204`.

- [ ] **Step 1: Update the `POST /hook` tests**

In `test/app.test.js`, replace the test named `'POST /hook flips the session to needs-you and broadcasts'` with the following three tests (keep all other tests in the file as-is except the attach test updated in Step 2):

```javascript
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
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, state: 'needs-you' }),
  });
  assert.strictEqual(res.status, 204);
  const sm = await needsYou;
  assert.strictEqual(sm.sessions[0].status, 'needs-you');

  ws.close();
  await new Promise((r) => server.close(r));
});

test('POST /hook state=idle then state=working drive the matching status', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));

  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' })); // starts working
  const id = (await created).sessions[0].id;

  const idle = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'idle');
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, state: 'idle' }),
  });
  await idle;

  const working = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'working');
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, state: 'working' }),
  });
  const sm = await working;
  assert.strictEqual(sm.sessions[0].status, 'working');

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

  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, state: 'bogus' }),
  });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(registry.get(id).status, 'working'); // unchanged from spawn

  ws.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Update the attach test's setup to send a state**

In `test/app.test.js`, in the test `'attach acknowledges a needs-you session (-> idle)'`, change the setup `fetch` body from `JSON.stringify({ id })` to `JSON.stringify({ id, state: 'needs-you' })`:

```javascript
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, state: 'needs-you' }),
  });
```

- [ ] **Step 3: Run the app tests to verify they fail**

Run: `npm test -- test/app.test.js`
Expected: FAIL — the old handler calls `signalWaiting` for any `{ id }`, so `state: 'idle'`/`'working'` never reach the right transition (the `idle`/`working` test times out or asserts wrong status), and the unknown-state test fails because `signalWaiting` fires regardless of `state`.

- [ ] **Step 4: Update the `POST /hook` handler and remove the tick interval in `server/app.js`**

Replace the `POST /hook` block (lines `req.on('end', ...)` body) so it dispatches by `state`:

```javascript
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
        if (m && typeof m.id === 'string') {
          if (m.state === 'working') registry.markWorking(m.id);
          else if (m.state === 'idle') registry.markIdle(m.id);
          else if (m.state === 'needs-you') registry.signalWaiting(m.id);
        }
        res.writeHead(204);
        res.end();
      });
```

Then delete the tick-interval block near the end of `createApp` (no longer exists on the registry):

```javascript
  const interval = setInterval(() => registry.tickStatus(), 1000);
  interval.unref?.();
  server.on('close', () => clearInterval(interval));
```

So `createApp` ends with `return { server, registry, wss };` directly after the `wss.on('connection', ...)` block.

- [ ] **Step 5: Run the app tests to verify they pass**

Run: `npm test -- test/app.test.js`
Expected: PASS — all app tests green.

- [ ] **Step 6: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "feat: POST /hook dispatches by state; drop tickStatus interval"
```

---

### Task 3: Four hook entries + `-State` script (`server/hooks.js`, `hooks/cockpit-hook.ps1`)

**Files:**
- Modify: `server/hooks.js`
- Modify: `hooks/cockpit-hook.ps1`
- Test: `test/hooks.test.js`

**Interfaces:**
- Consumes: the `/hook` contract from Task 2 — body `{ id, state }`, `state ∈ {working, idle, needs-you}`.
- Produces: `hookSettings()` returns `{ hooks: { UserPromptSubmit, Stop, Notification } }` where each command entry is exec-form `powershell.exe` with args `[..., '-File', <abs path>, '-State', <state>]`, `type: 'command'`, `async: true`, `timeout: 10`. `writeHookSettings(outDir?)` and `HOOKS_DIR` exports unchanged.

- [ ] **Step 1: Update the hooks tests**

Replace the entire contents of `test/hooks.test.js` with:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { hookSettings } = require('../server/hooks');

function assertStateEntry(cmd, state) {
  assert.strictEqual(cmd.type, 'command');
  assert.strictEqual(cmd.command, 'powershell.exe');
  assert.strictEqual(cmd.async, true);
  const fileArg = cmd.args[cmd.args.indexOf('-File') + 1];
  assert.ok(path.isAbsolute(fileArg), `expected absolute path, got ${fileArg}`);
  assert.match(fileArg, /cockpit-hook\.ps1$/);
  const stateArg = cmd.args[cmd.args.indexOf('-State') + 1];
  assert.strictEqual(stateArg, state, `expected -State ${state}, got ${stateArg}`);
}

test('UserPromptSubmit hook is matcher-less and signals working', () => {
  const s = hookSettings();
  const entry = s.hooks.UserPromptSubmit[0];
  assert.strictEqual(entry.matcher, undefined);
  assertStateEntry(entry.hooks[0], 'working');
});

test('Stop hook is matcher-less and signals idle', () => {
  const s = hookSettings();
  const entry = s.hooks.Stop[0];
  assert.strictEqual(entry.matcher, undefined);
  assertStateEntry(entry.hooks[0], 'idle');
});

test('Notification splits idle_prompt -> idle and permission_prompt -> needs-you', () => {
  const s = hookSettings();
  const idle = s.hooks.Notification.find((e) => e.matcher === 'idle_prompt');
  const perm = s.hooks.Notification.find((e) => e.matcher === 'permission_prompt');
  assert.ok(idle, 'expected an idle_prompt entry');
  assert.ok(perm, 'expected a permission_prompt entry');
  assertStateEntry(idle.hooks[0], 'idle');
  assertStateEntry(perm.hooks[0], 'needs-you');
});

test('hookSettings contains only a hooks block (must not clobber other user settings)', () => {
  const s = hookSettings();
  assert.deepStrictEqual(Object.keys(s), ['hooks']);
});
```

- [ ] **Step 2: Run the hooks tests to verify they fail**

Run: `npm test -- test/hooks.test.js`
Expected: FAIL — `s.hooks.UserPromptSubmit` is `undefined` (old settings only define `Notification`), and the `-State` arg lookups fail.

- [ ] **Step 3: Rework `server/hooks.js`**

Replace the entire contents of `server/hooks.js` with:

```javascript
// server/hooks.js
// Generates the --settings file injected into each cockpit-spawned claude.
// It contains ONLY a hooks block so it merges with (never replaces) the user's
// own settings. Four turn-boundary hooks run cockpit-hook.ps1 with a literal
// -State, which POSTs { id, state } back to the cockpit:
//   UserPromptSubmit -> working   Stop -> idle
//   Notification/idle_prompt -> idle   Notification/permission_prompt -> needs-you
const fs = require('node:fs');
const path = require('node:path');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

function commandEntry(scriptPath, state) {
  return {
    type: 'command',
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-State', state,
    ],
    timeout: 10,
    async: true,
  };
}

function hookSettings() {
  const scriptPath = path.join(HOOKS_DIR, 'cockpit-hook.ps1');
  return {
    hooks: {
      UserPromptSubmit: [
        { hooks: [commandEntry(scriptPath, 'working')] },
      ],
      Stop: [
        { hooks: [commandEntry(scriptPath, 'idle')] },
      ],
      Notification: [
        { matcher: 'idle_prompt', hooks: [commandEntry(scriptPath, 'idle')] },
        { matcher: 'permission_prompt', hooks: [commandEntry(scriptPath, 'needs-you')] },
      ],
    },
  };
}

function writeHookSettings(outDir = HOOKS_DIR) {
  const outPath = path.join(outDir, 'cockpit-settings.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(hookSettings(), null, 2));
  return outPath;
}

module.exports = { hookSettings, writeHookSettings, HOOKS_DIR };
```

- [ ] **Step 4: Update `hooks/cockpit-hook.ps1` to accept `-State`**

Replace the entire contents of `hooks/cockpit-hook.ps1` with:

```powershell
# Cockpit turn-boundary hook: tell the cockpit this session's state.
# Fire-and-forget; never blocks claude. Correlates via CC_COCKPIT_SESSION.
# MUST write nothing to stdout (UserPromptSubmit stdout is injected as context).
param([string]$State = '')
$ErrorActionPreference = 'SilentlyContinue'
$id = $env:CC_COCKPIT_SESSION
$port = $env:CC_COCKPIT_PORT
if ($id -and $port -and $State) {
  $body = @{ id = $id; state = $State } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/hook" -Method Post `
      -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
  } catch { }
}
```

- [ ] **Step 5: Run the hooks tests to verify they pass**

Run: `npm test -- test/hooks.test.js`
Expected: PASS — all four hooks tests green.

- [ ] **Step 6: Commit**

```bash
git add server/hooks.js hooks/cockpit-hook.ps1 test/hooks.test.js
git commit -m "feat: generate four turn-boundary hooks; cockpit-hook.ps1 takes -State"
```

---

### Task 4: Full-suite + live verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (sessions + app + hooks + buffer + pty). Confirm the count matches the sum of the rewritten files and no obsolete `tickStatus`/`IDLE_AFTER_MS` references remain (`git grep -n "tickStatus\|IDLE_AFTER_MS\|lastOut" -- server test` returns nothing).

- [ ] **Step 2: Live smoke — start the app and spawn a session**

Run: `npm start`, open `http://127.0.0.1:4477`, create a session in a real project folder.

Verify against the spec's live acceptance criteria:
- During a long, bursty Claude reply the focused session holds a **solid `working`** — no `working → idle → working` flicker.
- At turn end it settles to **`idle`**.
- A tool-permission prompt on an **unfocused** session shows amber **`needs-you`**; focusing it acknowledges to **`idle`**.
- The user's own `~/.claude` hooks still fire (e.g. the `notify-bump.ps1` toast), confirming the injected settings **merged** rather than replaced.

- [ ] **Step 3: Stop the app cleanly** (Ctrl-C) and confirm it exits without hanging.

- [ ] **Step 4: Update the project status doc**

Update the "Status" section of `cc-cockpit/CLAUDE.md` to note the hook-driven session-state feature is implemented and verified, then commit:

```bash
git add CLAUDE.md
git commit -m "docs: hook-driven session state implemented and verified"
```

---

## Self-Review

**Spec coverage:**
- States & derivation (spec §"State model and derivation") → Task 1 `_derive` + transitions.
- "What is removed" (`IDLE_AFTER_MS`/`active`/`lastOut`/`tickStatus`/interval; `appendOutput` no longer mutates status; output not a `working` trigger) → Task 1 (registry) + Task 2 (interval).
- Hook injection table (four entries, matchers, `-State`) → Task 3 `hooks.js` + `hooks.test.js`.
- `cockpit-hook.ps1` `-State`, silent stdout, swallow errors, short timeout → Task 3.
- `POST /hook` accepts `{ id, state }`, validates, dispatches, `204`/`400` → Task 2.
- Accepted limitations (ends-with-question shows idle; post-approval shows idle until Stop; missed-hook stale until next boundary; initial spawn `working`) → encoded by the model (no extra code) and exercised by Task 1 tests + Task 4 live.
- Testing section (unit/route/hooks/live) → Tasks 1–4.
- Out of scope (idle-timer escalation, ends-with-question detection, missed-hook backstop, sidebar/dot changes) → not built; `public/*` untouched.

**Placeholder scan:** none — every code/test step contains full content.

**Type consistency:** `markWorking`/`markIdle`/`signalWaiting`/`acknowledge`/`markExited` names match across Task 1 (definitions), Task 2 (callers), and Task 3 (the `state` strings `working`/`idle`/`needs-you` map 1:1 to the dispatch in Task 2). `hookSettings()`/`writeHookSettings()`/`HOOKS_DIR` exports unchanged, so `index.js`/`pty.js` need no edits.
