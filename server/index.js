// server/index.js
const { createApp } = require('./app');
const { spawnClaude } = require('./pty');
const { writeHookSettings } = require('./hooks');

const PORT = Number(process.env.PORT) || 4477;
const HOST = '127.0.0.1';

// Generate the --settings file (embeds the absolute hook-script path) once at startup.
const settingsPath = writeHookSettings();

const { server } = createApp({
  spawnPty: (cwd, sessionId, opts = {}) => spawnClaude(cwd, { settingsPath, sessionId, port: PORT, ...opts }),
});
server.listen(PORT, HOST, () => {
  console.log(`cc-cockpit listening on http://${HOST}:${PORT}`);
});
