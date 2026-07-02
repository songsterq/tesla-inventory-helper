import { describe, expect, it } from 'vitest';
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from '../src/format';
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
