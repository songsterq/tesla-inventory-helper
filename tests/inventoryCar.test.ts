import { describe, expect, it } from 'vitest';
import { isCarSummary, parseInventoryCar } from '../src/inventoryCar';

const HASH = '230_2df0b2b503fecb0921d4a5dc9f254b50';
const NEW = {
  VIN: `7SAY${HASH}`, Hash: HASH, Year: 2027, Price: 41990, CurrencyCode: 'USD',
  TrimName: 'All-Wheel Drive', TRIM: ['MY_AWD'], PAINT: ['GREY'], Odometer: 0, TitleStatus: 'NEW',
  OptionCodeData: [
    { group: 'MODEL', code: '$MDLY', name: 'Model Y' },
    { group: 'TRIM', code: '$MTY77', name: 'All-Wheel Drive' },
    { group: 'PAINT', code: '$PN01', name: 'Stealth Grey' },
    { group: 'WHEELS', code: '$WY18P', name: '18’’ Aperture Wheels' },
    { group: 'INTERIOR', code: '$IBB6', name: 'All Black Interior' },
    { group: 'REAR_SEATS', code: '$STY5B', name: 'Five Seat Layout' },
    { group: 'TOWING', code: '$TW01', name: 'Tow Hitch' },
    { group: 'SPECS_TOWING', code: '$MTY77' },
  ],
};
const USED = {
  VIN: '5YJYGDEE2MF162116', Year: 2021, Price: 27900, Odometer: 91331,
  TitleStatus: 'USED', TrimName: 'Long Range All-Wheel Drive',
  OptionCodeData: [
    { group: 'TRIM', name: 'Long Range All-Wheel Drive' },
    { group: 'PAINT', name: 'Pearl White Multi-Coat' },
    { group: 'WHEELS', name: '19’’ Gemini Light Wheels' },
    { group: 'INTERIOR', name: 'All Black Premium Interior' },
    { group: 'REAR_SEATS', name: 'Five Seat Layout' },
  ],
};

describe('parseInventoryCar', () => {
  it('uses the listing hash for a masked new car and keeps its order ID verbatim', () => {
    expect(parseInventoryCar(NEW)).toEqual({
      key: HASH, orderId: NEW.VIN, model: 'Model Y', year: 2027,
      trim: 'All-Wheel Drive', paint: 'Stealth Grey', wheels: '18’’ Aperture Wheels',
      interior: 'All Black Interior', seats: 'Five Seat Layout', towHitch: true,
      price: 41990, currency: 'USD', odometer: 0,
    });
  });

  it('reads a used car without a Hash field', () => {
    expect(parseInventoryCar(USED)).toEqual({
      key: USED.VIN, orderId: USED.VIN, model: null, year: 2021,
      trim: 'Long Range All-Wheel Drive', paint: 'Pearl White Multi-Coat',
      wheels: '19’’ Gemini Light Wheels', interior: 'All Black Premium Interior',
      seats: 'Five Seat Layout', towHitch: false, price: 27900, currency: null, odometer: 91331,
    });
  });

  it('prefers a real VIN, normalizes only the key, and ignores an irrelevant Hash', () => {
    const orderId = USED.VIN.toLowerCase();
    expect(parseInventoryCar({ VIN: orderId, Hash: HASH })).toMatchObject({ key: USED.VIN, orderId });
  });

  it('tolerates missing options and falls back to TrimName', () => {
    expect(parseInventoryCar({ VIN: USED.VIN, TrimName: '長續航全輪驅動' })).toEqual({
      key: USED.VIN, orderId: USED.VIN, model: null, year: null, trim: '長續航全輪驅動',
      paint: null, wheels: null, interior: null, seats: null, towHitch: false,
      price: null, currency: null, odometer: null,
    });
    expect(parseInventoryCar({ ...NEW, TrimName: 'fallback' })?.trim).toBe('All-Wheel Drive');
  });

  it('leaves wrong types unknown without coercion or throwing', () => {
    expect(parseInventoryCar({
      VIN: USED.VIN, Year: '2021', Price: Infinity, CurrencyCode: 123,
      TrimName: [], Odometer: NaN, TitleStatus: 'used',
      OptionCodeData: [null, false, {}, { group: 'PAINT', name: 3 }, { group: 'SPECS_TOWING' }],
    })).toMatchObject({ year: null, price: null, currency: null, trim: null, odometer: null, paint: null, towHitch: false });
    for (const OptionCodeData of [undefined, null, {}, 'bad']) {
      expect(parseInventoryCar({ VIN: USED.VIN, OptionCodeData })?.towHitch).toBe(false);
    }
  });

  it('detects towing by group presence, even without a name', () => {
    expect(parseInventoryCar({ VIN: USED.VIN, OptionCodeData: [{ group: 'TOWING' }] })?.towHitch).toBe(true);
  });

  it('keeps finite odometers regardless of undocumented TitleStatus values', () => {
    for (const TitleStatus of ['new', 'NEW', 'used', 'unknown', null, 123, undefined]) {
      expect(parseInventoryCar({ ...USED, TitleStatus })?.odometer).toBe(91331);
      expect(parseInventoryCar({ ...NEW, TitleStatus })?.odometer).toBe(0);
    }
    expect(parseInventoryCar({ ...USED, Odometer: -1 })?.odometer).toBe(-1);
    for (const Odometer of [Infinity, -Infinity, NaN, '91331', null, undefined]) {
      expect(parseInventoryCar({ ...USED, Odometer })?.odometer).toBeNull();
    }
  });

  it('rejects missing, mismatched, malformed and unsafe identities', () => {
    for (const record of [null, [], 42, {}, { VIN: 'IOQ00000000000000' },
      { ...NEW, Hash: undefined }, { ...NEW, Hash: HASH.toUpperCase() },
      { ...NEW, VIN: `7SAY231_${'a'.repeat(32)}` },
      { ...NEW, VIN: `../${HASH}` }, { ...NEW, VIN: `7SAY?${HASH}` },
      { ...NEW, VIN: 'A'.repeat(49 - HASH.length) + HASH },
    ]) expect(parseInventoryCar(record)).toBeNull();
  });
});

describe('isCarSummary', () => {
  it('accepts serialized summaries and rejects invalid fields or mismatched identity', () => {
    for (const record of [NEW, USED]) {
      const car = parseInventoryCar(record)!;
      expect(isCarSummary(JSON.parse(JSON.stringify(car)))).toBe(true);
      for (const invalid of [null, {}, record, { ...car, key: 'garbage' },
        { ...car, orderId: '../unsafe' }, { ...car, price: Infinity },
        { ...car, model: 123 }, { ...car, seats: undefined }, { ...car, towHitch: null },
      ]) expect(isCarSummary(invalid)).toBe(false);
    }
  });
});
