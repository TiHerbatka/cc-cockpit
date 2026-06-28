# "Never used" warning chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface cockpit projects that have never recorded session activity, via a warning chip + click-to-list popover in the New-session picker.

**Architecture:** Purely client-side. The New-session picker already loads `projects` from `GET /api/projects` (each with `lastActivity`). The never-used set is `projects.filter(p => !p.lastActivity)`, computed in the browser. A chip in the picker toolbar shows the count (cockpit scope only); clicking it opens a popover listing those projects, each starting a session on click. No server change.

**Tech Stack:** Vanilla JS (`public/app.js`), CSS (`public/styles.css`). No bundler, no build step.

## Global Constraints

- No bundler/build step; plain vanilla client JS loaded via `<script>`; no new dependencies.
- No server-side changes — `lastActivity` is already returned by `GET /api/projects`.
- Client-only edits need only a browser reload (no dev-server restart required), but restarting is harmless.
- Match the existing dark-theme modal styling (reuse the muted aesthetic of `.modal-band`; warning accent in amber).
- Scope is the New-session picker's **Cockpit-projects** scope only; the chip is absent in Discovered-folders scope and when the never-used count is 0.
- The chip count and popover list reflect the full never-used set and ignore the search box.

---

### Task 1: Never-used chip in the picker toolbar

**Files:**
- Modify: `public/app.js` — inside `openNewSessionPicker` (the toolbar HTML string, the post-load render call, and the scope-switch handler).
- Modify: `public/styles.css` — add `.never-used-chip`.

**Interfaces:**
- Consumes: the existing `openNewSessionPicker` locals — `box`, `projects` (array of `{ name, path, lastActivity }`), `scope` (`'cockpit'` | `'discovered'`), and the `.modal-toolbar` element.
- Produces: a `chip` element (`box.querySelector('.never-used-chip')`) and a `renderChip()` function that Task 2 extends; the never-used helper `neverUsed()`.

- [ ] **Step 1: Add the chip element to the toolbar HTML**

In `openNewSessionPicker`, the toolbar string currently reads:

```js
      '<div class="modal-toolbar">' +
        '<input class="modal-search" placeholder="Search by name or path…" />' +
        '<button class="older-toggle">Older than 7 days ▸</button>' +
      '</div>' +
```

Change it to add the chip after the older-toggle:

```js
      '<div class="modal-toolbar">' +
        '<input class="modal-search" placeholder="Search by name or path…" />' +
        '<button class="older-toggle">Older than 7 days ▸</button>' +
        '<button class="never-used-chip" hidden></button>' +
      '</div>' +
```

- [ ] **Step 2: Add the never-used helper, chip handle, and renderChip()**

Immediately after the line `const scopeBtns = [...box.querySelectorAll('.scope-switch button')];`, add:

```js
    const chip = box.querySelector('.never-used-chip');
    const neverUsed = () => projects.filter((p) => !p.lastActivity).sort((a, b) => a.name.localeCompare(b.name));
    const renderChip = () => {
      const nu = scope === 'cockpit' ? neverUsed() : [];
      chip.hidden = nu.length === 0;
      if (nu.length) {
        chip.textContent = `⚠ ${nu.length} never used`;
        chip.title = `${nu.length} project${nu.length > 1 ? 's' : ''} created but never used — click to list`;
      }
    };
```

- [ ] **Step 3: Call renderChip() after projects load and on scope switch**

After projects load, the code reads:

```js
    try {
      const res = await fetch('/api/projects');
      projects = (await res.json()).projects;
      render();
    } catch { cols.textContent = 'Failed to load projects.'; }
```

Add `renderChip();` after `render();`:

```js
    try {
      const res = await fetch('/api/projects');
      projects = (await res.json()).projects;
      render();
      renderChip();
    } catch { cols.textContent = 'Failed to load projects.'; }
```

The scope-switch handler currently reads:

```js
    scopeBtns.forEach((b) => { b.onclick = async () => {
      scope = b.dataset.scope;
      scopeBtns.forEach((x) => x.classList.toggle('active', x === b));
      if (scope === 'discovered') await ensureDiscovered(); else render();
    }; });
```

Add `renderChip();` at the end of the handler body:

```js
    scopeBtns.forEach((b) => { b.onclick = async () => {
      scope = b.dataset.scope;
      scopeBtns.forEach((x) => x.classList.toggle('active', x === b));
      if (scope === 'discovered') await ensureDiscovered(); else render();
      renderChip();
    }; });
```

- [ ] **Step 4: Add chip styling**

Append to `public/styles.css`:

```css
.never-used-chip { font-size: 11px; color: #d9a441; background: rgba(217, 164, 65, 0.12); border: 1px solid rgba(217, 164, 65, 0.4); border-radius: 4px; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.never-used-chip[hidden] { display: none; }
.never-used-chip:hover { background: rgba(217, 164, 65, 0.2); }
```

- [ ] **Step 5: Browser-verify**

Reload `http://127.0.0.1:4477` in the browser. Open **New session**. Expected:
- In **Cockpit projects** scope, the chip reads `⚠ N never used`, where N equals the number of projects shown as "never" (those with no activity; visible under the "Older than 7 days" toggle).
- Switching to **Discovered folders** scope hides the chip.
- If there are zero never-used projects, the chip is absent in both scopes.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: never-used warning chip in the New-session picker (A3)"
```

---

### Task 2: Click-to-list popover

**Files:**
- Modify: `public/app.js` — inside `openNewSessionPicker` (extend the chip block from Task 1).
- Modify: `public/styles.css` — add `.never-used-popover` and related classes.

**Interfaces:**
- Consumes: from Task 1 — `chip`, `neverUsed()`, `renderChip()`; the existing locals `box`, `startIn(cwd)` (spawns a session in `cwd` and closes the modal), and the `.modal-toolbar` element.
- Produces: a `closePopover()` function; the popover is anchored inside `.modal-toolbar`.

- [ ] **Step 1: Add popover state, closePopover(), and dismissal wiring**

Replace the chip block added in Task 1 (Step 2) with this expanded version (adds popover state, `closePopover()`, and folds it into `renderChip()` so scope changes/data reload dismiss any open popover):

```js
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
```

(Escape dismissal is provided by the modal's existing Escape-to-close, which removes the popover along with the modal; the explicit handlers above cover chip re-click, outside-click, and scope switch.)

- [ ] **Step 2: Add popover styling**

Append to `public/styles.css`:

```css
.modal-toolbar { position: relative; }
.never-used-popover { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; min-width: 200px; max-height: 240px; overflow-y: auto; background: #1f1f1f; border: 1px solid rgba(217, 164, 65, 0.4); border-radius: 6px; padding: 6px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
.never-used-head { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #d9a441; padding: 2px 4px 6px; }
.never-used-row { display: block; width: 100%; text-align: left; background: none; border: none; color: #ddd; padding: 5px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.never-used-row:hover { background: rgba(255, 255, 255, 0.06); }
```

(If `.modal-toolbar { position: relative; }` already exists in `styles.css`, do not duplicate it.)

- [ ] **Step 3: Browser-verify**

Reload the page. Open **New session** in Cockpit scope (with at least one never-used project present). Expected:
- Clicking the chip opens a popover headed `Never used (N)` listing exactly the never-used project names.
- Clicking a project in the popover starts a session in that project's folder and closes the modal.
- Re-clicking the chip closes the popover; clicking elsewhere closes it; switching scope closes it.

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "feat: click-to-list popover for never-used projects (A3)"
```

---

## After implementation

Mark TODO A3 (and sub-items A3.1/A3.2/A3.3) done via the todo script once both tasks are browser-verified.
