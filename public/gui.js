// public/gui.js
// Renders the GUI pane from a normalized model { title, items, status } pushed by
// the server (gui-snapshot). Watch + compose only — no permission UI yet (Plan 2).
// Exposes a single controller mounted once; app.js re-points it at the focused
// session and feeds it snapshots.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// A short, human label for a tool card from its input.
function keyArg(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (name === 'Bash' || name === 'PowerShell') return truncate(input.command, 90);
  if (name === 'Read' || name === 'Edit' || name === 'Write') return truncate(input.file_path, 90);
  if (name === 'Glob' || name === 'Grep') return truncate(input.pattern, 90);
  if (name === 'Task' || name === 'Agent') return truncate(input.description, 90);
  if (name === 'TaskCreate') return truncate(input.subject, 90);
  if (name === 'TaskUpdate') return `#${input.taskId} → ${input.status}`;
  if (name === 'Skill') return truncate(input.skill, 90);
  return '';
}

const TODO_GLYPH = { completed: '✓', in_progress: '▸', pending: '○', cancelled: '✗', deleted: '✗' };

// Display mode (FEAT-display-mode): how much conversation detail to show, seeded
// from the user's Claude viewMode/verbose. Each mode is a small config the renderer
// reads. The two "focus" modes match the terminal by HIDING intermediate detail
// (not folding it); focus+ is a cockpit-only variant that keeps Claude's prose.
//   groupThreshold — (normal/verbose) collapse a run of >= N consecutive tools into
//                    one summary group (3 = runs of 3+ group; Infinity = never group)
//   toolsPerTurn   — (focus/focus+) collapse ALL of a turn's tools into ONE per-turn
//                    summary group, even across intervening prose — so focus+ shows
//                    one quiet tool line per turn, not one group per consecutive run
//   openTools      — render tool cards with their input/output expanded
//   openThinking   — render thinking blocks expanded
//   dropThinking   — remove thinking blocks entirely
//   prose          — 'all' shows every assistant message; 'final' shows only each
//                    turn's final answer (intermediate prose hidden, terminal focus)
const DISPLAY_MODES = {
  focus:    { toolsPerTurn: true,       openTools: false, openThinking: false, dropThinking: true,  prose: 'final' },
  'focus+': { toolsPerTurn: true,       openTools: false, openThinking: false, dropThinking: false, prose: 'all' },
  normal:   { groupThreshold: 3,        openTools: false, openThinking: false, dropThinking: false, prose: 'all' },
  verbose:  { groupThreshold: Infinity, openTools: true,  openThinking: true,  dropThinking: false, prose: 'all' },
};
function modeCfg(mode) { return DISPLAY_MODES[mode] || DISPLAY_MODES.normal; }

// Pure (unit-tested): the set of assistant-text items that are the LAST assistant
// message of their turn — that turn's final answer. A user prompt starts a turn;
// the last assistant item before the next prompt (or the end) is its final answer.
// Focus keeps these and hides the rest of the intermediate prose.
function finalAnswerItems(items) {
  const finals = new Set();
  let lastAsst = null;
  for (const it of items || []) {
    if (!it) continue;
    if (it.kind === 'user') { if (lastAsst) finals.add(lastAsst); lastAsst = null; }
    else if (it.kind === 'assistant') lastAsst = it;
  }
  if (lastAsst) finals.add(lastAsst);
  return finals;
}

// Pure (unit-tested): drop the items a mode hides, before grouping/rendering. Focus
// keeps only each turn's final answer (intermediate prose gone) and drops thinking;
// with the separating prose removed, a turn's tool calls become adjacent and merge
// into one per-turn summary group. Modes that show everything return the list as-is.
function filterItemsForMode(items, cfg, finals) {
  if (cfg.prose === 'all' && !cfg.dropThinking) return items || [];
  return (items || []).filter((it) => {
    if (!it) return false;
    if (it.kind === 'thinking') return !cfg.dropThinking;
    if (it.kind === 'assistant') return cfg.prose === 'all' || finals.has(it);
    return true; // user / tool / todos always kept
  });
}

function renderStatus(el, model) {
  const st = (model && model.status) || {};
  const bits = [];
  if (model && model.title) bits.push(`<span class="gui-title">${esc(model.title)}</span>`);
  if (st.currentTool) {
    bits.push(`<span class="gui-current">⚙︎ ${esc(st.currentTool.name)} ${esc(keyArg(st.currentTool.name, st.currentTool.input))}</span>`);
  }
  if (Array.isArray(st.todos) && st.todos.length) {
    const done = st.todos.filter((t) => t.status === 'completed').length;
    bits.push(`<span class="gui-todoprog">todos ${done}/${st.todos.length}</span>`);
  }
  // With nothing to show (no title, no running tool, no todos) hide the bar
  // entirely rather than display a misleading "waiting for activity" line that
  // reads as if Claude is stuck while it is actually idle (J1).
  el.innerHTML = bits.join('');
  el.hidden = bits.length === 0;
}

// Persist a <details>'s open/closed state across full re-renders. The log rebuilds
// its innerHTML on every delta, which would otherwise snap shut any card/group the
// user just opened; keyed by a stable id, an expanded element stays open when a new
// token or message arrives. `openKeys` is a Set owned per render target.
function wireDetails(details, key, openKeys) {
  if (!details || !key || !openKeys) return;
  if (openKeys.has(key)) details.open = true; // restore before listening (set first)
  details.addEventListener('toggle', () => {
    if (details.open) openKeys.add(key); else openKeys.delete(key);
  });
}

function itemEl(it, openKeys, cfg = DISPLAY_MODES.normal) {
  const div = document.createElement('div');
  if (it.kind === 'user') {
    div.className = 'gui-user';
    div.textContent = it.text;
  } else if (it.kind === 'assistant') {
    // Claude's prose renders as full markdown in every mode; focus hides its
    // intermediate prose by dropping the item upstream, so whatever reaches here is
    // meant to be shown. renderMarkdown is XSS-safe (escapes first); fall back to
    // plain text if the module somehow didn't load.
    div.className = 'gui-asst';
    if (window.renderMarkdown) div.innerHTML = window.renderMarkdown(it.text);
    else div.textContent = it.text;
  } else if (it.kind === 'thinking') {
    div.className = 'gui-think';
    div.innerHTML = `<details${cfg.openThinking ? ' open' : ''}><summary>thinking</summary><div></div></details>`;
    div.querySelector('div').textContent = it.text;
  } else if (it.kind === 'todos') {
    div.className = 'gui-todoblock';
    const ul = document.createElement('ul');
    ul.className = 'gui-todos';
    for (const t of it.todos) {
      const li = document.createElement('li');
      li.className = `todo-${esc(t.status)}`;
      li.textContent = `${TODO_GLYPH[t.status] || '•'} ${t.content}`;
      ul.appendChild(li);
    }
    div.appendChild(ul);
  } else if (it.kind === 'tool') {
    div.className = `gui-tool tool-${esc(it.status)}`;
    const head = `${esc(it.name)} ${esc(keyArg(it.name, it.input))}`;
    div.innerHTML = `<details${cfg.openTools ? ' open' : ''}><summary><span class="tool-dot"></span>${head}</summary>`
      + `<pre class="tool-in"></pre><pre class="tool-out"></pre></details>`;
    div.querySelector('.tool-in').textContent = JSON.stringify(it.input, null, 2);
    div.querySelector('.tool-out').textContent = it.resultText == null ? '' : it.resultText;
    if (it.id != null) wireDetails(div.querySelector('details'), 'tool:' + it.id, openKeys);
  } else {
    div.className = 'gui-unknown';
    div.textContent = '';
  }
  return div;
}

// A7 (pure, unit-tested): split the item list into render segments, collapsing any
// run of 3+ consecutive tool items into one group. Returns an ordered array of
// { type:'group', items:[...] } | { type:'item', item }. Runs of 1–2 stay inline.
function groupConsecutiveTools(items, threshold = 3) {
  const arr = items || [];
  const out = [];
  let i = 0;
  while (i < arr.length) {
    if (arr[i] && arr[i].kind === 'tool') {
      let j = i;
      while (j < arr.length && arr[j] && arr[j].kind === 'tool') j++;
      const run = arr.slice(i, j);
      if (run.length >= threshold) out.push({ type: 'group', items: run });
      else for (const it of run) out.push({ type: 'item', item: it });
      i = j;
    } else {
      out.push({ type: 'item', item: arr[i] });
      i++;
    }
  }
  return out;
}

// A7 (pure, unit-tested): per-turn tool aggregation for focus / focus+. Collapses
// ALL of a turn's tool calls into ONE group placed where the turn's first tool
// occurred, keeping prompts and prose in order. Unlike groupConsecutiveTools, it
// merges a turn's tools even when prose sits between them — so focus+ renders one
// quiet tool summary per turn instead of many per-run groups (which read like
// normal). A turn starts at a user item. Returns the same segment shape.
function groupToolsPerTurn(items) {
  const arr = items || [];
  const out = [];
  let tools = [];
  let insertAt = -1; // index in `out` where this turn's tool group belongs
  const flush = () => {
    if (tools.length) out.splice(insertAt, 0, { type: 'group', items: tools });
    tools = [];
    insertAt = -1;
  };
  for (const it of arr) {
    if (!it) continue;
    if (it.kind === 'user') { flush(); out.push({ type: 'item', item: it }); }
    else if (it.kind === 'tool') { if (insertAt === -1) insertAt = out.length; tools.push(it); }
    else out.push({ type: 'item', item: it });
  }
  flush();
  return out;
}

// A7: a run of 3+ back-to-back tool cards collapses into one group. The group is
// collapsed by default; expanding it reveals the individual tool cards, each still
// its own expandable card. The left border reflects the worst status in the run
// (pending > error > ok) so the user can triage without unfolding.
function toolGroupEl(run, openKeys, cfg = DISPLAY_MODES.normal) {
  const errs = run.filter((t) => t.status === 'error').length;
  const pending = run.some((t) => t.status === 'pending');
  const cls = pending ? 'tg-pending' : errs ? 'tg-error' : 'tg-ok';
  const names = [...new Set(run.map((t) => t.name).filter(Boolean))];
  const namePreview = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
  const details = document.createElement('details');
  details.className = `gui-tool-group ${cls}`;
  const summary = document.createElement('summary');
  summary.innerHTML = '<span class="tg-caret"></span>'
    + `<span class="tg-count">${run.length} tool calls</span>`
    + (errs ? `<span class="tg-fail">· ${errs} failed</span>` : '')
    + `<span class="tg-names">${esc(namePreview)}</span>`;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'gui-tool-group-body';
  for (const it of run) body.appendChild(itemEl(it, openKeys, cfg));
  details.appendChild(body);
  // Key the group by its first tool's id so it stays open as the run grows (A7 + open-state).
  if (run[0] && run[0].id != null) wireDetails(details, 'group:' + run[0].id, openKeys);
  return details;
}

function renderLog(el, model, openKeys, mode) {
  const cfg = modeCfg(mode);
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = '';
  const rawItems = (model && model.items) || [];
  // Compute turn structure on the FULL list (so boundaries stay intact), then drop
  // what the mode hides. In focus this removes intermediate prose + thinking, which
  // makes a turn's tools adjacent so they merge into one per-turn summary group.
  const finals = finalAnswerItems(rawItems);
  const items = filterItemsForMode(rawItems, cfg, finals);
  // focus / focus+ aggregate a whole turn's tools into one summary; normal / verbose
  // group only consecutive runs (threshold).
  const segments = cfg.toolsPerTurn ? groupToolsPerTurn(items) : groupConsecutiveTools(items, cfg.groupThreshold);
  const frag = document.createDocumentFragment();
  for (const seg of segments) {
    frag.appendChild(seg.type === 'group' ? toolGroupEl(seg.items, openKeys, cfg) : itemEl(seg.item, openKeys, cfg));
  }
  el.appendChild(frag);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function mountGui(container, handlers) {
  container.innerHTML =
    '<div class="gui-status"></div>'
    + '<div class="gui-log"></div>'
    + '<div class="gui-waiting" hidden><span class="gui-spinner"></span>Waiting for Claude…</div>'
    + '<form class="gui-compose">'
    + '<div class="gui-compose-input" contenteditable="true" data-placeholder="Message this session…  (Enter to send · Shift/Ctrl+Enter for newline)"></div>'
    + '<button type="submit">Send</button>'
    + '</form>';
  const statusEl = container.querySelector('.gui-status');
  const logEl = container.querySelector('.gui-log');
  const waitEl = container.querySelector('.gui-waiting');
  const form = container.querySelector('.gui-compose');
  const editor = form.querySelector('.gui-compose-input');
  // Open/closed state of expandable tool cards/groups, kept across re-renders so a
  // card the user is reading isn't snapped shut by a new streaming token (reset on
  // session switch — see clear()).
  const openKeys = new Set();
  // Current display mode (FEAT-display-mode) + the last model rendered, so a mode
  // change (from the server preference or the manual override) can re-render the
  // log in place without waiting for the next delta.
  let mode = 'normal';
  let lastModel = null;

  // Topics + in-session todos now render in app.js's floating header panels
  // (the In-session todo / Topics / TODO.MD buttons), not in in-pane panels here.

  // ---- Rich compose editor ---------------------------------------------------
  let tokenCounter = 0;
  let pasteCounter = 0;    // numbers the collapsed-paste chips (H5)
  let imgCtxMenu = null;
  let draggedToken = null; // the .img-token currently being repositioned (A1.7)
  let pastePopup = null;   // the open collapsed-paste preview popup, if any (H5)

  function closeImgCtxMenu() {
    if (imgCtxMenu) { imgCtxMenu.remove(); imgCtxMenu = null; }
  }

  // H5: toggle the read-only preview popup for a collapsed-paste chip. Clicking the
  // same chip again closes it; clicking a different chip switches to it.
  function closePastePopup() {
    if (pastePopup) { pastePopup.remove(); pastePopup = null; }
  }
  function togglePastePopup(token) {
    const wasOpenForThis = pastePopup && pastePopup._token === token;
    closePastePopup();
    if (wasOpenForThis) return;
    const popup = document.createElement('div');
    popup.className = 'paste-popup';
    popup._token = token;
    const head = document.createElement('div');
    head.className = 'paste-popup-head';
    head.textContent = `Pasted text — ${window.pasteSummary(token.dataset.text || '')}`;
    const pre = document.createElement('pre');
    pre.className = 'paste-popup-body';
    pre.textContent = token.dataset.text || '';
    popup.append(head, pre);
    popup.addEventListener('click', (e) => e.stopPropagation()); // clicking inside keeps it open
    document.body.appendChild(popup);
    const rect = token.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8)) + 'px';
    popup.style.top = Math.min(rect.bottom + 4, window.innerHeight - popup.offsetHeight - 8) + 'px';
    pastePopup = popup;
  }

  // Walk the editor's DOM and produce a flat descriptor array.
  // text node → {type:'text'}, BR → {type:'br'}, .img-token → {type:'token'},
  // .paste-token → {type:'pastedtext'}, DIV/P block wrapper → {type:'br'} then recurse.
  function collectDescriptors(node) {
    const out = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out.push({ type: 'text', text: child.textContent });
      } else if (child.nodeName === 'BR') {
        out.push({ type: 'br' });
      } else if (child.nodeType === 1 && child.classList.contains('img-token')) {
        out.push({ type: 'token', path: child.dataset.path });
      } else if (child.nodeType === 1 && child.classList.contains('paste-token')) {
        out.push({ type: 'pastedtext', text: child.dataset.text || '' });
      } else if (child.nodeName === 'DIV' || child.nodeName === 'P') {
        out.push({ type: 'br' });
        out.push(...collectDescriptors(child));
      } else if (child.nodeType === 1) {
        out.push(...collectDescriptors(child));
      }
    }
    return out;
  }

  // Insert an inline non-editable node + a trailing space at the current caret
  // inside the editor (shared by the image token and the collapsed-paste chip).
  function insertInlineAtCaret(node) {
    const space = document.createTextNode(' ');
    const sel = window.getSelection();
    const inEditor = sel && sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (inEditor) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      const r2 = document.createRange();
      r2.setStartAfter(node);
      r2.collapse(true);
      r2.insertNode(space);
      r2.setStartAfter(space);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
    } else {
      editor.appendChild(node);
      editor.appendChild(space);
    }
    editor.focus();
  }

  // Insert an image token span at the current caret inside editor.
  function insertTokenAtCaret(path, name) {
    tokenCounter += 1;
    const span = document.createElement('span');
    span.className = 'img-token';
    span.contentEditable = 'false';
    span.draggable = true;
    span.dataset.path = path;
    span.title = name || path;
    span.textContent = '[Image #' + tokenCounter + ']';
    insertInlineAtCaret(span);
  }

  // H5: insert a collapsed-paste chip standing in for a large pasted block. The full
  // text rides on the chip's dataset (expanded back on send via collectDescriptors);
  // clicking the chip toggles a read-only popup preview.
  function insertPasteTokenAtCaret(text) {
    pasteCounter += 1;
    const span = document.createElement('span');
    span.className = 'paste-token';
    span.contentEditable = 'false';
    span.dataset.text = text;
    span.title = 'Pasted text — click to expand/collapse';
    span.textContent = `[Pasted text #${pasteCounter} · ${window.pasteSummary(text)}]`;
    insertInlineAtCaret(span);
  }

  // Upload a File/Blob via handlers.onUpload, then insert a token at savedRange.
  async function uploadAndInsert(file, savedRange) {
    if (!handlers.onUpload) return;
    let result;
    try {
      result = await handlers.onUpload(file);
    } catch {
      return; // error already routed to errorCenter by app.js
    }
    if (savedRange) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch { /* range may be stale after async gap */ }
    }
    insertTokenAtCaret(result.path, result.name);
  }

  // Map a viewport point to a collapsed Range (caret) — cross-browser.
  function caretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) { const r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true); return r; }
    }
    return null;
  }

  const submit = () => {
    const descriptors = collectDescriptors(editor);
    const text = window.serializeDescriptors(descriptors);
    if (!text.trim()) return;
    handlers.onSend(text);
    editor.innerHTML = '';
    tokenCounter = 0;
    pasteCounter = 0;
    closePastePopup();
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  // Clicking a collapsed-paste chip toggles its preview popup (stop propagation so
  // the document-level click handler doesn't immediately close it again) — H5.
  editor.addEventListener('click', (e) => {
    const token = e.target && e.target.closest && e.target.closest('.paste-token');
    if (token && editor.contains(token)) { e.preventDefault(); e.stopPropagation(); togglePastePopup(token); }
  });
  editor.addEventListener('keydown', (e) => {
    // Don't treat an IME composition's confirming Enter (isComposing / keyCode 229)
    // as a submit — that would send the turn mid-composition.
    if (e.isComposing || e.keyCode === 229) return;
    // Plain Enter submits; Shift+Enter and Ctrl+Enter both insert a newline (B1).
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  // Upload + insert several images in order — a single paste/drop can carry many
  // (A1.5 follow-up). Each insert advances the caret, so the next lands after it.
  async function uploadAndInsertMany(files, savedRange) {
    let range = savedRange;
    for (const f of files) {
      if (!f) continue;
      await uploadAndInsert(f, range);
      const sel = window.getSelection();
      range = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : range;
    }
  }
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const items = [...(e.clipboardData.items || [])];
    const imgFiles = items.filter((it) => it.type.startsWith('image/')).map((it) => it.getAsFile());
    if (imgFiles.length) {
      const sel = window.getSelection();
      const savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
      uploadAndInsertMany(imgFiles, savedRange);
      return;
    }
    // Strip the wrapping quotes Windows "Copy as path" adds to a single path (H6).
    const plain = window.stripPastedPathQuotes(e.clipboardData.getData('text/plain'));
    // Collapse a large pasted block into an expandable chip instead of flooding the
    // editor with the whole blob (H5); ordinary short pastes insert inline.
    if (window.shouldCollapsePaste(plain)) insertPasteTokenAtCaret(plain);
    else document.execCommand('insertText', false, plain);
  });
  // Start repositioning an existing token within the editor (A1.7).
  editor.addEventListener('dragstart', (e) => {
    const token = e.target && e.target.closest && e.target.closest('.img-token');
    if (!token || !editor.contains(token)) return;
    draggedToken = token;
    token.classList.add('dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', token.textContent); // some browsers require data to start a drag
    } catch { /* setData may be restricted; the drag still proceeds */ }
  });
  editor.addEventListener('dragend', () => {
    if (draggedToken) draggedToken.classList.remove('dragging');
    draggedToken = null;
  });
  editor.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedToken) { try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ } }
  });
  editor.addEventListener('drop', (e) => {
    e.preventDefault();
    const dropRange = caretRangeFromPoint(e.clientX, e.clientY);

    // (A1.7) Repositioning a token already in the editor — move the node to the
    // drop caret (no upload). Skip a drop onto the token itself (no-op).
    if (draggedToken && editor.contains(draggedToken)) {
      const token = draggedToken;
      draggedToken = null;
      token.classList.remove('dragging');
      if (dropRange && dropRange.startContainer !== token && !token.contains(dropRange.startContainer)) {
        dropRange.insertNode(token); // a node has one parent, so this moves it
        const space = document.createTextNode(' ');
        const after = document.createRange();
        after.setStartAfter(token);
        after.collapse(true);
        after.insertNode(space);
        after.setStartAfter(space);
        after.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(after);
      }
      editor.focus();
      return;
    }

    // External image-file drop — upload then insert a token at the drop caret.
    const files = [...(e.dataTransfer.files || [])];
    const imgFiles = files.filter((f) => f.type.startsWith('image/'));
    if (!imgFiles.length) return;
    if (dropRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(dropRange); }
    const sel = window.getSelection();
    const savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    uploadAndInsertMany(imgFiles, savedRange);
  });
  editor.addEventListener('contextmenu', (e) => {
    const token = e.target.closest('.img-token');
    if (!token) return; // let native menu show for plain text
    e.preventDefault();
    closeImgCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'img-ctx-menu';
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.textContent = 'Open in default app';
    btn.onclick = () => { closeImgCtxMenu(); if (handlers.onOpenImage) handlers.onOpenImage(token.dataset.path); };
    menu.appendChild(btn);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, window.innerWidth - rect.width - 4) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - rect.height - 4) + 'px';
    imgCtxMenu = menu;
  });
  document.addEventListener('click', () => { closeImgCtxMenu(); closePastePopup(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeImgCtxMenu(); closePastePopup(); } });

  return {
    update(model) { lastModel = model; renderStatus(statusEl, model); renderLog(logEl, model, openKeys, mode); },
    // Switch display mode (focus / normal / verbose) and re-render. Reset per-card
    // open-state to the new mode's defaults: a mode's auto-opened cards (e.g.
    // verbose) otherwise leak into openKeys and stay open after switching to a
    // more-folded mode. (Streaming deltas go through update(), which keeps openKeys,
    // so a card the user opened mid-turn still persists — only an explicit mode
    // change resets.)
    setMode(m) { if (m === mode) return; mode = m; openKeys.clear(); if (lastModel) renderLog(logEl, lastModel, openKeys, mode); },
    clear() { statusEl.innerHTML = ''; statusEl.hidden = true; logEl.innerHTML = ''; waitEl.hidden = true; lastModel = null; closePastePopup(); openKeys.clear(); },
    focusCompose() { editor.focus(); },
    // Show/hide the "Waiting for Claude…" spinner shown between a send and Claude's
    // first output of the turn (H3). Driven by app.js's awaitingResponse logic.
    setWaiting(on) { waitEl.hidden = !on; },
  };
}

// Read-only render of a model into a container (for the quick preview): reuses the
// status + log renderers; no compose box or side panels.
function renderGuiModel(container, model) {
  container.innerHTML = '<div class="gui-status"></div>' + '<div class="gui-log"></div>';
  // The preview re-renders fully on every delta too; keep open-state on the (stable)
  // container so an expanded card/group stays open here as well.
  const openKeys = container._openKeys || (container._openKeys = new Set());
  renderStatus(container.querySelector('.gui-status'), model);
  renderLog(container.querySelector('.gui-log'), model, openKeys);
}

// Dual export (same pattern as compose.js): browser gets globals; node --test can
// require the pure helpers (groupConsecutiveTools) without a DOM.
if (typeof module !== 'undefined' && module.exports) module.exports = { groupConsecutiveTools, groupToolsPerTurn, finalAnswerItems, filterItemsForMode, DISPLAY_MODES, modeCfg };
if (typeof window !== 'undefined') { window.mountGui = mountGui; window.renderGuiModel = renderGuiModel; }
