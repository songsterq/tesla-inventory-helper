import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import type { SavedCars } from './savedCars';
import type { SavedSearch, SavedSearches } from './savedSearches';
import { defaultRules, migrateRulesToV2, migrateRulesToV3 } from './defaultRules';
import { DEFAULT_AUTO_CHECK_HOUR, DEFAULT_AUTO_CHECK_MINUTES } from './autoCheck';

// v2 re-seeds users still holding an untouched copy of the v1 defaults, whose
// 2023 cutoffs were wrong for Model S/X and Model 3; see migrateRulesToV2.
// v3 does the same for an untouched v2 copy, adding the Cybertruck WMI to the
// 2024+ rule; see migrateRulesToV3. Custom rule sets are left alone.
//
// Note these migrations run at module load in *every* context that imports this
// file (background, popup, both content scripts), not from a single onInstalled
// hook — @wxt-dev/storage kicks it off inside defineItem. It's safe to run
// concurrently: the transform is pure and the version write is idempotent. It's
// also fire-and-forget, so a throw would only surface as a console.error, which
// is why migrateRulesToV2 passes unrecognized values through instead of
// rejecting them.
export const rulesItem = storage.defineItem<Rules>('sync:rules', {
  fallback: defaultRules,
  version: 3,
  migrations: {
    2: migrateRulesToV2,
    3: migrateRulesToV3,
  },
});

export const highlightingEnabledItem = storage.defineItem<boolean>('sync:highlightingEnabled', {
  fallback: true,
});

// Automatic price-check frequency in minutes (0 = off). A roaming preference like
// rules/highlighting, so it lives in `sync`. The background worker turns this into
// a chrome.alarms schedule; see src/autoCheck.ts.
export const autoCheckMinutesItem = storage.defineItem<number>('sync:autoCheckMinutes', {
  fallback: DEFAULT_AUTO_CHECK_MINUTES,
});

// Local-time hour (0–23) the automatic checks anchor to — the "9AM" in the
// popup's time dropdown. Roams with the frequency, so it lives in `sync`. The
// background worker feeds it to planAlarm to phase-align the chrome.alarms
// schedule; see src/autoCheck.ts.
export const autoCheckHourItem = storage.defineItem<number>('sync:autoCheckHour', {
  fallback: DEFAULT_AUTO_CHECK_HOUR,
});

// The watchlist lives in `local`, not `sync`, on purpose: chrome.storage.sync
// caps at ~8KB per item, and one SavedCars array with price history blows past
// that quickly. Monitoring data is also device-local and transient by nature, so
// it doesn't need to roam across the user's machines the way rule config does.
export const savedCarsItem = storage.defineItem<SavedCars>('local:savedCars', {
  fallback: [],
});

// Saved inventory searches (listing URL + slider state). Small records that a
// shopper wants on every machine, so `sync` — with the count/byte caps in
// src/savedSearches.ts keeping the item under Chrome's 8KB per-item limit.
export const savedSearchesItem = storage.defineItem<SavedSearches>('sync:savedSearches', {
  fallback: [],
});

// A search queued for restore in a specific tab, keyed by tab id. The
// background worker writes it before navigating the tab and the content script
// collects it via the `tih:pending-search` message. It lives in `session`
// rather than a worker-local Map because the worker can be killed between
// `tabs.create` and the new page's document_idle; `session` survives that and
// is wiped when the browser exits, so a stale entry can never outlive its tab.
// BACKGROUND-ONLY: content scripts have no storage.session access (no
// setAccessLevel call), so never read this item from entrypoints/content.
export type PendingSearch = { search: SavedSearch; queuedAt: number };
export const pendingSearchesItem = storage.defineItem<Record<string, PendingSearch>>(
  'session:pendingSearches',
  { fallback: {} },
);
