# cc-cockpit — Living documentation system (design)

Date: 2026-06-29 · TODO item: I1 / TPC5 · Status: design spec (point-in-time design record; the living docs it specifies live in `docs/reference/`).

## Problem

cc-cockpit has no maintained current-state reference, and the existing material actively misleads anyone trying to learn how the system behaves now:

- `docs/superpowers/` is a changelog of point-in-time specs, plans, and worklogs. Reading it to learn current behavior is a hallucination risk — it records what each feature was meant to be when built, not how the system works today.
- `CLAUDE.md` carries a long embedded "Status" log (a bulleted `✅ merged…` history) inside the always-loaded file — the same changelog hazard, in the file every session reads first.
- `local-docs.md` mixes load-bearing reference facts (stream-json protocol shapes, SDK process model, binary-version strategy, the zero-token / env-scrub guardrails) with historical and established content.

There is nowhere that authoritatively answers "what features exist, how do the mechanisms work, and what can I tune" as of now.

## Goals

- A co-equal single-source-of-truth current-state reference covering Features, Mechanisms, and Options/Parameters, serving the user and Claude equally well.
- A clear boundary that designates `docs/superpowers/` as historical-only, so neither reader infers current state from it.
- A convention-based upkeep rule that keeps the reference current without tooling.

## Non-goals

- No automated doc-gate or git/Stop-hook enforcement. Upkeep is convention-only by decision; a `/docs` audit skill is recorded as a possible later upgrade if drift appears.
- No code map — no function/selector/line-level mapping. Light role-level pointers to a responsible area are allowed where they aid understanding.
- The GUI glossary skill (I2 / TPC2) and the `local-docs.md` migration mechanics (I3 / TPC4) are separate TODO items. This spec defines only their interface to the docs structure, not their implementation.

## Decisions (from the brainstorm)

- Primary consumer: co-equal — one source both rely on (Q1 = C).
- Boundary with `CLAUDE.md`: the docs own all depth; `CLAUDE.md` slims to orientation + conventions + a pointer, and its Status log is distilled into the docs and removed (Q2 = A).
- Granularity: "thorough, not pedantic" — between exhaustive and load-bearing-only (Q3); definition below.
- On-disk structure: category files plus an index (Q4 = A).
- Upkeep: convention-only (Q5 = A).
- Code references in the prose docs: light role-level pointers are allowed (§3 follow-up).

## Design

### Location and files

A new `docs/reference/` directory, a sibling of the historical `docs/superpowers/`:

- `docs/reference/README.md` — the index: what this is, how to use it, the handle scheme, the upkeep rule, and links to the three category files and the GUI glossary.
- `docs/reference/features.md` — user-facing capabilities.
- `docs/reference/mechanisms.md` — internal how-it-works.
- `docs/reference/options.md` — configurable knobs.

A category file is split into a folder (e.g. `features/`) only if it grows unwieldy. The GUI glossary artifacts produced by I2 live under the project-root `features-gui-mapping/`; the index links out to them rather than embedding them.

### Content model (entry format)

Every entry shares one shape so it is both greppable for an agent and browseable for a human:

- Heading is a stable handle plus a human name, e.g. `### MECH-env-scrub — Parent-env scrub at spawn`. Handle prefixes are `FEAT-`, `MECH-`, `OPT-`. Handles are stable and immutable, assigned next-in-sequence within a category; a removed entry leaves a gap and its number is never reused (same discipline as the TODO IDs). This mirrors the glossary's ID-plus-handle scheme and lets entries cross-reference each other by handle.
- "What it is / does" — one to three sentences at role level.
- "Key facts" — bullets. For a mechanism: its invariants and any protocol shapes. For an option: name, default, effect, and valid range/values.
- An optional light role-level pointer to the responsible area (e.g. "the spawn path"), never code internals, never a file\:line.
- "Last verified: YYYY-MM-DD" — the staleness signal. With convention-only upkeep this date is the sole indicator that an entry may have drifted, so it is mandatory on every entry.

### Granularity rule

"Thorough, not pedantic":

- Features: exhaustive — every user-facing capability gets an entry.
- Mechanisms: every named subsystem with a distinct role (env-scrub at spawn, the SDK `query()` driver, the normalize fold, hook-driven session state, the gui-snapshot/delta protocol, the transcript tailer, the session registry, uploads, topics, recent-scan, and so on) — but not anonymous private helpers.
- Options/Parameters: exhaustive for anything that changes behavior (env vars, the six permission modes, model and effort, spawn flags, tunable constants such as poll interval and ring-buffer size, `.mcp.json`); skip hardcoded trivia nobody tunes.
- Gray-zone test: "does it have a name and a distinct role someone would reference or need to understand?" Yes → document it; anonymous or self-evident → skip it.

The GUI surface gets its exhaustive coverage from the auto-regenerated I2 glossary rather than from hand-written prose here, which keeps the hand-maintained prose survivable.

### `CLAUDE.md` changes

- Remove the detailed "Status" log; its facts are distilled into `features.md` and `mechanisms.md`. Replace it with a one-line pointer: "Current state lives in `docs/reference/`; read it rather than inferring from `docs/superpowers/`."
- Keep the project intro, architecture direction, conventions, prerequisites/gotchas, and non-goals.
- Trim the architecture summary to a brief orientation and push its depth into `mechanisms.md` behind a pointer.
- Add the upkeep rule to the Conventions section.

### Historical boundary

- Add a short banner at the top of `docs/superpowers/` (via a `README.md` there): "Historical design records — NOT current-state documentation. Do not infer current behavior from these files; see `docs/reference/`."
- Mirror the steer in the `CLAUDE.md` pointer and the reference index.

### Upkeep (convention-only)

A written rule, stated in both the reference `README.md` and the `CLAUDE.md` Conventions section:

- When you change, add, or remove a feature, mechanism, or option, update its `docs/reference/` entry in the same commit.
- Stamp that entry's "Last verified" date whenever you touch it.
- A new entry takes the next handle in its category.

No tooling backs this. If drift appears despite the rule, the `/docs` audit skill (the rejected option B) is a clean drop-in upgrade later, because it would read the same files and dates.

### Initial population (couples to I3 / TPC4)

The first build fills the three files from reliable sources:

- the soon-to-be-distilled `CLAUDE.md` Status log,
- the specs and plans, used carefully as historical input (not copied as current truth),
- and the load-bearing reference content migrated out of `local-docs.md`: the stream-json protocol shapes and env-scrub fact, the SDK process model, the binary-version strategy, and the zero-token / env-scrub guardrails.

That migration is the substance of I3: migrate the reference content into `docs/reference/` first, then trim `local-docs.md` down to lean working notes. Nothing in `local-docs.md` is deleted before its keep-worthy facts have a home in the reference.

### Coupling to I2 (the glossary skill)

The reference index reserves a link to the GUI glossary and interactive map under `features-gui-mapping/`. The glossary's element handles (an exhaustive, auto-generated map of the GUI surface) and the `FEAT-` handles here (a curated, hand-maintained feature reference) are complementary, not duplicative. Building the glossary stays I2.

## Verification

These are prose documents, not code, so "done" is a manual accuracy review rather than an automated test:

- each entry is true as of its "Last verified" date,
- `CLAUDE.md` no longer duplicates any fact that moved into the reference,
- the `docs/superpowers/` historical banner is present,
- and (when I3 runs) `local-docs.md` is trimmed with no reference fact lost.

No automated tests, matching the convention-only upkeep decision.

## Future / out of scope

- A `/docs` audit skill that lists entries and flags stale "Last verified" dates — the upgrade path from convention-only upkeep.
- A per-entry source-area map enabling an automated change-detected staleness check — deferred; would require the mapping this spec deliberately keeps light.
