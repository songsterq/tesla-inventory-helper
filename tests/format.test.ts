import { describe, expect, it } from 'vitest';
import {
  abbreviateTrim,
  formatCarName,
  formatCarNameFull,
  formatCarSubLine,
  formatHistoryTime,
  formatHistoryValue,
  formatPrice,
  formatPriceStatus,
  formatSignedDelta,
  priceHistoryRows,
  priceSymbol,
} from '../src/format';
import type { CarSnapshot, SavedCar } from '../src/savedCars';

function snap(overrides: Partial<CarSnapshot> = {}): CarSnapshot {
  return { price: 46990, currency: 'USD', availability: 'available', at: 0, ...overrides };
}

function makeCar(overrides: Partial<SavedCar> = {}): SavedCar {
  const s = snap();
  return {
    vin: '7SAYGDEE5PF789500',
    url: 'https://www.tesla.com/my/order/7SAYGDEE5PF789500',
    model: 'Model Y',
    modelYear: 2024,
    likelyHw: 'HW4',
    trim: 'Long Range All-Wheel Drive',
    paintName: 'Stealth Grey',
    mileage: 42000,
    mileageUnit: 'mi',
    savedAt: 0,
    baseline: s,
    latest: s,
    history: [s],
    lastChange: 'none',
    lastCheckedAt: null,
    acknowledged: true,
    ...overrides,
  };
}

describe('priceSymbol', () => {
  it('maps known currencies and blanks unknown/null', () => {
    expect(priceSymbol('USD')).toBe('$');
    expect(priceSymbol('EUR')).toBe('€');
    expect(priceSymbol('ZZZ')).toBe('');
    expect(priceSymbol(null)).toBe('');
  });
});

describe('formatPrice', () => {
  it('prefixes the symbol and groups digits', () => {
    expect(formatPrice(snap({ price: 46990, currency: 'USD' }))).toBe('$46,990');
  });
  it('renders an em dash when price is null', () => {
    expect(formatPrice(snap({ price: null }))).toBe('—');
  });
});

describe('abbreviateTrim', () => {
  it('shortens common drive and range phrases', () => {
    expect(abbreviateTrim('Long Range All-Wheel Drive')).toBe('LR AWD');
    expect(abbreviateTrim('Long Range Rear-Wheel Drive')).toBe('LR RWD');
    expect(abbreviateTrim('Premium All-Wheel Drive')).toBe('Premium AWD');
    expect(abbreviateTrim('Performance All-Wheel Drive')).toBe('Performance AWD');
  });

  it('shortens Standard Range alongside Long Range', () => {
    expect(abbreviateTrim('Standard Range Rear-Wheel Drive')).toBe('SR RWD');
    expect(abbreviateTrim('Standard Range')).toBe('SR');
  });

  it('is case-insensitive and leaves unknown phrases alone', () => {
    expect(abbreviateTrim('long range rear-wheel drive')).toBe('LR RWD');
    expect(abbreviateTrim('Cyberbeast')).toBe('Cyberbeast');
  });

  // Guards against a future rule (say Range → R) that would chew through text it
  // had already shortened. Also covers the shared regexes not carrying lastIndex.
  it('is idempotent', () => {
    for (const trim of [
      'Long Range All-Wheel Drive',
      'Standard Range Rear-Wheel Drive',
      'Premium All-Wheel Drive',
    ]) {
      const once = abbreviateTrim(trim);
      expect(abbreviateTrim(once)).toBe(once);
    }
  });

  it('gives the same result when called repeatedly', () => {
    expect(abbreviateTrim('Long Range All-Wheel Drive')).toBe('LR AWD');
    expect(abbreviateTrim('Long Range All-Wheel Drive')).toBe('LR AWD');
  });
});

describe('formatCarName', () => {
  it('joins year, model, and abbreviated trim', () => {
    expect(formatCarName(makeCar())).toBe('2024 Model Y LR AWD');
  });
  it('falls back to the VIN when name fields are all null', () => {
    expect(formatCarName(makeCar({ modelYear: null, model: null, trim: null }))).toBe(
      '7SAYGDEE5PF789500',
    );
  });
});

describe('formatCarNameFull', () => {
  // The popup uses this for aria-labels and the title tooltip: abbreviations fix a
  // visual width problem screen readers don't have, and "LR AWD" reads badly aloud.
  it('spells the trim out', () => {
    expect(formatCarNameFull(makeCar())).toBe('2024 Model Y Long Range All-Wheel Drive');
    expect(formatCarNameFull(makeCar({ trim: 'Standard Range Rear-Wheel Drive' }))).toBe(
      '2024 Model Y Standard Range Rear-Wheel Drive',
    );
  });
  it('falls back to the VIN like the short form does', () => {
    expect(formatCarNameFull(makeCar({ modelYear: null, model: null, trim: null }))).toBe(
      '7SAYGDEE5PF789500',
    );
  });
});

describe('formatCarSubLine', () => {
  it('joins paint, mileage+unit, plant, and HW with a middle dot', () => {
    expect(formatCarSubLine(makeCar())).toBe('Stealth Grey · 42,000 mi · Fremont · HW4');
  });
  it('omits mileage when absent', () => {
    expect(formatCarSubLine(makeCar({ mileage: null, mileageUnit: null }))).toBe(
      'Stealth Grey · Fremont · HW4',
    );
  });
  it('omits paint when absent', () => {
    expect(formatCarSubLine(makeCar({ paintName: null }))).toBe('42,000 mi · Fremont · HW4');
  });
  // Plant comes from the VIN, not a stored field, so it tracks whatever VIN the car has.
  it('reads the plant off the VIN rather than the stored record', () => {
    expect(formatCarSubLine(makeCar({ vin: '7SAYGAEE2PA200000' }))).toBe(
      'Stealth Grey · 42,000 mi · Austin · HW4',
    );
    expect(formatCarSubLine(makeCar({ vin: 'LRWYGCEK7RR000001' }))).toBe(
      'Stealth Grey · 42,000 mi · Shanghai · HW4',
    );
  });
  it('omits the plant when the VIN does not decode', () => {
    expect(formatCarSubLine(makeCar({ vin: 'NOTATESLAVIN00000' }))).toBe(
      'Stealth Grey · 42,000 mi · HW4',
    );
  });
});

describe('formatHistoryValue', () => {
  it('shows the formatted price for an available snapshot', () => {
    expect(formatHistoryValue(snap({ price: 39000, currency: 'USD' }))).toBe('$39,000');
  });

  it('shows "Sold" for an unavailable snapshot', () => {
    expect(formatHistoryValue(snap({ availability: 'unavailable', price: null }))).toBe('Sold');
  });

  it('shows a dash when an available snapshot has no price', () => {
    expect(formatHistoryValue(snap({ price: null, currency: null }))).toBe('—');
  });

  it('shows "Sold" even when an unavailable snapshot has a stale price', () => {
    expect(formatHistoryValue(snap({ availability: 'unavailable', price: 39000 }))).toBe('Sold');
  });
});

describe('formatHistoryTime', () => {
  it('renders a date-and-time label containing the day and a time separator', () => {
    // Noon UTC keeps the calendar day stable across common test timezones.
    const at = Date.UTC(2026, 6, 10, 12, 34); // 2026-07-10T12:34Z
    const out = formatHistoryTime(at);
    expect(out).toContain('10');
    expect(out).toMatch(/\d:\d{2}/);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('formatSignedDelta', () => {
  it('signs with a real minus sign and groups digits', () => {
    expect(formatSignedDelta(-500, 'USD')).toBe('\u2212$500');
    expect(formatSignedDelta(1000, 'USD')).toBe('+$1,000');
  });
  it('uses the currency symbol, or none when unknown', () => {
    expect(formatSignedDelta(-500, 'EUR')).toBe('\u2212€500');
    expect(formatSignedDelta(-500, null)).toBe('\u2212500');
  });
});

describe('formatPriceStatus', () => {
  it('reports a drop since tracked', () => {
    const car = makeCar({ latest: snap({ price: 46490 }) });
    expect(formatPriceStatus(car)).toEqual({ text: '\u2212$500', cls: 'down' });
  });
  it('reports a rise since tracked', () => {
    const car = makeCar({ latest: snap({ price: 47990 }) });
    expect(formatPriceStatus(car)).toEqual({ text: '+$1,000', cls: 'up' });
  });
  it('lets Sold win over a price difference', () => {
    const car = makeCar({ latest: snap({ price: 40000, availability: 'unavailable' }) });
    expect(formatPriceStatus(car)).toEqual({ text: 'Sold', cls: 'gone' });
  });
  it("takes the symbol from the latest snapshot's currency", () => {
    const car = makeCar({ latest: snap({ price: 46490, currency: 'CAD' }) });
    expect(formatPriceStatus(car).text).toBe('\u2212CA$500');
  });
  it('says nothing before the first check and "No change" after', () => {
    expect(formatPriceStatus(makeCar())).toEqual({ text: '', cls: 'idle' });
    expect(formatPriceStatus(makeCar({ lastCheckedAt: 1 }))).toEqual({
      text: 'No change',
      cls: 'idle',
    });
  });
  it('treats an unknown baseline price as no change', () => {
    const car = makeCar({ baseline: snap({ price: null }), lastCheckedAt: 1 });
    expect(formatPriceStatus(car)).toEqual({ text: 'No change', cls: 'idle' });
  });
});

describe('priceHistoryRows', () => {
  const at = (n: number, overrides: Partial<CarSnapshot> = {}) => snap({ at: n, ...overrides });

  it('shows a lone baseline as the tracked row', () => {
    const base = at(1);
    expect(priceHistoryRows(makeCar({ baseline: base, history: [base] }))).toEqual([
      { at: 1, value: '$46,990', delta: 'Tracked', cls: 'base' },
    ]);
  });

  it('lists changes newest first, each against the one before', () => {
    const history = [at(1), at(2, { price: 46490 }), at(3, { price: 45990 })];
    expect(priceHistoryRows(makeCar({ history }))).toEqual([
      { at: 3, value: '$45,990', delta: '\u2212$500', cls: 'down' },
      { at: 2, value: '$46,490', delta: '\u2212$500', cls: 'down' },
      { at: 1, value: '$46,990', delta: 'Tracked', cls: 'base' },
    ]);
  });

  it('marks a rise', () => {
    const rows = priceHistoryRows(makeCar({ history: [at(1), at(2, { price: 47990 })] }));
    expect(rows[0]).toEqual({ at: 2, value: '$47,990', delta: '+$1,000', cls: 'up' });
  });

  it('shows a sale as Sold with no delta', () => {
    const history = [at(1), at(2, { availability: 'unavailable', price: null })];
    expect(priceHistoryRows(makeCar({ history }))[0]).toEqual({
      at: 2,
      value: 'Sold',
      delta: '',
      cls: 'gone',
    });
  });

  it('caps at seven rows and gives the oldest shown row a real delta', () => {
    const history = Array.from({ length: 10 }, (_, i) => at(i, { price: 50000 - i * 100 }));
    const rows = priceHistoryRows(makeCar({ history }));
    expect(rows).toHaveLength(7);
    expect(rows[0]?.at).toBe(9);
    expect(rows[6]?.at).toBe(3);
    expect(rows[6]).toMatchObject({ delta: '\u2212$100', cls: 'down' });
    expect(rows.some((r) => r.delta === 'Tracked')).toBe(false);
    expect(priceHistoryRows(makeCar({ history }), 3)).toHaveLength(3);
  });

  it('skips legacy unknown entries and diffs across the gap', () => {
    const history = [
      at(1),
      at(2, { availability: 'unknown', price: null, currency: null }),
      at(3, { price: 46490 }),
    ];
    expect(priceHistoryRows(makeCar({ history }))).toEqual([
      { at: 3, value: '$46,490', delta: '\u2212$500', cls: 'down' },
      { at: 1, value: '$46,990', delta: 'Tracked', cls: 'base' },
    ]);
  });

  it('falls back to the baseline when every entry is unknown', () => {
    const base = at(1);
    const car = makeCar({
      baseline: base,
      history: [at(2, { availability: 'unknown', price: null })],
    });
    expect(priceHistoryRows(car)).toEqual([
      { at: 1, value: '$46,990', delta: 'Tracked', cls: 'base' },
    ]);
  });

  it('leaves the delta blank around an entry with no price', () => {
    const history = [at(1), at(2, { price: null }), at(3, { price: 45990 })];
    expect(priceHistoryRows(makeCar({ history }))).toEqual([
      { at: 3, value: '$45,990', delta: '', cls: 'idle' },
      { at: 2, value: '—', delta: '', cls: 'idle' },
      { at: 1, value: '$46,990', delta: 'Tracked', cls: 'base' },
    ]);
  });

  it('does not mutate the stored history', () => {
    const history = [at(1), at(2, { price: 46490 })];
    const copy = structuredClone(history);
    priceHistoryRows(makeCar({ history }));
    expect(history).toEqual(copy);
  });
});
