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
| Inventory car identity (pure: car key + CarSummary from an inventory-results record) | `src/inventoryCar.ts` |
| VIN decoder (pure functions) | `src/decoder.ts` |
| Rule parser + evaluator | `src/rules.ts` |
| Default seed rules | `src/defaultRules.ts` |
| Saved searches (pure: types, description, caps, restore helpers) | `src/savedSearches.ts` |
| Saved-search new matches (pure: request capture/paging, arrivals state, badge) | `src/searchWatch.ts` |
| `chrome.storage` items (all `local`) | `src/storage.ts` |
| One-time copy out of the old `sync` storage | `src/syncMigration.ts` (plan), `src/storageReady.ts` (wait) |
| Tesla.com content script | `entrypoints/content/` |
| Saved-searches on-page panel | `entrypoints/content/searchPanel.ts` (+ `.css`, imported `?raw`) |
| On-page Track button + price popover | `entrypoints/content/trackButton.ts` (+ `.css`, imported `?raw`) |
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

- `HW4 (any 2024+)` must keep its `in` check against Tesla WMIs (`5YJ`, `7SA`, `LRW`, `XP7`, `7G2`) so non-Tesla VINs with `pos 10 > P` don't false-match. It stays deliberately model-agnostic (no `pos 4` condition) so a new model line is covered the year it ships. `7G2` is the truck WMI (Cybertruck; also the Semi, which never appears in consumer inventory). The Cybercab is registered with NHTSA as a model name but had no public VIN pattern as of Sep 2026 and isn't sold to consumers, so it's deliberately absent. The `in` op requires equal-length entries, so every WMI here is 3 chars.
- The same list lives in `TESLA_WMIS` in `src/decoder.ts` (also inlined in the `findTeslaVins` regex). Keep them in sync: a WMI missing from the decoder makes `decodeTeslaVin` return null, which disables the Track button and the popover for that car even if the rule would glow it.
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
- Cybertruck (`7G2`, `pos 4 == C`) is HW4 across the board: the decoder short-circuits on the model before looking at the year, and the 2024+ rule covers it on Tesla.com. Its `pos 8` letters collide with other lines (`D` is single-motor on a Model Y, dual-motor on a Cybertruck), which is why `DRIVETRAIN_BY_MODEL_AND_POS8` is keyed by model.
- "HW4" in the decoder means the AI4 family, including the AI4.5 / "HW4 Plus" board revisions, which the VIN can't separate. AI5 isn't slated for volume production until mid-2027, so `year >= 2024 → HW4` holds through MY2027. **Revisit when AI5 cars ship** — that year will need the same kind of transition handling 2023 has.

## Model Y L

The six-seat long-wheelbase Model Y (China Aug 2025; US as a **MY2027** from Jul 2026, built at Austin) keeps `pos 4 = Y`. The decoder labels it `Model Y L` from the restraint digit, **`pos 6 == B`**, and only on the Y line (`decodeModel` in `src/decoder.ts`):

- Tesla's Model Y service manual defines `B` as FR, SR*2, TR*2, a 2+2+2 layout. A regular Model Y is `C`/`D` (five-seat) or `A` (seven-seat, 2+3+2).
- Confirmed on delivered US cars in Sep 2026 (`7SAYGBEE*VA…`: MY2027, Austin). NHTSA's vPIC still registers no separate series for it.
- `B` also marks a six-seat Model X, so the check must stay scoped to `pos 4 == Y`.
- The same digit drives the popover's **Seats** row (`MODEL_Y_SEATS_BY_POS6`): `A` = 7 (confirmed on a real "Seven Seat Layout" listing, `7SAYGAEE2PF910143`), `B` = 6, `C`/`D` = 5. It is decoded on the Y line only; every other line, and any undocumented Y code, shows `Unknown` rather than a guess.
- `Model Y L` shares the Model Y drivetrain table and maps to the `my` order slug. It doesn't change the HW verdict or the Tesla.com rules (all `pos 4`-based): every Y L is 2025+, so HW4 by the year rule.

## Storage

Everything persistent is in `chrome.storage.local`: rules, the highlight toggle, the auto-check schedule, saved searches (including the per-search `alerts` flag), the alert frequency (`searchAlertMinutes`), the watchlist, and the saved-search new-match state. Nothing roams between devices, on purpose: one place for all state is simpler to reason about than a split where some of it syncs and the state derived from it doesn't. `session` holds only the transient saved-search restore hand-off.

Until v1.2.5 the rules, toggle, schedule and saved searches lived in `sync`. The background worker copies them into `local` once (`migrateFromSync`, plan in `src/syncMigration.ts`), then sets `local:migratedFromSync`:

- A value already in `local` wins: the user changed it on this device after updating. Saved searches merge by id instead, so a search saved here in the moment before the copy can't hide the synced ones.
- Rules are run through `upgradeRules` on the way and stamped `rules$ = { v: RULES_STORAGE_VERSION }`. The local item's own WXT migrations key off the local `rules$` and would never see the sync copy's version.
- **The sync copy is left in place, never deleted.** Removing it would propagate to the user's other devices, wiping data an older build there still reads and that its own copy step needs after it updates.
- Every worker storage read and message handler waits on `storageReady`. The popup and both content scripts call `whenStorageReady()` before their first read; it asks the worker (`tih:storage-ready`) only while the flag is unset. Without this wait, the popup could show defaults right after an update, and a Save there would overwrite the user's real rules before the copy landed.
- A failed copy leaves the flag unset, so it retries on the next worker start; meanwhile the extension runs on defaults.

## Re-seeding stored rules

`rulesItem` uses `fallback`, and nothing writes on first run — `setValue` fires only on the popup's Save and Reset. So a user who never opened the rules editor has **no stored value** and picks up new defaults automatically on update. Only users who explicitly saved hold a private copy.

To push a corrected default to those users, bump `RULES_STORAGE_VERSION` and add the migration to `RULES_MIGRATIONS` (both in `src/defaultRules.ts`; `rulesItem` and the sync → local copy share them):

- `migrateRulesToV2` / `migrateRulesToV3` in `src/defaultRules.ts` are the template. Each replaces the stored value **only** when it's structurally equal to a frozen snapshot of the previous defaults; customizations and unparseable values pass through untouched. A migration must never be the thing that destroys someone's rules. `@wxt-dev/storage` runs the chain in order, so a v1 copy goes v1→v2→v3 and each step only needs to recognize the snapshot immediately before it.
- Each bump needs its own frozen `V<n>_DEFAULT_RULES` snapshot. These are history — don't edit them to match current rules, and keep their WMI lists inlined so editing `TESLA_WMIS` can't retroactively rewrite what an old version looked like.
- Compare with `rulesEqual` (`src/rules.ts`), not `JSON.stringify`: stored values have been through `parseRules` and the snapshots are hand-written literals, so key order won't match.
- `@wxt-dev/storage` runs migrations inside `defineItem`, at module load in **every** context that imports `src/storage.ts` — not from a single `onInstalled` hook. Concurrent runs are fine (pure transform, idempotent version write), but the call is fire-and-forget, so a throw surfaces only as a `console.error`.
- Berlin/Shanghai 2023 transition rules were intentionally removed — no reliable community-pinned threshold. The 2024+ catch-all still covers those plants for newer cars.

## Third-party popover

- Site allowlist lives in **two places that must stay in sync**: `ALLOWLIST_MATCHES` at the top of `entrypoints/thirdparty.content/index.ts`, and `host_permissions` in `wxt.config.ts`.
- VIN detection scans `document.documentElement.outerHTML` (not `innerText`) — sites often keep VINs in attributes or JSON-LD blobs that `innerText` misses.
- Default-open. × hides for the current page-load only (a reload restores it). The popup's "Highlight Matches" toggle is the global off-switch — it controls both surfaces via `highlightingEnabledItem` in storage.
- Renders in a closed shadow DOM with defensive `!important` inline styles on the host wrapper. Avoid `all: initial` on the host — it resets `display` to `inline` and collapses the popover.
- Colors are tokens on `:host` with a `prefers-color-scheme: dark` swap, mirroring `entrypoints/content/searchPanel.css` and `entrypoints/content/trackButton.css` — keep the three palettes in step, and never give a panel color its only definition inside the dark block. The brand plate behind the glyph is `--brand-plate`, applied via `.brand-icon > rect` (direct child only; the red marks sit in a `<g>`): white in dark, transparent in light, where a white plate would vanish into the header anyway.
- `DEBUG` constant in `entrypoints/thirdparty.content/index.ts` controls `console.debug` output. Must be `false` for release builds.

## Tesla.com URL handling

Supports both US (`/inventory/...`, `/<model>/order/<VIN>`) and locale-prefixed international (`/<locale>/inventory/...`, `/<locale>/my/order/<VIN>`) URLs. The `apply()` router uses regexes (not `startsWith`) to handle both.

Highlight and Track UI run only on **used** inventory (`/inventory/used/...`) and **used** order pages. Order eligibility: `titleStatus=used` → yes; `titleStatus=new` → no; param missing → yes only if the path has a real 17-char VIN (`isUsedInventoryPath` / `isUsedOrderUrl` in `src/vin.ts`). New-inventory/new-order pages clear any leftover glow/Track pills (SPA navigations) via `clearGlows` and `clearTrackButtons`. Manifest matches stay broad so the content script still loads on those URLs.

## Track button

The on-page button on used inventory cards (the innermost `article[data-id]`) and the used order page's `.vehicle-summary-container`. It lives in `entrypoints/content/trackButton.ts`; the track-time scrape (`trackCar`: price, trim, paint, mileage → `createSavedCar`) and `untrackCar` stay in `entrypoints/content/index.ts`, which passes them in as handlers. The module never touches storage.

- **Label**: `Track` when untracked. Tracked, it shows `formatPriceStatus` (`src/format.ts`, the same function as the popup row's second line): the latest-vs-baseline delta (`−$500`, `+$1,000`), `Sold`, or `✓ Tracking` when nothing moved. The delta is deliberately not gated on `lastChange`.
- **Popover**: the last 7 entries of `displayableHistory`, in chronological order with the oldest on top, via `priceHistoryRows` — date, price, and change vs the entry before. Only the true first entry (the baseline) reads `Tracked`; once it scrolls out of the window, the oldest shown row still gets a real delta. A "Stop tracking" footer removes the car.
- **Open state**: `open = tracked && (hovered || focused || pinned)`. Hover has a 150 ms leave delay, and the popover's transparent top padding bridges the gap under the button. Clicking a tracked button toggles the pin (clicking no longer untracks); Escape or a `mousedown` outside (`composedPath`) unpins. Only `:focus-visible` focus counts, so a mouse click can't leave it stuck open. One popover at a time: hovering another button closes the rest. `pinnedVin` is module-level so a pin survives Tesla re-rendering the card.
- **Live updates**: the content script `watch`es `savedCarsItem` and pushes the array into `updateTrackButtons`; buttons render synchronously from that cache, never a per-button `getValue()`. A popup removal or a background check re-labels mounted buttons without a reload.
- **Stacking**: `.tih-glow` gives a matched card `position: relative; z-index: 1`, a stacking context, so a popover inside can't paint over the next glowing card whatever its own z-index. While open, the module sets inline `z-index: 30 !important` on the card host and restores the previous value on close. Verified in the browser (Sep 2026): without it the next card's image covers the popover.
- **Host**: closed shadow root, absolute overlay at `top: -12px; left: 12px` with defensive `!important` inline styles; no `all: initial`. `outline: none` on the host is load-bearing — the host matches `:focus` when its button is focused, and Tesla's global focus outline otherwise draws a grey box after every click. `display: contents` hosts are skipped. Only `click` is stopped at the host (Tesla's card wrapper navigates on click); `mousedown` must keep bubbling for the document-level outside-click closers.
- **Styling**: the button keeps fixed light colors (it sits on Tesla's light cards); the popover uses panel tokens with a dark swap. `tests/popup.test.ts` checks that every dark-block token is also defined in the light block.

## Watchlist auto-checks

The popup watchlist lets users save cars (`savedCarsItem`, `local` storage) and re-checks their price/availability. The frequency dropdown (`autoCheckMinutesItem`) and a time-of-day dropdown (`autoCheckHourItem`, a local-time hour 0–23, shown only when the frequency isn't Off) together drive a `chrome.alarms` schedule; the background worker opens each saved car in a background tab, scrapes it, and diffs against the last snapshot. `planAlarm` (`src/autoCheck.ts`) phase-aligns the alarm to the anchor hour — daily runs once at that hour, sub-daily intervals tile the day from it (e.g. every 6h at 9AM → 9,3,9,3). The delay to the first fire is always in `(0, period]`, so changing the setting or restarting the browser never triggers an immediate check. `reconcileAlarm` (background) re-derives the watchlist alarm (`tih:auto-check`) on worker startup, when either setting changes, and on `runtime.onInstalled` — the last so an upgrade from a pre-anchor build (which has no stored hour, hence the 9AM fallback) replaces its persisted arbitrary-time alarm with a 9AM-anchored one promptly, rather than waiting for an incidental worker wake. Two run sources: `'manual'` ("Check") and `'alarm'` (scheduled). **Only `'alarm'` runs fire `chrome.notifications`** — a price drop or a car going sold. A car that stays sold does not re-notify (`toRunChange` requires a fresh transition). The same run then checks every captured saved search for new matches and notifies for searches with alerts on (see below); this alarm runs when either the watchlist or a captured search has something to check. Alerted searches also have a separate, faster alarm.

Sold **used** cars are detected via redirect: their order page bounces to an `/inventory/` listing, which `isSoldRedirect` (`src/vin.ts`) reads as `unavailable`. A non-inventory redirect (login/error) stays `unknown` — never a fabricated `gone`.

**Trigger a scheduled check on demand** (to test notifications without waiting for the alarm): open the background worker's DevTools (`chrome://extensions` → Developer mode → the extension's **service worker** link) and run:

```js
chrome.alarms.create('tih:auto-check', { when: Date.now() + 500 })
```

This runs the exact `onAlarm` path (`runCheck('alarm')`), so notifications are enabled. Gotchas: Chrome clamps short alarm delays to ~30s on packed builds; the run needs a non-empty watchlist (or a saved search with a captured request) and no run already in progress; and a car only notifies if it *changes during that run* (an already-sold car won't re-notify by design).

## Saved searches

Lets a shopper save the current inventory listing view (used **and** new pages) and re-open it with every filter re-applied, from the on-page "Saved searches" pill or the popup. Exists because of a tesla.com quirk, verified in the browser (Sep 2026):

- Checkbox/radio filters, sort (`arrangeby`), `zip` and `range` live in the URL. The three **sliders** — Payment (`paymentRange`), Mileage (`Odometer`), Year (`Year`) — do not, and Tesla **ignores them if passed as query params**. On load it also rewrites the URL, dropping unknown params and any `#hash`. So a saved search = normalized URL + slider values, and the sliders must be written back into the DOM after the page loads. The URL hash can't carry restore state.
- **Restore hand-off is background-brokered.** `tih:open-search {id, newTab}` → the worker writes `session:pendingSearches[tabId]` and then navigates (`tabs.update` for the on-page panel, `tabs.create` for the popup). The content script asks `tih:pending-search` on boot; the worker returns-and-deletes the entry (120 s TTL, cleared on `tabs.onRemoved`). Reads and writes are serialized on one promise chain so a fast tab can't read ahead of the write. `session` rather than a worker-local Map because the worker can die between `tabs.create` and the page's `document_idle`. **Content scripts must never read `session:` storage** — no `setAccessLevel` is called, so it's background-only. If the current page already *is* the saved URL (`isSameSearchUrl`, which sorts params and drops the hash), the panel applies the sliders in place with no navigation.
- **Sidebar DOM contract** (all selectors centralized in the brittle section of `entrypoints/content/index.ts`): `div.filter-content-wrapper` holds one `div.filter.filter-<KEY>` per group, KEY being the URL param name (`Model`, `TRIM`, `PaymentType`, `paymentRange`, `Odometer`, `Year`, `DemoDrive`, `PAINT`, `WHEELS`, `INTERIOR`, `AUTOPILOT`, `CABIN_CONFIG`, `ADL_OPTS`, `VehicleHistory`); titles in `details > summary`; inputs carry `data-id="<VALUE>-<KEY>-filter"` except Paint/Interior, so labels are read via `label[for=id]`. Sliders: text boxes `input[name="inputMin-<KEY>"]` / `inputMax-<KEY>` (formatted values like `$25,000`), bounds on the two `input.dual-range-slider-input[type=range]` in the same widget. The payment boxes sit inside the `filter-PaymentType` group, not `filter-paymentRange`. New pages lack Odometer/Year/DemoDrive/VehicleHistory and the sort `select[data-id="sort-by-dropdown"]`.
- **The only write path that works**: on the *text* box, the native `HTMLInputElement.prototype.value` setter, then `input`, `change`, `keydown Enter` (bubbling) and `blur` (`writeRangeEnd`). Plain digits are accepted. Dispatching on the range inputs moves the thumbs but never refetches. Writes are verified and retried (`applyRange`): Tesla clamps each end against the other's current value (`planRangeWrites` orders the two writes) and against the data-driven bounds (`clampRange` / `rangeWriteSettled` treat the clamped value as success, so a saved value outside today's bounds can't loop forever). Keys apply sequentially, then one settle pass re-checks after the results load.
- **Storage**: `local:savedSearches`. The description string is computed at save time and only sliders moved off their bounds are stored. `addSearch` caps the list at `MAX_SAVED_SEARCHES = 12`, which also bounds each check run's API calls. Names are optional and empty by default — the description is the label until the user adds one via the pencil (an emptied name clears it); descriptions are never editable. No generated names on purpose: "Used Model Y (2)" carries nothing the description doesn't.
- **Placement**: the pill is injected *inline* into `section.inventory-header-wrapper > div.view-options` (left of the sort dropdown; that div is empty on new pages), not fixed. The section is sticky, so the pill stays visible on scroll without covering anything; Tesla's site header is not sticky and its top-right is the Menu button. Closed shadow DOM, defensive `!important` host styles, no `all: initial` (collapses the panel). Tesla re-renders that row, so `mountSearchPanel` is idempotent and re-run from `apply()`; open/closed state and status text live in module variables and survive a re-mount.
- **Styling**: the pill carries the same amber pulse as a matched car (`tih-pill-pulse` in `searchPanel.css`, a scaled-down copy of `tih-pulse` in `entrypoints/content/style.css` — keep the two in step), and stays light regardless of system theme because it sits in Tesla's always-light toolbar. The dropdown panel is the opposite: light by default with a `prefers-color-scheme: dark` token swap on `:host`, so every panel color must come from a var defined in both blocks.
- Popup rows open via the worker with `newTab: true`; the anchor keeps a real `href`, so a middle-click loads the bare URL without the sliders — accepted.

## Saved-search new matches

Each saved search shows unviewed arrivals: "N new" chips in the popup and on-page panel, an amber "N new" on the pill, a "New" tag on cards when the search is opened, and the toolbar badge. Design specs: `docs/superpowers/specs/2026-10-01-saved-search-new-matches-design.md` and `docs/superpowers/specs/2026-11-08-new-inventory-search-alerts-design.md`.

- **Car keys**: a real VIN, or Tesla's listing hash `<digits>_<32 hex>` on new inventory. Verified Nov 2026: new cars carry no real VIN in the API, card, or order page. The API's `VIN` is a 4-character WMI+model prefix + `Hash`, the card's `data-id` is `<Hash>-search-result-container`, and the order page is `/my/order/<VIN field>`. `parseInventoryCar` returns the key plus `CarSummary`; `carKeyFromDataId` reads either identity from cards. Glow and Track still require real VINs and used inventory.
- **Data source**: listing pages load `GET /inventory/api/v4/inventory-results?query=<JSON>`, carrying every filter, **including sliders**, plus `lat`/`lng`/`region` geocoded from the zip (`range` is ignored without them). A search's query **cannot be rebuilt from its saved URL**. The content script captures Tesla's own request with a resource-timing `PerformanceObserver`, ignoring `outsideSearch: true`. It also ignores URLs in its own bounded set of the last 50 fetch URLs, so baseline/check requests cannot be attributed to the visible search. The server caps `count` at 24; `collectSearchResults` pages up to 120 cars and deduplicates by key. Any failed/malformed page **or any unparseable record** fails the entire collection as unknown, never as zero matches. Zero exact matches can be `results: {}` or empty `exact` with approximate results, with `total_matches_found: 0`; approximate cars are ignored.
- **The API 403s the service worker** (Akamai; curl too), so requests run in a tesla.com content script: the viewed page for a baseline, or a reused/created check tab driven with `tih:fetch-search` (see alerts below).
- **State** (`local:searchWatch`, keyed by search id): captured request, `known` (car key → last observed; `null` until baseline), `newKeys` (unviewed arrivals), `badgeAckedKeys`, total, truncation and last-check time. Checks return arrivals absent from `known`, stamp all observed keys, and union arrivals into `newKeys`. Two consecutive complete checks missing a key forget it; one miss retains it. Truncated checks never forget by absence and interrupt the two-miss sequence. The 30-day TTL and 300-key cap remain backstops. A forgotten car that returns is an arrival again. Without a baseline, a successful collection establishes one without arrivals (even if truncated). A search needs a captured request from being saved/opened here before checks can run. Tolerant readers skip invalid entries, including old pre-release `seen`/`newVins` state; the worker drops them on its next write.
- **Single writer**: only the background worker writes `searchWatchItem`, serialized through `updateSearchWatch`. Content sends `tih:search-viewed` / `tih:search-baseline`; the popup sends `tih:ack-search-badge`. No-op transitions keep the same reference to skip writes.
- **Viewing**: only while the tab is **visible**, the page `isCurrentSearch`, request sliders match live boxes (`requestSlidersMatch`), and no restore is in progress. The latest request is chosen by `startTime`, not completion order. Viewing marks unviewed arrivals and rendered keys known, then clears `newKeys` and `badgeAckedKeys`. Hidden tabs never view anything. First view takes a full baseline so existing matches aren't new.
- **"New" tags**: keys absent from `known` at view start, plus unviewed `newKeys`, remain tagged for that page session even after being marked viewed. This includes arrivals since the last check. `.tih-new::after` sits top-center; Track owns top-left and the glow label top-right.
- **Badge**: watchlist changes + unacknowledged new matches (`composeBadge`), red for any watchlist change, otherwise amber with dark text. `action.setTitle` splits the counts. Opening the popup acknowledges both; chips stay until the search is viewed. Notifications are separately opt-in below.
- **Colors**: amber on tesla.com (`--new-bg`/`--new-fg` in both palettes). Popup chips use red `--accent`; amber stays out of the popup.

## Saved-search alerts

- **Opt-in per search**, off by default (`alerts?: boolean`). Popup and on-page rows have outline/filled SVG bells with `aria-pressed`. The popup alone shows alert frequency while `anySearchAlerts` is true; turning a bell on explains the current cadence and that Chrome must be open. Panel toggles use handlers from the content script, like rename/delete, and render from the current list after re-mounts.
- **Separate alarm**: `tih:search-alerts`, every 15/30/60 minutes (`searchAlertMinutesItem`, default 30). It exists only while some search has alerts on, even if its request hasn't been captured yet. Reconciliation preserves an existing alarm with the same period; it creates a missing alarm or replaces one only when the period changes, so search edits don't postpone checks. A new period first fires after one full interval. The watchlist schedule still checks every captured search too.
- **Single runner**: `runCheck({ scope: 'all' | 'alerts', source: 'manual' | 'alarm' })`. `all` checks the watchlist then every captured search; `alerts` checks only alerted searches with captured requests and opens no car tabs. An `all` alarm during a run sets `pendingAll` for one follow-up run; an alerts alarm during a run is dropped. Manual Check never notifies. Alarm runs notify only for arrivals in searches whose alerts are on, alongside watchlist price-drop/sold notifications.
- **Tab reuse**: prefer an existing complete, non-discarded tesla.com tab matching content-script URLs (inactive first), probing `tih:search-ready` for a live script. Otherwise create one inactive check tab. Never navigate or close a reused tab; close only tabs the run created. The observer's own-request filter prevents these fetches from changing the visible page's captured search.
- **Notification clicks**: `tih:match:<searchId>:<orderId>` opens that car's order page, built from the saved search's locale/model/condition; `tih:matches:<searchId>` opens the saved search with sliders restored. Missing searches/invalid targets fall back to the popup. Single-car alerts include configuration details; multiple arrivals are grouped per search. Unread cars do not repeatedly notify.

**Trigger an alert check on demand**: open the extension service worker's DevTools from `chrome://extensions` and run:

```js
chrome.alarms.create('tih:search-alerts', { when: Date.now() + 500 })
```

Chrome may clamp short delays to ~30s on packed builds. This needs a search with alerts on and a captured request, and no run already in progress (an alerts alarm during a run is dropped). A car only notifies if it **arrives during that run**; to force an arrival, first remove one key from that search's `known` in `chrome.storage.local` (`searchWatch`). The first baseline never notifies. Alarms run only while Chrome is open.

## Release process

1. Bump `version` in `package.json`. Commit style: `Bump version to X.Y.Z`.
2. Set `DEBUG = false` in `entrypoints/thirdparty.content/index.ts` if currently `true`.
3. `npx vitest run` and `npx tsc --noEmit` — must be clean.
4. `npx wxt zip` — produces the release zip.
5. Upload to Chrome Web Store.
6. Listing screenshots: see `scripts/build-screenshots.mjs`.

## Chrome Web Store listing

Description, single-purpose statement, and permission justifications live in `docs/chrome-web-store.md`. **Do not enumerate the third-party site hostnames in the public description** — a previous version was rejected for keyword spam. Use generic phrasing ("popular car-listing sites"). The internal permission-justification form is fine to list specific hosts since it's reviewer-only.
