// Automatic-check scheduling. Pure logic only (no `browser`/`chrome.alarms`) so
// it is unit-testable; the background worker owns the actual alarm calls.

// Frequencies offered by the popup dropdown, in minutes. 0 means "Off". The
// minimum non-off interval is 3h (180) — a deliberate floor so background
// tab-opening never gets aggressive.
export const AUTO_CHECK_OPTIONS = [0, 180, 360, 720, 1440] as const;

export const MIN_AUTO_CHECK_MINUTES = 180;
export const DEFAULT_AUTO_CHECK_MINUTES = 1440;

// Time-of-day the checks anchor to, as a local-time hour (0–23). 9 = 9AM. This
// is the phase anchor for *every* frequency: a daily check runs once at this
// hour; a 6h check runs at this hour and every 6h thereafter (e.g. 9,3,9,3).
export const DEFAULT_AUTO_CHECK_HOUR = 9;

const MINUTES_PER_DAY = 1440;

// What the worker should do with the alarm for a given stored setting.
export type AlarmPlan = { clear: true } | { periodInMinutes: number; delayInMinutes: number };

// Coerce a stored anchor hour into a valid 0..23, defaulting corrupted values to
// midnight so the delay math can never blow up.
function anchorMinuteOfDay(anchorHour: number): number {
  if (!Number.isFinite(anchorHour)) return 0;
  const h = Math.floor(anchorHour);
  if (h < 0 || h > 23) return 0;
  return h * 60;
}

// Map a stored frequency + anchor hour to an alarm action, given the current
// local minute-of-day (passed in so this stays pure and timezone-agnostic for
// tests). Off / garbage → clear. Otherwise a repeating alarm whose first fire
// lands on the next anchor-aligned slot. Because the slots are phase-locked to
// the anchor, all four intervals (which divide 1440 evenly) tile the day cleanly.
//
// The delay always lies in (0, period]: when `now` sits exactly on a slot we
// wait a full period rather than firing immediately, preserving the old "no
// check storm on setting change / restart" guarantee. A corrupted sub-minimum
// frequency is clamped up to the 3h floor so we never schedule tighter than the
// UI allows.
export function planAlarm(minutes: number, anchorHour: number, nowMinuteOfDay: number): AlarmPlan {
  if (!Number.isFinite(minutes) || minutes <= 0) return { clear: true };
  const period = Math.max(MIN_AUTO_CHECK_MINUTES, Math.floor(minutes));
  const anchor = anchorMinuteOfDay(anchorHour);
  const now = ((Math.floor(nowMinuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const intoCycle = (((now - anchor) % period) + period) % period;
  const delayInMinutes = period - intoCycle; // in (0, period]
  return { periodInMinutes: period, delayInMinutes };
}
