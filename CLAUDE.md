# cc-cockpit

Personal local web app: a multi-session **Claude Code cockpit**. One window shows all live Claude Code sessions at once; switch between them instantly; type into any of them. The unit is a *session*, not a *project*. Built because Agent View is too terse/slow to switch, kanban tools (Vibe Kanban, AI Agent Board) are task-centric (dispatch → review → merge), and claudecodeui is project-centric — none give a simultaneous-live-sessions cockpit.

## Architecture direction (TOP PRIORITY): built on the Claude Agent SDK

The project is being re-founded on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). The cockpit drives each session through the SDK's `query()` — a structured programmatic channel for input, output, and tool-permission/control — instead of screen-driving a `claude` pseudo-terminal. `query()` spawns and owns a local `claude` subprocess and talks to it over stdio; that bundled `claude` authenticates on the **user's own Claude Code subscription**, so the subscription-only posture is preserved. **cc-cockpit relies solely on the user's Claude Code subscription.** The PTY/`node-pty` substrate has been **removed entirely** — cc-cockpit is SDK-only, with no PTY fallback. The re-architecture (TODO section G) is **complete**; the SDK process model and the binary/auth rationale are documented under `MECH-sdk-driver`, `MECH-binary-strategy`, and `MECH-zero-token-guardrails` (in `docs/` — enter via [`local-docs.md`](local-docs.md)).

- **The SDK does not replace stream-json — it wraps it**, speaking the same newline-delimited JSON protocol to its child `claude` over stdio rather than us hand-rolling the raw CLI — the same substrate at different layers, not competing options. Message-shape detail: `MECH-stream-json-shapes`.
- **Env scrub stays mandatory, enforced through the SDK's `env` option** (which *replaces* the child environment, not merges it): the cockpit hands it the complete, already-scrubbed env so the parent session's leaked markers can't reach the child (the no-transcript bug) and the child can only authenticate on the user's own subscription. The exact stripped variables and rationale live in MECH-env-scrub / OPT-env-scrub-list.
## Status

Current state lives in the documentation: enter via [`local-docs.md`](local-docs.md) (the index) and read the detail in [`docs/`](docs/) — features, mechanisms, options/parameters. Read it rather than inferring current behavior from the code or git history. How the docs are organized and kept fresh: [`docs/README.md`](docs/README.md).

## How to resume (in a fresh session opened here)

cc-cockpit is built and runs on the Claude Agent SDK. To run it: `npm install` (first time only) then `npm start`, and open `http://127.0.0.1:4477`. To extend it, the backlog lives in `TODO.md` (managed by the `/todo` skill); the current-state docs are entered via [`local-docs.md`](local-docs.md) and detailed in [`docs/`](docs/) (see [`docs/README.md`](docs/README.md) for how they're organized).

## Common commands

- Install dependencies: `npm install`
- Run tests (Node built-in runner, zero test deps): `npm test`
- Start the app: `npm start` → open `http://127.0.0.1:4477`

## Architecture (summary)

A Node server drives each `claude` session through the **Claude Agent SDK**'s `query()` — one durable streaming `query()` per session, which spawns and owns the child `claude` over stdio — and bridges the structured conversation to a single web page over a WebSocket. The core logic (session registry and the incremental conversation fold) is dependency-injected and event-emitting, so it is unit-testable with an injected fake `query()` and no real `claude`. The cockpit is **SDK-only — the PTY substrate has been removed, with no fallback**.

Full mechanism reference: the `MECH-` entries in `docs/` (enter via [`local-docs.md`](local-docs.md)).

## Documentation

[`local-docs.md`](local-docs.md) is the entry point (orientation + index); [`docs/`](docs/) holds the detailed, authoritative docs (one file per area; handle-keyed `FEAT-`/`MECH-`/`OPT-`/`GUI-`) and is the source of truth for current behavior — read it, not the code/git history. **How the docs work (conventions, handles, freshness, the verify ritual) lives once in [`docs/README.md`](docs/README.md) — the single authority; do not restate it here.** The commit-time firing rule is the **Docs upkeep** bullet under *Conventions*.

`local-docs.md` is this project's **structured documentation front door, not a scratch file** — do not blank, overwrite, or junk-append it. The global "local docs" convention (recreate-if-absent / catch-all scratch target) is **overridden here**; transient notes go only in its *Active scratch notes* section.

The GUI glossary + visual map is generated documentation — [`docs/gui-map.md`](docs/gui-map.md) (+ `docs/gui-map/map.html`), auto-discovered from the live GUI by the `/gui-map` skill (mechanism files under `.claude/skills/gui-map/`). It is generated — never hand-edit; re-run the skill to refresh.

## Conventions

- Plain Node, **no bundler/build step**. Test runner: built-in `node --test`.
- Keep files small and single-responsibility.
- **Docs upkeep — the one trigger (convention-only; no hook exists):** a commit that **adds, changes, or removes a documented fact** — a feature (`FEAT-`), mechanism (`MECH-`), option (`OPT-`), or GUI element (`GUI-`), or any recorded *Key fact* (this **includes refactors and bug-fixes** that move an entry's *Area* pointer or alter a stated fact) — **must, in that same commit,** create / update / retire the affected `docs/` entry and re-stamp its `Last verified` date. Adding new behavior means **creating** its entry. New entries get a **fresh descriptive handle** (a slug, not a number); removals leave a tombstone. GUI changes are satisfied by **re-running `/gui-map`**, not by hand-editing the map. Full conventions + verify ritual: [`docs/README.md`](docs/README.md) (the authority); this bullet is the firing rule.
- **Committing (assistant) — commit per step, no asking:** commit frequently as the normal close-out of a verified step — **one commit per completed plan step / TODO item**. Each commit must first satisfy the **Docs gate** (*Docs upkeep*, above): docs ride the same commit as the code they describe — the commit-per-step rule never ships ahead of the doc update. This is unconditional: **do NOT ask whether to commit.** This project's commit convention **overrides any generic "only commit/push when the user asks" default** — a specific project guideline outranks a generic default (standing user guideline 2026-06-29, after asking-to-commit was flagged as redundant). Only pause to ask for genuinely irreversible or off-convention actions — history rewrites, force-push, or a change of branching strategy.
- **Branching / isolation — driven by parallelism, not change size:** sequential single-threaded work commits **straight to `main`** (the default — no branch). Isolate on a branch only when work needs isolation: (a) several **independent** features developed **concurrently**, or (b) large / risky multi-step work. Then give each feature its **own branch — preferably a git worktree** (a separate checkout so concurrent edits/builds/tests don't collide; the worktree-setup and branch-finishing skills are the playbook), commit per step inside it, and once the feature is verified **merge it straight to `main` — no PR** (solo local repo; standing user guideline 2026-06-29), then drop the worktree. Practical note: running two cockpit instances at once needs distinct ports (set the `PORT` override per worktree), since the default port collides.
- Server binds **`127.0.0.1` only**, default port `4477` (override via `PORT` env). The UI is equivalent to shell access — never expose the port to the network.
- **Restarting the dev server (assistant) — ALWAYS restart after changes, no asking:** after any fix/modification, the assistant restarts the running `npm start` cockpit itself so the user always sees up-to-date results. This is unconditional — **do NOT wait for confirmation even when the main cockpit has live Claude sessions** (restarting kills them, since the server owns each session's SDK child `claude` process; that is accepted by standing user guideline 2026-06-25). A running Node server does not pick up server-side (`server/*.js`) edits otherwise; client (`public/*`) edits only need a browser reload but restarting anyway is fine. Throwaway test instances (other ports) can be restarted freely.

## Prerequisites / gotchas

- Node.js v22+ (this machine has v24).
- The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) installs from npm and bundles its own version-pinned `claude` binary (spawned over stdio) — there is no native module to compile. Verify with `node -e "require('@anthropic-ai/claude-agent-sdk'); console.log('ok')"`.
- The `test` script is `node --test --test-force-exit --test-timeout=30000`. The `--test-force-exit` flag is kept defensively: a test that loads the real SDK (the contract smoke test) can leave an async handle alive on Windows, which would otherwise keep the test-runner process from exiting. The suite itself passes without it; the flag just guarantees a clean exit. App behavior is unaffected (the server is long-lived by design). `--test-timeout=30000` is a safety net: node's runner has no default per-test timeout, so a test that awaits a promise which never resolves (e.g. a WebSocket message missed by a race) would otherwise hang the whole run indefinitely — the timeout fails that one test instead.

## Non-goals for v0 — do NOT build these

Originally deferred for v0: split/grid multi-session view; precise "needs input" detection; desktop notifications/sound; persistence across server restart; WebSocket auto-reconnect/backoff; authentication; tab colors/reorder. (Two items from this list — auto-discovery of `~/.claude` sessions and session rename — have since shipped in v0.2+.) Sessions are started **from the cockpit**, not from terminal tabs — that is the one accepted behavior change.
