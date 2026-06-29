# cc-cockpit — Local docs

Working notes and the most important takeaways. Most recent session: 2026-06-29.

> **Update (2026-06-28):** the §2 re-architecture has since shipped on branch `feat/agent-sdk-rearch` — cc-cockpit is now **SDK-only** and the PTY/terminal substrate that §4 describes as current has been **removed entirely** (no fallback). §4 is retained below as the pre-re-arch (PTY-era) snapshot.

## Session takeaways — 2026-06-27 (commercialization + programmatic re-architecture)

### 1. Commercialization & ToS (TPC3 — resolved, cleared to develop)

- **Verdict:** LOW–MEDIUM risk, a *tolerated gray area* — not affirmatively blessed, but not prohibited. The user resolved the topic and we proceed with development.
- **Core thesis (verified):** A tool that only **launches the user's own, unmodified, official `claude` binary** under the user's own subscription login, and **never touches credentials**, is NOT prohibited. Anthropic's own legal-and-compliance doc says subscription OAuth "is designed to support ordinary use of Claude Code".
- **Two-paywall business model (clean):** Each end user installs the official Claude app themselves and pays Anthropic for their **own** Claude subscription; separately they pay a small (~$1–5/mo) cc-cockpit software subscription. cc-cockpit's subscription is scoped purely to cc-cockpit's own features — it never meters, gates, resells, pools, or impacts Claude usage.
- **The only two named prohibitions** (from code.claude.com/docs/en/legal-and-compliance) — cc-cockpit does neither: (a) offering a Claude.ai login flow for your product; (b) routing requests through Free/Pro/Max credentials **on behalf of** users.
- **What actually got other tools banned** (OpenClaw, Roo Code, Goose, etc., early 2026): they **extracted the subscription OAuth token** and used it in their own API client / on servers, bypassing the official tooling. The **zero-token invariant** is the load-bearing legal distinction: cc-cockpit must NEVER read, store, cache, proxy, extract, or transmit OAuth tokens or credentials.
- **Enforcement ceiling** (realistic worst case): C&D + reversible abuse-flag suspension under abnormal concurrency — NOT a targeted ban, as long as the zero-token invariant holds.
- **Business customers are the cleaner path, not the riskier one:** selling B2B software is not reselling access; employees authenticating their own Team/Enterprise seats run under the Commercial Terms (business use expressly permitted). Only thing to avoid: nudging consumer Pro/Max users into business use.
- **Guardrails to preserve in the build:** zero-token invariant; subscription-only env scrub at spawn; market it as orchestration (not "cheaper than API", not "personal plan for business"); headless mode is the highest-risk surface; do not rely on `forceLoginMethod` (version-churned + open bug, belt-and-suspenders only — env scrubbing is the real guard).
- **Outreach:** A private email asking Anthropic the commercial question head-on is drafted and saved at `docs/outreach/2026-06-27-anthropic-compliance-question-email.md`. Probability of a meaningful reply from a small dev is LOW; asking risks converting tolerated-gray into an on-record denial. User will review and decide whether/how to send.
- Not legal advice; consult counsel before scaling.

### 2. Re-architecture to programmatic interaction (TPC2 — done; shipped on branch `feat/agent-sdk-rearch`)

- **Decision:** Replace PTY screen-driving, project-wide, with **structured headless interaction** driving the user's own official `claude` binary. Driving by scraping the terminal screen is a weak foundation; interact programmatically instead.
- **Substrate choice (corrected 2026-06-27 — supersedes the compaction-era note):** Drive each session through the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) `query()` for the core. A prior compacted session mistakenly recorded the raw `claude` CLI in stream-json as the substrate; that is wrong and superseded. The two are not competing options: the SDK spawns and owns a local `claude` subprocess and talks to it over stdio in the same newline-delimited JSON (stream-json) protocol, so the SDK is a programmatic wrapper *over* stream-json, not an alternative to it — we let the SDK speak the protocol instead of hand-rolling the raw CLI. **Auth:** the SDK's bundled `claude` authenticates on the **user's own Claude Code subscription** (verified — `five_hour` subscription rate-limit, success), so the zero-token / subscription-only posture holds. **Env control:** the SDK's `env` option *replaces* the child env (it does not merge with `process.env`), so we pass the complete scrubbed env (`scrubParentClaudeEnv({ ...process.env })`) through it — identical scrub logic to the PTY path, just enforced at the SDK option instead of at our own `child_process`/PTY handle; omitting `env` reintroduces the leaked parent markers (the no-transcript bug) and a minimal `env` breaks the spawn (lost `PATH`/`USERPROFILE`).
- **Plan / sequencing (as executed):** the old PTY implementation was archived to a separate branch, then the code was restructured. **The PTY substrate was ultimately removed entirely** — cc-cockpit is SDK-only with no fallback; the GUI renders solely from the SDK message stream.
- **Hard constraint:** one durable streaming session per cockpit session.
- **Open design decisions (next):** (1) confirm the stream-json control protocol shapes (send prompt, answer permission, interrupt) via a spike; (2) what the GUI renders when PTY is no longer primary; (3) the incremental migration path; (4) the design spec (this re-architecture has no `docs/` spec yet — brainstorming → spec → plan is the process).

### 3. Empirical findings (verified on this machine, 2026-06-27)

- **Env scrub is mandatory when spawning from inside a Claude Code session.** The parent leaks `CLAUDECODE`, `CLAUDE_CODE_*` (incl. `CLAUDE_CODE_CHILD_SESSION`), `AI_AGENT`, `CLAUDE_EFFORT`. cc-cockpit's `scrubParentClaudeEnv` strips exactly these; without it the spawned `claude` behaves like a nested child session (the earlier no-transcript bug).
- **Output protocol shapes (captured):** stream-json output emits newline-delimited JSON — `system/init` (carries `cwd`, `session_id`, `tools`, `model`, `permissionMode`), `assistant` (content array), `rate_limit_event`, and a terminal `result` (`subtype`, `is_error`, `result`, `usage`, `total_cost_usd`). SessionStart hooks also surface as `system/hook_started` + `system/hook_response`.

### 4. Pre-re-arch architecture map (the PTY-era state TPC2 replaced — historical)

- **cc-cockpit is already half-structured, not a pure screen-scraper.** In GUI mode, OUTPUT is structured: it tails the session's `~/.claude/projects/*/<id>.jsonl` transcript (250 ms poll) and runs it through `server/normalize.js` into typed items (`user`/`assistant`/`thinking`/`tool`/`todos`). The GUI renders from that model, not from terminal bytes.
- **What is still keystroke- or screen-derived (the real target of TPC2):** submit (`text + "\r"` into the PTY + a 3× bare-Enter "nudge" timer fighting a TUI race); permission answers (digit keystrokes `1`/`2`/`3` to the PTY); interrupt/mode (`\x1b`, `\x1b[Z`); the mode + usage chips (`readFooter()` scrapes xterm's cell grid + regex in `modeparse.js`/`usageparse.js`); and the output transport itself (a disk poll, not a live stream).
- **The prize of TPC2** is a structured **input + control** channel (plus a live structured output stream), which deletes the nudge timer, the digit-keystroke permissions, the escape-code hacks, and the footer scraping. The existing `normalize()` model is largely reusable as the render target.
- **Biggest coupling points to change:** the raw-bytes → xterm sink; `server/buffer.js` RingBuffer (stores raw bytes); the `peek`/`peeked` preview replay; the footer scraping; interrupt/mode escape codes; the compose-submit + nudge path; permission-answer keystrokes; PTY resize semantics; the `--session-id` + transcript-tail machinery (replaced by reading stdout directly); the `gui`/`terminal` dual-mode split.

### 5. Agent SDK process model (facts — now the core substrate, per §2)

- `query()` **spawns and owns a local `claude` subprocess** (a binary bundled in the npm package, version-pinned to the SDK) and talks to it over stdio — it is NOT a thin network client to the API.
- The caller does **not** get a raw OS process handle; you configure the spawn via options (`env` — note it **replaces** the env, doesn't merge; `cwd`; `pathToClaudeCodeExecutable`; `executable`; `executableArgs`; `settings`; `permissionMode`; `canUseTool`) and control it via SDK methods (`abortController`, `setPermissionMode`, `streamInput`, the message stream); `resume`/`continue` for sessions.
- You CAN fully control the child env (strip inherited vars by not spreading `process.env`) and point it at a different executable via `pathToClaudeCodeExecutable`.

### 6. Other

- **A1.7 done:** image-token drag-to-reposition in the GUI compose box is implemented, committed (`44037c1`), 130 tests pass.

## Session takeaways — 2026-06-29 (claude binary version strategy)

### 7. Which `claude` runs sessions — stick with the SDK-bundled binary (decision)

- **Decision:** cc-cockpit keeps using the **SDK-bundled `claude` binary** — the default; `pathToClaudeCodeExecutable` stays unset. It does NOT use the user's separately-installed standalone Claude Code CLI.
- **Why bundled is the safe bind:** the binary ships as a per-platform optional dependency **exact-version-pinned** to `@anthropic-ai/claude-agent-sdk` (no caret/tilde — verified: SDK `0.3.195` → `@anthropic-ai/claude-agent-sdk-win32-x64` `0.3.195` → `claude.exe` `2.1.195`). SDK and its binary therefore move as one atomic unit and **cannot diverge** — the binary is guaranteed to speak the stdio/stream-json control protocol the installed SDK expects. This is the only structurally-guaranteed-compatible pairing.
- **The gap we accept:** the bundled binary is **inert** — no background self-updater. Its version equals the installed `@anthropic-ai/claude-agent-sdk` version, full stop. So it can **lag** the user's standalone `claude` (which auto-updates continuously) and **stalls** entirely if the SDK dependency is never bumped.
- **What the gap does and does NOT mean:** model intelligence/accuracy is **server-side** and identical across CLI builds (both call the same Claude models on the user's subscription). A lag means missing recent **client features / fixes / harness improvements** — and occasionally access to a **brand-new model gated on a CLI update** — NOT a less capable Claude.
- **Required practice so it doesn't stall:** keeping current is the cockpit's job — bump `@anthropic-ai/claude-agent-sdk` and reinstall, **test-gated** (the pre-1.0 SDK JS API can change between releases, so each bump must be validated against the cockpit's own `query()` usage). Fold into the cockpit's normal update cadence; intended mechanism is a startup "newer SDK available" check + one-click update-and-restart.
- **Rejected as default, kept as a possible opt-in:** pointing `pathToClaudeCodeExecutable` at the user's standalone `claude` gives single-source / always-latest, but forfeits the compatibility guarantee — SDK and the standalone CLI are **independent publish streams** that can diverge, surfacing as silent protocol breakage (crash on an unknown flag, a hung query on an unanswered control request, or silently degraded permission/hook/MCP features) with **no** clean version-aware error. Recorded as a possible setup-time opt-in (TODO E5), not the default.
- **Electron (E3) interaction:** the session-running binary lives inside the app's own `node_modules`, so packaging must keep it launchable (`asarUnpack` the binary + point `pathToClaudeCodeExecutable` at the unpacked path). The standalone-binary opt-in would sidestep that packaging step but take on the divergence risk.
