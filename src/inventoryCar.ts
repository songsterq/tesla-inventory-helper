import { LISTING_HASH_RE, VIN_RE } from './vin';

export type CarSummary = {
  key: string; // real VIN or listing hash
  orderId: string; // Tesla's VIN field verbatim, including masked order IDs
  model: string | null;
  year: number | null;
  trim: string | null;
  paint: string | null;
  wheels: string | null;
  interior: string | null;
  seats: string | null;
  towHitch: boolean;
  price: number | null;
  currency: string | null;
  odometer: number | null;
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const finite = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;
const ORDER_ID_RE = /^[A-Za-z0-9_]{17,48}$/;

function carKey(orderId: string, hash: unknown): string | null {
  const vin = orderId.toUpperCase();
  if (VIN_RE.test(vin)) return vin;
  return typeof hash === 'string' && LISTING_HASH_RE.test(hash) && orderId.endsWith(hash)
    ? hash
    : null;
}

// Keep Tesla's readable names verbatim so configurations work in every locale.
// A missing identity fails the record; missing descriptive data stays unknown.
export function parseInventoryCar(record: unknown): CarSummary | null {
  if (!isRecord(record) || typeof record.VIN !== 'string' || !ORDER_ID_RE.test(record.VIN)) return null;
  const key = carKey(record.VIN, record.Hash);
  if (!key) return null;
  const options = Array.isArray(record.OptionCodeData) ? record.OptionCodeData.filter(isRecord) : [];
  const name = (group: string) =>
    text(options.find((o) => o.group === group && typeof o.name === 'string')?.name);
  return {
    key,
    orderId: record.VIN,
    model: name('MODEL'),
    year: finite(record.Year),
    trim: name('TRIM') ?? text(record.TrimName),
    paint: name('PAINT'),
    wheels: name('WHEELS'),
    interior: name('INTERIOR'),
    seats: name('REAR_SEATS'),
    towHitch: options.some((o) => o.group === 'TOWING'),
    price: finite(record.Price),
    currency: text(record.CurrencyCode),
    odometer: finite(record.Odometer),
  };
}

// Summaries cross from the content script to the worker. Validate the identity
// relationship as well as the fields before a reply can change saved state.
export function isCarSummary(x: unknown): x is CarSummary {
  if (!isRecord(x) || typeof x.orderId !== 'string' || !ORDER_ID_RE.test(x.orderId)) return false;
  if (typeof x.key !== 'string' || carKey(x.orderId, x.key) !== x.key) return false;
  return (
    ['model', 'trim', 'paint', 'wheels', 'interior', 'seats', 'currency']
      .every((k) => x[k] === null || typeof x[k] === 'string') &&
    ['year', 'price', 'odometer'].every((k) => x[k] === null || finite(x[k]) !== null) &&
    typeof x.towHitch === 'boolean'
  );
}
