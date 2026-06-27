// server/sdk.js
// The SDK session driver: the counterpart to server/pty.js for the Agent-SDK
// substrate. Each cockpit session owns one durable streaming query() (a child
// claude the SDK spawns and owns over stdio), authenticated on the user's own
// Claude Code subscription. This module owns: subscription-only env
// construction, the streaming-input queue, the GUI permission callback (parks a
// gated tool until the user answers), the control methods (interrupt / mode /
// model), the raw-message event source, and teardown.
// Strip the parent Claude Code session's markers so a spawned child launches like
// a fresh top-level session (else it would treat itself as a nested child and not
// persist a transcript). The cockpit's own CC_COCKPIT_* vars are a separate
// namespace. (Relocated here when the PTY substrate was removed — SDK-only.)
function scrubParentClaudeEnv(env) {
  for (const key of Object.keys(env)) {
    if (
      key === 'CLAUDECODE' ||
      key === 'CLAUDE_EFFORT' ||
      key === 'AI_AGENT' ||
      key.startsWith('CLAUDE_CODE_')
    ) {
      delete env[key];
    }
  }
  return env;
}

// Map one SDK stream message to the transcript-shaped record(s) the conversation
// fold (server/normalize.js) consumes. Assistant/user messages carry the
// conversation; everything else (system/init, result, rate_limit_event, …) is
// handled directly by the registry, not the fold.
function sdkMessageToRecords(msg) {
  if (!msg || !msg.type) return [];
  if (msg.type === 'assistant') return [{ type: 'assistant', message: msg.message }];
  if (msg.type === 'user') return [{ type: 'user', message: msg.message }];
  return [];
}

// Build the child env so the session ALWAYS authenticates on the user's
// subscription: strip the parent-session markers (as the PTY path does), then
// also strip the direct-auth / alternate-provider overrides so the child can
// never fall into an API-key or gateway auth path. The SDK's env option REPLACES
// (does not merge with) the child env, so callers pass the complete scrubbed env.
function scrubChildEnv(env) {
  scrubParentClaudeEnv(env);
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}

// A push-driven async iterable: the streaming-input channel. The server pushes a
// user turn with push(); the SDK's query() drains it via for-await. close() ends
// the stream (teardown). This is the structured replacement for typing into a PTY.
function makeInputQueue() {
  const buffer = [];
  let resolveNext = null;
  let done = false;
  return {
    push(item) {
      if (done) return;
      if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: item, done: false }); }
      else buffer.push(item);
    },
    close() {
      done = true;
      if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: undefined, done: true }); }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buffer.length) return Promise.resolve({ value: buffer.shift(), done: false });
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((res) => { resolveNext = res; });
        },
        return() { done = true; return Promise.resolve({ value: undefined, done: true }); },
      };
    },
  };
}

function defaultQuery() {
  // Lazy: only required when actually spawning a real session, so unit tests that
  // inject a fake query never load the SDK (which need not be installed for tests).
  return require('@anthropic-ai/claude-agent-sdk').query;
}

// One durable streaming query() = one cockpit session. Exposes the uniform driver
// shape the registry consumes. `deps.query` is injectable for tests.
function createSdkDriver(cwd, id, opts = {}, deps = {}) {
  const query = deps.query || defaultQuery();
  const messageCbs = [];
  const exitCbs = [];
  const errorCbs = [];
  const permissionCbs = [];
  const pending = new Map(); // toolUseId -> { resolve, input, suggestions }
  let permSeq = 0;
  const ac = new AbortController();
  const input = makeInputQueue();

  // Surface a gated tool to the GUI and await the user's answer (resolved later via
  // answerPermission). AskUserQuestion / ExitPlanMode aren't allow/deny gates —
  // decline them (their rich answer-UI is a separate, deferred feature). Tools the
  // user's loaded settings already allow never reach this callback.
  const canUseTool = (toolName, toolInput, options = {}) => {
    if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
      return Promise.resolve({ behavior: 'deny', message: 'Interactive prompts are not available in this session yet — proceed with your best judgment.' });
    }
    return new Promise((resolve) => {
      const toolUseId = options.toolUseID || `perm-${++permSeq}`;
      const suggestions = options.suggestions || [];
      pending.set(toolUseId, { resolve, input: toolInput, suggestions });
      for (const cb of permissionCbs) cb({ toolName, input: toolInput, toolUseId, suggestions });
    });
  };

  const q = query({
    prompt: input,
    options: {
      cwd,
      env: scrubChildEnv({ ...process.env }),
      permissionMode: 'default',
      settingSources: ['user', 'project', 'local'],
      canUseTool,
      abortController: ac,
      resume: opts.resumeId || undefined,
    },
  });

  (async () => {
    try {
      for await (const msg of q) { for (const cb of messageCbs) cb(msg); }
    } catch (e) {
      for (const cb of errorCbs) cb(e);
    } finally {
      for (const cb of exitCbs) cb();
    }
  })();

  return {
    onMessage: (cb) => messageCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
    onPermission: (cb) => permissionCbs.push(cb),
    write: (text) => input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }),
    // Resolve a parked permission with the user's decision (allow / allow-always /
    // deny). allow-always persists the SDK's suggested rule(s) if any were offered.
    answerPermission: (toolUseId, decision) => {
      const p = pending.get(toolUseId);
      if (!p) return;
      pending.delete(toolUseId);
      if (decision === 'deny') p.resolve({ behavior: 'deny', message: 'Denied by the user.' });
      else if (decision === 'allow-always' && p.suggestions.length) p.resolve({ behavior: 'allow', updatedInput: p.input, updatedPermissions: p.suggestions });
      else p.resolve({ behavior: 'allow', updatedInput: p.input });
    },
    interrupt: () => { try { if (q && typeof q.interrupt === 'function') return q.interrupt(); } catch { /* ignore */ } },
    setPermissionMode: (mode) => { try { if (q && typeof q.setPermissionMode === 'function') return q.setPermissionMode(mode); } catch { /* ignore */ } },
    setModel: (model) => { try { if (q && typeof q.setModel === 'function') return q.setModel(model); } catch { /* ignore */ } },
    kill: () => { try { ac.abort(); } catch { /* ignore */ } input.close(); },
  };
}

// The index.js factory: a real subscription-auth session.
function spawnSdk(cwd, id, opts = {}) {
  return createSdkDriver(cwd, id, opts);
}

module.exports = { sdkMessageToRecords, scrubChildEnv, createSdkDriver, spawnSdk };
