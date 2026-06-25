# Image Paste & Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user paste or drop an image onto the GUI compose box; it is saved under the session's cwd and shown as a terminal-style `[Image #N]` token that serializes to the file path on submit and can be opened from a right-click menu.

**Architecture:** Two independent tracks. **Track A (server)** adds a pure `server/uploads.js` helper module plus a `POST /api/upload-image` endpoint and a WS `open-image` message in `server/app.js`. **Track B (client)** adds a pure `public/compose.js` serializer plus a `contenteditable` rewrite of the compose box in `public/gui.js`, wiring in `public/app.js`, a `<script>` include in `public/index.html`, and styles. The two tracks touch disjoint files and communicate only through the interface contract below, so they are built in parallel and integrated last.

**Tech Stack:** Plain Node (no bundler), `node --test` runner, `ws`, browser DOM (`contenteditable`, Clipboard/DataTransfer). Dual CommonJS/`window` export for browser modules (mirror `public/modeparse.js`).

**Spec:** `docs/superpowers/specs/2026-06-25-image-paste-upload-design.md`

## Global Constraints

- No bundler/build step; no new runtime dependencies. Tests use the built-in `node --test` runner only.
- Server binds `127.0.0.1` only (unchanged). cwd is always resolved server-side from the registry by `id` — never trusted from the client.
- Keep files small and single-responsibility. Follow existing patterns in the file you are editing.
- Keep the existing suite green (currently **120/120**). Do **not** run `git` — the orchestrator integrates and commits.

## Interface contract (shared by both tracks — implement exactly)

**HTTP** `POST /api/upload-image`
- Request JSON: `{ id: string, name?: string, mime: string, dataBase64: string }`
- Success: `201 { path: string /* absolute */, name: string }`
- Errors: `400 { error }` (bad json / unknown id / non-image / empty data), `413 { error }` (over cap), `500 { error }` (write failure).

**WS** `{ type: 'open-image', id: string, path: string }`
- Server opens the file via the injected `openFile` **only** when `uploads.isWithinUploads(session.cwd, path)` and the file exists; otherwise replies `{ type: 'error', message }`.

**`server/uploads.js` exports** — `UPLOAD_DIRNAME` (`'uploaded-images'`), `MAX_BYTES` (`25*1024*1024`), `extFromMime(mime)`, `isImageMime(mime)`, `safeName(name)`, `buildAutoName(date, ext)`, `resolveUploadName(dir, desiredName)`, `isWithinUploads(cwd, candidate)`.

**`public/compose.js` exports** — `quotePath(p)`, `serializeDescriptors(descriptors)` where each descriptor is `{type:'text', text}` | `{type:'br'}` | `{type:'token', path}`.

---

# Track A — Server (built by Subagent A)

## File structure
- Create `server/uploads.js` — pure storage/path helpers (one fs existence check + path math; no other I/O).
- Modify `server/app.js` — add the `POST /api/upload-image` route and the WS `open-image` case; `require('./uploads')`.
- Create `test/uploads.test.js` — unit tests for the pure helpers.
- Modify `test/app.test.js` — endpoint + `open-image` integration tests (follow the existing `open-folder` test as the template for harness/setup).

### Task A1: `server/uploads.js` pure helpers

**Files:** Create `server/uploads.js`; Test `test/uploads.test.js`.

**Produces:** the exports listed in the interface contract.

- [ ] **Step 1 — Write the failing test** `test/uploads.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const uploads = require('../server/uploads');

test('extFromMime maps known mimes, strips params, defaults to .png', () => {
  assert.equal(uploads.extFromMime('image/png'), '.png');
  assert.equal(uploads.extFromMime('image/jpeg'), '.jpg');
  assert.equal(uploads.extFromMime('image/webp'), '.webp');
  assert.equal(uploads.extFromMime('image/gif'), '.gif');
  assert.equal(uploads.extFromMime('image/jpeg; charset=binary'), '.jpg');
  assert.equal(uploads.extFromMime('application/octet-stream'), '.png');
  assert.equal(uploads.extFromMime(''), '.png');
});

test('isImageMime', () => {
  assert.equal(uploads.isImageMime('image/png'), true);
  assert.equal(uploads.isImageMime('image/svg+xml'), true);
  assert.equal(uploads.isImageMime('text/plain'), false);
  assert.equal(uploads.isImageMime(''), false);
});

test('safeName reduces to a sanitized basename', () => {
  assert.equal(uploads.safeName('photo.png'), 'photo.png');
  assert.equal(uploads.safeName('../../etc/passwd'), 'passwd');
  assert.equal(uploads.safeName('C:\\Users\\x\\a.png'), 'a.png');
  assert.equal(uploads.safeName('a/b/c.png'), 'c.png');
  assert.equal(uploads.safeName('bad:name?.png'), 'badname.png');
  assert.equal(uploads.safeName(''), '');
  assert.equal(uploads.safeName(null), '');
});

test('buildAutoName formats with an injected date', () => {
  const d = new Date(2026, 5, 25, 9, 7, 3); // month is 0-based -> June
  assert.equal(uploads.buildAutoName(d, '.png'), '2026-06-25 09-07-03.png');
});

test('resolveUploadName suffixes on collision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a.png');
  fs.writeFileSync(path.join(dir, 'a.png'), 'x');
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a (2).png');
  fs.writeFileSync(path.join(dir, 'a (2).png'), 'x');
  assert.equal(uploads.resolveUploadName(dir, 'a.png'), 'a (3).png');
});

test('isWithinUploads guards the uploaded-images dir', () => {
  const cwd = path.resolve('/projects/demo');
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images', 'a.png')), true);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images', 'sub', 'a.png')), true);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'secret.txt')), false);
  assert.equal(uploads.isWithinUploads(cwd, path.join(cwd, 'uploaded-images')), false);
  assert.equal(uploads.isWithinUploads(cwd, '/etc/passwd'), false);
});
```

- [ ] **Step 2 — Run it, verify it fails:** `node --test test/uploads.test.js` → FAIL (`Cannot find module '../server/uploads'`).

- [ ] **Step 3 — Implement** `server/uploads.js`:

```js
// server/uploads.js — pure helpers for image-upload storage. The only I/O is the
// fs existence check in resolveUploadName; everything else is string/path math.
const path = require('node:path');
const fs = require('node:fs');

const UPLOAD_DIRNAME = 'uploaded-images';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB decoded cap

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp',
  'image/svg+xml': '.svg', 'image/tiff': '.tiff',
};

const normMime = (mime) => String(mime || '').toLowerCase().split(';')[0].trim();
function extFromMime(mime) { return MIME_EXT[normMime(mime)] || '.png'; }
function isImageMime(mime) { return /^image\//.test(normMime(mime)); }

function safeName(name) {
  if (!name || typeof name !== 'string') return '';
  const base = name.replace(/\\/g, '/').split('/').pop();
  return base.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim();
}

const pad = (n) => String(n).padStart(2, '0');
function buildAutoName(date, ext) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}${ext}`;
}

function resolveUploadName(dir, desiredName) {
  const ext = path.extname(desiredName);
  const stem = desiredName.slice(0, desiredName.length - ext.length);
  let candidate = desiredName, n = 2;
  while (fs.existsSync(path.join(dir, candidate))) { candidate = `${stem} (${n})${ext}`; n += 1; }
  return candidate;
}

function isWithinUploads(cwd, candidate) {
  const root = path.resolve(cwd, UPLOAD_DIRNAME);
  const rel = path.relative(root, path.resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  UPLOAD_DIRNAME, MAX_BYTES, extFromMime, isImageMime, safeName,
  buildAutoName, resolveUploadName, isWithinUploads,
};
```

- [ ] **Step 4 — Run it, verify it passes:** `node --test test/uploads.test.js` → PASS (all assertions).

### Task A2: `POST /api/upload-image`

**Files:** Modify `server/app.js` (add `require('./uploads')` near the other requires; add the route alongside the existing `POST /api/projects` block ~line 102); Test: add to `test/app.test.js`.

**Consumes:** `registry.get(id).cwd`; `uploads.*`. **Produces:** the HTTP contract above.

- [ ] **Step 1 — Write the failing test** in `test/app.test.js` (follow the existing harness/bootstrap used by the `open-folder` test — same `createApp({ spawnPty: fakePty, openFile, openInExplorer })`, same listen-on-ephemeral-port + create-a-session setup). Test body:

```js
// Create a session in a tmp cwd (via the same mechanism the open-folder test uses),
// grab its id, then:
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'); // tiny PNG-ish bytes
const res = await postJson(base, '/api/upload-image', { id, mime: 'image/png', dataBase64: png });
assert.equal(res.status, 201);
assert.ok(path.isAbsolute(res.body.path));
assert.ok(fs.existsSync(res.body.path));
assert.match(res.body.name, /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/); // auto-named
assert.equal(path.dirname(res.body.path), path.join(sessionCwd, 'uploaded-images'));
// rejects
assert.equal((await postJson(base, '/api/upload-image', { id, mime: 'text/plain', dataBase64: png })).status, 400);
assert.equal((await postJson(base, '/api/upload-image', { id: 'nope', mime: 'image/png', dataBase64: png })).status, 400);
```

(If a `postJson` helper does not already exist in the file, add a tiny one using `http.request`.)

- [ ] **Step 2 — Run it, verify it fails:** `node --test test/app.test.js` → the new assertions FAIL (404/no route).

- [ ] **Step 3 — Implement** the route in `server/app.js` (place after the `POST /api/projects` block):

```js
if (req.method === 'POST' && urlPath === '/api/upload-image') {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const fail = (code, error) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error })); };
    let m; try { m = JSON.parse(body); } catch { return fail(400, 'bad json'); }
    const s = registry.get(m && m.id);
    if (!s) return fail(400, 'unknown session');
    if (!uploads.isImageMime(m.mime)) return fail(400, 'not an image');
    const buf = Buffer.from(String(m.dataBase64 || ''), 'base64');
    if (!buf.length) return fail(400, 'no data');
    if (buf.length > uploads.MAX_BYTES) return fail(413, 'too large');
    try {
      const dir = path.join(s.cwd, uploads.UPLOAD_DIRNAME);
      fs.mkdirSync(dir, { recursive: true });
      const ext = uploads.extFromMime(m.mime);
      let desired = uploads.safeName(m.name);
      if (desired && !path.extname(desired)) desired += ext;
      if (!desired) desired = uploads.buildAutoName(new Date(), ext);
      const name = uploads.resolveUploadName(dir, desired);
      const full = path.join(dir, name);
      fs.writeFileSync(full, buf);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: full, name }));
    } catch (e) { fail(500, String(e && e.message || e)); }
  });
  return;
}
```

- [ ] **Step 4 — Run it, verify it passes:** `node --test test/app.test.js` → PASS.

### Task A3: WS `open-image`

**Files:** Modify `server/app.js` (add a branch in the `ws.on('message')` dispatch right after the existing `open-file` branch ~line 230); Test: add to `test/app.test.js`.

**Consumes:** `registry.get(id).cwd`, injected `openFile`, `uploads.isWithinUploads`.

- [ ] **Step 1 — Write the failing test** (mirror the `open-folder` test that asserts the injected opener is called with the cwd). Create a real file at `<cwd>/uploaded-images/x.png`, then:

```js
// inDir path -> openFile called with it
ws.send(JSON.stringify({ type: 'open-image', id, path: insidePath }));
// assert (await opened) === insidePath
// outside path -> opener NOT called, an { type:'error' } is received
ws.send(JSON.stringify({ type: 'open-image', id, path: path.join(sessionCwd, 'secret.txt') }));
```

Inject `openFile` as a spy: `createApp({ ..., openFile: (f) => { openedPath = f; } })`.

- [ ] **Step 2 — Run it, verify it fails:** `node --test test/app.test.js` → new `open-image` assertions FAIL.

- [ ] **Step 3 — Implement** (after the `open-file` branch):

```js
} else if (m.type === 'open-image') {
  const s = registry.get(m.id);
  if (s && typeof m.path === 'string' && uploads.isWithinUploads(s.cwd, m.path) && fs.existsSync(m.path)) {
    openFile(m.path);
  } else {
    ws.send(JSON.stringify({ type: 'error', message: 'cannot open image' }));
  }
}
```

- [ ] **Step 4 — Run the full server suite, verify green:** `node --test test/uploads.test.js test/app.test.js` → PASS. (Do not commit; the orchestrator integrates.)

---

# Track B — Client (built by Subagent B)

## File structure
- Create `public/compose.js` — pure `quotePath` + `serializeDescriptors` (dual CommonJS/`window`, mirror `public/modeparse.js`).
- Create `test/compose.test.js` — unit tests for the pure serializer.
- Modify `public/index.html` — add `<script src="compose.js"></script>` **before** `gui.js`/`app.js` (match how `modeparse.js`/`usageparse.js` are included).
- Modify `public/gui.js` — replace the compose `<textarea>` (lines ~130-137, 213-222) with a `contenteditable` editor; add paste/drop/token/context-menu; submit reads the serialized string.
- Modify `public/app.js` — add the `fetch` upload helper and the `onOpenImage` handler wiring (`mountGui(..., { onSend, onOpenImage })`).
- Modify `public/styles.css` — `.gui-compose-input`, `.img-token`, `.img-ctx-menu`.

### Task B1: `public/compose.js` pure serializer

**Files:** Create `public/compose.js`; Test `test/compose.test.js`.

**Produces:** `quotePath(p)`, `serializeDescriptors(descriptors)`.

- [ ] **Step 1 — Write the failing test** `test/compose.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { quotePath, serializeDescriptors } = require('../public/compose');

test('quotePath quotes paths containing whitespace, leaves others bare', () => {
  assert.equal(quotePath('C:\\a\\b.png'), 'C:\\a\\b.png');
  assert.equal(quotePath('C:\\a b\\2026-06-25 09-07-03.png'), '"C:\\a b\\2026-06-25 09-07-03.png"');
  assert.equal(quotePath(''), '');
  assert.equal(quotePath(null), '');
});

test('serializeDescriptors: text + br->\\n + token->quoted path, in order', () => {
  assert.equal(serializeDescriptors([]), '');
  assert.equal(serializeDescriptors([{ type: 'text', text: 'hi' }]), 'hi');
  assert.equal(serializeDescriptors([{ type: 'br' }]), '\n');
  assert.equal(serializeDescriptors([
    { type: 'text', text: 'look ' },
    { type: 'token', path: 'C:\\imgs\\a b.png' },
    { type: 'text', text: ' here' },
  ]), 'look "C:\\imgs\\a b.png" here');
  assert.equal(serializeDescriptors([
    { type: 'token', path: '/p/one.png' }, { type: 'text', text: ' and ' }, { type: 'token', path: '/p/two.png' },
  ]), '/p/one.png and /p/two.png');
});
```

- [ ] **Step 2 — Run it, verify it fails:** `node --test test/compose.test.js` → FAIL (module missing).

- [ ] **Step 3 — Implement** `public/compose.js` (match the dual-export shape of `public/modeparse.js` — read that file first):

```js
// public/compose.js — pure helpers for the rich compose box. Dual export so
// node --test can require it and the browser gets globals (mirror modeparse.js).
function quotePath(p) {
  const s = String(p == null ? '' : p);
  return /\s/.test(s) ? '"' + s + '"' : s;
}
// descriptors: Array<{type:'text', text} | {type:'br'} | {type:'token', path}>
function serializeDescriptors(descriptors) {
  let out = '';
  for (const d of (descriptors || [])) {
    if (!d) continue;
    if (d.type === 'text') out += (d.text || '');
    else if (d.type === 'br') out += '\n';
    else if (d.type === 'token') out += quotePath(d.path);
  }
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { quotePath, serializeDescriptors };
if (typeof window !== 'undefined') { window.quotePath = quotePath; window.serializeDescriptors = serializeDescriptors; }
```

- [ ] **Step 4 — Run it, verify it passes:** `node --test test/compose.test.js` → PASS.

### Task B2: contenteditable compose + paste/drop/token (browser-verified)

**Files:** Modify `public/gui.js`; add the `<script>` to `public/index.html`.

**Consumes (from B1):** `window.serializeDescriptors`. **Consumes (from Track A contract):** `POST /api/upload-image`. **Produces:** an `onOpenImage(path)` callback fired from the token context menu (wired in B3).

Implement, following the existing `gui.js` style:

- [ ] **Step 1 — Markup:** replace the compose form's `<textarea rows="2" placeholder="…">` with `<div class="gui-compose-input" contenteditable="true" data-placeholder="Message this session…  (Enter to send · Shift+Enter for newline)"></div>`. Update the `const ta = form.querySelector('textarea')` reference to the new `.gui-compose-input` element (call it `editor`). Add the `<script src="compose.js"></script>` to `index.html` before `gui.js`.

- [ ] **Step 2 — Keys:** `editor.addEventListener('keydown', …)` — plain Enter (no Shift) → `preventDefault()` + `submit()`; Shift+Enter → `document.execCommand('insertLineBreak')` and `preventDefault()`.

- [ ] **Step 3 — Plain-text paste:** on `paste`, if there is **no** image item, `preventDefault()` and `document.execCommand('insertText', false, clipboardData.getData('text/plain'))` (keeps the editor plain-text-only).

- [ ] **Step 4 — Image attach (paste & drop):** factor an `uploadAndInsert(file)`:
  - read the `File`/blob → base64 (`FileReader.readAsDataURL`, strip the `data:…;base64,` prefix); `mime = file.type`; `name = file.name || undefined`.
  - `POST /api/upload-image` with `{ id: currentSessionId, name, mime, dataBase64 }`; on non-2xx, call the error sink (B3) and insert nothing.
  - on success insert a token node (Step 5) at the current caret (paste) or the drop caret (drop).
  - `paste`: if `clipboardData.items` has an `image/*`, `preventDefault()` and `uploadAndInsert(item.getAsFile())`.
  - `drop`: if `dataTransfer.files` has `image/*`, `preventDefault()`, place caret at the drop point (`document.caretRangeFromPoint`) and `uploadAndInsert(file)`. Also handle `dragover` with `preventDefault()` so drop fires.

- [ ] **Step 5 — Token node + context menu:** create
  `<span class="img-token" contenteditable="false" draggable="true" data-path="<abs>" title="<name>">[Image #N]</span>` followed by a space text node; `N` from a per-editor counter. On `contextmenu` of a token, `preventDefault()` and show a floating `.img-ctx-menu` at the cursor with one item **Open in default app** → `handlers.onOpenImage(span.dataset.path)`; dismiss the menu on outside-click or Escape.

- [ ] **Step 6 — Submit/serialize:** rewrite `submit()` to build the descriptor array by walking `editor.childNodes` (text node → `{type:'text', text}`, `BR` → `{type:'br'}`, `.img-token` → `{type:'token', path: el.dataset.path}`, a `DIV`/`P` block wrapper → emit a `{type:'br'}` then recurse its children), call `window.serializeDescriptors(descriptors)`, guard on empty, `handlers.onSend(text)`, then clear `editor.innerHTML` and reset the `#N` counter. Update `focusCompose()` to focus the editor.

- [ ] **Step 7 — Sanity:** `node --test test/compose.test.js` still PASS; load the page (orchestrator will browser-verify). Do not commit.

### Task B3: wiring + styles (browser-verified)

**Files:** Modify `public/app.js`, `public/styles.css`.

- [ ] **Step 1 — Wiring:** in `public/app.js`, extend the `mountGui(guiPaneEl, { onSend: …, onOpenImage: (p) => { if (focusedId) ws.send(JSON.stringify({ type:'open-image', id: focusedId, path: p })); } })`. Ensure `gui.js` can read the focused/attached session id for the upload POST (pass it in or expose it the same way `onSend` already targets the focused session). Route upload errors into the existing error path used elsewhere in `app.js`.

- [ ] **Step 2 — Styles:** in `public/styles.css` add `.gui-compose-input` (same box look as the old textarea: padding, min-height ~2 lines, `white-space: pre-wrap`, scroll on overflow) with `.gui-compose-input:empty::before { content: attr(data-placeholder); color: <muted>; }`; `.img-token` (inline chip: subtle background, rounded, small padding, `user-select: none`, `cursor: default`); `.img-ctx-menu` (absolutely-positioned small menu, one row, hover highlight).

- [ ] **Step 3 — Sanity:** load the page; the orchestrator runs the full browser verification.

---

# Integration (orchestrator — after both tracks finish)

- [ ] Merge both tracks into `feat/image-paste-upload` (disjoint files → no conflicts).
- [ ] Run the **full** suite: `npm test` → expect all green (120 existing + uploads + compose + new app tests).
- [ ] Add the deferred follow-up as `A1.7` in `TODO.md` (drag-to-reposition a token within the editor) via the `/todo` script.
- [ ] Restart the cockpit (`npm start`) per the standing guideline.
- [ ] Browser-verify (A1.6 acceptance): paste a real screenshot → file saved under `uploaded-images/` + `[Image #N]` token + submit sends the quoted path + Claude reads the image; drop an image file → same; right-click a token → opens in the default app.
- [ ] Commit the integrated feature.

## Self-Review (done by author)

- **Spec coverage:** Goals→ A1/A2 (save+upload+auto-name+absolute path), B2 (paste+drop+token+serialize), B3+A3 (right-click open); Non-goals (drag-reposition) explicitly deferred to integration `A1.7`. Security §H → A1 `isWithinUploads` + A2 sanitization/caps + A3 guard. Testing §→ A1/B1 unit, A2/A3 integration, browser-verify at integration. No gaps.
- **Placeholder scan:** pure modules + their tests carry full code; UI tasks (B2/B3) are behavioral specs with the key snippets, browser-verified by design (no unit harness for `contenteditable`). No "TBD"/"handle edge cases" left abstract — validation/caps are concrete in A2.
- **Type consistency:** `uploads.*` names and `serializeDescriptors`/`quotePath` signatures match across the contract, the server route, the client serializer, and all tests. Descriptor shape is identical in B1 tests and the B2 walk.
