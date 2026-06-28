# cc-cockpit

A personal, local web app for working with **multiple live Claude Code sessions in one place** — all sessions visible in a sidebar, instant switching, and a structured GUI for the focused session. Session-centric (not project-centric, not a task board).

> Status: built and runnable now with `npm start`. cc-cockpit drives each session through the Claude Agent SDK (SDK-only). Design specs and implementation plans are kept in `docs/` for reference.

## Why

Juggling 3+ Claude Code sessions across separate terminal tabs is hard to manage and easy to lose. Existing tools don't fit an actively-interactive, multi-project workflow: Agent View is terse and slow to switch, kanban tools are task-dispatch oriented, and claudecodeui is project/history oriented. cc-cockpit is the missing simultaneous-sessions cockpit.

## How it works

A small Node server drives each `claude` session through the Claude Agent SDK's `query()` — which spawns and owns the child `claude` over stdio — and streams the structured conversation to a single web page over a WebSocket. Add a session by pointing it at a folder; click a session in the sidebar to focus and type into it; an activity dot shows which sessions are working, idle, or exited. Binds to `127.0.0.1` only.

## Run it

```sh
npm install        # installs dependencies
npm test           # runs the unit/integration tests (137/137)
npm start          # serves the cockpit at http://127.0.0.1:4477
```

The design spec and implementation plan (kept for reference) live in:

- **Design:** [`docs/superpowers/specs/2026-06-16-cc-cockpit-design.md`](docs/superpowers/specs/2026-06-16-cc-cockpit-design.md)
- **Plan:** [`docs/superpowers/plans/2026-06-16-cc-cockpit-mvp.md`](docs/superpowers/plans/2026-06-16-cc-cockpit-mvp.md)

## Requirements

- Node.js v22+ (developed on v24).
- The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) installs from npm and bundles its own version-pinned `claude` binary — there is no native module to compile.
