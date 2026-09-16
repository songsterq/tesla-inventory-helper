import { decodeTeslaVin } from './decoder';
import { displayableHistory, type CarSnapshot, type SavedCar } from './savedCars';

// Shared price/car formatting used by the popup watchlist row, the background
// change notification, and the on-page Track button, so every surface renders
// the same car identically.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  AUD: 'A$',
  HKD: 'HK$',
  CHF: 'CHF ',
  AED: 'AED ',
  KRW: '₩',
};

export const priceSymbol = (currency: string | null): string =>
  currency ? (CURRENCY_SYMBOL[currency] ?? '') : '';

export function formatPrice(s: CarSnapshot): string {
  if (s.price === null) return '—';
  return `${priceSymbol(s.currency)}${s.price.toLocaleString()}`;
}

// Common Tesla trim phrases → short forms so titles fit the popup/notification width.
// Applied at display time only; stored `trim` stays full-length. Each phrase occurs
// at most once in a trim, so these are deliberately non-global: a shared /g regex
// carries `lastIndex` between calls and misbehaves the moment anyone reaches for
// `.test()` instead of `.replace()`.
const TRIM_ABBREVS = [
  [/\bAll-Wheel Drive\b/i, 'AWD'],
  [/\bRear-Wheel Drive\b/i, 'RWD'],
  [/\bLong Range\b/i, 'LR'],
  [/\bStandard Range\b/i, 'SR'],
] as const satisfies ReadonlyArray<readonly [RegExp, string]>;

// Idempotent: abbreviating an already-abbreviated trim is a no-op, since no short
// form contains a phrase from the table. Keep it that way when adding rules.
export function abbreviateTrim(trim: string): string {
  let out = trim;
  for (const [re, abbr] of TRIM_ABBREVS) {
    out = out.replace(re, abbr);
  }
  return out;
}

// Title line, e.g. "2024 Model Y LR AWD"; VIN when unknown.
export function formatCarName(car: SavedCar): string {
  return joinCarName(car, car.trim ? abbreviateTrim(car.trim) : null);
}

// Same title with the trim spelled out, e.g. "2024 Model Y Long Range All-Wheel
// Drive". For accessible names and tooltips: the abbreviations solve a visual
// width problem screen readers don't have, and they read poorly aloud ("LR AWD").
export function formatCarNameFull(car: SavedCar): string {
  return joinCarName(car, car.trim);
}

function joinCarName(car: SavedCar, trim: string | null): string {
  return [car.modelYear, car.model, trim].filter(Boolean).join(' ') || car.vin;
}

// Sub-line, e.g. "Stealth Grey · 42,000 mi · Fremont · HW4"; parts drop out when absent.
// Plant is re-derived from the VIN rather than read off the car: it's a pure
// function of the VIN, `SavedCar` never stored it, and `local:savedCars` has no
// migration — so deriving here back-fills cars saved before this line existed.
export function formatCarSubLine(car: SavedCar): string {
  const parts: (string | null)[] = [car.paintName];
  if (car.mileage && car.mileageUnit) {
    parts.push(`${car.mileage.toLocaleString()} ${car.mileageUnit}`);
  }
  parts.push(decodeTeslaVin(car.vin)?.plant ?? null);
  parts.push(car.likelyHw);
  return parts.filter(Boolean).join(' · ');
}

// One line of the popup price-history panel: the observation's value. A sold car
// reads "Sold"; anything else shows its price ("—" when the price is unknown).
export function formatHistoryValue(s: CarSnapshot): string {
  if (s.availability === 'unavailable') return 'Sold';
  return formatPrice(s);
}

// The timestamp column of a history line, e.g. "Jul 10, 9:34 AM". Localized to
// the user's runtime locale; `at` is a Date.now()-style epoch in ms.
const HISTORY_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatHistoryTime(at: number): string {
  return HISTORY_TIME_FMT.format(at);
}

// A signed price change, e.g. "−$500" / "+$1,000". Uses U+2212 MINUS rather than
// a hyphen so the sign reads as a sign. Callers skip a zero diff themselves.
export function formatSignedDelta(diff: number, currency: string | null): string {
  return `${diff < 0 ? '−' : '+'}${priceSymbol(currency)}${Math.abs(diff).toLocaleString()}`;
}

export type DeltaClass = 'down' | 'up' | 'gone' | 'idle';
export type PriceStatus = { text: string; cls: DeltaClass };

// A car's price status at a glance: a signed delta, "Sold", or a muted
// "No change" / nothing yet. Drives the popup row's second line and the on-page
// Track button's label. The delta is always current price vs the price when the
// car was saved — a stable fact about the car, NOT gated on `lastChange` (which
// is per-check and only drives the badge/notifications). Gating on lastChange
// used to make the line flicker: a run that observed a movement showed the
// delta, and the very next re-check diffed "no change since a minute ago" and
// hid it again.
export function formatPriceStatus(car: SavedCar): PriceStatus {
  if (car.latest.availability === 'unavailable') return { text: 'Sold', cls: 'gone' };
  const a = car.baseline.price;
  const b = car.latest.price;
  if (a !== null && b !== null && a !== b) {
    const diff = b - a;
    return { text: formatSignedDelta(diff, car.latest.currency), cls: diff < 0 ? 'down' : 'up' };
  }
  // Before the first check, say nothing — "No change" only appears once checked.
  return car.lastCheckedAt === null
    ? { text: '', cls: 'idle' }
    : { text: 'No change', cls: 'idle' };
}

export type HistoryRow = {
  at: number; // epoch ms; the renderer applies formatHistoryTime
  value: string; // "$46,490" | "Sold" | "—"
  delta: string; // "−$500" | "+$1,000" | "Tracked" | ''
  cls: DeltaClass | 'base';
};

export const HISTORY_POPOVER_ROWS = 7;

// Rows for the Track button's popover, in chronological order (oldest on top)
// over the most recent `limit` observations: each one's value and its change
// vs the observation before it. Only the true first entry (the save-time
// baseline) reads "Tracked"; once it scrolls out of the window, the oldest row
// shown still gets a real delta against its predecessor.
export function priceHistoryRows(car: SavedCar, limit = HISTORY_POPOVER_ROWS): HistoryRow[] {
  const shown = displayableHistory(car.history);
  // A history of nothing but legacy 'unknown' entries still has a baseline.
  const timeline = shown.length > 0 ? shown : [car.baseline];
  const start = Math.max(0, timeline.length - limit);
  return timeline.slice(start).map((cur, offset): HistoryRow => {
    const i = start + offset;
    const row = { at: cur.at, value: formatHistoryValue(cur) };
    const prev = i > 0 ? timeline[i - 1] : undefined;
    if (!prev) return { ...row, delta: 'Tracked', cls: 'base' };
    if (cur.availability === 'unavailable') return { ...row, delta: '', cls: 'gone' };
    if (prev.price === null || cur.price === null || prev.price === cur.price) {
      return { ...row, delta: '', cls: 'idle' };
    }
    const diff = cur.price - prev.price;
    return {
      ...row,
      delta: formatSignedDelta(diff, cur.currency ?? prev.currency),
      cls: diff < 0 ? 'down' : 'up',
    };
  });
}
