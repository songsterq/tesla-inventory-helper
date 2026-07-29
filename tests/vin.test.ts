import { describe, expect, it } from 'vitest';
import {
  extractVinFromOrderPath,
  isSoldRedirect,
  isUsedInventoryPath,
  isUsedOrderUrl,
} from '../src/vin';

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

describe('isUsedInventoryPath', () => {
  it('is true for US and locale-prefixed used inventory paths', () => {
    expect(isUsedInventoryPath('/inventory/used/my')).toBe(true);
    expect(isUsedInventoryPath('/en_CA/inventory/used/my')).toBe(true);
    expect(isUsedInventoryPath('/inventory/used')).toBe(true);
  });

  it('is false for new inventory, bare inventory, and unrelated paths', () => {
    expect(isUsedInventoryPath('/inventory/new/my')).toBe(false);
    expect(isUsedInventoryPath('/inventory/my')).toBe(false);
    expect(isUsedInventoryPath('/my/order/' + VIN)).toBe(false);
    expect(isUsedInventoryPath(null)).toBe(false);
    expect(isUsedInventoryPath('')).toBe(false);
  });
});

describe('isUsedOrderUrl', () => {
  it('is true when titleStatus=used', () => {
    expect(
      isUsedOrderUrl(
        `https://www.tesla.com/my/order/${VIN}?range=200&titleStatus=used&redirect=no`,
      ),
    ).toBe(true);
  });

  it('is false when titleStatus=new (even with a VIN-looking path)', () => {
    expect(
      isUsedOrderUrl(
        `https://www.tesla.com/my/order/${VIN}?range=200&titleStatus=new&redirect=no`,
      ),
    ).toBe(false);
    expect(
      isUsedOrderUrl(
        'https://www.tesla.com/my/order/7SAY238_bf98b6663c5453c1a6a56e7b47161285?titleStatus=new',
      ),
    ).toBe(false);
  });

  it('compares titleStatus case-insensitively', () => {
    expect(isUsedOrderUrl(`/my/order/${VIN}?titleStatus=NEW`)).toBe(false);
    expect(isUsedOrderUrl(`/my/order/7SAY238_abc?titleStatus=Used`)).toBe(true);
  });

  it('when titleStatus is missing, is true only if the path has a real VIN', () => {
    expect(isUsedOrderUrl(`https://www.tesla.com/my/order/${VIN}`)).toBe(true);
    expect(isUsedOrderUrl(`/m3/order/${VIN}`)).toBe(true);
    expect(
      isUsedOrderUrl(
        'https://www.tesla.com/my/order/7SAY238_bf98b6663c5453c1a6a56e7b47161285',
      ),
    ).toBe(false);
    expect(isUsedOrderUrl('/my/order/SHORT')).toBe(false);
  });

  it('is false for null/unparseable input', () => {
    expect(isUsedOrderUrl(null)).toBe(false);
    expect(isUsedOrderUrl('')).toBe(false);
    expect(isUsedOrderUrl('http://[')).toBe(false);
  });
});

describe('content script used-only gating', () => {
  it('imports and calls the used-page helpers in apply()', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../entrypoints/content/index.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('isUsedInventoryPath');
    expect(src).toContain('isUsedOrderUrl');
    expect(src).toContain('clearMonitorUi');
  });
});
