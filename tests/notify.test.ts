import { describe, expect, it } from 'vitest';
import { buildChangeNotification, type RunChange } from '../src/notify';
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
    trim: 'Long Range',
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

describe('buildChangeNotification', () => {
  it('returns null when there are no changes', () => {
    expect(buildChangeNotification([])).toBeNull();
  });

  it('builds a single-car price-drop notification with the sub-line as context', () => {
    const car = makeCar({ latest: snap({ price: 45590, currency: 'USD' }) });
    const changes: RunChange[] = [{ car, change: 'price-drop', prevPrice: 46990 }];

    const n = buildChangeNotification(changes);

    expect(n).not.toBeNull();
    expect(n!.id).toBe('tih:car:7SAYGDEE5PF789500');
    expect(n!.title).toBe('2024 Model Y Long Range');
    expect(n!.message).toBe('Price dropped $1,400 → $45,590');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · HW4');
    expect(n!.target).toEqual({ kind: 'url', url: car.url });
  });

  it('builds a single-car gone notification', () => {
    const car = makeCar({ latest: snap({ availability: 'unavailable' }) });
    const changes: RunChange[] = [{ car, change: 'gone', prevPrice: 46990 }];

    const n = buildChangeNotification(changes);

    expect(n!.message).toBe('No longer listed');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · HW4');
    expect(n!.target).toEqual({ kind: 'url', url: car.url });
  });

  it('handles a drop with an unknown previous price (no delta)', () => {
    const car = makeCar({ latest: snap({ price: 45590 }) });
    const changes: RunChange[] = [{ car, change: 'price-drop', prevPrice: null }];

    expect(buildChangeNotification(changes)!.message).toBe('Price dropped → $45,590');
  });

  it('falls back to the VIN for the title when name fields are null', () => {
    const car = makeCar({ modelYear: null, model: null, trim: null });
    const changes: RunChange[] = [{ car, change: 'gone', prevPrice: null }];

    expect(buildChangeNotification(changes)!.title).toBe('7SAYGDEE5PF789500');
  });

  it('summarizes multiple changes and targets the popup', () => {
    const a = makeCar({ vin: 'AAA', model: 'Model 3', trim: 'RWD' });
    const b = makeCar({ vin: 'BBB', model: 'Model Y', trim: 'LR' });
    const changes: RunChange[] = [
      { car: a, change: 'price-drop', prevPrice: 40000 },
      { car: b, change: 'gone', prevPrice: 46990 },
    ];

    const n = buildChangeNotification(changes);

    expect(n!.id).toBe('tih:summary');
    expect(n!.title).toBe('2 watched cars changed');
    expect(n!.message).toBe('2024 Model 3 RWD, 2024 Model Y LR');
    expect(n!.contextMessage).toBeUndefined();
    expect(n!.target).toEqual({ kind: 'popup' });
  });
});
