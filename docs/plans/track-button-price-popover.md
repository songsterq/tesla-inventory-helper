# Track button: price delta label + history popover

Status: implemented (Sep 2026). During browser verification the host also gained `outline: none !important`, because Tesla's global `:focus` outline boxed it after every click.

## Context

The on-page Track button (Tesla.com used inventory cards and used order pages) reads "✓ Tracking" once a car is saved, which carries no information. The watchlist already records a deduped price history per car (`SavedCar.history`, baseline never mutated), so the button can show the price change since tracked (e.g. `−$500`) and, on hover, the recent price changes plus a "Stop tracking" action.

Decisions:
- No change yet → keep "✓ Tracking". Sold → "Sold". Otherwise the signed delta.
- Clicking a tracked button **pins** the popover (toggle) instead of untracking. Untracking only via "Stop tracking".
- Popover rows: date · price · delta vs previous entry, newest first, up to 7; the earliest (baseline) row reads "Tracked".

Verified in the browser (Sep 2026): the innermost `article.vehicle-card` is `position:relative; overflow:visible` and nothing up its chain clips, transforms, or clip-paths; same for `.vehicle-summary-container` on order pages. A popover hanging below the button is not clipped on either surface.

**Known stacking hazard:** `.tih-glow` (`entrypoints/content/style.css`) sets `position:relative; z-index:1` on matched cards, making each a stacking context. A popover inside a glowing card cannot paint above a later glowing sibling no matter its own z-index. Fix: while a popover is open, set inline `z-index: 30 !important` on the *card host* and restore on close.

## Approach

Move the Track button into its own closed-shadow-DOM module (like `searchPanel.ts`), driven by a cached cars array plus a `savedCarsItem.watch` in the content script. Delta/history formatting becomes pure, unit-tested helpers in `src/format.ts`, shared with the popup.

### 1. Pure helpers — `src/format.ts` (+ `tests/format.test.ts`)

- `formatSignedDelta(diff: number, currency: string | null): string` → `−$500` / `+$1,000` (U+2212, `priceSymbol`).
- `formatPriceStatus(car: SavedCar): { text; cls: 'down'|'up'|'gone'|'idle' }` — verbatim port of `statusLine` from `entrypoints/popup/main.ts` (move its "not gated on lastChange" comment along). Sold wins; then latest vs baseline with `latest.currency`; then `''` before first check / `No change` after.
- `HISTORY_POPOVER_ROWS = 7` and `priceHistoryRows(car, limit = 7): HistoryRow[]` where `HistoryRow = { at, value, delta, cls: 'down'|'up'|'gone'|'idle'|'base' }`:
  - `timeline = displayableHistory(car.history)`, fallback `[car.baseline]` if empty.
  - Walk newest→oldest over the last `limit` entries; `value = formatHistoryValue(cur)`.
  - `i === 0` → `delta: 'Tracked', cls: 'base'` (only the true first entry; if the baseline is off-window the oldest shown row gets a real delta).
  - `cur.availability === 'unavailable'` → `delta: ''`, `cls: 'gone'`.
  - null price on either side or equal → `delta: ''`, `cls: 'idle'`; else signed delta with `cls` down/up.
- Tests: concrete strings for each branch above, sold-wins, CAD symbol, 10-entry history → 7 rows with newest first and no "Tracked" row, legacy `unknown` entry skipped, all-unknown → baseline fallback, no mutation of `car.history`.

### 2. Popup — `entrypoints/popup/main.ts`

Delete `statusLine`; the price-status line uses `formatPriceStatus(car)`. Drop the now-unused `priceSymbol` import. No CSS/HTML change.

### 3. New module — `entrypoints/content/trackButton.ts` + `trackButton.css` (`?raw`)

Exports:
```ts
type TrackButtonHandlers = { onTrack: () => Promise<void>; onUntrack: (vin: string) => Promise<void> };
mountTrackButton(host, vin, handlers)   // idempotent per host; skips display:contents; sets host position:relative if static
updateTrackButtons(cars: SavedCars)     // replace cache, prune disconnected instances, re-render all
clearTrackButtons()                     // remove roots, timers, pin, restore host z-index (route change)
disposeTrackButtons()                   // clearTrackButtons + abort document listeners (onInvalidated)
```
Module is storage-free (no `savedCarsItem` import), same as `searchPanel.ts`.

Host `div.tih-track-root`: inline `!important` `position:absolute; top:-12px; left:12px; z-index:4; display:block; margin/padding 0; pointer-events:auto`. No `all: initial`/`all: revert`. Shadow contents:
```html
<button class="btn" type="button" aria-haspopup="true" aria-expanded="false"></button>
<div class="popover" hidden><div class="card">
  <div class="pop-header"><span class="pop-price"></span><span class="pop-since"></span></div>
  <ul class="pop-list"></ul>
  <p class="pop-empty" hidden>No price changes yet</p>
  <div class="pop-footer"><button class="stop" type="button">Stop tracking</button></div>
</div></div>
```

State: module-level `cars`, `carsByVin`, `instances: Map<host, Instance>`, `pinnedVin: string | null` (module-level so a Tesla re-render mid-pin re-mounts still pinned), `AbortController` for document listeners. Per instance: `hovered`, `focused`, `leaveTimer`, `renderedCar` (reference check to skip popover rebuilds), `prevHostZIndex`.

Events:
- `root click` → `preventDefault(); stopPropagation()` (covers button and popover; keeps Tesla's button-like card wrapper from navigating). **Do not stop `mousedown` at the root** — the search panel's outside-click closer and ours listen on the document.
- `btn click`: untracked → `handlers.onTrack()`; tracked → toggle `pinnedVin`; on unpin also clear `focused` (a mouse click focuses the button, otherwise the popover could only close via Escape).
- `root mouseenter` → cancel leave timer, `hovered = true`, close other instances' hover (one popover at a time). `mouseleave` → 150 ms timer → `hovered = false`.
- `root focusin/focusout` → `focused` (ignore focusout whose `relatedTarget` is inside root).
- `stop click` → `handlers.onUntrack(vin)`, then reset pin/hover/focus so the popover closes even before the watch fires.
- `popover mousedown` → `stopPropagation()` (as in searchPanel).
- Document (once): Escape → unpin + clear all hover/focus; `mousedown` outside `pinned.root` (via `composedPath()`) → unpin.

Render: `car = carsByVin.get(vin)`; label/class: none → `Track`; `formatPriceStatus` `gone` → `Sold` (`saved gone`), `down`/`up` → delta text (`saved down`/`saved up`), `idle` → `✓ Tracking` (`saved`). `open = !!car && (hovered || focused || pinnedVin === vin)`; `popover.hidden = !open`; `aria-expanded`. On open transition set host inline `z-index:30 !important` (save previous), restore on close. Rebuild popover only when `open && renderedCar !== car`: header `formatHistoryValue(car.latest)` + `Tracked since ${formatHistoryTime(car.savedAt)}`; rows via `priceHistoryRows(car)` using `textContent` only; `pop-empty.hidden = rows.length > 1`.

CSS (`trackButton.css`): light tokens on `:host` mirroring `searchPanel.css` names (`--panel-bg`, `--panel-header-bg`, `--panel-border`, `--panel-text`, `--panel-title`, `--panel-muted`, `--panel-faint`, `--panel-shadow`) plus `--delta-down: #1a7f37`, `--delta-up: #e82127`, `--delta-gone: #6b6f76`, `--stop-fg`, `--stop-hover-bg`; `prefers-color-scheme: dark` swap (`#7ad38a`, `#ff6b70`, …). Every token defined in the light block. `.btn` = today's `.tih-monitor-btn` + `.tih-monitor-card` merged (no `all: revert`; button stays light like the saved-searches pill). `.btn.saved` white/red; `.saved.down` green text; `.saved.gone` grey; `.btn[aria-expanded='true']` subtle ring; `:focus-visible` outline. `.popover { position:absolute; top:100%; left:0; padding-top:6px; width:240px; max-width:calc(100vw - 32px) }` (transparent gap so the pointer doesn't leave crossing it), `.popover[hidden]{display:none}`, `.card` with panel tokens/radius/shadow, header/list/rows (`grid 1fr auto auto`), `.pop-delta.{down,up,gone,base,idle}`, footer with full-width `.stop`.

`entrypoints/content/style.css`: delete the three `.tih-monitor-btn*` rules. Keep glow rules.

### 4. Content script — `entrypoints/content/index.ts`

- `let cars: SavedCars = await savedCarsItem.getValue()` next to the other loads.
- Replace `createMonitorButton` with `trackCar(vin, host, urlFor, mileageText)` — a **verbatim** move of the current track branch (`scrapePriceIn`, `scrapeTrim ?? driveLabel`, `scrapePaintName`, `parseMileage`, `DEBUG` log, `makeSnapshot(..., 'available', ...)`, `addCar(createSavedCar(...))`, fresh `getValue()` before the write) — and `untrackCar(vin)` (`removeCar` on a fresh read, `setValue`). Both set `cars` and call `updateTrackButtons` after writing.
- `attachMonitorButton` → `attachTrackButton(host, vin, urlFor, mileageText)` = `mountTrackButton(host, vin, { onTrack, onUntrack })`; the display:contents / position:relative / idempotency logic moves into the module.
- `clearMonitorUi` → `clearGlows(); clearTrackButtons();`. `ctx.onInvalidated` adds `disposeTrackButtons()`.
- Add `savedCarsItem.watch((next) => { cars = next; updateTrackButtons(next); })` beside the other watches.
- `injectOrderButton` / `injectInventoryButtons` / `apply()` unchanged apart from the rename.

### 5. Source-text tests — `tests/popup.test.ts` (new `describe('track button')`)

- popup: contains `formatPriceStatus(car)`, not `function statusLine`.
- content index: contains `savedCarsItem.watch`, `updateTrackButtons(`, `clearTrackButtons()`, `disposeTrackButtons()`, scrape lines intact (`scrapePaintName(host)`, `makeSnapshot(scraped.value, scraped.currency, 'available'`); not `'✓ Tracking'`, not `tih-monitor-btn`.
- trackButton.ts: contains `attachShadow({ mode: 'closed' })`, `composedPath()`, `'Escape'`, `LEAVE_DELAY_MS = 150`, `priceHistoryRows(`, `formatPriceStatus(`, `Stop tracking`, `setProperty('z-index'`; not `all: initial`, not `savedCarsItem`.
- trackButton.css: `/\.popover\[hidden\]\s*\{[^}]*display:\s*none/`, `prefers-color-scheme: dark`, every `--name:` in the dark block also appears before it (split on `@media`), not `all: revert`.
- style.css: not `.tih-monitor-btn`, still `.tih-glow`.

### 6. AGENTS.md

- Layout table row for `entrypoints/content/trackButton.ts` (+ `.css`, `?raw`).
- New "Track button" section after "Watchlist auto-checks": placement and host rules; closed shadow root, no `all:*`; label states via `formatPriceStatus` (same function as the popup row, latest-vs-baseline, not gated on `lastChange`); popover = last 7 of `displayableHistory` newest-first via `priceHistoryRows`, baseline row "Tracked"; `open = tracked && (hovered || focused || pinned)`, 150 ms leave delay, one open at a time, Escape/outside-mousedown unpin; the `.tih-glow` stacking-context reason for the inline host `z-index: 30`; `click` stopped at the host but `mousedown` must bubble; content script watches `savedCarsItem` and renders from a cached array; scrape logic lives in `trackCar` in `index.ts`, module is storage-free.
- Palette-in-step rule (Third-party popover / Saved searches styling bullets) now names `trackButton.css` too.
- URL-handling bullet: "clear any leftover glow/Track pills" → `clearTrackButtons()`.

## Sequencing

1. `src/format.ts` helpers + unit tests (red → green).
2. Popup swap to `formatPriceStatus`; `npm test`.
3. `trackButton.css` + `trackButton.ts`.
4. `index.ts` rewiring; `style.css` cleanup.
5. Source-text tests; `npm run compile`; `npm test`.
6. AGENTS.md.

## Verification

- `npm ci` if `node_modules` is empty, then `npx vitest run` and `npx tsc --noEmit` clean.
- `npm run dev`, load the unpacked build in real Chrome:
  - Used grid: "Track" on an untracked card → click → popover opens immediately with one "Tracked" row and "No price changes yet"; label "✓ Tracking".
  - Two vertically adjacent glowing cards: open the upper card's popover; it must paint above the lower card.
  - Hover off the button then into the popover: stays open. Leave both: closes after ~150 ms. Click: pins; click outside / Escape: unpins. Tab to the button: opens; Tab away: closes.
  - "Stop tracking" → button reverts to "Track", popover closes.
  - Remove a car from the popup while the page is open → button flips to "Track" without a reload.
  - Popup "Check" run after a price change on a tracked car → label flips to the delta live, popover shows the row.
  - Order page (`/my/order/<VIN>?titleStatus=used`): same behaviours on `.vehicle-summary-container`.
  - Dark system theme: popover uses the dark palette; button stays light.
