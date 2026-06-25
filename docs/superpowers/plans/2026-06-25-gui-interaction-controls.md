# GUI Interaction Controls — mode indicator/cycle + interrupt (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the current Claude permission mode in the GUI header and let the user cycle it (Shift+Tab) and interrupt a running turn (Esc) with one click — without dropping to the terminal.

**Architecture:** Client-side. The mode is read live from the focused session's xterm grid footer (xterm already parses ANSI, and its grid reflects the current screen even while the GUI pane overlays it — so absence-of-banner reliably means "normal"). The cycle/interrupt buttons send the matching keystroke to the PTY via the existing `input` WS message (`\x1b[Z` = Shift+Tab, `\x1b` = Esc). No server changes.

**Tech Stack:** vanilla DOM + xterm.js; `node:test` for the one pure function. Same conventions as the rest of the repo.

## Global Constraints

- No new deps, no build step. `npm test` = `node --test --test-force-exit`.
- Per project guideline: after changes, restart the cockpit (`npm start`) so results are current — unconditionally.
- Spec: `docs/superpowers/specs/2026-06-25-gui-interactivity-design.md`. Branch `feat/gui-mode`.
- Validated facts: Shift+Tab = `\x1b[Z` cycles the mode; footer formats — `⏵⏵ accept edits on …` (acceptEdits), `⏸ plan mode on …` (plan), `⏵⏵ auto mode on …` (auto), **no banner = normal**. Esc = `\x1b` interrupts a running turn.

---

## File structure

- `public/modeparse.js` *(new)* — pure `parseClaudeMode(footerText) -> label`. Dual-exported (browser global + `module.exports`) so it loads as a `<script>` AND is unit-testable in node.
- `public/index.html` *(modify)* — load `modeparse.js`; add a mode chip + cycle button + interrupt button to `#session-head`.
- `public/app.js` *(modify)* — read the focused session's xterm footer → update the chip; wire the cycle + interrupt buttons.
- `public/styles.css` *(modify)* — chip + buttons.
- `test/modeparse.test.js` *(new)* — unit tests for `parseClaudeMode`.

---

## Task 1: `parseClaudeMode` (pure, tested)

**Files:** Create `public/modeparse.js`, `test/modeparse.test.js`.

**Interfaces — Produces:** `parseClaudeMode(text) -> 'normal' | 'accept edits' | 'plan' | 'auto'` — scans footer text (already ANSI-stripped by xterm) for the mode banner; returns `'normal'` when no banner is present.

- [ ] **Step 1: Failing test** — `test/modeparse.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseClaudeMode } = require('../public/modeparse');

test('detects accept edits', () => {
  assert.strictEqual(parseClaudeMode('⏵⏵ accept edits on (shift+tab to cycle) · ← for agents'), 'accept edits');
});
test('detects plan mode', () => {
  assert.strictEqual(parseClaudeMode('⏸ plan mode on (shift+tab to cycle)'), 'plan');
});
test('detects auto mode', () => {
  assert.strictEqual(parseClaudeMode('⏵⏵ auto mode on (shift+tab to cycle)'), 'auto');
});
test('no banner => normal', () => {
  assert.strictEqual(parseClaudeMode('← for agents | 5h 53% (26m/14:40) | 7d 1%'), 'normal');
  assert.strictEqual(parseClaudeMode(''), 'normal');
});
test('most recent banner in multi-line footer wins', () => {
  assert.strictEqual(parseClaudeMode('some older line\n⏵⏵ accept edits on (shift+tab to cycle)\n  status'), 'accept edits');
});
```

- [ ] **Step 2: Run, verify FAIL** — `node --test --test-force-exit test/modeparse.test.js` → module not found.

- [ ] **Step 3: Implement `public/modeparse.js`:**

```js
// public/modeparse.js
// Pure: detect Claude's current permission mode from the terminal footer text
// (xterm-translated, no ANSI). No banner present => 'normal'. Dual-exported so it
// works as a browser <script> and is unit-testable in node.
function parseClaudeMode(text) {
  const t = String(text || '');
  if (/\baccept edits on\b/i.test(t)) return 'accept edits';
  if (/\bplan mode on\b/i.test(t)) return 'plan';
  if (/\bauto mode on\b/i.test(t)) return 'auto';
  if (/\bbypass(?:ing)? permissions\b/i.test(t)) return 'bypass';
  return 'normal';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseClaudeMode };
if (typeof window !== 'undefined') window.parseClaudeMode = parseClaudeMode;
```

- [ ] **Step 4: Run, verify PASS** — `node --test --test-force-exit test/modeparse.test.js` → 5 pass.

- [ ] **Step 5: Commit** — `git add public/modeparse.js test/modeparse.test.js && git commit -m "feat(gui): pure parseClaudeMode (footer -> mode)"`

---

## Task 2: Mode chip + cycle button in the header

**Files:** Modify `public/index.html`, `public/app.js`, `public/styles.css`. Browser-verified.

**Interfaces — Consumes:** `parseClaudeMode` (Task 1); the existing `term` (xterm) instance, `focusedId`, and the `output` WS handler.

- [ ] **Step 1: index.html** — load the script and add controls to `#session-head` (before `#mode-switch`):

```html
<script src="/modeparse.js"></script>   <!-- before app.js -->
```
```html
<!-- inside #session-head, before #mode-switch -->
<span id="claude-mode" class="mode-chip" title="Claude permission mode — click to cycle (Shift+Tab)">–</span>
<button id="interrupt-btn" title="Interrupt (Esc)" hidden>⛔ Stop</button>
```

- [ ] **Step 2: app.js — read & display the mode.** Add a helper that reads the focused terminal's bottom rows and updates the chip, and call it on focus + on output for the focused session (debounced via rAF or a short timer):

```js
const claudeModeEl = document.getElementById('claude-mode');
function readClaudeMode() {
  try {
    const buf = term.buffer.active;
    const rows = [];
    const start = Math.max(0, buf.length - 12);
    for (let i = start; i < buf.length; i++) rows.push(buf.getLine(i) ? buf.getLine(i).translateToString(true) : '');
    return parseClaudeMode(rows.join('\n'));
  } catch { return 'normal'; }
}
let modeTimer = null;
function refreshClaudeMode() {
  if (modeTimer) return;
  modeTimer = setTimeout(() => { modeTimer = null; if (claudeModeEl) claudeModeEl.textContent = readClaudeMode(); }, 150);
}
```
Call `refreshClaudeMode()` in the `output` handler when `m.id === focusedId`, and once in `focus()` (after attach). 

- [ ] **Step 3: app.js — cycle button.** The chip is clickable (it IS the cycle control):

```js
claudeModeEl.onclick = () => {
  if (!focusedId) return;
  ws.send(JSON.stringify({ type: 'input', id: focusedId, data: '\x1b[Z' })); // Shift+Tab
  setTimeout(refreshClaudeMode, 250); // re-read after the footer redraws
};
```

- [ ] **Step 4: styles.css** — chip styling:

```css
.mode-chip { cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #2d2d30; border: 1px solid #3c3c3c; color: #c5c5c5; }
.mode-chip:hover { background: #34343a; border-color: #4a4a50; }
#interrupt-btn { background: #5a2d2d; color: #fff; border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
#interrupt-btn:hover { background: #7a3a3a; }
```

- [ ] **Step 5: Browser verify** — `npm start`; create a session. The chip shows `normal`; click it → footer cycles and the chip updates (accept edits → plan → normal …); it also tracks Shift+Tab pressed in the terminal. (No unit test — UI, browser-verified per repo norm.)

- [ ] **Step 6: Commit** — `git add public/index.html public/app.js public/styles.css && git commit -m "feat(gui): Claude mode chip + click-to-cycle (Shift+Tab)"`

---

## Task 3: Interrupt button (Esc)

**Files:** Modify `public/app.js` (and the `#interrupt-btn` added in Task 2). Browser-verified.

**Interfaces — Consumes:** `focusedId`, `sessions`, the `#interrupt-btn` element.

- [ ] **Step 1: app.js — wire the button + visibility.** Show it only while the focused session is `working`; clicking sends Esc:

```js
const interruptBtn = document.getElementById('interrupt-btn');
interruptBtn.onclick = () => { if (focusedId) ws.send(JSON.stringify({ type: 'input', id: focusedId, data: '\x1b' })); };
function refreshInterrupt() {
  const s = sessions.find((x) => x.id === focusedId);
  interruptBtn.hidden = !(s && s.status === 'working');
}
```
Call `refreshInterrupt()` inside `updateHead()` (which already runs on every `sessions` broadcast and on focus).

- [ ] **Step 2: Browser verify** — start a long turn (ask the session to do something slow); the **Stop** button appears while `working`; clicking it interrupts Claude (turn halts); the button hides when idle.

- [ ] **Step 3: Commit** — `git add public/app.js && git commit -m "feat(gui): interrupt (Esc) button while a turn is running"`

---

## Self-review notes (author)

- **Spec coverage:** Phase 1 (mode indicator + cycle) = Tasks 1–2; Phase 3 (interrupt) = Task 3. Phases 2/4/5/6 (AskUserQuestion, plan-accept, autocomplete, MCP) are separate upcoming plans (AskUserQuestion needs empirical keystroke validation first — noted in the spec).
- **Type consistency:** `parseClaudeMode` returns the human label shown in the chip; the cycle/interrupt sends are raw keystrokes via the existing `input` message (no new protocol). `refreshClaudeMode`/`refreshInterrupt` are the only new app.js entry points, both hooked into existing handlers (`output`, `updateHead`).
- **Placeholders:** UI tasks specify the contract + concrete code and are browser-verified (matching the repo's non-unit-tested UI convention); the one pure function (Task 1) is unit-tested.
- **Mode-read reliability:** reading the xterm grid (not the raw ANSI stream) means "no banner = normal" works, because the grid reflects the current footer; reading the bottom 12 rows covers the footer region.
