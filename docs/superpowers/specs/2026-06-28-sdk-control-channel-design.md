# SDK Control Channel — Design Spec

**Date:** 2026-06-28
**Branch:** `feat/agent-sdk-rearch`
**Status:** Approved design.
**TODO:** Section G (G1.5 controls). Builds on the delivered engine (G1.4) + SDK-only cleanup.

## 1. Summary

The engine phase deferred the interactive controls; this builds them on the SDK's control channel (all shapes confirmed by the G1.2 spike): tool-permission answering (`canUseTool`), interrupt (`query.interrupt()`), permission-mode switching (`setPermissionMode`), and model switching (`setModel`). It also fixes resume so a reopened session shows its prior history. Out of scope (separate "rich prompt screens" work): AskUserQuestion option UI and plan-accept — those stay declined.

## 2. Permissions (5a)

- The driver's permission callback stops auto-approving. For a gated tool it **parks a pending promise** keyed by the tool-use id, surfaces a permission request (tool name, input, the SDK's ready-made `suggestions`, tool-use id) via an `onPermission` listener, and awaits. `AskUserQuestion` / `ExitPlanMode` are still declined with a short message.
- The registry routes the request out (`'permission'` event) and records it as the session's **pending permission**; the session goes **needs-you**. The server broadcasts a `permission-request`. The client shows the **existing permission panel** (Allow once / Allow & don't ask again / Deny).
- The answer travels back (`permission-answer { id, toolUseId, decision }`) → the registry tells the driver to resolve the parked promise: `allow` → `{ behavior:'allow', updatedInput }`; `allow-always` → also `updatedPermissions` from the suggestions (falls back to allow-once if none); `deny` → `{ behavior:'deny', message }`. The pending permission clears and the turn resumes (**working**).
- Tools already covered by the user's loaded settings auto-approve without reaching the callback (no prompt spam).
- **Focus-safe:** the registry keeps the pending request, so focusing a session that is waiting re-sends its `permission-request` (a prompt is never missed because you were elsewhere when it fired).

## 3. Interrupt (5b)

- The header Stop button (already present, hidden) shows while a session is **working** and sends `interrupt { id }`; the registry calls the driver's `interrupt()` → `query.interrupt()`. The turn ends normally (a result message follows → idle).

## 4. Mode switch (5c)

- The mode chip becomes clickable and cycles **default → acceptEdits → plan → default** via `setPermissionMode`. The chip updates optimistically; the registry calls the driver's `setPermissionMode(mode)` and emits a `meta { mode }`. bypassPermissions / dontAsk / auto are intentionally excluded from the one-click cycle.

## 5. Model switch (5d)

- A small picker near the chips lists a curated set (Opus 4.8 / Sonnet 4.6 / Haiku 4.5), marks the current one, and on pick sends `set-model { id, model }`; the registry calls the driver's `setModel(model)` and emits `meta { model }`. The init message's `model` seeds the current value (added to `meta`). Dynamic `supportedModels()` is a later enhancement.

## 6. Resume-seeding fix

- On create-with-resume, the registry seeds the conversation model by batch-folding the on-disk transcript (locate via `transcript.js`'s `findTranscriptPath`, read records, `createConversation().seed`), so a reopened session shows its history immediately. During the build, confirm the SDK does not *also* replay prior messages onto the stream (which would duplicate) and adjust if it does.

## 7. Components

- **`server/sdk.js`** — the driver gains: a parking permission callback + `onPermission(cb)` + `answerPermission(toolUseId, decision)`; `setPermissionMode(mode)`; `setModel(model)`. (`interrupt()` already exists.)
- **`server/sessions.js`** — `_onPermission` (record pending + needs-you + emit `permission`), `answerPermission(id, toolUseId, decision)` (resolve + resume), `interrupt(id)`, `setPermissionMode(id, mode)`, `setModel(id, model)`, pending-permission storage, and resume-seeding in `create`. The init `meta` also carries `model`.
- **`server/app.js`** — WS `permission-answer`, `interrupt`, `set-permission-mode`, `set-model`; broadcast `permission-request` from the registry's `permission` event; re-send the pending `permission-request` on attach.
- **`public/gui.js`** — rewire `showPermission(req, onAnswer)` so its buttons return `allow` / `allow-always` / `deny` (instead of PTY keystrokes).
- **`public/app.js`** — handle `permission-request` (show panel; answer); show the Stop button while working and wire interrupt; make the mode chip cycle; add the model picker; hide the panel when the focused session is no longer waiting.

## 8. Error handling

- An interrupt or session exit with a permission pending: the parked promise is abandoned when the driver tears down (the child is gone); the pending state clears on the next session broadcast / exit. Answering an already-resolved/unknown tool-use id is a no-op.

## 9. Testing

- **Driver** (fake query): the callback parks and `answerPermission` resolves with the correct `PermissionResult` for allow / allow-always / deny; AskUserQuestion is declined; `setPermissionMode` / `setModel` call through.
- **Registry** (fake driver): a permission request sets needs-you + records pending + emits `permission`; `answerPermission` resolves + resumes; `interrupt` / `setPermissionMode` / `setModel` route through; resume-seeding folds transcript records into the model.
- **App**: `permission-request` is broadcast; `permission-answer` reaches the driver; attach re-sends a pending request.
- **Browser**: deny a Write then allow it; interrupt a running turn; cycle the mode; switch the model; reopen a session and see its history.

## 10. Invariants

- Subscription-only and the one-durable-`query()`-per-session model are unchanged. Tools covered by the user's settings still auto-approve. No new directories created on resume.
