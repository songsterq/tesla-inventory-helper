# Chrome Web Store listing

Source of truth for everything entered into the Chrome Web Store dashboard. Update here first, then paste into the dashboard.

---

## Description

> 🔋 Find the HW4 Tesla you actually want, faster.
>
> A wave of pre-owned Teslas is entering the used market as 2023 leases come back through 2026. If you're shopping specifically for a Hardware 4 car — the only path to future Full Self-Driving upgrades — there's a problem: HW4 isn't labeled anywhere. You have to read the VIN. On every listing. Manually.
>
> Tesla Inventory Helper does the reading for you, wherever you shop.
>
> ✨ On Tesla.com
>
> A soft amber glow lights up the cars that match what you're looking for as you scroll, so the right listings find you instead of the other way around. Works on Tesla's used inventory and order pages, in any country. Comes pre-configured to flag HW4 cars, and you can tune it from the toolbar popup any time.
>
> 🚗 On popular third-party car-listing sites
>
> When you land on a Tesla listing on a supported third-party site, a small dark panel appears in the top-right corner showing what the VIN actually means:
>
> What it is — Model S, 3, X, or Y
> What year it really is — verified against the VIN, not just what the seller wrote
> Where it was built
> Roughly where it sits in the production run
> Whether it's likely HW3 or HW4
>
> No more wondering whether a "2024 Model Y" is really a 2024, or whether a used listing is the HW4 you've been hunting.
>
> 🔔 Save a watchlist and catch changes
>
> Found a car worth keeping an eye on? Save it to your watchlist and let the extension check back for you. With one click it revisits each saved listing and tells you what moved — price drops and whether the car is still available — so you can act before someone else does. Everything happens locally in your own browser, on the listings you chose; nothing is shared.
>
> 🔒 Private by design
>
> Everything runs locally in your browser. No analytics, no servers, no tracking. The extension only reads pages on Tesla.com and a small set of car-listing sites — Chrome will show you the exact list when you install.
>
> ⚠️ Disclaimer
>
> Independent third-party tool. Not affiliated with, endorsed by, or sponsored by Tesla, Inc. "Tesla" is used only to identify the VINs the extension recognizes.

**Do not enumerate the supported third-party hostnames in this description.** A prior revision was rejected for keyword spam (Violation Yellow Argon, 2026-05-11) after listing all ten sites by name. Keep the public copy generic; users see the actual list at install time anyway.

---

## Single purpose

> Help Tesla shoppers identify the characteristics of a Tesla car from its VIN — by highlighting matching cars on Tesla.com inventory and order pages, and by decoding any Tesla VIN encountered on third-party car-listing sites into a small on-page summary (model, year, plant, build number, likely Autopilot hardware).

---

## Permission justifications

The justification form is reviewer-only, so it's safe to list specific hosts here.

### `storage`

> The extension stores user-configurable state in `chrome.storage.sync`: the list of VIN-matching rules (which decide what gets highlighted), an on/off toggle for highlighting, and the user's saved-car watchlist (the cars they have chosen to monitor for price and availability changes). Sync storage is used so the user's rules and watchlist follow their Chrome profile across devices. No data is uploaded to any third-party server.

### `tabs`

> The extension lets the user save specific car listings to a watchlist and check them for price or availability changes. To perform a check, the background service worker opens each saved car's own listing URL in an inactive background tab, reads the current price and availability from that page via a content-script message, and immediately closes the tab. The `tabs` permission is required to open these background tabs (`tabs.create`), message the content script running in them (`tabs.sendMessage`), and close them when the check finishes (`tabs.remove`). Tabs are only ever opened to URLs the user themselves saved, and are closed as soon as the page has been read. No browsing history or data from the user's other tabs is accessed.

### `alarms`

> The extension offers an optional automatic re-check of the user's saved-car watchlist at a frequency the user chooses from the toolbar popup (Off / every 3, 6, or 12 hours / daily). It uses `chrome.alarms` to schedule one repeating alarm that wakes the background service worker at that interval to run the check. This permission is required because a Manifest V3 service worker is not persistent and cannot rely on `setInterval`/`setTimeout` for scheduled work — `chrome.alarms` is Chrome's supported mechanism for periodic background tasks. A single alarm is created, and it is cleared entirely when the user selects "Off". No alarm data leaves the browser.

### `notifications`

> When an automatic (scheduled) watchlist check detects an actionable change — a saved car's price dropping, or the car becoming unavailable/sold — the extension shows a single system notification via `chrome.notifications` so the user is informed without having to open the popup. This fires only for the user's own saved cars and only on scheduled checks; a manual "Check" never produces a notification. Clicking the notification opens the relevant listing (single car) or the watchlist (multiple). Notification content is generated entirely locally from data already read during the check and is never transmitted anywhere.

### Host permissions

> The extension reads page content on a fixed set of car-shopping sites in order to detect Tesla VINs and either highlight matching cars (on Tesla.com) or show a small VIN-decoder popover (on third-party listing sites). No network requests are made to these hosts; the extension only inspects the DOM in the user's own browser.
>
> - **tesla.com/inventory/\*, tesla.com/\*/inventory/\*, tesla.com/\*/order/\***: required to read VINs from Tesla's inventory cards and order pages (US and international locales) and apply the user's highlight rules to matching cars.
> - **autotrader.com, cargurus.com, cars.com, carvana.com, carmax.com, truecar.com, edmunds.com, kbb.com, findmyelectric.com, onlyusedtesla.com**: required to scan each vehicle detail page for a Tesla VIN. When one is found, the extension displays a popover decoding the VIN's model, year, plant, build number, and likely Autopilot hardware version.
>
> The extension does not request access to any host outside this list.

---

## Listing screenshots

Source PNGs go in `~/Desktop/tih/`. Run `node scripts/build-screenshots.mjs` and choose `-cropped` or `-letterboxed` variants per shot. Chrome Web Store expects 1280×800.

---

## Release history

| Version | Date | Notes |
|---------|------|-------|
| 1.1.2 | 2026-07-01 | Automatic periodic watchlist checks (adds `alarms`) and desktop notifications on scheduled price-drop/sold changes (adds `notifications`); sold used cars detected via order-page redirect to inventory |
| 1.1.0 | 2026-06-29 | Save & monitor watchlist: track saved cars for price/availability changes (adds `tabs` permission); enriched saved-car rows with price, trim, and paint color |
| 1.0.2 | 2026-05-11 | VIN decoder popover on third-party sites, Tesla.com worldwide, `in` operator in rules engine, tightened defaults |
| 1.0.1 | (pre) | Popup layout tightening, rating prompt, screenshot script, highlighting toggle |
