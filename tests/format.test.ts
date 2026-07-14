import { describe, expect, it } from 'vitest';
import { formatCarName, formatCarSubLine, formatHistoryTime, formatHistoryValue, formatPrice, priceSymbol } from '../src/format';
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

describe('formatCarName', () => {
  it('joins year, model, trim', () => {
    expect(formatCarName(makeCar())).toBe('2024 Model Y Long Range All-Wheel Drive');
  });
  it('falls back to the VIN when name fields are all null', () => {
    expect(formatCarName(makeCar({ modelYear: null, model: null, trim: null }))).toBe(
      '7SAYGDEE5PF789500',
    );
  });
});

describe('formatCarSubLine', () => {
  it('joins paint, mileage+unit, and HW with a middle dot', () => {
    expect(formatCarSubLine(makeCar())).toBe('Stealth Grey · 42,000 mi · HW4');
  });
  it('omits mileage when absent', () => {
    expect(formatCarSubLine(makeCar({ mileage: null, mileageUnit: null }))).toBe(
      'Stealth Grey · HW4',
    );
  });
  it('omits paint when absent', () => {
    expect(formatCarSubLine(makeCar({ paintName: null }))).toBe('42,000 mi · HW4');
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
