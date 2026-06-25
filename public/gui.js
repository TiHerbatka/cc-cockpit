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

  // Optional todo checklist under the status line.
  if (Array.isArray(st.todos) && st.todos.length) {
    const ul = document.createElement('ul');
    ul.className = 'gui-todos';
    for (const t of st.todos) {
      const li = document.createElement('li');
      li.className = `todo-${esc(t.status)}`;
      li.textContent = `${TODO_GLYPH[t.status] || '•'} ${t.content}`;
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }
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
    + '<div class="gui-topics-panel" hidden>'
    + '<div class="panel-head"><span class="panel-caret">▾</span> Topics <span class="panel-count"></span>'
    + '<label class="show-resolved"><input type="checkbox"> resolved</label></div>'
    + '<ul class="panel-topics"></ul>'
    + '</div>'
    + '<div class="gui-todos-panel" hidden>'
    + '<div class="panel-head"><span class="panel-caret">▾</span> Todos <span class="panel-count"></span></div>'
    + '<ul class="panel-todos"></ul>'
    + '</div>'
    + '<div class="gui-perm" hidden>'
    + '<div class="perm-head">Permission requested</div>'
    + '<div class="perm-tool"></div>'
    + '<pre class="perm-input"></pre>'
    + '<div class="perm-actions">'
    + '<button class="perm-allow">Allow once</button>'
    + '<button class="perm-remember">Allow, don\'t ask again</button>'
    + '<button class="perm-deny">Deny</button>'
    + '</div>'
    + '<div class="perm-hint">Also visible in the terminal — you can answer there too.</div>'
    + '</div>'
    + '<div class="gui-log"></div>'
    + '<form class="gui-compose">'
    + '<textarea rows="2" placeholder="Message this session…  (Enter to send · Shift+Enter for newline)"></textarea>'
    + '<button type="submit">Send</button>'
    + '</form>';
  const statusEl = container.querySelector('.gui-status');
  const logEl = container.querySelector('.gui-log');
  const form = container.querySelector('.gui-compose');
  const ta = form.querySelector('textarea');

  // ---- native todos panel (D) ----
  const todosPanel = container.querySelector('.gui-todos-panel');
  const todosList = todosPanel.querySelector('.panel-todos');
  const todosCount = todosPanel.querySelector('.panel-count');
  let todosCollapsed = false;
  todosPanel.querySelector('.panel-head').onclick = () => {
    todosCollapsed = !todosCollapsed;
    todosList.hidden = todosCollapsed;
    todosPanel.querySelector('.panel-caret').textContent = todosCollapsed ? '▸' : '▾';
  };
  function renderTodosPanel(model) {
    const todos = (model && model.status && model.status.todos) || null;
    if (!todos || !todos.length) { todosPanel.hidden = true; return; }
    todosPanel.hidden = false;
    const done = todos.filter((t) => t.status === 'completed').length;
    todosCount.textContent = `(${done}/${todos.length})`;
    todosList.innerHTML = '';
    for (const t of todos) {
      const li = document.createElement('li');
      li.className = `todo-${esc(t.status)}`;
      li.textContent = `${TODO_GLYPH[t.status] || '•'} ${t.content}`;
      todosList.appendChild(li);
    }
  }

  // ---- topics panel (B) ----
  const topicsPanel = container.querySelector('.gui-topics-panel');
  const topicsList = topicsPanel.querySelector('.panel-topics');
  const topicsCount = topicsPanel.querySelector('.panel-count');
  const showResolved = topicsPanel.querySelector('.show-resolved input');
  let topicsCollapsed = false;
  let lastTopics = [];
  topicsPanel.querySelector('.panel-head').onclick = (e) => {
    if (e.target.closest('.show-resolved')) return; // the checkbox handles itself
    topicsCollapsed = !topicsCollapsed;
    topicsList.hidden = topicsCollapsed;
    topicsPanel.querySelector('.panel-caret').textContent = topicsCollapsed ? '▸' : '▾';
  };
  function renderTopicsPanel(topics) {
    lastTopics = Array.isArray(topics) ? topics : [];
    if (!lastTopics.length) { topicsPanel.hidden = true; return; }
    const shown = lastTopics.filter((t) => showResolved.checked || t.status !== 'resolved');
    topicsPanel.hidden = false;
    topicsCount.textContent = `(${shown.length})`;
    topicsList.innerHTML = '';
    for (const t of shown) {
      const li = document.createElement('li');
      li.className = `topic-${esc(t.status)}`;
      const dot = t.status === 'active' ? '●' : t.status === 'parked' ? '◐' : '○';
      li.innerHTML = '<span class="topic-row"><span class="topic-code" title="copy code"></span> '
        + '<span class="topic-name"></span> <span class="topic-dot"></span></span>'
        + '<div class="topic-summary" hidden></div>';
      li.querySelector('.topic-code').textContent = t.code || '';
      li.querySelector('.topic-name').textContent = t.name || '';
      li.querySelector('.topic-dot').textContent = dot;
      li.querySelector('.topic-summary').textContent = t.summary || '';
      li.querySelector('.topic-row').onclick = (e) => {
        if (e.target.classList.contains('topic-code')) {
          if (navigator.clipboard) navigator.clipboard.writeText(t.code || '');
          return;
        }
        const sum = li.querySelector('.topic-summary');
        sum.hidden = !sum.hidden;
      };
      topicsList.appendChild(li);
    }
  }
  showResolved.onchange = () => renderTopicsPanel(lastTopics);

  // ---- permission panel ----
  const permEl = container.querySelector('.gui-perm');
  const permTool = permEl.querySelector('.perm-tool');
  const permInput = permEl.querySelector('.perm-input');

  const submit = () => {
    const text = ta.value;
    if (!text.trim()) return;
    handlers.onSend(text);
    ta.value = '';
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  const hidePerm = () => { permEl.hidden = true; };

  return {
    update(model) { renderStatus(statusEl, model); renderLog(logEl, model); renderTodosPanel(model); },
    clear() { statusEl.innerHTML = ''; logEl.innerHTML = ''; hidePerm(); },
    focusCompose() { ta.focus(); },
    // Mirror a native permission prompt. The buttons map to Claude's numbered
    // options (1=Allow, 2=Allow+don't-ask, 3=Deny); onAnswer sends the keystroke.
    showPermission(req, onAnswer) {
      permTool.innerHTML = req.tool ? `Claude wants to use <b>${esc(req.tool)}</b>` : 'Claude is requesting permission';
      permInput.textContent = req.input == null ? '' : truncate(JSON.stringify(req.input, null, 2), 2000);
      const answer = (key) => { onAnswer(key); hidePerm(); };
      permEl.querySelector('.perm-allow').onclick = () => answer('1');
      permEl.querySelector('.perm-remember').onclick = () => answer('2');
      permEl.querySelector('.perm-deny').onclick = () => answer('3');
      permEl.hidden = false;
    },
    hidePermission() { hidePerm(); },
    setTopics(topics) { renderTopicsPanel(topics); },
  };
}

window.mountGui = mountGui;
