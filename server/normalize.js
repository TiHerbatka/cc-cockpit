// server/normalize.js
// Pure: turn raw Claude Code transcript JSONL records into a render model the GUI
// pane consumes. Kept dependency-free and side-effect-free so it is exhaustively
// unit-testable against real record shapes.
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

function normalize(records) {
  const items = [];
  const toolIndex = new Map(); // tool_use_id -> tool item (to fill in its result)
  // Live todo aggregation. Two sources: the native TodoWrite (full snapshot) and
  // the TaskCreate/TaskUpdate system used in this environment (granular ops; the
  // task id arrives in the TaskCreate *result*, later referenced by TaskUpdate).
  const taskMap = new Map();    // taskId -> { content, status }, insertion-ordered
  let usedTasks = false;
  let lastTodoSnapshot = null;
  let title = null;

  for (const r of records || []) {
    if (!r || !r.type) continue;

    if (r.type === 'ai-title' && r.aiTitle) { title = r.aiTitle; continue; }

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
              // TaskCreate's assigned id is only in the result text.
              if (it.name === 'TaskCreate' && !c.is_error) {
                const mm = /Task #(\d+) created/i.exec(it.resultText || '');
                if (mm) { usedTasks = true; taskMap.set(mm[1], { content: (it.input && it.input.subject) || '(task)', status: 'pending' }); }
              }
            }
          }
        }
        continue;
      }
      const text = textFromContent(content);
      if (text && !text.startsWith('<')) items.push({ kind: 'user', text });
      continue;
    }

    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const c of r.message.content) {
        if (!c || !c.type) continue;
        if (c.type === 'thinking') {
          if (c.thinking) items.push({ kind: 'thinking', text: c.thinking });
        } else if (c.type === 'text') {
          if (c.text && c.text.trim()) items.push({ kind: 'assistant', text: c.text });
        } else if (c.type === 'tool_use') {
          if (c.name === 'TodoWrite' && c.input && Array.isArray(c.input.todos)) {
            items.push({ kind: 'todos', todos: c.input.todos });
            lastTodoSnapshot = c.input.todos;
          } else {
            const it = { kind: 'tool', id: c.id, name: c.name, input: c.input, status: 'pending', resultText: null };
            items.push(it);
            toolIndex.set(c.id, it);
            if (c.name === 'TaskUpdate' && c.input && c.input.taskId != null) {
              usedTasks = true;
              const tid = String(c.input.taskId);
              if (c.input.status === 'deleted') taskMap.delete(tid);
              else if (taskMap.has(tid)) taskMap.get(tid).status = c.input.status;
            }
          }
        }
      }
      continue;
    }
  }

  let currentTool = null;
  for (const it of items) {
    if (it.kind === 'tool' && it.status === 'pending') currentTool = { name: it.name, input: it.input };
  }
  // Task* aggregate wins when that system was used; otherwise the last TodoWrite.
  const todos = usedTasks ? [...taskMap.values()] : lastTodoSnapshot;
  return { title, items, status: { currentTool, todos } };
}

module.exports = { normalize };
