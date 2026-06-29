# cc-cockpit — Documentation guide

**Purpose:** how this project's documentation is organized and kept from going stale. Read this before adding or editing any doc. There is **no tooling** behind these rules — freshness is convention-enforced (and Claude is expected to enforce it; see *Freshness* below).

**Last verified: 2026-06-29**

## Two tiers

Documentation lives at two levels, with a strict division of labour:

1. **`local-docs.md`** (repo root) — the **entry point**. Orienting, general information plus an **index into `docs/`**. It is the human front door and the first thing to read. It must **not** hold load-bearing detail that belongs in a `docs/` file — it *links* to that file instead. (This is also the file the global "local docs" convention points at.)
2. **`docs/`** — the **detailed, authoritative documentation**: one file per area. This is the **source of truth for current behaviour** — read it rather than inferring behaviour from the code or git history.

The reason for the split: a single front door that stays short and stable (so a human or a fresh Claude session orients in seconds), backed by deep per-area files that change as the code changes.

## The `docs/` files

| File | Covers | Handle prefix |
|---|---|---|
| `docs/README.md` | this guide — conventions & structure | — |
| `docs/overview.md` | architecture & how the pieces fit together | (prose, no handles) |
| `docs/features.md` | user-facing capabilities | `FEAT-` |
| `docs/mechanisms.md` | how it works under the hood | `MECH-` |
| `docs/options.md` | tunables / parameters | `OPT-` |
| `docs/gui-map.md` | the generated GUI glossary + visual map, treated as documentation | `GUI-` |

> **Migration in progress.** `features.md` / `mechanisms.md` / `options.md` currently still live under `docs/reference/` (written during the now-removed superpowers era). Reworking them into the layout above — and folding `docs/reference/README.md` into this guide — is tracked as a top-priority TODO (A9). Until then, treat `docs/reference/` as the live content and this file as the target structure. Wiring the GUI map (`features-gui-mapping/`) in as `docs/gui-map.md`, and relocating its mechanism files into the skill, is TODO A10.

## Handles — stable IDs for cross-reference

Every entry in a handle-bearing file is keyed by an immutable ID: `FEAT-<slug>`, `MECH-<slug>`, `OPT-<slug>`, `GUI-<AREA>-<slug>`.

- **Immutable and never reused.** A removed entry leaves its handle retired; a new entry takes a fresh slug. Renumbering breaks every cross-reference.
- **Cross-reference by handle**, never by file location: write "see `MECH-sdk-driver`", not "see the third section of mechanisms.md". Handles are how both a human and Claude navigate, and how a change in one area is tied to the entries it affects.
- `GUI-` handles are element-level (areas: SIDEBAR, HEADER, CONV, COMPOSE, PANEL, INTERACTION, MODAL, MENU) and complement the capability-level `FEAT-` handles — they say *where an element is and what it's called*, not *what a capability does*.

## Entry format

Each entry in a handle-bearing file follows one shape, so it is predictable to scan and to parse:

```markdown
### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** one to three role-level sentences (describe by the role each part plays, not by file/function names).

**Key facts:**
- mechanism: invariants / protocol shapes · feature: what the user can do · option: name · default · effect · range

**Last verified: YYYY-MM-DD**
```

A file may add one light, role-level pointer to the responsible area ("the session-spawn path") — never a raw file path, function, or selector in the *prose*. (Exact names are fine inside code blocks, commands, or quoted errors.)

## Freshness — keeping docs from going stale (no scripts)

Staleness is prevented by convention, made visible by dates, and enforced at commit time:

- **File header.** Every `docs/` file opens with a one-line purpose and a **`Last verified: YYYY-MM-DD`** line. Use ISO dates (machine-parseable).
- **Per-entry date.** Every handle entry ends with its own **`Last verified: YYYY-MM-DD`** — the one staleness signal.
- **Upkeep rule (the core).** Any commit that changes behaviour **must** update the affected entry/entries **and re-stamp their dates in the *same commit*.** Freshness rides the commit, so docs cannot silently drift from the code if the rule is followed. This is what "automatic tracking" means here — not a script, but a non-optional step bound to every behaviour change.
- **Staleness signal.** An entry whose `Last verified` predates a relevant code change is presumed stale → re-verify it.
- **Verifying a doc.** To "verify `docs/<file>`": read the code area it documents, reconcile each entry against current behaviour, fix what drifted, and re-stamp the dates. You can ask Claude to "verify docs/mechanisms.md" and this is the ritual it follows.
- **Claude's standing duty.** When working in a code area, Claude checks the matching doc entry and updates + re-stamps it in the same commit — and flags any entry whose date looks stale relative to what it just changed.

## Why this is both human- and Claude-readable

- **Human:** overview-first (`local-docs.md` → `docs/overview.md`), prose explanations, links instead of duplication, a short stable front door.
- **Claude:** predictable headings, explicit metadata fields (`Last verified`, handles), ISO dates, and handle cross-references — so an agent can locate an area, judge its freshness, and update it mechanically. The same structure serves both audiences, which is what keeps maintenance cheap.
