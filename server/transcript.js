// server/transcript.js
// Locate a session's transcript JSONL and tail it incrementally. Used by GUI
// mode to turn a live Claude Code session's on-disk transcript into a stream of
// records. Pure-ish: fs is injectable so the tailer is unit-testable.
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Locate <ccSessionId>.jsonl under <claudeDir>/projects/*/. The basename is the
// exact session id, so this is a cheap one-level scan of the project folders.
function findTranscriptPath(ccSessionId, { claudeDir = defaultClaudeDir(), fs = nodeFs } = {}) {
  if (!ccSessionId) return null;
  const projectsDir = path.join(claudeDir, 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return null; }
  for (const d of dirs) {
    const f = path.join(projectsDir, d.name, `${ccSessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Incremental tailer: reads the whole file once (initial batch), then on each
// tick reads only appended bytes, buffering an incomplete trailing line until
// its newline arrives. Tolerates the file not existing yet (waits and retries)
// and skips unparseable lines. `onRecords(records, { initial })` fires per batch.
function createTailer(filePath, { onRecords, intervalMs = 250, fs = nodeFs } = {}) {
  let offset = 0;
  let carry = '';
  let timer = null;
  let started = false;        // have we emitted the initial batch yet?

  const tick = () => {
    let st;
    try { st = fs.statSync(filePath); } catch { return; }   // not created yet
    if (st.size < offset) { offset = 0; carry = ''; started = false; } // truncated/rotated
    if (st.size <= offset) { started = true; return; }      // nothing new

    let fd;
    let chunk = '';
    try {
      fd = fs.openSync(filePath, 'r');
      const len = st.size - offset;
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, offset);
      offset += n;
      chunk = buf.toString('utf8', 0, n);
    } catch { return; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } } }

    carry += chunk;
    const parts = carry.split('\n');
    carry = parts.pop();                  // trailing element is the incomplete remainder
    const records = [];
    for (const ln of parts) {
      const s = ln.trim();
      if (!s) continue;
      try { records.push(JSON.parse(s)); } catch { /* skip unparseable */ }
    }
    const wasInitial = !started;
    started = true;
    if (records.length && typeof onRecords === 'function') onRecords(records, { initial: wasInitial });
  };

  return {
    start() { tick(); timer = setInterval(tick, intervalMs); if (timer.unref) timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { findTranscriptPath, createTailer, defaultClaudeDir };
