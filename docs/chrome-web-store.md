# Chrome Web Store listing

Source of truth for everything entered into the Chrome Web Store dashboard. Update here first, then paste into the dashboard.

---

## Description

🔖 Save the Tesla inventory search Tesla won’t keep — and get alerted when a new car matches it.

🚨 New-inventory alerts
Waiting weeks or months on your order? Save a new-inventory search for the car you’d happily take instead, and get a desktop notification when one shows up. Each alert spells out the car’s paint, wheels, interior and seats, and clicking it takes you straight to that car (or to your search, when several arrive at once), so you can call Tesla about swapping your order before someone else claims it. Tip: leave out the option you care least about to widen the net. Searches are checked every 15 minutes, every 30 minutes, or every hour while Chrome is open, and the bell on each search turns its alerts on or off.

💾 Saved searches, used and new
Set up the view you want on Tesla.com — then come back to it later, intact. Search radius, year, mileage, payment: restored. No more rebuilding the same search every session. Each saved search shows how many new cars have matched since you last opened it, and those cars are tagged “New” when you do.

🔔 Watchlist
Save cars you’re serious about. Catch price drops and listings that disappear, so you can act before someone else does. Everything stays in your browser.

✨ HW4 glow + VIN clarity
On Tesla.com, matching cars light up as you scroll inventory and order pages — ready for HW4, tunable anytime, any country.
On supported third-party listings, a small panel shows what the VIN really means: model, year, plant, and likely HW3 vs HW4.

🔒 Private by design
No account, no analytics, no servers, no tracking. Runs locally on Tesla.com and a small set of car-listing sites.

⚖️ Free & independent
Built for serious Tesla shoppers. Independent third-party tool. Not affiliated with, endorsed by, or sponsored by Tesla, Inc. “Tesla” is used only to identify the VINs the extension recognizes.

**Do not enumerate the supported third-party hostnames in this description.** A prior revision was rejected for keyword spam (Violation Yellow Argon, 2026-05-11) after listing all ten sites by name. Keep the public copy generic; users see the actual list at install time anyway.

---

## Single purpose

Help Tesla shoppers find the car they want on Tesla.com inventory — by highlighting cars whose VIN matches the user's rules, by saving and restoring inventory searches (including the slider filters Tesla's own page does not keep in the URL) and flagging cars that newly match them (with optional notifications), by monitoring saved listings for price and availability changes, and by decoding any Tesla VIN encountered on third-party car-listing sites into a small on-page summary (model, year, plant, build number, likely Autopilot hardware).

---

## Permission justifications

The justification form is reviewer-only, so it's safe to list specific hosts here.

### `storage`

The extension stores user-configurable state in `chrome.storage`: the list of VIN-matching rules (which decide what gets highlighted), an on/off toggle for highlighting, the user's saved inventory searches (a Tesla.com listing URL plus the slider filter values the user set, with a short text summary and a per-search alerts flag), and the user's saved-car watchlist (the cars they have chosen to monitor for price and availability changes). The watchlist check schedule and saved-search alert frequency are stored too. All of it lives in `local` storage, on this device only. Also in `local` storage, per saved search: the Tesla.com inventory query that search's page uses, and car keys recording known cars and unviewed arrivals, so the extension can tell which matching cars are new. Used cars are identified by real VIN; new-inventory cars are identified by Tesla’s listing ID (hash) because Tesla does not expose their VIN. Earlier versions kept the rules, the toggle, the check schedule and saved searches in `sync` storage; on update, the extension reads those values once to copy them into `local`, and never writes to `sync`. `session` storage briefly holds which tab is about to re-open a saved search so the page can restore the slider filters once it loads; it is cleared as soon as it is read. No data is uploaded to any third-party server.

### `tabs`

The extension lets the user save specific car listings to a watchlist and check them for price or availability changes. To perform a check, the background service worker opens each saved car's own listing URL in an inactive background tab, reads the current price and availability from that page via a content-script message, and immediately closes the tab. The `tabs` permission is required to open these background tabs (`tabs.create`), message the content script running in them (`tabs.sendMessage`), and close them when the check finishes (`tabs.remove`). Watchlist check tabs open only the saved listing URLs and close as soon as the page has been read.

The same permission also serves the saved-searches feature: when the user re-opens a saved inventory search, the service worker navigates the current tab (`tabs.update`) or opens a new one (`tabs.create`) to that Tesla.com listing URL, and notes the tab id so the content script on that page knows which slider values to restore. During a search check, the service worker prefers an existing complete Tesla.com tab with a running content script, asking it (`tabs.sendMessage`) to look up saved-search results without navigating or changing the page. Otherwise it creates one inactive Tesla.com inventory tab and closes it (`tabs.remove`) when done. Reused tabs stay open. Tab URLs/status are inspected only to find a suitable Tesla.com tab; no browsing history or unrelated page content is read.

### `alarms`

The extension offers an optional automatic re-check of the user's saved-car watchlist and saved searches at a frequency the user chooses from the toolbar popup (Off / every 3, 6, or 12 hours / daily), optionally anchored to a time of day the user also picks (e.g. 9 AM). It uses `chrome.alarms` to schedule one repeating alarm that wakes the background service worker at that interval — with its first fire aligned to the chosen time of day — to run the check. This permission is required because a Manifest V3 service worker is not persistent and cannot rely on `setInterval`/`setTimeout` for scheduled work — `chrome.alarms` is Chrome's supported mechanism for periodic background tasks. The watchlist alarm is cleared when the user selects "Off". A second repeating alarm checks only saved searches the user has turned alerts on for, every 15, 30 (default), or 60 minutes. It exists only while at least one search has alerts on; its timer is preserved across search edits and replaced only when the frequency changes. No alarm data leaves the browser.

### `notifications`

When an automatic (scheduled) watchlist check detects an actionable change — a saved car's price dropping, or the car becoming unavailable/sold — the extension shows a single system notification via `chrome.notifications` so the user is informed without having to open the popup. Notifications also cover newly arriving matches in saved searches the user explicitly turned alerts on for. Each search produces a single-car alert or a grouped alert for several arrivals; the same unread car does not notify on every check. These notifications fire only on scheduled checks; a manual "Check" never produces a notification. Clicking the notification opens the relevant listing (single car) or the watchlist (multiple). Clicking a single-search-match alert opens the car’s order page; a grouped search alert re-opens the saved search with its sliders restored. Notification content is generated entirely locally from data already read during the check and is never transmitted anywhere.

### Host permissions

The extension reads page content on a fixed set of car-shopping sites in order to detect Tesla VINs and either highlight matching cars (on Tesla.com) or show a small VIN-decoder popover (on third-party listing sites). On the third-party sites no network requests are made; the extension only inspects the DOM in the user's own browser. On Tesla.com, the only network requests are to Tesla's own inventory results endpoint, described below.

- **tesla.com/inventory/\*, tesla.com/\*/inventory/\*, tesla.com/\*/order/\***: required to read VINs from Tesla's inventory cards and order pages (US and international locales) and apply the user's highlight rules to matching cars; and, on inventory listing pages, to add the "Saved searches" control, read the current filter sidebar when the user saves a view, and set the Payment/Mileage/Year slider values when the user re-opens one. To show how many cars newly match each saved search, the content script on a Tesla.com inventory page requests that search's results from Tesla's own inventory endpoint (`tesla.com/inventory/api/v4/inventory-results`): the same request the listing page itself makes, using the query the page made when the user last viewed the search. Car keys (real VINs or Tesla listing IDs for new inventory) are kept in local storage; configuration summaries are used during the run to build opted-in match notifications. Nothing is sent anywhere else.
- **autotrader.com, autocheck.com, carfax.com, cargurus.com, cars.com, carvana.com, carmax.com, truecar.com, edmunds.com, kbb.com, findmyelectric.com, onlyusedtesla.com**: required to scan each vehicle detail page for a Tesla VIN. When one is found, the extension displays a popover decoding the VIN's model, year, plant, build number, and likely Autopilot hardware version.

The extension does not request access to any host outside this list.

---

## Listing screenshots

Source PNGs go in `~/Desktop/tih/`. Run `node scripts/build-screenshots.mjs` and choose `-cropped` or `-letterboxed` variants per shot. Chrome Web Store expects 1280×800.

---

## Release history

| Version | Date | Notes |
|---------|------|-------|
| 1.2.5 | (unreleased) | Saved-search new matches: scheduled and manual checks also look up each saved search's results and count unviewed arrivals on used and new inventory using real VINs or Tesla listing IDs; bells in both search lists (on by default for new saves) enable match notifications on a separate 15/30/60-minute schedule (default 30), with a popup frequency selector; re-opening a saved search also restores its search radius, which Tesla doesn't take from the URL; two consecutive complete misses forget a car so a returning listing can alert again; "N new" chips in the popup and on-page panel, "New" tags on cards, and a combined toolbar badge (red for watchlist changes, amber for search news only). No new permissions; `storage`, `tabs`, `alarms`, `notifications` and host-permission text updated (the content script now calls Tesla's inventory results endpoint). All storage moves to `local`: rules, highlight toggle, check schedule and saved searches no longer sync across devices; existing values are copied over once on update |
| 1.2.0 | (unreleased) | Saved searches: save the current inventory view (used and new) and re-open it with the Payment/Mileage/Year sliders restored; on-page panel plus a popup section. No new permissions; `storage` justification now covers `sync:savedSearches` and a transient `session` entry, `tabs` covers navigating/opening the tab for a saved search |
| 1.1.3 | 2026-07-12 | Watchlist auto-checks can be anchored to a time of day (e.g. 9 AM); no new permissions. Popup "Check now" button relabeled "Check" |
| 1.1.2 | 2026-07-01 | Automatic periodic watchlist checks (adds `alarms`) and desktop notifications on scheduled price-drop/sold changes (adds `notifications`); sold used cars detected via order-page redirect to inventory |
| 1.1.0 | 2026-06-29 | Save & monitor watchlist: track saved cars for price/availability changes (adds `tabs` permission); enriched saved-car rows with price, trim, and paint color |
| 1.0.2 | 2026-05-11 | VIN decoder popover on third-party sites, Tesla.com worldwide, `in` operator in rules engine, tightened defaults |
| 1.0.1 | (pre) | Popup layout tightening, rating prompt, screenshot script, highlighting toggle |
