# Mechanisms (current state)

Entries are `MECH-<slug>`. Conventions (format, handles, freshness): see [README.md](./README.md). Keep facts here only — do not duplicate them in CLAUDE.md.

**Last verified: 2026-06-29**

### MECH-sdk-driver — One durable SDK query per session

**What it does:** Each cockpit session is driven by one long-lived Claude Agent SDK `query()` that spawns and owns a local `claude` subprocess and talks to it over stdio for the session's whole lifetime. The cockpit streams user turns into that channel and renders everything the child emits back; there is no PTY/terminal substrate (SDK-only, no fallback).

**Key facts:**
- One durable streaming `query()` per cockpit session (hard constraint); it is NOT a thin network client to the API — it spawns and owns the child `claude` over stdio.
- The bundled child `claude` authenticates on the user's own Claude Code subscription (verified via the `five_hour` subscription rate-limit), so the subscription-only posture holds.
- The spawn is configured through SDK options (`cwd`, `env`, `permissionMode`, `settingSources` = `['user','project','local']`, `allowDangerouslySkipPermissions`, `canUseTool`, `onElicitation`, `resume`, `abortController`) and controlled through SDK methods (interrupt, set permission mode / model / effort, usage reads) — the caller never gets a raw OS process handle.
- User turns are pushed as streamed user messages into the same query; `resume` re-attaches a prior session id as a new live session.

**Area:** the session-spawn / SDK-driver path.

**Last verified: 2026-06-29**

### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** Builds the child environment so every spawned `claude` launches like a fresh top-level session AND can only authenticate on the user's own subscription. It strips the parent Claude Code session's leaked markers and the direct-auth / alternate-provider overrides, then hands the SDK `env` option the complete scrubbed environment (which replaces, not merges, the child environment).

**Key facts:**
- Strips the parent-session markers: `CLAUDECODE`, the `CLAUDE_CODE_*` namespace (incl. `CLAUDE_CODE_CHILD_SESSION`), `CLAUDE_EFFORT`, and `AI_AGENT`.
- Also strips the direct-auth / alternate-provider overrides — `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_BASE_URL` — so the child can never fall into an API-key or gateway auth path; this is the actual subscription-only auth guard.
- Mandatory: without the marker strip a spawned `claude` inherits the child-session marker and writes no transcript (the no-transcript bug).
- The cockpit hands the SDK `env` option the complete scrubbed environment because that option replaces (does not merge with) the child env; a minimal env would instead break the spawn (lost `PATH`/`USERPROFILE`).

**Area:** the session-spawn path.

**Last verified: 2026-06-29**

### MECH-cwd-guard — Missing-cwd pre-flight guard

**What it does:** Before spawning a session (create or resume), the cockpit checks that the working folder still exists on disk; if it doesn't, it returns a truthful "folder no longer exists" error to the GUI instead of letting the SDK child spawn fail.

**Key facts:**
- Guards both spawn paths: a `create` whose picked folder was removed, and a `resume` whose original cwd is gone.
- Without it the SDK child spawn fails with ENOENT, which the SDK mislabels as a binary/libc launch failure — the guard surfaces the real cause ("folder no longer exists") instead.
- The existence check is dependency-injected: a permissive default in the app factory (so the pure server stays unit-testable with synthetic cwds), with the real filesystem check wired in at the production entry point.

**Area:** the WebSocket create/resume handlers, guarded before the registry spawns the driver.

**Last verified: 2026-06-29**

### MECH-normalize-fold — Conversation normalize fold

**What it does:** A pure, side-effect-free fold turns Claude Code conversation records into the render model the GUI consumes. It exposes two entry points over one shared fold: a stateful live fold that returns delta ops as each SDK message arrives, and a batch seed that returns a full model (used on resume to seed from the on-disk transcript; attach re-sends the already-folded in-memory model, not a fresh seed).

**Key facts:**
- Render model is `{ title, items, status }`; `items[]` are ordered entries of kind `user`, `assistant`, `thinking`, `tool` (with `id`, `name`, `input`, `status` of pending/ok/error, `resultText`), or `todos`.
- The live fold returns delta ops: `append` (add an item), `update` (merge a patch into the tool item with that id), `title`, and `status` (replace the status block).
- Todos aggregate from two sources — native TodoWrite full snapshots and the granular TaskCreate/TaskUpdate system (the task id arrives in the TaskCreate result, later referenced by TaskUpdate); the Task* aggregate wins when that system was used.
- Dependency-free and side-effect-free by design, so it is exhaustively unit-testable with an injected fake stream.

**Area:** the conversation normalize fold.

**Last verified: 2026-06-29**

### MECH-session-state — SDK-stream-driven session state

**What it does:** A session's status is derived from the SDK message stream's turn boundaries, not from external hooks or output-silence guessing. Sending a turn marks it working; the stream's terminal result message marks it idle — or your-move when the session is unfocused at turn end; a gated-tool permission/interaction request marks it needs-you.

**Key facts:**
- Transitions, role-level: sending a turn -> working; the terminal `result` message -> idle (or your-move when the session is unfocused at turn end); a gated-tool permission / interaction request -> needs-you.
- State derivation precedence: exited; waiting -> needs-you (idle once focused/acknowledged); ended -> your-move (idle once focused); working; else idle.
- your-move vs idle is derived purely from focus in the registry — it distinguishes a background turn-end (Claude finished, or asked a prose question) from an active amber permission prompt.
- No hook settings are injected: there is no `--settings` hooks file and no POST back to the cockpit — turn boundaries come entirely from the SDK message stream, which also removes the mid-turn idle flicker that output-silence guessing produced.

**Area:** the registry's status derivation.

**Last verified: 2026-06-29**

### MECH-gui-protocol — GUI render protocol over WebSocket

**What it does:** The server bridges each session's render model to the browser over one WebSocket. On focus/attach it sends a full snapshot; thereafter it broadcasts incremental deltas, plus per-session meta and the session list.

**Key facts:**
- `gui-snapshot` carries the full render model for a session (sent on attach/re-point); `gui-delta` carries the normalize-fold ops the client applies to its model copy.
- `attach` acknowledges (focuses) the session and re-sends a snapshot plus any still-pending interaction; `gui-attach` only re-sends a snapshot; `gui-detach` is a no-op because deltas are broadcast to every client.
- `peek` is a side-effect-free read for Quick preview: it returns the session's current model (`peeked`) WITHOUT focusing/acknowledging it; live updates ride the broadcast `gui-delta` (the client filters by preview id).
- `meta` carries per-session mode/model/usage/effort; `sessions` carries the live session list; `interaction-request` surfaces a pending prompt to answer.

**Area:** the server↔client WebSocket bridge.

**Last verified: 2026-06-29**

### MECH-session-registry — In-memory session registry

**What it does:** An in-memory registry is the authoritative live-session list. It owns each session's driver, cwd, status flags, focus, and naming; recomputes the derived status on changes; and emits the events the server broadcasts. Nothing in it persists across a server restart.

**Key facts:**
- Displayed-label precedence: customName (user rename) > autoTitle (Claude Code aiTitle) > folder basename.
- Custom name and auto-title are in-memory only — lost on server restart/resume.
- Owns the focused-session id and acknowledgement, the per-session status flags (working / waiting / ended / acknowledged / exited), and a usage-refresh in-flight de-dup guard.
- Project (non-temp) sessions never receive an aiTitle, so they default to a generated project-scoped name held in the customName slot: `<project> new <N>`, where N is one past the highest existing `<project> new <#>` among current sessions whose customName matches that exact pattern (renamed siblings drop out). Temp / resume / outside-the-projects-root sessions keep the folder-basename default instead.
- Optimistic user-echo on send: the SDK does not echo streamed user input back as a user message, so on send the registry folds a synthetic user record into the conversation itself and emits the delta — a just-sent turn renders immediately rather than waiting for the SDK to reflect it.
- Emits `delta`, `meta`, `sessions`, `interaction`, and `session-error`.

**Area:** the in-memory session registry.

**Last verified: 2026-06-29**

### MECH-discovery-scan — Transcript tail + recent-session scan

**What it does:** Two read-only readers of Claude Code's on-disk history. One locates a session's transcript and reads it once to seed a resumed session; the other scans all projects to list recent past sessions for the Resume modal, reading cwd/title from inside each file. (An incremental tailer helper exists but is not used in the SDK-only build — the live conversation comes from the SDK stream.)

**Key facts:**
- The transcript locator finds `<ccSessionId>.jsonl` under `~/.claude/projects/*/` (a one-level scan, since the basename is the exact session id) and reads it once for resume-seeding; the incremental tailer (`createTailer`) is test-only, not instantiated in production (see `OPT-poll-interval`).
- The recent scan reads `~/.claude/projects/*/*.jsonl` grouped by folder; cwd and aiTitle are read from inside each jsonl (never from the lossy folder name); a top-level-only `.jsonl` filter excludes subagent transcripts that live in subdirectories.
- Resume windows: day (24h), 3d (72h), week (7d), all (Infinity).
- The `~/.claude` location resolves from `CLAUDE_CONFIG_DIR`, else the home directory.

**Area:** the transcript-tail and recent-session discovery scanners.

**Last verified: 2026-06-29**

### MECH-projects — Projects-root resolution

**What it does:** Defines what counts as a "project" — an immediate subdirectory of the cockpit projects root — using the filesystem as the store (no database). Provides the predicates and last-activity lookup that classify and order sessions and projects.

**Key facts:**
- Projects root defaults to `C:\claude_projects\cockpit`, overridable via `COCKPIT_PROJECTS_ROOT`; one reserved subdir `_temporary-sessions` holds all temporary sessions and is NOT a selectable project.
- A predicate for strictly-inside-the-temp-root classifies a cwd as a temporary session; a separate predicate for anywhere-under-the-projects-root tags discovery results as cockpit vs. global/other.
- A per-path last-activity lookup returns each path's most-recent activity time, feeding the project picker's time bands and last-used display.
- Reserved Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9) are excluded as project names.
- Create-project name validation (`POST /api/projects`) rejects: empty/whitespace, names containing a path separator (`\` or `/`), names containing `..`, the illegal characters `<>:"|?*`, any control character (code < 32), and the reserved device names above; an already-existing project is rejected with HTTP 409. The POST body is capped at 4096 bytes.

**Area:** the projects/discovery layer.

**Last verified: 2026-06-29**

### MECH-uploads — Image upload + prompt-token serialization

**What it does:** Pasted or uploaded images are POSTed to the server, decoded and written into the session's own upload folder, and the saved file path is inlined into the submitted prompt as a quoted path token.

**Key facts:**
- `POST /api/upload-image` takes `{ id, mime, name, dataBase64 }`, validates the image mime and a 25 MB decoded cap, writes into `<session cwd>/uploaded-images/`, and returns `{ path, name }`.
- The compose box holds descriptors (`text` / `br` / `token{path}` / `pastedtext{text}`); serialization turns each image token into the file's absolute path (quoted when it contains whitespace) and each `pastedtext` chip back into its verbatim block, so Claude receives the image as a path reference and the collapsed paste as its full text. (The `pastedtext` collapse is a compose-box convenience — see `FEAT-paste-handling`.)
- Filenames are sanitized, collisions are de-duplicated, and an auto timestamp name is used when none is supplied.

**Area:** the image-upload endpoint and the compose serialization.

**Last verified: 2026-06-30**

### MECH-markdown-render — Assistant Markdown rendering

**What it does:** Converts each assistant message's text to HTML for the conversation log using a small, dependency-free Markdown renderer, so Claude's formatting (code, lists, emphasis, etc.) shows the way it does in the terminal.

**Key facts:**
- Safety is escape-first: the source text is fully HTML-escaped before any markup is constructed, and the only HTML emitted comes from the renderer's own templates with escaped interpolations — so no assistant text can inject live markup. Link hrefs are scheme-checked (only `http(s)`, `mailto`, `tel`, anchor, and relative URLs are allowed; `javascript:`/`data:`/other schemes are dropped to plain text).
- Inline code spans are split out before emphasis is applied, so markers inside backticks aren't reformatted; `_` emphasis ignores `snake_case`.
- A block parser handles fenced code blocks (literal, escaped; an unclosed fence still renders, which keeps mid-stream output stable), headings, ordered/unordered lists, blockquotes, and horizontal rules; within a paragraph single newlines become `<br>`.
- Only assistant messages are rendered as Markdown; user messages stay plain text. The renderer is a pure, unit-tested module reused by the read-only quick preview.

**Area:** the Markdown renderer and the assistant-message branch of the conversation render.

**Last verified: 2026-06-30**

### MECH-topics — Per-session topics file feed

**What it does:** The cockpit reads the assistant's per-session topic-tracker file and pushes it onto the session, so the floating Topics panel (and the statusline) can display the active threads of work.

**Key facts:**
- Reads `~/.claude/topics/<ccSessionId>.json`, expecting `{ topics: [...] }`; returns an empty list on any problem (purely additive — never raised as an error).
- Polled per live session on a low-frequency interval (~1.5s) and pushed onto the session record.
- The topics file is operational state written by the assistant's topic-tracking convention, not by the cockpit.

**Area:** the per-session topics poll and reader.

**Last verified: 2026-06-29**

### MECH-control-channel — SDK control channel for interactive prompts

**What it does:** Every "Claude is waiting on the user" moment is surfaced as a tagged interaction the GUI must answer, routed through the SDK's control hooks; the same channel carries permission-mode / model switches and the interrupt and abort controls.

**Key facts:**
- Gated tools arrive via `canUseTool` and are tagged: AskUserQuestion -> `question`, ExitPlanMode -> `plan`, anything else -> `permission`; MCP elicitation arrives via `onElicitation` -> `elicitation`. Tools the user's loaded settings already allow never reach it.
- Answers resolve the parked SDK promise per kind: permission allow/deny (allow-always attaches updated permissions ONLY when the gated tool carried permission suggestions — with none it degrades to a plain one-time allow); question returns `answers` as a record keyed by question text -> chosen label(s); plan approve / keep-planning (approve-auto also flips the permission mode to acceptEdits); elicitation returns the chosen action or cancel.
- Live control methods: `setPermissionMode(mode)`, `setModel(model)`, effort via the flag-settings layer, `interrupt()` (soft turn interrupt), and an `abortController` whose abort tears the session down (kill).
- Each control method is defensively guarded — a missing SDK method degrades to a no-op rather than throwing.

**Area:** the SDK control channel in the session driver.

**Last verified: 2026-06-29**

### MECH-usage-windows — Usage-window computation for the header chip

**What it does:** At session start and after each turn, the cockpit asks the SDK for usage and folds two responses into the compact 5h / 7d / context shape the header chip shows, emitted as a per-session meta update.

**Key facts:**
- Two sources: the experimental rolling-window/limits response (5h via `rate_limits.five_hour`, 7d via `seven_day`, each with `utilization` % and `resets_at`) and `getContextUsage()` (context percentage plus used/max tokens).
- Refreshed on `system/init` (seed at session start) and on the terminal `result` (after each turn); a per-session in-flight guard de-dups concurrent refreshes.
- The rolling-window method is experimental and the only source for 5h/7d, so its failure or absence degrades the chip to null rather than throwing.
- Results ride the `meta` event to clients.

**Area:** the usage-window computation feeding the header chip.

**Last verified: 2026-06-29**

### MECH-stream-json-shapes — Stream-json message shapes

**What it does:** The SDK speaks the same newline-delimited JSON (stream-json) protocol to its child `claude` over stdio that the raw CLI does. These are the protocol message shapes; only a few of their fields are actually consumed — chiefly `permissionMode`/`model` from `system/init` and `usage` from the terminal `result`. The other fields/messages are documented for context, not because anything reads them.

**Key facts:**
- `system/init` carries `cwd`, `session_id`, `tools`, `model`, and `permissionMode`; of these the cockpit reads only `permissionMode` (drives the initial mode chip) and `model`.
- `assistant` and `user` messages carry a content array (conversation text and tool calls) — the only messages the normalize fold consumes.
- A terminal `result` carries `subtype`, `is_error`, `result`, `usage`, and `total_cost_usd`; the cockpit reads `usage`, and the message itself marks the turn idle and triggers an after-turn usage refresh.
- The 5h / 7d / context numbers come from the experimental `getUsage()` / `getContextUsage()` control calls (see `MECH-usage-windows`), NOT from a `rate_limit_event` message — that event is not handled (it survives only in a code comment).
- Because the cockpit injects no hooks, the SessionStart hook-lifecycle messages (`system/hook_*`) do not occur.
- The SDK wraps stream-json rather than replacing it — the same substrate at a higher layer, not a competing option.

**Area:** the SDK message stream and its mapping in the session driver.

**Last verified: 2026-06-29**

### MECH-binary-strategy — SDK-bundled claude binary strategy

**What it does:** cc-cockpit runs sessions on the `claude` binary bundled with the Agent SDK — the default — and deliberately leaves `pathToClaudeCodeExecutable` unset, accepting that the bundled binary can lag the user's standalone CLI.

**Key facts:**
- The bundled binary ships as a per-platform optional dependency exact-version-pinned (no caret/tilde) to `@anthropic-ai/claude-agent-sdk` (e.g. SDK `0.3.195` -> `claude.exe` `2.1.195`), so SDK and binary move as one atomic unit and cannot diverge on the stdio/stream-json control protocol — the only structurally-guaranteed-compatible pairing.
- Accepted gap: the bundled binary is inert (no self-updater); its version equals the installed SDK version, so it can lag the auto-updating standalone CLI and stalls entirely if the SDK dependency is never bumped. Model intelligence is server-side and identical across builds — a lag means missing client features/fixes (occasionally a CLI-gated new model), not a less capable Claude.
- Required practice so it doesn't stall: bump `@anthropic-ai/claude-agent-sdk` and reinstall, test-gated (the pre-1.0 SDK JS API can change between releases).
- Pointing `pathToClaudeCodeExecutable` at the user's standalone `claude` is rejected as the default (it forfeits the version guarantee — SDK and standalone CLI are independent publish streams that can drift into silent protocol breakage), kept only as a possible opt-in; Electron packaging must `asarUnpack` the bundled binary and point at the unpacked path.

**Area:** the SDK session spawn (binary selection).

**Last verified: 2026-06-29**

### MECH-zero-token-guardrails — Zero-token / subscription-only guardrails

**What it does:** cc-cockpit relies solely on the user's own Claude Code subscription and never touches credentials. The zero-token invariant — never read, store, cache, proxy, extract, or transmit OAuth tokens or credentials — is the load-bearing legal distinction that keeps the tool in the tolerated gray area.

**Key facts:**
- Subscription-only: it launches the user's own unmodified official `claude` (the SDK-bundled binary) under the user's own subscription login, verified to authenticate on that subscription (`five_hour` subscription rate-limit).
- The zero-token invariant is mandatory: what got other tools banned was extracting the subscription OAuth token and using it in their own client/servers — cc-cockpit must never do that.
- The env scrub at spawn (see `MECH-env-scrub`) is part of the subscription-only posture; do not rely on `forceLoginMethod` (version-churned + an open bug) — env scrubbing is the real guard.
- Commercialization verdict: LOW–MEDIUM risk, a tolerated gray area; realistic worst case is a C&D plus a reversible abuse-flag suspension, not a targeted ban, as long as the invariant holds. Not legal advice.

**Area:** the session-spawn env construction (the subscription-only posture).

**Last verified: 2026-06-29**
