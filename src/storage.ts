import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import type { SavedCars } from './savedCars';
import { defaultRules, migrateRulesToV2 } from './defaultRules';
import { DEFAULT_AUTO_CHECK_HOUR, DEFAULT_AUTO_CHECK_MINUTES } from './autoCheck';

// v2 re-seeds users still holding an untouched copy of the v1 defaults, whose
// 2023 cutoffs were wrong for Model S/X and Model 3; see migrateRulesToV2.
// Custom rule sets are left alone.
//
// Note this migration runs at module load in *every* context that imports this
// file (background, popup, both content scripts), not from a single onInstalled
// hook — @wxt-dev/storage kicks it off inside defineItem. It's safe to run
// concurrently: the transform is pure and the version write is idempotent. It's
// also fire-and-forget, so a throw would only surface as a console.error, which
// is why migrateRulesToV2 passes unrecognized values through instead of
// rejecting them.
export const rulesItem = storage.defineItem<Rules>('sync:rules', {
  fallback: defaultRules,
  version: 2,
  migrations: {
    2: migrateRulesToV2,
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
