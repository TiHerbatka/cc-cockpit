// SDK-only cockpit: the GUI renders entirely from the structured session stream
// (no terminal / xterm).
const ws = new WebSocket(`ws://${location.host}`);

let sessions = [];
let focusedId = null;
let ctxMenuEl = null;
let modeMenuEl = null;

// Quick-preview state: a read-only GUI view of any session, kept live via the
// gui-delta broadcast (never focuses/acknowledges the session).
let previewId = null;
let previewModel = null;
let previewBody = null;
let previewOverlay = null;

// The active blocking interaction (permission / question / plan / elicitation) for
// the focused session, rendered as a modal over the chat pane.
let currentInteraction = null;
let interactionOverlay = null;

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
  if (toggleBtn) toggleBtn.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) toggleBtn.classList.add('seen'); };
  const closeBtn = document.getElementById('error-close'); if (closeBtn) closeBtn.onclick = () => { panel.hidden = true; };
  const clearBtn = document.getElementById('error-clear'); if (clearBtn) clearBtn.onclick = () => { errors.length = 0; render(); };
  return {
    add(message, stack) {
      errors.push({ ts: Date.now(), message: String(message == null ? 'Unknown error' : message), stack: stack || null });
      if (errors.length > 200) errors.shift();
      // A new error is unread -> re-arm the pulse, unless the panel is already open.
      if (toggleBtn && (!panel || panel.hidden)) toggleBtn.classList.remove('seen');
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

// H3: a transient "Waiting for Claude…" spinner covers the gap between sending a
// turn and Claude's first output of that turn. awaitingResponse gates it; the gui
// controller owns the DOM (setWaiting). It clears on the first non-user item of the
// turn, on a focus change, on an interaction prompt, or on a server error.
let awaitingResponse = false;
function stopWaiting() { awaitingResponse = false; gui.setWaiting(false); }

// Send a user turn as ONE structured message over the SDK channel — no keystroke
// emulation, no carriage return, no nudge timer (the old PTY race is gone).
function composeSend(text) {
  if (!focusedId) return;
  ws.send(JSON.stringify({ type: 'send', id: focusedId, text }));
  awaitingResponse = true;
  gui.setWaiting(true);
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
  closeFloat();
}

// SDK sessions are GUI-only (the terminal substrate was removed - no fallback).
// Always mount the GUI pane and attach its live stream.
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
  // Stop button is available only while a turn is running.
  if (interruptBtn) interruptBtn.hidden = !(s && s.status === 'working');
  // Overflow menu acts on the focused session; disable it when there's none.
  if (overflowBtn) overflowBtn.disabled = !s;
  // Feed the floating header panels: the focused session's topics live here;
  // in-session todos come from guiModel. Buttons act only on a focused session.
  currentTopics = s ? (s.topics || []) : [];
  setFloatButtonsEnabled(!!s);
  if (!s) closeFloat();
  else if (floatSource === 'topics') renderFloat();
}

// ---- Chips + controls: permission mode, usage, interrupt, model -------------
const claudeModeEl = document.getElementById('claude-mode');
const interruptBtn = document.getElementById('interrupt-btn');
const overflowBtn = document.getElementById('overflow-btn');
const usageEl = document.getElementById('usage-chip');
const usageBarEl = document.getElementById('usage-bar');
const modelSelect = document.getElementById('model-select');
const effortSelect = document.getElementById('effort-select');
// All six permission modes, each with a one-line explanation shown as a hover
// tooltip on a ? icon in the dropdown.
const MODES = [
  ['default', 'Prompts for anything not pre-approved.'],
  ['acceptEdits', 'Auto-accepts file edits; other tools still prompt.'],
  ['plan', 'Explore and plan only; never executes edits.'],
  ['bypassPermissions', 'Approves everything that reaches the gate (your deny-rules still apply).'],
  ['dontAsk', 'Never prompts; denies anything not pre-approved.'],
  ['auto', 'A model classifier approves or denies each call.'],
];
// The usage chip aggregates segments that arrive across SEPARATE meta messages:
// per-turn tokens from result.usage, and the rolling-window (5h/7d) + context
// figures from the registry's usage refresh. Each meta updates only the segment
// it carries (so a later rate/ctx message never blanks the token segment); the
// chip re-renders from the whole accumulator. Reset on a focus change (focus()).
let usageAcc = window.emptyUsage();
function resetUsageChip() {
  usageAcc = window.emptyUsage();
  if (usageEl) usageEl.textContent = '';
  if (usageBarEl) usageBarEl.hidden = true; // empty chip -> collapse its row (H4)
}
// The pure accumulator fold + segment building live in public/usage.js (testable);
// this only turns the segment descriptors into DOM spans.
function renderUsageChip() {
  if (!usageEl) return;
  usageEl.textContent = '';
  const segs = window.usageSegments(usageAcc).map((s) => {
    const span = document.createElement('span');
    span.textContent = s.text;
    if (s.cls) span.className = s.cls;
    if (s.resetsAt) span.title = `resets ${new Date(s.resetsAt).toLocaleString()}`;
    return span;
  });
  segs.forEach((sp, i) => { if (i) usageEl.append(' · '); usageEl.append(sp); });
  // The usage row stays hidden until at least one segment exists (H4).
  if (usageBarEl) usageBarEl.hidden = segs.length === 0;
}
// Mode chip from the init message's permission mode; tokens from result.usage;
// rolling-window/context from the usage refresh; model from init/setModel. All
// arrive as {type:'meta'}; each carries only the fields it updates.
function renderMeta(meta) {
  if (meta.mode && claudeModeEl) claudeModeEl.textContent = meta.mode;
  if (meta.model && modelSelect) { for (const o of modelSelect.options) o.selected = (meta.model === o.value || meta.model.startsWith(o.value)); }
  if (meta.effort && effortSelect) { for (const o of effortSelect.options) o.selected = (o.value === meta.effort); }
  if (window.foldUsageMeta(usageAcc, meta).changed) renderUsageChip();
}
// Interrupt the running turn.
if (interruptBtn) interruptBtn.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'interrupt', id: focusedId })); };
// The mode chip opens a dropdown of all six modes (each with a ? tooltip);
// picking one sends set-permission-mode and the server echoes meta to update it.
function closeModeMenu() { if (modeMenuEl) { modeMenuEl.remove(); modeMenuEl = null; } }
function openModeMenu() {
  closeModeMenu();
  if (!focusedId || !claudeModeEl) return;
  const menu = document.createElement('div'); menu.className = 'mode-menu';
  const cur = claudeModeEl.textContent.trim();
  for (const [mode, tip] of MODES) {
    const row = document.createElement('div'); row.className = 'mode-menu-row' + (mode === cur ? ' active' : '');
    const name = document.createElement('button'); name.type = 'button'; name.className = 'mode-menu-name'; name.textContent = mode;
    name.onclick = () => { ws.send(JSON.stringify({ type: 'set-permission-mode', id: focusedId, mode })); closeModeMenu(); };
    const help = document.createElement('span'); help.className = 'mode-menu-help'; help.textContent = '?'; help.title = tip;
    row.append(name, help); menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const rect = claudeModeEl.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  modeMenuEl = menu;
}
if (claudeModeEl) claudeModeEl.onclick = (e) => { e.stopPropagation(); openModeMenu(); };
// Switch the model.
if (modelSelect) modelSelect.onchange = () => { if (focusedId) ws.send(JSON.stringify({ type: 'set-model', id: focusedId, model: modelSelect.value })); };
if (effortSelect) effortSelect.onchange = () => { if (focusedId) ws.send(JSON.stringify({ type: 'set-effort', id: focusedId, level: effortSelect.value })); };
// Doc buttons: open the focused session's local-docs.md / TODO.md via the OS default app.
const openDocsBtn = document.getElementById('open-docs');
if (openDocsBtn) openDocsBtn.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'open-file', id: focusedId, which: 'docs' })); };

// ---- Display mode (FEAT-display-mode): focus / focus+ / normal / verbose ----
// Seeded from the server's read of the user's Claude viewMode/verbose (the
// display-mode message); the ⋯ menu can override it for the rest of the session.
// The override, once set, wins over the server's preference.
const DISPLAY_LABELS = { focus: 'Focus', 'focus+': 'Focus+', normal: 'Normal', verbose: 'Verbose' };
let serverDisplayMode = 'normal';
let displayOverride = null;
function effectiveDisplayMode() { return displayOverride || serverDisplayMode; }
function applyDisplayMode() { gui.setMode(effectiveDisplayMode()); }
function setDisplayOverride(mode) { displayOverride = mode; applyDisplayMode(); }

// ---- Overflow (⋯) menu: a low-clutter home for rarely-used per-session actions.
// First action: copy the focused session's Claude Code session id (ccSessionId),
// which the client already receives on every session (J6). It also hosts the
// display-mode override (Focus / Normal / Verbose).
let overflowMenuEl = null;
function closeOverflowMenu() { if (overflowMenuEl) { overflowMenuEl.remove(); overflowMenuEl = null; } }
async function copySessionId(s) {
  const id = s && s.ccSessionId;
  if (!id) { errorCenter.add('No session id to copy'); return; }
  try { await navigator.clipboard.writeText(id); showToast('Session ID copied'); }
  catch (e) { errorCenter.add('Copy session ID failed — ' + ((e && e.message) || e)); }
}
function openOverflowMenu() {
  closeOverflowMenu();
  const s = sessions.find((x) => x.id === focusedId);
  if (!s || !overflowBtn) return;
  const menu = document.createElement('div'); menu.className = 'ctx-menu';
  const cur = effectiveDisplayMode();
  const items = [
    { label: 'Copy session ID', act: () => copySessionId(s) },
    { sep: true },
    { header: 'Display' },
    ...['focus', 'focus+', 'normal', 'verbose'].map((mode) => ({
      label: (cur === mode ? '✓ ' : ' ') + DISPLAY_LABELS[mode],
      act: () => setDisplayOverride(mode),
    })),
  ];
  for (const it of items) {
    if (it.sep) { const d = document.createElement('div'); d.className = 'ctx-sep'; menu.appendChild(d); continue; }
    if (it.header) { const h = document.createElement('div'); h.className = 'ctx-header'; h.textContent = it.header; menu.appendChild(h); continue; }
    const b = document.createElement('button'); b.className = 'ctx-item'; b.textContent = it.label;
    b.onclick = () => { closeOverflowMenu(); it.act(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const rect = overflowBtn.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  overflowMenuEl = menu;
}
if (overflowBtn) overflowBtn.onclick = (e) => { e.stopPropagation(); openOverflowMenu(); };

// A brief transient confirmation toast (self-removes). Used for copy-to-clipboard.
function showToast(text) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); }, 1600);
  setTimeout(() => { t.remove(); }, 2100);
}

// ---- Floating todo/topic panels over the chat (one shared overlay) ----------
// Each header button toggles this panel for its source. The data is what app.js
// already holds: in-session todos (guiModel.status.todos), the focused session's
// topics, and TODO.md fetched on demand (read-todo). X or Esc close it.
const contentEl = document.getElementById('content');
const openTodoMdBtn = document.getElementById('open-todomd');
const openInsessionBtn = document.getElementById('open-insession');
const openTopicsBtn = document.getElementById('open-topics');
const FLOAT_TITLES = { insession: 'In-session todos', topics: 'Topics', todomd: 'TODO.md' };
let floatSource = null;   // 'insession' | 'topics' | 'todomd' | null
let floatEl = null;
let currentTopics = [];
let todoMdState = { loading: false, found: false, entries: [] };

function setFloatButtonsEnabled(on) {
  for (const b of [openTodoMdBtn, openInsessionBtn, openTopicsBtn]) if (b) b.disabled = !on;
}
function closeFloat() {
  if (floatEl) { floatEl.remove(); floatEl = null; }
  floatSource = null;
}
function floatEmpty(text) { const d = document.createElement('div'); d.className = 'float-empty'; d.textContent = text; return d; }
function renderInsessionInto(body) {
  const todos = (guiModel && guiModel.status && guiModel.status.todos) || [];
  if (!todos.length) { body.appendChild(floatEmpty('No in-session todos.')); return; }
  const ul = document.createElement('ul');
  ul.className = 'gui-todos';
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = 'todo-' + t.status;
    li.textContent = (TODO_GLYPH[t.status] || '•') + ' ' + t.content;
    ul.appendChild(li);
  }
  body.appendChild(ul);
}
function renderTopicsInto(body) {
  const topics = currentTopics || [];
  if (!topics.length) { body.appendChild(floatEmpty('No topics tracked for this session.')); return; }
  const ul = document.createElement('ul');
  ul.className = 'float-topics';
  for (const t of topics) {
    const li = document.createElement('li');
    li.className = 'topic-' + t.status;
    const dot = t.status === 'active' ? '●' : t.status === 'parked' ? '◐' : '○';
    const code = document.createElement('span'); code.className = 'topic-code'; code.textContent = t.code || '';
    const name = document.createElement('span'); name.className = 'topic-name'; name.textContent = ' ' + (t.name || '');
    const d = document.createElement('span'); d.className = 'topic-dot'; d.textContent = ' ' + dot;
    li.appendChild(code); li.appendChild(name); li.appendChild(d);
    if (t.summary) { const sm = document.createElement('div'); sm.className = 'topic-summary'; sm.textContent = t.summary; li.appendChild(sm); }
    ul.appendChild(li);
  }
  body.appendChild(ul);
}
function renderTodoMdInto(body) {
  if (todoMdState.loading) { body.appendChild(floatEmpty('Loading…')); return; }
  if (!todoMdState.found) { body.appendChild(floatEmpty('No TODO.md in this session.')); return; }
  if (!todoMdState.entries.length) { body.appendChild(floatEmpty('TODO.md is empty.')); return; }
  for (const e of todoMdState.entries) {
    const div = document.createElement('div');
    if (e.kind === 'section') { div.className = 'todomd-section'; div.textContent = e.text; }
    else if (e.kind === 'item') {
      div.className = 'todomd-item' + (e.done ? ' done' : '');
      div.style.paddingLeft = (e.depth * 16) + 'px';
      div.textContent = (e.done ? '☑ ' : '☐ ') + e.text;
    } else { div.className = 'todomd-textline'; div.textContent = e.text; }
    body.appendChild(div);
  }
}
function renderFloat() {
  if (!floatSource || !floatEl) return;
  const body = floatEl.querySelector('.float-body');
  body.innerHTML = '';
  if (floatSource === 'insession') renderInsessionInto(body);
  else if (floatSource === 'topics') renderTopicsInto(body);
  else renderTodoMdInto(body);
}
function toggleFloat(source) {
  if (!focusedId) return;
  if (floatSource === source) { closeFloat(); return; }
  if (!floatEl) {
    floatEl = document.createElement('div');
    floatEl.className = 'float-panel';
    floatEl.innerHTML = '<div class="float-head"><span class="float-title"></span>'
      + '<button class="float-close" title="Close (Esc)">✕</button></div>'
      + '<div class="float-body"></div>';
    floatEl.querySelector('.float-close').onclick = closeFloat;
    contentEl.appendChild(floatEl);
  }
  floatSource = source;
  floatEl.classList.toggle('float-right', source === 'todomd');
  floatEl.querySelector('.float-title').textContent = FLOAT_TITLES[source] || '';
  if (source === 'todomd') {
    todoMdState = { loading: true, found: false, entries: [] };
    ws.send(JSON.stringify({ type: 'read-todo', id: focusedId }));
  }
  renderFloat();
}
if (openTodoMdBtn) openTodoMdBtn.onclick = () => toggleFloat('todomd');
if (openInsessionBtn) openInsessionBtn.onclick = () => toggleFloat('insession');
if (openTopicsBtn) openTopicsBtn.onclick = () => toggleFloat('topics');
setFloatButtonsEnabled(false);
// Esc closes the float first (capture phase) so it wins over other Esc handlers.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && floatSource) { e.preventDefault(); e.stopPropagation(); closeFloat(); }
}, true);


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
  if (focusedId === s.id) { focusedId = null; detachGui(); guiPaneEl.hidden = true; updateHead(); }
  ws.send(JSON.stringify({ type: 'remove', id: s.id }));
}

function focus(id) {
  focusedId = id;
  errorEl.textContent = '';
  stopWaiting(); // the spinner is per-turn on the previous session; reset on switch
  guiModel = null; // reset until the new session's snapshot arrives
  resetUsageChip(); // usage segments are per-session; clear the previous one's
  closeInteractionModal(); // clear any stale interaction modal from the previous session
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
    if (floatSource === 'insession') renderFloat();
  } else if (m.type === 'gui-delta') {
    if (m.id === focusedId && guiModel) {
      applyDelta(guiModel, m.ops); gui.update(guiModel); if (floatSource === 'insession') renderFloat();
      // Claude has "started responding" once any non-user item lands this turn
      // (the user echo is kind 'user' and must NOT dismiss the spinner).
      if (awaitingResponse && (m.ops || []).some((o) => o.op === 'append' && o.item && o.item.kind !== 'user')) stopWaiting();
    }
    if (m.id === previewId && previewModel) { applyDelta(previewModel, m.ops); window.renderGuiModel(previewBody, previewModel); }
  } else if (m.type === 'todo-content' && m.id === focusedId) {
    todoMdState = { loading: false, found: m.found, entries: m.entries || [] };
    if (floatSource === 'todomd') renderFloat();
  } else if (m.type === 'peeked' && m.id === previewId) {
    previewModel = m.model;
    window.renderGuiModel(previewBody, previewModel);
  } else if (m.type === 'meta' && m.id === focusedId) {
    renderMeta(m);
  } else if (m.type === 'interaction-request' && m.id === focusedId) {
    stopWaiting(); // a prompt means Claude is now waiting on the user, not "starting"
    openInteractionModal(m);
  } else if (m.type === 'display-mode') {
    // The user's Claude display preference (viewMode/verbose). Seeds the render
    // detail level unless the user has manually overridden it via the ⋯ menu.
    serverDisplayMode = m.mode || 'normal';
    if (!displayOverride) applyDisplayMode();
  } else if (m.type === 'error') {
    // Server errors (e.g. local-docs/TODO "not found") go to the error center only,
    // not the bottom-left #error element (B7).
    stopWaiting();
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
      '<div class="scope-switch">' +
        '<button data-scope="cockpit" class="active">Cockpit projects</button>' +
        '<button data-scope="discovered">Discovered folders</button>' +
      '</div>' +
      '<div class="modal-toolbar">' +
        '<input class="modal-search" placeholder="Search by name or path…" />' +
        '<button class="older-toggle">Older than 7 days ▸</button>' +
        '<button class="never-used-chip" hidden></button>' +
      '</div>' +
      '<div class="resume-cols">Loading…</div>' +
      '<div class="modal-create"><input placeholder="new project name" /><button>Create &amp; start</button></div>' +
      '<button class="temp-btn">+ Temporary session</button>';
    const search = box.querySelector('.modal-search');
    const cols = box.querySelector('.resume-cols');
    const olderToggle = box.querySelector('.older-toggle');
    const input = box.querySelector('.modal-create input');
    const createBtn = box.querySelector('.modal-create button');
    const scopeBtns = [...box.querySelectorAll('.scope-switch button')];
    const chip = box.querySelector('.never-used-chip');
    let popover = null;
    let onDocClick = null;
    const closePopover = () => {
      if (onDocClick) { document.removeEventListener('click', onDocClick); onDocClick = null; }
      if (popover) { popover.remove(); popover = null; }
    };
    const neverUsed = () => projects.filter((p) => !p.lastActivity).sort((a, b) => a.name.localeCompare(b.name));
    const renderChip = () => {
      closePopover();
      const nu = scope === 'cockpit' ? neverUsed() : [];
      chip.hidden = nu.length === 0;
      if (nu.length) {
        chip.textContent = `⚠ ${nu.length} never used`;
        chip.title = `${nu.length} project${nu.length > 1 ? 's' : ''} created but never used — click to list`;
      }
    };
    chip.onclick = (e) => {
      e.stopPropagation();
      if (popover) { closePopover(); return; }
      const nu = neverUsed();
      popover = document.createElement('div');
      popover.className = 'never-used-popover';
      const head = document.createElement('div');
      head.className = 'never-used-head';
      head.textContent = `Never used (${nu.length})`;
      popover.appendChild(head);
      for (const p of nu) {
        const row = document.createElement('button');
        row.className = 'never-used-row';
        row.textContent = p.name;
        row.title = p.path;
        row.onclick = () => { closePopover(); startIn(p.path); };
        popover.appendChild(row);
      }
      box.querySelector('.modal-toolbar').appendChild(popover);
      onDocClick = (ev) => { if (!popover.contains(ev.target) && ev.target !== chip) closePopover(); };
      document.addEventListener('click', onDocClick);
    };
    const startIn = (cwd) => { ws.send(JSON.stringify({ type: 'create', cwd })); close(); };
    box.querySelector('.temp-btn').onclick = () => { ws.send(JSON.stringify({ type: 'create-temp' })); close(); };

    let projects = [];     // cockpit projects (/api/projects)
    let discWeek = null;   // external discovered folders, last 7 days (/api/recent)
    let discAll = null;    // external discovered folders, all time (lazy)
    let scope = 'cockpit';
    let showOlder = false;
    const bands3 = PROJECT_BANDS.slice(0, 3); // 24h / 1–3d / 3–7d

    // External discovered folders = recent groups tagged neither cockpit nor temp,
    // collapsed to one row per folder (its most-recent session = last used).
    const foldersFrom = (data) => {
      const out = [];
      for (const g of data.groups) {
        if (g.temp || g.cockpit) continue;
        let last = null;
        for (const s of g.sessions) { const t = Date.parse(s.lastActivity); if (!Number.isNaN(t) && (last === null || t > last)) last = t; }
        out.push({ name: baseName(g.cwd), path: g.cwd, lastActivity: last ? new Date(last).toISOString() : null });
      }
      out.sort((a, b) => (Date.parse(b.lastActivity || 0) || -Infinity) - (Date.parse(a.lastActivity || 0) || -Infinity));
      return out;
    };

    // One renderer for both scopes: 3 time-band columns for the recent view
    // (Last 24h / 1–3d / 3–7d, like the Resume modal); a flat, age-filtered list
    // for the older view. `emptyMsg` shows when the underlying list is empty.
    const renderList = (items, emptyMsg) => {
      cols.innerHTML = '';
      cols.classList.toggle('flat', showOlder);
      if (!items.length) { cols.textContent = emptyMsg; return; }
      const q = search.value.trim().toLowerCase();
      const matched = items.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q));
      if (!matched.length) { cols.innerHTML = '<div class="resume-empty">No matches</div>'; return; }
      const now = Date.now();
      if (!showOlder) {
        // 3 columns: the recent bands (last used within 7 days).
        const buckets = bands3.map(() => []);
        for (const p of matched) {
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
        // Single flat list: older than 7 days (+ never-used), recent first.
        const older = matched.filter((p) => !p.lastActivity || (now - Date.parse(p.lastActivity)) >= WEEK_MS);
        older.sort((a, b) => (Date.parse(b.lastActivity || 0) || -Infinity) - (Date.parse(a.lastActivity || 0) || -Infinity));
        const col = document.createElement('div'); col.className = 'resume-col';
        const h = document.createElement('div'); h.className = 'resume-col-head'; h.textContent = `Older than 7 days (${older.length})`;
        const list = document.createElement('div'); list.className = 'resume-col-list';
        if (!older.length) list.innerHTML = '<div class="resume-empty">—</div>';
        for (const p of older) list.appendChild(projectRow(p, startIn));
        col.append(h, list); cols.appendChild(col);
      }
    };

    const render = () => {
      if (scope === 'cockpit') { renderList(projects, 'No projects yet — create one below.'); return; }
      const data = showOlder ? discAll : discWeek;
      if (!data) { cols.textContent = 'Loading…'; return; }
      renderList(data, 'No discovered folders outside the cockpit.');
    };

    // Lazy-load discovered folders for the active window when first needed.
    const ensureDiscovered = async () => {
      if (!discWeek) {
        try { discWeek = foldersFrom(await (await fetch('/api/recent?window=week')).json()); }
        catch { cols.textContent = 'Failed to load discovered folders.'; return; }
      }
      if (showOlder && !discAll) {
        cols.textContent = 'Loading older folders…';
        try { discAll = foldersFrom(await (await fetch('/api/recent?window=all')).json()); }
        catch { cols.textContent = 'Failed to load older folders.'; return; }
      }
      render();
    };

    scopeBtns.forEach((b) => { b.onclick = async () => {
      scope = b.dataset.scope;
      scopeBtns.forEach((x) => x.classList.toggle('active', x === b));
      if (scope === 'discovered') await ensureDiscovered(); else render();
      renderChip();
    }; });

    olderToggle.onclick = async () => {
      showOlder = !showOlder;
      olderToggle.textContent = showOlder ? '◂ Recent (last 7 days)' : 'Older than 7 days ▸';
      olderToggle.classList.toggle('active', showOlder);
      if (scope === 'discovered') await ensureDiscovered(); else render();
    };

    try {
      const res = await fetch('/api/projects');
      projects = (await res.json()).projects;
      render();
      renderChip();
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
    { label: 'Quick preview', act: () => openPreview(s) },
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

// ---- Quick preview (read-only, in-GUI) --------------------------------------
// A modal mirroring a session's conversation model read-only, WITHOUT focusing
// it: 'peek' fetches the current model (no acknowledge); live gui-delta
// broadcasts keep it current (filtered by preview id).
function closePreview() {
  if (previewOverlay && previewOverlay.parentNode) previewOverlay.remove();
  previewId = null; previewModel = null; previewBody = null; previewOverlay = null;
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
  const body = document.createElement('div');
  body.className = 'preview-gui';
  body.textContent = 'Loading…';
  box.append(head, body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  previewId = s.id; previewOverlay = overlay; previewBody = body;
  overlay.onclick = (e) => { if (e.target === overlay) closePreview(); };
  closeBtn.onclick = closePreview;
  ws.send(JSON.stringify({ type: 'peek', id: s.id }));
}

// ---- Blocking interaction modal (per session, over the chat pane) -----------
// One modal for every "Claude is waiting on you" moment: tool-permission,
// AskUserQuestion, plan-accept, MCP elicitation. It overlays the chat pane only
// (the sidebar stays usable), is tied to the focused session, and the pending
// interaction is re-sent by the server on attach so switching back re-shows it.
function closeInteractionModal() {
  if (interactionOverlay && interactionOverlay.parentNode) interactionOverlay.remove();
  interactionOverlay = null; currentInteraction = null;
}

function answerInteraction(answer) {
  if (!currentInteraction) return;
  ws.send(JSON.stringify({ type: 'interaction-answer', id: currentInteraction.id, requestId: currentInteraction.requestId, answer }));
  closeInteractionModal();
}

function interactionActions(buttons) {
  const row = document.createElement('div');
  row.className = 'interaction-actions';
  for (const [label, cls, onClick] of buttons) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label; b.onclick = onClick;
    row.appendChild(b);
  }
  return row;
}

// Render a tool-permission request's input human-readably instead of a raw JSON
// blob (J2): the command for a shell tool, the path (and diff) for a file tool,
// the pattern for a search, else a tidy key/value list — with the full JSON kept
// in a collapsed <details> for fidelity.
function renderPermissionInput(req) {
  const wrap = document.createElement('div'); wrap.className = 'perm-input';
  const input = (req && req.input && typeof req.input === 'object') ? req.input : {};
  const name = req && req.toolName;
  const rows = []; // [label, value, mono]
  const val = (s) => (s == null ? '' : String(s));
  const add = (label, value, mono) => rows.push([label, value, mono]);

  if (name === 'Bash' || name === 'PowerShell') {
    add('Command', val(input.command), true);
    if (input.description) add('What it does', val(input.description), false);
  } else if (name === 'Read' || name === 'Write') {
    add('File', val(input.file_path), true);
  } else if (name === 'Edit') {
    add('File', val(input.file_path), true);
    if (input.old_string != null) add('Replace', val(input.old_string), true);
    if (input.new_string != null) add('With', val(input.new_string), true);
  } else if (name === 'Glob' || name === 'Grep') {
    add('Pattern', val(input.pattern), true);
    if (input.path) add('In', val(input.path), true);
    if (input.glob) add('Filter', val(input.glob), true);
  } else {
    for (const [k, v] of Object.entries(input)) {
      const obj = v !== null && typeof v === 'object';
      add(k, obj ? JSON.stringify(v) : val(v), obj);
    }
  }
  if (!rows.length) add('(no input)', '', false);

  for (const [label, value, mono] of rows) {
    const row = document.createElement('div'); row.className = 'perm-row';
    const l = document.createElement('span'); l.className = 'perm-label'; l.textContent = label;
    const v = document.createElement(mono ? 'pre' : 'span');
    v.className = 'perm-value' + (mono ? ' mono' : ''); v.textContent = value;
    row.append(l, v); wrap.appendChild(row);
  }
  // Keep the full JSON available but collapsed, so nothing is hidden from the user.
  if (Object.keys(input).length) {
    const det = document.createElement('details'); det.className = 'perm-raw';
    const sum = document.createElement('summary'); sum.textContent = 'Raw input';
    const pre = document.createElement('pre'); pre.className = 'interaction-input'; pre.textContent = JSON.stringify(req.input, null, 2);
    det.append(sum, pre); wrap.appendChild(det);
  }
  return wrap;
}

function buildInteractionBody(card, req) {
  const head = document.createElement('div'); head.className = 'interaction-head';
  if (req.kind === 'permission') {
    head.textContent = 'Permission requested';
    const sub = document.createElement('div'); sub.className = 'interaction-sub';
    sub.textContent = req.toolName ? `Claude wants to use ${req.toolName}` : 'Claude is requesting permission';
    card.append(head, sub, renderPermissionInput(req), interactionActions([
      ['Allow once', 'btn-allow', () => answerInteraction('allow')],
      ["Allow, don't ask again", 'btn-allow2', () => answerInteraction('allow-always')],
      ['Deny', 'btn-deny', () => answerInteraction('deny')],
    ]));
  } else if (req.kind === 'plan') {
    head.textContent = 'Plan ready for review';
    const pre = document.createElement('pre'); pre.className = 'interaction-input'; pre.textContent = req.plan || '(no plan text)';
    card.append(head, pre, interactionActions([
      ['Approve', 'btn-allow', () => answerInteraction('approve')],
      ['Approve & auto-accept edits', 'btn-allow2', () => answerInteraction('approve-auto')],
      ['Keep planning', 'btn-deny', () => answerInteraction('keep-planning')],
    ]));
  } else if (req.kind === 'question') {
    head.textContent = 'Claude is asking';
    card.appendChild(head);
    const questions = req.questions || [];
    const selections = questions.map((q) => (q.multiSelect ? [] : null));
    questions.forEach((q, qi) => {
      const block = document.createElement('div'); block.className = 'interaction-q';
      const qhead = document.createElement('div'); qhead.className = 'interaction-qhead';
      qhead.textContent = q.header ? `${q.header}: ${q.question}` : q.question;
      block.appendChild(qhead);
      for (const opt of (q.options || [])) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'interaction-opt';
        b.textContent = opt.label + (opt.description ? ` — ${opt.description}` : '');
        b.onclick = () => {
          if (q.multiSelect) {
            const arr = selections[qi]; const ix = arr.indexOf(opt.label);
            if (ix >= 0) { arr.splice(ix, 1); b.classList.remove('sel'); } else { arr.push(opt.label); b.classList.add('sel'); }
          } else {
            selections[qi] = opt.label;
            for (const sib of block.querySelectorAll('.interaction-opt')) sib.classList.remove('sel');
            b.classList.add('sel');
          }
        };
        block.appendChild(b);
      }
      card.appendChild(block);
    });
    card.appendChild(interactionActions([
      ['Submit', 'btn-allow', () => answerInteraction({ answers: questions.map((q, qi) => ({ question: q.question, header: q.header, answer: selections[qi] })) })],
    ]));
  } else if (req.kind === 'elicitation') {
    const rq = req.request || {};
    head.textContent = rq.title || 'Input requested';
    const msg = document.createElement('div'); msg.className = 'interaction-sub'; msg.textContent = rq.message || '';
    card.append(head, msg);
    const content = {};
    if (rq.mode === 'url' && rq.url) {
      const a = document.createElement('a'); a.href = rq.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'interaction-url'; a.textContent = rq.url;
      card.appendChild(a);
    } else if (rq.requestedSchema && rq.requestedSchema.properties) {
      for (const [key, sch] of Object.entries(rq.requestedSchema.properties)) {
        const wrap = document.createElement('label'); wrap.className = 'interaction-field';
        wrap.textContent = (sch && sch.title) || key;
        const inp = document.createElement('input'); inp.type = 'text';
        inp.oninput = () => { content[key] = inp.value; };
        wrap.appendChild(inp); card.appendChild(wrap);
      }
    }
    card.appendChild(interactionActions([
      ['Submit', 'btn-allow', () => answerInteraction({ action: 'accept', content })],
      ['Decline', 'btn-deny', () => answerInteraction({ action: 'decline' })],
    ]));
  } else {
    head.textContent = 'Waiting for your input';
    card.append(head, interactionActions([['Dismiss', 'btn-deny', () => answerInteraction('deny')]]));
  }
}

function openInteractionModal(req) {
  closeInteractionModal();
  currentInteraction = req;
  const overlay = document.createElement('div'); overlay.className = 'interaction-overlay';
  const card = document.createElement('div'); card.className = 'interaction-card';
  buildInteractionBody(card, req);
  overlay.appendChild(card);
  guiPaneEl.appendChild(overlay);
  interactionOverlay = overlay;
}

document.addEventListener('click', () => { closeContextMenu(); closeModeMenu(); closeOverflowMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeContextMenu(); closePreview(); closeModeMenu(); closeOverflowMenu(); } });
