import type { TeslaVinInfo } from './decoder';

// A watchlist of Tesla cars the user wants to monitor for price/availability
// changes. All logic here is PURE (no `browser`/DOM) so it is unit-testable and
// so the brittle parts (DOM scraping, tab orchestration) stay at the edges.

export type CarAvailability = 'available' | 'unavailable' | 'unknown';
export type ChangeKind = 'none' | 'price-drop' | 'price-rise' | 'gone';

// A single observation of a car, captured at save time or during a check run.
export type CarSnapshot = {
  price: number | null; // whole units of `currency` (cents dropped); null if unparseable
  currency: string | null; // best-effort ISO-ish code, e.g. 'USD'
  availability: CarAvailability;
  at: number; // Date.now() of this observation
};

export type SavedCar = {
  vin: string;
  url: string; // stable order-style re-check URL
  // Decoded info denormalized so the popup renders instantly without re-decoding.
  model: string | null;
  modelYear: number | null;
  likelyHw: string;
  trim: string | null; // variant text, e.g. "Long Range All-Wheel Drive"
  paintName: string | null; // paint name shown in the list, e.g. "Stealth Grey"
  mileage: number | null; // odometer reading; only used/demo cars have one
  mileageUnit: 'mi' | 'km' | null; // display unit paired with `mileage`
  savedAt: number;
  baseline: CarSnapshot; // snapshot captured when the car was saved
  latest: CarSnapshot; // most recent observation (== baseline until first check)
  history: CarSnapshot[]; // bounded ring of distinct observations, newest last
  lastChange: ChangeKind; // result of the most recent diff; drives badge + UI
  lastCheckedAt: number | null;
  acknowledged: boolean; // user has seen the current change (clears it from the badge)
};

export type SavedCars = SavedCar[];

// Bound storage growth: ~5MB local quota is plenty for this, but keep history
// trimmed and cap the list so check runs stay bounded in wall-clock time.
export const HISTORY_LIMIT = 20;
export const MAX_SAVED_CARS = 50;

const CURRENCY_CODES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'CNY',
  'JPY',
  'AUD',
  'HKD',
  'CHF',
  'AED',
  'KRW',
];

function detectCurrency(text: string): string | null {
  // Explicit ISO codes win over symbols.
  const code = text.toUpperCase().match(new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`));
  if (code) return code[1] ?? null;
  if (/CA\$|C\$/.test(text)) return 'CAD';
  if (/A\$/.test(text)) return 'AUD';
  if (/HK\$/.test(text)) return 'HKD';
  if (text.includes('$')) return 'USD';
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('¥') || text.includes('元')) return 'CNY';
  if (text.includes('₩')) return 'KRW';
  return null;
}

// Parse a localized price string into a whole-number value + best-effort currency.
// Handles US ("$42,990", "$42,990.00"), EU ("€51.990", "42.990,00 €"), and bare
// numbers ("45,000"). Returns value:null on anything unparseable — never throws.
export function parsePrice(text: string): { value: number | null; currency: string | null } {
  const currency = detectCurrency(text ?? '');
  // Match a properly thousands-grouped number first so we stop at an ungrouped run
  // (e.g. "$39,1002024…" yields "39,100", not the price+year concatenation). The
  // second alternative covers plain ungrouped numbers like "39100".
  const m = (text ?? '').match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
  if (!m) return { value: null, currency };

  let token = m[0] ?? '';
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');

  if (hasComma && hasDot) {
    // Both separators present: the last-occurring one is the decimal separator.
    const decimalSep = token.lastIndexOf(',') > token.lastIndexOf('.') ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    token = token.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const parts = token.split(sep);
    const last = parts[parts.length - 1];
    // A single separator followed by exactly 2 digits reads as a decimal point;
    // otherwise (3-digit group, or multiple separators) it is a thousands sep.
    token = parts.length === 2 && last?.length === 2 ? token.replace(sep, '.') : parts.join('');
  }

  const value = parseFloat(token);
  if (Number.isNaN(value)) return { value: null, currency };
  return { value: Math.round(value), currency };
}

const PRICE_TOKEN_G = /[$€£¥]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g;
// A larger "original" price labelled like this would otherwise beat the real
// (sale) price when we take the max, so drop amounts with this prefix.
const ORIGINAL_PRICE_PREFIX = /\b(was|originally|msrp|reduced from)\b/i;

// Choose the actual purchase price from a blob of text that may also contain a
// price reduction ("Reduced by $1,400"), a monthly payment ("$599/mo"), fees, or
// an original price ("Was $50,000"). The purchase price is the largest legitimate
// amount, so take the max — except drop a larger "Was/MSRP" original, detected by
// the words immediately before that amount (window bounded so neighbours don't
// bleed in). Never throws.
export function pickBestPrice(text: string): { value: number | null; currency: string | null } {
  const src = text ?? '';
  let prevEnd = 0;
  let best: { value: number; currency: string | null } | null = null;
  for (const m of src.matchAll(PRICE_TOKEN_G)) {
    const idx = m.index ?? 0;
    const before = src.slice(Math.max(prevEnd, idx - 16), idx);
    prevEnd = idx + m[0].length;
    if (ORIGINAL_PRICE_PREFIX.test(before)) continue;
    const parsed = parsePrice(m[0]);
    if (parsed.value !== null && (best === null || parsed.value > best.value)) {
      best = { value: parsed.value, currency: parsed.currency };
    }
  }
  return best ?? { value: null, currency: null };
}

// Parse an odometer reading out of a Tesla listing blob. Only used/demo cars have
// one, rendered "glued" to surrounding text, e.g. "…Vehicle with 22,945 mi" or
// "…with 22 945 km". Require a trailing mi/km unit (never on price or year) and
// read the grouped number before it. Skip "<n> mi range" (EV range, not odometer).
// Returns nulls on new cars / no match; never throws.
export function parseMileage(text: string): { value: number | null; unit: 'mi' | 'km' | null } {
  const re = /\b(\d{1,3}(?:[.,\s]\d{3})*|\d+)\s*(mi|km)\b(?!\s*range)/gi;
  for (const m of (text ?? '').matchAll(re)) {
    const value = parseInt((m[1] ?? '').replace(/[.,\s]/g, ''), 10);
    const unit = (m[2] ?? '').toLowerCase() as 'mi' | 'km';
    if (Number.isFinite(value) && value > 0 && value <= 500_000) return { value, unit };
  }
  return { value: null, unit: null };
}

export function makeSnapshot(
  price: number | null,
  currency: string | null,
  availability: CarAvailability,
  at: number,
): CarSnapshot {
  return { price, currency, availability, at };
}

export function createSavedCar(
  info: TeslaVinInfo,
  url: string,
  snapshot: CarSnapshot,
  details?: {
    trim?: string | null;
    paintName?: string | null;
    mileage?: number | null;
    mileageUnit?: 'mi' | 'km' | null;
  },
): SavedCar {
  return {
    vin: info.vin,
    url,
    model: info.model,
    modelYear: info.modelYear,
    likelyHw: info.likelyHw,
    trim: details?.trim ?? null,
    paintName: details?.paintName ?? null,
    mileage: details?.mileage ?? null,
    mileageUnit: details?.mileageUnit ?? null,
    savedAt: snapshot.at,
    baseline: snapshot,
    latest: snapshot,
    history: [snapshot],
    lastChange: 'none',
    lastCheckedAt: null,
    acknowledged: true,
  };
}

export function addCar(
  cars: SavedCars,
  car: SavedCar,
): { ok: true; cars: SavedCars } | { ok: false; reason: 'duplicate' | 'full' } {
  if (cars.some((c) => c.vin === car.vin)) return { ok: false, reason: 'duplicate' };
  if (cars.length >= MAX_SAVED_CARS) return { ok: false, reason: 'full' };
  return { ok: true, cars: [...cars, car] };
}

export function removeCar(cars: SavedCars, vin: string): SavedCars {
  return cars.filter((c) => c.vin !== vin);
}

// The heart of monitoring. A flaky/slow scrape yields availability:'unknown',
// which must NEVER be reported as a change — otherwise a single timeout would
// fabricate a "gone" or price move.
export function diffSnapshot(prev: CarSnapshot, next: CarSnapshot): ChangeKind {
  if (next.availability === 'unavailable') return 'gone';
  if (next.availability === 'unknown') return 'none';
  if (prev.price !== null && next.price !== null) {
    if (next.price < prev.price) return 'price-drop';
    if (next.price > prev.price) return 'price-rise';
  }
  return 'none';
}

function appendHistory(history: CarSnapshot[], snapshot: CarSnapshot): CarSnapshot[] {
  const last = history[history.length - 1];
  // Dedup unchanged observations so repeated checks don't grow history.
  if (last && last.price === snapshot.price && last.availability === snapshot.availability) {
    return history;
  }
  const next = [...history, snapshot];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export function applyCheckResult(car: SavedCar, snapshot: CarSnapshot): SavedCar {
  const change = diffSnapshot(car.latest, snapshot);
  return {
    ...car,
    latest: snapshot,
    history: appendHistory(car.history, snapshot),
    lastChange: change,
    lastCheckedAt: snapshot.at,
    // A fresh change un-acknowledges; an unchanged check leaves prior state alone.
    acknowledged: change === 'none' ? car.acknowledged : false,
  };
}

// Number of cars with an unacknowledged change — the toolbar badge value.
export function changedCount(cars: SavedCars): number {
  return cars.filter((c) => c.lastChange !== 'none' && !c.acknowledged).length;
}

export function acknowledgeAll(cars: SavedCars): SavedCars {
  return cars.map((c) => (c.acknowledged ? c : { ...c, acknowledged: true }));
}
