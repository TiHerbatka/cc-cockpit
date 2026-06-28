# 5h / 7d / context usage chip — implementation plan

**Goal:** Extend the header `#usage-chip` (today: per-turn tokens only) with the 5-hour and 7-day rolling-window utilizations (+ reset times) and the context-window percent. Design: `docs/superpowers/specs/2026-06-28-usage-windows-chip-design.md` (TODO C1).

**Architecture:** The session's live `query()` exposes the figures via two control methods. The driver wraps them defensively; the registry refreshes on session init + each turn end, maps both responses into a compact shape with a pure function, and emits it as a `meta` event (already broadcast). The client accumulates the segments (they arrive in separate metas) and re-renders the chip, coloring each rolling window by utilization. No periodic timer; no server-route change.

**Tech stack:** Plain Node (`server/*.js`), vanilla client JS (`public/app.js`); Node built-in test runner. No bundler, no new deps.

## Global constraints

- The experimental usage method is the only source for 5h/7d, so it MUST be feature-detected + try/caught and degrade to blank — never throw.
- Each `meta` carries only the fields it updates; the client must not let a `rate`/`ctx` meta blank the token segment.
- Reuse the existing `.u-green`/`.u-yellow`/`.u-red` classes (<70 / 70–90 / ≥90). No CSS change expected.
- Do not regress the suite (125 green before; was raised to 132).

---

### Task 1: Driver usage wrappers (`server/sdk.js`)

Add to the returned driver object (next to `setEffort`), each guarded `typeof q.<m> === 'function'`, try/caught, async, resolving to the raw response or `null`:

- `getContextUsage()` → calls `q.getContextUsage()`.
- `getUsage()` → calls `q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`.

### Task 2: Mapper + refresh (`server/sessions.js`)

- Add and export a pure `mapUsageWindows(usageResp, ctxResp)` returning `{ rate: { fiveHour: {pct,resetsAt}|null, sevenDay: {pct,resetsAt}|null, available }, ctx: {pct,used,max}|null }`. A window maps only when it exists and `utilization` is a number; `available = !!rate_limits_available`; `ctx` only when `percentage` is a number. Tolerate null/missing inputs.
- Add a `usageInFlight` flag to the session object.
- Add `_refreshUsage(id)`: bail if exited / in-flight / driver lacks both methods; set the flag; `Promise.all` both calls; on resolve emit `meta` with `mapUsageWindows(...)`; swallow errors; clear the flag in `finally`.
- Trigger `_refreshUsage(id)` from `_onMessage` on the `system`/`init` message and on the `result` message (after the existing per-turn `usage` emit).

### Task 3: Client chip (`public/app.js`)

- Add a per-session accumulator `{ tok, ctx, fiveHour, sevenDay }`, `resetUsageChip()`, `utilClass(pct)`, and `renderUsageChip()` (builds colored spans joined by ` · `, reset time in a `title`, omitting null segments).
- Extend `renderMeta`: `usage` → `tok`; `'ctx' in meta` → `ctx`; `rate` → `fiveHour`/`sevenDay`; re-render if any changed.
- Call `resetUsageChip()` in `focus()` (the focus-switch point).

### Task 4: Tests + verify

- Unit-test `mapUsageWindows` (both present; one/both null; null utilization; `rate_limits_available:false`; ctx present/absent; both null) in `test/sessions.test.js`.
- Add a registry test: `_refreshUsage` emits a mapped meta on `result`; no-op for a driver lacking the methods.
- `npm test` → all green.
- Browser-verify the live 5h/7d/ctx values (manual; not coverable in unit tests).

## After implementation

Leave C1 open until the browser-verify step confirms the live values render and color correctly.
