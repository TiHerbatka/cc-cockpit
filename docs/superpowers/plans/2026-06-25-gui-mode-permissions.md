# GUI Mode — Permissions Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Answer Claude Code permission prompts from the GUI (Allow / Allow & don't ask / Deny) via a blocking `PreToolUse` hook that calls back to the cockpit, bypassing the TUI prompt — while deferring to the native flow whenever the GUI can't or shouldn't handle it.

**Architecture:** A `PreToolUse` hook (in the injected cockpit settings) POSTs each tool's `{sessionId, toolName, toolInput}` to the cockpit and blocks for a decision. The cockpit either answers immediately (`defer` when the session isn't GUI-active; `allow` for read-only/remembered tools) or opens a pending request, broadcasts it to the GUI, and resolves it when the user clicks. The decision returns through the hook as `permissionDecision`.

**Tech Stack:** Plain Node, `node:test`, `ws`; PowerShell hook script. Same conventions as Plan 1.

## Global Constraints

- Node v22+; no new deps; no build step. Tests via `npm test`.
- Server binds `127.0.0.1` only.
- **Safety first:** the session MODE switch (Plan 1) is the kill-switch. In Terminal mode, with no browser watching, or on timeout, permissions MUST fall back to Claude's native flow (`defer`) so a session never hangs.
- Correlate via `CC_COCKPIT_SESSION` (the cockpit id), exactly like the existing turn hook.
- Spec: `docs/superpowers/specs/2026-06-25-rich-frontend-gui-mode-design.md`. Branch `feat/gui-mode`.

## Known tradeoffs (documented, accepted for v1)

- **Per-tool latency:** the `PreToolUse` hook fires for *every* tool call, spawning a PowerShell process + HTTP round-trip even in Terminal mode (where it gets a fast `defer`). Acceptable for a personal tool; a future optimization could gate or use a faster transport.
- **Over-gating:** in GUI mode the cockpit owns the decision for every not-pre-allowed tool, so it can prompt for tools Claude would have auto-approved. A read-only auto-allow default + per-tool "don't ask again" tame this. Documented in the spec.
- **Rule precedence:** a user's own `deny`/`ask` permission *rules* still apply regardless of the hook (per Claude Code docs).

---

## File structure (this plan)

- `server/permissions.js` *(new)* — `classify()` (pure) + `createBroker()` (pending-request lifecycle).
- `server/app.js` *(modify)* — `POST /permission`; WS `permission-decision`; `guiWatchers` count; broadcasts `permission-request` / `permission-resolved`; resend pending on `gui-attach`.
- `server/hooks.js` *(modify)* — add the blocking `PreToolUse` hook entry.
- `hooks/cockpit-pretooluse.ps1` *(new)* — read stdin, POST `/permission`, block, emit the decision.
- `hooks/cockpit-settings.generated.json` *(regenerate)*.
- `public/gui.js` + `public/app.js` + `public/styles.css` *(modify)* — the permission panel.
- Tests: `test/permissions.test.js` *(new)*, `test/app.test.js`, `test/hooks.test.js`.

---

## Task 1: `server/permissions.js` — classify + broker

**Files:** Create `server/permissions.js`; Test `test/permissions.test.js`.

**Interfaces — Produces:**
- `classify(toolName, { guiActive, allowSet }) -> 'defer' | 'allow' | 'prompt'`
- `createBroker({ timeoutMs }) -> { open({sessionId,toolName,toolInput}) -> {requestId, promise}, resolve(requestId, decision, reason) -> bool, pendingFor(sessionId) -> [{requestId,toolName,toolInput}] }` where `promise` resolves to `{ decision, reason }` and auto-resolves to `{ decision: 'defer' }` after `timeoutMs`.
- `AUTO_ALLOW` (Set of read-only/bookkeeping tool names).

- [ ] **Step 1: Failing tests** — `test/permissions.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { classify, createBroker, AUTO_ALLOW } = require('../server/permissions');

test('classify defers when the session is not GUI-active', () => {
  assert.strictEqual(classify('Bash', { guiActive: false, allowSet: null }), 'defer');
});
test('classify allows read-only tools when GUI-active', () => {
  assert.ok(AUTO_ALLOW.has('Read'));
  assert.strictEqual(classify('Read', { guiActive: true, allowSet: null }), 'allow');
});
test('classify prompts for a non-allowlisted tool when GUI-active', () => {
  assert.strictEqual(classify('Bash', { guiActive: true, allowSet: new Set() }), 'prompt');
});
test('classify allows a remembered tool', () => {
  assert.strictEqual(classify('Bash', { guiActive: true, allowSet: new Set(['Bash']) }), 'allow');
});

test('broker.open resolves when the request is resolved', async () => {
  const b = createBroker();
  const { requestId, promise } = b.open({ sessionId: 's1', toolName: 'Bash', toolInput: { command: 'ls' } });
  assert.deepStrictEqual(b.pendingFor('s1').map((p) => p.requestId), [requestId]);
  assert.strictEqual(b.resolve(requestId, 'allow'), true);
  assert.deepStrictEqual(await promise, { decision: 'allow', reason: undefined });
  assert.strictEqual(b.resolve(requestId, 'allow'), false); // already resolved
});

test('broker.open auto-resolves to defer after the timeout', async () => {
  const b = createBroker({ timeoutMs: 20 });
  const { promise } = b.open({ sessionId: 's1', toolName: 'Bash', toolInput: {} });
  assert.deepStrictEqual(await promise, { decision: 'defer' });
});
```

- [ ] **Step 2: Run, verify FAIL** — `node --test --test-force-exit test/permissions.test.js` → module not found.

- [ ] **Step 3: Implement `server/permissions.js`:**

```js
// server/permissions.js
// GUI-native permission policy + pending-request broker for the PreToolUse hook.
const AUTO_ALLOW = new Set([
  'Read', 'Glob', 'Grep', 'NotebookRead',
  'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ToolSearch',
]);

// Immediate disposition. 'defer' = let Claude's native flow run (terminal mode /
// no watcher); 'allow' = read-only or remembered; 'prompt' = ask the user in the GUI.
function classify(toolName, { guiActive, allowSet } = {}) {
  if (!guiActive) return 'defer';
  if (AUTO_ALLOW.has(toolName)) return 'allow';
  if (allowSet && allowSet.has(toolName)) return 'allow';
  return 'prompt';
}

function createBroker({ timeoutMs = 300000 } = {}) {
  const pending = new Map(); // requestId -> { sessionId, toolName, toolInput, resolve, timer }
  let seq = 0;
  return {
    open({ sessionId, toolName, toolInput }) {
      const requestId = `${sessionId}:${++seq}`;
      let resolveFn;
      const promise = new Promise((res) => { resolveFn = res; });
      const timer = setTimeout(() => {
        if (pending.has(requestId)) { pending.delete(requestId); resolveFn({ decision: 'defer' }); }
      }, timeoutMs);
      if (timer.unref) timer.unref();
      pending.set(requestId, { sessionId, toolName, toolInput, resolve: resolveFn, timer });
      return { requestId, promise };
    },
    resolve(requestId, decision, reason) {
      const p = pending.get(requestId);
      if (!p) return false;
      clearTimeout(p.timer);
      pending.delete(requestId);
      p.resolve({ decision, reason });
      return true;
    },
    pendingFor(sessionId) {
      const out = [];
      for (const [requestId, p] of pending) {
        if (p.sessionId === sessionId) out.push({ requestId, toolName: p.toolName, toolInput: p.toolInput });
      }
      return out;
    },
  };
}

module.exports = { classify, createBroker, AUTO_ALLOW };
```

- [ ] **Step 4: Run, verify PASS.** **Step 5: Commit** (`feat(gui): permission classify policy + pending-request broker`).

---

## Task 2: `server/app.js` — `/permission` endpoint + decision wiring

**Files:** Modify `server/app.js`; Test `test/app.test.js`.

**Interfaces — Consumes** `classify`, `createBroker` (Task 1). **Produces:**
- HTTP `POST /permission` body `{ sessionId, toolName, toolInput }` → responds `{ decision }` immediately for `defer`/`allow`, else holds open until a `permission-decision` arrives (or broker timeout) then responds `{ decision, reason }`.
- WS client→server `{ type:'permission-decision', requestId, sessionId, toolName, decision, reason?, remember? }`.
- WS server→client `{ type:'permission-request', id, requestId, tool, input }` and `{ type:'permission-resolved', id, requestId }`.
- `guiWatchers` (Map sessionId→count) incremented in `startWatch`, decremented in `stopWatch`; `guiActive(id)` = session mode `gui` and watcher count > 0. On `gui-attach`, resend any `pendingFor(id)` as `permission-request`.

- [ ] **Step 1: Failing tests** in `test/app.test.js`:

```js
test('POST /permission defers when the session is not GUI-active', async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];
  // no gui-attach -> not GUI-active -> defer
  const res = await postJson(port, '/permission', { sessionId: sess.id, toolName: 'Bash', toolInput: { command: 'ls' } });
  assert.strictEqual(res.json.decision, 'defer');
  ws.close(); await new Promise((r) => server.close(r));
});

test('POST /permission prompts the GUI and resolves from a permission-decision', { timeout: 5000 }, async () => {
  const { factory } = fakePtyFactory();
  const { server } = createApp({ spawnPty: factory });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on('open', r));
  const created = nextMessage(ws, (m) => m.type === 'sessions' && m.sessions.length === 1);
  ws.send(JSON.stringify({ type: 'create', cwd: 'C:/proj/demo' }));
  const sess = (await created).sessions[0];          // mode defaults to 'gui'
  ws.send(JSON.stringify({ type: 'gui-attach', id: sess.id })); // becomes a watcher -> GUI-active

  const reqMsg = nextMessage(ws, (m) => m.type === 'permission-request' && m.id === sess.id);
  const pending = postJson(port, '/permission', { sessionId: sess.id, toolName: 'Bash', toolInput: { command: 'rm x' } });
  const r = await reqMsg;
  assert.strictEqual(r.tool, 'Bash');
  ws.send(JSON.stringify({ type: 'permission-decision', requestId: r.requestId, sessionId: sess.id, toolName: 'Bash', decision: 'deny', reason: 'no' }));
  const res = await pending;
  assert.deepStrictEqual([res.json.decision, res.json.reason], ['deny', 'no']);
  ws.close(); await new Promise((r2) => server.close(r2));
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** In `server/app.js`:
  - Top: `const { classify, createBroker } = require('./permissions');`
  - In `createApp`, before the http server: `const broker = createBroker(); const sessionAllow = new Map(); const guiWatchers = new Map(); const guiActive = (id) => { const s = registry.get(id); return !!(s && s.mode === 'gui' && (guiWatchers.get(id) || 0) > 0); };`
  - Add the route (alongside the other `POST` routes), bounding the body like `/hook`:

```js
if (req.method === 'POST' && urlPath === '/permission') {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    let m; try { m = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    const sessionId = m && m.sessionId;
    const reply = (decision, reason) => { if (!res.writableEnded) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reason ? { decision, reason } : { decision })); } };
    const disp = classify(m && m.toolName, { guiActive: guiActive(sessionId), allowSet: sessionAllow.get(sessionId) });
    if (disp === 'defer' || disp === 'allow') { reply(disp); return; }
    const { requestId, promise } = broker.open({ sessionId, toolName: m.toolName, toolInput: m.toolInput });
    broadcast({ type: 'permission-request', id: sessionId, requestId, tool: m.toolName, input: m.toolInput });
    promise.then(({ decision, reason }) => { broadcast({ type: 'permission-resolved', id: sessionId, requestId }); reply(decision, reason); });
  });
  return;
}
```

  - In `startWatch`: after `watched.set(...)`, `guiWatchers.set(id, (guiWatchers.get(id) || 0) + 1);` and resend pending: `for (const p of broker.pendingFor(id)) ws.send(JSON.stringify({ type: 'permission-request', id, requestId: p.requestId, tool: p.toolName, input: p.toolInput }));`
  - In `stopWatch`: `const n = (guiWatchers.get(id) || 0) - 1; if (n > 0) guiWatchers.set(id, n); else guiWatchers.delete(id);`
  - Add WS handler:

```js
} else if (m.type === 'permission-decision') {
  if (m.remember && m.sessionId && m.toolName) {
    if (!sessionAllow.has(m.sessionId)) sessionAllow.set(m.sessionId, new Set());
    sessionAllow.get(m.sessionId).add(m.toolName);
  }
  broker.resolve(m.requestId, m.decision, m.reason);
}
```

- [ ] **Step 4: Run, verify PASS; then `npm test` all green. Step 5: Commit** (`feat(gui): /permission endpoint + GUI decision wiring`).

---

## Task 3: `PreToolUse` hook entry + `cockpit-pretooluse.ps1`

**Files:** Modify `server/hooks.js`; Create `hooks/cockpit-pretooluse.ps1`; regenerate `hooks/cockpit-settings.generated.json`; Test `test/hooks.test.js`.

**Interfaces — Produces:** `hookSettings()` now includes a matcher-less `PreToolUse` entry whose command runs `cockpit-pretooluse.ps1` **synchronously** (no `async`) with a long `timeout`.

- [ ] **Step 1: Failing test** in `test/hooks.test.js`:

```js
test('PreToolUse hook is matcher-less, synchronous, long-timeout, runs cockpit-pretooluse.ps1', () => {
  const s = hookSettings();
  const entry = s.hooks.PreToolUse[0];
  assert.strictEqual(entry.matcher, undefined);
  const cmd = entry.hooks[0];
  assert.strictEqual(cmd.command, 'powershell.exe');
  assert.notStrictEqual(cmd.async, true);          // MUST be synchronous (blocking)
  assert.ok(cmd.timeout >= 300, 'needs a long timeout for a human decision');
  const fileArg = cmd.args[cmd.args.indexOf('-File') + 1];
  assert.match(fileArg, /cockpit-pretooluse\.ps1$/);
});
```

- [ ] **Step 2: Run, verify FAIL. Step 3: Implement** in `server/hooks.js` — add a blocking entry builder and wire `PreToolUse`:

```js
function blockingEntry(scriptPath) {
  return {
    type: 'command', command: 'powershell.exe',
    args: ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    timeout: 600, // seconds; long enough for a human decision (cockpit resolves sooner)
  };
}
```

In `hookSettings()`, add to the returned `hooks` object:

```js
PreToolUse: [
  { hooks: [blockingEntry(path.join(HOOKS_DIR, 'cockpit-pretooluse.ps1'))] },
],
```

- [ ] **Step 4: Run hooks test, verify PASS.** Also confirm the "only a hooks block" test still passes (it asserts `Object.keys(s) === ['hooks']` — unaffected).

- [ ] **Step 5: Create `hooks/cockpit-pretooluse.ps1`:**

```powershell
# Cockpit PreToolUse hook: ask the cockpit for an allow/deny decision (GUI-native
# permissions). BLOCKS until the cockpit responds. Correlates via CC_COCKPIT_SESSION.
# Reads the PreToolUse payload (tool_name/tool_input) on stdin. Emits a
# permissionDecision on stdout for allow/deny/ask; emits nothing for defer / on any
# error -> Claude's native permission flow runs (safe fallback).
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$id = $env:CC_COCKPIT_SESSION
$port = $env:CC_COCKPIT_PORT
if (-not $id -or -not $port) { exit 0 }
$toolName = ''
$toolInput = $null
try { $p = $raw | ConvertFrom-Json; $toolName = $p.tool_name; $toolInput = $p.tool_input } catch { }
$body = @{ sessionId = $id; toolName = $toolName; toolInput = $toolInput } | ConvertTo-Json -Compress -Depth 25
try {
  $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/permission" -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 590
} catch { exit 0 }
$d = $resp.decision
if ($d -eq 'allow' -or $d -eq 'deny' -or $d -eq 'ask') {
  $hso = @{ hookEventName = 'PreToolUse'; permissionDecision = $d }
  if ($resp.reason) { $hso.permissionDecisionReason = [string]$resp.reason }
  @{ hookSpecificOutput = $hso } | ConvertTo-Json -Compress -Depth 6
}
exit 0
```

- [ ] **Step 6: Regenerate the committed settings file:** `node -e "require('./server/hooks').writeHookSettings()"` then confirm `hooks/cockpit-settings.generated.json` now has the `PreToolUse` block.

- [ ] **Step 7: `npm test` green. Step 8: Commit** (`feat(gui): blocking PreToolUse hook -> cockpit /permission`).

---

## Task 4: Client permission panel

**Files:** Modify `public/gui.js`, `public/app.js`, `public/styles.css`. Browser-verified.

**Interfaces — Consumes** `permission-request` / `permission-resolved`. **Produces:** an in-pane panel for the focused GUI session.

- [ ] **Step 1: `gui.js`** — add a `.gui-perm` element (hidden) between status and log. Extend the controller with:
  - `showPermission({ requestId, tool, input }, onDecide)` — render "Claude wants to use **{tool}**", a `<pre>` of `input` (truncated), an optional reason `<input>`, and buttons **Allow once** / **Allow & don't ask again** / **Deny**. Each calls `onDecide({ decision, reason, remember })` then hides the panel. `decision`: Allow→`allow`, Deny→`deny`; remember only on "don't ask again".
  - `hidePermission(requestId)` — hide if it matches (or unconditionally).

- [ ] **Step 2: `app.js`** — route messages:
  - `permission-request` with `m.id === focusedId` and GUI mode → `gui.showPermission({ requestId: m.requestId, tool: m.tool, input: m.input }, ({decision, reason, remember}) => ws.send(JSON.stringify({ type: 'permission-decision', requestId: m.requestId, sessionId: m.id, toolName: m.tool, decision, reason, remember })))`.
  - `permission-resolved` with `m.id === focusedId` → `gui.hidePermission(m.requestId)`.
  - On focus change away, hide any open panel (the server keeps the request pending and resends it on re-attach).

- [ ] **Step 3: `styles.css`** — `.gui-perm` (prominent amber border, padding), buttons (allow=green, deny=red), reason input. Hidden via a class or `hidden` attr.

- [ ] **Step 4: Browser verify** — drive a real session to a tool that prompts (e.g., a Bash command); confirm the GUI panel appears, **Allow** lets it run, **Deny** blocks it (terminal shows no native prompt); switch to **Terminal mode** and confirm a subsequent tool prompts natively (defer). Confirm closing the browser lets a pending/next tool proceed via the native prompt.

- [ ] **Step 5: Commit** (`feat(gui): in-pane permission Allow/Deny panel`).

---

## Self-review notes (author)

- **Spec coverage:** PreToolUse-hook IPC (T3), `/permission` + defer/allow/prompt policy + decision wiring (T1/T2), GUI Allow/Deny panel (T4), Terminal/closed-browser/timeout fallback to native (`classify` defer + broker timeout + hook error path). Over-gating mitigations (read-only `AUTO_ALLOW` + per-tool remember) in T1/T2.
- **Type consistency:** `permission-request {id, requestId, tool, input}` and `permission-decision {requestId, sessionId, toolName, decision, reason?, remember?}` consistent across server (T2) and client (T4). `decision ∈ {allow,deny,ask,defer}`; broker timeout → `defer`.
- **Safety:** the defer-fast path (not GUI-active) responds without opening a request, so Terminal mode / no-browser never blocks; broker timeout and the hook's error/`-TimeoutSec` paths all fall back to the native flow.
