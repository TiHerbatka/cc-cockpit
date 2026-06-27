// server/pty.js
const pty = require('node-pty');
const fs = require('node:fs');
const path = require('node:path');

// node-pty's Windows PATH search (path_util.cc get_shell_path) checks each PATH
// directory for the command name *exactly as given* — it does NOT apply PATHEXT.
// So a bare `claude` fails ("File not found:") because the real file is
// `claude.exe`. Resolve the command to a concrete on-disk path ourselves,
// trying PATHEXT extensions, before handing it to node-pty. Absolute paths and
// non-Windows platforms are returned unchanged (node-pty handles those fine).
function resolveExecutable(command) {
  if (path.isAbsolute(command)) return command;
  if (process.platform !== 'win32') return command;
  if (command.includes('/') || command.includes('\\')) return command; // explicit relative path

  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasExt = path.extname(command) !== '';
  const dirs = (process.env.Path || process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    const base = path.join(dir, command);
    const candidates = hasExt ? [base] : [base, ...exts.map((e) => base + e)];
    for (const cand of candidates) {
      try {
        if (fs.statSync(cand).isFile()) return cand;
      } catch {
        // not here; keep looking
      }
    }
  }
  return command; // not found — let node-pty surface its own error
}

// When the cockpit server is itself launched from inside a Claude Code session,
// Claude Code injects markers into the environment that identify *this* process
// as part of that (parent) session. The critical one is
// CLAUDE_CODE_CHILD_SESSION=1: a claude that sees it treats itself as a nested
// child session and writes NO transcript to ~/.claude/projects. Copying the whole
// process.env into each spawn leaked that marker, so cockpit sessions never
// persisted (no Resume discovery, projects "never used", temp names never
// resolved — TODO B2). Scrub the parent-session env so every spawned claude
// starts like a fresh top-level launch. We strip CLAUDECODE, anything in
// Claude Code's CLAUDE_CODE_* namespace (session id, entrypoint, exec path, the
// child-session flag, and any future additions), plus the parent's runtime
// context (CLAUDE_EFFORT, AI_AGENT) that should not leak into an independent
// session. The cockpit's own CC_COCKPIT_* vars use a separate namespace and are
// added after the scrub.
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

// Build the (file, args, env) for a claude spawn. Pure + exported so the arg/env
// composition is testable without spawning a process. Adds --settings (to inject
// cockpit hooks alongside the user's) and CC_COCKPIT_* env (so the hook can call
// back, correlated to this session).
function buildSpawn({ command = 'claude', args = [], settingsPath, sessionId, port, resumeId, ccSessionId } = {}) {
  const finalArgs = [...args];
  // A deterministic --session-id lets the cockpit locate the session's transcript
  // (<ccSessionId>.jsonl) to tail for GUI mode. Fresh sessions only — a --resume
  // carries its own id, so the two are mutually exclusive.
  if (ccSessionId && !resumeId) finalArgs.push('--session-id', ccSessionId);
  if (resumeId) finalArgs.push('--resume', resumeId);
  if (settingsPath) finalArgs.push('--settings', settingsPath);
  const env = scrubParentClaudeEnv({ ...process.env });
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

module.exports = { spawnClaude, resolveExecutable, buildSpawn, scrubParentClaudeEnv };
