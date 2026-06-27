// server/index.js
const { createApp } = require('./app');
const { spawnSdk } = require('./sdk');

const PORT = Number(process.env.PORT) || 4477;
const HOST = '127.0.0.1';

// Each session is driven by a durable streaming Agent SDK query() (server/sdk.js),
// authenticated on the user's own Claude Code subscription. No hook settings are
// injected — session state and the conversation come from the SDK message stream.
const { server } = createApp({
  spawnDriver: (cwd, id, opts = {}) => spawnSdk(cwd, id, opts),
});
server.listen(PORT, HOST, () => {
  console.log(`cc-cockpit listening on http://${HOST}:${PORT}`);
});
