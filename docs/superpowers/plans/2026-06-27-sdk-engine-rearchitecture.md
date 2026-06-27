# SDK Engine Re-architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this plan is calibrated for inline execution by the same agent that holds the design context) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-session pseudo-terminal substrate with a per-session durable streaming Agent SDK `query()`, re-sourcing the existing GUI features (live conversation, topics/todos, session state, resume, mode chip) from the SDK message stream, with the SDK as the sole driver (no terminal fallback).

**Architecture:** Each cockpit session owns one long-lived `query()` (server/sdk.js). Its message stream is folded by an incremental conversation mapper (server/normalize.js, refactored) into a render model; the server holds the model centrally and broadcasts deltas; the browser keeps a local model copy and re-renders via the existing GUI controller. Structured input replaces keystrokes; stream turn-boundaries replace hook-driven state; subscription-only env is enforced at construction.

**Tech Stack:** Plain Node (no bundler), `@anthropic-ai/claude-agent-sdk` (v0.3.195), `ws`, `node --test --test-force-exit`, vanilla browser JS + xterm (xterm now only for the dormant terminal path).

## Global Constraints

- Subscription-only: the child env strips parent-session markers (CLAUDECODE, CLAUDE_CODE_*, CLAUDE_EFFORT, AI_AGENT) AND direct-auth/alternate-provider overrides (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL) so the child always uses the user's subscription. (These exact names live only in code, not in user-facing docs.)
- SDK is the sole session driver this phase. No terminal fallback. A session that fails to start surfaces a clear error.
- One durable streaming `query()` per session (not per turn, not shared).
- Permission posture A: load the user's settings; auto-approve uncovered tool calls via the permission callback; decline AskUserQuestion / ExitPlanMode with a short message.
- Render at message granularity (no partial-token streaming this phase).
- No bundler / no build step; `127.0.0.1`-only bind; small single-responsibility files; frequent commits; `node --test --test-force-exit`.
- Dormant (kept in tree, not wired this phase): server/buffer.js, server/transcript.js, server/hooks.js, public/modeparse.js, public/usageparse.js, the raw-terminal view, quick-preview (peek), and the GUI permission panel.

## File Structure

- **Create `server/sdk.js`** — the SDK session driver (counterpart to pty.js): scrubbed-env construction, per-session `query()`, streaming-input queue, posture-A permission callback, raw-message event source, teardown. Exports `sdkMessageToRecords`, `createSdkDriver`, `spawnSdk`, and `scrubChildEnv`.
- **Refactor `server/normalize.js`** — add `createConversation()` (stateful incremental fold over transcript-shaped records, emitting deltas) and re-implement `normalize(records)` on top of it.
- **Refactor `server/sessions.js`** — registry drives an injected `spawnDriver`; holds a per-session conversation model; folds stream messages into deltas; derives state from turn-boundaries; structured `send`. Raw-byte/resize/buffer methods removed.
- **Refactor `server/app.js`** — WS `send` (structured input) replaces raw `input`; broadcast `gui-delta` + per-session `gui-snapshot` on attach + `meta` (mode/usage); drop the per-socket transcript tailer, the `/hook` & `/tool-pending` HTTP endpoints, and the keystroke permission path. Keep projects/recent/upload/open-* untouched.
- **Refactor `server/index.js`** — wire `spawnSdk` instead of `spawnClaude`; stop injecting hook settings.
- **Refactor `public/app.js`** — compose sends structured `send` (drop the `\r` + nudge timer); maintain a local per-session model, apply `gui-snapshot`/`gui-delta`; chips from `meta`; hide terminal/preview/permission affordances for SDK sessions.
- **Refactor `public/gui.js`** — no rendering change needed (still `update(model)`); only remove the now-unused permission panel wiring if convenient (optional, low priority).
- **Tests:** add `test/sdk.test.js`; extend `test/normalize.test.js`; rewrite the PTY-shaped parts of `test/sessions.test.js` and `test/app.test.js` to the new contracts.

---

## Phase 1 — Incremental conversation mapper

### Task 1: `createConversation()` incremental fold in normalize.js

**Files:**
- Modify: `server/normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Produces: `createConversation() -> { model, applyRecord(record) -> ops[], seed(records) -> model }` where `model = { title, items, status:{currentTool, todos} }` and ops are `{op:'append', item}` | `{op:'update', id, patch}` | `{op:'title', title}` | `{op:'status', status}`.
- Produces: `normalize(records) -> model` (unchanged signature, re-implemented via `createConversation().seed`).
- Consumes (records): the existing transcript record shapes (`{type:'ai-title',aiTitle}`, `{type:'user',message:{content}}`, `{type:'assistant',message:{content:[...]}}`).

- [ ] **Step 1: Write failing tests** for incremental behavior, in `test/normalize.test.js`:

```javascript
const { createConversation } = require('../server/normalize');

test('applyRecord appends a user item and returns an append op', () => {
  const c = createConversation();
  const ops = c.applyRecord({ type: 'user', message: { role: 'user', content: 'Hello' } });
  assert.deepStrictEqual(c.model.items, [{ kind: 'user', text: 'Hello' }]);
  assert.deepStrictEqual(ops, [{ op: 'append', item: { kind: 'user', text: 'Hello' } }]);
});

test('a tool_use then its tool_result updates the same item in place by id', () => {
  const c = createConversation();
  c.applyRecord({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] } });
  const ops = c.applyRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'FILE', is_error: false }] } });
  const tool = c.model.items.find((i) => i.kind === 'tool');
  assert.strictEqual(tool.status, 'ok');
  assert.strictEqual(tool.resultText, 'FILE');
  assert.ok(ops.some((o) => o.op === 'update' && o.id === 't1' && o.patch.status === 'ok'));
});

test('seed equals the legacy normalize over the same records', () => {
  const { normalize } = require('../server/normalize');
  const records = [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
    { type: 'ai-title', aiTitle: 'T' },
  ];
  assert.deepStrictEqual(createConversation().seed(records), normalize(records));
});
```

- [ ] **Step 2: Run, verify they fail** — `npm test -- test/normalize.test.js` → FAIL (`createConversation` undefined).
- [ ] **Step 3: Implement** `createConversation()` by lifting `normalize`'s locals into closure state and emitting ops per record (append on new items, update on tool_result resolution, title on ai-title, status after each record when currentTool/todos change). Re-implement `normalize(records)` as `createConversation().seed(records)`. Keep all existing `normalize` test cases passing (TaskCreate/TaskUpdate aggregation, TodoWrite snapshots, `<…>`-prefixed user filtering).
- [ ] **Step 4: Run** the full file — `npm test -- test/normalize.test.js` → PASS (new + all ported legacy cases).
- [ ] **Step 5: Commit** — `git add server/normalize.js test/normalize.test.js && git commit -m "refactor: incremental conversation fold in normalize (createConversation)"`.

---

## Phase 2 — SDK driver

### Task 2: `sdkMessageToRecords` shim + `scrubChildEnv`

**Files:**
- Create: `server/sdk.js`
- Test: `test/sdk.test.js`

**Interfaces:**
- Produces: `sdkMessageToRecords(msg) -> record[]` mapping an SDK message to transcript-shaped records the conversation fold eats: `{type:'assistant'}` → `[{type:'assistant', message: msg.message}]`; `{type:'user'}` → `[{type:'user', message: msg.message}]`; everything else → `[]`.
- Produces: `scrubChildEnv(env) -> env` (reuses pty.js `scrubParentClaudeEnv`, then deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`).

- [ ] **Step 1: Write failing tests** (`test/sdk.test.js`): assert `sdkMessageToRecords` maps assistant/user and returns `[]` for system/result/rate_limit_event; assert `scrubChildEnv` removes the auth overrides and the parent markers but keeps PATH.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the shim + `scrubChildEnv` (import `scrubParentClaudeEnv` from `./pty`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: SDK message->record shim + subscription-only child env scrub"`.

### Task 3: `createSdkDriver` (streaming query with injected query fn)

**Files:**
- Modify: `server/sdk.js`
- Test: `test/sdk.test.js`

**Interfaces:**
- Produces: `createSdkDriver(cwd, id, opts, deps) -> { onMessage(cb), onExit(cb), onError(cb), write(text), interrupt(), kill() }`. `deps.query` is injected (defaults to the real SDK `query`). `opts`: `{ resumeId, settingsPath? }`. Internally constructs `query({ prompt: <async input queue>, options: { cwd, env: scrubChildEnv({...process.env}), permissionMode:'default', settingSources:['user','project','local'], canUseTool, abortController, resume: resumeId||undefined } })`, iterates it calling `onMessage` per message, `onExit` on completion, `onError` on throw. `write(text)` enqueues `{type:'user', message:{role:'user', content:text}, parent_tool_use_id:null}`. `canUseTool` implements posture A (allow with `updatedInput`; decline `AskUserQuestion`/`ExitPlanMode`).
- Produces: `spawnSdk(cwd, id, opts)` — the index.js factory (calls `createSdkDriver` with the real query).

- [ ] **Step 1: Write failing tests** using a **fake query** — an async generator yielding scripted SDK messages plus a stubbed control object — injected via `deps.query`. Assert: messages reach `onMessage` in order; `write(text)` causes the fake query's input iterable to receive the wrapped user message; `onExit` fires when the generator ends; `canUseTool` returns allow for `Write` and a deny for `AskUserQuestion`.

```javascript
const { createSdkDriver } = require('../server/sdk');

test('driver relays SDK messages and wraps written input', async () => {
  const inbox = [];
  const fakeQuery = ({ prompt }) => {
    (async () => { for await (const u of prompt) inbox.push(u); })();
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's', model: 'm', permissionMode: 'default' };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
      yield { type: 'result', subtype: 'success', usage: {} };
    })();
  };
  const got = [];
  const d = createSdkDriver('C:/x', 'id1', {}, { query: fakeQuery });
  d.onMessage((m) => got.push(m.type));
  await new Promise((r) => d.onExit(r));
  assert.deepStrictEqual(got, ['system', 'assistant', 'result']);
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `createSdkDriver` with a queue-backed async iterable (a push/await queue) feeding `prompt`, the iteration loop, posture-A `canUseTool`, and an `AbortController` for `kill()`. Add `spawnSdk`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: createSdkDriver — durable streaming query() per session"`.

---

## Phase 3 — Registry drives the SDK

### Task 4: SDK-native SessionRegistry

**Files:**
- Modify: `server/sessions.js`
- Test: `test/sessions.test.js` (rewrite the PTY-shaped cases)

**Interfaces:**
- Consumes: injected `spawnDriver(cwd, id, opts) -> driver` (driver shape from Task 3).
- Produces: `create(cwd, opts)`, `send(id, text)`, `get`, `list`, `modelOf(id)`, `setTopics`, `setAutoTitle`, `rename`, `acknowledge`, `markExited`, `remove`, `projectOf`. Emits `'delta'(id, ops)`, `'meta'(id, {mode?, usage?})`, `'sessions'`. Keeps the state machine (`markWorking`/`markIdle`/`signalWaiting`/`acknowledge`/`_derive`) but drives `markWorking` from `send` and `markIdle` from the `result` message; `_onMessage(id,msg)` folds the stream.
- Removed: `appendOutput`, raw `write`, `resize`, `bufferOf`, `sizeOf`, `buffer` (RingBuffer), `setMode` (vestigial — drop or keep no-op).

- [ ] **Step 1: Rewrite the failing tests** with a **fake driver** factory (mirrors the old fake-pty pattern): captures `onMessage`/`onExit` callbacks and records `write`/`kill`. New assertions: `create` spawns the driver with `ccSessionId`; `send` wraps text → `driver.write` and flips status to `working`; a `result` message flips to `idle`/`your-move`; an `assistant` message emits a `delta`; `modelOf` reflects folded messages; `driver.onExit` → `exited`; `remove` calls `driver.kill`. Port the still-valid label/topics/rename/projectOf/temp tests unchanged.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the registry: per-session `conversation = createConversation()`; `_onMessage` does init→`meta`(mode), shim+`applyRecord`→`delta`, `result`→`markIdle`+`meta`(usage), `rate_limit_event`→`meta`(usage); `send`→`driver.write`+`markWorking`.
- [ ] **Step 4: Run → PASS** (`npm test -- test/sessions.test.js`).
- [ ] **Step 5: Commit** — `git commit -m "refactor: SessionRegistry drives the SDK (model+deltas, stream-derived state)"`.

---

## Phase 4 — Server wiring

### Task 5: app.js — structured I/O, deltas, meta; drop PTY/hook plumbing

**Files:**
- Modify: `server/app.js`
- Test: `test/app.test.js` (rewrite GUI/state/permission/peek/resize cases; keep projects/recent/upload/open-* cases)

**Interfaces:**
- WS in: `create`, `create-temp`, `resume`, `send {id, text}` (replaces `input`), `attach {id}` (acknowledges + replies `gui-snapshot {id, model}`), `gui-attach`/`gui-detach` (subscribe/no-op; deltas are broadcast), `remove`, `rename`, `open-folder`, `open-file`, `open-image`.
- WS out: `sessions`, `gui-snapshot {id, model}`, `gui-delta {id, ops}`, `meta {id, mode?, usage?}`, `error`.
- Removed: `/hook` + `/tool-pending` HTTP endpoints; `input`/`resize`/`peek`/`set-mode`/`permission-answer` WS handlers; the per-socket transcript tailer; `registry.on('output')`.

- [ ] **Step 1: Rewrite failing tests:** `create` → `sessions` broadcast (keep); `send` over WS → fake driver received the wrapped turn + status `working`; an injected fake-driver `assistant` message → a `gui-delta` broadcast; `attach` → `gui-snapshot` with the current model; a `result` message → `your-move`/`idle` broadcast (replaces the `/hook` tests); `resume` passes `resumeId` (keep). Delete `/hook`, `/tool-pending`, `peek`, `set-mode`, `permission-answer`, `resize` tests. Keep projects/recent/upload/open-folder/open-file/open-image tests verbatim.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the wiring: `registry.on('delta', (id, ops) => broadcast({type:'gui-delta', id, ops}))`, `registry.on('meta', ...)`, `attach` replies a snapshot, `send` → `registry.send`. Remove the dead endpoints/handlers + the tailer.
- [ ] **Step 4: Run → PASS** (`npm test -- test/app.test.js`).
- [ ] **Step 5: Commit** — `git commit -m "refactor: app wiring to SDK stream (send/gui-delta/snapshot/meta), drop PTY+hook plumbing"`.

### Task 6: index.js — wire the SDK driver

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1:** Replace `spawnPty: spawnClaude(...)` with `spawnDriver: (cwd, id, opts) => spawnSdk(cwd, id, opts)`; drop `writeHookSettings`. (No unit test; covered by the live smoke in Phase 6.)
- [ ] **Step 2: Commit** — `git commit -m "feat: index wires the SDK driver (no hook settings)"`.

---

## Phase 5 — Client

### Task 7: public/app.js — structured compose, local model + deltas, chips from meta

**Files:**
- Modify: `public/app.js`
- (Optional) Modify: `public/gui.js`

**Interfaces:**
- Consumes: `gui-snapshot {id, model}`, `gui-delta {id, ops}`, `meta {id, mode?, usage?}`.
- Produces: WS `send {id, text}` on compose submit.

- [ ] **Step 1:** Replace `composeSend` to send `{type:'send', id, text}`; delete the `pendingSubmit`/nudge timer entirely.
- [ ] **Step 2:** Maintain `let guiModel = null` for the focused session; on `gui-snapshot` (focused) set `guiModel = m.model` and `gui.update(guiModel)`; on `gui-delta` (focused) apply ops (`append`→push; `update`→find tool item by id and `Object.assign(it, patch)`; `title`→set; `status`→set) then `gui.update(guiModel)`.
- [ ] **Step 3:** Chips: on `meta`, set `claudeModeEl.textContent = m.mode` (when present) and render usage from `m.usage` (when present); delete `readFooter`/`refreshClaudeMode`/footer scraping and the `output`/`attached`/`peeked` raw-terminal handlers' chip calls.
- [ ] **Step 4:** Hide deferred affordances for SDK sessions: the mode-switch buttons, the interrupt button, the quick-preview context item, and the permission panel path (leave the code, hide the controls). `attach` still focuses + acknowledges; `applyMode` collapses to "always GUI".
- [ ] **Step 5:** Manual browser verification (Phase 6). Commit — `git commit -m "feat: client on the SDK stream — structured compose, delta apply, meta chips"`.

---

## Phase 6 — Verify end-to-end

### Task 8: Full suite + live smoke + browser

- [ ] **Step 1:** `npm test` → all green (force-exit). Fix any stragglers (buffer/transcript/hooks/modeparse/usageparse tests for now-dormant modules: keep them green since the modules still exist; only their wiring is gone).
- [ ] **Step 2:** Restart the cockpit (`npm start`) and, in a browser, create a session, send a turn, confirm the live conversation renders from the SDK stream, topics/todos appear, state cycles working→idle/your-move, and resume reopens a past session.
- [ ] **Step 3:** Live smoke parity with the spike: confirm a real `query()` session streams into the GUI end-to-end and authenticates on the subscription.
- [ ] **Step 4:** Stop and notify the user for visual review (per the active goal). Mark TODO G1.3/G1.4/G1.5 progress.

## Self-Review notes

- **Spec coverage:** §4 flow → Tasks 3–7; §5 components → Tasks 1–7; §6 data flow (send/respond/turn-end/attach-resume/start-failure) → Tasks 3–7 (+ start-failure error path in Task 3/5); §7 posture A → Task 3 `canUseTool`; §8 error handling → Task 3 (onError/onExit) + Task 5 (error broadcast); §9 testing → each task's tests + Task 8; §10 invariants → Global Constraints + Task 2 scrub.
- **Deferred-by-design (no task, intentional):** raw terminal mode, quick-preview, GUI permission UI, interrupt, mode/model switching, partial-token streaming — all out of scope per the spec.
- **Type consistency:** delta op shape (`append`/`update`/`title`/`status`) is identical in Task 1 (producer) and Task 7 (consumer); driver shape (`onMessage`/`onExit`/`onError`/`write`/`kill`/`interrupt`) is identical in Tasks 3, 4, 5.
- **Open risk:** the `meta` usage mapping (ctx/5h/7d) depends on the `rate_limit_event` field shape, not fully captured by the spike — Task 7 renders what's cleanly available and the precise usage chip is verified/iterated during the browser pass (flag at visual review).
