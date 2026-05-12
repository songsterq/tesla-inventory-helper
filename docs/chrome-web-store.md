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

> The extension stores two pieces of user-configurable state in `chrome.storage.sync`: the list of VIN-matching rules (which decide what gets highlighted) and an on/off toggle for highlighting. Sync storage is used so the user's rules follow their Chrome profile across devices. No data is uploaded to any third-party server.

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
| 1.0.2 | 2026-05-11 | VIN decoder popover on third-party sites, Tesla.com worldwide, `in` operator in rules engine, tightened defaults |
| 1.0.1 | (pre) | Popup layout tightening, rating prompt, screenshot script, highlighting toggle |
