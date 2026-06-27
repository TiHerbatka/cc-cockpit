// server/sessions.js
// The session registry, SDK-native: each session owns one streaming driver
// (server/sdk.js) whose message stream is folded into a render model and
// broadcast as deltas. Session state is derived from the stream's turn
// boundaries (a sent turn -> working; a result message -> idle/your-move).
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const projects = require('./projects');
const { sdkMessageToRecords } = require('./sdk');
const { createConversation } = require('./normalize');

class SessionRegistry extends EventEmitter {
  constructor({ spawnDriver, projectsRoot = null }) {
    super();
    this.spawnDriver = spawnDriver;
    this.projectsRoot = projectsRoot;
    this.sessions = new Map();
    this.focusedId = null;
  }

  create(cwd, opts = {}) {
    const id = crypto.randomUUID();
    const label = path.basename(cwd) || cwd;
    // The Claude Code session id (used as the SDK resume id and the transcript
    // filename). Fresh sessions reuse the cockpit id; a resume carries its own.
    const ccSessionId = opts.resumeId || id;
    const driver = this.spawnDriver(cwd, id, { ...opts, ccSessionId });
    const session = {
      id, cwd, label,
      ccSessionId,
      mode: 'gui',         // always GUI this phase (terminal returns as an option later)
      topics: [],          // assistant's per-session topic tracker (from ~/.claude/topics)
      status: 'working',
      conversation: createConversation(), // the live render model + delta fold
      autoTitle: null,     // Claude Code aiTitle (filled in for temp sessions)
      customName: null,    // user-set display name (rename) — wins over the rest
      driver,
      working: true,       // a turn is in progress (send..result)
      waiting: false,      // a permission prompt is pending (-> needs-you; unused this phase)
      ended: false,        // a turn has ended (-> your-move when unfocused)
      acknowledged: false, // focused since waiting/ended began
      exited: false,
    };
    this.sessions.set(id, session);
    driver.onMessage((msg) => this._onMessage(id, msg));
    driver.onExit(() => this.markExited(id));
    if (driver.onError) driver.onError((e) => this._onError(id, e));
    this.emit('sessions');
    return this._public(session);
  }

  // Fold one SDK stream message: init -> mode chip; result -> usage chip + turn
  // end; assistant/user -> conversation deltas.
  _onMessage(id, msg) {
    const s = this.sessions.get(id);
    if (!s || s.exited || !msg || !msg.type) return;
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.permissionMode) this.emit('meta', id, { mode: msg.permissionMode });
      return;
    }
    if (msg.type === 'result') {
      if (msg.usage) this.emit('meta', id, { usage: msg.usage });
      this.markIdle(id);
      return;
    }
    for (const r of sdkMessageToRecords(msg)) {
      const ops = s.conversation.applyRecord(r);
      if (ops.length) this.emit('delta', id, ops);
    }
  }

  _onError(id, err) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.emit('session-error', id, err && err.message ? err.message : String(err));
  }

  // Send a user turn into the live session (structured input replaces keystrokes).
  send(id, text) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.driver.write(text);
    this.markWorking(id);
  }

  // The current render model (full snapshot for attach/resume).
  modelOf(id) {
    const s = this.sessions.get(id);
    return s ? s.conversation.model : null;
  }

  // A turn started.
  markWorking(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = true;
    s.waiting = false;
    s.ended = false;
    s.acknowledged = false;
    this._recompute(s);
  }

  // The turn ended (result message). Unfocused -> your-move.
  markIdle(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = false;
    s.ended = true;
    s.acknowledged = (id === this.focusedId); // focused = already seen
    this._recompute(s);
  }

  // Blocked awaiting a tool-permission decision (-> needs-you). Unused this phase
  // (posture A auto-approves); kept for the controls phase.
  signalWaiting(id) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    s.working = false;
    s.waiting = true;
    s.ended = false;
    s.acknowledged = (id === this.focusedId);
    this._recompute(s);
  }

  // The assistant's tracked topics for this session (from ~/.claude/topics).
  setTopics(id, topics) {
    const s = this.sessions.get(id);
    if (!s) return;
    const next = Array.isArray(topics) ? topics : [];
    if (JSON.stringify(next) === JSON.stringify(s.topics)) return;
    s.topics = next;
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
    if (!s.exited) { try { s.driver.kill(); } catch { /* already gone */ } }
    this.sessions.delete(id);
    if (this.focusedId === id) this.focusedId = null;
    this.emit('sessions');
  }

  get(id) {
    const s = this.sessions.get(id);
    return s ? this._public(s) : null;
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
