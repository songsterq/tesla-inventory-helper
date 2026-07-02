import { describe, expect, it } from 'vitest';
import { extractVinFromOrderPath, isSoldRedirect } from '../src/vin';

const VIN = '7SAYGDEE1PF814618';

describe('isSoldRedirect', () => {
  it('is false while still on the car\'s own US order page', () => {
    expect(isSoldRedirect(`https://www.tesla.com/m3/order/${VIN}`, VIN)).toBe(false);
  });

  it('is false while still on the car\'s own locale-prefixed order page', () => {
    expect(isSoldRedirect(`https://www.tesla.com/my/order/${VIN}?range=200`, VIN)).toBe(false);
  });

  it('is true when bounced to the used-inventory listing (sold used car)', () => {
    expect(
      isSoldRedirect('https://www.tesla.com/inventory/used/my?range=200&PaymentType=cash', VIN),
    ).toBe(true);
  });

  it('is true when bounced to a new-inventory listing', () => {
    expect(isSoldRedirect('https://www.tesla.com/inventory/new/my', VIN)).toBe(true);
  });

  it('is false for a non-inventory redirect (login/error) — stays unknown, never fabricated gone', () => {
    expect(isSoldRedirect('https://www.tesla.com/login', VIN)).toBe(false);
  });

  it('is false for an unparseable URL', () => {
    expect(isSoldRedirect('not a url', VIN)).toBe(false);
  });

  it('is false on another VIN\'s order page (not an inventory listing)', () => {
    expect(isSoldRedirect('https://www.tesla.com/my/order/5YJ3E1EA7PF000000', VIN)).toBe(false);
  });
});

describe('extractVinFromOrderPath (redirect target has no order VIN)', () => {
  it('returns null for an inventory listing path', () => {
    expect(extractVinFromOrderPath('/inventory/used/my')).toBeNull();
  });
});
