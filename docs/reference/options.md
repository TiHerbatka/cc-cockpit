# Options / Parameters (current state)

Entries are `OPT-<slug>`. Format and upkeep rule: see [README.md](./README.md). Keep facts here only — do not duplicate them in CLAUDE.md.

### OPT-port — Server listen port

**What it does:** Sets the TCP port the cockpit's local web/WebSocket server listens on.

**Key facts:**
- `PORT` (env) · default `4477` · effect: the port bound at startup · range: any valid port number; non-numeric/empty falls back to `4477`.
- Read once at startup; running a second cockpit instance (e.g. a worktree) requires a distinct `PORT` because the default collides.
- Role-level location: the server bootstrap.

**Last verified: 2026-06-29**

### OPT-bind-host — Loopback-only bind

**What it does:** Fixes the network interface the server binds to, so the cockpit is reachable only from the local machine.

**Key facts:**
- host · fixed `127.0.0.1` · effect: loopback only, never exposed to the LAN/network · range: not configurable (hard-coded, no env override).
- Security posture: the UI is equivalent to shell access, so the bind is intentionally not tunable.
- Role-level location: the server bootstrap (paired with `OPT-port`).

**Last verified: 2026-06-29**

### OPT-permission-modes — Permission mode

**What it does:** Selects how Claude's tool calls are gated for a session. Chosen live from the header mode chip; the SDK session starts in `default` and the cockpit changes it on demand.

**Key facts:**
- The six selectable modes · initial `default` · effect per mode:
  - `default` — prompts for anything not pre-approved.
  - `acceptEdits` — auto-accepts file edits; other tools still prompt.
  - `plan` — explore and plan only; never executes edits.
  - `bypassPermissions` — approves everything that reaches the gate (your deny-rules still apply).
  - `dontAsk` — never prompts; denies anything not pre-approved.
  - `auto` — a model classifier approves or denies each call.
- `bypassPermissions` only takes effect because the SDK session is spawned with `allowDangerouslySkipPermissions: true`.
- Your own loaded settings (`settingSources: ['user', 'project', 'local']`) supply the pre-approved/deny rules these modes apply; tools your settings already allow never reach the gate.
- Role-level location: the header mode chip → the session control channel (see `MECH-control-channel`).

**Last verified: 2026-06-29**

### OPT-model — Model selection

**What it does:** Chooses which Claude model the focused session runs, from the header model select.

**Key facts:**
- model · GUI default is the first option, `claude-opus-4-8` (Opus 4.8) · values: `claude-opus-4-8` (Opus 4.8), `claude-sonnet-4-6` (Sonnet 4.6), `claude-haiku-4-5` (Haiku 4.5).
- The select re-syncs to the session's actual model when the session reports it (init / model-change meta), so the shown value tracks the live session rather than staying on the GUI default.
- Changing the select pushes the new model to the live session via the control channel.
- Role-level location: the header model select → the session control channel.

**Last verified: 2026-06-29**

### OPT-effort — Reasoning effort

**What it does:** Sets the reasoning-effort level for the focused session, from the header effort select.

**Key facts:**
- effort · default `high` (the option marked `selected`) · values: `low`, `medium`, `high`, `xhigh`, `max`.
- Effort has no dedicated SDK control method; the cockpit applies it through the session's flag-settings layer.
- Role-level location: the header effort select → the session control channel.

**Last verified: 2026-06-29**

### OPT-env-scrub-list — Spawn env-scrub set

**What it does:** The exact set of environment variables removed from the env handed to each spawned `claude`, so every session launches like a fresh top-level session on the user's subscription. Implemented by `MECH-env-scrub`.

**Key facts:**
- Parent-session markers stripped · `CLAUDECODE`, the entire `CLAUDE_CODE_*` namespace (incl. `CLAUDE_CODE_CHILD_SESSION`), `CLAUDE_EFFORT`, `AI_AGENT` · effect: prevents the no-transcript bug (a child that sees the marker writes no transcript).
- Auth/provider overrides stripped · `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` · effect: the child can never fall into API-key or alternate-gateway auth, preserving the subscription-only posture.
- The SDK `env` option replaces (does not merge with) the child env, so the cockpit passes the full scrubbed env; the cockpit's own `CC_COCKPIT_*` namespace is left intact.
- See `MECH-env-scrub` for the spawn-path mechanism.

**Last verified: 2026-06-29**

### OPT-claude-binary — Which `claude` runs sessions

**What it does:** Selects the `claude` executable each session is driven on. The cockpit deliberately uses the SDK-bundled binary and leaves the override unset.

**Key facts:**
- `pathToClaudeCodeExecutable` (SDK option) · default: unset · effect: sessions run on the version-pinned `claude` bundled in `@anthropic-ai/claude-agent-sdk`, not the user's separately-installed standalone CLI · range: a filesystem path to an alternate `claude` (not used).
- Accepted trade-off: the bundled binary is inert (no self-updater), so it can lag the standalone CLI and stalls if the SDK dependency is never bumped.
- See `MECH-binary-strategy` for the rationale and the version-gap details.

**Last verified: 2026-06-29**

### OPT-projects-root — Projects root & temp-sessions directory

**What it does:** Sets where the cockpit looks for projects (each project is an immediate subdirectory) and where one-off temporary sessions live.

**Key facts:**
- `COCKPIT_PROJECTS_ROOT` (env) · default `C:\claude_projects\cockpit` · effect: the root scanned for selectable projects · range: any directory path.
- Temporary sessions · subfolder `_temporary-sessions` under the projects root · effect: holds each one-off session in its own timestamp-named subfolder; this folder is excluded from the project picker.
- Role-level location: the projects/discovery layer.

**Last verified: 2026-06-29**

### OPT-claude-config-dir — Claude Code config/transcripts location

**What it does:** Sets where the cockpit reads Claude Code's on-disk state — session transcripts, recent-session discovery, and per-session topics.

**Key facts:**
- `CLAUDE_CONFIG_DIR` (env) · default `~/.claude` (the user's home `.claude`) · effect: resolves the base directory whose `projects/*/*.jsonl` transcripts feed resume discovery, aiTitle lookup, and the topics file · range: any directory path.
- Read uniformly by the transcript tailer, the recent-scan, and the topics reader.

**Last verified: 2026-06-29**

### OPT-playwright-mcp — Project-pinned Playwright MCP output

**What it does:** Pins the project-scoped Playwright MCP server's output (screenshots/traces/downloads) to a known project-relative folder, so verification artifacts never land in an unknown location.

**Key facts:**
- `.mcp.json` Playwright server · launched via `npx -y @playwright/mcp@latest` · flag `--output-dir .playwright-mcp` · effect: artifacts written to the repo-relative `.playwright-mcp` folder.
- Verification tooling only (browser-driven checks), not part of the running cockpit.

**Last verified: 2026-06-29**

### OPT-poll-interval — Background poll intervals

**What it does:** The fixed intervals at which the server polls Claude Code's on-disk state to keep session metadata current. Not env-tunable; documented as the live constants.

**Key facts:**
- Temp-session auto-title poll · `4000` ms · effect: replaces a temp session's timestamp placeholder label with Claude Code's `aiTitle` once written (runs until each temp session is titled).
- Topics poll · `1500` ms · effect: re-reads each live session's topics file and pushes it onto the session (feeds the Topics panel / statusline).
- Transcript tailer tick · `250` ms (default) · effect: how often the incremental transcript tailer reads appended bytes.
- All three timers are `unref`'d so they never keep the process alive.

**Last verified: 2026-06-29**
