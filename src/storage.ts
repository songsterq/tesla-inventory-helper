import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import type { SavedCars } from './savedCars';
import { defaultRules } from './defaultRules';

export const rulesItem = storage.defineItem<Rules>('sync:rules', {
  fallback: defaultRules,
});

export const highlightingEnabledItem = storage.defineItem<boolean>('sync:highlightingEnabled', {
  fallback: true,
});

// The watchlist lives in `local`, not `sync`, on purpose: chrome.storage.sync
// caps at ~8KB per item, and one SavedCars array with price history blows past
// that quickly. Monitoring data is also device-local and transient by nature, so
// it doesn't need to roam across the user's machines the way rule config does.
export const savedCarsItem = storage.defineItem<SavedCars>('local:savedCars', {
  fallback: [],
});
