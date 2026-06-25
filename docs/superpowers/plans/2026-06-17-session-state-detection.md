# Session State Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `needs-you` session state (waiting for the user's input/permission) distinct from `working`/`idle`/`exited`, detected precisely via Claude Code hooks, and group the sidebar by state.

**Architecture:** The cockpit spawns each `claude` with injected hooks (`claude --settings <generated file>`) and per-session env (`CC_COCKPIT_SESSION`, `CC_COCKPIT_PORT`). On `Notification` (`idle_prompt`/`permission_prompt`), a bundled PowerShell hook POSTs the session id to the cockpit's existing loopback HTTP server (`/hook`). The `SessionRegistry` flips the session to `needs-you` (unless it's the focused session) and broadcasts; focusing a session acknowledges it (→ `idle`); new output returns it to `working`.

**Tech Stack:** Plain Node.js v24, `node-pty`, `ws`, built-in `node --test`. PowerShell hook script. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-17-session-state-detection-design.md`

## Global Constraints

- Plain Node, **no bundler/build step**. Test command: `node --test --test-force-exit` (the `--test-force-exit` flag is mandatory — node-pty leaves a lingering ConPTY handle on Windows that otherwise hangs the runner).
- Server binds **`127.0.0.1` only**, default port `4477` (override via `PORT` env). `/hook` adds no new network exposure (same bind).
- **No new npm dependencies.**
- Requires Claude Code CLI **≥ v2.1.141** (for `--settings` hook injection and `Notification` matchers). The bundled hook is **PowerShell — Windows only for v0**.
- Hooks **merge across scopes** — the injected cockpit hook must run *alongside* the user's existing `~/.claude` hooks, never replace them. The `--settings` file therefore contains **only** a `hooks` block.
- The four states are exactly: `working`, `needs-you`, `idle`, `exited`. `permission_prompt` and `idle_prompt` both map to `needs-you`.
- Frequent commits: one per task. End commit messages with the Co-Authored-By trailer used in this repo.

---

## File structure (created/modified across tasks)

```
cc-cockpit/
  server/
    sessions.js   # MODIFY: waiting/acknowledged/exited flags, focusedId, signalWaiting(), acknowledge(), derived status
    app.js        # MODIFY: POST /hook route; attach -> acknowledge()
    pty.js        # MODIFY: buildSpawn() adds --settings arg + CC_COCKPIT_* env
    hooks.js      # CREATE: hookSettings()/writeHookSettings() generate the --settings file
    index.js      # MODIFY: write hook settings at startup; wire settingsPath/sessionId/port into spawn
  hooks/
    cockpit-hook.ps1                  # CREATE: POSTs {id} to the cockpit on idle/permission prompt
    cockpit-settings.generated.json   # GENERATED at startup (gitignored)
  public/
    app.js        # MODIFY: 4-state dots + group-by-state sidebar rendering
    styles.css    # MODIFY: .dot.needs-you + .group-header styling
  test/
    sessions.test.js  # MODIFY: state-derivation + acknowledgement tests
    app.test.js       # MODIFY: POST /hook + attach-acknowledge tests
    pty.test.js       # MODIFY: buildSpawn composition test
    hooks.test.js     # CREATE: hookSettings shape test
  .gitignore      # MODIFY: ignore hooks/cockpit-settings.generated.json
```

---

## Task 1: Registry state model (`needs-you` + acknowledgement)

**Files:**
- Modify: `server/sessions.js`
- Test: `test/sessions.test.js`

**Interfaces:**
- Produces: `SessionRegistry#signalWaiting(id)`, `SessionRegistry#acknowledge(id)`, and `_public` status values `'working'|'needs-you'|'idle'|'exited'`. Registry constructor unchanged (`{ spawnPty, now }`). `create(cwd)` now calls `this.spawnPty(cwd, id)` (the second arg is the new session id).
- Consumes: nothing new.

- [ ] **Step 1: Add the failing tests**

Append these tests to `test/sessions.test.js` (after the existing `resize` tests). They cover the acknowledgement state machine.

```js
test('signalWaiting marks an unfocused session needs-you', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
});

test('signalWaiting on the focused session yields idle (already acknowledged)', () => {
  const { reg } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.acknowledge(s.id);          // focus it
  reg.signalWaiting(s.id);        // hook fires while focused
  assert.strictEqual(reg.get(s.id).status, 'idle');
});

test('acknowledge flips a needs-you session to idle and is sticky', () => {
  const { reg } = makeRegistry();
  const a = reg.create('C:/proj/a');
  const b = reg.create('C:/proj/b');
  reg.signalWaiting(a.id);                 // a -> needs-you (unfocused)
  assert.strictEqual(reg.get(a.id).status, 'needs-you');
  reg.acknowledge(a.id);                   // focus a -> idle
  assert.strictEqual(reg.get(a.id).status, 'idle');
  reg.acknowledge(b.id);                   // focus elsewhere; a stays idle
  assert.strictEqual(reg.get(a.id).status, 'idle');
});

test('new output supersedes waiting (needs-you -> working) and re-arms next turn', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  reg.signalWaiting(s.id);
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
  ptys[0]._data('resumed');
  assert.strictEqual(reg.get(s.id).status, 'working');
  reg.signalWaiting(s.id);                 // next turn ends, unfocused again
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
});

test('tickStatus does not override needs-you', () => {
  const { reg, ptys, setClock } = makeRegistry();
  const s = reg.create('C:/proj/a');
  ptys[0]._data('x');                      // lastOut = 1000
  reg.signalWaiting(s.id);                 // -> needs-you
  setClock(1000 + IDLE_AFTER_MS);
  reg.tickStatus();
  assert.strictEqual(reg.get(s.id).status, 'needs-you');
});

test('signalWaiting and acknowledge are ignored after exit', () => {
  const { reg, ptys } = makeRegistry();
  const s = reg.create('C:/proj/a');
  ptys[0]._exit();
  reg.signalWaiting(s.id);
  reg.acknowledge(s.id);
  assert.strictEqual(reg.get(s.id).status, 'exited');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-force-exit test/sessions.test.js`
Expected: the new tests FAIL (`reg.signalWaiting is not a function`); the existing tests still PASS.

- [ ] **Step 3: Rewrite `server/sessions.js`**

Replace the entire file with this. It keeps the existing external behavior (create/appendOutput/tickStatus/write/resize/exit) and adds the `waiting`/`acknowledged`/`exited` flags, `focusedId`, derived status, `signalWaiting`, and `acknowledge`.

```js
// server/sessions.js
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { RingBuffer } = require('./buffer');

const IDLE_AFTER_MS = 2000;

class SessionRegistry extends EventEmitter {
  constructor({ spawnPty, now = () => Date.now() }) {
    super();
    this.spawnPty = spawnPty;
    this.now = now;
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
      lastOut: this.now(),
      buffer: new RingBuffer(),
      pty,
      active: true,        // recent output (working) vs quiet
      waiting: false,      // a Notification hook fired, not yet superseded
      acknowledged: false, // focused since waiting began
      exited: false,
    };
    this.sessions.set(id, session);
    pty.onData((data) => this.appendOutput(id, data));
    pty.onExit(() => this.markExited(id));
    this.emit('sessions');
    return this._public(session);
  }

  appendOutput(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.buffer.push(data);
    s.lastOut = this.now();
    s.active = true;
    s.waiting = false;       // new output supersedes a waiting signal
    s.acknowledged = false;
    this.emit('output', id, data);
    this._recompute(s);
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (s && !s.exited) s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (s && !s.exited) s.pty.resize(cols, rows);
  }

  // A Notification hook (idle_prompt / permission_prompt) fired for this session.
  signalWaiting(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
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

  tickStatus() {
    const t = this.now();
    for (const s of this.sessions.values()) {
      if (!s.exited && !s.waiting && s.active && t - s.lastOut >= IDLE_AFTER_MS) {
        s.active = false;
        this._recompute(s);
      }
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
    return s.active ? 'working' : 'idle';
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

module.exports = { SessionRegistry, IDLE_AFTER_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-force-exit test/sessions.test.js`
Expected: PASS (all existing + 6 new tests).

- [ ] **Step 5: Commit**

```bash
git add server/sessions.js test/sessions.test.js
git commit -m "$(cat <<'EOF'
feat: add needs-you state with acknowledgement to the session registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `POST /hook` route + acknowledge on attach

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `registry.signalWaiting(id)`, `registry.acknowledge(id)` (Task 1).
- Produces: HTTP `POST /hook` accepting JSON `{ id: string }` → `registry.signalWaiting(id)`, responding `204` (or `400` on bad JSON). The `attach` WS message now also calls `registry.acknowledge(id)`.

- [ ] **Step 1: Add the failing tests**

Append to `test/app.test.js` (after the existing `resize` test). Uses Node's global `fetch`.

```js
test('POST /hook flips the session to needs-you and broadcasts', async () => {
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
    body: JSON.stringify({ id }),
  });
  assert.strictEqual(res.status, 204);
  const sm = await needsYou;
  assert.strictEqual(sm.sessions[0].status, 'needs-you');

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
  await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
  });
  await needsYou;

  const idle = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions[0].status === 'idle');
  ws.send(JSON.stringify({ type: 'attach', id }));
  const sm = await idle;
  assert.strictEqual(sm.sessions[0].status, 'idle');

  ws.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-force-exit test/app.test.js`
Expected: the two new tests FAIL (no `/hook` route → 404, so the `needs-you` broadcast never arrives and the test times out or the status assertion fails); existing tests PASS.

- [ ] **Step 3: Modify `server/app.js`**

Replace the `http.createServer(...)` handler so it handles `POST /hook` before static serving. Find the existing handler:

```js
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
```

Replace it with:

```js
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'POST' && urlPath === '/hook') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // bound the body
      });
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
        if (m && typeof m.id === 'string') registry.signalWaiting(m.id);
        res.writeHead(204);
        res.end();
      });
      return;
    }

    if (urlPath === '/') urlPath = '/index.html';
```

(The rest of the static-file handler is unchanged.)

Then find the `attach` branch in the WebSocket message handler:

```js
      } else if (m.type === 'attach') {
        ws.send(JSON.stringify({ type: 'attached', id: m.id, buffer: registry.bufferOf(m.id) }));
      }
```

Replace it with (acknowledge first so the broadcast reflects the new state):

```js
      } else if (m.type === 'attach') {
        registry.acknowledge(m.id);
        ws.send(JSON.stringify({ type: 'attached', id: m.id, buffer: registry.bufferOf(m.id) }));
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-force-exit test/app.test.js`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add server/app.js test/app.test.js
git commit -m "$(cat <<'EOF'
feat: POST /hook signals needs-you; attach acknowledges the session

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PTY spawn composition (`--settings` + env)

**Files:**
- Modify: `server/pty.js`
- Test: `test/pty.test.js`

**Interfaces:**
- Produces: `buildSpawn({ command, args, settingsPath, sessionId, port }) -> { file, args, env }` (exported). `spawnClaude(cwd, opts)` now accepts `settingsPath`, `sessionId`, `port` in `opts` and uses `buildSpawn` internally.
- Consumes: `resolveExecutable` (already in `pty.js`).

- [ ] **Step 1: Add the failing test**

Append to `test/pty.test.js`:

```js
test('buildSpawn appends --settings and sets cockpit env vars', () => {
  const r = buildSpawn({
    command: process.execPath,         // absolute -> returned as-is by resolveExecutable
    args: ['--no-warnings'],
    settingsPath: 'C:/cc/cockpit-settings.generated.json',
    sessionId: 'sess-123',
    port: 4477,
  });
  assert.strictEqual(r.file, process.execPath);
  assert.deepStrictEqual(r.args, ['--no-warnings', '--settings', 'C:/cc/cockpit-settings.generated.json']);
  assert.strictEqual(r.env.CC_COCKPIT_SESSION, 'sess-123');
  assert.strictEqual(r.env.CC_COCKPIT_PORT, '4477');
});

test('buildSpawn omits --settings and env when not provided', () => {
  const r = buildSpawn({ command: process.execPath });
  assert.deepStrictEqual(r.args, []);
  assert.strictEqual(r.env.CC_COCKPIT_SESSION, undefined);
  assert.strictEqual(r.env.CC_COCKPIT_PORT, undefined);
});
```

And update the require at the top of `test/pty.test.js`:

```js
const { spawnClaude, resolveExecutable, buildSpawn } = require('../server/pty');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-force-exit test/pty.test.js`
Expected: new tests FAIL (`buildSpawn is not a function`); existing tests PASS.

- [ ] **Step 3: Modify `server/pty.js`**

Replace the `spawnClaude` function and the `module.exports` line with:

```js
// Build the (file, args, env) for a claude spawn. Pure + exported so the arg/env
// composition is testable without spawning a process. Adds --settings (to inject
// cockpit hooks alongside the user's) and CC_COCKPIT_* env (so the hook can call
// back, correlated to this session).
function buildSpawn({ command = 'claude', args = [], settingsPath, sessionId, port } = {}) {
  const finalArgs = [...args];
  if (settingsPath) finalArgs.push('--settings', settingsPath);
  const env = { ...process.env };
  if (sessionId) env.CC_COCKPIT_SESSION = sessionId;
  if (port != null) env.CC_COCKPIT_PORT = String(port);
  return { file: resolveExecutable(command), args: finalArgs, env };
}

function spawnClaude(cwd, opts = {}) {
  const { file, args, env } = buildSpawn(opts);
  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });
  return {
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(() => cb()),
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
  };
}

module.exports = { spawnClaude, resolveExecutable, buildSpawn };
```

Note: the existing pty integration test passes `{ command: process.execPath, args: [...] }` — `buildSpawn` returns those args unchanged (no `settingsPath`), so that test is unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-force-exit test/pty.test.js`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add server/pty.js test/pty.test.js
git commit -m "$(cat <<'EOF'
feat: buildSpawn composes --settings + cockpit env for claude spawns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hook files + startup wiring

**Files:**
- Create: `server/hooks.js`, `hooks/cockpit-hook.ps1`
- Modify: `server/index.js`, `.gitignore`
- Test: `test/hooks.test.js`

**Interfaces:**
- Produces: `hookSettings() -> object` (the `--settings` JSON), `writeHookSettings(outDir?) -> string` (writes the generated file, returns its absolute path), `HOOKS_DIR`.
- Consumes: `createApp` (existing), `spawnClaude`/`buildSpawn` (Task 3). `index.js` wires `spawnPty: (cwd, sessionId) => spawnClaude(cwd, { settingsPath, sessionId, port })`.

- [ ] **Step 1: Write the failing test**

Create `test/hooks.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { hookSettings } = require('../server/hooks');

test('hookSettings defines a Notification hook invoking cockpit-hook.ps1 by absolute path', () => {
  const s = hookSettings();
  const entry = s.hooks.Notification[0];
  assert.match(entry.matcher, /idle_prompt/);
  assert.match(entry.matcher, /permission_prompt/);
  const cmd = entry.hooks[0];
  assert.strictEqual(cmd.command, 'powershell.exe');
  const fileArg = cmd.args[cmd.args.indexOf('-File') + 1];
  assert.ok(path.isAbsolute(fileArg), `expected absolute path, got ${fileArg}`);
  assert.match(fileArg, /cockpit-hook\.ps1$/);
});

test('hookSettings contains only a hooks block (must not clobber other user settings)', () => {
  const s = hookSettings();
  assert.deepStrictEqual(Object.keys(s), ['hooks']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-force-exit test/hooks.test.js`
Expected: FAIL — cannot find module `../server/hooks`.

- [ ] **Step 3: Create `server/hooks.js`**

```js
// server/hooks.js
// Generates the --settings file injected into each cockpit-spawned claude.
// It contains ONLY a hooks block so it merges with (never replaces) the user's
// own settings. The Notification hook fires for idle_prompt/permission_prompt
// and runs cockpit-hook.ps1, which POSTs the session id back to the cockpit.
const fs = require('node:fs');
const path = require('node:path');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

function hookSettings() {
  const scriptPath = path.join(HOOKS_DIR, 'cockpit-hook.ps1');
  return {
    hooks: {
      Notification: [
        {
          matcher: 'idle_prompt|permission_prompt',
          hooks: [
            {
              type: 'command',
              command: 'powershell.exe',
              args: [
                '-NoProfile',
                '-WindowStyle', 'Hidden',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath,
              ],
              timeout: 10,
              async: true,
            },
          ],
        },
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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-force-exit test/hooks.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `hooks/cockpit-hook.ps1`**

```powershell
# Cockpit Notification hook: tell the cockpit this session is waiting for the
# user. Fire-and-forget; never blocks claude. Correlates via CC_COCKPIT_SESSION.
$ErrorActionPreference = 'SilentlyContinue'
$id = $env:CC_COCKPIT_SESSION
$port = $env:CC_COCKPIT_PORT
if ($id -and $port) {
  $body = @{ id = $id } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/hook" -Method Post `
      -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
  } catch { }
}
```

- [ ] **Step 6: Modify `server/index.js`**

Replace the entire file with:

```js
// server/index.js
const { createApp } = require('./app');
const { spawnClaude } = require('./pty');
const { writeHookSettings } = require('./hooks');

const PORT = Number(process.env.PORT) || 4477;
const HOST = '127.0.0.1';

// Generate the --settings file (embeds the absolute hook-script path) once at startup.
const settingsPath = writeHookSettings();

const { server } = createApp({
  spawnPty: (cwd, sessionId) => spawnClaude(cwd, { settingsPath, sessionId, port: PORT }),
});
server.listen(PORT, HOST, () => {
  console.log(`cc-cockpit listening on http://${HOST}:${PORT}`);
});
```

- [ ] **Step 7: Ignore the generated settings file**

Add this line to `.gitignore`:

```gitignore
hooks/cockpit-settings.generated.json
```

- [ ] **Step 8: Smoke test the server starts and generates the settings file**

Run (PowerShell, project root):
```powershell
$p = Start-Process node -ArgumentList "server/index.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
"settings exists: $(Test-Path hooks/cockpit-settings.generated.json)"
try { (Invoke-WebRequest "http://127.0.0.1:4477/" -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
Stop-Process -Id $p.Id -Force
```
Expected: `settings exists: True` and `200`.

- [ ] **Step 9: Commit**

```bash
git add server/hooks.js test/hooks.test.js hooks/cockpit-hook.ps1 server/index.js .gitignore
git commit -m "$(cat <<'EOF'
feat: generate cockpit hook settings and inject them into spawned claude

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sidebar — 4-state dots + group-by-state

**Files:**
- Modify: `public/app.js`, `public/styles.css`

No automated test (browser UI). Verified live in Step 4.

- [ ] **Step 1: Update `render()` in `public/app.js`**

Replace the existing `render` function:

```js
function render() {
  listEl.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    if (s.id === focusedId) li.className = 'active';
    const dot = document.createElement('span');
    dot.className = `dot ${s.status}`;
    const label = document.createElement('span');
    label.textContent = s.label;
    li.append(dot, label);
    li.onclick = () => focus(s.id);
    listEl.appendChild(li);
  }
}
```

with this grouped version:

```js
const GROUP_ORDER = ['needs-you', 'working', 'idle', 'exited'];
const GROUP_LABELS = { 'needs-you': 'Needs you', working: 'Working', idle: 'Idle', exited: 'Exited' };

function render() {
  listEl.innerHTML = '';
  for (const state of GROUP_ORDER) {
    const group = sessions.filter((s) => s.status === state);
    if (!group.length) continue;
    const header = document.createElement('li');
    header.className = 'group-header';
    header.textContent = GROUP_LABELS[state];
    listEl.appendChild(header);
    for (const s of group) {
      const li = document.createElement('li');
      if (s.id === focusedId) li.classList.add('active');
      const dot = document.createElement('span');
      dot.className = `dot ${s.status}`;
      const label = document.createElement('span');
      label.textContent = s.label;
      li.append(dot, label);
      li.onclick = () => focus(s.id);
      listEl.appendChild(li);
    }
  }
}
```

- [ ] **Step 2: Add styles to `public/styles.css`**

Add (the `.dot.needs-you` rule and a group header style; place near the existing `.dot` rules):

```css
.dot.needs-you { background: #e2a23b; border-color: #e2a23b; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.group-header { list-style: none; padding: 8px 8px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; cursor: default; }
.group-header:hover { background: none; }
```

- [ ] **Step 3: Vendor + start the server**

Run: `npm start`, then open `http://127.0.0.1:4477`.

- [ ] **Step 4: Live verification against the spec's acceptance criteria**

1. Add a session in a real folder (e.g. `C:\temp_powershell`). It appears under **Working** while producing output.
2. When `claude` finishes its turn / shows an interactive question while the session is **not** focused, it moves to the **Needs you** group with the amber pulsing dot (this is the original complaint — confirm it now shows distinctly).
3. Click that session → it moves to **Idle** (acknowledged) and does not bounce back until the next turn ends.
4. Send it a message; while it works it shows under **Working**.
5. Add a second session and confirm grouping order is Needs you → Working → Idle → Exited.
6. Confirm your existing OS toast (`notify-bump.ps1`) still fires on the same prompts (hooks merged, not replaced).
7. Stop the server, confirm a running `claude` session is unaffected (no errors from the failed hook POST).

If any check fails, fix the relevant file and re-verify before committing.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "$(cat <<'EOF'
feat: group sidebar by state with a needs-you (amber) indicator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done

All spec acceptance criteria are covered:
- Criteria 1–4 (needs-you on unfocused prompt; acknowledge→idle on focus; →working on output; focused-when-signalled→idle) — Task 1 (unit) + Task 5 Step 4 (live).
- Criterion 5 (group order) — Task 5.
- Criterion 6 (user's hooks still fire / merge) — Task 4 (only-a-hooks-block test) + Task 5 Step 4.6 (live).
- Criterion 7 (server-down resilience) — Task 4 (async fire-and-forget hook) + Task 5 Step 4.7 (live).
- Criterion 8 (tests cover derivation, acknowledgement, /hook, spawn composition; UI verified live) — Tasks 1–4 tests + Task 5 live.

Run the whole suite at the end: `node --test --test-force-exit` (expect all prior + new tests green).
