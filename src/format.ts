import type { CarSnapshot, SavedCar } from './savedCars';

// Shared price/car formatting used by both the popup watchlist row and the
// background change notification, so the two surfaces render identically.

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

// Sub-line, e.g. "Stealth Grey · 42,000 mi · HW4"; parts drop out when absent.
export function formatCarSubLine(car: SavedCar): string {
  const parts: (string | null)[] = [car.paintName];
  if (car.mileage && car.mileageUnit) {
    parts.push(`${car.mileage.toLocaleString()} ${car.mileageUnit}`);
  }
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
