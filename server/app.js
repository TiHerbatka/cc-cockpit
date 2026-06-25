// server/app.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');
const { SessionRegistry } = require('./sessions');
const projects = require('./projects');
const recent = require('./recent');
const { findTranscriptPath, createTailer } = require('./transcript');
const { normalize } = require('./normalize');
const { readTopics } = require('./topics');

const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Open a folder in the OS file manager (Windows Explorer). explorer.exe can exit
// non-zero even on success, so fire-and-forget and swallow errors. Injectable so
// tests don't actually launch a window.
function defaultOpenInExplorer(dir) {
  if (!dir) return;
  try { spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
}
// Open a file with the OS default app. `start` (via cmd) honors the file
// association; the empty "" is the window-title arg `start` expects. Injectable.
function defaultOpenFile(file) {
  if (!file) return;
  try { spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function createApp({ spawnPty, publicDir = DEFAULT_PUBLIC_DIR, projectsRoot = projects.projectsRoot(), claudeDir, openInExplorer = defaultOpenInExplorer, openFile = defaultOpenFile } = {}) {
  const registry = new SessionRegistry({ spawnPty, projectsRoot });

  // GUI-native permissions, parity model: Claude ALWAYS prompts natively in the PTY
  // (so the terminal shows it), and the GUI mirrors+answers. A non-blocking
  // PreToolUse hook POSTs each tool's details to /tool-pending; we remember the
  // latest per session so that when the native prompt fires (Notification ->
  // /hook needs-you) we can broadcast a permission-request carrying the tool info.
  // The GUI answers by sending the matching keystroke (1/2/3) to the same PTY.
  const lastTool = new Map(); // sessionId -> { toolName, toolInput }

  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'POST' && urlPath === '/hook') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // bound the body
      });
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
        if (m && typeof m.id === 'string') {
          if (m.state === 'working') registry.markWorking(m.id);
          else if (m.state === 'idle') registry.markIdle(m.id);
          else if (m.state === 'needs-you') {
            registry.signalWaiting(m.id);
            // A native permission prompt is up. Mirror it to the GUI with the
            // most-recent tool details so the pane can show Allow/Deny. The prompt
            // also remains in the terminal (parity); answering in either reflects
            // in the same PTY.
            const lt = lastTool.get(m.id) || {};
            broadcast({ type: 'permission-request', id: m.id, tool: lt.toolName || null, input: lt.toolInput || null });
          }
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // Non-blocking notice from the PreToolUse hook: remember the tool about to run
    // for this session, so a subsequent native permission prompt can be mirrored to
    // the GUI with its details. Returns immediately (the hook never blocks).
    if (req.method === 'POST' && urlPath === '/tool-pending') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
        if (m && typeof m.sessionId === 'string') lastTool.set(m.sessionId, { toolName: m.toolName, toolInput: m.toolInput });
        res.writeHead(204);
        res.end();
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/projects') {
      const list = projects.listProjects(projectsRoot);
      const activity = recent.lastActivityByPath(list.map((p) => p.path), { claudeDir });
      const withActivity = list.map((p) => ({ ...p, lastActivity: activity.get(p.path) || null }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ projects: withActivity }));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/projects') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let m;
        try { m = JSON.parse(body); } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad json' })); return; }
        try {
          const created = projects.createProject(m && m.name, projectsRoot);
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify(created));
        } catch (e) {
          res.writeHead(e.status || 400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/recent') {
      const window = new URL(req.url, 'http://localhost').searchParams.get('window') || 'day';
      const data = recent.listRecent(window, { claudeDir });
      for (const g of data.groups) {
        g.temp = projects.isTemp(g.cwd, projectsRoot);
        g.cockpit = !g.temp && projects.isUnderProjectsRoot(g.cwd, projectsRoot); // cockpit project (not temp)
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(publicDir, path.normalize(urlPath));
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(buf);
    });
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set();
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === 1) c.send(text);
  };

  registry.on('output', (id, data) => broadcast({ type: 'output', id, data }));
  registry.on('sessions', () => broadcast({ type: 'sessions', sessions: registry.list() }));

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'sessions', sessions: registry.list() }));

    // GUI mode: per-socket tailing of a watched session's transcript. The
    // accumulated records are re-normalized and pushed as a snapshot on each new
    // batch. The transcript file may not exist yet for a brand-new session, so we
    // resolve it eagerly and fall back to a short poll until it appears.
    const watched = new Map(); // sessionId -> { stop() }
    const startWatch = (id) => {
      if (watched.has(id)) return;
      const s = registry.get(id);
      if (!s || !s.ccSessionId) return;
      const records = [];
      let tailer = null;
      let poll = null;
      const send = () => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'gui-snapshot', id, model: normalize(records) })); };
      const tryResolve = () => {
        if (tailer) return;
        const p = findTranscriptPath(s.ccSessionId, { claudeDir });
        if (!p) return;
        tailer = createTailer(p, { onRecords: (recs) => { records.push(...recs); send(); } });
        tailer.start(); // initial read is synchronous -> snapshot fires now if content exists
        if (poll) { clearInterval(poll); poll = null; }
      };
      send();        // immediate (likely empty) snapshot so the pane shows "waiting…"
      tryResolve();
      if (!tailer) { poll = setInterval(tryResolve, 300); if (poll.unref) poll.unref(); }
      watched.set(id, { stop() { if (tailer) tailer.stop(); if (poll) clearInterval(poll); } });
    };
    const stopWatch = (id) => {
      const w = watched.get(id);
      if (!w) return;
      w.stop();
      watched.delete(id);
    };

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'create') {
        try { registry.create(m.cwd); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'create-temp') {
        // One-off session: make a fresh subfolder under the temp root and spawn there.
        try { const t = projects.createTempSession(projectsRoot); registry.create(t.path); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'input') {
        registry.write(m.id, m.data);
      } else if (m.type === 'resize') {
        registry.resize(m.id, m.cols, m.rows);
      } else if (m.type === 'attach') {
        registry.acknowledge(m.id);
        ws.send(JSON.stringify({ type: 'attached', id: m.id, buffer: registry.bufferOf(m.id) }));
      } else if (m.type === 'peek') {
        // Side-effect-free read for the passive preview: return the current
        // buffer WITHOUT acknowledging or focusing, so a peek never clears a
        // needs-you/your-move signal or changes state. Include the PTY grid size
        // so the preview can size its terminal to match (else a TUI's
        // size-specific stream renders garbled). Live updates ride the existing
        // per-session 'output' broadcast.
        const sz = registry.sizeOf(m.id);
        ws.send(JSON.stringify({ type: 'peeked', id: m.id, buffer: registry.bufferOf(m.id), cols: sz.cols, rows: sz.rows }));
      } else if (m.type === 'remove') {
        registry.remove(m.id);
      } else if (m.type === 'rename') {
        registry.rename(m.id, m.name);
      } else if (m.type === 'open-folder') {
        const s = registry.get(m.id);
        if (s) openInExplorer(s.cwd);
      } else if (m.type === 'open-file') {
        const s = registry.get(m.id);
        if (s) {
          const name = m.which === 'todo' ? 'TODO.md' : 'local-docs.md';
          const file = path.join(s.cwd, name);
          if (fs.existsSync(file)) openFile(file);
          else ws.send(JSON.stringify({ type: 'error', message: `${name} not found in ${s.cwd}` }));
        }
      } else if (m.type === 'resume') {
        try { registry.create(m.cwd, { resumeId: m.id }); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'gui-attach') {
        startWatch(m.id);
      } else if (m.type === 'gui-detach') {
        stopWatch(m.id);
      } else if (m.type === 'set-mode') {
        registry.setMode(m.id, m.mode);
      } else if (m.type === 'permission-answer') {
        // Answer the native permission prompt by sending its keystroke to the PTY
        // (1=Allow, 2=Allow+don't-ask, 3=Deny). The terminal reflects the same
        // change — full parity. Only digits/Esc are accepted.
        if (m.id && (m.key === '1' || m.key === '2' || m.key === '3' || m.key === '')) {
          registry.write(m.id, m.key);
        }
      }
    });
    ws.on('close', () => { for (const id of [...watched.keys()]) stopWatch(id); clients.delete(ws); });
  });

  // Fill in Claude Code's auto-title for live temp sessions (the label starts as
  // the timestamp-folder placeholder and switches to the real title once CC writes
  // it). Low-frequency, only for not-yet-titled temp sessions; unref'd so it never
  // holds the process (or tests) open, and cleared when the server closes.
  const titled = new Set();
  const titlePoll = setInterval(() => {
    for (const s of registry.list()) {
      if (!s.temp || titled.has(s.id)) continue;
      try {
        const t = recent.titleForCwd(s.cwd, { claudeDir });
        if (t) { registry.setAutoTitle(s.id, t); titled.add(s.id); }
      } catch { /* ignore scan errors */ }
    }
  }, 4000);
  if (titlePoll.unref) titlePoll.unref();
  server.on('close', () => clearInterval(titlePoll));

  // Poll each live session's topic file (~/.claude/topics/<ccSessionId>.json) and
  // push it onto the session (setTopics only broadcasts on change). Low-frequency;
  // unref'd so it never holds the process/tests open.
  const topicsPoll = setInterval(() => {
    for (const s of registry.list()) {
      try { registry.setTopics(s.id, readTopics(s.ccSessionId, { claudeDir })); } catch { /* ignore */ }
    }
  }, 1500);
  if (topicsPoll.unref) topicsPoll.unref();
  server.on('close', () => clearInterval(topicsPoll));

  return { server, registry, wss };
}

module.exports = { createApp };
