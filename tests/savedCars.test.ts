import { describe, expect, it } from 'vitest';
import type { TeslaVinInfo } from '../src/decoder';
import {
  acknowledgeAll,
  addCar,
  applyCheckResult,
  changedCount,
  createSavedCar,
  diffSnapshot,
  displayableHistory,
  dropToIndex,
  HISTORY_LIMIT,
  makeSnapshot,
  MAX_SAVED_CARS,
  parseMileage,
  parsePrice,
  pickBestPrice,
  removeCar,
  reorderCars,
  type CarSnapshot,
  type SavedCar,
  type SavedCars,
} from '../src/savedCars';

const info = (vin: string): TeslaVinInfo => ({
  vin,
  model: 'Model 3',
  modelYear: 2024,
  plant: 'Fremont',
  serial: 123456,
  drivetrain: 'Dual Motor',
  likelyHw: 'HW4',
});

const car = (vin: string, snapshot: CarSnapshot): SavedCar =>
  createSavedCar(info(vin), `https://www.tesla.com/m3/order/${vin}`, snapshot);

const snap = (
  price: number | null,
  availability: CarSnapshot['availability'] = 'available',
  at = 1000,
): CarSnapshot => makeSnapshot(price, price === null ? null : 'USD', availability, at);

describe('createSavedCar', () => {
  it('defaults trim/paintName/mileage to null when no details given', () => {
    const c = car('5YJ3E1EA0PF000001', snap(42990));
    expect(c.trim).toBeNull();
    expect(c.paintName).toBeNull();
    expect(c.mileage).toBeNull();
    expect(c.mileageUnit).toBeNull();
  });

  it('stores supplied trim, paint name, and mileage', () => {
    const c = createSavedCar(info('5YJ3E1EA0PF000001'), 'https://x', snap(42990), {
      trim: 'Long Range All-Wheel Drive',
      paintName: 'Stealth Grey',
      mileage: 22945,
      mileageUnit: 'mi',
    });
    expect(c.trim).toBe('Long Range All-Wheel Drive');
    expect(c.paintName).toBe('Stealth Grey');
    expect(c.mileage).toBe(22945);
    expect(c.mileageUnit).toBe('mi');
  });
});

describe('parsePrice', () => {
  it('parses US thousands separators', () => {
    expect(parsePrice('$42,990')).toEqual({ value: 42990, currency: 'USD' });
  });

  it('parses US price with cents', () => {
    expect(parsePrice('$42,990.00')).toEqual({ value: 42990, currency: 'USD' });
  });

  it('parses EU dot-thousands separators', () => {
    expect(parsePrice('€51.990')).toEqual({ value: 51990, currency: 'EUR' });
  });

  it('parses EU format with comma decimals', () => {
    expect(parsePrice('42.990,00 €')).toEqual({ value: 42990, currency: 'EUR' });
  });

  it('detects CAD from the CA$ prefix', () => {
    expect(parsePrice('CA$45,000')).toEqual({ value: 45000, currency: 'CAD' });
  });

  it('parses a bare number with no currency', () => {
    expect(parsePrice('45,000')).toEqual({ value: 45000, currency: null });
  });

  it('parses a clean details-page price', () => {
    expect(parsePrice('$39,100')).toEqual({ value: 39100, currency: 'USD' });
  });

  it('does not absorb a trailing model year when text is concatenated', () => {
    // Real bug: the price element ran straight into "2024 Pre-Owned…" with no
    // separator, producing "$39,1002024" → must still read 39100, not 391002024.
    expect(parsePrice('$39,1002024 Pre-Owned Vehicle with 22,945 mi')).toEqual({
      value: 39100,
      currency: 'USD',
    });
  });

  it('parses an ungrouped plain number', () => {
    expect(parsePrice('39100')).toEqual({ value: 39100, currency: null });
  });

  it('returns null value for unparseable text', () => {
    expect(parsePrice('Coming soon')).toEqual({ value: null, currency: null });
    expect(parsePrice('')).toEqual({ value: null, currency: null });
  });
});

describe('pickBestPrice', () => {
  it('ignores a "Reduced by" amount and takes the real price', () => {
    expect(
      pickBestPrice('Reduced by $1,400 Premium All-Wheel Drive $47,200 2026 Pre-Owned'),
    ).toEqual({ value: 47200, currency: 'USD' });
  });

  it('ignores a monthly payment', () => {
    expect(pickBestPrice('$599/mo $47,200')).toEqual({ value: 47200, currency: 'USD' });
  });

  it('ignores a "Was" original price', () => {
    expect(pickBestPrice('Was $50,000 Now $47,200')).toEqual({ value: 47200, currency: 'USD' });
  });

  it('reads a single clean price', () => {
    expect(pickBestPrice('$39,100')).toEqual({ value: 39100, currency: 'USD' });
  });

  it('returns null when there is no price', () => {
    expect(pickBestPrice('No price listed')).toEqual({ value: null, currency: null });
  });
});

describe('parseMileage', () => {
  it('reads the odometer from a glued pre-owned blob, not the price or year', () => {
    // Same concatenated string as the parsePrice bug case: must land on 22,945 mi,
    // never 39,100 (price) or 2024 (year) — neither of which carries a mi/km unit.
    expect(parseMileage('$39,1002024 Pre-Owned Vehicle with 22,945 mi')).toEqual({
      value: 22945,
      unit: 'mi',
    });
  });

  it('prefers the odometer over warranty mileage-coverage figures (order page)', () => {
    // Real order-page innerText shape: the warranty section says "50,000 miles
    // mileage coverage", whose "mileage" wording must not read as an odometer label.
    const text = [
      'Rear-Wheel Drive',
      '$31,800',
      '2024 Pre-Owned Vehicle with 42,956 mi',
      'VIN 7SAYGDED2RF002920',
      'Stealth Grey Paint',
      'Original Basic Vehicle Limited Warranty',
      'January 2028 / 50,000 miles mileage coverage (whichever comes first)',
      'Pre-Owned Vehicle Limited Warranty',
      'Additional 1 year / 10,000 miles (whichever comes first)',
      'Battery and Drive Unit Limited Warranty',
      'January 2032 / 100,000 miles mileage coverage (whichever comes first)',
    ].join('\n');
    expect(parseMileage(text)).toEqual({ value: 42956, unit: 'mi' });
  });

  it('returns null on a new car whose only figures are range and warranty coverage', () => {
    const text = [
      '279 mi',
      'Range (est.)',
      'Basic Vehicle Limited Warranty',
      '4 years or 50,000 miles, whichever comes first',
    ].join('\n');
    expect(parseMileage(text)).toEqual({ value: null, unit: null });
  });

  it('reads the odometer from an inventory-card blob with an estimated range', () => {
    const text =
      'Rear-Wheel Drive\n$31,800\n2024 Pre-Owned Vehicle with 42,956 mi\nLocated in Renton\n232 mi range (est.)';
    expect(parseMileage(text)).toEqual({ value: 42956, unit: 'mi' });
  });

  it('parses a bare US mileage', () => {
    expect(parseMileage('22,945 mi')).toEqual({ value: 22945, unit: 'mi' });
  });

  it('parses mileage glued to the unit with no space', () => {
    expect(parseMileage('22,945mi')).toEqual({ value: 22945, unit: 'mi' });
  });

  it('normalizes an uppercase unit to lowercase', () => {
    expect(parseMileage('22,945 MI')).toEqual({ value: 22945, unit: 'mi' });
  });

  it('parses space-grouped kilometres (international)', () => {
    expect(parseMileage('Used 2023 Model Y with 12 500 km')).toEqual({ value: 12500, unit: 'km' });
  });

  it('parses EU dot-grouped kilometres', () => {
    expect(parseMileage('12.500 km')).toEqual({ value: 12500, unit: 'km' });
  });

  it('parses an ungrouped number', () => {
    expect(parseMileage('850 mi')).toEqual({ value: 850, unit: 'mi' });
  });

  it('parses a spelled-out "miles" unit (order-page wording)', () => {
    expect(parseMileage('22,945 miles')).toEqual({ value: 22945, unit: 'mi' });
  });

  it('parses spelled-out kilometres, US and intl spelling', () => {
    expect(parseMileage('22,945 kilometers')).toEqual({ value: 22945, unit: 'km' });
    expect(parseMileage('22 945 kilometres')).toEqual({ value: 22945, unit: 'km' });
  });

  it('handles a non-breaking space between number and unit', () => {
    expect(parseMileage('22,945 mi')).toEqual({ value: 22945, unit: 'mi' });
  });

  it('prefers an odometer-labelled figure over EV range on the same page', () => {
    expect(parseMileage('Odometer 22,945 mi · Range (EPA est.) 333 mi')).toEqual({
      value: 22945,
      unit: 'mi',
    });
  });

  it('ignores a range-only figure with no odometer nearby', () => {
    expect(parseMileage('Range (EPA est.) 333 mi')).toEqual({ value: null, unit: null });
  });

  it('returns null on a new listing with a price and year but no odometer', () => {
    expect(parseMileage('Long Range All-Wheel Drive $47,200 2026 Pre-Owned')).toEqual({
      value: null,
      unit: null,
    });
  });

  it('skips estimated range and reads the real odometer', () => {
    expect(parseMileage('Range (EPA est.) 333 mi range with 22,945 mi odometer')).toEqual({
      value: 22945,
      unit: 'mi',
    });
  });

  it('rejects a zero or absurd reading', () => {
    expect(parseMileage('0 mi')).toEqual({ value: null, unit: null });
    expect(parseMileage('600,000 mi')).toEqual({ value: null, unit: null });
  });

  it('returns null for empty or unit-less text', () => {
    expect(parseMileage('')).toEqual({ value: null, unit: null });
    expect(parseMileage('Coming soon')).toEqual({ value: null, unit: null });
  });
});

describe('diffSnapshot', () => {
  it('reports a price drop', () => {
    expect(diffSnapshot(snap(42990), snap(41990))).toBe('price-drop');
  });

  it('reports a price rise', () => {
    expect(diffSnapshot(snap(42990), snap(43990))).toBe('price-rise');
  });

  it('reports no change for equal prices', () => {
    expect(diffSnapshot(snap(42990), snap(42990))).toBe('none');
  });

  it('reports gone when unavailable', () => {
    expect(diffSnapshot(snap(42990), snap(null, 'unavailable'))).toBe('gone');
  });

  it('never reports a change for an unknown (flaky) check', () => {
    expect(diffSnapshot(snap(42990), snap(null, 'unknown'))).toBe('none');
    // even if a stale price is attached to the unknown result
    expect(diffSnapshot(snap(42990), snap(1, 'unknown'))).toBe('none');
  });

  it('reports no change when a price is missing on an available car', () => {
    expect(diffSnapshot(snap(null), snap(42990))).toBe('none');
  });
});

describe('applyCheckResult', () => {
  it('updates latest and records the change, un-acknowledging on a real change', () => {
    const start = car('5YJ3E1EA0PF000001', snap(42990, 'available', 100));
    expect(start.acknowledged).toBe(true);
    const after = applyCheckResult(start, snap(41990, 'available', 200));
    expect(after.latest.price).toBe(41990);
    expect(after.lastChange).toBe('price-drop');
    expect(after.acknowledged).toBe(false);
    expect(after.lastCheckedAt).toBe(200);
  });

  it('leaves acknowledgement untouched when nothing changed', () => {
    const start = { ...car('5YJ3E1EA0PF000001', snap(42990)), acknowledged: true };
    const after = applyCheckResult(start, snap(42990, 'available', 300));
    expect(after.lastChange).toBe('none');
    expect(after.acknowledged).toBe(true);
  });

  it('dedups unchanged observations in history', () => {
    let c = car('5YJ3E1EA0PF000001', snap(42990, 'available', 100));
    c = applyCheckResult(c, snap(42990, 'available', 200));
    c = applyCheckResult(c, snap(42990, 'available', 300));
    expect(c.history).toHaveLength(1);
  });

  it('bounds history to HISTORY_LIMIT', () => {
    let c = car('5YJ3E1EA0PF000001', snap(0, 'available', 0));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      c = applyCheckResult(c, snap(i, 'available', i));
    }
    expect(c.history).toHaveLength(HISTORY_LIMIT);
    expect(c.history.at(-1)?.price).toBe(HISTORY_LIMIT + 5);
  });

  it('does not add an unknown (flaky) observation to history', () => {
    let c = car('7SAYGDEE5PF789500', snap(42990, 'available', 100));
    c = applyCheckResult(c, snap(null, 'unknown', 200));
    expect(c.history).toHaveLength(1);
    expect(c.history.at(-1)?.availability).toBe('available');
  });

  it('still appends a real price change after an unknown check', () => {
    let c = car('7SAYGDEE5PF789500', snap(42990, 'available', 100));
    c = applyCheckResult(c, snap(null, 'unknown', 200));
    c = applyCheckResult(c, snap(41990, 'available', 300));
    expect(c.history).toHaveLength(2);
    expect(c.history.at(-1)?.price).toBe(41990);
  });
});

describe('displayableHistory', () => {
  it('drops unknown (failed-scrape) snapshots so they never render as a bare dash', () => {
    const history = [snap(37700, 'available', 1), snap(null, 'unknown', 2), snap(37200, 'available', 3)];
    expect(displayableHistory(history)).toEqual([history[0], history[2]]);
  });

  it('keeps available and unavailable (Sold) snapshots', () => {
    const history = [snap(34000, 'available', 1), snap(33900, 'available', 2), snap(null, 'unavailable', 3)];
    expect(displayableHistory(history)).toEqual(history);
  });
});

describe('addCar / removeCar', () => {
  it('rejects a duplicate VIN', () => {
    const a = car('5YJ3E1EA0PF000001', snap(42990));
    const res1 = addCar([], a);
    expect(res1.ok).toBe(true);
    const res2 = addCar(res1.ok ? res1.cars : [], car('5YJ3E1EA0PF000001', snap(42990)));
    expect(res2).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('rejects when the list is full', () => {
    const cars = Array.from({ length: MAX_SAVED_CARS }, (_, i) =>
      car(`5YJ3E1EA0PF${String(i).padStart(6, '0')}`, snap(42990)),
    );
    const res = addCar(cars, car('5YJ3E1EA0PF999999', snap(42990)));
    expect(res).toEqual({ ok: false, reason: 'full' });
  });

  it('removes by VIN', () => {
    const cars = [car('5YJ3E1EA0PF000001', snap(1)), car('5YJ3E1EA0PF000002', snap(2))];
    const after = removeCar(cars, '5YJ3E1EA0PF000001');
    expect(after.map((c) => c.vin)).toEqual(['5YJ3E1EA0PF000002']);
  });
});

describe('reorderCars', () => {
  const list = (): SavedCars => [
    car('5YJ3E1EA0PF000001', snap(1)),
    car('5YJ3E1EA0PF000002', snap(2)),
    car('5YJ3E1EA0PF000003', snap(3)),
  ];

  it('moves an item toward the start', () => {
    const after = reorderCars(list(), 2, 0);
    expect(after.map((c) => c.vin)).toEqual([
      '5YJ3E1EA0PF000003',
      '5YJ3E1EA0PF000001',
      '5YJ3E1EA0PF000002',
    ]);
  });

  it('moves an item toward the end', () => {
    const after = reorderCars(list(), 0, 2);
    expect(after.map((c) => c.vin)).toEqual([
      '5YJ3E1EA0PF000002',
      '5YJ3E1EA0PF000003',
      '5YJ3E1EA0PF000001',
    ]);
  });

  it('returns the same reference when from === to', () => {
    const cars = list();
    expect(reorderCars(cars, 1, 1)).toBe(cars);
  });

  it('returns the same reference for out-of-bounds indices', () => {
    const cars = list();
    expect(reorderCars(cars, -1, 1)).toBe(cars);
    expect(reorderCars(cars, 1, 99)).toBe(cars);
    expect(reorderCars(cars, 99, 0)).toBe(cars);
  });
});

describe('dropToIndex', () => {
  // 3-item list [0,1,2]: six move permutations covering before/after halves
  // and adjacent no-ops that collapse to from === to.
  it.each([
    { from: 2, target: 0, placeAfter: false, expected: 0 }, // move up, before
    { from: 2, target: 0, placeAfter: true, expected: 1 }, // move up, after
    { from: 0, target: 2, placeAfter: false, expected: 1 }, // move down, before
    { from: 0, target: 2, placeAfter: true, expected: 2 }, // move down, after
    { from: 1, target: 0, placeAfter: true, expected: 1 }, // adjacent no-op (after 0)
    { from: 0, target: 1, placeAfter: false, expected: 0 }, // adjacent no-op (before 1)
  ])(
    'from=$from target=$target placeAfter=$placeAfter → $expected',
    ({ from, target, placeAfter, expected }) => {
      expect(dropToIndex(from, target, placeAfter)).toBe(expected);
    },
  );
});

describe('changedCount / acknowledgeAll', () => {
  it('counts only unacknowledged changes and clears them on acknowledge', () => {
    let c1 = car('5YJ3E1EA0PF000001', snap(42990, 'available', 100));
    c1 = applyCheckResult(c1, snap(41990, 'available', 200)); // price-drop, unacknowledged
    const c2 = car('5YJ3E1EA0PF000002', snap(50000)); // no change
    const cars = [c1, c2];
    expect(changedCount(cars)).toBe(1);
    const acked = acknowledgeAll(cars);
    expect(changedCount(acked)).toBe(0);
  });
});
