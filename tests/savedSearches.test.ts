import { describe, expect, it } from 'vitest';
import {
  addSearch,
  byteSize,
  clampRange,
  compactAmount,
  conditionFromPath,
  createSavedSearch,
  describeView,
  defaultName,
  findDuplicate,
  groupsFromUrl,
  isInventoryListingPath,
  isSameSearchUrl,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SAVED_SEARCHES,
  normalizeSearchUrl,
  parseDigits,
  planRangeWrites,
  rangeWriteSettled,
  removeSearch,
  renameSearch,
  searchLabel,
  searchLabelShort,
  SYNC_ITEM_BUDGET_BYTES,
  userSetRanges,
  type CapturedRange,
  type CapturedView,
  type SavedSearch,
  type SavedSearches,
} from '../src/savedSearches';

const range = (min: number, max: number, boundMin: number, boundMax: number): CapturedRange => ({
  min,
  max,
  boundMin,
  boundMax,
});

// The example from the design brief: a used Model Y with two trims, cash price
// 25k–35k, 5k–30k miles, 2023+, Autosteer, clean history, price ascending.
const fullView = (): CapturedView => ({
  condition: 'used',
  model: 'Model Y',
  paymentType: 'cash',
  groups: [
    { key: 'TRIM', title: 'Trim', labels: ['Long Range All-Wheel Drive', 'Performance All-Wheel Drive'] },
    { key: 'DemoDrive', title: 'Demo Drive', labels: [] },
    { key: 'AUTOPILOT', title: 'Self-Driving', labels: ['Autosteer'] },
    { key: 'VehicleHistory', title: 'Condition', labels: ['No Reported Accidents/Damage'] },
  ],
  ranges: {
    paymentRange: range(25000, 35000, 25000, 50000),
    Odometer: range(5000, 30000, 2000, 98000),
    Year: range(2023, 2026, 2020, 2026),
  },
  currencySymbol: '$',
  distanceUnit: 'mi',
  sort: 'plh',
  zip: '98052',
  range: 200,
});

const HREF = 'https://www.tesla.com/inventory/used/my?arrangeby=plh&zip=98052&range=200&TRIM=MY_LR_AWD,MY_P_AWD';

const search = (id: string, overrides: Partial<SavedSearch> = {}): SavedSearch => ({
  id,
  name: `Search ${id}`,
  description: 'Used Model Y',
  url: `https://www.tesla.com/inventory/used/my?id=${id}`,
  condition: 'used',
  ranges: {},
  createdAt: 1000,
  ...overrides,
});

describe('isInventoryListingPath / conditionFromPath', () => {
  it('matches used and new listing paths, with or without a locale prefix', () => {
    expect(isInventoryListingPath('/inventory/used/my')).toBe(true);
    expect(isInventoryListingPath('/inventory/new/m3')).toBe(true);
    expect(isInventoryListingPath('/en_CA/inventory/used/my')).toBe(true);
    expect(isInventoryListingPath('/inventory/used')).toBe(true);
    expect(conditionFromPath('/inventory/used/my')).toBe('used');
    expect(conditionFromPath('/de_DE/inventory/NEW/my')).toBe('new');
  });

  it('rejects order pages and other inventory-ish paths', () => {
    expect(isInventoryListingPath('/my/order/7SAYGDEE5PF789500')).toBe(false);
    expect(isInventoryListingPath('/en_CA/my/order/7SAYGDEE5PF789500')).toBe(false);
    expect(isInventoryListingPath('/inventory/usedcars/my')).toBe(false);
    expect(isInventoryListingPath('/inventory')).toBe(false);
    expect(conditionFromPath('/my/order/7SAYGDEE5PF789500')).toBeNull();
  });
});

describe('normalizeSearchUrl / isSameSearchUrl', () => {
  it('drops the hash and empty params and sorts the rest', () => {
    expect(normalizeSearchUrl('https://www.tesla.com/inventory/used/my?zip=98052&arrangeby=plh&empty=#tih')).toBe(
      'https://www.tesla.com/inventory/used/my?arrangeby=plh&zip=98052',
    );
  });

  it('treats reordered params as the same search', () => {
    expect(
      isSameSearchUrl(
        'https://www.tesla.com/inventory/used/my?TRIM=MY_LR_AWD&zip=98052',
        'https://www.tesla.com/inventory/used/my?zip=98052&TRIM=MY_LR_AWD#x',
      ),
    ).toBe(true);
    expect(
      isSameSearchUrl(
        'https://www.tesla.com/inventory/used/my?zip=98052',
        'https://www.tesla.com/inventory/used/m3?zip=98052',
      ),
    ).toBe(false);
  });

  it('keeps a URL without a query string bare', () => {
    expect(normalizeSearchUrl('https://www.tesla.com/inventory/new/my')).toBe(
      'https://www.tesla.com/inventory/new/my',
    );
  });
});

describe('parseDigits / compactAmount', () => {
  it('reads the number out of a formatted slider box', () => {
    expect(parseDigits('$25,000')).toBe(25000);
    expect(parseDigits('2,000')).toBe(2000);
    expect(parseDigits('2020')).toBe(2020);
    expect(parseDigits('')).toBeNull();
    expect(parseDigits(null)).toBeNull();
  });

  it('compacts thousands', () => {
    expect(compactAmount(350)).toBe('350');
    expect(compactAmount(25000)).toBe('25k');
    expect(compactAmount(12500)).toBe('12.5k');
  });
});

describe('userSetRanges', () => {
  it('keeps only sliders moved off their bounds', () => {
    const ranges = {
      paymentRange: range(25000, 50000, 25000, 50000),
      Odometer: range(2000, 30000, 2000, 98000),
    };
    expect(userSetRanges(ranges)).toEqual({ Odometer: { min: 2000, max: 30000 } });
  });
});

describe('describeView', () => {
  it('renders the full example', () => {
    expect(describeView(fullView())).toBe(
      'Used Model Y · LR AWD, Performance AWD · Cash ≤ $35k · 5k–30k mi · 2023+ · Autosteer · No accidents · Price ↑ · 98052 (200 mi)',
    );
  });

  it('omits sliders left at their bounds and cash with no price range', () => {
    const view = fullView();
    view.groups = [];
    view.ranges = {
      paymentRange: range(25000, 50000, 25000, 50000),
      Odometer: range(2000, 98000, 2000, 98000),
      Year: range(2020, 2026, 2020, 2026),
    };
    view.sort = null;
    expect(describeView(view)).toBe('Used Model Y · 98052 (200 mi)');
  });

  it('shows finance and lease per month, and alone when the range is untouched', () => {
    const view = fullView();
    view.groups = [];
    view.paymentType = 'finance';
    view.ranges = { paymentRange: range(400, 600, 350, 850) };
    view.zip = null;
    view.sort = null;
    expect(describeView(view)).toBe('Used Model Y · Finance $400–$600/mo');
    view.ranges = { paymentRange: range(350, 850, 350, 850) };
    view.paymentType = 'lease';
    expect(describeView(view)).toBe('Used Model Y · Lease');
  });

  it('renders one-sided ranges', () => {
    const view = fullView();
    view.groups = [];
    view.sort = null;
    view.zip = null;
    view.ranges = {
      paymentRange: range(25000, 35000, 25000, 50000),
      Odometer: range(5000, 98000, 2000, 98000),
      Year: range(2020, 2024, 2020, 2026),
    };
    expect(describeView(view)).toBe('Used Model Y · Cash ≤ $35k · ≥ 5k mi · ≤ 2024');
  });

  it('caps labels per group with a +N overflow and shortens known labels', () => {
    const view = fullView();
    view.ranges = {};
    view.sort = null;
    view.zip = null;
    view.groups = [
      { key: 'PAINT', title: 'Paint', labels: ['White', 'Black', 'Blue', 'Grey', 'Red'] },
      { key: 'WHEELS', title: 'Wheels', labels: ['19" Wheels'] },
      { key: 'CABIN_CONFIG', title: 'Seat Layout', labels: ['Seven Seat Interior'] },
    ];
    expect(describeView(view)).toBe('Used Model Y · White, Black, Blue +2 · 19" · 7 seats');
  });

  it('handles new inventory with no model, unknown sort, and any-distance radius', () => {
    const view: CapturedView = {
      condition: 'new',
      model: null,
      paymentType: 'cash',
      groups: [],
      ranges: { paymentRange: range(39000, 45000, 39000, 58000) },
      currencySymbol: '$',
      distanceUnit: 'km',
      sort: 'bogus',
      zip: 'V6B 1A1',
      range: 0,
    };
    expect(describeView(view)).toBe('New inventory · Cash ≤ $45k · V6B 1A1 (any distance)');
  });

  it('shows the zip alone when no radius is known', () => {
    const view = fullView();
    view.groups = [];
    view.ranges = {};
    view.sort = null;
    view.range = null;
    expect(describeView(view)).toBe('Used Model Y · 98052');
  });

  it('truncates very long descriptions', () => {
    const view = fullView();
    view.groups = [
      { key: 'ADL_OPTS', title: 'Additional Options', labels: ['x'.repeat(120), 'y'.repeat(120)] },
    ];
    const out = describeView(view);
    expect(out.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('groupsFromUrl', () => {
  it('reads collapsed groups from the URL and maps Tesla codes to labels', () => {
    const search =
      '?arrangeby=plh&zip=98052&range=0&TRIM=MY_LR_AWD,MY_P_AWD&PAINT=WHITE&WHEELS=NINETEEN' +
      '&INTERIOR=PREMIUM_BLACK&AUTOPILOT=AUTOSTEER&CABIN_CONFIG=FIVE&ADL_OPTS=TOWING&VehicleHistory=CLEAN';
    expect(groupsFromUrl(search, ['TRIM', 'VehicleHistory'])).toEqual([
      { key: 'PAINT', title: 'PAINT', labels: ['White'] },
      { key: 'WHEELS', title: 'WHEELS', labels: ['19"'] },
      { key: 'INTERIOR', title: 'INTERIOR', labels: ['Premium black'] },
      { key: 'AUTOPILOT', title: 'AUTOPILOT', labels: ['Autosteer'] },
      { key: 'CABIN_CONFIG', title: 'CABIN_CONFIG', labels: ['5 seats'] },
      { key: 'ADL_OPTS', title: 'ADL_OPTS', labels: ['Tow hitch'] },
    ]);
  });

  it('decodes trim codes when the Trim group is not in the DOM', () => {
    expect(groupsFromUrl('?TRIM=MY_LR_AWD,M3_P_AWD,MS_PLAID', [])).toEqual([
      {
        key: 'TRIM',
        title: 'TRIM',
        labels: ['Long Range All-Wheel Drive', 'Performance All-Wheel Drive', 'Plaid'],
      },
    ]);
  });

  it('skips non-group params, empty values, and slider keys', () => {
    expect(groupsFromUrl('?arrangeby=plh&zip=98052&range=200&PaymentType=cash&Year=2023,2024&PAINT=', [])).toEqual([]);
  });
});

describe('describeView with URL-derived groups', () => {
  it('lists them after the DOM groups', () => {
    const view = fullView();
    view.ranges = {};
    view.sort = null;
    view.zip = null;
    view.groups = [...view.groups, ...groupsFromUrl('?WHEELS=NINETEEN&PAINT=WHITE', ['TRIM', 'AUTOPILOT', 'VehicleHistory'])];
    expect(describeView(view)).toBe('Used Model Y · LR AWD, Performance AWD · Autosteer · No accidents · 19" · White');
  });
});

describe('defaultName / searchLabel', () => {
  it('headlines by condition and model', () => {
    expect(defaultName(fullView())).toBe('Used Model Y');
    expect(defaultName({ ...fullView(), condition: 'new', model: null })).toBe('New inventory');
  });

  it('labels a search by its custom name, else its description', () => {
    expect(searchLabel(search('a', { name: '', description: 'Used Model Y · 2023+' }))).toBe('Used Model Y · 2023+');
    expect(searchLabel(search('a', { name: 'Commute car', description: 'Used Model Y · 2023+' }))).toBe('Commute car');
    expect(searchLabelShort(search('a', { name: '', description: 'x'.repeat(80) }), 20)).toBe(`${'x'.repeat(19)}…`);
  });
});

describe('createSavedSearch', () => {
  it('builds a slim record with a normalized url and only user-set ranges', () => {
    const s = createSavedSearch(fullView(), `${HREF}#hash`, 1234, 'abc');
    expect(s).toEqual({
      id: 'abc',
      name: '',
      description: describeView(fullView()),
      url: 'https://www.tesla.com/inventory/used/my?TRIM=MY_LR_AWD%2CMY_P_AWD&arrangeby=plh&range=200&zip=98052',
      condition: 'used',
      ranges: {
        paymentRange: { min: 25000, max: 35000 },
        Odometer: { min: 5000, max: 30000 },
        Year: { min: 2023, max: 2026 },
      },
      createdAt: 1234,
    });
  });

  it('leaves the name empty by default and caps an explicit one', () => {
    expect(createSavedSearch(fullView(), HREF, 1, 'a').name).toBe('');
    expect(createSavedSearch(fullView(), HREF, 1, 'a', 'x'.repeat(100)).name.length).toBe(MAX_NAME_LENGTH);
    expect(createSavedSearch(fullView(), HREF, 1, 'a', '   ').name).toBe('');
  });
});

describe('addSearch / findDuplicate / removeSearch / renameSearch', () => {
  it('prepends a new search', () => {
    const r = addSearch([search('a')], search('b'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.searches.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('rejects a duplicate (same url and ranges) and reports the existing id', () => {
    const existing = search('a', { ranges: { Year: { min: 2023, max: 2026 } } });
    const dup = search('b', { url: existing.url, ranges: { Year: { min: 2023, max: 2026 } } });
    expect(findDuplicate([existing], dup)?.id).toBe('a');
    expect(addSearch([existing], dup)).toEqual({ ok: false, reason: 'duplicate', existingId: 'a' });
    // Same url, different sliders → a distinct search.
    const other = search('c', { url: existing.url, ranges: { Year: { min: 2024, max: 2026 } } });
    expect(addSearch([existing], other).ok).toBe(true);
  });

  it('rejects when full', () => {
    const list: SavedSearches = Array.from({ length: MAX_SAVED_SEARCHES }, (_, i) => search(`s${i}`));
    expect(addSearch(list, search('extra'))).toEqual({ ok: false, reason: 'full' });
  });

  it('rejects when the serialized list would exceed the sync byte budget', () => {
    const heavy = search('h', { url: `https://www.tesla.com/inventory/used/my?x=${'a'.repeat(SYNC_ITEM_BUDGET_BYTES)}` });
    expect(addSearch([], heavy)).toEqual({ ok: false, reason: 'quota' });
    expect(byteSize([search('a')])).toBeGreaterThan(0);
  });

  it('removes by id', () => {
    expect(removeSearch([search('a'), search('b')], 'a').map((s) => s.id)).toEqual(['b']);
  });

  it('renames with trimming and a length cap, and clears on a blank name', () => {
    const list = [search('a'), search('b')];
    expect(renameSearch(list, 'a', '  My   search  ')[0]?.name).toBe('My search');
    expect(renameSearch(list, 'a', 'z'.repeat(100))[0]?.name.length).toBe(MAX_NAME_LENGTH);
    expect(renameSearch(list, 'a', '   ')[0]?.name).toBe('');
    expect(renameSearch(list, 'a', 'New')[1]).toBe(list[1]);
    const unnamed = [search('a', { name: '' })];
    expect(renameSearch(unnamed, 'a', '')).toEqual(unnamed);
  });
});

describe('restore helpers', () => {
  it('clamps a saved range into current bounds and keeps min ≤ max', () => {
    expect(clampRange({ min: 5000, max: 30000 }, { min: 2000, max: 98000 })).toEqual({ min: 5000, max: 30000 });
    expect(clampRange({ min: 5000, max: 120000 }, { min: 2000, max: 98000 })).toEqual({ min: 5000, max: 98000 });
    expect(clampRange({ min: 60000, max: 70000 }, { min: 25000, max: 50000 })).toEqual({ min: 50000, max: 50000 });
  });

  it('writes max first when the new min is above the current max', () => {
    expect(planRangeWrites({ min: 40000, max: 45000 }, { min: 25000, max: 35000 })).toEqual(['max', 'min']);
    expect(planRangeWrites({ min: 5000, max: 30000 }, { min: 2000, max: 98000 })).toEqual(['min', 'max']);
  });

  it('settles on the exact target or its clamped bound', () => {
    const bounds = { min: 2000, max: 98000 };
    expect(rangeWriteSettled({ min: 5000, max: 30000 }, { min: 5000, max: 30000 }, bounds)).toBe(true);
    expect(rangeWriteSettled({ min: 5000, max: 120000 }, { min: 5000, max: 98000 }, bounds)).toBe(true);
    expect(rangeWriteSettled({ min: 5000, max: 30000 }, { min: 2000, max: 30000 }, bounds)).toBe(false);
  });
});
