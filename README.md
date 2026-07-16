# Tesla Inventory Helper

Chrome extension that helps Tesla shoppers find HW4 cars by reading the VIN for you — on Tesla.com and on popular car-listing sites.

**Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/tesla-inventory-helper/ehgoebfdmhafkkongmkidfacnaopncli).**

## What it does

- **Tesla.com (worldwide)** — Soft amber glow on inventory and order listings whose VIN matches your rules. Ships with defaults for HW4; tune them from the toolbar popup.
- **Third-party listing sites** — When a Tesla VIN appears on a supported page, a small panel shows model, year, plant, build serial, and likely Autopilot hardware (HW3 / HW4).
- **Watchlist** — Save cars and re-check price and availability on a schedule. Optional desktop notifications when a scheduled check sees a price drop or a car go sold.

Everything runs locally in your browser. No analytics, no servers, no tracking.

## Develop

Requires Node.js and npm.

```bash
npm install
npm run dev          # load .output/chrome-mv3 in chrome://extensions (Developer mode)
npm test             # Vitest
npm run compile      # TypeScript check
npm run build        # production build
npx wxt zip          # Chrome Web Store zip under .output/
```

Stack: [WXT](https://wxt.dev/) (MV3), TypeScript, Vitest.

For architecture notes, the rule engine, allowlist sync, and release checklist, see [`AGENTS.md`](./AGENTS.md).

## Privacy

The extension only reads pages on Tesla.com and a fixed set of car-listing hosts (shown by Chrome at install time). Watchlist checks open tabs only for URLs you saved. No data leaves your browser.

## Disclaimer

Independent third-party tool. Not affiliated with, endorsed by, or sponsored by Tesla, Inc. "Tesla" is used only to identify the VINs the extension recognizes.
