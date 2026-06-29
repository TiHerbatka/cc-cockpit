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
  el.innerHTML = bits.join('') || '<span class="gui-muted">waiting for activity…</span>';
}

function itemEl(it) {
  const div = document.createElement('div');
  if (it.kind === 'user') {
    div.className = 'gui-user';
    div.textContent = it.text;
  } else if (it.kind === 'assistant') {
    div.className = 'gui-asst';
    div.textContent = it.text; // textContent preserves text safely; CSS keeps newlines
  } else if (it.kind === 'thinking') {
    div.className = 'gui-think';
    div.innerHTML = `<details><summary>thinking</summary><div></div></details>`;
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
    div.innerHTML = `<details><summary><span class="tool-dot"></span>${head}</summary>`
      + `<pre class="tool-in"></pre><pre class="tool-out"></pre></details>`;
    div.querySelector('.tool-in').textContent = JSON.stringify(it.input, null, 2);
    div.querySelector('.tool-out').textContent = it.resultText == null ? '' : it.resultText;
  } else {
    div.className = 'gui-unknown';
    div.textContent = '';
  }
  return div;
}

function renderLog(el, model) {
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = '';
  const items = (model && model.items) || [];
  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(itemEl(it));
  el.appendChild(frag);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function mountGui(container, handlers) {
  container.innerHTML =
    '<div class="gui-status"></div>'
    + '<div class="gui-perm" hidden>'
    + '<div class="perm-head">Permission requested</div>'
    + '<div class="perm-tool"></div>'
    + '<pre class="perm-input"></pre>'
    + '<div class="perm-actions">'
    + '<button class="perm-allow">Allow once</button>'
    + '<button class="perm-remember">Allow, don\'t ask again</button>'
    + '<button class="perm-deny">Deny</button>'
    + '</div>'
    + '<div class="perm-hint">Allow once, allow &amp; remember, or deny this tool.</div>'
    + '</div>'
    + '<div class="gui-log"></div>'
    + '<form class="gui-compose">'
    + '<div class="gui-compose-input" contenteditable="true" data-placeholder="Message this session…  (Enter to send · Shift/Ctrl+Enter for newline)"></div>'
    + '<button type="submit">Send</button>'
    + '</form>';
  const statusEl = container.querySelector('.gui-status');
  const logEl = container.querySelector('.gui-log');
  const form = container.querySelector('.gui-compose');
  const editor = form.querySelector('.gui-compose-input');

  // Topics + in-session todos now render in app.js's floating header panels
  // (the In-session todo / Topics / TODO.MD buttons), not in in-pane panels here.

  // ---- permission panel ----
  const permEl = container.querySelector('.gui-perm');
  const permTool = permEl.querySelector('.perm-tool');
  const permInput = permEl.querySelector('.perm-input');

  // ---- Rich compose editor ---------------------------------------------------
  let tokenCounter = 0;
  let imgCtxMenu = null;
  let draggedToken = null; // the .img-token currently being repositioned (A1.7)

  function closeImgCtxMenu() {
    if (imgCtxMenu) { imgCtxMenu.remove(); imgCtxMenu = null; }
  }

  // Walk the editor's DOM and produce a flat descriptor array.
  // text node → {type:'text'}, BR → {type:'br'}, .img-token → {type:'token'},
  // DIV/P block wrapper → {type:'br'} then recurse children.
  function collectDescriptors(node) {
    const out = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out.push({ type: 'text', text: child.textContent });
      } else if (child.nodeName === 'BR') {
        out.push({ type: 'br' });
      } else if (child.nodeType === 1 && child.classList.contains('img-token')) {
        out.push({ type: 'token', path: child.dataset.path });
      } else if (child.nodeName === 'DIV' || child.nodeName === 'P') {
        out.push({ type: 'br' });
        out.push(...collectDescriptors(child));
      } else if (child.nodeType === 1) {
        out.push(...collectDescriptors(child));
      }
    }
    return out;
  }

  // Insert an image token span + trailing space at the current caret inside editor.
  function insertTokenAtCaret(path, name) {
    tokenCounter += 1;
    const span = document.createElement('span');
    span.className = 'img-token';
    span.contentEditable = 'false';
    span.draggable = true;
    span.dataset.path = path;
    span.title = name || path;
    span.textContent = '[Image #' + tokenCounter + ']';
    const space = document.createTextNode(' ');
    const sel = window.getSelection();
    const inEditor = sel && sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (inEditor) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(span);
      const r2 = document.createRange();
      r2.setStartAfter(span);
      r2.collapse(true);
      r2.insertNode(space);
      r2.setStartAfter(space);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
    } else {
      editor.appendChild(span);
      editor.appendChild(space);
    }
    editor.focus();
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
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  editor.addEventListener('keydown', (e) => {
    // Don't treat an IME composition's confirming Enter (isComposing / keyCode 229)
    // as a submit — that would send the turn mid-composition.
    if (e.isComposing || e.keyCode === 229) return;
    // Plain Enter submits; Shift+Enter and Ctrl+Enter both insert a newline (B1).
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const items = [...(e.clipboardData.items || [])];
    const imgItem = items.find((it) => it.type.startsWith('image/'));
    if (imgItem) {
      const sel = window.getSelection();
      const savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
      uploadAndInsert(imgItem.getAsFile(), savedRange);
      return;
    }
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
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
    const imgFile = files.find((f) => f.type.startsWith('image/'));
    if (!imgFile) return;
    if (dropRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(dropRange); }
    const sel = window.getSelection();
    const savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    uploadAndInsert(imgFile, savedRange);
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
  document.addEventListener('click', closeImgCtxMenu);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeImgCtxMenu(); });

  const hidePerm = () => { permEl.hidden = true; };

  return {
    update(model) { renderStatus(statusEl, model); renderLog(logEl, model); },
    clear() { statusEl.innerHTML = ''; logEl.innerHTML = ''; hidePerm(); },
    focusCompose() { editor.focus(); },
    // Mirror a native permission prompt. The buttons map to Claude's numbered
    // options (1=Allow, 2=Allow+don't-ask, 3=Deny); onAnswer sends the keystroke.
    showPermission(req, onAnswer) {
      permTool.innerHTML = req.toolName ? `Claude wants to use <b>${esc(req.toolName)}</b>` : 'Claude is requesting permission';
      permInput.textContent = req.input == null ? '' : truncate(JSON.stringify(req.input, null, 2), 2000);
      const answer = (decision) => { onAnswer(decision); hidePerm(); };
      permEl.querySelector('.perm-allow').onclick = () => answer('allow');
      permEl.querySelector('.perm-remember').onclick = () => answer('allow-always');
      permEl.querySelector('.perm-deny').onclick = () => answer('deny');
      permEl.hidden = false;
    },
    hidePermission() { hidePerm(); },
  };
}

// Read-only render of a model into a container (for the quick preview): reuses the
// status + log renderers; no compose box or side panels.
function renderGuiModel(container, model) {
  container.innerHTML = '<div class="gui-status"></div><div class="gui-log"></div>';
  renderStatus(container.querySelector('.gui-status'), model);
  renderLog(container.querySelector('.gui-log'), model);
}

window.mountGui = mountGui;
window.renderGuiModel = renderGuiModel;
