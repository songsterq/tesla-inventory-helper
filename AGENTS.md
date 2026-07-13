# Tesla Inventory Helper

Chrome MV3 browser extension that helps Tesla shoppers find HW4 cars. Two surfaces:

1. **Tesla.com (worldwide):** glow-highlights cars whose VIN matches user-defined rules, on inventory and order pages.
2. **Third-party car-listing sites:** detects Tesla VINs on the page and shows a popover with decoded info (model, year, plant, build serial, likely Autopilot HW).

## Stack

WXT (extension framework, wraps Vite), TypeScript, Vitest. Built artifacts land in `.output/chrome-mv3/`.

## Commands

| Task | Command |
|------|---------|
| Dev with auto-reload | `npm run dev` |
| Production build | `npm run build` |
| Release zip | `npx wxt zip` → `.output/tesla-inventory-helper-<version>-chrome.zip` |
| Tests | `npm test` |
| Typecheck | `npm run compile` |
| Regenerate icons | `npm run icons` |
| Process listing screenshots | `node scripts/build-screenshots.mjs` (source PNGs: `~/Desktop/tih/`) |

## Layout

| Concern | Path |
|---------|------|
| VIN decoder (pure functions) | `src/decoder.ts` |
| Rule parser + evaluator | `src/rules.ts` |
| Default seed rules | `src/defaultRules.ts` |
| `chrome.storage.sync` items | `src/storage.ts` |
| Tesla.com content script | `entrypoints/content/` |
| Third-party VIN popover | `entrypoints/thirdparty.content/` |
| Toolbar popup | `entrypoints/popup/` |
| Manifest source | `wxt.config.ts` (WXT generates the real `manifest.json`) |

## Rule engine

Rules are arrays of `{name, conditions}`. Conditions AND-combine within a rule; rules OR-evaluate top-to-bottom (first match wins).

Condition types:
- `chars` — position-anchored slice comparison. Ops: `==`, `!=`, `<`, `<=`, `>`, `>=` (string value) or `in` (string[] value; all entries must be the same length).
- `number` — parses a digit range as an integer. Ops: `==`, `!=`, `<`, `<=`, `>`, `>=`.

`pos` and `from` are 1-indexed to match how people refer to VIN positions.

## Default rules — invariants

- `HW4 (any 2024+)` must keep its `in` check against Tesla WMIs (`5YJ`, `7SA`, `LRW`, `XP7`) so non-Tesla VINs with `pos 10 > P` don't false-match.
- Fremont 2023 HW4 cutoff: serial `>= 789500`. Austin 2023: `>= 131200`. Community-pinned.
- Berlin/Shanghai 2023 transition rules were intentionally removed — no reliable community-pinned threshold. The 2024+ catch-all still covers those plants for newer cars.

## Third-party popover

- Site allowlist lives in **two places that must stay in sync**: `ALLOWLIST_MATCHES` at the top of `entrypoints/thirdparty.content/index.ts`, and `host_permissions` in `wxt.config.ts`.
- VIN detection scans `document.documentElement.outerHTML` (not `innerText`) — sites often keep VINs in attributes or JSON-LD blobs that `innerText` misses.
- Default-open. × hides for the current page-load only (a reload restores it). The popup's "Highlight Matches" toggle is the global off-switch — it controls both surfaces via `highlightingEnabledItem` in storage.
- Renders in a closed shadow DOM with defensive `!important` inline styles on the host wrapper. Avoid `all: initial` on the host — it resets `display` to `inline` and collapses the popover.
- `DEBUG` constant in `entrypoints/thirdparty.content/index.ts` controls `console.debug` output. Must be `false` for release builds.

## Tesla.com URL handling

Supports both US (`/inventory/...`, `/<model>/order/<VIN>`) and locale-prefixed international (`/<locale>/inventory/...`, `/<locale>/my/order/<VIN>`) URLs. The `apply()` router uses regexes (not `startsWith`) to handle both.

## Watchlist auto-checks

The popup watchlist lets users save cars (`savedCarsItem`, `local` storage) and re-checks their price/availability. The frequency dropdown (`autoCheckMinutesItem`) and a time-of-day dropdown (`autoCheckHourItem`, a local-time hour 0–23, shown only when the frequency isn't Off) together drive a `chrome.alarms` schedule; the background worker opens each saved car in a background tab, scrapes it, and diffs against the last snapshot. `planAlarm` (`src/autoCheck.ts`) phase-aligns the alarm to the anchor hour — daily runs once at that hour, sub-daily intervals tile the day from it (e.g. every 6h at 9AM → 9,3,9,3). The delay to the first fire is always in `(0, period]`, so changing the setting or restarting the browser never triggers an immediate check. Two run sources: `'manual'` ("Check now") and `'alarm'` (scheduled). **Only `'alarm'` runs fire `chrome.notifications`** — a price drop or a car going sold. A car that stays sold does not re-notify (`toRunChange` requires a fresh transition).

Sold **used** cars are detected via redirect: their order page bounces to an `/inventory/` listing, which `isSoldRedirect` (`src/vin.ts`) reads as `unavailable`. A non-inventory redirect (login/error) stays `unknown` — never a fabricated `gone`.

**Trigger a scheduled check on demand** (to test notifications without waiting for the alarm): open the background worker's DevTools (`chrome://extensions` → Developer mode → the extension's **service worker** link) and run:

```js
chrome.alarms.create('tih:auto-check', { when: Date.now() + 500 })
```

This runs the exact `onAlarm` path (`runCheck('alarm')`), so notifications are enabled. Gotchas: Chrome clamps short alarm delays to ~30s on packed builds; the run needs a non-empty watchlist and no run already in progress; and a car only notifies if it *changes during that run* (an already-sold car won't re-notify by design).

## Release process

1. Bump `version` in `package.json`. Commit style: `Bump version to X.Y.Z`.
2. Set `DEBUG = false` in `entrypoints/thirdparty.content/index.ts` if currently `true`.
3. `npx vitest run` and `npx tsc --noEmit` — must be clean.
4. `npx wxt zip` — produces the release zip.
5. Upload to Chrome Web Store.
6. Listing screenshots: see `scripts/build-screenshots.mjs`.

## Chrome Web Store listing

Description, single-purpose statement, and permission justifications live in `docs/chrome-web-store.md`. **Do not enumerate the third-party site hostnames in the public description** — a previous version was rejected for keyword spam. Use generic phrasing ("popular car-listing sites"). The internal permission-justification form is fine to list specific hosts since it's reviewer-only.
