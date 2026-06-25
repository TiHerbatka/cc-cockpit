# cc-cockpit — B2 no-transcript bug: root cause & fix (2026-06-25)

**Status: FIXED on `master`.** `npm test` = 77/77. This documents the investigation that closed TODO **B2** — the bug that blocked the rich-frontend work (B1) and the discovery/temp-naming features.

## Symptom

Sessions spawned by the cockpit ran normally — they responded, wrote files in their cwd, fired the turn-boundary hooks, and created their `~/.claude/topics/<id>.json` — but wrote **no transcript `.jsonl`** anywhere under `~/.claude/projects`. Downstream consequences: such sessions never appeared in **Resume** discovery, the project picker showed projects as **"never used"**, and **temporary sessions never auto-named** (the name comes from the transcript's `aiTitle`).

## What it was NOT

- **Not the per-folder trust prompt.** The earlier theory (folders need to be trusted before a transcript is written) was disproven: folders under `C:\claude_projects` are already trusted and show no prompt, yet still wrote no transcript. The superseded note lived in `CLAUDE.md` "Status" and the 2026-06-24 handoff.
- **Not a delayed flush.** No file appeared even after the session was alive and responding for 45s+.
- **Not the injected `--settings` hooks file.** Per the Claude Code docs, `--settings` *merges* with (never replaces) the settings hierarchy and has no documented effect on persistence. The end-to-end test below keeps `--settings` injected and the transcript is still written.
- **Not `CLAUDE_CONFIG_DIR` / `HOME` / `USERPROFILE`.** All normal; `os.homedir()` resolved correctly.

## Root cause — parent-session environment inheritance

The cockpit server is routinely started **from inside a Claude Code session** (per `CLAUDE.md`, the assistant restarts the dev server itself after server-side edits). When Claude Code launches a subprocess it injects markers identifying that subprocess as part of *its* session. The decisive one is **`CLAUDE_CODE_CHILD_SESSION=1`**.

`server/pty.js` `buildSpawn` built the child environment with `const env = { ...process.env }` — copying the **entire** parent environment, including `CLAUDE_CODE_CHILD_SESSION=1`, into every spawned `claude`. A `claude` that sees that flag treats itself as a **nested child session** and deliberately does **not** persist a transcript (so nested invocations don't pollute history). Every cockpit session inherited the flag → none persisted.

The cockpit's own env vars (`CC_COCKPIT_SESSION`, `CC_COCKPIT_PORT`) are in a separate namespace and were never the issue.

## Proof (controlled differential)

Reproduced with `node-pty` driving an interactive `claude --session-id <uuid>` in the **same already-trusted cwd**, varying **only the environment** (scripts in scratchpad: `diag-interactive.js`, `diag-narrow.js`):

| Environment | Responds? | Transcript written? |
|---|---|---|
| Full inherited env (`CLAUDE_CODE_CHILD_SESSION=1` present) | yes | **no** — reproduces the bug |
| Same, but `CLAUDE_CODE_CHILD_SESSION` stripped (alone) | yes | **yes** |
| Same, but only `CLAUDECODE` stripped | yes | **no** |

So `CLAUDE_CODE_CHILD_SESSION` is the single responsible variable; `CLAUDECODE` is not.

**Why earlier probes missed it:** in **print mode (`claude -p`)** transcripts persisted under *both* the dirty and clean env, so any `-p`-based reproduction failed to surface the bug. The suppression is **interactive-mode-specific**, which is the mode the cockpit actually uses.

## Docs consulted

Confirmed via the official Claude Code docs (CLI reference, `.claude` directory, settings reference): transcripts live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; persistence can be disabled by `CLAUDE_CODE_SKIP_PROMPT_HISTORY` or `--no-session-persistence` (print mode only); `--settings` merges and does not relocate or disable transcripts. None of those were being set by the cockpit — the suppression came from the inherited child-session marker, consistent with the docs' "nested/child" model.

## Fix

`server/pty.js` — new `scrubParentClaudeEnv(env)` deletes, before the spawn: `CLAUDECODE`, every key in Claude Code's `CLAUDE_CODE_*` namespace (covers the child-session flag, parent session id, entrypoint, exec path, and any future additions), plus the parent's runtime context `CLAUDE_EFFORT` / `AI_AGENT`. `buildSpawn` now wraps its env in `scrubParentClaudeEnv({ ...process.env })` and adds the `CC_COCKPIT_*` vars after the scrub, so every spawned `claude` launches like a fresh top-level session regardless of how the cockpit server itself was started.

## Verification

- **Unit (TDD, written failing first):** `test/pty.test.js` → `buildSpawn scrubs inherited parent Claude Code session env vars`. Sets the markers on `process.env`, asserts they are absent from the spawn env while `CC_COCKPIT_*` and `PATH` survive. Suite: **77/77**.
- **End-to-end:** `diag-verify-fix.js` drives the *real* `spawnClaude` path (with the actual injected `--settings`) under this process's dirty parent env (`CLAUDE_CODE_CHILD_SESSION=1` present) → a fresh transcript `.jsonl` now appears under `~/.claude/projects`.
- Throwaway "PONG" test transcripts created during the investigation were removed so they don't clutter the Resume list.

## Operational note

A cockpit server that was **already running** must be **restarted** to pick up this server-side change. Restarting the *main* cockpit kills its live sessions (it owns the PTYs), so restart deliberately. A fresh `npm start` has the fix.

## Unblocks

- **B1** — the rich Approach-B frontend (tails per-session JSONL) depended on transcripts existing.
- Review items **A4 / A5** — temp-session auto-naming and cockpit/temp discovery, which are downstream of transcript persistence.
