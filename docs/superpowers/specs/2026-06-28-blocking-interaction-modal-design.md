# Blocking Interaction Modal + Full Mode Picker — Design Spec

**Date:** 2026-06-28
**Branch:** `feat/agent-sdk-rearch`
**Status:** Approved design (confirmed via Q&A).

## 1. Summary

Every interaction where Claude is **blocked waiting on the user** is surfaced through one reusable, **per-session blocking modal** centered over the chat pane (the sidebar stays usable, so other sessions remain switchable). The modal covers all such interactions: tool-permission, AskUserQuestion, plan-accept (ExitPlanMode), and MCP elicitation. Separately, the permission-mode chip becomes a custom dropdown of **all six modes**, each with a hoverable **?** tooltip.

## 2. The interaction model (generalize permissions)

The driver already parks tool-permission requests; generalize that to a tagged **interaction** the GUI must answer. Each parked interaction has a `kind`, a `requestId`, a payload, and a per-kind resolver.

- **`kind: 'permission'`** — a gated tool (not one of the special tools below). Payload: `{ toolName, input, suggestions }`. Answer: `allow` → `{behavior:'allow', updatedInput}`; `allow-always` → also `updatedPermissions` from suggestions; `deny` → `{behavior:'deny', message}`.
- **`kind: 'question'`** — `canUseTool` for `AskUserQuestion`. Payload: `{ questions }`. Answer: `{behavior:'allow', updatedInput: { questions, answers }}` where `answers` maps each question to the chosen label(s). **The exact `answers` shape is confirmed live during the build** (trigger a real AskUserQuestion, observe the accepted format).
- **`kind: 'plan'`** — `canUseTool` for `ExitPlanMode`. Payload: `{ plan, input }`. Answers: **Approve** → `{behavior:'allow', updatedInput}`; **Approve & auto-accept edits** → allow + `setPermissionMode('acceptEdits')`; **Keep planning** → `{behavior:'deny', message}`.
- **`kind: 'elicitation'`** — `onElicitation(request, {signal})`. Payload: the request (`message`, `mode`, `requestedSchema`, `title`…). Answer: an `ElicitResult` — `{action:'accept', content}` (form fields) / `{action:'decline'}` / `{action:'cancel'}`. Form fields render from `requestedSchema` (JSON Schema). **ElicitResult/content shape confirmed during the build** (defensive rendering; flagged for live verification since elicitation is hard to trigger).

The driver exposes `onInteraction(cb)` and `answerInteraction(requestId, answer)`; `answer` is interpreted per `kind`. (`onPermission`/`answerPermission` collapse into this.)

## 3. Per-session blocking modal (client)

- One modal component, centered over the **chat/main pane only** (an overlay inside `#gui-pane`/main, not the whole window — the sidebar stays clickable).
- It renders the right body for the interaction `kind`: permission (tool + input + Allow once / Allow & remember / Deny); question (each question's header + options as selectable buttons/checkboxes per `multiSelect`, then Submit); plan (the plan text + Approve / Approve & auto-accept / Keep planning); elicitation (a form from `requestedSchema` + Submit / Decline).
- While up, that session's compose is blocked (the modal overlays it). It is **per-session**: tied to the focused session's pending interaction; switching sessions hides it (you see the other session), switching back re-shows it (the server keeps the pending interaction and re-sends it on attach).
- No generic cancel — each kind resolves via its own buttons.

## 4. Server / registry

- Generalize `pendingPermission` → `pendingInteraction` (per session). `_onInteraction(id, req)` records it, flags the session **needs-you**, emits `interaction` → broadcast `interaction-request { id, requestId, kind, ...payload }`. Re-send the pending one on attach.
- `answerInteraction(id, requestId, answer)` → driver resolves; clear pending; resume (working). WS: `interaction-answer { id, requestId, kind, answer }`.

## 5. Mode picker (all six + tooltips)

- Replace the click-cycle chip with a **custom dropdown** (native `<select>` can't hold per-option icons): a button showing the current mode, opening a list of the six modes; each row has the mode name + a hoverable **?** with a one-line tooltip:
  - **default** — prompts for anything not pre-approved.
  - **acceptEdits** — auto-accept file edits; other tools still prompt.
  - **plan** — explore/plan only; never executes edits.
  - **bypassPermissions** — approve everything that reaches the gate (deny-rules still apply).
  - **dontAsk** — never prompt; deny anything not pre-approved.
  - **auto** — a model classifier approves/denies each call.
- Picking a mode sends `set-permission-mode`; the server echoes `meta { mode }`.
- **bypassPermissions** requires `allowDangerouslySkipPermissions: true` at `query()` spawn — add it so the mode actually applies.

## 6. Components

- **`server/sdk.js`** — generalize the parking callback to tag interactions (`permission`/`question`/`plan`); add `onElicitation` → `elicitation` interaction; `onInteraction` + `answerInteraction`; set `allowDangerouslySkipPermissions: true`.
- **`server/sessions.js`** — `pendingInteraction`, `_onInteraction`, `answerInteraction`, re-send on attach (rename from the permission-specific versions).
- **`server/app.js`** — broadcast `interaction-request`; handle `interaction-answer`; re-send pending on attach.
- **`public/gui.js` / `public/app.js`** — the blocking modal (replaces the inline permission panel) rendering all four kinds; the custom mode dropdown with tooltips.

## 7. Testing

- **Driver** (fake query): each kind parks + surfaces via `onInteraction`; `answerInteraction` resolves with the right shape per kind; elicitation via `onElicitation`.
- **Registry/app**: interaction broadcast + answer routing + attach re-send (generalized from the permission tests).
- **Browser**: a real tool-permission (deny/allow), a real AskUserQuestion (pick an option → Claude proceeds), plan-accept, mode dropdown + tooltips. Elicitation is defensively built and flagged for later live confirmation.

## 8. Open items (confirm during build)

- AskUserQuestion `updatedInput.answers` exact shape — confirm live.
- ExitPlanMode allow/deny semantics (does allow alone exit plan mode and proceed?) — confirm live.
- ElicitResult `content` shape for form answers — defensive; live-verify when an MCP elicitation can be triggered.
