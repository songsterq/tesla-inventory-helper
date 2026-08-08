# Tesla Inventory Helper

Chrome MV3 browser extension that helps Tesla shoppers find HW4 cars. Two surfaces:

1. **Tesla.com (worldwide):** glow-highlights cars whose VIN matches user-defined rules, on **used** inventory and used order pages.
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

- `HW4 (any 2024+)` must keep its `in` check against Tesla WMIs (`5YJ`, `7SA`, `LRW`, `XP7`) so non-Tesla VINs with `pos 10 > P` don't false-match. It stays deliberately model-agnostic (no `pos 4` condition) so a new model line is covered the year it ships.
- 2023 is the transition year and needs a serial cutoff. **Tesla numbers each model line separately, so these numbers are not comparable to each other** — a Model X serial and a Model Y serial from the same plant and week are nowhere near each other. Community-pinned:

  | Model | Plant | Cutoff | Community range |
  |-------|-------|--------|-----------------|
  | Y | Fremont | `>= 789500` | ~790000–800000 (late May 2023) |
  | Y | Austin | `>= 131200` | ~127000–131000 (late May 2023) |
  | S | Fremont | `>= 510000` | ~501000–502000 (Jan 2023) |
  | X | Fremont | `>= 385000` | ~370000–380000 (mid-Jan 2023) |

  S and X switched over in early 2023, when those lines were still in the 3xx–5xx,xxx range; the Y line didn't switch until that May, by which point it had run past 789xxx. Each cutoff sits at or just above the top of its reported range: transitions were gradual, so erring high trades a few missed HW4 cars for not glowing an HW3 car as a match. **Every 2023 rule is scoped with a `pos 4` model check** — a cutoff from one line is meaningless on another.
- **Model 3 is HW4 only from 2024**, and has no 2023 rule at all. There's no community-pinned 2023 serial for the 3 line: most 2023 Model 3s are pre-Highland HW3, and while Highland (from ~late 2023) shipped HW4, the changeover doesn't map cleanly onto a serial. `789500` is a **Model Y** number and must never be applied to the 3 line — an earlier version of these rules left the Fremont rule unscoped, which silently did exactly that. The known cost is that a 2023 Highland Model 3 won't glow; that's the deliberate trade, since the alternative false-positives every pre-Highland 2023 Model 3 above the cutoff.
- The rules mirror that table one-for-one: `HW4 Model Y Fremont 2023`, `HW4 Model Y Austin 2023`, `HW4 Model S Fremont 2023`, `HW4 Model X Fremont 2023`. Names carry the model because they show on the Track/highlight badge.
- The same thresholds live in `HW4_SERIAL_2023` in `src/decoder.ts`, which drives the third-party popover's HW guess, and the gaps in that table are load-bearing: a missing entry (Model 3 anywhere, anything at Berlin/Shanghai) yields `Unknown` rather than a guess. **Keep it in sync with the rules** — otherwise the same VIN can glow as a match on Tesla.com while the popover calls it HW3.

## Re-seeding stored rules

`rulesItem` uses `fallback`, and nothing writes on first run — `setValue` fires only on the popup's Save and Reset. So a user who never opened the rules editor has **no stored value** and picks up new defaults automatically on update. Only users who explicitly saved hold a private copy.

To push a corrected default to those users, bump `version` on `rulesItem` and add a migration:

- `migrateRulesToV2` in `src/defaultRules.ts` is the template. It replaces the stored value **only** when it's structurally equal to a frozen snapshot of the previous defaults; customizations and unparseable values pass through untouched. A migration must never be the thing that destroys someone's rules.
- Each bump needs its own frozen `V<n>_DEFAULT_RULES` snapshot. These are history — don't edit them to match current rules, and keep their WMI lists inlined so editing `TESLA_WMIS` can't retroactively rewrite what an old version looked like.
- Compare with `rulesEqual` (`src/rules.ts`), not `JSON.stringify`: stored values have been through `parseRules` and the snapshots are hand-written literals, so key order won't match.
- `@wxt-dev/storage` runs migrations inside `defineItem`, at module load in **every** context that imports `src/storage.ts` — not from a single `onInstalled` hook. Concurrent runs are fine (pure transform, idempotent version write), but the call is fire-and-forget, so a throw surfaces only as a `console.error`.
- Berlin/Shanghai 2023 transition rules were intentionally removed — no reliable community-pinned threshold. The 2024+ catch-all still covers those plants for newer cars.

## Third-party popover

- Site allowlist lives in **two places that must stay in sync**: `ALLOWLIST_MATCHES` at the top of `entrypoints/thirdparty.content/index.ts`, and `host_permissions` in `wxt.config.ts`.
- VIN detection scans `document.documentElement.outerHTML` (not `innerText`) — sites often keep VINs in attributes or JSON-LD blobs that `innerText` misses.
- Default-open. × hides for the current page-load only (a reload restores it). The popup's "Highlight Matches" toggle is the global off-switch — it controls both surfaces via `highlightingEnabledItem` in storage.
- Renders in a closed shadow DOM with defensive `!important` inline styles on the host wrapper. Avoid `all: initial` on the host — it resets `display` to `inline` and collapses the popover.
- `DEBUG` constant in `entrypoints/thirdparty.content/index.ts` controls `console.debug` output. Must be `false` for release builds.

## Tesla.com URL handling

Supports both US (`/inventory/...`, `/<model>/order/<VIN>`) and locale-prefixed international (`/<locale>/inventory/...`, `/<locale>/my/order/<VIN>`) URLs. The `apply()` router uses regexes (not `startsWith`) to handle both.

Highlight and Track UI run only on **used** inventory (`/inventory/used/...`) and **used** order pages. Order eligibility: `titleStatus=used` → yes; `titleStatus=new` → no; param missing → yes only if the path has a real 17-char VIN (`isUsedInventoryPath` / `isUsedOrderUrl` in `src/vin.ts`). New-inventory/new-order pages clear any leftover glow/Track pills (SPA navigations). Manifest matches stay broad so the content script still loads on those URLs.

## Watchlist auto-checks

The popup watchlist lets users save cars (`savedCarsItem`, `local` storage) and re-checks their price/availability. The frequency dropdown (`autoCheckMinutesItem`) and a time-of-day dropdown (`autoCheckHourItem`, a local-time hour 0–23, shown only when the frequency isn't Off) together drive a `chrome.alarms` schedule; the background worker opens each saved car in a background tab, scrapes it, and diffs against the last snapshot. `planAlarm` (`src/autoCheck.ts`) phase-aligns the alarm to the anchor hour — daily runs once at that hour, sub-daily intervals tile the day from it (e.g. every 6h at 9AM → 9,3,9,3). The delay to the first fire is always in `(0, period]`, so changing the setting or restarting the browser never triggers an immediate check. `reconcileAlarm` (background) re-derives the single alarm on worker startup, when either setting changes, and on `runtime.onInstalled` — the last so an upgrade from a pre-anchor build (which has no stored hour, hence the 9AM fallback) replaces its persisted arbitrary-time alarm with a 9AM-anchored one promptly, rather than waiting for an incidental worker wake. Two run sources: `'manual'` ("Check") and `'alarm'` (scheduled). **Only `'alarm'` runs fire `chrome.notifications`** — a price drop or a car going sold. A car that stays sold does not re-notify (`toRunChange` requires a fresh transition).

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
