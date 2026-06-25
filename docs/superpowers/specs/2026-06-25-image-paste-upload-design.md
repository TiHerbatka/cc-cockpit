# Image paste & upload — design

**Status:** designed (branch `feat/image-paste-upload`). v1 scope = paste **or** drop an image onto the GUI compose box → saved under the session's cwd → shown as a terminal-style `[Image #N]` inline token → serialized to the file path on submit → right-click the token to open it in the OS default app. Dragging a token to reposition it is an explicit deferred follow-up.

## Motivation

T1/A1 in `TODO.md`. Today, attaching an image to a session means save-file-then-copy-path by hand. The cockpit should let the user paste from the clipboard (or drop a file) directly onto the GUI compose box. As a side win, clipboard images get persisted to disk. What Claude ultimately receives is a path reference (we type into Claude Code's PTY prompt, so we cannot inject image *binary* the way Claude Code's own paste does) — so the inline token is purely our visual sugar, and submit replaces each token with the saved file's path.

## Goals

- Paste an image from the clipboard onto the compose box → it is uploaded and represented inline.
- Drag-and-drop an image **file** onto the compose box → same flow.
- The image is saved to `<session-cwd>/uploaded-images/` (created if missing).
- Inline representation is a compact terminal-style `[Image #N]` token, not a raw path dump.
- On submit, each token becomes the saved file's path (absolute, quoted when it contains spaces) so Claude can read it.
- Right-click a token → context menu → **Open in default app** (preview the saved file).

## Non-goals (v1)

- **Drag-to-reposition a token within the editor** — deferred to an immediate follow-up (the fiddliest part; the user flagged it "just a nice feature").
- Native terminal-mode `Ctrl+V` image handling — out of scope; our value-add is the GUI compose + the `uploaded-images/` persistence. Terminal mode remains the fallback.
- Inline thumbnails — the token is a text placeholder, matching how the terminal shows a pasted image.
- Editing/cropping/resizing images.

## A. Compose input upgrade (`public/gui.js`)

The compose box becomes a rich, plain-text editor so it can host inline elements that are individually right-clickable (and, later, draggable). A `<textarea>` cannot.

- Replace `<textarea rows="2">` with `<div class="gui-compose-input" contenteditable="true" data-placeholder="…">`.
- **Enter** (no Shift) → `preventDefault()` + submit (unchanged behavior). **Shift+Enter** → insert a line break (`document.execCommand('insertLineBreak')`), serialized as `\n`.
- Placeholder via CSS `.gui-compose-input:empty::before { content: attr(data-placeholder); }`.
- **Plain-text paste** (non-image): intercept `paste`, and for text insert via `insertText` so the editor never accumulates pasted HTML/formatting (keeps serialization clean).
- `focusCompose()` focuses the editor div.
- A per-editor monotonic counter supplies `#N`; it resets to 1 when the editor is cleared after submit.

This upgrade is compatible with the pending quick-wins B1 (Ctrl+Enter = newline) and B6 (font/line-height) — they apply to the new editor.

## B. Attach: paste + drop (`public/gui.js`)

- **paste**: if `clipboardData.items` contains an `image/*` item, `preventDefault()`, read the blob, base64-encode, upload (§F), and on success insert a token (§C) at the caret. Non-image paste falls through to the plain-text path above.
- **drop**: if `dataTransfer.files` contains an `image/*` file, `preventDefault()`, upload it, and insert the token at the drop caret position. Multiple dropped/pasted images each produce their own token.
- On upload failure, surface the error (§I) and insert **no** token.

## C. Inline token (`public/gui.js` + `styles.css`)

Each attached image is an atomic inline element:

```
<span class="img-token" contenteditable="false" draggable="true"
      data-path="<absolute path>" title="<filename>">[Image #N]</span>
```

- `contenteditable="false"` makes it a single, non-editable unit within the editable text; a normal space text node follows it so the caret can continue.
- `draggable="true"` is set now but reposition handling is deferred (§ Deferred) — present so the follow-up is purely additive.
- **Right-click** (`contextmenu`) on a token → `preventDefault()` and show a small floating menu `.img-ctx-menu` at the cursor with one entry, **Open in default app**, which calls `handlers.onOpenImage(token.dataset.path)`. The menu dismisses on outside-click or Escape.

## D. Submit serialization (`public/compose.js` (new) + `public/gui.js`)

`submit()` reads the editor's serialized string instead of `ta.value`, then calls the existing `handlers.onSend(text)` (which writes `text + '\r'` to the PTY — unchanged).

To stay unit-testable without a DOM, serialization is split:
- `public/gui.js` maps the editor's child nodes to a flat descriptor array: text node → `{type:'text', text}`, `BR` → `{type:'br'}`, `.img-token` → `{type:'token', path}`, block wrappers (`DIV`/`P` that contenteditable may insert) contribute a `{type:'br'}` boundary.
- `public/compose.js` exports the pure `serializeDescriptors(descriptors)` and `quotePath(p)` (dual CommonJS/`window`, mirroring `modeparse.js`/`usageparse.js`). `serializeDescriptors` joins text, converts `br` → `\n`, and replaces each `token` with `quotePath(path)`. `quotePath` wraps the path in double quotes when it contains a space or quote, otherwise returns it bare.

The DOM→descriptor mapping is browser-verified; the join/quote core is unit-tested.

## E. Upload endpoint + storage (`server/app.js` + `server/uploads.js` (new))

`POST /api/upload-image` (mirrors the existing `POST /api/projects` JSON pattern). Request body: `{ id, name?, mime, dataBase64 }`.

Handler:
1. `s = registry.get(id)`; unknown id → `400 {error}`.
2. Reject when `mime` is not `image/*`, or when the decoded byte length exceeds the cap (~25 MB) → `400`/`413 {error}`.
3. `dir = path.join(s.cwd, 'uploaded-images')`; `fs.mkdirSync(dir, { recursive: true })`.
4. Resolve the filename and write the decoded buffer.
5. Respond `201 { path: <absolute>, name }`.

`server/uploads.js` holds the pure, node-testable helpers:
- `extFromMime(mime)` — `image/png`→`.png`, `image/jpeg`→`.jpg`, `image/webp`→`.webp`, `image/gif`→`.gif`, …; default `.png`.
- `safeName(name)` — reduce a client-supplied name to a bare basename: strip path separators and control chars, collapse to the filename only (no traversal).
- `buildAutoName(date, ext)` — `YYYY-MM-DD HH-MM-SS` + `ext` (the `date` is injected for testability; the auto-name intentionally contains spaces, matching the temp-folder convention — handled by `quotePath`).
- `resolveUploadName(dir, desiredName)` — collision handling: if `desiredName` exists, insert ` (2)`, ` (3)`, … before the extension until free.
- `isWithinUploads(cwd, candidate)` — `true` iff `path.resolve(candidate)` is inside `path.join(cwd, 'uploaded-images')` (used by §G).

Filename precedence: a present, sanitized client `name` wins; otherwise `buildAutoName`.

## F. Client → server wiring (`public/app.js`)

- Upload uses `fetch('/api/upload-image', { method:'POST', body: JSON.stringify({...}) })`; `onSend` stays a plain string callback.
- `mountGui` gains an `onOpenImage(path)` handler, wired to `ws.send({ type:'open-image', id: focusedId, path })` (mirrors the existing `open-folder`/`open-file` handler wiring).

## G. Open in default app (`server/app.js` WS)

New WS message `open-image { id, path }` (mirrors `open-folder`/`open-file`):
- `s = registry.get(id)`; resolve the path; **only** open it when `uploads.isWithinUploads(s.cwd, path)` is true and the file exists — otherwise emit `{ type:'error' }`. This blocks opening an arbitrary file via a crafted WS message.
- Open via the injected `openFile` (default `defaultOpenFile`, `cmd /c start "" <file>`), so tests stub it.

## H. Security / validation

- Server stays bound to `127.0.0.1` (unchanged). The UI is shell-equivalent, but we still defend in depth: uploads write **only** under `<cwd>/uploaded-images/` with a sanitized basename (no traversal); `open-image` opens **only** paths inside that dir; size-capped and image-mime-only uploads avoid OOM/abuse.
- cwd is always resolved server-side from the registry by `id` — never trusted from the client.

## I. Error handling

- Upload failure (unknown id, non-image, oversize, write error) → JSON `{error}` with a 4xx status; the client surfaces it through the existing error path and inserts no token.
- `open-image` failure (path outside `uploaded-images/`, missing file) → `{ type:'error', message }`, shown via the existing error toast/center.

## Components / changes

- `public/gui.js` — textarea → `contenteditable` editor; paste/drop handlers; `[Image #N]` token; right-click context menu; DOM→descriptor mapping; submit reads the serialized string.
- `public/compose.js` *(new)* — pure `serializeDescriptors` + `quotePath` (dual CommonJS/`window`).
- `public/app.js` — `onOpenImage` wiring; `fetch` upload helper.
- `public/styles.css` — `.gui-compose-input` (+ `:empty::before` placeholder), `.img-token` chip, `.img-ctx-menu`.
- `server/uploads.js` *(new)* — `extFromMime`, `safeName`, `buildAutoName`, `resolveUploadName`, `isWithinUploads`.
- `server/app.js` — `POST /api/upload-image`; WS `open-image` (reusing injected `openFile`).

## Testing

- `test/uploads.test.js` *(new)* — `extFromMime` mapping + default; `safeName` strips separators/traversal; `buildAutoName` formats with an injected date; `resolveUploadName` collision-suffixes against a real tmp dir; `isWithinUploads` true inside / false outside.
- `test/compose.test.js` *(new)* — `serializeDescriptors` ordering (text + tokens), `br`→`\n`, multiple tokens; `quotePath` quotes spaced/quoted paths, leaves bare paths untouched, empty input → empty string.
- `test/app.test.js` — `POST /api/upload-image` writes the file under `uploaded-images`, creates the dir, returns the absolute path, auto-names from mime, rejects non-image/oversize/unknown-id; WS `open-image` calls the injected opener only for in-dir paths and rejects outside/missing.
- Browser-verify (A1.6 acceptance): paste a real screenshot → file saved + token shown + submit sends the quoted path + Claude reads the image; drop a file → same; right-click → opens in the default app. Keep the suite green (currently 120/120).

## Deferred (immediate follow-up — its own task)

Drag a token to reposition it within the editor: `dragstart` carries the token's identity; on `drop` inside the editor, place the caret at the drop point and move the token node there. The token already ships `draggable="true"`, so this is additive. Tracked as a new sub-task under A1 in `TODO.md`.
