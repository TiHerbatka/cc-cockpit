# cc-cockpit — SDK Engine Re-architecture — Design Spec

**Date:** 2026-06-27
**Branch:** `feat/agent-sdk-rearch`
**Status:** Approved design (brainstorm complete). Implementation plan to follow (writing-plans).
**TODO:** Section G. This document is the deliverable of G1.3; G1.4 and G1.5 implement it.

## 1. Summary

cc-cockpit currently drives each Claude Code session by screen-driving a pseudo-terminal: it types text plus a carriage return (with a three-bare-Enter "nudge" timer fighting a TUI race), answers permission prompts with digit keystrokes, sends escape codes for interrupt/mode, scrapes the terminal footer for the mode and usage chips, and reads output by polling the on-disk transcript every 250 ms. This spec re-founds the session layer on the Claude Agent SDK's `query()` — a structured programmatic channel for input, output, and control over a child `claude` the SDK spawns and owns over stdio.

This phase — "the engine" — replaces the pseudo-terminal substrate end-to-end and re-sources the existing GUI features from the SDK message stream. The interactive control channel (answering permissions, interrupting a turn, switching mode/model) and the rich interactive-prompt screens (selectable question options, plan-accept, elicitation forms) are explicitly deferred to later phases.

Core stances locked during the brainstorm:
- **Subscription-only.** Every session authenticates with the user's own Claude Code subscription. The env handed to the child is scrubbed so it always uses that subscription (see §7 and §10).
- **The SDK is the sole session driver this phase.** There is no automatic terminal fallback. If a session cannot start on the SDK, it fails with a clear error. Raw terminal mode returns later as a deliberate user-chosen option, not a safety net.
- **One durable streaming `query()` per cockpit session.** Each session tile maps to its own long-lived `query()` and its own child `claude`, exactly as one pseudo-terminal mapped to one child today.

## 2. Scope

**In scope (this phase):**
- Swap the per-session substrate from the pseudo-terminal to a per-session durable streaming `query()`.
- Establish the structured cockpit↔session flow: structured input in, the live message stream out.
- Re-source the existing GUI features from the stream: the live conversation render, the topics/todos panels, and the read-only mode and usage chips.
- Re-source session state (working / idle / your-move) from the stream's turn boundaries.
- Resume a past session onto the SDK driver.
- A baseline permission posture so sessions run end-to-end without hanging (§7).

**Out of scope (deferred to later phases):**
- The interactive control channel: answering tool permissions through the GUI, graceful interrupt of a running turn, switching permission-mode or model mid-session.
- The rich interactive-prompt screens: selectable AskUserQuestion options, plan-accept (Approve / Approve+auto / Keep planning), MCP elicitation forms, MCP-server-trust and folder-trust panels.
- Live token-by-token streaming (this phase renders at message granularity).
- Terminal mode as a user-selectable option (the terminal-era code stays dormant in the tree for that future feature).

## 3. Grounding: SDK facts confirmed by the G1.2 spike

The design relies only on behavior verified live against the user's subscription (probes 1–3) or read from the installed type declarations (`@anthropic-ai/claude-agent-sdk` v0.3.195):
- **Streaming input** works: passing `prompt` as an async iterable of user messages drives multiple turns into one live session; the returned query also exposes `streamInput`.
- **Control methods are present** on the streaming query object: `interrupt`, `setPermissionMode`, `setModel`, `streamInput`, `close` (used by later phases; this phase uses only teardown).
- **Subscription auth** works through the SDK with no key present.
- **The env option replaces (does not merge with) the child environment**, so the cockpit must hand it a complete already-scrubbed env.
- **The message stream maps onto the existing render model**: an init system message; assistant messages whose `content` carries text / thinking / tool-use blocks; user messages carrying tool-result blocks; a terminal result message with usage totals; rate-limit events; the init message carries session id, model, permission mode, the tool list, and an array of MCP servers with status.
- **The permission callback fires for genuinely-gated tools** (e.g. a file write), receives the tool name, input, and ready-made suggestions, and both allow and deny round-trip correctly; safe commands (e.g. `echo`) are auto-approved and never reach it.
- **Usage and cost** are available from the result message and rate-limit events (informational only).

Items still to confirm during implementation are listed in §11.

## 4. Architecture: the structured flow

- **Session driver (per session).** The server creates and owns one durable streaming `query()` per cockpit session — the "session driver" — in place of the held pseudo-terminal. It is created with the session's working directory, the scrubbed env, the user's own settings plus the baseline auto-approve posture (§7), and a resume id when reopening a past session.
- **Uniform session shape.** The driver exposes the shape the registry already expects — somewhere to push input, a source of output events, and a teardown handle. This phase there is only one driver kind, so the registry no longer needs a dual-adapter abstraction.
- **Input path.** A typed turn travels browser → socket → server, where the server pushes it as a structured user message into that session's input queue; the async stream backing `query()` drains the queue and yields each turn into the live session. This removes the text-plus-carriage-return-plus-nudge mechanism.
- **Output path.** The server iterates the session's SDK message stream; the incremental mapper folds each message into that session's render model and emits the change as a delta; the server pushes the delta to the browser, which applies it. This removes the 250 ms transcript poll and the full-snapshot re-render.
- **Chips ride the same stream.** The mode chip comes from the init message's permission mode; the usage chips come from the result message plus the rate-limit events. The footer screen-scrape is no longer the source. (Display-only this phase; switching mode/model is deferred.)
- **No fallback.** If a session cannot start on the driver, it fails with a clear error surfaced in the GUI. No session is silently started on a pseudo-terminal.

## 5. Components & boundaries

**New:**
- **`server/sdk.js` (new), the counterpart to `server/pty.js`.** Owns building the scrubbed env, constructing the per-session `query()` (working dir, user settings, baseline posture, resume id), and exposing the uniform session shape (push input, output-event source, teardown). It reuses `scrubParentClaudeEnv` from `pty.js`, extended to also strip direct-auth / alternate-provider override variables (§7, §10).
- **Input queue** — inside that driver: the queue plus async stream that backs streaming input. A `write(turn)` enqueues a structured user message; the stream drains it into the live `query()`.

**Refactored:**
- **`server/normalize.js`** — evolves from a one-shot `normalize(records) → model` into a fold with two entry points sharing one core: a **batch seed** (fold a set of records into a model, used on attach/resume from the on-disk transcript) and a **live apply** (fold one SDK message into the model, returning a delta). The current record-shape branches become the test corpus.
- **`server/sessions.js` (registry)** — holds SDK-driven sessions, each with its render-model state and control handle. Its external role (create / list / get / state) is unchanged.
- **`server/app.js` (wiring)** — input socket messages route to the driver's input queue instead of a terminal write; output forwards mapper deltas instead of poll results.
- **`public/gui.js`** — applies render deltas plus one full-model snapshot on attach, instead of re-rendering from a poll; reads the mode/usage chips from the structured updates.

**Dormant this phase (kept in the tree for the future terminal-option feature; not wired):** `server/buffer.js` (raw-byte ring buffer) and the peek-preview replay; `server/transcript.js` (disk poll); `public/modeparse.js` and `public/usageparse.js` (footer scrape); the keystroke/escape-code input paths in `pty.js`.

**Unchanged (substrate-agnostic):** `server/projects.js`, `server/recent.js`, `server/topics.js`, `server/uploads.js`. Resume discovery still works because the SDK-spawned `claude` still writes its transcript to disk; reopening becomes `query({ resume: id })`.

**Session-state detection (`server/hooks.js`).** This phase, session state is re-sourced from the stream's turn boundaries (below), so the hook callback is no longer in the loop for SDK sessions. (`hooks.js` stays for the future terminal option.)

## 6. Data flow (concrete journeys)

- **User sends a turn.** Compose submit → socket → the server enqueues a structured user message into that session's input queue and marks the session **working** → the input stream yields it into the live `query()`.
- **Assistant responds.** Each message off the stream (assistant text, thinking, a tool call, a tool result, a todo snapshot) is folded by the incremental mapper into a delta and pushed to the browser, which applies it: a tool call lands as a pending tool item, and its later tool-result message flips that same item to ok/error in place.
- **Turn ends.** The result message flips the session to **idle** (focused) or **your-move** (background) — the same focus-derived split as today, now triggered by the result message instead of the Stop hook — and refreshes the usage chips.
- **Attach and resume — one shared fold, two entry points.** Opening or reopening a session seeds the model by batch-folding the on-disk transcript's records, hands the browser that full snapshot, then applies live messages onward as deltas. A fresh session seeds from empty; a resumed session seeds from its history; both stream live after that.
- **Start failure.** If the driver does not produce its init message within a short startup window (e.g. a folder-trust stall the structured channel cannot see), or the spawn errors, the session start fails and the GUI shows a clear error. No terminal fallback.

## 7. Permission posture (engine phase)

A real session uses tools, and answering permission prompts is part of the deferred control channel — but a session must not hang waiting for a prompt the GUI cannot yet render. So this phase runs a baseline posture: **load the user's own Claude settings/allowlist** (so a session behaves like their normal `claude`, honoring their existing allow/deny rules) **plus auto-approve anything not covered**, so nothing stalls. When the controls phase lands, the real allow/deny UI replaces the auto-approve step.

Two interactive prompts are *not* allow/deny gates and cannot be auto-approved meaningfully — a clarifying **AskUserQuestion** and a plan **ExitPlanMode**. This phase the permission step **declines those two with a short explanatory message** ("interactive questions aren't available in this session — proceed with your best judgment") so the session keeps moving; the user can still steer via the compose box. The rich answer-UI for them is the deferred phase. (These are rare outside plan mode, which is not entered this phase.)

## 8. Error handling

- **Start fails** (spawn error, or a folder-trust stall caught by the startup timeout) → clear error in the GUI. No terminal fallback.
- **Untrusted folder** → the folder-trust prompt only fires for non-git folders and is invisible to the structured channel; with no fallback, such a session simply errors at start. No auto-`git init`.
- **Crash / stream ends** → the registry's existing exited-session handling (the red ✕ with kill/remove).
- **Non-permission prompts** (AskUserQuestion / plan) → declined with a note (§7).
- **Stop a turn** → no graceful interrupt this phase; killing the session (the existing exited-session kill, which tears down the `query()`) is the blunt stop.
- **Teardown** → abort the `query()` via its abort handle, close the input stream, drop the session from the registry.

## 9. Testing

Consistent with the project's existing approach (dependency-injected core, `node --test --test-force-exit`, no real spawns in unit/integration tests):
- **Incremental mapper** — pure unit tests: feed sequences of SDK messages and assert the model and emitted deltas; port the current mapper's cases; cover the batch-seed path (records → model) which shares the fold.
- **SDK driver** — integration test against a fake `query()` (a stand-in async iterable plus control handle): covers input-queue draining, output mapping, the startup-timeout→error path, and teardown — no real `claude`.
- **Session-state mapping** — assert working → idle/your-move transitions from stream events.
- **Server wiring** — the socket handlers route input to the queue and forward deltas, tested with the fake driver.
- **Live smoke test** — one real end-to-end run confirming a session streams into the GUI, then browser-verified per project convention.

## 10. Invariants & constraints

- **Subscription-only.** The env handed to the child is built so the session always authenticates with the user's Claude Code subscription: the parent-session markers are scrubbed (as today) and any direct-auth / alternate-provider override variables are stripped so the child cannot fall into an alternate auth path.
- **One durable streaming `query()` per session** (not per turn, not shared across sessions).
- **No bundler / no build step**; plain Node; built-in test runner; `127.0.0.1`-only bind; small single-responsibility files; frequent commits.

## 11. Open items to verify during implementation

- Resume composed with streaming input (a `query({ resume, prompt: <async iterable> })` smoke test) — orthogonal by the option shapes, not yet exercised together.
- A settings-based pre-trust the SDK may honor, as a possible cleaner alternative to "untrusted folder errors at start."
- Exact SDK option and message-field names confirmed against the installed v0.3.195 declarations (the spike confirmed the load-bearing ones; the plan should pin the rest).
- The startup-timeout window value for detecting a stalled start.
- Whether the AskUserQuestion/plan "decline with a note" behavior reads acceptably in practice, or warrants pulling a minimal answer-affordance forward.
