import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import type { SavedCars } from './savedCars';
import type { SavedSearch, SavedSearches } from './savedSearches';
import type { SearchWatch } from './searchWatch';
import { defaultRules, RULES_MIGRATIONS, RULES_STORAGE_VERSION } from './defaultRules';
import { DEFAULT_AUTO_CHECK_HOUR, DEFAULT_AUTO_CHECK_MINUTES, DEFAULT_SEARCH_ALERT_MINUTES } from './autoCheck';

// Everything persistent lives in `local`: one place, per device. Until v1.2.5
// the rules, the highlight toggle, the auto-check schedule and saved searches
// were in `sync`; the background worker copies those over once (see
// src/syncMigration.ts and migratedFromSyncItem), and the popup and content
// scripts wait for that copy before their first read (src/storageReady.ts).

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
export const rulesItem = storage.defineItem<Rules>('local:rules', {
  fallback: defaultRules,
  version: RULES_STORAGE_VERSION,
  migrations: RULES_MIGRATIONS,
});

export const highlightingEnabledItem = storage.defineItem<boolean>('local:highlightingEnabled', {
  fallback: true,
});

// Automatic price-check frequency in minutes (0 = off). The background worker
// turns this into a chrome.alarms schedule; see src/autoCheck.ts.
export const autoCheckMinutesItem = storage.defineItem<number>('local:autoCheckMinutes', {
  fallback: DEFAULT_AUTO_CHECK_MINUTES,
});

export const searchAlertMinutesItem = storage.defineItem<number>('local:searchAlertMinutes', {
  fallback: DEFAULT_SEARCH_ALERT_MINUTES,
});

// Local-time hour (0–23) the automatic checks anchor to — the "9AM" in the
// popup's time dropdown. The background worker feeds it to planAlarm to
// phase-align the chrome.alarms schedule; see src/autoCheck.ts.
export const autoCheckHourItem = storage.defineItem<number>('local:autoCheckHour', {
  fallback: DEFAULT_AUTO_CHECK_HOUR,
});

// The watchlist, with each car's price history.
export const savedCarsItem = storage.defineItem<SavedCars>('local:savedCars', {
  fallback: [],
});

// Saved inventory searches (listing URL + slider state); see src/savedSearches.ts.
export const savedSearchesItem = storage.defineItem<SavedSearches>('local:savedSearches', {
  fallback: [],
});

// Per-search "new matches" state (captured Tesla request, known car keys, new keys),
// keyed by saved-search id; see src/searchWatch.ts.
// SINGLE WRITER: only the background worker writes this item (serialized, see
// updateSearchWatch). The content script and popup read it and send messages.
export const searchWatchItem = storage.defineItem<SearchWatch>('local:searchWatch', {
  fallback: {},
});

// Set once the background worker has copied the pre-v1.2.5 `sync` values into
// `local` (src/syncMigration.ts). Never unset.
export const migratedFromSyncItem = storage.defineItem<boolean>('local:migratedFromSync', {
  fallback: false,
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
