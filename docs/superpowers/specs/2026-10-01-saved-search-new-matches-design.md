# New matches for saved searches

**Date:** 2026-10-01
**Status:** Approved (design); implemented on `feat/saved-search-new-matches`

## Problem

Saved searches re-open a filtered listing, but the shopper still has to open each
one to find out whether anything new turned up. The watchlist already checks
tracked cars on a schedule and lights the toolbar badge; saved searches have
nothing equivalent.

## Goal

On the existing auto-check schedule (and on "Check"), find cars that newly match
each saved search, and show it:

- an **"N new"** chip on every saved-search row (popup and on-page panel);
- an **"N new"** chip on the on-page "Saved searches" pill;
- a **"New"** tag on those cars' cards when the search is opened;
- the **toolbar badge**, combined with the watchlist count.

Opening a search marks what it shows as seen.

## Decisions

- **Badge:** one number = watchlist changes + new search matches. **Red** (today's
  `#e82127`) when any watchlist car changed, otherwise **amber** (`#ffbf00`, the
  glow color, with dark text via `action.setBadgeTextColor`). The tooltip
  (`action.setTitle`) splits the two: "2 watchlist changes · 5 new search
  matches".
- **Acknowledgment:** opening the popup clears the badge as it does today, for both
  parts. Row chips stay until that search is actually opened.
- **No notifications** for new matches. The badge and chips cover it, and a broad
  search could be noisy. Watchlist notifications are unchanged.
- **Schedule:** the existing auto-check alarm and "Check" button check both the
  watchlist and the searches. No new setting.
- **"New" means not seen on this device.** All matching state lives in `local`.
  `sync` has no room for it, and VIN lists are device-local by nature.
- **No new permissions.** `https://www.tesla.com/inventory/*` already covers the API.

## Verified facts (2026-10-01)

Probed in the in-app browser, and by the user in real Chrome where noted:

- Listing pages fetch `GET /inventory/api/v4/inventory-results?query=<JSON>`. The
  query carries every filter, **including the three sliders** that the page URL
  can't (`paymentRange: "350,900"`, `Odometer: "2000,97000"`,
  `options.Year: [2020, …]`). A slider query cut 685 matches to 20.
- The response is `{ total_matches_found, results: [{ VIN, … }] }`, about 16 KB per car.
  The server caps `count` at **24** (asking for 200 still returns 24), so paging
  uses `offset`.
- There is no "date listed" field or sort, so "new" has to be a VIN-set diff.
- `range` filters only when the query has `lat`/`lng`/`region`, which the page
  derives from the zip. A zip-only query returned 429 cars nationwide instead of
  39. **So the query can't be rebuilt from the saved URL. We capture Tesla's own
  request instead.**
- Akamai: curl gets 403. **The extension's service worker gets 403** (user,
  real Chrome). **A fetch from the extension's content script on a tesla.com
  inventory page gets 200** (user, real Chrome). So all API calls run in a tesla.com
  tab, never in the worker. We don't spoof headers to get around this.
- Tesla persists slider state across visits outside the URL.

## Design

### 1. Storage — `src/storage.ts`

```ts
export const searchWatchItem = storage.defineItem<SearchWatch>('local:searchWatch', {
  fallback: {},
});
```

`SearchWatch = Record<searchId, SearchWatchEntry>`, with the types in `src/searchWatch.ts`:

```ts
type InventoryQuery = Record<string, unknown>; // Tesla's request JSON, offset/count removed

type SearchWatchEntry = {
  query: InventoryQuery;
  capturedAt: number;
  seen: Record<string, number> | null; // VIN → last observed (ms); null = no baseline yet
  newVins: string[];       // current matches not in `seen`, from the last check
  badgeAckedVins: string[]; // the part of newVins the popup has already acknowledged
  total: number | null;    // total_matches_found at the last check
  truncated: boolean;      // total exceeded the page cap
  lastCheckedAt: number | null;
};
```

**Single writer.** Only the background worker writes `searchWatchItem`, through a
serialized promise chain (the same pattern as `withPendingSearches`). The content
script and popup read it directly and send messages to change it. That rules out
lost updates between a check run and a page view.

Size: `seen` is capped at 300 VINs per search (oldest-observed dropped), about 9 KB.
Twelve searches come to roughly 110 KB, well inside `local`'s 10 MB quota.

### 2. Pure logic — `src/searchWatch.ts` (new, unit-tested)

No `browser`/DOM, like `savedCars.ts`:

- `parseInventoryRequestUrl(url): InventoryQuery | null`: accepts a resource-timing
  URL, parses `query`, and strips `offset`/`count`/`outsideOffset`. Returns null
  for anything else.
- `inventoryPageUrl(query, offset): string`: the relative URL for one page
  (`count: 24`, `outsideSearch: false`).
- `parseInventoryResponse(json): { total: number; vins: string[] } | null`.
  Validates the shape and keeps only well-formed 17-character VINs. Returns null on
  anything unexpected.
- `MAX_PAGES = 5` (120 cars) and `pagesToFetch(total)`.
- `querySlidersMatch(query, page)`: true when the request's
  `paymentRange`/`Odometer`/`Year` equal the page's current slider values. This is
  what attributes a captured request to the right search (§3).
- State transitions, each returning a new entry:
  - `withBaseline(entry, vins, now)`: `seen` = vins, `newVins` = [].
  - `withCheckResult(entry, { total, vins }, now)`: refreshes `seen` timestamps
    for VINs still present, sets `newVins` = current − seen, keeps
    `badgeAckedVins` ∩ newVins, and sets `total`/`truncated`. A null `seen` means
    this result becomes the baseline. Prunes `seen` entries unobserved for 30
    days, then applies the cap.
  - `withViewed(entry, renderedVins, now)`: `seen` ∪= newVins ∪ renderedVins;
    `newVins` = []; `badgeAckedVins` = []. Does nothing to `seen` while the
    baseline is missing.
  - `withBadgeAcked(entry)`: `badgeAckedVins` = newVins.
- `newCount(entry)`, `unackedCount(entry)`.
- `pruneOrphans(watch, searches)`: drops entries whose search was deleted on any
  device.
- `composeBadge(watchlistChanges, searchNew): { text, color, textColor, title }`.

### 3. Content script — capture, baseline, view, tags

All of this is gated on `document.visibilityState === 'visible'`. The hidden
check tab (§4) therefore never captures a query or marks anything seen, even if
its page happens to match a saved search.

- **Capture.** A `PerformanceObserver({ type: 'resource', buffered: true })`
  watches for `inventory-results` entries. An observer keeps receiving entries
  after the timeline's 250-entry buffer fills, which a long SPA session can reach.
  On each entry:
  1. Find the saved search the page currently is (`isCurrentSearch`).
  2. Require `querySlidersMatch` against the live slider values. A late reply
     from before a slider move must not be stored under the new state.
  3. Send `tih:search-viewed { id, query, renderedVins }` once the matching cards
     have rendered.
- **Restores pause viewing.** A slider restore writes one slider at a time, so the
  page passes through intermediate states that can match a different saved search.
  Viewing stops for the duration and resumes once the restore finishes.
- **Latest request by start time.** A slow reply to an older request (filters since
  changed) never replaces a newer request.
- **Baseline.** If the entry has no baseline yet (just saved, or a search saved on
  another device being opened here for the first time), the content script runs
  the paged fetch (§4) itself, then sends `tih:search-baseline { id, query, vins }`.
  Nothing is tagged on that first view.
- **"New" tags.** When a view starts, snapshot that search's `seen`. Every rendered
  card whose VIN isn't in the snapshot gets a "New" tag, including cars loaded by
  infinite scroll. The snapshot lives in memory for the page session, so tags don't
  vanish once the background marks them seen. The tag goes at the card's top-right,
  where it can't collide with the Track pill at top-left. It works on new-inventory
  pages too.
- **Paged fetch** (shared by baseline and the check tab): sequential
  `fetch(inventoryPageUrl(query, offset), { cache: 'no-store' })` calls with a
  15 s timeout each and about 300 ms between pages, stopping at `pagesToFetch(total)`.
  Any failure aborts with "unknown" and never returns a partial VIN set.
- **Message handler** `tih:fetch-search { query }` → `{ ok, total, vins }`, for
  the check tab.

### 4. Background — check run, badge, messages

- **Check run.** `runCheck` keeps its watchlist loop, then runs a search phase for
  every search that has a captured query:
  - Open **one** hidden tab (`active: false`) at the first search's listing
    path, with no query string.
  - Poll `tabs.sendMessage(tabId, { type: 'tih:fetch-search', query })` until the
    content script answers, reusing `pollWithTimeout`.
  - Apply each result through the single-writer chain.
  - Close the tab in `finally`.
  - A failed or unknown result leaves that entry untouched, the same rule the
    watchlist follows so a timeout never fakes a change.
  - `runState.total` counts cars plus checkable searches, so the progress line
    still reads "Checking 7 of 15…".
- **Alarm guard:** run when the watchlist is non-empty **or** any search has a
  captured query. Today the guard only checks for cars.
- **Badge.** `updateBadge()` reads both items through `composeBadge`, and both are
  watched. `setBadgeTextColor` and `setTitle` are best-effort.
- **Messages** (all serialized on the chain):
  - `tih:search-viewed` → `withViewed`, and store the query (newest capture wins).
  - `tih:search-baseline` → store the query, then `withBaseline`.
  - `tih:ack-search-badge` → `withBadgeAcked` on every entry. Sent by the popup.
- **Cleanup:** watch `savedSearchesItem` and run `pruneOrphans`.

### 5. UI

- **Popup:** a "N new" chip on each saved-search row, in the popup's red
  `--accent`. The popup keeps amber out on purpose (`tests/popup.test.ts`). On open, alongside
  the existing `acknowledgeAll`, send `tih:ack-search-badge`. The chips stay.
- **On-page panel:** the same chip on each row, read from `searchWatchItem`, which
  the content script already watches. **Pill:** when any search has new matches, an
  amber "N new" chip sits next to the existing count. The pill stays light, as it
  always is.
- Tokens follow the existing rule: every panel color is defined in both the light
  and dark blocks.

## Verify before building

These are cheap checks in real Chrome. Each one decides part of the design:

1. A `PerformanceObserver` in the content script's isolated world sees the page's
   `inventory-results` entries. If it doesn't, capture has to move to a MAIN-world
   script.
2. Locale pages (en_CA, a European locale) call the same
   `www.tesla.com/inventory/api/v4/inventory-results` path. They wouldn't load
   results in the in-app browser.
3. Content-script fetches from a hidden, never-focused tab also get 200.
4. New-inventory listings use the same endpoint and card markup.

## Testing

- `tests/searchWatch.test.ts`: request-URL parsing (good, bad, offset stripped);
  response parsing (bad shapes → null, malformed VINs dropped); page planning;
  slider matching; every state transition (baseline, a check against a missing
  baseline, new/removed VINs, ack, view, pruning, cap); orphan pruning; badge
  composition (red vs amber, tooltip text, zero → empty).
- The fetch loop, tab orchestration and DOM tagging stay thin and untested, as
  with the watchlist.

## Docs

- `AGENTS.md`: a "Saved-search new matches" section covering why the API must be
  called from a page, the capture and attribution rule, the single writer, and the
  visibility gate.
- `docs/chrome-web-store.md`: the `storage` justification gains
  `local:searchWatch`, and the host-permission text says the content script reads
  Tesla's inventory results for the user's own saved searches. Add a version row.
  No new permissions.

## Out of scope

- Notifications for new matches.
- Syncing seen state across devices.
- Checking searches never opened on this device (they have no captured query).
- Price changes within a search's results; the watchlist covers individual cars.
- Searches with more than 120 matches beyond the first 120 in their sort order.
  The chip counts new cars within those 120.
