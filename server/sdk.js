// server/sdk.js
// The SDK session driver: the counterpart to server/pty.js for the Agent-SDK
// substrate. Each cockpit session owns one durable streaming query() (a child
// claude the SDK spawns and owns over stdio), authenticated on the user's own
// Claude Code subscription. This module owns: subscription-only env
// construction, the streaming-input queue, the posture-A permission callback,
// the raw-message event source, and teardown.
const { scrubParentClaudeEnv } = require('./pty');

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

module.exports = { sdkMessageToRecords, scrubChildEnv };
