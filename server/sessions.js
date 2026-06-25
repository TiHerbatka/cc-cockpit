// server/sessions.js
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { RingBuffer } = require('./buffer');
const projects = require('./projects');

class SessionRegistry extends EventEmitter {
  constructor({ spawnPty, projectsRoot = null }) {
    super();
    this.spawnPty = spawnPty;
    this.projectsRoot = projectsRoot;
    this.sessions = new Map();
    this.focusedId = null;
  }

  create(cwd, opts = {}) {
    const id = crypto.randomUUID();
    const label = path.basename(cwd) || cwd;
    // The Claude Code session id (used as --session-id and the transcript filename).
    // Fresh sessions reuse the cockpit id; a resume carries its own id. This also
    // makes it equal to CC_COCKPIT_SESSION, so hooks correlate without a lookup.
    const ccSessionId = opts.resumeId || id;
    const pty = this.spawnPty(cwd, id, { ...opts, ccSessionId });
    const session = {
      id, cwd, label,
      ccSessionId,
      mode: 'gui',         // 'gui' (rich pane, default) | 'terminal' (raw PTY fallback)
      topics: [],          // assistant's per-session topic tracker (from ~/.claude/topics)
      status: 'working',
      buffer: new RingBuffer(),
      cols: 120,           // PTY grid size (spawn default; updated by resize).
      rows: 30,            // A preview must match this to replay the stream faithfully.
      autoTitle: null,     // Claude Code aiTitle (filled in for temp sessions).
      customName: null,    // user-set display name (rename) — wins over the rest.
      pty,
      working: true,       // a turn is in progress (UserPromptSubmit..Stop)
      waiting: false,      // a permission prompt is pending (-> needs-you)
      ended: false,        // a turn has ended (-> your-move when unfocused)
      acknowledged: false, // focused since waiting/ended began
      exited: false,
    };
    this.sessions.set(id, session);
    pty.onData((data) => this.appendOutput(id, data));
    pty.onExit(() => this.markExited(id));
    this.emit('sessions');
    return this._public(session);
  }

  // Output is a buffer signal only — never a state signal (that caused the flicker).
  appendOutput(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.buffer.push(data);
    this.emit('output', id, data);
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (s && !s.exited) s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.cols = cols;
    s.rows = rows;
    s.pty.resize(cols, rows);
  }

  // UserPromptSubmit: a turn started.
  markWorking(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = true;
    s.waiting = false;
    s.ended = false;
    s.acknowledged = false;
    this._recompute(s);
  }

  // Stop / Notification:idle_prompt: the turn ended. Unfocused -> your-move.
  markIdle(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = false;
    s.ended = true;
    s.acknowledged = (id === this.focusedId); // focused = already seen
    this._recompute(s);
  }

  // Notification:permission_prompt: blocked awaiting a tool-permission decision.
  signalWaiting(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = true;
    s.ended = false;
    s.acknowledged = (id === this.focusedId); // focused = already seen
    this._recompute(s);
  }

  // The assistant's tracked topics for this session (from ~/.claude/topics).
  // Emits only on change so the poll that feeds it doesn't spam broadcasts.
  setTopics(id, topics) {
    const s = this.sessions.get(id);
    if (!s) return;
    const next = Array.isArray(topics) ? topics : [];
    if (JSON.stringify(next) === JSON.stringify(s.topics)) return;
    s.topics = next;
    this.emit('sessions');
  }

  // GUI vs terminal display mode for one session ('gui' default | 'terminal').
  setMode(id, mode) {
    const s = this.sessions.get(id);
    if (!s || (mode !== 'gui' && mode !== 'terminal') || s.mode === mode) return;
    s.mode = mode;
    this.emit('sessions');
  }

  // Claude Code's auto-title for this session (used to label temp sessions).
  setAutoTitle(id, title) {
    const s = this.sessions.get(id);
    if (!s || s.exited || !title) return;
    const before = this._label(s);
    s.autoTitle = title;
    if (this._label(s) !== before) this.emit('sessions');
  }

  // A user-set display name. Empty/whitespace clears it. Wins over auto/default.
  rename(id, name) {
    const s = this.sessions.get(id);
    if (!s) return;
    const before = this._label(s);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    s.customName = trimmed || null;
    if (this._label(s) !== before) this.emit('sessions');
  }

  // The user focused/attached this session.
  acknowledge(id) {
    this.focusedId = id;
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    if ((s.waiting || s.ended) && !s.acknowledged) {
      s.acknowledged = true;
      this._recompute(s);
    }
  }

  markExited(id) {
    const s = this.sessions.get(id);
    if (s && !s.exited) {
      s.exited = true;
      this._recompute(s);
    }
  }

  // Kill (if live) and drop a session from the cockpit.
  remove(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!s.exited) { try { s.pty.kill(); } catch { /* already gone */ } }
    this.sessions.delete(id);
    if (this.focusedId === id) this.focusedId = null;
    this.emit('sessions');
  }

  get(id) {
    const s = this.sessions.get(id);
    return s ? this._public(s) : null;
  }

  bufferOf(id) {
    const s = this.sessions.get(id);
    return s ? s.buffer.getAll() : '';
  }

  // The PTY grid size, so a preview can size its terminal to match the stream.
  sizeOf(id) {
    const s = this.sessions.get(id);
    return s ? { cols: s.cols, rows: s.rows } : { cols: 120, rows: 30 };
  }

  list() {
    return [...this.sessions.values()].map((s) => this._public(s));
  }

  // First path segment under projectsRoot, or null (root itself / outside / no root).
  projectOf(cwd) {
    if (!this.projectsRoot || !cwd) return null;
    const rel = path.relative(this.projectsRoot, cwd);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(/[\\/]/)[0];
  }

  _derive(s) {
    if (s.exited) return 'exited';
    if (s.waiting) return s.acknowledged ? 'idle' : 'needs-you';
    if (s.ended) return s.acknowledged ? 'idle' : 'your-move';
    if (s.working) return 'working';
    return 'idle';
  }

  _recompute(s) {
    const next = this._derive(s);
    if (next !== s.status) {
      s.status = next;
      this.emit('sessions');
    }
  }

  // Displayed name: user rename > Claude auto-title > folder-basename default.
  _label(s) {
    return s.customName || s.autoTitle || s.label;
  }

  _public(s) {
    const temp = (this.projectsRoot && projects.isTemp(s.cwd, this.projectsRoot)) || false;
    return {
      id: s.id,
      cwd: s.cwd,
      label: this._label(s),
      status: s.status,
      ccSessionId: s.ccSessionId,
      mode: s.mode,
      topics: s.topics,
      project: temp ? null : this.projectOf(s.cwd),
      temp,
    };
  }
}

module.exports = { SessionRegistry };
