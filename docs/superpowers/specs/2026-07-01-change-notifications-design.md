# Change notifications for background price checks

**Date:** 2026-07-01
**Status:** Approved (design)

## Problem

Periodic price checks run in the background via `chrome.alarms` (PR #4). When such
a run detects a change, the only signal today is the toolbar **badge**
(`runCheck`'s `finally` calls `updateBadge`). The badge is easy to miss, and
periodic checks are exactly the case where the user is not looking at the popup.
We want a proactive alert when a background run finds an actionable change.

## Goal

When an **alarm-triggered** `runCheck` detects a qualifying change — a **price
drop** or a car going **gone/sold** — fire a single `chrome.notifications` OS
notification summarizing that run. Keep the badge as the persistent indicator.

## Decisions

- **Channel:** `chrome.notifications` (OS notification) *and* the existing badge.
- **Granularity:** one coalesced notification per run. If exactly one car
  changed, the notification names that car and what changed; if more than one,
  it is a summary (`"N watched cars changed"`).
- **Which changes notify:** **price drop** and **gone** only. Price *rises* never
  notify (they still appear in the badge and popup).
- **What counts as "changed this run":** cars whose diff produced a qualifying
  change *during this run* — driven by the per-run diff, not the running
  `changedCount`. A car therefore does not re-notify on every daily run while it
  sits unacknowledged.
- **Manual runs are silent:** only `source === 'alarm'` runs notify. A "Check
  now" run happens while the user watches the popup, so a notification would be
  redundant.
- **Control:** always on whenever auto-check is on. No separate toggle — the
  auto-check "Off" option is the switch for all background activity.
- **Click behavior (split):**
  - single-car notification → open that car's listing URL in a new tab;
  - multi-car summary → open the watchlist popup page in a small standalone
    window.

## Design

### 1. Manifest

Add `'notifications'` to `permissions` in `wxt.config.ts`. This permission
produces no user-facing permission warning.

### 2. Pure notification builder — `src/notify.ts` (new, unit-tested)

Pure function, no `browser`/DOM dependencies, matching the project convention of
keeping brittle edges (tab orchestration, notification calls) thin and pushing
logic into pure, testable helpers.

```ts
type RunChange = {
  car: SavedCar;
  change: 'price-drop' | 'gone';
  prevPrice: number | null; // this run's previous latest price, for the delta
};

type NotifyTarget = { kind: 'url'; url: string } | { kind: 'popup' };

type ChangeNotification = {
  id: string;
  title: string;
  message: string;
  contextMessage?: string;
  target: NotifyTarget;
};

function buildChangeNotification(changes: RunChange[]): ChangeNotification | null;
```

Behavior:

- **0 changes →** `null` (no notification).
- **1 change →** car-specific:
  - **title** = car name — `[modelYear, model, trim]` joined, falling back to the
    VIN when those are all null.
  - **message** = the change:
    - drop: `"Price dropped $1,400 → $46,990"` (delta uses this run's `prevPrice`
      → new `latest.price`, not the baseline);
    - gone: `"No longer listed"`.
  - **contextMessage** = identifier — `formatCarSubLine(car)`, i.e.
    `"Stealth Grey · 12,000 mi · HW4"`.
  - `id = "tih:car:<vin>"`; `target = { kind: 'url', url: car.url }`.
- **>1 changes →** summary:
  - **title** = `"N watched cars changed"`;
  - **message** = brief list of car names;
  - `id = "tih:summary"`; `target = { kind: 'popup' }`.

Fixed notification ids mean a re-notify **replaces** the prior card for the same
car (or the summary) rather than stacking duplicates.

### 3. Shared formatting — `src/format.ts` (new)

`priceSymbol` / `formatPrice` currently live privately in `popup/main.ts`, and the
`"Color · Mileage · HW"` sub-line is built inline in `renderCarRow`. Extract all
three into a shared module consumed by both `popup/main.ts` and `notify.ts`, so
the popup row and the notification render identically:

- `priceSymbol(currency: string | null): string`
- `formatPrice(snapshot: CarSnapshot): string`
- `formatCarSubLine(car: SavedCar): string` — the `"Color · Mileage · HW"` line
  (paint name, optional `mileage + unit`, HW), joining present parts with `" · "`.

`popup/main.ts` is updated to call these shared helpers instead of its private
copies / inline string building. This is a focused refactor justified by the
second consumer; no unrelated changes.

### 4. Background wiring — `entrypoints/background.ts`

- Thread `source: 'alarm' | 'manual'` through `runCheck`. The `onAlarm` listener
  passes `'alarm'`; the `tih:check-now` message handler passes `'manual'`.
- Inside the per-car loop, when `applyCheckResult` yields `price-drop` or `gone`,
  collect a `RunChange` (`prevPrice = existing.latest.price`, captured before the
  result is applied).
- After the loop, if `source === 'alarm'`, call `buildChangeNotification(changes)`.
  If non-null, `browser.notifications.create(id, { type: 'basic', iconUrl:
  runtime.getURL('icon/128.png'), title, message, contextMessage })`. Best-effort:
  wrapped so a notification failure never breaks the run.
- Add `browser.notifications.onClicked` listener:
  - `"tih:car:<vin>"` → re-read the watchlist, find the car by VIN, open its `url`
    in a new tab; if the car was removed since, fall back to the watchlist window;
  - `"tih:summary"` → open the watchlist window;
  - then `browser.notifications.clear(id)`.
- `openWatchlistWindow()` helper:
  `browser.windows.create({ url: runtime.getURL('popup.html'), type: 'popup',
  width: 420, height: 640 })`. Opening this page runs the popup's `init()`, which
  calls `acknowledgeAll` and clears the badge — the same "seen" semantics as
  opening the toolbar popup.

### 5. Testing

- `tests/notify.test.ts` for `buildChangeNotification`:
  - empty → `null`;
  - single drop: delta and price formatting, `contextMessage` equals the sub-line;
  - single gone: `"No longer listed"`, correct `target` url;
  - multi: summary title/message, `target.kind === 'popup'`;
  - rises-only input (no drop/gone) → `null`;
  - VIN fallback when name fields are null.
- `tests/format.test.ts` for `formatCarSubLine`: all parts present; missing paint;
  missing mileage (omitted); HW-only.
- Background wiring (tab orchestration, `notifications.*` calls) stays thin and
  untested, matching the existing pattern where `browser`-touching code lives at
  the edges.

## Out of scope

- Per-car acknowledgment — the global `acknowledgeAll`-on-open behavior stays.
- A notification on/off toggle — auto-check "Off" is the switch.
- Notification history / grouping beyond the single-vs-summary split.
- Notifying on price rises.
