// server/app.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');
const { SessionRegistry } = require('./sessions');
const projects = require('./projects');
const recent = require('./recent');
const { readTopics } = require('./topics');
const { findTranscriptPath } = require('./transcript');
const uploads = require('./uploads');

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

function createApp({ spawnDriver, publicDir = DEFAULT_PUBLIC_DIR, projectsRoot = projects.projectsRoot(), claudeDir, openInExplorer = defaultOpenInExplorer, openFile = defaultOpenFile } = {}) {
  // On resume, read the prior transcript so the registry can seed the model.
  const loadResumeRecords = (ccSessionId) => {
    try {
      const p = findTranscriptPath(ccSessionId, { claudeDir });
      if (!p) return [];
      const records = [];
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim(); if (!t) continue;
        try { records.push(JSON.parse(t)); } catch { /* skip unparseable */ }
      }
      return records;
    } catch { return []; }
  };
  const registry = new SessionRegistry({ spawnDriver, projectsRoot, loadResumeRecords });

  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

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

    if (req.method === 'POST' && urlPath === '/api/upload-image') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const fail = (code, error) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error })); };
        let m; try { m = JSON.parse(body); } catch { return fail(400, 'bad json'); }
        const s = registry.get(m && m.id);
        if (!s) return fail(400, 'unknown session');
        if (!uploads.isImageMime(m.mime)) return fail(400, 'not an image');
        const buf = Buffer.from(String(m.dataBase64 || ''), 'base64');
        if (!buf.length) return fail(400, 'no data');
        if (buf.length > uploads.MAX_BYTES) return fail(413, 'too large');
        try {
          const dir = path.join(s.cwd, uploads.UPLOAD_DIRNAME);
          fs.mkdirSync(dir, { recursive: true });
          const ext = uploads.extFromMime(m.mime);
          let desired = uploads.safeName(m.name);
          if (desired && !path.extname(desired)) desired += ext;
          if (!desired) desired = uploads.buildAutoName(new Date(), ext);
          const name = uploads.resolveUploadName(dir, desired);
          const full = path.join(dir, name);
          fs.writeFileSync(full, buf);
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ path: full, name }));
        } catch (e) { fail(500, String(e && e.message || e)); }
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/recent') {
      const window = new URL(req.url, 'http://localhost').searchParams.get('window') || 'day';
      const data = recent.listRecent(window, { claudeDir });
      for (const g of data.groups) {
        g.temp = projects.isTemp(g.cwd, projectsRoot);
        g.cockpit = !g.temp && projects.isUnderProjectsRoot(g.cwd, projectsRoot);
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

  // The SDK stream drives the GUI: model deltas, per-session meta (mode/usage),
  // the session list, and surfaced driver errors.
  registry.on('delta', (id, ops) => broadcast({ type: 'gui-delta', id, ops }));
  registry.on('meta', (id, meta) => broadcast({ type: 'meta', id, ...meta }));
  registry.on('sessions', () => broadcast({ type: 'sessions', sessions: registry.list() }));
  registry.on('session-error', (id, message) => broadcast({ type: 'error', message }));
  registry.on('permission', (id, req) => broadcast({ type: 'permission-request', id, ...req }));

  // Send the focused session's current model as a full snapshot (attach/re-point).
  const sendSnapshot = (ws, id) => {
    const model = registry.modelOf(id);
    if (model && ws.readyState === 1) ws.send(JSON.stringify({ type: 'gui-snapshot', id, model }));
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'sessions', sessions: registry.list() }));

    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'create') {
        try { registry.create(m.cwd); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'create-temp') {
        try { const t = projects.createTempSession(projectsRoot); registry.create(t.path); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'resume') {
        try { registry.create(m.cwd, { resumeId: m.id }); }
        catch (e) { ws.send(JSON.stringify({ type: 'error', message: String(e && e.message || e) })); }
      } else if (m.type === 'send') {
        registry.send(m.id, m.text);
      } else if (m.type === 'permission-answer') {
        registry.answerPermission(m.id, m.toolUseId, m.decision);
      } else if (m.type === 'interrupt') {
        registry.interrupt(m.id);
      } else if (m.type === 'set-permission-mode') {
        registry.setPermissionMode(m.id, m.mode);
      } else if (m.type === 'set-model') {
        registry.setModel(m.id, m.model);
      } else if (m.type === 'attach') {
        registry.acknowledge(m.id);
        sendSnapshot(ws, m.id);
        // Re-send a still-pending permission so focusing a waiting session shows it.
        const pend = registry.pendingPermissionOf(m.id);
        if (pend && ws.readyState === 1) ws.send(JSON.stringify({ type: 'permission-request', id: m.id, ...pend }));
      } else if (m.type === 'gui-attach') {
        sendSnapshot(ws, m.id);
      } else if (m.type === 'gui-detach') {
        /* deltas are broadcast; nothing to tear down per-socket */
      } else if (m.type === 'peek') {
        // Side-effect-free read for the quick preview: the session's current model
        // WITHOUT acknowledging or focusing it. Live updates ride the gui-delta
        // broadcast (the client filters by preview id).
        const model = registry.modelOf(m.id);
        if (model) ws.send(JSON.stringify({ type: 'peeked', id: m.id, model }));
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
      } else if (m.type === 'open-image') {
        const s = registry.get(m.id);
        if (s && typeof m.path === 'string' && uploads.isWithinUploads(s.cwd, m.path) && fs.existsSync(m.path)) {
          openFile(m.path);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'cannot open image' }));
        }
      }
    });
    ws.on('close', () => { clients.delete(ws); });
  });

  // Fill in Claude Code's auto-title for live temp sessions (label starts as the
  // timestamp-folder placeholder, switches to the real title once CC writes it).
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

  // Poll each live session's topic file and push it onto the session.
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
