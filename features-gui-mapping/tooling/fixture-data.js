// features-gui-mapping/tooling/fixture-data.js
// DEV-ONLY tooling for the /gui-map skill. NOT product code — nothing here ships
// in the cockpit; it only feeds canned data into the REAL app so the GUI can be
// screenshotted deterministically with no live `claude` and zero tokens.
//
// Two exports:
//   - makeFixtureDriver(cwd, id, opts): a fake SDK driver mirroring the shape the
//     registry consumes (server/sdk.js). After the registry registers onMessage,
//     it replays opts.script (a canned SDK-message sequence) so the conversation
//     folds exactly like a live stream, then optionally surfaces opts.interaction
//     (a blocking prompt) and/or fires onExit (opts.exit).
//   - SESSIONS: the canned session list (cwd + state + script) covering every
//     sidebar group (project / Temporary / Other), every status dot, every
//     conversation item kind, and every blocking-interaction variant.

const PROJECTS_ROOT = require('node:path').join(__dirname, 'fixture-home', 'projects-root');
const p = (...segs) => require('node:path').join(PROJECTS_ROOT, ...segs);

// ---- canned usage (feeds the header usage chip via getUsage/getContextUsage) ---
const DEFAULT_USAGE = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 42, resets_at: '2026-06-29T15:00:00Z' },
    seven_day: { utilization: 18, resets_at: '2026-07-02T00:00:00Z' },
  },
};
const DEFAULT_CTX = { totalTokens: 84000, maxTokens: 200000, percentage: 42 };

// ---- message constructors (shapes from server/sdk.js + server/normalize.js) ----
const init = (mode = 'default', model = 'claude-opus-4-8') =>
  ({ type: 'system', subtype: 'init', permissionMode: mode, model });
const userMsg = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const asstText = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const asstThink = (text) => ({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: text }] } });
const toolUse = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false) =>
  ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const todoWrite = (id, todos) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] } });
const result = (usage) => ({ type: 'result', subtype: 'success', usage });

// A full conversation exercising every item kind the GUI renders: user prompt,
// assistant thinking (collapsible), assistant text, a tool card that resolves OK,
// a todos block, and a tool card that resolves as an error. Ends with a result so
// the turn closes (idle when focused) and the per-turn token segment populates.
const RICH_CONVERSATION = [
  init('default', 'claude-opus-4-8'),
  userMsg('Add a dark-mode toggle to the settings panel and persist the choice.'),
  asstThink('The settings panel renders from a small template; I will add a labelled checkbox bound to a setting and persist it to localStorage so the choice survives reloads.'),
  asstText("I'll add a dark-mode toggle to the settings panel and persist the choice to localStorage."),
  toolUse('tu1', 'Read', { file_path: 'public/settings.js' }),
  toolResult('tu1', 'export function renderSettings(el) { /* … current settings markup … */ }'),
  todoWrite('tu2', [
    { content: 'Add the toggle markup to the settings panel', status: 'completed' },
    { content: 'Persist the choice to localStorage', status: 'in_progress' },
    { content: 'Apply the dark theme on load', status: 'pending' },
  ]),
  toolUse('tu3', 'Bash', { command: 'npm test' }),
  toolResult('tu3', '1 test failed: settings persistence (expected "dark", got null)', true),
  result({ input_tokens: 1820, output_tokens: 640, cache_read_input_tokens: 82000 }),
];

// A short turn still in progress (no result) -> status stays "working".
const WORKING_TURN = [
  init('acceptEdits', 'claude-sonnet-4-6'),
  userMsg('Refactor the recent-sessions scanner to read each transcript only once.'),
  asstText('Scanning the recent-sessions module to find the redundant reads…'),
  toolUse('w1', 'Grep', { pattern: 'readFileSync', glob: 'server/*.js' }),
];

// A finished turn (result) -> "your-move" while unfocused.
const FINISHED_TURN = [
  init('plan', 'claude-opus-4-8'),
  userMsg('Investigate the flaky transcript test and propose a fix.'),
  asstText('The flakiness comes from comparing timestamps without normalising the timezone. I propose pinning the clock in the test.'),
  result({ input_tokens: 940, output_tokens: 210, cache_read_input_tokens: 30000 }),
];

// ---- seeded blocking interactions (one per variant) --------------------------
const PERMISSION_INTERACTION = {
  requestId: 'int-perm', kind: 'permission', toolName: 'Bash',
  input: { command: 'rm -rf build/' }, suggestions: [],
};
const PLAN_INTERACTION = {
  requestId: 'int-plan', kind: 'plan',
  plan: '# Plan\n\n1. Pin the clock in the transcript test.\n2. Normalise timezones in the comparison.\n3. Add a regression case for DST boundaries.',
};
const QUESTION_INTERACTION = {
  requestId: 'int-q', kind: 'question',
  questions: [{
    header: 'Storage', question: 'Where should the toggle state be stored?',
    multiSelect: false,
    options: [
      { label: 'localStorage', description: 'Per-browser, survives reloads' },
      { label: 'A cookie', description: 'Sent to the server each request' },
      { label: 'In-memory only', description: 'Resets on reload' },
    ],
  }],
};
const ELICITATION_INTERACTION = {
  requestId: 'int-eli', kind: 'elicitation',
  request: {
    title: 'Connect to the design service',
    message: 'Provide an access token so the design MCP server can fetch your components.',
    mode: 'form',
    requestedSchema: { properties: { token: { title: 'Access token' }, workspace: { title: 'Workspace name' } } },
  },
};

// ---- the canned session roster ------------------------------------------------
// Order matters: the client auto-focuses the FIRST session, so the rich
// conversation is created first (it becomes the focused, idle main view).
const SESSIONS = [
  // Project "alpha"
  { cwd: p('alpha'), script: RICH_CONVERSATION },                                   // focused -> idle, full conversation
  { cwd: p('alpha'), script: WORKING_TURN },                                        // working dot
  // Project "beta"
  { cwd: p('beta'), script: FINISHED_TURN },                                        // your-move dot
  { cwd: p('beta'), script: FINISHED_TURN, interaction: PERMISSION_INTERACTION },   // needs-you dot + permission modal
  // Project "gamma" — one session per remaining interaction variant
  { cwd: p('gamma'), script: FINISHED_TURN, interaction: PLAN_INTERACTION },
  { cwd: p('gamma'), script: FINISHED_TURN, interaction: QUESTION_INTERACTION },
  { cwd: p('gamma'), script: FINISHED_TURN, interaction: ELICITATION_INTERACTION },
  // Temporary group (a one-off session) — exited dot
  { cwd: p('_temporary-sessions', 'quick-experiment'), script: FINISHED_TURN, exit: true },
  // "Other" group (a session outside the cockpit projects root)
  { cwd: require('node:path').join('D:', 'work', 'legacy-thing'), script: FINISHED_TURN },
];

// A fake SDK driver: registry registers callbacks synchronously in create(), then
// we replay the canned script on the next tick so every callback is attached.
//
// Meta (mode/model/usage) reaches the GUI only as an ephemeral broadcast, never in
// the attach snapshot. A live session emits it continuously while the user watches;
// our one-shot replay happens before any browser connects, so a focused session's
// chips would stay blank. We therefore re-pulse the meta-bearing messages on a slow
// timer: the init (mode/model + usage refresh) always — it never changes status —
// and the result (per-turn token segment) only when there's no pending interaction,
// so re-applying it can't clear a needs-you state. The client ignores meta for every
// session except the focused one, so this only ever fills in the focused chips.
function makeFixtureDriver(cwd, id, opts = {}) {
  const messageCbs = [];
  const exitCbs = [];
  const errorCbs = [];
  const interactionCbs = [];
  let started = false;
  let pulse = null;

  const emit = (msg) => { for (const cb of messageCbs) cb(msg); };
  const script = opts.script || [];
  const initMsg = script.find((m) => m.type === 'system' && m.subtype === 'init');
  const resultMsg = script.find((m) => m.type === 'result');

  const replay = () => {
    for (const msg of script) emit(msg);
    if (opts.interaction) { for (const cb of interactionCbs) cb(opts.interaction); }
    if (opts.exit) { for (const cb of exitCbs) cb(); return; }
    // Keep the focused session's chips alive (see note above).
    pulse = setInterval(() => {
      if (initMsg) emit(initMsg);
      if (resultMsg && !opts.interaction) emit(resultMsg);
    }, 1500);
    if (pulse.unref) pulse.unref();
  };

  return {
    onMessage: (cb) => { messageCbs.push(cb); if (!started) { started = true; setImmediate(replay); } },
    onExit: (cb) => exitCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
    onInteraction: (cb) => interactionCbs.push(cb),
    write: () => {},                 // compose is screenshotted by typing into the DOM, not by sending
    answerInteraction: () => {},
    interrupt: () => {},
    setPermissionMode: () => {},
    setModel: () => {},
    setEffort: () => {},
    getUsage: async () => opts.usage || DEFAULT_USAGE,
    getContextUsage: async () => opts.ctx || DEFAULT_CTX,
    kill: () => { if (pulse) { clearInterval(pulse); pulse = null; } },
  };
}

module.exports = { makeFixtureDriver, SESSIONS, PROJECTS_ROOT };
