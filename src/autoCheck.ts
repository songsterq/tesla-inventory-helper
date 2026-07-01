// Automatic-check scheduling. Pure logic only (no `browser`/`chrome.alarms`) so
// it is unit-testable; the background worker owns the actual alarm calls.

// Frequencies offered by the popup dropdown, in minutes. 0 means "Off". The
// minimum non-off interval is 3h (180) — a deliberate floor so background
// tab-opening never gets aggressive.
export const AUTO_CHECK_OPTIONS = [0, 180, 360, 720, 1440] as const;

export const MIN_AUTO_CHECK_MINUTES = 180;
export const DEFAULT_AUTO_CHECK_MINUTES = 1440;

// What the worker should do with the alarm for a given stored setting.
export type AlarmPlan = { clear: true } | { periodInMinutes: number; delayInMinutes: number };

// Map a stored frequency (minutes) to an alarm action. Off / garbage → clear.
// Otherwise a repeating alarm whose first fire is delayed by a full period, so
// flipping the setting (or a browser restart) never triggers an immediate check
// storm. A corrupted sub-minimum value is clamped up to the 3h floor rather than
// honored, so we can never schedule tighter than the UI allows.
export function planAlarm(minutes: number): AlarmPlan {
  if (!Number.isFinite(minutes) || minutes <= 0) return { clear: true };
  const period = Math.max(MIN_AUTO_CHECK_MINUTES, Math.floor(minutes));
  return { periodInMinutes: period, delayInMinutes: period };
}
