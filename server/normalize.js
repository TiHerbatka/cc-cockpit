// server/normalize.js
// Turn Claude Code conversation records into the render model the GUI pane
// consumes. Two entry points share one fold:
//   - createConversation(): a stateful fold. applyRecord(record) updates the
//     model and returns the DELTA ops describing the change (live SDK stream);
//     seed(records) folds a batch and returns the model (attach/resume from the
//     on-disk transcript).
//   - normalize(records): the legacy one-shot, re-implemented via seed.
// Kept dependency-free and side-effect-free so it is exhaustively unit-testable.
//
// Model: { title, items, status }
//   items[]: ordered conversation entries
//     { kind: 'user',      text }
//     { kind: 'assistant', text }
//     { kind: 'thinking',  text }
//     { kind: 'tool', id, name, input, status: 'pending'|'ok'|'error', resultText }
//     { kind: 'todos', todos: [{ content, status }] }
//   status: { currentTool: { name, input } | null, todos: [...] | null }
//   title:  last ai-title, else null
//
// Delta ops (returned by applyRecord, applied by the browser to its model copy):
//   { op: 'append', item }            append a conversation item
//   { op: 'update', id, patch }       merge patch into the tool item with that id
//   { op: 'title', title }            set the title
//   { op: 'status', status }          replace the status block

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('').trim();
  }
  return '';
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('');
  }
  return '';
}

function createConversation() {
  const items = [];
  const toolIndex = new Map(); // tool_use_id -> tool item (to fill in its result)
  // Live todo aggregation. Two sources: the native TodoWrite (full snapshot) and
  // the TaskCreate/TaskUpdate system used in this environment (granular ops; the
  // task id arrives in the TaskCreate *result*, later referenced by TaskUpdate).
  const taskMap = new Map(); // taskId -> { content, status }, insertion-ordered
  let usedTasks = false;
  let lastTodoSnapshot = null;
  let title = null;

  function computeStatus() {
    let currentTool = null;
    for (const it of items) {
      if (it.kind === 'tool' && it.status === 'pending') currentTool = { name: it.name, input: it.input };
    }
    // Task* aggregate wins when that system was used; otherwise the last TodoWrite.
    const todos = usedTasks ? [...taskMap.values()] : lastTodoSnapshot;
    return { currentTool, todos };
  }

  // Emit a 'status' op only when the status block actually changes, so a plain
  // user prompt yields just its 'append' op (no spurious status churn).
  let lastStatusKey = JSON.stringify(computeStatus());
  function pushStatusIfChanged(ops) {
    const status = computeStatus();
    const key = JSON.stringify(status);
    if (key !== lastStatusKey) { lastStatusKey = key; ops.push({ op: 'status', status }); }
  }

  function applyRecord(r) {
    const ops = [];
    if (!r || !r.type) return ops;

    if (r.type === 'ai-title' && r.aiTitle) {
      title = r.aiTitle;
      ops.push({ op: 'title', title });
      return ops;
    }

    if (r.type === 'user' && r.message) {
      const content = r.message.content;
      // A user record carrying tool_result blocks resolves pending tools — it is
      // NOT a human prompt.
      if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) {
        for (const c of content) {
          if (c && c.type === 'tool_result') {
            const it = toolIndex.get(c.tool_use_id);
            if (it) {
              it.status = c.is_error ? 'error' : 'ok';
              it.resultText = resultText(c.content);
              ops.push({ op: 'update', id: c.tool_use_id, patch: { status: it.status, resultText: it.resultText } });
              // TaskCreate's assigned id is only in the result text.
              if (it.name === 'TaskCreate' && !c.is_error) {
                const mm = /Task #(\d+) created/i.exec(it.resultText || '');
                if (mm) { usedTasks = true; taskMap.set(mm[1], { content: (it.input && it.input.subject) || '(task)', status: 'pending' }); }
              }
            }
          }
        }
        pushStatusIfChanged(ops);
        return ops;
      }
      const text = textFromContent(content);
      if (text && !text.startsWith('<')) {
        const item = { kind: 'user', text };
        items.push(item);
        ops.push({ op: 'append', item });
      }
      pushStatusIfChanged(ops);
      return ops;
    }

    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const c of r.message.content) {
        if (!c || !c.type) continue;
        if (c.type === 'thinking') {
          if (c.thinking) { const item = { kind: 'thinking', text: c.thinking }; items.push(item); ops.push({ op: 'append', item }); }
        } else if (c.type === 'text') {
          if (c.text && c.text.trim()) { const item = { kind: 'assistant', text: c.text }; items.push(item); ops.push({ op: 'append', item }); }
        } else if (c.type === 'tool_use') {
          if (c.name === 'TodoWrite' && c.input && Array.isArray(c.input.todos)) {
            const item = { kind: 'todos', todos: c.input.todos };
            items.push(item); ops.push({ op: 'append', item });
            lastTodoSnapshot = c.input.todos;
          } else {
            const it = { kind: 'tool', id: c.id, name: c.name, input: c.input, status: 'pending', resultText: null };
            items.push(it); toolIndex.set(c.id, it); ops.push({ op: 'append', item: it });
            if (c.name === 'TaskUpdate' && c.input && c.input.taskId != null) {
              usedTasks = true;
              const tid = String(c.input.taskId);
              if (c.input.status === 'deleted') taskMap.delete(tid);
              else if (taskMap.has(tid)) taskMap.get(tid).status = c.input.status;
            }
          }
        }
      }
      pushStatusIfChanged(ops);
      return ops;
    }

    return ops; // unknown record types ignored
  }

  return {
    applyRecord,
    get model() { return { title, items, status: computeStatus() }; },
    seed(records) { for (const r of records || []) applyRecord(r); return { title, items, status: computeStatus() }; },
  };
}

function normalize(records) {
  return createConversation().seed(records);
}

module.exports = { normalize, createConversation };
