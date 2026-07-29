# Used-inventory-only highlight & Track UI — design

## Goal

Show Tesla.com glow highlights and Track buttons only on **used** inventory
listings and **used** order pages. New inventory (`/inventory/new/…`) and new
order pages (`titleStatus=new`) must not get pills or glows.

## Background

Today `apply()` in `entrypoints/content/index.ts` treats any
`/(^|\/)inventory\//` path and any `/order/<id>` path the same. New and used
listings share that router, so UI appears on both.

Signals available from Tesla URLs:

| Surface | Used | New |
|---------|------|-----|
| Inventory | `/inventory/used/…` (locale-prefixed OK) | `/inventory/new/…` |
| Order | `?titleStatus=used`, or a real 17-char VIN in the path | `?titleStatus=new`; path id is often a non-VIN token (e.g. `7SAY238_…`) |

Manifest `matches` stay broad so the content script still loads on new pages
(SPA navigations); gating is runtime-only.

## Decisions (confirmed)

1. **Helpers live in `src/vin.ts`** — pure, unit-tested; content script only calls them.
2. **Inventory:** UI only when path matches used inventory.
3. **Order `titleStatus`:**
   - `used` → show UI
   - `new` → hide UI
   - missing → show UI iff `extractVinFromOrderPath` returns a VIN (rule A)
4. **Wrong-page cleanup:** clear glows and remove `.tih-monitor-btn` so SPA
   used↔new transitions don’t leave stale pills.
5. **Watchlist / background scrape:** unchanged.

## Changes

### 1. `src/vin.ts`

```ts
isUsedInventoryPath(pathname: string | null | undefined): boolean
// true iff /(^|\/)inventory\/used(\/|$)/i.test(pathname)

isUsedOrderUrl(href: string | null | undefined): boolean
// Parse with URL (base https://www.tesla.com when given path+search).
// titleStatus === 'used' → true
// titleStatus === 'new'  → false
// missing                → extractVinFromOrderPath(pathname) !== null
// unparseable / null     → false
```

### 2. `entrypoints/content/index.ts`

In `apply()`:

- Inventory branch: if `isUsedInventoryPath(path)` → `applyInventory` +
  `injectInventoryButtons`; else cleanup (clear glows + remove monitor buttons).
- Order branch: if `isUsedOrderUrl(location.href)` → `applyOrder` +
  `injectOrderButton`; else same cleanup.

### 3. Tests — `tests/vin.test.ts`

Cover:

- Inventory: `/inventory/used/my`, `/en_CA/inventory/used/my` → true;
  `/inventory/new/my`, `/inventory/my` → false.
- Order: `titleStatus=used` → true; `titleStatus=new` → false; missing + real
  VIN → true; missing + short/underscore id → false.

### 4. Docs — `AGENTS.md`

Note that Tesla.com highlight/Track UI is used-inventory and used-order only,
with the `titleStatus` / VIN fallback rule above.

## Out of scope

- Narrowing manifest `host_permissions` / content-script `matches`
- Changing watchlist auto-check or scrape behavior
- Third-party VIN popover
