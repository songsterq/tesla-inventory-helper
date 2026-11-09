import { describe, expect, it } from 'vitest';
import { buildChangeNotification, buildSearchAlertNotifications, toRunChange, type RunChange } from '../src/notify';
import type { CarSummary } from '../src/inventoryCar';
import { searchLabel, type SavedSearch } from '../src/savedSearches';
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
    expect(n!.title).toBe('2024 Model Y LR');
    expect(n!.message).toBe('Price dropped $1,400 → $45,590');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · Fremont · HW4');
    expect(n!.target).toEqual({ kind: 'url', url: car.url });
  });

  it('builds a single-car gone notification', () => {
    const car = makeCar({ latest: snap({ availability: 'unavailable' }) });
    const changes: RunChange[] = [{ car, change: 'gone', prevPrice: 46990 }];

    const n = buildChangeNotification(changes);

    expect(n!.message).toBe('No longer listed');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · Fremont · HW4');
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

describe('toRunChange', () => {
  it('returns a RunChange for a price-drop result, using the existing car latest price', () => {
    const existing = makeCar({ latest: snap({ price: 46990 }) });
    const result = makeCar({ lastChange: 'price-drop', latest: snap({ price: 45590 }) });

    const change = toRunChange(existing, result);

    expect(change).toEqual({ car: result, change: 'price-drop', prevPrice: 46990 });
  });

  it('returns a RunChange for a fresh transition to gone (existing was available)', () => {
    const existing = makeCar({ latest: snap({ availability: 'available' }) });
    const result = makeCar({ lastChange: 'gone', latest: snap({ availability: 'unavailable' }) });

    const change = toRunChange(existing, result);

    expect(change).toEqual({ car: result, change: 'gone', prevPrice: existing.latest.price });
  });

  it('returns null for sticky gone (existing already unavailable)', () => {
    const existing = makeCar({ latest: snap({ availability: 'unavailable' }) });
    const result = makeCar({ lastChange: 'gone', latest: snap({ availability: 'unavailable' }) });

    expect(toRunChange(existing, result)).toBeNull();
  });

  it('returns a RunChange for a newly confirmed sold car (existing was unknown)', () => {
    const existing = makeCar({ latest: snap({ availability: 'unknown' }) });
    const result = makeCar({ lastChange: 'gone', latest: snap({ availability: 'unavailable' }) });

    const change = toRunChange(existing, result);

    expect(change).toEqual({ car: result, change: 'gone', prevPrice: existing.latest.price });
  });

  it('returns null when lastChange is none', () => {
    const existing = makeCar();
    const result = makeCar({ lastChange: 'none' });

    expect(toRunChange(existing, result)).toBeNull();
  });

  it('returns null when lastChange is price-rise', () => {
    const existing = makeCar({ latest: snap({ price: 40000 }) });
    const result = makeCar({ lastChange: 'price-rise', latest: snap({ price: 41000 }) });

    expect(toRunChange(existing, result)).toBeNull();
  });
});

const alertSearch = (overrides: Partial<SavedSearch> = {}): SavedSearch => ({
  id: 'abc123ef', name: '', description: 'New Model Y, Premium AWD',
  url: 'https://www.tesla.com/inventory/new/my', condition: 'new',
  ranges: {}, createdAt: 0, alerts: true, ...overrides,
});
const summaryCar = (overrides: Partial<CarSummary> = {}): CarSummary => ({
  key: '230_2df0b2b503fecb0921d4a5dc9f254b50',
  orderId: '7SAY230_2df0b2b503fecb0921d4a5dc9f254b50',
  year: 2027, model: 'Model Y', trim: 'Premium All-Wheel Drive', price: 53490, currency: 'USD',
  paint: 'Stealth Grey', wheels: '19’’ Crossflow Wheels', interior: 'All Black Premium Interior',
  seats: 'Seven Seat Layout', towHitch: true, odometer: 42000, ...overrides,
});
const searchInput = (search = alertSearch(), cars = [summaryCar()]) => ({
  search, label: searchLabel(search), cars,
});

describe('buildSearchAlertNotifications', () => {
  it('skips empty arrivals and searches with alerts off or absent', () => {
    expect(buildSearchAlertNotifications([])).toEqual([]);
    expect(buildSearchAlertNotifications([
      searchInput(alertSearch(), []),
      searchInput(alertSearch({ alerts: false })),
      searchInput(alertSearch({ alerts: undefined })),
    ])).toEqual([]);
  });

  it('announces one new car with full configuration, Tow Hitch, and its masked order URL', () => {
    const car = summaryCar();
    expect(buildSearchAlertNotifications([searchInput()])).toEqual([{
      id: `tih:match:abc123ef:${car.orderId}`,
      title: 'New match · New Model Y, Premium AWD',
      message: '2027 Model Y Premium All-Wheel Drive · $53,490',
      contextMessage: 'Stealth Grey · 19’’ Crossflow Wheels · All Black Premium Interior · Seven Seat Layout · Tow Hitch',
      target: { kind: 'url', url: `https://www.tesla.com/my/order/${car.orderId}?titleStatus=new&redirect=no` },
    }]);
  });

  it('shows mileage only for a used search, including zero', () => {
    const search = alertSearch({ condition: 'used', url: 'https://www.tesla.com/inventory/used/my' });
    expect(buildSearchAlertNotifications([searchInput(search)])[0]?.message).toBe(
      '2027 Model Y Premium All-Wheel Drive · $53,490 · 42,000 mi',
    );
    expect(buildSearchAlertNotifications([searchInput(search, [summaryCar({ odometer: 0 })])])[0]?.message).toContain(' · 0 mi');
    expect(buildSearchAlertNotifications([searchInput(search, [summaryCar({ odometer: null })])])[0]?.message).toBe(
      '2027 Model Y Premium All-Wheel Drive · $53,490',
    );
  });

  it('uses the saved URL locale for distance and the existing currency symbols', () => {
    const search = alertSearch({ condition: 'used', url: 'https://www.tesla.com/en_CA/inventory/used/my' });
    expect(buildSearchAlertNotifications([searchInput(search, [summaryCar({ currency: 'CAD' })])])[0]?.message).toBe(
      '2027 Model Y Premium All-Wheel Drive · CA$53,490 · 42,000 km',
    );
  });

  it('skips null parts cleanly and omits Tow Hitch when absent', () => {
    const car = summaryCar({ year: null, trim: null, price: null, paint: null, wheels: null, seats: null, towHitch: false });
    const n = buildSearchAlertNotifications([searchInput(alertSearch({ name: 'My next car' }), [car])])[0]!;
    expect(n.title).toBe('New match · My next car');
    expect(n.message).toBe('Model Y');
    expect(n.contextMessage).toBe('All Black Premium Interior');
    const empty = summaryCar({ year: null, model: null, trim: null, price: null,
      paint: null, wheels: null, interior: null, seats: null, towHitch: false });
    const sparse = buildSearchAlertNotifications([searchInput(alertSearch(), [empty])])[0]!;
    expect(sparse.message).toBe('');
    expect(sparse.contextMessage).toBe('');
  });

  it('keeps a zero price and handles unknown currency without a fabricated symbol', () => {
    expect(buildSearchAlertNotifications([searchInput(alertSearch(), [summaryCar({ price: 0, currency: null })])])[0]?.message).toBe(
      '2027 Model Y Premium All-Wheel Drive · 0',
    );
  });

  it('summarizes several cars in at most three car lines and targets the saved search', () => {
    const cars = [summaryCar(), summaryCar({ trim: 'RWD', paint: null, price: 41990 })];
    expect(buildSearchAlertNotifications([searchInput(alertSearch(), cars)])).toEqual([{
      id: 'tih:matches:abc123ef', title: '2 new matches · New Model Y, Premium AWD',
      message: 'Premium All-Wheel Drive · Stealth Grey · $53,490\nRWD · $41,990',
      target: { kind: 'search', searchId: 'abc123ef' },
    }]);
    const many = buildSearchAlertNotifications([searchInput(alertSearch(), Array.from({ length: 5 }, () => summaryCar()))])[0]!;
    expect(many.title).toBe('5 new matches · New Model Y, Premium AWD');
    expect(many.message.split('\n')).toEqual([
      'Premium All-Wheel Drive · Stealth Grey · $53,490',
      'Premium All-Wheel Drive · Stealth Grey · $53,490',
      'Premium All-Wheel Drive · Stealth Grey · $53,490',
      '+2 more',
    ]);
    expect(buildSearchAlertNotifications([searchInput(alertSearch(), [...cars, summaryCar()])])[0]?.message).not.toContain('more');
  });

  it('builds one notification per search with arrivals', () => {
    const ns = buildSearchAlertNotifications([
      searchInput(), searchInput(alertSearch({ id: 'second' })), searchInput(alertSearch({ id: 'empty' }), []),
    ]);
    expect(ns).toHaveLength(2);
    expect(ns[1]?.id).toContain('tih:match:second:');
  });

  it.each(['invalid', 'https://www.tesla.com/inventory/new/'])('targets the popup when the order URL cannot be built: %s', (url) => {
    expect(buildSearchAlertNotifications([searchInput(alertSearch({ url }))])[0]?.target).toEqual({ kind: 'popup' });
  });
});
