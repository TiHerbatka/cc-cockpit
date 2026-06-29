# cc-cockpit

Personal local web app: a multi-session **Claude Code cockpit**. One window shows all live Claude Code sessions at once; switch between them instantly; type into any of them. The unit is a *session*, not a *project*. Built because Agent View is too terse/slow to switch, kanban tools (Vibe Kanban, AI Agent Board) are task-centric (dispatch → review → merge), and claudecodeui is project-centric — none give a simultaneous-live-sessions cockpit.

## Architecture direction (TOP PRIORITY): built on the Claude Agent SDK

The project is being re-founded on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). The cockpit drives each session through the SDK's `query()` — a structured programmatic channel for input, output, and tool-permission/control — instead of screen-driving a `claude` pseudo-terminal. `query()` spawns and owns a local `claude` subprocess and talks to it over stdio; that bundled `claude` authenticates on the **user's own Claude Code subscription**, so the subscription-only posture is preserved. **cc-cockpit relies solely on the user's Claude Code subscription.** The PTY/`node-pty` substrate has been **removed entirely** — cc-cockpit is SDK-only, with no PTY fallback. The re-architecture (TODO section G) is **complete**; the SDK process model and the binary/auth rationale are in `docs/reference/mechanisms.md` (MECH-sdk-driver, MECH-binary-strategy, MECH-zero-token-guardrails).

- **The SDK does not replace stream-json — it wraps it**, speaking the same newline-delimited JSON protocol to its child `claude` over stdio rather than us hand-rolling the raw CLI — the same substrate at different layers, not competing options. Message-shape detail: `docs/reference/mechanisms.md` MECH-stream-json-shapes.
- **Env scrub stays mandatory, enforced through the SDK's `env` option** (which *replaces* the child environment, not merges it): the cockpit hands it the complete, already-scrubbed env so the parent session's leaked markers can't reach the child (the no-transcript bug) and the child can only authenticate on the user's own subscription. The exact stripped variables and rationale live in MECH-env-scrub / OPT-env-scrub-list.
## Status

Current state — features, mechanisms, options/parameters — lives in [`docs/reference/`](docs/reference/). Read it rather than inferring current behavior from the code or git history.

## How to resume (in a fresh session opened here)

cc-cockpit is built and runs on the Claude Agent SDK. To run it: `npm install` (first time only) then `npm start`, and open `http://127.0.0.1:4477`. To extend it, the backlog lives in `TODO.md` (managed by the `/todo` skill); the current-state reference (features, mechanisms, options/parameters) lives in `docs/reference/`.

## Common commands

- Install dependencies: `npm install`
- Run tests (Node built-in runner, zero test deps): `npm test`
- Start the app: `npm start` → open `http://127.0.0.1:4477`

## Architecture (summary)

A Node server drives each `claude` session through the **Claude Agent SDK**'s `query()` — one durable streaming `query()` per session, which spawns and owns the child `claude` over stdio — and bridges the structured conversation to a single web page over a WebSocket. The core logic (session registry and the incremental conversation fold) is dependency-injected and event-emitting, so it is unit-testable with an injected fake `query()` and no real `claude`. The cockpit is **SDK-only — the PTY substrate has been removed, with no fallback**.

Full mechanism reference: `docs/reference/mechanisms.md`.

## Conventions

- Plain Node, **no bundler/build step**. Test runner: built-in `node --test`.
- Keep files small and single-responsibility.
- **Docs upkeep (convention-only):** when you change/add/remove a feature, mechanism, or option, update its entry in `docs/reference/` in the same commit and stamp its Last-verified date. New entries take the next handle in their category.
- **Committing (assistant) — commit per step, no asking:** commit frequently as the normal close-out of a verified step — **one commit per completed plan step / TODO item**. This is unconditional: **do NOT ask whether to commit.** This project's commit convention **overrides any generic "only commit/push when the user asks" default** — a specific project guideline outranks a generic default (standing user guideline 2026-06-29, after asking-to-commit was flagged as redundant). Only pause to ask for genuinely irreversible or off-convention actions — history rewrites, force-push, or a change of branching strategy.
- **Branching / isolation — driven by parallelism, not change size:** sequential single-threaded work commits **straight to `main`** (the default — no branch). Isolate on a branch only when work needs isolation: (a) several **independent** features developed **concurrently**, or (b) large / risky multi-step work. Then give each feature its **own branch — preferably a git worktree** (a separate checkout so concurrent edits/builds/tests don't collide; the worktree-setup and branch-finishing skills are the playbook), commit per step inside it, and once the feature is verified **merge it straight to `main` — no PR** (solo local repo; standing user guideline 2026-06-29), then drop the worktree. Practical note: running two cockpit instances at once needs distinct ports (set the `PORT` override per worktree), since the default port collides.
- Server binds **`127.0.0.1` only**, default port `4477` (override via `PORT` env). The UI is equivalent to shell access — never expose the port to the network.
- **Restarting the dev server (assistant) — ALWAYS restart after changes, no asking:** after any fix/modification, the assistant restarts the running `npm start` cockpit itself so the user always sees up-to-date results. This is unconditional — **do NOT wait for confirmation even when the main cockpit has live Claude sessions** (restarting kills them, since the server owns each session's SDK child `claude` process; that is accepted by standing user guideline 2026-06-25). A running Node server does not pick up server-side (`server/*.js`) edits otherwise; client (`public/*`) edits only need a browser reload but restarting anyway is fine. Throwaway test instances (other ports) can be restarted freely.

## Prerequisites / gotchas

- Node.js v22+ (this machine has v24).
- The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) installs from npm and bundles its own version-pinned `claude` binary (spawned over stdio) — there is no native module to compile. Verify with `node -e "require('@anthropic-ai/claude-agent-sdk'); console.log('ok')"`.
- The `test` script is `node --test --test-force-exit`. The `--test-force-exit` flag is kept defensively: a test that loads the real SDK (the contract smoke test) can leave an async handle alive on Windows, which would otherwise keep the test-runner process from exiting. The suite itself passes without it; the flag just guarantees a clean exit. App behavior is unaffected (the server is long-lived by design).

## Non-goals for v0 — do NOT build these

Originally deferred for v0: split/grid multi-session view; precise "needs input" detection; desktop notifications/sound; persistence across server restart; WebSocket auto-reconnect/backoff; authentication; tab colors/reorder. (Two items from this list — auto-discovery of `~/.claude` sessions and session rename — have since shipped in v0.2+.) Sessions are started **from the cockpit**, not from terminal tabs — that is the one accepted behavior change.
