// server/index.js
const fs = require('node:fs');
const { createApp } = require('./app');
const { spawnSdk } = require('./sdk');

const PORT = Number(process.env.PORT) || 4477;
const HOST = '127.0.0.1';

// Each session is driven by a durable streaming Agent SDK query() (server/sdk.js),
// authenticated on the user's own Claude Code subscription. No hook settings are
// injected — session state and the conversation come from the SDK message stream.
const { server } = createApp({
  spawnDriver: (cwd, id, opts = {}) => spawnSdk(cwd, id, opts),
  // Pre-flight guard: a resume/create whose working folder was removed must fail
  // with a truthful cockpit error rather than the SDK's misleading "binary failed
  // to launch / libc" message (a missing cwd makes the child spawn ENOENT).
  dirExists: (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } },
});
server.listen(PORT, HOST, () => {
  console.log(`cc-cockpit listening on http://${HOST}:${PORT}`);
});
