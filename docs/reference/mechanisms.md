# Mechanisms (current state)

Entries are `MECH-<slug>`. Format and upkeep rule: see [README.md](./README.md). Keep facts here only — do not duplicate them in CLAUDE.md.

### MECH-sdk-driver — One durable SDK query per session

**What it does:** Each cockpit session is driven by one long-lived Claude Agent SDK `query()` that spawns and owns a local `claude` subprocess and talks to it over stdio for the session's whole lifetime. The cockpit streams user turns into that channel and renders everything the child emits back; there is no PTY/terminal substrate (SDK-only, no fallback).

**Key facts:**
- One durable streaming `query()` per cockpit session (hard constraint); it is NOT a thin network client to the API — it spawns and owns the child `claude` over stdio.
- The bundled child `claude` authenticates on the user's own Claude Code subscription (verified via the `five_hour` subscription rate-limit), so the subscription-only posture holds.
- The spawn is configured through SDK options (`cwd`, `env`, `permissionMode`, `canUseTool`, `onElicitation`, `resume`, `abortController`) and controlled through SDK methods (interrupt, set permission mode / model / effort, usage reads) — the caller never gets a raw OS process handle.
- User turns are pushed as streamed user messages into the same query; `resume` re-attaches a prior session id as a new live session.
- Role-level location: the session-spawn / SDK-driver path.

**Last verified: 2026-06-29**

### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** Builds the child environment so every spawned `claude` launches like a fresh top-level session AND can only authenticate on the user's own subscription. It strips the parent Claude Code session's leaked markers and the direct-auth / alternate-provider overrides, then hands the SDK `env` option the complete scrubbed environment (which replaces, not merges, the child environment).

**Key facts:**
- Strips the parent-session markers: `CLAUDECODE`, the `CLAUDE_CODE_*` namespace (incl. `CLAUDE_CODE_CHILD_SESSION`), `CLAUDE_EFFORT`, and `AI_AGENT`.
- Also strips the direct-auth / alternate-provider overrides — `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL` — so the child can never fall into an API-key or gateway auth path; this is the actual subscription-only auth guard.
- Mandatory: without the marker strip a spawned `claude` inherits the child-session marker and writes no transcript (the no-transcript bug).
- The cockpit hands the SDK `env` option the complete scrubbed environment because that option replaces (does not merge with) the child env; a minimal env would instead break the spawn (lost `PATH`/`USERPROFILE`).
- Role-level location: the session-spawn path.

**Last verified: 2026-06-29**

### MECH-normalize-fold — Conversation normalize fold

**What it does:** A pure, side-effect-free fold turns Claude Code conversation records into the render model the GUI consumes. It exposes two entry points over one shared fold: a stateful live fold that returns delta ops as each SDK message arrives, and a batch seed that returns a full model (used on attach/resume from the on-disk transcript).

**Key facts:**
- Render model is `{ title, items, status }`; `items[]` are ordered entries of kind `user`, `assistant`, `thinking`, `tool` (with `id`, `name`, `input`, `status` of pending/ok/error, `resultText`), or `todos`.
- The live fold returns delta ops: `append` (add an item), `update` (merge a patch into the tool item with that id), `title`, and `status` (replace the status block).
- Todos aggregate from two sources — native TodoWrite full snapshots and the granular TaskCreate/TaskUpdate system (the task id arrives in the TaskCreate result, later referenced by TaskUpdate); the Task* aggregate wins when that system was used.
- Dependency-free and side-effect-free by design, so it is exhaustively unit-testable with an injected fake stream.

**Last verified: 2026-06-29**

### MECH-session-state — SDK-stream-driven session state

**What it does:** A session's status is derived from the SDK message stream's turn boundaries, not from external hooks or output-silence guessing. Sending a turn marks it working; the stream's terminal result message marks it idle — or your-move when the session is unfocused at turn end; a gated-tool permission/interaction request marks it needs-you.

**Key facts:**
- Transitions, role-level: sending a turn -> working; the terminal `result` message -> idle (or your-move when the session is unfocused at turn end); a gated-tool permission / interaction request -> needs-you.
- State derivation precedence: exited; waiting -> needs-you (idle once focused/acknowledged); ended -> your-move (idle once focused); working; else idle.
- your-move vs idle is derived purely from focus in the registry — it distinguishes a background turn-end (Claude finished, or asked a prose question) from an active amber permission prompt.
- No hook settings are injected: there is no `--settings` hooks file and no POST back to the cockpit — turn boundaries come entirely from the SDK message stream, which also removes the mid-turn idle flicker that output-silence guessing produced.

**Last verified: 2026-06-29**

### MECH-gui-protocol — GUI render protocol over WebSocket

**What it does:** The server bridges each session's render model to the browser over one WebSocket. On focus/attach it sends a full snapshot; thereafter it broadcasts incremental deltas, plus per-session meta and the session list.

**Key facts:**
- `gui-snapshot` carries the full render model for a session (sent on attach/re-point); `gui-delta` carries the normalize-fold ops the client applies to its model copy.
- `attach` acknowledges (focuses) the session and re-sends a snapshot plus any still-pending interaction; `gui-attach` only re-sends a snapshot; `gui-detach` is a no-op because deltas are broadcast to every client.
- `peek` is a side-effect-free read for Quick preview: it returns the session's current model (`peeked`) WITHOUT focusing/acknowledging it; live updates ride the broadcast `gui-delta` (the client filters by preview id).
- `meta` carries per-session mode/model/usage/effort; `sessions` carries the live session list; `interaction-request` surfaces a pending prompt to answer.

**Last verified: 2026-06-29**

### MECH-session-registry — In-memory session registry

**What it does:** An in-memory registry is the authoritative live-session list. It owns each session's driver, cwd, status flags, focus, and naming; recomputes the derived status on changes; and emits the events the server broadcasts. Nothing in it persists across a server restart.

**Key facts:**
- Displayed-label precedence: customName (user rename) > autoTitle (Claude Code aiTitle) > folder basename.
- Custom name and auto-title are in-memory only — lost on server restart/resume.
- Owns the focused-session id and acknowledgement, the per-session status flags (working / waiting / ended / acknowledged / exited), and a usage-refresh in-flight de-dup guard.
- Project (non-temp) sessions never receive an aiTitle, so they default to a generated project-scoped name held in the customName slot.
- Emits `delta`, `meta`, `sessions`, `interaction`, and `session-error`.

**Last verified: 2026-06-29**

### MECH-discovery-scan — Transcript tail + recent-session scan

**What it does:** Two read-only scanners of Claude Code's on-disk history. One locates and incrementally tails a live session's transcript; the other scans all projects to list recent past sessions for the Resume modal, reading cwd/title from inside each file.

**Key facts:**
- The transcript tailer locates `<ccSessionId>.jsonl` under `~/.claude/projects/*/` (a one-level scan, since the basename is the exact session id) and tails it incrementally.
- The recent scan reads `~/.claude/projects/*/*.jsonl` grouped by folder; cwd and aiTitle are read from inside each jsonl (never from the lossy folder name); a top-level-only `.jsonl` filter excludes subagent transcripts that live in subdirectories.
- Resume windows: day (24h), 3d (72h), week (7d), all (Infinity).
- The `~/.claude` location resolves from `CLAUDE_CONFIG_DIR`, else the home directory.

**Last verified: 2026-06-29**

### MECH-projects — Projects-root resolution

**What it does:** Defines what counts as a "project" — an immediate subdirectory of the cockpit projects root — using the filesystem as the store (no database). Provides the predicates and last-activity lookup that classify and order sessions and projects.

**Key facts:**
- Projects root defaults to `C:\claude_projects\cockpit`, overridable via `COCKPIT_PROJECTS_ROOT`; one reserved subdir `_temporary-sessions` holds all temporary sessions and is NOT a selectable project.
- A predicate for strictly-inside-the-temp-root classifies a cwd as a temporary session; a separate predicate for anywhere-under-the-projects-root tags discovery results as cockpit vs. global/other.
- A per-path last-activity lookup returns each path's most-recent activity time, feeding the project picker's time bands and last-used display.
- Reserved Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9) are excluded as project names.

**Last verified: 2026-06-29**

### MECH-uploads — Image upload + prompt-token serialization

**What it does:** Pasted or uploaded images are POSTed to the server, decoded and written into the session's own upload folder, and the saved file path is inlined into the submitted prompt as a quoted path token.

**Key facts:**
- `POST /api/upload-image` takes `{ id, mime, name, dataBase64 }`, validates the image mime and a 25 MB decoded cap, writes into `<session cwd>/uploaded-images/`, and returns `{ path, name }`.
- The compose box holds descriptors (`text` / `br` / `token{path}`); serialization turns each token into the file's absolute path, quoted when it contains whitespace, so Claude receives the image as a path reference in the prompt text.
- Filenames are sanitized, collisions are de-duplicated, and an auto timestamp name is used when none is supplied.

**Last verified: 2026-06-29**

### MECH-topics — Per-session topics file feed

**What it does:** The cockpit reads the assistant's per-session topic-tracker file and pushes it onto the session, so the floating Topics panel (and the statusline) can display the active threads of work.

**Key facts:**
- Reads `~/.claude/topics/<ccSessionId>.json`, expecting `{ topics: [...] }`; returns an empty list on any problem (purely additive — never raised as an error).
- Polled per live session on a low-frequency interval (~1.5s) and pushed onto the session record.
- The topics file is operational state written by the assistant's topic-tracking convention, not by the cockpit.

**Last verified: 2026-06-29**

### MECH-control-channel — SDK control channel for interactive prompts

**What it does:** Every "Claude is waiting on the user" moment is surfaced as a tagged interaction the GUI must answer, routed through the SDK's control hooks; the same channel carries permission-mode / model switches and the interrupt and abort controls.

**Key facts:**
- Gated tools arrive via `canUseTool` and are tagged: AskUserQuestion -> `question`, ExitPlanMode -> `plan`, anything else -> `permission`; MCP elicitation arrives via `onElicitation` -> `elicitation`. Tools the user's loaded settings already allow never reach it.
- Answers resolve the parked SDK promise per kind: permission allow/deny (allow-always attaches updated permissions); question returns `answers` as a record keyed by question text -> chosen label(s); plan approve / keep-planning (approve-auto also flips the permission mode to acceptEdits); elicitation returns the chosen action or cancel.
- Live control methods: `setPermissionMode(mode)`, `setModel(model)`, effort via the flag-settings layer, `interrupt()` (soft turn interrupt), and an `abortController` whose abort tears the session down (kill).
- Each control method is defensively guarded — a missing SDK method degrades to a no-op rather than throwing.

**Last verified: 2026-06-29**

### MECH-usage-windows — Usage-window computation for the header chip

**What it does:** At session start and after each turn, the cockpit asks the SDK for usage and folds two responses into the compact 5h / 7d / context shape the header chip shows, emitted as a per-session meta update.

**Key facts:**
- Two sources: the experimental rolling-window/limits response (5h via `rate_limits.five_hour`, 7d via `seven_day`, each with `utilization` % and `resets_at`) and `getContextUsage()` (context percentage plus used/max tokens).
- Refreshed on `system/init` (seed at session start) and on the terminal `result` (after each turn); a per-session in-flight guard de-dups concurrent refreshes.
- The rolling-window method is experimental and the only source for 5h/7d, so its failure or absence degrades the chip to null rather than throwing.
- Results ride the `meta` event to clients.

**Last verified: 2026-06-29**

### MECH-stream-json-shapes — Stream-json message shapes

**What it does:** The SDK speaks the same newline-delimited JSON (stream-json) protocol to its child `claude` over stdio that the raw CLI does; the cockpit consumes those message shapes. These are the captured shapes the normalize fold and the usage/meta logic depend on.

**Key facts:**
- `system/init` carries `cwd`, `session_id`, `tools`, `model`, and `permissionMode` (drives the initial mode chip).
- `assistant` carries a content array (conversation text and tool calls).
- `rate_limit_event` reports subscription rate-limit status.
- A terminal `result` carries `subtype`, `is_error`, `result`, `usage`, and `total_cost_usd` (drives the after-turn usage refresh).
- SessionStart hooks also surface as `system/hook_started` + `system/hook_response`.
- The SDK wraps stream-json rather than replacing it — the same substrate at a higher layer, not a competing option.

**Last verified: 2026-06-29**

### MECH-binary-strategy — SDK-bundled claude binary strategy

**What it does:** cc-cockpit runs sessions on the `claude` binary bundled with the Agent SDK — the default — and deliberately leaves `pathToClaudeCodeExecutable` unset, accepting that the bundled binary can lag the user's standalone CLI.

**Key facts:**
- The bundled binary ships as a per-platform optional dependency exact-version-pinned (no caret/tilde) to `@anthropic-ai/claude-agent-sdk` (e.g. SDK `0.3.195` -> `claude.exe` `2.1.195`), so SDK and binary move as one atomic unit and cannot diverge on the stdio/stream-json control protocol — the only structurally-guaranteed-compatible pairing.
- Accepted gap: the bundled binary is inert (no self-updater); its version equals the installed SDK version, so it can lag the auto-updating standalone CLI and stalls entirely if the SDK dependency is never bumped. Model intelligence is server-side and identical across builds — a lag means missing client features/fixes (occasionally a CLI-gated new model), not a less capable Claude.
- Required practice so it doesn't stall: bump `@anthropic-ai/claude-agent-sdk` and reinstall, test-gated (the pre-1.0 SDK JS API can change between releases).
- Pointing `pathToClaudeCodeExecutable` at the user's standalone `claude` is rejected as the default (it forfeits the version guarantee — SDK and standalone CLI are independent publish streams that can drift into silent protocol breakage), kept only as a possible opt-in; Electron packaging must `asarUnpack` the bundled binary and point at the unpacked path.

**Last verified: 2026-06-29**

### MECH-zero-token-guardrails — Zero-token / subscription-only guardrails

**What it does:** cc-cockpit relies solely on the user's own Claude Code subscription and never touches credentials. The zero-token invariant — never read, store, cache, proxy, extract, or transmit OAuth tokens or credentials — is the load-bearing legal distinction that keeps the tool in the tolerated gray area.

**Key facts:**
- Subscription-only: it launches the user's own unmodified official `claude` (the SDK-bundled binary) under the user's own subscription login, verified to authenticate on that subscription (`five_hour` subscription rate-limit).
- The zero-token invariant is mandatory: what got other tools banned was extracting the subscription OAuth token and using it in their own client/servers — cc-cockpit must never do that.
- The env scrub at spawn (see `MECH-env-scrub`) is part of the subscription-only posture; do not rely on `forceLoginMethod` (version-churned + an open bug) — env scrubbing is the real guard.
- Commercialization verdict: LOW–MEDIUM risk, a tolerated gray area; realistic worst case is a C&D plus a reversible abuse-flag suspension, not a targeted ban, as long as the invariant holds. Not legal advice.

**Last verified: 2026-06-29**
