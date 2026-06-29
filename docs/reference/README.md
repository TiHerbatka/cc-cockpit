# cc-cockpit — Reference (current state)

This is the single source of truth for how cc-cockpit works **right now**: its features, mechanisms, and options/parameters. Read it instead of inferring current behavior from the code or from git history.

## How to use
- **Features** — what you can do: [features.md](./features.md)
- **Mechanisms** — how it works under the hood: [mechanisms.md](./mechanisms.md)
- **Options / Parameters** — what you can tune: [options.md](./options.md)
- **GUI glossary & visual map** — a generated map of the GUI surface, planned under [features-gui-mapping/](../../features-gui-mapping/) (produced by the GUI glossary skill; not yet built)

## Handle scheme
Every entry is keyed by a stable handle: `FEAT-<slug>`, `MECH-<slug>`, `OPT-<slug>`. Handles are immutable and never reused; cross-reference entries by handle.

## Entry format
Each entry is:

```markdown
### MECH-env-scrub — Parent-env scrub at spawn

**What it does:** one to three role-level sentences.

**Key facts:**
- bullet (mechanism: invariants / protocol shapes; option: name · default · effect · range)

**Last verified: YYYY-MM-DD**
```

Optionally one light role-level pointer to the responsible area (e.g. "the session-spawn path") — never a file path, function, or selector.

## Upkeep rule (convention-only)
When you change, add, or remove a feature, mechanism, or option, **update its entry here in the same commit** and **stamp its Last-verified date**. New entries take the next handle in their category. There is no tooling enforcing this — the Last-verified date is the only staleness signal, so it is mandatory on every entry.
