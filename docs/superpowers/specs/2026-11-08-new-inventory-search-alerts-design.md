# Saved-search alerts (and new inventory support)

**Date:** 2026-11-08
**Status:** Implemented on `feat/search-alerts`
**Builds on:** `2026-10-01-saved-search-new-matches-design.md` (unreleased, ships in 1.2.5)

## Problem

Order wait times are long right now: weeks, sometimes months. Shoppers who have
already ordered keep checking **new** inventory for a car that's close enough
to their order. Usually one thing differs, such as the paint or the wheels.
When one turns up, they phone the store to swap their order onto that car, and
they can often get the one difference for free. Those cars go fast, so what
matters is hearing about one quickly.

The extension can already save a new-inventory search, but it falls short in
three ways:

1. **New-match detection doesn't work on new inventory at all.** Tesla hides
   the VIN on new cars (see Verified facts). Every result is dropped as
   malformed, so a new-inventory search never reports anything new. Reading
   the code also suggests a visible bug: `extractVin` turns the card's hash ID
   into a 17-character fragment that is never in `seen`, so every card would
   get a "New" tag on every visit. That bug is unreproduced.
2. **Nothing notifies.** The 2026-10-01 design left notifications out on
   purpose, because a broad used search would be noisy.
3. **Checks are too slow.** The fastest schedule is every 3 hours. That limit
   is right for the watchlist, which opens one tab per car, but a new
   inventory car can be reserved by someone else within that window.

## Goal

- New-match detection works on new-inventory searches.
- Each saved search gets a **per-search switch** for OS notifications about
  new matches, on by default for new saves.
- Searches with alerts on are checked on their own faster schedule (15 min /
  30 min / 1 hour). The watchlist schedule is unchanged.
- A single-car notification opens that car's order page, the shortest path to
  reserving it or calling the store.

This ships in **1.2.5** together with the new-matches feature. That feature
shouldn't go out broken on new inventory.

## Decisions

- **Per search, on by default for new saves.** A bell on each saved-search row,
  in both the popup and the on-page panel. This was first designed as opt-in
  (off by default) so broad used searches stayed quiet; after review it changed
  to on by default, since shoppers save a search to hear about new matches and
  the bell in the same row turns alerts off in one click. The save confirmation
  says alerts are on. Searches saved before this change stay off.
- **A separate schedule for alerted searches.** It has a new frequency
  setting: every 15 min, 30 min (default) or 1 hour. The setting only appears
  while at least one search has alerts on. The existing watchlist schedule
  still checks every captured search too, and it notifies for alerted ones.
  The floor is 15 minutes: one alert check is one API request per small
  search, about what a shopper does by pressing refresh, and it shouldn't go
  lower than that.
- **One notification per arrival.** A car notifies once, when it first shows
  up. It notifies again only after it has been missing from two complete
  checks in a row and then comes back, as when someone else's reservation
  falls through.
- **Manual "Check" never notifies**, as with the watchlist today. Only alarm
  runs do.
- **No "one option different" matching.** See *Considered and rejected*.
- **No new permissions.** `notifications`, `alarms` and `tabs` are already
  granted.

## Verified facts (2026-11-08, user's real Chrome)

Probed on `/inventory/new/my`, zip 98052, 200 mi, with the extension
installed.

- **New cars carry no VIN.** The API's `VIN` is `"7SAY230_2df0b2b5…9f254b50"`:
  a 4-character WMI+model prefix followed by the car's `Hash`
  (`"230_<32 lowercase hex>"`; also seen: `242_…`). The card's `data-id` is
  `<Hash>-search-result-container`. A card click opens
  `/my/order/7SAY230_<hex>?range=200&titleStatus=new&redirect=no`. No real VIN
  appears in the API, on the card or on the order page.
- The hash was **stable across repeated requests and a cookieless request**
  minutes apart. Stability across days, and after a car moves between
  locations, is unverified (see *Verify before building*).
- **Used cars are unchanged.** They have a real 17-character `VIN`, no `Hash`,
  and a card `data-id` of `<VIN>-search-result-container`.
- **Both conditions have the same option data.** New and used records have
  array fields named like the filter keys (`TRIM`, `PAINT`, `WHEELS`,
  `INTERIOR`, `CABIN_CONFIG`, `ADL_OPTS`). `OptionCodeData` carries readable
  names by `group`:

  | group | example `name` |
  |-------|----------------|
  | `MODEL` | Model Y |
  | `TRIM` | Premium All-Wheel Drive |
  | `PAINT` | Stealth Grey |
  | `WHEELS` | 19’’ Crossflow Wheels |
  | `INTERIOR` | All Black Premium Interior |
  | `REAR_SEATS` | Seven Seat Layout |
  | `TOWING` | Tow Hitch (only when fitted) |

  The card's price is `Price`. New cars have no city or store field.
- **When nothing matches exactly**, `results` is an object
  `{ exact: [], approximate: [], approximateOutside: [] }`, and
  `total_matches_found` is 0. `approximate` is Tesla's loose fallback: at most
  4 cars, and they can differ in both trim and paint. The current parser
  already reads this as zero matches, which is correct.
- **The pool is small.** There were 12 new Model Ys within 200 miles (15 with
  `outsideSearch: true`), 16 new Model 3s and no Cybertrucks. All were
  `IsFactoryGated`; none were in transit.

## Design

### 1. Car identity: `src/vin.ts`, new `src/inventoryCar.ts`

A **car key** is the real VIN when Tesla gives one, and otherwise Tesla's
listing hash. The key is the identity in all search-watch state. The card
only has the hash, so the masked `VIN` can't be the key.

- `LISTING_HASH_RE = /^\d+_[0-9a-f]{32}$/`. This is the one place that knows
  the masked format.
- `carKeyFromDataId(dataId): string | null` in `src/vin.ts` takes the part
  before `-search-result-container`. It returns an uppercased VIN when that
  part matches the VIN regex, the hash when it matches `LISTING_HASH_RE`, and
  null for anything else.
- **`extractVin` becomes strict:** null unless the prefix is a valid VIN. Today
  `"230_2df0…"` comes back as `"230_2DF0B2B503FEC"`. Glow and Track are
  used-only, so nothing visible relies on the loose behavior. A strict version
  means no caller can ever receive a fragment again.
- `src/inventoryCar.ts` (pure, tested) has
  `parseInventoryCar(record): CarSummary | null`:

  ```ts
  type CarSummary = {
    key: string;        // VIN or listing hash
    orderId: string;    // the record's VIN field verbatim (real or masked), for order URLs
    model: string | null;     // OptionCodeData MODEL name, e.g. "Model Y"
    year: number | null;
    trim: string | null;      // TRIM name, falling back to TrimName
    paint: string | null;
    wheels: string | null;
    interior: string | null;
    seats: string | null;     // REAR_SEATS name
    towHitch: boolean;        // a TOWING group entry is present
    price: number | null;     // Price
    currency: string | null;  // CurrencyCode
    odometer: number | null;  // used only
  };
  ```

  The key comes from a valid `VIN`, otherwise from `Hash` matching
  `LISTING_HASH_RE`. The masked case also requires that `VIN` ends with
  `Hash`. `orderId` must match `^[A-Za-z0-9_]{17,48}$`, because it goes into a
  URL. Names are Tesla's own strings, verbatim, so other locales work without
  a translation table.

### 2. Response parsing: `src/searchWatch.ts`

- `parseInventoryResponse` returns `{ total, cars: CarSummary[] }`.
- **A record that doesn't parse fails the whole page** (null, meaning
  "unknown"). Today a format change shows up as "12 matches, 0 cars, nothing
  new" forever, which is exactly how the masked VINs went unnoticed. The
  existing rule, "a format change must read as unknown, never as no matches",
  now applies to each record as well as to the page.
- `collectSearchResults` returns
  `{ total, cars, truncated }`, de-duplicated by key.
- Renames throughout the module: `vins` → `keys`, `renderedVins` →
  `renderedKeys`, `newVins` → `newKeys`, `badgeAckedVins` → `badgeAckedKeys`.
  1.2.5 is unreleased, so these are free.

### 3. State model: arrivals, not "not seen"

Today `newVins` is recomputed from scratch on every check as
`results − seen`, and `seen` only grows through viewing. Nothing tracks
whether a car was already reported. A car that drops out of one check and
comes back would be "new" again and notify again. The model changes to:

```ts
type SearchWatchEntry = {
  request: InventoryRequest;
  capturedAt: number;
  known: Record<string, number> | null; // key → last observed (check or view); null = no baseline
  newKeys: string[];        // arrivals not yet viewed
  badgeAckedKeys: string[];
  total: number | null;
  truncated: boolean;
  lastCheckedAt: number | null;
};
```

- **Check:** `withCheckResult(entry, results, now)` returns
  `{ entry, arrivals }`.
  - Without a baseline, the result becomes the baseline and there are no
    arrivals.
  - `arrivals` is the set of result keys not in `known`. Every result key is
    stamped `known[k] = now`.
  - **Forget rule:** if this check and the previous one were both
    untruncated, drop every known key that is missing now and was last
    observed before the previous check, that is, missing twice in a row. A
    single miss is kept, so a flaky check can't re-announce a car. A
    truncated result never forgets anything, because cars past 120 are
    unobserved, not gone. The 30-day TTL and the 300 cap stay as backstops.
  - `newKeys` becomes `(newKeys ∪ arrivals)`, limited to keys still in
    `known`. A new car that misses one check stays counted until the second
    miss forgets it. `badgeAckedKeys` keeps only keys still in `newKeys`.
- **View:** `withViewed(entry, renderedKeys, now)` adds unviewed `newKeys` and `renderedKeys` to
  `known` and empties `newKeys` and `badgeAckedKeys`. That matches today's
  behavior.
- **Tolerant reads:** add `isSearchWatchEntry`. The worker drops invalid
  entries when it next writes, and readers skip them. Pre-release data in the
  old shape (`seen`/`newVins`) therefore disappears and is rebuilt on the
  next view. That needs no storage version bump, since no released build ever
  wrote that shape.

### 4. Saved search: `alerts` flag (`src/savedSearches.ts`)

- `SavedSearch.alerts?: boolean`. Absent means off, so stored records stay
  valid.
- A pure helper, `setSearchAlerts(searches, id, on)`, returns the same
  reference when nothing changed.
- A search's order-page URL is built from its saved listing URL:
  `orderUrl(search, orderId)` →
  `https://www.tesla.com[/<locale>]/<model>/order/<orderId>?titleStatus=<condition>&redirect=no`.
  `<model>` is the path segment after `/inventory/<condition>/`. The function
  returns null if the URL doesn't parse.

### 5. Schedules: `src/autoCheck.ts`, `src/storage.ts`, background

- New storage item: `searchAlertMinutesItem` (`local:searchAlertMinutes`),
  default 30. `SEARCH_ALERT_OPTIONS = [15, 30, 60]`.
- New alarm: `tih:search-alerts`. `planSearchAlertAlarm(minutes, anyAlerts)` is
  pure. It clears the alarm when no search has alerts on. Otherwise it returns
  `{ periodInMinutes, delayInMinutes: periodInMinutes }`. There is no anchor
  hour, because the phase of a 30-minute cadence doesn't matter. The first
  fire comes after one full period, so changing the setting never starts a
  burst of checks. Out-of-range values clamp to the nearest option.
- `reconcileSearchAlertAlarm` runs on worker start, on `onInstalled`, and when
  `savedSearchesItem` or `searchAlertMinutesItem` changes. Whether the alarm
  should exist depends only on whether some search has `alerts === true`. A
  search with alerts on but no captured request is skipped during the run.
  An existing alarm with the same period is preserved; only a missing alarm
  or a changed period creates a timer, so edits never postpone checks.
- **One runner.** `runCheck({ scope, source })` with `scope: 'all' | 'alerts'`
  and `source: 'manual' | 'alarm'`:
  - `all` is today's run: the watchlist, then every captured search.
  - `alerts` covers only searches with `alerts` on and a captured request. It
    opens no car tabs.
  - If an alarm fires while a run is going: an `all` alarm sets `pendingAll`
    and runs once the current run finishes, so the watchlist check isn't lost
    for a whole period. An `alerts` alarm is dropped, since the next one is at
    most one period away and an `all` run covers alerted searches anyway.

### 6. Check tab: reuse before opening

At 30 minutes, a background tab flashing in the tab strip 48 times a day is
noticeable. Before creating a tab, the run looks for an existing tab that is
already running the content script: a URL matching the content-script
`matches`, `status === 'complete'`, and not discarded. It prefers an inactive
one. It falls back to creating an `active: false` tab, as today, and closes
only tabs it created.

Reusing a tab that may be visible creates an attribution risk. If the
extension's own fetches show up in that page's resource timing, the
`PerformanceObserver` would treat a fetch for search B as "the latest request"
on a page showing search A. The content script therefore records the URLs it
fetches (a bounded set of the last 50) and the observer skips them. This also
makes the existing baseline fetch explicit rather than incidentally harmless.

### 7. Notifications: `src/notify.ts`

`buildSearchAlertNotifications(perSearch)` is pure, tested and separate from
`buildChangeNotification`. It produces one notification for each alerted
search that had arrivals on an alarm run:

- **One car:**
  - id: `tih:match:<searchId>:<orderId>`
  - title: `New match · <search label>`
  - message: `<year> <model> <trim> · <price>`, plus `· <odometer> <mi|km>` for used
    cars (the saved search locale determines the unit)
  - contextMessage: paint · wheels · interior · seats, plus `· Tow Hitch` when
    fitted
  - Click opens `orderUrl(search, orderId)`. If the search is gone or the URL
    doesn't build, it opens the popup window instead.
- **Several cars:**
  - id: `tih:matches:<searchId>`
  - title: `<n> new matches · <search label>`
  - message: up to three one-line summaries (`<trim> · <paint> · <price>`),
    plus `+<n> more`
  - Click opens the saved search through the existing
    `openSavedSearch(id, newTab: true)`, so the sliders are restored.

Example from today's data:

> **New match · New Model Y, Premium AWD**
> 2027 Model Y Premium All-Wheel Drive · $53,490
> Stealth Grey · 19’’ Crossflow Wheels · All Black Premium Interior · Seven Seat Layout · Tow Hitch

The worker builds each notification right after the search phase, from the
arrivals that `withCheckResult` returned and the `CarSummary` values the check
tab sent back. Nothing new is persisted, because a click rebuilds the URL from
the notification id and the saved search. The badge and chips behave as they
do today, and arrivals add to them.

### 8. UI

- **Popup row** (`renderSearchRow`): a bell icon button placed before the
  ✕, with `aria-pressed` and the title "Alert me about new matches" or
  "Alerts on — click to turn off". The aria-label includes the search label.
  The inline SVG bell is outlined when off and filled when on. Turning it
  on flashes: "You'll get a notification when a new car matches — checked
  every <N> min while Chrome is open." The current alert frequency is used,
  with "hour" for 60 minutes.
- **Popup header:** in the Saved searches `monitor-head`, a `<select>`
  with options "Check every 15 min", "Check every 30 min", "Check every hour". It's hidden unless some
  search has alerts on, the same pattern as the time dropdown.
- **On-page panel row:** the same bell in `row-actions`, before rename. The
  panel has no frequency select; it follows the system light/dark palette,
  while the pill stays light. Toggles use a handler supplied by the content
  script, like rename and delete.
- **Colors:** bell-on uses the popup's `--accent`. In the panel it uses a token
  defined in both the light and dark blocks, following the existing palette
  rule. Amber stays out of the popup.
- **"New" tags** use `carKeyFromDataId`, which works for both conditions and
  fixes the "every card is New" bug.

## Considered and rejected: "one option different" matching

The idea: the shopper enters their order configuration, and the extension
alerts on cars that differ from it in at most one option. The API makes this
cheap, because filter keys map 1:1 to record fields. It is still not worth
building now:

- **Volume is low.** There are about 12 new cars per model within 200 miles.
  A relaxed search such as "Model Y Premium AWD" alerts a few times a week.
  Speed is the bottleneck, not precision.
- **Leaving out a filter covers the common case,** and the notification lists
  the full configuration, so the shopper can tell at a glance whether it's
  close enough.
- **It would no longer match what Tesla shows.** The extension would alert on
  cars that Tesla's own listing for the search doesn't show. Chips and "New"
  tags would stop matching the screen, and the UI would need a second concept
  (a target configuration plus a tolerance).
- **Tesla's `approximate` list is no substitute.** It holds at most 4 cars and
  can differ in two options.

Revisit if users in larger markets report too many alerts. The comparison would
be a small pure function over `CarSummary`.

## Verify before building

Each of these can be checked in real Chrome for very little effort:

1. **Hash stability over days.** Re-run the new Model Y query (98052, 200 mi,
   no options, no payment range) on two or three later days and compare
   these keys, recorded on 2026-11-08:

   | key | car |
   |-----|-----|
   | `230_2df0b2b503fecb0921d4a5dc9f254b50` | MY AWD, Stealth Grey, 18″, $41,990 |
   | `230_26e51b4df3542d678243edcce85d8f20` | MY AWD, Pearl White, 18″, $42,990 |
   | `242_c4f76aa44c47686b66b6b198a0c66fb2` | MY AWD, Pearl White, 18″, Tow Hitch, $43,990 |

   If the same car (same configuration and price) reappears under a different
   key, then hashing on the key would re-announce it, and the design has to
   change. If only the numeric prefix changes, key on the hex part alone. A
   car that has simply sold is expected and proves nothing.
2. **Do content-script fetches appear in the page's resource timing?** This
   decides whether the filter in §6 is load-bearing. Keep the filter
   either way.
3. **Reusing a visible tab:** a check run in a tab the shopper is looking at
   has no visible effect on the page.
4. **No browser window open (macOS):** `tabs.create` fails when Chrome runs
   with no windows. Decide whether to skip the run or open an unfocused,
   minimized window, after seeing what the minimized window looks like.
5. **End to end:** turn alerts on for a new-inventory search, then trigger the
   alarm from the worker's DevTools with
   `chrome.alarms.create('tih:search-alerts', { when: Date.now() + 500 })`.
   To force an arrival, first delete one key from that search's `known`.

## Testing

- `tests/vin.test.ts`: `carKeyFromDataId` (VIN, hash, garbage).
  `tests/rules.test.ts`, where `extractVin` is already tested, gains the
  stricter case: a hash prefix returns null.
- `tests/inventoryCar.test.ts` (new): used and masked new records built from
  the shapes above; missing `OptionCodeData`; mismatched `VIN`/`Hash`; an
  unsafe `orderId`.
- `tests/searchWatch.test.ts`:
  - a page with one unparseable record returns null;
  - arrivals vs. known cars;
  - a single miss keeps the key and two misses forget it;
  - a truncated check never forgets;
  - a returning car counts as an arrival again;
  - `newKeys` survives a single miss;
  - tolerant reads drop old-shape entries.
- `tests/savedSearches.test.ts`: `setSearchAlerts` and `orderUrl` (US,
  locale-prefixed, used, new, unparseable).
- `tests/autoCheck.test.ts`: `planSearchAlertAlarm` (no alerts → clear;
  clamping; delay equals the period).
- `tests/notify.test.ts`: one car vs. several; used odometer; Tow Hitch;
  the "+n more" line.
- `tests/popup.test.ts`: the existing token rule covers the bell's colors.
- As before, run orchestration, tab reuse and DOM wiring stay thin and are
  not unit-tested.

## Docs

- `AGENTS.md`:
  - Under "Saved-search new matches": car keys (VIN or listing hash, and why),
    the arrival/forget model, and the own-request filter.
  - A short "Saved-search alerts" section: opt-in, the separate alarm, the
    `pendingAll` rule, tab reuse, and the alarm trigger snippet.
  - The Layout table gains `src/inventoryCar.ts`.
- `docs/chrome-web-store.md`:
  - The `notifications` justification now also covers new matches in saved
    searches the user turned alerts on for.
  - The `storage` text gains the alerts flag and the alert frequency.
  - The `alarms` text gains the second schedule.
  - Fold all of this into the existing 1.2.5 version row.

## Out of scope

- "One option different" matching (see above).
- Cars outside the search radius (Tesla's `outsideSearch`). Shoppers can widen
  the range.
- Price changes on cars already matched. The watchlist covers individual cars.
- Notifications that stay on screen until dismissed (`requireInteraction`).
- Alerts while Chrome is closed. Alarms fire only while the browser runs, and
  the popup's status line says so.
