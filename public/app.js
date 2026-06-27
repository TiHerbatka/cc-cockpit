// Globals from vendor scripts: Terminal (xterm), FitAddon
const ws = new WebSocket(`ws://${location.host}`);
const term = new Terminal({ cursorBlink: true, fontSize: 13, theme: { background: '#1e1e1e' } });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('terminal'));
fit.fit();

// Tell the server the focused session's PTY to match the rendered terminal
// size. Without this the PTY stays at its spawn default (120x30) while xterm
// renders at the window size, so full-screen TUIs (like claude) paint for the
// wrong width and ghost/overlap on redraw.
function sendResize() {
  if (focusedId && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'resize', id: focusedId, cols: term.cols, rows: term.rows }));
  }
}
window.addEventListener('resize', () => {
  fit.fit(); sendResize();
  if (previewTerm && previewCols) { fitPreviewFont(previewCols, previewRows); previewTerm.resize(previewCols, previewRows); }
});

let sessions = [];
let focusedId = null;

// Passive-preview state: a read-only mirror of any session (see openPreview).
let previewId = null;
let previewTerm = null;
let previewOverlay = null;
let previewCols = 0;
let previewRows = 0;
let ctxMenuEl = null;

const listEl = document.getElementById('session-list');
const errorEl = document.getElementById('error');

// ---- GUI error center: every client-side error lands in a toggleable list ----
const errorCenter = (() => {
  const errors = [];
  const toggleBtn = document.getElementById('error-toggle');
  const panel = document.getElementById('error-panel');
  const listEl2 = document.getElementById('error-list');
  const countEl = document.getElementById('error-count');
  const count2El = document.getElementById('error-count2');
  const render = () => {
    if (countEl) countEl.textContent = String(errors.length);
    if (count2El) count2El.textContent = String(errors.length);
    if (toggleBtn) toggleBtn.hidden = errors.length === 0;
    if (errors.length === 0 && panel) panel.hidden = true;
    if (!listEl2) return;
    listEl2.innerHTML = '';
    for (let i = errors.length - 1; i >= 0; i--) { // newest first
      const e = errors[i];
      const li = document.createElement('li');
      const time = document.createElement('span'); time.className = 'err-time'; time.textContent = new Date(e.ts).toLocaleTimeString();
      const msg = document.createElement('span'); msg.className = 'err-msg'; msg.textContent = e.message;
      li.append(time, msg);
      if (e.stack) {
        const sb = document.createElement('button'); sb.className = 'err-stack-btn'; sb.textContent = 'stack';
        sb.onclick = () => openModal((box) => { box.innerHTML = '<h2>Error stack trace</h2><pre class="err-stack"></pre>'; box.querySelector('.err-stack').textContent = e.stack; });
        li.appendChild(sb);
      }
      listEl2.appendChild(li);
    }
  };
  if (toggleBtn) toggleBtn.onclick = () => { panel.hidden = !panel.hidden; };
  const closeBtn = document.getElementById('error-close'); if (closeBtn) closeBtn.onclick = () => { panel.hidden = true; };
  const clearBtn = document.getElementById('error-clear'); if (clearBtn) clearBtn.onclick = () => { errors.length = 0; render(); };
  return {
    add(message, stack) {
      errors.push({ ts: Date.now(), message: String(message == null ? 'Unknown error' : message), stack: stack || null });
      if (errors.length > 200) errors.shift();
      render();
    },
  };
})();
window.addEventListener('error', (e) => errorCenter.add(e.message || (e.error && e.error.message), e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; errorCenter.add(r && r.message ? r.message : String(r), r && r.stack); });

// ---- GUI mode (per-session) -------------------------------------------------
const headLabel = document.getElementById('head-label');
const headState = document.getElementById('head-state');
const guiPaneEl = document.getElementById('gui-pane');
let guiWatchedId = null;                 // session currently gui-attached

// One GUI controller, mounted once; re-pointed at the focused session.
const gui = mountGui(guiPaneEl, {
  onSend: (text) => composeSend(text),
  onOpenImage: (p) => { if (focusedId) ws.send(JSON.stringify({ type: 'open-image', id: focusedId, path: p })); },
  onUpload: async (file) => {
    if (!focusedId) { errorCenter.add('Upload: no active session'); throw new Error('no session'); }
    let dataBase64;
    try { dataBase64 = await readFileAsBase64(file); }
    catch (e) { errorCenter.add('Upload: failed to read file — ' + (e && e.message || e)); throw e; }
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: focusedId, name: file.name || undefined, mime: file.type, dataBase64 }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { errorCenter.add('Upload: ' + (json.error || 'HTTP ' + res.status)); throw new Error('upload failed'); }
    return json;
  },
});

// Send a user turn as ONE structured message over the SDK channel — no keystroke
// emulation, no carriage return, no nudge timer (the old PTY race is gone).
function composeSend(text) {
  if (!focusedId) return;
  ws.send(JSON.stringify({ type: 'send', id: focusedId, text }));
}

// The focused session's render model, kept in sync from a gui-snapshot (full) plus
// gui-delta ops; re-rendered via the GUI controller.
let guiModel = null;
function applyDelta(model, ops) {
  for (const op of ops || []) {
    if (op.op === 'append') model.items.push(op.item);
    else if (op.op === 'update') { const it = model.items.find((i) => i.kind === 'tool' && i.id === op.id); if (it) Object.assign(it, op.patch); }
    else if (op.op === 'title') model.title = op.title;
    else if (op.op === 'status') model.status = op.status;
  }
}

// Read a File/Blob as a base64 string (the raw payload, without the data-URL prefix).
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve(reader.result.split(',')[1]); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function detachGui() {
  if (guiWatchedId) { ws.send(JSON.stringify({ type: 'gui-detach', id: guiWatchedId })); guiWatchedId = null; }
  gui.clear();
}

// SDK sessions are GUI-only this phase (raw terminal returns as a deliberate
// option later). Always mount the GUI pane and attach its live stream.
function applyMode(id) {
  if (id !== focusedId) return;
  guiPaneEl.hidden = false;
  if (guiWatchedId !== id) { detachGui(); ws.send(JSON.stringify({ type: 'gui-attach', id })); guiWatchedId = id; }
  gui.focusCompose();
}

function updateHead() {
  const s = sessions.find((x) => x.id === focusedId);
  headLabel.textContent = s ? s.label : '';
  headState.className = 'icon ' + (s ? s.status : '');
  headState.textContent = s ? (STATE_ICON[s.status] || '○') : '';
  // Push the focused session's tracked topics to the GUI panel.
  gui.setTopics(s ? s.topics : []);
}

// ---- Chips: Claude permission mode + usage, re-sourced from the SDK stream ----
const claudeModeEl = document.getElementById('claude-mode');
const interruptBtn = document.getElementById('interrupt-btn');
const usageEl = document.getElementById('usage-chip');
if (interruptBtn) interruptBtn.hidden = true; // graceful interrupt is a deferred control
// The mode chip comes from the init message's permission mode; usage from the
// result message's token totals. Both arrive as {type:'meta'} over the socket.
function renderMeta(meta) {
  if (meta.mode && claudeModeEl) claudeModeEl.textContent = meta.mode;
  if (meta.usage && usageEl) {
    const u = meta.usage;
    const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
    usageEl.textContent = `tok ${k(inTok)}↓ ${k(u.output_tokens || 0)}↑`;
  }
}
// Doc buttons: open the focused session's local-docs.md / TODO.md via the OS default app.
const openDocsBtn = document.getElementById('open-docs');
const openTodoBtn = document.getElementById('open-todo');
if (openDocsBtn) openDocsBtn.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'open-file', id: focusedId, which: 'docs' })); };
if (openTodoBtn) openTodoBtn.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'open-file', id: focusedId, which: 'todo' })); };

// Terminal mode returns as a deliberate option later; hide its switch for now.
const modeSwitchEl = document.getElementById('mode-switch');
if (modeSwitchEl) modeSwitchEl.hidden = true;

// Distinct shape per state (not just color); working spins, needs-you pulses.
const STATE_ICON = { working: '⚙︎', 'needs-you': '▲', 'your-move': '●', idle: '○', exited: '✕' };
const groupKey = (s) => (s.temp ? 'Temporary' : (s.project || 'Other'));

// Stable alphabetical order: groups by name (Other last), sessions by label then
// id. The order never changes when a session's state changes — only its icon does.
function render() {
  listEl.innerHTML = '';
  const groups = new Map();
  for (const s of sessions) {
    const k = groupKey(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) =>
      (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' })
      || a.id.localeCompare(b.id));
  }
  // Projects (alphabetical) first, then Temporary, then Other last.
  const rank = (k) => (k === 'Other' ? 2 : k === 'Temporary' ? 1 : 0);
  const keys = [...groups.keys()].sort((a, b) =>
    rank(a) - rank(b) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
  for (const key of keys) {
    const header = document.createElement('li');
    header.className = 'group-header';
    header.textContent = key;
    listEl.appendChild(header);
    for (const s of groups.get(key)) {
      const li = document.createElement('li');
      if (s.id === focusedId) li.classList.add('active');
      const icon = document.createElement('span');
      icon.className = `icon ${s.status}`;
      icon.textContent = STATE_ICON[s.status] || '○';
      const label = document.createElement('span');
      label.className = 'sess-label';
      label.textContent = s.label;
      const rm = document.createElement('button');
      rm.className = 'remove-btn';
      rm.textContent = '✕';
      rm.title = s.status === 'exited' ? 'Remove from cockpit' : 'Kill and remove';
      rm.onclick = (e) => { e.stopPropagation(); removeSession(s); };
      li.append(icon, label, rm);
      li.onclick = () => focus(s.id);
      li.oncontextmenu = (e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, s); };
      listEl.appendChild(li);
    }
  }
}

function removeSession(s) {
  if (s.status !== 'exited' && !confirm(`Kill session "${s.label}"? This ends the running Claude.`)) return;
  if (focusedId === s.id) { focusedId = null; term.reset(); detachGui(); guiPaneEl.hidden = true; updateHead(); }
  ws.send(JSON.stringify({ type: 'remove', id: s.id }));
}

function focus(id) {
  focusedId = id;
  errorEl.textContent = '';
  guiModel = null; // reset until the new session's snapshot arrives
  // attach acknowledges the session (clearing a your-move signal) and triggers a
  // gui-snapshot of its current model.
  ws.send(JSON.stringify({ type: 'attach', id }));
  render();
  updateHead();
  applyMode(id);
}

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'sessions') {
    sessions = m.sessions;
    if (!focusedId && sessions.length) focus(sessions[0].id);
    else { render(); updateHead(); }
  } else if (m.type === 'gui-snapshot' && m.id === focusedId) {
    guiModel = m.model;
    gui.update(guiModel);
  } else if (m.type === 'gui-delta' && m.id === focusedId) {
    if (guiModel) { applyDelta(guiModel, m.ops); gui.update(guiModel); }
  } else if (m.type === 'meta' && m.id === focusedId) {
    renderMeta(m);
  } else if (m.type === 'error') {
    errorEl.textContent = m.message;
    errorCenter.add('Server: ' + m.message);
  }
});
ws.addEventListener('error', () => errorCenter.add('WebSocket connection error'));
ws.addEventListener('close', () => errorCenter.add('WebSocket disconnected'));

function openModal(build) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal';
  overlay.appendChild(box);
  const close = () => {
    if (overlay.parentNode) document.body.removeChild(overlay);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  build(box, close);
}

// Project time bands for the New-session picker (last-used age); "Never used" is
// handled separately for projects that have no sessions yet.
const PROJECT_BANDS = [
  { label: 'Last 24 hours', max: 24 * 3600e3 },
  { label: '1–3 days ago', max: 72 * 3600e3 },
  { label: '3–7 days ago', max: 168 * 3600e3 },
  { label: 'Older', max: Infinity },
];

const WEEK_MS = 168 * 3600e3;
// Render a project as a clickable row.
function projectRow(p, startIn) {
  const b = document.createElement('button');
  b.className = 'project-row';
  b.innerHTML = '<span class="proj-row-name"></span><span class="proj-row-time"></span>';
  b.querySelector('.proj-row-name').textContent = p.name;
  b.querySelector('.proj-row-time').textContent = p.lastActivity ? relTime(p.lastActivity) : 'never';
  b.title = p.path;
  b.onclick = () => startIn(p.path);
  return b;
}

function openNewSessionPicker() {
  openModal(async (box, close) => {
    box.innerHTML =
      '<h2>New session</h2>' +
      '<div class="modal-toolbar">' +
        '<input class="modal-search" placeholder="Search projects by name or path…" />' +
        '<button class="older-toggle">Older than 7 days ▸</button>' +
      '</div>' +
      '<div class="resume-cols">Loading…</div>' +
      '<div class="modal-create"><input placeholder="new project name" /><button>Create &amp; start</button></div>' +
      '<button class="temp-btn">+ Temporary session</button>';
    const search = box.querySelector('.modal-search');
    const cols = box.querySelector('.resume-cols');
    const olderToggle = box.querySelector('.older-toggle');
    const input = box.querySelector('.modal-create input');
    const createBtn = box.querySelector('.modal-create button');
    const startIn = (cwd) => { ws.send(JSON.stringify({ type: 'create', cwd })); close(); };
    box.querySelector('.temp-btn').onclick = () => { ws.send(JSON.stringify({ type: 'create-temp' })); close(); };

    let projects = [];
    let showOlder = false;
    const bands3 = PROJECT_BANDS.slice(0, 3); // 24h / 1–3d / 3–7d
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const matches = projects.filter((p) =>
        !q || p.name.toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q));
      cols.innerHTML = '';
      cols.classList.toggle('flat', showOlder);
      if (!projects.length) { cols.textContent = 'No projects yet — create one below.'; return; }
      if (!matches.length) { cols.innerHTML = '<div class="resume-empty">No matches</div>'; return; }
      const now = Date.now();
      if (!showOlder) {
        // 3 columns: the recent bands (projects last used within 7 days).
        const buckets = bands3.map(() => []);
        for (const p of matches) {
          if (!p.lastActivity) continue;
          const age = now - Date.parse(p.lastActivity);
          const bi = bands3.findIndex((b) => age < b.max);
          if (bi >= 0) buckets[bi].push(p);
        }
        bands3.forEach((band, i) => {
          const col = document.createElement('div'); col.className = 'resume-col';
          const h = document.createElement('div'); h.className = 'resume-col-head'; h.textContent = `${band.label} (${buckets[i].length})`;
          const list = document.createElement('div'); list.className = 'resume-col-list';
          for (const p of buckets[i]) list.appendChild(projectRow(p, startIn));
          col.append(h, list); cols.appendChild(col);
        });
      } else {
        // Single flat list: older than 7 days + never-used, recent first, never last.
        const older = matches.filter((p) => !p.lastActivity || (now - Date.parse(p.lastActivity)) >= WEEK_MS);
        older.sort((a, b) => (Date.parse(b.lastActivity || 0) || -Infinity) - (Date.parse(a.lastActivity || 0) || -Infinity));
        const col = document.createElement('div'); col.className = 'resume-col';
        const h = document.createElement('div'); h.className = 'resume-col-head'; h.textContent = `Older than 7 days (${older.length})`;
        const list = document.createElement('div'); list.className = 'resume-col-list';
        if (!older.length) list.innerHTML = '<div class="resume-empty">—</div>';
        for (const p of older) list.appendChild(projectRow(p, startIn));
        col.append(h, list); cols.appendChild(col);
      }
    };
    olderToggle.onclick = () => {
      showOlder = !showOlder;
      olderToggle.textContent = showOlder ? '◂ Recent (last 7 days)' : 'Older than 7 days ▸';
      olderToggle.classList.toggle('active', showOlder);
      render();
    };

    try {
      const res = await fetch('/api/projects');
      projects = (await res.json()).projects;
      render();
    } catch { cols.textContent = 'Failed to load projects.'; }
    search.addEventListener('input', render);

    createBtn.onclick = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const res = await fetch('/api/projects', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); errorEl.textContent = e.error || 'Create failed'; return; }
        const p = await res.json();
        startIn(p.path);
      } catch { errorEl.textContent = 'Create failed'; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
  });
}

document.getElementById('add-btn').onclick = openNewSessionPicker;

function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  const h = diff / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(diff / 60e3))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function baseName(p) {
  if (!p) return '(unknown folder)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// Three age bands; a session falls into exactly the first band it fits (dedup).
const RESUME_BANDS = [
  { label: 'Last 24 hours', max: 24 * 3600e3 },
  { label: '1–3 days ago', max: 72 * 3600e3 },
  { label: '3–7 days ago', max: 168 * 3600e3 },
];

function renderBandGroups(listEl, sessions, close) {
  const byCwd = new Map();
  for (const s of sessions) { if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []); byCwd.get(s.cwd).push(s); }
  const groups = [...byCwd.entries()].map(([cwd, ss]) => ({ cwd, ss, temp: !!ss[0].temp }));
  groups.sort((a, b) => Date.parse(b.ss[0].lastActivity) - Date.parse(a.ss[0].lastActivity));
  if (!groups.length) {
    const e = document.createElement('div'); e.className = 'resume-empty'; e.textContent = '—';
    listEl.appendChild(e); return;
  }
  const renderGroup = (g) => {
    const head = document.createElement('div');
    head.className = 'recent-group';
    const name = document.createElement('div');
    name.className = 'proj-name'; name.textContent = baseName(g.cwd); name.title = baseName(g.cwd);
    const pth = document.createElement('div');
    pth.className = 'proj-path'; pth.textContent = g.cwd || ''; pth.title = g.cwd || '';
    head.append(name, pth);
    listEl.appendChild(head);
    for (const s of g.ss) {
      const b = document.createElement('button');
      b.className = 'recent-row';
      b.innerHTML = '<span class="recent-title"></span><span class="recent-time"></span>';
      b.querySelector('.recent-title').textContent = s.title;
      b.querySelector('.recent-time').textContent = relTime(s.lastActivity);
      b.onclick = () => { ws.send(JSON.stringify({ type: 'resume', id: s.id, cwd: g.cwd })); close(); };
      listEl.appendChild(b);
    }
  };
  // Project groups first; temporary sessions in a separate sub-section below.
  for (const g of groups.filter((x) => !x.temp)) renderGroup(g);
  const temps = groups.filter((x) => x.temp);
  if (temps.length) {
    const div = document.createElement('div');
    div.className = 'resume-temp-divider';
    div.textContent = 'Temporary';
    listEl.appendChild(div);
    for (const g of temps) renderGroup(g);
  }
}

function openResumePicker() {
  openModal(async (box, close) => {
    box.innerHTML =
      '<h2>Resume a session</h2>' +
      '<div class="scope-switch">' +
        '<button data-scope="global" class="active">Global discovery</button>' +
        '<button data-scope="cockpit">Cockpit</button>' +
        '<button data-scope="temp">Temporary</button>' +
      '</div>' +
      '<div class="modal-toolbar">' +
        '<input class="modal-search" placeholder="Search by session, project, or path…" />' +
        '<button class="older-toggle">Older than 7 days ▸</button>' +
      '</div>' +
      '<div class="resume-cols">Loading…</div>';
    const search = box.querySelector('.modal-search');
    const cols = box.querySelector('.resume-cols');
    const olderToggle = box.querySelector('.older-toggle');
    const scopeBtns = [...box.querySelectorAll('.scope-switch button')];

    const toFlat = (data) => {
      const now = Date.now();
      const out = [];
      for (const g of data.groups) for (const s of g.sessions) out.push({ ...s, cwd: g.cwd, temp: g.temp, cockpit: g.cockpit, age: now - Date.parse(s.lastActivity) });
      return out;
    };
    let weekFlat = null;
    let allFlat = null; // lazily fetched (window=all) the first time "older" is shown
    try { weekFlat = toFlat(await (await fetch('/api/recent?window=week')).json()); }
    catch { cols.textContent = 'Failed to load sessions.'; return; }

    let scope = 'global';
    let showOlder = false;
    const inScope = (s) => scope === 'global' || (scope === 'temp' ? s.temp : s.cockpit);
    const matching = (flat) => {
      const q = search.value.trim().toLowerCase();
      return flat.filter((s) => inScope(s) && (!q
        || (s.title || '').toLowerCase().includes(q)
        || (s.cwd || '').toLowerCase().includes(q)
        || baseName(s.cwd).toLowerCase().includes(q)));
    };
    const render = () => {
      cols.classList.toggle('flat', showOlder);
      cols.innerHTML = '';
      if (!showOlder) {
        const matches = matching(weekFlat);
        const bands = RESUME_BANDS.map(() => []);
        for (const s of matches) { const bi = RESUME_BANDS.findIndex((b) => s.age < b.max); if (bi >= 0) bands[bi].push(s); }
        RESUME_BANDS.forEach((band, i) => {
          const col = document.createElement('div'); col.className = 'resume-col';
          const h = document.createElement('div'); h.className = 'resume-col-head'; h.textContent = `${band.label} (${bands[i].length})`;
          const list = document.createElement('div'); list.className = 'resume-col-list';
          renderBandGroups(list, bands[i], close);
          col.append(h, list); cols.appendChild(col);
        });
      } else {
        const older = matching(allFlat || []).filter((s) => s.age >= WEEK_MS);
        const col = document.createElement('div'); col.className = 'resume-col';
        const h = document.createElement('div'); h.className = 'resume-col-head'; h.textContent = `Older than 7 days (${older.length})`;
        const list = document.createElement('div'); list.className = 'resume-col-list';
        renderBandGroups(list, older, close);
        col.append(h, list); cols.appendChild(col);
      }
    };
    olderToggle.onclick = async () => {
      showOlder = !showOlder;
      olderToggle.textContent = showOlder ? '◂ Recent (last 7 days)' : 'Older than 7 days ▸';
      olderToggle.classList.toggle('active', showOlder);
      if (showOlder && !allFlat) {
        cols.textContent = 'Loading older sessions…';
        try { allFlat = toFlat(await (await fetch('/api/recent?window=all')).json()); }
        catch { cols.textContent = 'Failed to load older sessions.'; return; }
      }
      render();
    };
    scopeBtns.forEach((b) => { b.onclick = () => { scope = b.dataset.scope; scopeBtns.forEach((x) => x.classList.toggle('active', x === b)); render(); }; });
    render();
    search.addEventListener('input', render);
  });
}

document.getElementById('resume-btn').onclick = openResumePicker;

// ---- Right-click context menu (one entry for now) ----------------------------
function closeContextMenu() {
  if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
}

function openContextMenu(x, y, s) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  const items = [
    { label: 'Open folder', act: () => ws.send(JSON.stringify({ type: 'open-folder', id: s.id })) },
    { label: 'Rename', act: () => openRenameModal(s) },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'ctx-item';
    b.textContent = it.label;
    b.onclick = () => { closeContextMenu(); it.act(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  // Keep the menu inside the viewport.
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 4) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 4) + 'px';
  ctxMenuEl = menu;
}

// Rename: a custom display name for any session (in-memory on the server).
function openRenameModal(s) {
  openModal((box, close) => {
    box.innerHTML =
      '<h2>Rename session</h2>' +
      '<div class="modal-create"><input /><button>Save</button></div>';
    const input = box.querySelector('input');
    const btn = box.querySelector('button');
    input.value = s.label || '';
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const save = () => { ws.send(JSON.stringify({ type: 'rename', id: s.id, name: input.value })); close(); };
    btn.onclick = save;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  });
}

// ---- Passive session preview (read-only) ------------------------------------
// A modal that mirrors a session live WITHOUT attaching: it uses the
// side-effect-free 'peek' message for the backlog and the existing per-session
// 'output' broadcast for live updates, so it never focuses the session or clears
// a needs-you/your-move signal. Watch-only (xterm disableStdin) and it never
// resizes the session's PTY.
// Scale the preview font so a cols x rows grid fits the modal in BOTH dimensions,
// so the whole frame is visible with no scrollbars. Ratios slightly under-estimate
// xterm's monospace cell (≈0.62*fs wide, ≈1.25*fs tall) to leave a hair of margin.
function fitPreviewFont(cols, rows) {
  if (!previewTerm || !previewOverlay) return;
  const wrap = previewOverlay.querySelector('.preview-term');
  if (!wrap) return;
  const w = wrap.clientWidth - 8;
  const h = wrap.clientHeight - 8;
  if (w <= 0 || h <= 0) return;
  const byWidth = w / (cols * 0.62);
  const byHeight = h / (rows * 1.25);
  const fs = Math.max(4, Math.min(15, Math.floor(Math.min(byWidth, byHeight))));
  previewTerm.options.fontSize = fs;
}

function closePreview() {
  if (previewTerm) { try { previewTerm.dispose(); } catch { /* already disposed */ } }
  if (previewOverlay && previewOverlay.parentNode) previewOverlay.remove();
  previewId = null; previewTerm = null; previewOverlay = null; previewCols = 0; previewRows = 0;
}

function openPreview(s) {
  closePreview(); // one preview at a time
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'preview-box';
  const head = document.createElement('div');
  head.className = 'preview-head';
  const title = document.createElement('span');
  title.textContent = `Preview — ${s.label} (read-only)`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'preview-close';
  closeBtn.textContent = '✕';
  head.append(title, closeBtn);
  const termWrap = document.createElement('div');
  termWrap.className = 'preview-term';
  box.append(head, termWrap);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  previewOverlay = overlay;

  const pt = new Terminal({ disableStdin: true, cursorBlink: false, fontSize: 13, theme: { background: '#1e1e1e' } });
  pt.open(termWrap);
  previewId = s.id; previewTerm = pt;
  // The grid is sized from the 'peeked' reply to match the session's PTY.

  overlay.onclick = (e) => { if (e.target === overlay) closePreview(); };
  closeBtn.onclick = closePreview;

  // Backlog now (side-effect-free); live output rides the broadcast.
  ws.send(JSON.stringify({ type: 'peek', id: s.id }));
}

document.addEventListener('click', closeContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeContextMenu(); closePreview(); } });
