# Living Documentation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a maintained, current-state reference (`docs/reference/`) that is the single source of truth for cc-cockpit's features, mechanisms, and options/parameters, and retire the practice of inferring current state from the changelog.

**Architecture:** A new `docs/reference/` directory holds an index plus three category files (`features.md`, `mechanisms.md`, `options.md`) of uniformly-formatted entries keyed by stable `FEAT-`/`MECH-`/`OPT-` handles. `CLAUDE.md` slims to orientation plus a pointer; `docs/superpowers/` is banner-marked historical; `local-docs.md`'s load-bearing facts migrate into the reference and the file is trimmed. Upkeep is convention-only (same-commit updates plus a Last-verified date).

**Tech Stack:** Markdown only. No code, no build step, no automated tests. Verification is review + `grep`.

**Spec:** `docs/superpowers/specs/2026-06-29-docs-system-design.md`.

## Global Constraints

- Single source of truth: every fact has exactly one home. After migration, a fact in `docs/reference/` must NOT be duplicated in `CLAUDE.md` or `local-docs.md`.
- Entry format is identical across categories: handle + human-name heading; "What it is / does" (role-level, 1–3 sentences); "Key facts" bullets; an optional light role-level pointer (never a file\:line, function, or selector); and a mandatory `**Last verified: YYYY-MM-DD**` line.
- Handle scheme: `FEAT-`, `MECH-`, `OPT-`, each numbered or slug-named within its category; handles are stable and immutable; a removed entry's handle is never reused.
- Code references are light role-level pointers only (e.g. "the session-spawn path"), per the spec §3 decision. No function/selector/line-level mapping.
- Markdown style (project rule): do NOT hard-wrap prose. One line per paragraph or list item; reserve hard breaks for headings, list items, code blocks, and tables.
- Commit per task (project convention). Use the dates given verbatim; today is 2026-06-29.
- GUI-surface exhaustiveness is delivered separately by the I2/TPC2 glossary skill; this plan only reserves the index link to `features-gui-mapping/`. Do NOT hand-write an exhaustive GUI element map here.

**Scope note (read before executing):** This plan covers TODO **I1/TPC5 (the docs system) and I3/TPC4 (the `local-docs.md` migrate-then-trim)** together, because population and migration are coupled — populating `mechanisms.md` without `local-docs.md`'s facts would leave it artificially incomplete. This means I3 is executed before I2 (the glossary skill), a deliberate reorder from the listed I1→I2→I3 sequence. I2 remains the separate next item.

---

### Task 1: Scaffold `docs/reference/` (index + three empty category files + the entry-format definition)

**Files:**
- Create: `docs/reference/README.md`
- Create: `docs/reference/features.md`
- Create: `docs/reference/mechanisms.md`
- Create: `docs/reference/options.md`

**Interfaces:**
- Produces: the directory layout, the canonical entry-format template, the handle scheme, and the upkeep rule that Tasks 3–7 all depend on.

- [ ] **Step 1: Write `docs/reference/README.md`**

Content (verbatim structure; fill the link targets):

```markdown
# cc-cockpit — Reference (current state)

This is the single source of truth for how cc-cockpit works **right now**: its features, mechanisms, and options/parameters. Read it instead of inferring current behavior from `../superpowers/` (historical design records) or from git history.

## How to use
- **Features** — what you can do: [features.md](./features.md)
- **Mechanisms** — how it works under the hood: [mechanisms.md](./mechanisms.md)
- **Options / Parameters** — what you can tune: [options.md](./options.md)
- **GUI glossary & visual map** — exhaustive, auto-generated GUI surface: [../../features-gui-mapping/](../../features-gui-mapping/) (built by the glossary skill, I2/TPC2)

## Handle scheme
Every entry is keyed by a stable handle: `FEAT-<slug>`, `MECH-<slug>`, `OPT-<slug>`. Handles are immutable and never reused; cross-reference entries by handle.

## Entry format
Each entry is:

​    ### MECH-env-scrub — Parent-env scrub at spawn
​    **What it does:** one to three role-level sentences.
​    **Key facts:**
​    - bullet (mechanism: invariants / protocol shapes; option: name · default · effect · range)
​    **Last verified: YYYY-MM-DD**

Optionally one light role-level pointer to the responsible area (e.g. "the session-spawn path") — never a file path, function, or selector.

## Upkeep rule (convention-only)
When you change, add, or remove a feature, mechanism, or option, **update its entry here in the same commit** and **stamp its Last-verified date**. New entries take the next handle in their category. There is no tooling enforcing this — the Last-verified date is the only staleness signal, so it is mandatory on every entry.
```

- [ ] **Step 2: Create the three category files with headers and the format reminder**

Each of `features.md`, `mechanisms.md`, `options.md` starts with (example shown for features.md; adjust title/prefix per file):

```markdown
# Features (current state)

Entries are `FEAT-<slug>`. Format and upkeep rule: see [README.md](./README.md). Keep facts here only — do not duplicate them in CLAUDE.md.

<!-- entries below, one per FEAT- handle -->
```

- [ ] **Step 3: Verify scaffold**

Run: `ls docs/reference` and confirm four files. Open `README.md` and confirm the three relative links resolve to the sibling files and the `features-gui-mapping/` link points at the repo root.
Expected: four files present; links resolve.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/
git commit -m "docs(reference): scaffold living docs (index + category files + entry format)"
```

---

### Task 2: Mark `docs/superpowers/` historical

**Files:**
- Create: `docs/superpowers/README.md`

- [ ] **Step 1: Write the banner**

```markdown
# Historical design records — NOT current-state documentation

This directory holds point-in-time **specs**, **plans**, and **worklogs** — a changelog of what each feature was designed to be when it was built. It is NOT a description of how cc-cockpit behaves now.

**Do not infer current behavior from these files.** For current state, see [`../reference/`](../reference/).
```

- [ ] **Step 2: Verify**

Run: `head -n 3 docs/superpowers/README.md`
Expected: the banner heading is present.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/README.md
git commit -m "docs(superpowers): banner marking the directory as historical-only"
```

---

### Task 3: Populate `mechanisms.md` (includes the `local-docs.md` reference migration — I3)

**Files:**
- Modify: `docs/reference/mechanisms.md`

**Sources to draw facts from (cite, then verify):** `CLAUDE.md` (Architecture and Status sections), the named specs under `docs/superpowers/specs/`, and `local-docs.md` §3 (protocol shapes + env-scrub), §5 (SDK process model), §7 (binary strategy), §1–2 (zero-token / env-scrub guardrails).

**Entries to create** (one `MECH-` entry each; verify each fact against the cited source before writing):

1. `MECH-sdk-driver` — one durable `query()` per session; spawns and owns the child `claude` over stdio. (source: CLAUDE.md Architecture; local-docs §2, §5)
2. `MECH-env-scrub` — parent-env scrub at spawn via the SDK `env` option. (local-docs §3, §1–2)
3. `MECH-normalize-fold` — stdout stream → typed items (`user`/`assistant`/`thinking`/`tool`/`todos`). (CLAUDE.md Architecture)
4. `MECH-session-state` — hook-driven `working`/`idle`/`needs-you`; `your-move` derived from focus. (specs 2026-06-19, 2026-06-17; CLAUDE.md Status)
5. `MECH-gui-protocol` — `gui-snapshot` + `gui-delta` ops; `attach`/`detach`/`peek`. (specs 2026-06-25 gui-mode; passive-preview spec)
6. `MECH-session-registry` — the in-memory session list + custom-name precedence (customName > aiTitle > folder basename). (temp-sessions/rename spec)
7. `MECH-discovery-scan` — transcript tailer + recent-scan of `~/.claude/projects/*/*.jsonl` for resume/aiTitle. (session-discovery spec)
8. `MECH-projects` — projects root resolution; `isUnderProjectsRoot`, `lastActivityByPath`. (discovery-and-projects spec)
9. `MECH-uploads` — image upload path (`/api/upload-image`) + token serialization. (image-paste spec)
10. `MECH-topics` — per-session topics file feeding the floating Topics panel + statusline.
11. `MECH-control-channel` — SDK control ops: permission / interaction requests, `setPermissionMode`, `abortController` interrupt. (sdk-control-channel spec; blocking-interaction-modal spec)
12. `MECH-usage-windows` — 5h / 7d / context-window usage computation behind the usage chip. (usage-windows-chip spec)
13. `MECH-stream-json-shapes` — the `system/init`, `assistant`, `rate_limit_event`, terminal `result` shapes. (local-docs §3)
14. `MECH-binary-strategy` — SDK-bundled, exact-version-pinned `claude`; `pathToClaudeCodeExecutable` unset; lag/stall gap. (local-docs §7)
15. `MECH-zero-token-guardrails` — zero-token invariant + subscription-only posture. (local-docs §1–2)

- [ ] **Step 1: Draft all `MECH-` entries** using the format, one per item above. Worked example for the format:

```markdown
### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** Strips the parent Claude Code session's leaked markers from the environment handed to each spawned `claude`, so every cockpit session launches like a fresh top-level session. Delivered through the SDK `env` option, which replaces (not merges) the child environment.

**Key facts:**
- Strips `CLAUDECODE`, the `CLAUDE_CODE_*` namespace (incl. `CLAUDE_CODE_CHILD_SESSION`), `CLAUDE_EFFORT`, and `AI_AGENT`.
- Mandatory: without it a spawned `claude` inherits the child-session marker and writes no transcript (the no-transcript bug).
- The SDK `env` option replaces the child env, so the cockpit passes the full scrubbed env (`scrubParentClaudeEnv({ ...process.env })`); a minimal env would break the spawn (lost `PATH`/`USERPROFILE`).
- Role-level location: the session-spawn path.

**Last verified: 2026-06-29**
```

- [ ] **Step 2: Verify each entry against its source**

For each entry, re-read the cited source and confirm the "Key facts" are accurate and current (the PTY substrate is gone — flag and drop any fact that describes removed PTY behavior). Confirm every entry has a `Last verified: 2026-06-29` line and a unique handle.
Run: `grep -c "^### MECH-" docs/reference/mechanisms.md` → expect 15. `grep -c "Last verified:" docs/reference/mechanisms.md` → expect 15.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/mechanisms.md
git commit -m "docs(reference): populate mechanisms.md (incl. local-docs reference migration, I3)"
```

---

### Task 4: Populate `features.md`

**Files:**
- Modify: `docs/reference/features.md`

**Sources:** the `CLAUDE.md` Status section (the ✅ list enumerates shipped features) and the named specs.

**Entries to create** (one `FEAT-` each; verify against Status + spec):

1. `FEAT-multi-session-cockpit` — one window, all live sessions, instant switch, type into any.
2. `FEAT-sidebar-grouping` — sessions grouped by project, state dot, attention states sorted to top, exited ✕ with kill/remove.
3. `FEAT-session-state` — Needs-you / Working / Your-move / Idle states and their sidebar groups.
4. `FEAT-projects` — project grouping + the create-and-start project picker.
5. `FEAT-resume-discovery` — Resume modal: day/3d/week tabs, Global/Cockpit/Temporary scope switch.
6. `FEAT-temp-sessions` — one-off temporary sessions under the temp dir, distinct group, auto-named.
7. `FEAT-rename` — in-memory custom session display label.
8. `FEAT-quick-preview` — read-only live `peek` preview.
9. `FEAT-navigation` — open-folder, search box, project time bands, Escape-to-close modals.
10. `FEAT-image-paste` — paste/upload images in compose + drag-to-reposition tokens.
11. `FEAT-interaction-modal` — blocking modal for permission / AskUserQuestion / plan-accept / MCP elicitation.
12. `FEAT-usage-chip` — header chip showing 5h / 7d / context usage.
13. `FEAT-header-controls` — model select, effort select, permission-mode dropdown (6 modes), interrupt/stop.
14. `FEAT-float-panels` — floating In-session-todo / Topics / TODO.MD header panels.
15. `FEAT-conversation-render` — GUI rendering of user/assistant/thinking/tool/todos, tool cards, and the waiting-for-Claude spinner.

- [ ] **Step 1: Draft all `FEAT-` entries** in the standard format, sourcing each from the Status line + its spec.

- [ ] **Step 2: Verify**

Run: `grep -c "^### FEAT-" docs/reference/features.md` → expect 15. `grep -c "Last verified:" docs/reference/features.md` → expect 15. Spot-check three entries against their specs.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/features.md
git commit -m "docs(reference): populate features.md"
```

---

### Task 5: Populate `options.md`

**Files:**
- Modify: `docs/reference/options.md`

**Sources:** `public/index.html` (the header selects/chips), `server/*.js`, `CLAUDE.md` (Conventions/Prerequisites), `.mcp.json`, and `local-docs.md` §7. Read the code to confirm exact defaults/values — do not guess.

**Entries to create** (one `OPT-` each; confirm the live value against code before writing — drop any that no longer exist post-PTY-removal, e.g. verify whether a raw ring buffer still exists):

1. `OPT-port` — `PORT` env, default `4477`.
2. `OPT-bind-host` — server binds `127.0.0.1` only (never expose to network).
3. `OPT-permission-modes` — the six modes: `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto` (with the one-line meaning of each).
4. `OPT-model` — model select values: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`.
5. `OPT-effort` — effort select values: `low`, `medium`, `high` (default), `xhigh`, `max`.
6. `OPT-env-scrub-list` — the exact set of vars stripped at spawn (cross-link `MECH-env-scrub`).
7. `OPT-claude-binary` — bundled binary; `pathToClaudeCodeExecutable` left unset (cross-link `MECH-binary-strategy`).
8. `OPT-projects-root` — the cockpit projects root and the temporary-sessions directory locations.
9. `OPT-playwright-mcp` — `.mcp.json` Playwright server with `--output-dir .playwright-mcp` (verification tooling).
10. `OPT-poll-interval` — any transcript/title poll interval constants (confirm the live value in `server/*.js`).

- [ ] **Step 1: Read code to confirm exact values**

Run: `grep -rn "4477\|127.0.0.1\|permissionMode\|claude-opus\|PORT" server public/index.html` and read the hits to lock exact defaults.

- [ ] **Step 2: Draft all `OPT-` entries** using `name · default · effect · range` in Key facts.

- [ ] **Step 3: Verify**

Run: `grep -c "^### OPT-" docs/reference/options.md` and confirm it equals the number of entries actually written (drop any non-existent option). `grep -c "Last verified:" docs/reference/options.md` matches.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/options.md
git commit -m "docs(reference): populate options.md"
```

---

### Task 6: Slim `CLAUDE.md` (remove the Status log, add the pointer + upkeep rule)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the `## Status` section** with a one-line pointer:

```markdown
## Status

Current state — features, mechanisms, options/parameters — lives in [`docs/reference/`](docs/reference/). Read it rather than inferring from `docs/superpowers/` (historical design records).
```

- [ ] **Step 2: Add the upkeep rule** to the `## Conventions` section as a new bullet:

```markdown
- **Docs upkeep (convention-only):** when you change/add/remove a feature, mechanism, or option, update its entry in `docs/reference/` in the same commit and stamp its Last-verified date. New entries take the next handle in their category.
```

- [ ] **Step 3: Trim the architecture summary** so depth lives in `mechanisms.md`. Keep a 2–3 sentence orientation and end it with: "Full mechanism reference: `docs/reference/mechanisms.md`." Do not delete the conventions, prerequisites, or non-goals sections.

- [ ] **Step 4: Verify no duplication**

Confirm the detailed ✅ Status list is gone and that facts now in `docs/reference/` are not restated in `CLAUDE.md`.
Run: `grep -n "✅\|merged to" CLAUDE.md` → expect no matches (or only an intentional pointer).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): slim to orientation + reference pointer; add docs upkeep rule"
```

---

### Task 7: Trim `local-docs.md` to lean working notes (I3 trim half)

**Files:**
- Modify: `local-docs.md`

**Precondition:** Task 3 has migrated §3/§5/§7/§1–2 reference facts into `mechanisms.md`. Do not start until that commit exists.

- [ ] **Step 1: Remove migrated and historical content**

Delete: §4 (pre-re-arch PTY architecture map — describes removed code), §6 ("Other" changelog noise), and the bodies of §3/§5/§7 (now in `mechanisms.md`). Trim §1 (commercialization) and §2 (re-architecture) to a one-line decision each (the guardrail facts live in `MECH-zero-token-guardrails`).

- [ ] **Step 2: Leave a lean working-notes file** — a short header plus only genuinely-active scratch notes, with a pointer to `docs/reference/` for anything factual.

- [ ] **Step 3: Verify no reference fact was lost**

For each fact removed, confirm it exists in `docs/reference/`. 
Run: `grep -n "CLAUDE_CODE_CHILD_SESSION\|five_hour\|asarUnpack\|zero-token" docs/reference/mechanisms.md` → confirm the key migrated facts landed.

- [ ] **Step 4: Commit**

```bash
git add local-docs.md
git commit -m "docs(local-docs): trim to lean working notes; reference facts migrated to docs/reference (I3)"
```

---

### Task 8: Final consistency pass + close TODO items

**Files:**
- Modify: `TODO.md` (via the `/todo` skill script, not by hand)

- [ ] **Step 1: Whole-system review**

Confirm: every `docs/reference/` entry has a unique handle + a Last-verified date; `README.md` links all resolve; the `docs/superpowers/` banner is present; `CLAUDE.md` carries the pointer + upkeep rule and no duplicated Status log; `local-docs.md` lost no reference fact.
Run: `grep -rc "Last verified:" docs/reference/*.md` and confirm each category file's count matches its entry count.

- [ ] **Step 2: Mark TODO items done** (do NOT close the topics — that is the user's call)

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Ti\.claude\skills\todo\Manage-Todo.ps1" -Action set -Id I1 -Status done -Path "D:\zabawa\Claude projects\cc-cockpit\TODO.md"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Ti\.claude\skills\todo\Manage-Todo.ps1" -Action set -Id I1.1 -Status done -Path "D:\zabawa\Claude projects\cc-cockpit\TODO.md"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Ti\.claude\skills\todo\Manage-Todo.ps1" -Action set -Id I1.2 -Status done -Path "D:\zabawa\Claude projects\cc-cockpit\TODO.md"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Ti\.claude\skills\todo\Manage-Todo.ps1" -Action set -Id I1.3 -Status done -Path "D:\zabawa\Claude projects\cc-cockpit\TODO.md"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Ti\.claude\skills\todo\Manage-Todo.ps1" -Action set -Id I3 -Status done -Path "D:\zabawa\Claude projects\cc-cockpit\TODO.md"
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): close I1 (docs system) and I3 (local-docs migrate-and-trim)"
```

---

## Self-Review

**Spec coverage:** §1 purpose → README + the three files (Tasks 1,3,4,5). §2 location/files → Task 1. §3 entry format → Task 1 template, applied in 3/4/5. §4 CLAUDE.md slim → Task 6. §5 historical boundary → Task 2. §6 upkeep rule → Task 1 README + Task 6 Conventions. §7 initial population + I3 migration → Tasks 3,4,5,7. §8 I2 coupling → Task 1 index link only. Verification → Task 8. All spec sections map to a task.

**Placeholder scan:** No "TBD"/"implement later". Population tasks enumerate the exact entries and cite a source per entry; the `YYYY-MM-DD` tokens are format specifiers and `2026-06-29` is the literal verified date to stamp.

**Type consistency:** Handle prefixes (`FEAT-`/`MECH-`/`OPT-`) and the entry-format fields ("What it is / does", "Key facts", "Last verified") are used identically across Tasks 1,3,4,5. Cross-links (`MECH-env-scrub`, `MECH-binary-strategy`) reference handles defined in Task 3.

**Known judgment points left to execution (by design, not placeholders):** exact option values and which options still exist post-PTY-removal are confirmed by reading code in Task 5; any fact describing removed PTY behavior is dropped during the Task 3/5 verification steps.
