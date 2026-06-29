// features-gui-mapping/tooling/fixture-server.js
// DEV-ONLY launcher for the /gui-map skill. NOT product code — it ships nothing
// into the cockpit. It imports the REAL app (server/app.js) and injects a fake
// spawnDriver through the existing dependency-injection seam, so every pixel is
// the genuine GUI but driven by canned data: no live `claude`, no subscription
// tokens, fully deterministic. Run it directly:  node features-gui-mapping/tooling/fixture-server.js
//
// It binds 127.0.0.1 only (like the real server) on PORT||4488 so it can run
// alongside the real cockpit (4477). The skill points Playwright at it, arranges
// each state, and screenshots.

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../../server/app');
const { makeFixtureDriver, SESSIONS, ALPHA_TODO_MD } = require('./fixture-data');

const HOME = path.join(__dirname, 'fixture-home');
const PROJECTS_ROOT = path.join(HOME, 'projects-root');
const CLAUDE_DIR = path.join(HOME, 'claude-dir');
const PORT = Number(process.env.PORT) || 4488;
const HOST = '127.0.0.1';

// ---- bootstrap the fixture filesystem (idempotent) ---------------------------
// The New-session picker reads cockpit projects from PROJECTS_ROOT subdirs; the
// Resume picker + project "last used" times read canned transcripts from
// CLAUDE_DIR/projects. Git does not track empty dirs, so the launcher recreates
// everything it needs and stamps transcript mtimes to "now" for stable time-bands.
function ensureFixtureHome() {
  for (const proj of ['alpha', 'beta', 'gamma']) {
    fs.mkdirSync(path.join(PROJECTS_ROOT, proj), { recursive: true });
  }
  fs.mkdirSync(path.join(PROJECTS_ROOT, '_temporary-sessions', 'quick-experiment'), { recursive: true });
  // A canned TODO.md so the focused session's TODO.MD panel renders real content.
  fs.writeFileSync(path.join(PROJECTS_ROOT, 'alpha', 'TODO.md'), ALPHA_TODO_MD);

  const seedDir = path.join(CLAUDE_DIR, 'projects', 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  const proj = (name) => path.join(PROJECTS_ROOT, name);
  const transcripts = {
    'a1.jsonl': [
      { cwd: proj('alpha'), type: 'ai-title', aiTitle: 'Add a dark-mode toggle' },
      { type: 'user', message: { role: 'user', content: 'Add a dark-mode toggle to the settings panel.' } },
    ],
    'a2.jsonl': [
      { cwd: proj('alpha'), type: 'ai-title', aiTitle: 'Audit settings persistence' },
      { type: 'user', message: { role: 'user', content: 'Check that settings persist across reloads.' } },
    ],
    'b1.jsonl': [
      { cwd: proj('beta'), type: 'ai-title', aiTitle: 'Fix the flaky transcript test' },
      { type: 'user', message: { role: 'user', content: 'The transcript test fails intermittently.' } },
    ],
    't1.jsonl': [
      { cwd: path.join(PROJECTS_ROOT, '_temporary-sessions', 'quick-experiment'), type: 'user', message: { role: 'user', content: 'quick scratch calculation' } },
    ],
  };
  const now = new Date();
  for (const [name, records] of Object.entries(transcripts)) {
    const file = path.join(seedDir, name);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.utimesSync(file, now, now); // stamp to "now" so the pickers' time-bands are stable per run
  }
}

ensureFixtureHome();

const { server, registry } = createApp({
  spawnDriver: (cwd, id, opts) => makeFixtureDriver(cwd, id, opts),
  projectsRoot: PROJECTS_ROOT,
  claudeDir: CLAUDE_DIR,
  openInExplorer: () => {}, // never launch a real Explorer window from the fixture
  openFile: () => {},
  dirExists: () => true,
});

server.listen(PORT, HOST, () => {
  // Seed the canned sessions once the server is up.
  const topicsDir = path.join(CLAUDE_DIR, 'topics');
  fs.mkdirSync(topicsDir, { recursive: true });
  for (const s of SESSIONS) {
    const pub = registry.create(s.cwd, { script: s.script, interaction: s.interaction, exit: s.exit, usage: s.usage, ctx: s.ctx });
    // The topic poll reads <claudeDir>/topics/<ccSessionId>.json, so write the
    // canned topics under the id the registry just assigned (and would otherwise
    // overwrite them with []).
    if (s.topics) {
      fs.writeFileSync(path.join(topicsDir, `${pub.ccSessionId}.json`),
        JSON.stringify({ session_id: pub.ccSessionId, topics: s.topics }, null, 2));
    }
  }
  console.log(`gui-map fixture listening on http://${HOST}:${PORT} (${SESSIONS.length} canned sessions)`);
});
