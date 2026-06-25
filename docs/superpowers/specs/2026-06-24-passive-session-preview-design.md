# Passive session preview — design

**Status:** built (branch `feat/session-preview`); server core unit-tested, UI browser-verified.

## Problem

Sometimes you want to glance at what a session is doing — is it actually working, did it stall, what did it just print — **without the cockpit reacting to it**. A normal click (`attach`) has two side effects: it makes the session the *focused* one (which changes how future turn-ends are classified) and it *acknowledges* the session, clearing a pending `needs-you`/`your-move` attention signal. That makes a normal click unusable for a quick debug glance, because looking at a session would erase the very signal that told you to look. We want a read-only "look, don't touch" — like a strategy game letting a player scout part of the map without interacting with it.

## Design

**Trigger.** Right-click (context menu) a session row in the sidebar. The menu is built to grow, but has **one entry for now**: *Quick preview*. The menu dismisses on outside click / `Escape`.

**Surface.** An in-page modal (same tab) containing a **read-only `xterm`** that mirrors the chosen session. Works for a session in **any** state (working, your-move, needs-you, idle, even exited — the buffer is still available until the session is removed). Closes via the header ✕, clicking the backdrop, or `Escape`.

**Side-effect-free mirroring.** A new WebSocket message `peek` returns `registry.bufferOf(id)` (already a pure read) **without** calling `acknowledge` — so it never sets `focusedId` and never clears an attention signal. Live updates ride the **existing** per-session `output` broadcast (every session's output is already broadcast to every client; the client simply also writes it to the preview term when the id matches). The preview is **watch-only** (`disableStdin`) and **never resizes the session's PTY** (resizing would alter the real session's rendering).

This means: previewing a `needs-you` session leaves it `needs-you`; the focused session is unchanged; the previewed session is never written to.

**Grid size must match the PTY.** A full-screen TUI's byte stream is *size-specific* — under ConPTY it positions/clears relative to a particular row count (the size the focused client last set via resize). Replaying that stream into a terminal of a different size garbles it: the current frame scrolls out of view and only absolutely-positioned fragments survive (this was the "preview shows empty" bug). So the registry tracks each session's current `cols`/`rows` (spawn default `120x30`, updated on every `resize`), `peek` returns them, and the preview terminal does a **display-only** `resize(cols, rows)` to match before writing the buffer (it never resizes the PTY). The ring buffer was also raised to 256 KB so a recent full frame reliably survives in the replay window.

## Components / changes

- `server/sessions.js` — track `cols`/`rows` per session (set in `create`, updated in `resize`); add `sizeOf(id)`.
- `server/buffer.js` — ring buffer raised to 256 KB (so a recent full TUI frame survives the replay window).
- `server/app.js` — handle WS `peek` → reply `{ type: 'peeked', id, buffer, cols, rows }` via `bufferOf`/`sizeOf`, no acknowledge.
- `public/app.js` — right-click handler → `openContextMenu`; `openPreview` builds the modal + a read-only `Terminal`, sends `peek`, and routes `peeked` (display-resize to `cols`x`rows`, then reset+write backlog) and `output` (append) for `previewId` into the preview term; `closePreview` disposes the term and removes the overlay.
- `public/styles.css` — `.ctx-menu`/`.ctx-item`, `.preview-box`/`.preview-head`/`.preview-close`/`.preview-term` (the term scrolls if its grid is taller than the modal).

## Testing

- `test/app.test.js` — `peek` returns the backlog while a `needs-you` session **stays** `needs-you` and `focusedId` stays `null`.
- Browser-verified (fake-pty): right-click → menu → preview shows the session's buffer; the previewed `needs-you` session keeps its amber state and the focused session is unchanged; `Escape` closes cleanly.

## Non-goals (deliberately out of scope)

- Any interaction inside the preview (it is watch-only by design).
- More than one simultaneous preview (one at a time; opening a new one closes the old).
- Rich/normalized rendering of the preview — that is the separate "rich interactive frontend" (Approach B) effort; for now the preview shows the raw terminal, matching the rest of the cockpit.
