# Price-history panel — design

## Goal

Under each car in the popup watchlist, add a collapsible panel that shows the
car's price history as a chronological timeline. Example:

```
Jul 10, 9:34 AM   $40,000     ← time tracking started (baseline)
Jul 11, 9:00 AM   $39,500     ← auto-check that recorded a change
Jul 12, 9:00 AM   $39,000
Jul 13, 9:00 AM   Sold
```

A check that records no change adds no line (already true — history dedups
unchanged observations).

## Background

The data already exists. `SavedCar.history` (`src/savedCars.ts`) is a bounded
ring of `CarSnapshot` values (`{price, currency, availability, at}`), oldest
first, newest last. The first entry is the save-time baseline; each later entry
is a distinct observation recorded by a check. `appendHistory` already skips
observations whose price and availability both match the previous entry, so
unchanged checks never grow the timeline.

This is therefore almost entirely a popup **rendering** feature, plus one small
data-layer correctness fix.

## Decisions (confirmed)

1. **Open/close affordance:** a chevron disclosure button (`▸` → `▾`) on the
   row. The title link and remove `✕` keep their own behavior.
2. **When shown:** only when `history.length >= 2` (at least one recorded change
   beyond the baseline). A car still at its starting price shows no toggle and no
   panel — its row is unchanged from today.
3. **`unknown` observations:** never stored in history. Fixed at the data layer,
   not just hidden at render, so the timeline stays pure price/Sold events on
   every surface and unknowns don't consume slots in the 20-entry ring.

## Changes

### 1. Data layer — `src/savedCars.ts`

`appendHistory` gains one guard at the top: if
`snapshot.availability === 'unknown'`, return `history` unchanged. A failed
scrape is a measurement gap, not a price data point.

`applyCheckResult` is otherwise untouched: it still sets `latest = snapshot` and
`lastCheckedAt` even for an unknown result. That means a flaky check still blanks
the row's *current* price to `—` exactly as it does today. That behavior is
pre-existing and out of scope for this feature.

### 2. Format layer — `src/format.ts`

Two pure, unit-testable helpers so the popup stays declarative:

- `formatHistoryValue(snapshot: CarSnapshot): string`
  - `unavailable` → `"Sold"`
  - otherwise → `formatPrice(snapshot)` (e.g. `"$39,000"`; `"—"` if price null)
- `formatHistoryTime(at: number): string`
  - `Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit' })` → e.g. `"Jul 10, 9:34 AM"`, localized.

### 3. Popup — `entrypoints/popup/main.ts`

Restructure each watchlist item from a flat flex row into a column:

```
li.saved-car
  ├─ div.saved-car-row              existing content: [toggle?] info price ✕
  │    └─ button.saved-car-toggle   leading chevron, rendered only when history.length >= 2
  └─ ul.saved-car-history           hidden until expanded; one <li> per snapshot, oldest→newest
```

- The toggle is a real `<button>` disclosure control:
  `aria-expanded`, `aria-controls` pointing at the panel's `id`, and an
  `aria-label` like `"Show price history for <name>"`. Clicking flips
  `aria-expanded`, toggles a class that reveals the panel, and rotates the
  chevron `▸ → ▾`.
- Cars with `history.length < 2`: no toggle element, no panel — row identical to
  today.
- Each history `<li>` is a `.saved-car-history-line`: `formatHistoryTime(s.at)`
  on the left, `formatHistoryValue(s)` on the right. Rendered in stored order
  (oldest first), so newest sits at the bottom, matching the example.
- Panel `id` must be unique per row (e.g. derived from `car.vin`) so
  `aria-controls` is valid.

### 4. CSS — `entrypoints/popup/style.css`

- `.saved-car` → `flex-direction: column` (keep padding, radius, background).
- New `.saved-car-row` holds the existing flex layout
  (`display: flex; align-items: center; gap: 8px`).
- `.saved-car-toggle`: transparent, muted, small chevron button; rotation via a
  transform on the expanded state.
- `.saved-car-history`: list reset, small top spacing, `font-size: 11px`,
  muted; hidden by default, shown when expanded.
- `.saved-car-history-line`: `display: flex; justify-content: space-between`.
- **No `border-top: 1px solid var(--border)`** anywhere — the existing popup CSS
  test allows exactly one such divider (the footer). Separate the panel with
  spacing/muted color instead.

### 5. Tests

- `tests/savedCars.test.ts`: applying an `unknown` check adds no history entry,
  while a real price change still appends one.
- `tests/format.test.ts`: `formatHistoryValue` returns the formatted price for an
  `available` snapshot and `"Sold"` for an `unavailable` one. Keep the date
  assertion non-brittle (pin `TZ`, or assert structure rather than an exact
  localized string).

## Out of scope

Per-line deltas/arrows, sparklines or charts, and clearing/exporting history.
The panel is a plain chronological timeline as specified.
