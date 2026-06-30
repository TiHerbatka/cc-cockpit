# cc-cockpit — Documentation guide

**Purpose:** how this project's documentation is organized and kept from going stale. Read this before adding or editing any doc. There is **no tooling** behind these rules — freshness happens only if the author runs it (there is no hook or script; *you* are the check).

**Last verified: 2026-07-01**

## Precedence — which guide wins

When guidance conflicts: **this file wins** over any restated summary; a **content `docs/` file wins** over any summary of it; and a **specific project doc outranks a generic/global default** (e.g. the global "local docs = scratch" convention, which `CLAUDE.md` explicitly overrides for this project's `local-docs.md`). Summaries point to the authority; they never override it.

## Two tiers

Documentation lives at two levels, with a strict division of labour:

1. **`local-docs.md`** (repo root) — the **entry point**. Orienting, general information plus an **index into `docs/`**. It is the human front door and the first thing to read. It must **not** hold load-bearing detail that belongs in a `docs/` file — it *links* to that file instead. (This is also the file the global "local docs" convention points at; for this project that role is overridden — see `CLAUDE.md`.)
2. **`docs/`** — the **detailed, authoritative documentation**: one file per area. This is the **source of truth for current behavior** — read it rather than inferring behavior from the code or git history.

The reason for the split: a single front door that stays short and stable (so a human or a fresh Claude session orients in seconds), backed by deep per-area files that change as the code changes.

## The `docs/` files

| File | Covers | Handle prefix |
|---|---|---|
| `docs/README.md` | this guide — conventions & structure | — |
| `docs/overview.md` | architecture & how the pieces fit together | (prose, no handles) |
| `docs/features.md` | user-facing capabilities | `FEAT-` |
| `docs/mechanisms.md` | how it works under the hood | `MECH-` |
| `docs/options.md` | tunables / parameters | `OPT-` |
| `docs/gui-map.md` | the generated GUI glossary + visual map (generated — see *Generated docs* under Freshness) | `GUI-` |

> **The GUI map is generated.** `docs/gui-map.md` + the visual map at `docs/gui-map/map.html` are produced by the `/gui-map` skill (mechanism files under `.claude/skills/gui-map/`), auto-discovered from the live GUI — never hand-edit them (see *Generated docs* under Freshness).

## Handles — stable IDs for cross-reference

Every entry in a handle-bearing file is keyed by an immutable ID: `FEAT-<slug>`, `MECH-<slug>`, `OPT-<slug>`, `GUI-<AREA>-<slug>`.

- **Immutable and never reused.** A removed entry's handle is *retired*, not deleted or recycled (see *Removing an entry* below). New entries take a **fresh descriptive slug** (not a number — handles are descriptive, not sequential).
- **Cross-reference by handle**, never by file location: write "see `MECH-sdk-driver`", not "see the third section of mechanisms.md". Handles are how both a human and Claude navigate, and how a change in one area is tied to the entries it affects.
- `GUI-` handles are element-level (areas: SIDEBAR, HEADER, CONV, COMPOSE, PANEL, INTERACTION, MODAL, MENU) and complement the capability-level `FEAT-` handles — they say *where an element is and what it's called*, not *what a capability does*. Their stability is **enforced, not aspirational**: a `GUI-` handle's identity comes from the cockpit's **existing** markup — an interactive control's fixed label, or a durable element's meaningful `id`/`class` resolved through the skill's own curated allowlist — **never** from rendered content and **never** from a product-side marker (the cockpit carries zero mapping attributes). Because identity is anchored to stable structure, a handle does not churn when fixture data, the clock, or a status value changes. The `<slug>` tail is that permanent slug, chosen once and retired-not-renamed like every other handle.
- **Removing an entry (tombstone).** A handle is never deleted or reused. To retire one, replace its body with a one-line dated tombstone: `### MECH-foo — retired YYYY-MM-DD (superseded by MECH-bar)`. In the **same commit**, grep the handle across the repo (the `docs/` files, `local-docs.md` breadcrumbs, `CLAUDE.md`, the glossary's *Part of:* lines) and update or retire each reference so nothing dangles. For a removal, "update its entry" means *write the tombstone*.

## Entry format

Each entry in a handle-bearing file follows one shape, so it is predictable to scan and to parse:

```markdown
### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** one to three role-level sentences (describe by the role each part plays, not by file/function names).

**Key facts:**
- mechanism: invariants / protocol shapes · feature: what the user can do · option: name · default · effect · range

**Area:** one role-level pointer to the code this entry documents ("the session-spawn path") — never a raw file path, function, or selector. This is the entry→code anchor the staleness check and verify ritual rely on; **required on every handle entry.**

**Last verified: YYYY-MM-DD**
```

Exact names belong only inside code blocks, commands, or quoted errors — never in the prose of *What it does* / *Area*.

## Freshness — keeping docs from going stale (no scripts)

Staleness is prevented by convention and made visible by dates. There is **no hook or script** — the rule rides the commit only if the author runs it.

- **Trigger lives in `CLAUDE.md`.** *What* triggers an update (the commit-time firing rule) is defined once in `CLAUDE.md` (the auto-loaded *Docs upkeep* bullet) so it fires where an agent actually works. This section describes the *ritual* that satisfies it and the freshness metadata — it does not redefine the trigger.
- **File header.** Every `docs/` file opens with a one-line purpose and a **`Last verified: YYYY-MM-DD`** line (ISO dates — machine-parseable).
- **Per-entry date.** Every handle entry ends with its own **`Last verified: YYYY-MM-DD`** — the per-entry staleness signal.
- **File header vs per-entry date.** The file header records the last *whole-file* reconciliation; each entry's own date is authoritative for that entry and may be newer. The header never overrides a newer per-entry date.
- **Staleness signal.** An entry whose `Last verified` predates a change to the code its **Area** points at is presumed stale → re-verify it. (The required *Area* field is what makes this comparison possible.)
- **Generated docs are exempt from per-entry stamping.** `docs/gui-map.md` + the visual map at `docs/gui-map/map.html` are **generated — do not hand-edit and do not hand-stamp.** The glossary carries a single file-level **`Last generated: YYYY-MM-DD`** instead of per-entry dates. Each entry's identity is anchored to the cockpit's existing structure — an interactive control's fixed label, or a durable element's `id`/`class` resolved through the skill's curated allowlist — **not** to rendered content and **not** to any product-side marker (the cockpit carries zero mapping attributes), so handles stay stable across data/clock/transition changes. **To add a new durable element to the map, add an allowlist entry in the skill (`.claude/skills/gui-map/probe.js`), then re-run `/gui-map`** — identity lives skill-side, never in `public/`; pure data is intentionally not mapped. The visual map is a **self-contained local file** (screenshots inlined as data URIs) — open `docs/gui-map/map.html` directly via `file://`, no server needed. Upkeep after any GUI change is **re-running the `/gui-map` skill** — that, not a date bump, brings it current. `GUI-` handles remain stable and referenceable.
- **Prose / guide files** (`overview.md`, this `README.md`) have **no handles or per-entry dates** — only a file-header `Last verified`. To verify one, re-read it for accuracy against the current system (a guide documents the *system*, not a code area), then re-stamp the header.
- **Verifying a doc.** To "verify `docs/<file>`": read the code area each entry's *Area* names, reconcile the entry against current behavior, fix what drifted, and re-stamp the date. **Re-stamp only after actually reconciling** — never bump a date you didn't verify; a false-fresh date is worse than an honestly stale one.
- **Claude's standing duty.** When working in a code area, Claude checks the matching entry and updates + re-stamps it in the *same commit* — this is the `CLAUDE.md` Docs-upkeep gate, applied. It also flags any entry whose date looks stale relative to what it just changed.

## Decision breadcrumbs

Short, durable "why" notes live in `local-docs.md` under *Decision breadcrumbs*. Each is a **pointer + verdict that links to the authoritative entry** holding the detail — no load-bearing detail of its own, and no date (freshness rides the linked entry). If a breadcrumb states a verdict captured in no entry, move that verdict into an entry (or a TODO).

## Why this is both human- and Claude-readable

- **Human:** overview-first (`local-docs.md` → `docs/overview.md`), prose explanations, links instead of duplication, a short stable front door.
- **Claude:** predictable headings, explicit metadata fields (`Last verified`, `Area`, handles), ISO dates, and handle cross-references — so an agent can locate an area, judge its freshness, and update it mechanically. The same structure serves both audiences, which is what keeps maintenance cheap.
