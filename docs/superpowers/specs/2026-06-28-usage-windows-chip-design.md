# 5h / 7d / context usage in the header chip — design

**Status:** built (branch `feat/agent-sdk-rearch`). TODO item C1. Design settled during the C1 brainstorm; this records it.

The header `#usage-chip` today shows only per-turn token totals (from each `result` message's `usage`). This adds the two rolling-window utilizations (5-hour, 7-day) with their reset times, and the context-window fill percent, so a glance at the chip tells you how close you are to a limit.

## Data sources

Both pulled on demand from the session's live `query()` object (the same control surface as `setModel`/`interrupt`):

- **Rolling windows (5h + 7d)** — `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` → `{ rate_limits_available, rate_limits: { five_hour, seven_day, … } }`, each window `{ utilization /*0-100*/, resets_at /*ISO*/ }`. This is the **only** source for the rolling windows (no stable alternative exists), so it is feature-detected + try/caught and degrades to blank on any failure or absence.
- **Context percent** — the stable `getContextUsage()` → `{ totalTokens, maxTokens, percentage, … }`.
- **Per-turn tokens** — unchanged (`result.usage`).

## Flow

1. **Driver** (`server/sdk.js`) gains two async, value-returning wrappers — `getUsage()` and `getContextUsage()` — each guarded `typeof q.<m> === 'function'` and try/caught, resolving to the raw response or `null` (mirrors the defensive style of `interrupt`/`setModel`).
2. **Registry** (`server/sessions.js`) gains a pure `mapUsageWindows(usageResp, ctxResp)` that folds both responses into a compact shape `{ rate: { fiveHour: {pct,resetsAt}|null, sevenDay: {pct,resetsAt}|null, available }, ctx: {pct,used,max}|null }`, tolerating null/missing inputs and `rate_limits_available:false`. A fire-and-forget `_refreshUsage(id)` calls both driver methods in parallel, maps, and emits `meta` with the mapped shape. A per-session `usageInFlight` guard prevents refreshes piling up; all errors are swallowed. It runs on the `system`/`init` message (seed) and on each `result` message (after the existing per-turn `usage` emit). No periodic timer.
3. **Broadcast** — unchanged: the registry's `meta` events are already forwarded to every client as `{type:'meta', id, …}`.
4. **Client** (`public/app.js`, `renderMeta`) keeps a per-focused-session accumulator `{ tok, ctx, fiveHour, sevenDay }`. Because the segments arrive across **separate** `meta` messages, each message updates only the segment it carries (a later `rate`/`ctx` message never blanks the token segment). The whole `#usage-chip` re-renders from the accumulator, e.g. `tok 12k↓ 3k↑ · ctx 18% · 5h 23% · 7d 41%`. Each rolling window is colored by utilization with the existing `.u-green`/`.u-yellow`/`.u-red` (<70 green, 70–90 yellow, ≥90 red) and carries its reset time in a `title` tooltip. Any segment whose data is null/unavailable is omitted. The accumulator resets on a focus change.

## Components / changes

- `server/sdk.js` — `getUsage()` + `getContextUsage()` driver wrappers.
- `server/sessions.js` — exported pure `mapUsageWindows`; `_refreshUsage(id)` + `usageInFlight` guard; triggers on init + result.
- `public/app.js` — usage accumulator, `renderUsageChip()`, `utilClass()`, extended `renderMeta`, reset in `focus()`.
- `public/styles.css` — none (`.usage-chip` + `.u-green`/`.u-yellow`/`.u-red` already exist).
- `server/app.js` — none (meta already broadcast).

## Testing

Unit-test the pure `mapUsageWindows` (both windows present; one/both null; null utilization; `rate_limits_available:false`; ctx present/absent; both inputs null) plus a registry test that `_refreshUsage` emits a mapped meta on `result` and is a no-op for a driver lacking the methods. Live 5h/7d/ctx values can only be confirmed in a running browser session (separate browser-verify step).

## Out of scope

- The per-model weekly windows (`seven_day_opus`/`seven_day_sonnet`/`model_scoped`), extra-usage credits, and the behaviors breakdown from the experimental response.
- A periodic/background refresh timer (refresh is event-driven on init + turn end).
