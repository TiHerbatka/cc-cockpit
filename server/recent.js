// server/recent.js
// Scans Claude Code's on-disk session history and returns recent sessions
// grouped by folder. Pure (cwd/title read from inside each jsonl; never from the
// lossy folder name). Subagent transcripts live in subdirectories, so a
// top-level .jsonl filter excludes them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WINDOW_MS = { day: 24 * 3600e3, '3d': 72 * 3600e3, week: 7 * 24 * 3600e3, all: Infinity };

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function userText(message) {
  if (!message) return '';
  let c = message.content;
  if (Array.isArray(c)) c = c.map((x) => (x && x.type === 'text' ? x.text : '')).join(' ');
  return typeof c === 'string' ? c : '';
}

function parseSession(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return null; }
  let cwd = null; let aiTitle = null; let firstUser = null;
  for (const ln of lines) {
    if (!ln) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (!cwd && o.cwd) cwd = o.cwd;
    if (!aiTitle && o.type === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
    if (!firstUser && o.type === 'user') { const t = userText(o.message); if (t && !t.startsWith('<')) firstUser = t; }
    if (cwd && aiTitle) break;
  }
  const title = (aiTitle || firstUser || '(untitled)').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { cwd, title, aiTitle };
}

function samePath(a, b) {
  if (!a || !b) return false;
  try {
    const na = path.resolve(a);
    const nb = path.resolve(b);
    return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
  } catch { return false; }
}

// The Claude Code auto-title (aiTitle) for the most-recent session whose recorded
// cwd matches `cwd`, or null. Used to label live temp sessions. Bounded to files
// touched recently (a live session's transcript is being written now) to keep the
// scan cheap.
function titleForCwd(cwd, { claudeDir = defaultClaudeDir(), now = Date.now() } = {}) {
  if (!cwd) return null;
  const projectsDir = path.join(claudeDir, 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return null; }
  const cutoff = now - 12 * 3600e3;
  let best = null;
  for (const pd of projectDirs) {
    const dir = path.join(projectsDir, pd.name);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < cutoff) continue;
      const meta = parseSession(full);
      if (!meta || !meta.aiTitle || !samePath(meta.cwd, cwd)) continue;
      if (!best || st.mtimeMs > best.mtime) best = { mtime: st.mtimeMs, aiTitle: meta.aiTitle };
    }
  }
  return best ? best.aiTitle : null;
}

function listRecent(window, { claudeDir = defaultClaudeDir(), now = Date.now() } = {}) {
  const span = WINDOW_MS[window] || WINDOW_MS.day;
  const cutoff = now - span;
  const projectsDir = path.join(claudeDir, 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return { window, groups: [] }; }

  const entries = [];
  for (const pd of projectDirs) {
    const dir = path.join(projectsDir, pd.name);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.mtimeMs < cutoff) continue;
      const meta = parseSession(full);
      if (!meta) continue;
      entries.push({
        id: f.replace(/\.jsonl$/, ''),
        cwd: meta.cwd,
        title: meta.title,
        lastActivity: new Date(st.mtimeMs).toISOString(),
        _mtime: st.mtimeMs,
      });
    }
  }

  const byCwd = new Map();
  for (const e of entries) {
    const key = e.cwd || '(unknown)';
    if (!byCwd.has(key)) byCwd.set(key, []);
    byCwd.get(key).push(e);
  }
  const groups = [...byCwd.entries()].map(([cwd, sessions]) => {
    sessions.sort((a, b) => b._mtime - a._mtime);
    return { cwd, sessions: sessions.map(({ _mtime, ...s }) => s) };
  });
  groups.sort((a, b) => Date.parse(b.sessions[0].lastActivity) - Date.parse(a.sessions[0].lastActivity));
  return { window, groups };
}

// Cheap cwd read: the cwd is in the first record, so read only the first chunk
// instead of the whole (possibly large) transcript.
function cwdOf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const ln of buf.toString('utf8', 0, n).split('\n')) {
      if (!ln.trim()) continue;
      let o; try { o = JSON.parse(ln); } catch { continue; } // a truncated last line is fine
      if (o && o.cwd) return o.cwd;
    }
  } catch { /* ignore */ } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } } }
  return null;
}

// For each given project path, the ISO time of the most recent Claude Code session
// whose cwd is inside it (the project's "last used" time). Returns Map<path, iso>;
// paths with no sessions are simply absent.
function lastActivityByPath(paths, { claudeDir = defaultClaudeDir() } = {}) {
  const out = new Map();
  if (!paths || !paths.length) return out;
  const norm = paths.map((p) => ({ p, n: path.resolve(p) }));
  const projectsDir = path.join(claudeDir, 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return out; }
  const maxMs = new Map();
  for (const pd of projectDirs) {
    const dir = path.join(projectsDir, pd.name);
    let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      const cwd = cwdOf(full);
      if (!cwd) continue;
      const c = path.resolve(cwd);
      for (const { p, n } of norm) {
        const rel = path.relative(n, c);
        const under = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        if (under && st.mtimeMs > (maxMs.get(p) || 0)) maxMs.set(p, st.mtimeMs);
      }
    }
  }
  for (const [p, ms] of maxMs) out.set(p, new Date(ms).toISOString());
  return out;
}

module.exports = { listRecent, defaultClaudeDir, titleForCwd, lastActivityByPath };
