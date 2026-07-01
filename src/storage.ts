import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import type { SavedCars } from './savedCars';
import { defaultRules } from './defaultRules';
import { DEFAULT_AUTO_CHECK_MINUTES } from './autoCheck';

export const rulesItem = storage.defineItem<Rules>('sync:rules', {
  fallback: defaultRules,
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

// The watchlist lives in `local`, not `sync`, on purpose: chrome.storage.sync
// caps at ~8KB per item, and one SavedCars array with price history blows past
// that quickly. Monitoring data is also device-local and transient by nature, so
// it doesn't need to roam across the user's machines the way rule config does.
export const savedCarsItem = storage.defineItem<SavedCars>('local:savedCars', {
  fallback: [],
});
