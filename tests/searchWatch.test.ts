import { describe, expect, it } from 'vitest';
import {
  asInventoryRequest,
  asSearchResults,
  isSearchWatchEntry,
  validSearchWatch,
  BADGE_AMBER,
  BADGE_RED,
  collectSearchResults,
  composeBadge,
  createEntry,
  inventoryPageUrl,
  MAX_PAGES,
  newCountsById,
  normalizeKeys,
  PAGE_SIZE,
  pagesToFetch,
  parseInventoryRequestUrl,
  parseInventoryResponse,
  pruneOrphans,
  pruneKnown,
  requestsEqual,
  requestSlidersMatch,
  KNOWN_CAP,
  KNOWN_TTL_MS,
  unackedCount,
  unackedTotal,
  withBadgeAcked,
  withBaseline,
  withCheckResult,
  withRequest,
  withViewed,
  type InventoryRequest,
  type SearchWatch,
} from '../src/searchWatch';
import { parseInventoryCar } from '../src/inventoryCar';
import type { SavedSearch } from '../src/savedSearches';

const API = '/inventory/api/v4/inventory-results';

// VINs are 17 chars from the VIN alphabet (no I, O, Q).
const vin = (n: number) => `7SAYGDEE5PF${String(n).padStart(6, '0')}`;
const keys = (...ns: number[]) => ns.map(vin);

const cars = (...ns: number[]) => ns.map((n) => parseInventoryCar({ VIN: vin(n) })!);
const HASH = '230_2df0b2b503fecb0921d4a5dc9f254b50';
const masked = { VIN: `7SAY${HASH}`, Hash: HASH };

const requestBody = (query: Record<string, unknown> = {}) => ({
  query: {
    model: 'my',
    condition: 'used',
    options: { Year: [2022, 2023, 2024] },
    arrangeby: 'Price',
    order: 'asc',
    market: 'US',
    lat: 47.6711,
    lng: -122.1253,
    zip: '98052',
    range: 200,
    paymentRange: '350,900',
    Odometer: '2000,97000',
    ...query,
  },
  offset: 48,
  count: 24,
  outsideOffset: 0,
  outsideSearch: false,
  isFalconDeliverySelectionEnabled: true,
  version: null,
});

const requestUrl = (body: unknown, path = API) =>
  `https://www.tesla.com${path}?query=${encodeURIComponent(JSON.stringify(body))}`;

const REQ: InventoryRequest = parseInventoryRequestUrl(requestUrl(requestBody()))!;

describe('parseInventoryRequestUrl', () => {
  it('keeps the filters and drops the paging fields', () => {
    expect(REQ.path).toBe(API);
    expect(REQ.body).not.toHaveProperty('offset');
    expect(REQ.body).not.toHaveProperty('count');
    expect(REQ.body).not.toHaveProperty('outsideOffset');
    expect(REQ.body).not.toHaveProperty('outsideSearch');
    expect(REQ.body.isFalconDeliverySelectionEnabled).toBe(true);
    expect((REQ.body.query as Record<string, unknown>).paymentRange).toBe('350,900');
  });

  it('accepts a locale-prefixed endpoint and keeps its path', () => {
    const req = parseInventoryRequestUrl(requestUrl(requestBody(), `/en_CA${API}`));
    expect(req?.path).toBe(`/en_CA${API}`);
  });

  it('rejects other URLs, missing or bad JSON, and outside-radius requests', () => {
    expect(parseInventoryRequestUrl('https://www.tesla.com/inventory/used/my')).toBeNull();
    expect(parseInventoryRequestUrl(`https://www.tesla.com${API}`)).toBeNull();
    expect(parseInventoryRequestUrl(`https://www.tesla.com${API}?query=%7Bnope`)).toBeNull();
    expect(parseInventoryRequestUrl(requestUrl({ offset: 0 }))).toBeNull();
    expect(parseInventoryRequestUrl(requestUrl({ ...requestBody(), outsideSearch: true }))).toBeNull();
    expect(parseInventoryRequestUrl('not a url at all ::')).toBeNull();
  });
});

describe('asInventoryRequest', () => {
  it('round-trips a parsed request and rejects junk', () => {
    expect(asInventoryRequest(JSON.parse(JSON.stringify(REQ)))).toEqual(REQ);
    expect(asInventoryRequest(null)).toBeNull();
    expect(asInventoryRequest({ path: '/evil', body: { query: {} } })).toBeNull();
    expect(asInventoryRequest({ path: API, body: { query: 'x' } })).toBeNull();
  });
});

describe('requestsEqual', () => {
  it('compares path and body', () => {
    const same = parseInventoryRequestUrl(requestUrl({ ...requestBody(), offset: 0 }))!;
    expect(requestsEqual(REQ, same)).toBe(true);
    const other = parseInventoryRequestUrl(requestUrl(requestBody({ zip: '94103' })))!;
    expect(requestsEqual(REQ, other)).toBe(false);
  });
});

describe('inventoryPageUrl', () => {
  it('pages with offset and the server-side page size, inside the radius only', () => {
    const url = inventoryPageUrl(REQ, 48);
    expect(url.startsWith(`${API}?query=`)).toBe(true);
    const sent = JSON.parse(decodeURIComponent(url.slice(url.indexOf('=') + 1)));
    expect(sent.offset).toBe(48);
    expect(sent.count).toBe(PAGE_SIZE);
    expect(sent.outsideSearch).toBe(false);
    expect(sent.query.zip).toBe('98052');
  });
});

describe('parseInventoryResponse', () => {
  it('reads summaries for used VINs and masked new cars', () => {
    const records = [{ VIN: vin(1) }, { VIN: vin(2).toLowerCase() }, masked];
    expect(parseInventoryResponse({ total_matches_found: 3, results: records })).toEqual({
      total: 3, cars: records.map(parseInventoryCar),
    });
  });

  it('fails the whole page if even one record cannot be parsed', () => {
    for (const invalid of [{ VIN: 'SHORT' }, {}, null, { ...masked, VIN: '7SAY' + HASH + 'x' }]) {
      expect(parseInventoryResponse({
        total_matches_found: 2, results: [{ VIN: vin(1) }, invalid],
      })).toBeNull();
    }
  });

  it('accepts a numeric-string total and an empty result set', () => {
    expect(parseInventoryResponse({ total_matches_found: '0', results: [] })).toEqual({
      total: 0,
      cars: [],
    });
    expect(parseInventoryResponse({ total_matches_found: 0, results: {} })).toEqual({
      total: 0,
      cars: [],
    });
  });

  it('treats any unexpected shape as unknown, never as "no matches"', () => {
    expect(parseInventoryResponse(null)).toBeNull();
    expect(parseInventoryResponse('<html>Access Denied</html>')).toBeNull();
    expect(parseInventoryResponse({ results: [] })).toBeNull();
    expect(parseInventoryResponse({ total_matches_found: -1, results: [] })).toBeNull();
    expect(parseInventoryResponse({ total_matches_found: 5, results: {} })).toBeNull();
  });
});

describe('normalizeKeys', () => {
  it('accepts and deduplicates hashes without uppercasing them', () => {
    expect(normalizeKeys([HASH, HASH, HASH.toUpperCase(), vin(1).toLowerCase(), vin(1)]))
      .toEqual([HASH, vin(1)]);
  });
  it('drops non-strings and malformed VINs', () => {
    expect(normalizeKeys([vin(1), 42, null, 'IOQ00000000000000', ` ${vin(2)} `])).toEqual(keys(1, 2));
    expect(normalizeKeys('nope')).toEqual([]);
  });
});

describe('asSearchResults', () => {
  it('validates every summary crossing a message boundary', () => {
    const results = { total: 2, cars: [...cars(1), parseInventoryCar(masked)!], truncated: false };
    expect(asSearchResults(JSON.parse(JSON.stringify(results)))).toEqual(results);
    for (const invalid of [null, {}, { ...results, total: -1 }, { ...results, total: Infinity },
      { ...results, total: '2' }, { ...results, truncated: undefined },
      { ...results, cars: [cars(1)[0], {}] }, { ...results, cars: undefined, vins: keys(1) },
    ]) expect(asSearchResults(invalid)).toBeNull();
  });
});

describe('pagesToFetch', () => {
  it('covers the total up to the page cap', () => {
    expect(pagesToFetch(0)).toBe(0);
    expect(pagesToFetch(1)).toBe(1);
    expect(pagesToFetch(24)).toBe(1);
    expect(pagesToFetch(25)).toBe(2);
    expect(pagesToFetch(10_000)).toBe(MAX_PAGES);
  });
});

describe('collectSearchResults', () => {
  const opts = { pauseMs: 0, sleep: async () => {} };
  const page = (total: number, from: number, n: number) => ({
    total_matches_found: total,
    results: Array.from({ length: n }, (_, i) => ({ VIN: vin(from + i) })),
  });
  const offsetOf = (url: string) =>
    JSON.parse(decodeURIComponent(url.slice(url.indexOf('=') + 1))).offset as number;

  it('deduplicates summaries by key across pages, including listing hashes', async () => {
    const result = await collectSearchResults(REQ, async (url) => ({
      total_matches_found: 25,
      results: offsetOf(url) === 0 ? [masked, { VIN: vin(1) }] : [masked, { VIN: vin(2) }],
    }), opts);
    expect(result?.cars.map((car) => car.key)).toEqual([HASH, ...keys(1, 2)]);
  });

  it('fails the collection when a later page contains one malformed record', async () => {
    expect(await collectSearchResults(REQ, async (url) => offsetOf(url) === 0
      ? page(25, 0, 24)
      : { total_matches_found: 25, results: [masked, {}] }, opts)).toBeNull();
  });

  it('pages until the total is covered', async () => {
    const known: number[] = [];
    const result = await collectSearchResults(
      REQ,
      async (url) => {
        const offset = offsetOf(url);
        known.push(offset);
        return page(30, offset, offset === 0 ? 24 : 6);
      },
      opts,
    );
    expect(known).toEqual([0, 24]);
    expect(result?.total).toBe(30);
    expect(result?.cars).toHaveLength(30);
    expect(result?.truncated).toBe(false);
  });

  it('stops at the page cap and flags the result as truncated', async () => {
    let calls = 0;
    const result = await collectSearchResults(
      REQ,
      async (url) => {
        calls++;
        return page(500, offsetOf(url), 24);
      },
      opts,
    );
    expect(calls).toBe(MAX_PAGES);
    expect(result?.cars).toHaveLength(MAX_PAGES * PAGE_SIZE);
    expect(result?.truncated).toBe(true);
  });

  it('fails the whole collection when any page fails', async () => {
    const result = await collectSearchResults(
      REQ,
      async (url) => (offsetOf(url) === 0 ? page(30, 0, 24) : null),
      opts,
    );
    expect(result).toBeNull();
    expect(await collectSearchResults(REQ, async () => 'Access Denied', opts)).toBeNull();
  });

  it('makes one request for an empty search', async () => {
    let calls = 0;
    const result = await collectSearchResults(
      REQ,
      async () => {
        calls++;
        return { total_matches_found: 0, results: [] };
      },
      opts,
    );
    expect(calls).toBe(1);
    expect(result).toEqual({ total: 0, cars: [], truncated: false });
  });
});

describe('requestSlidersMatch', () => {
  it('matches when every comparable slider agrees', () => {
    expect(
      requestSlidersMatch(REQ, {
        paymentRange: { min: 350, max: 900 },
        Odometer: { min: 2000, max: 97000 },
        Year: { min: 2022, max: 2024 },
      }),
    ).toBe(true);
  });

  it('rejects a request made before a slider moved', () => {
    expect(requestSlidersMatch(REQ, { paymentRange: { min: 350, max: 700 } })).toBe(false);
    expect(requestSlidersMatch(REQ, { Year: { min: 2023, max: 2024 } })).toBe(false);
  });

  it('ignores sliders missing on either side', () => {
    expect(requestSlidersMatch(REQ, {})).toBe(true);
    const bare = parseInventoryRequestUrl(requestUrl({ query: { model: 'my' } }))!;
    expect(requestSlidersMatch(bare, { Odometer: { min: 0, max: 10 } })).toBe(true);
  });

  it('reads a Year slider sent as a top-level range string', () => {
    const req = parseInventoryRequestUrl(requestUrl({ query: { Year: '2021,2023' } }))!;
    expect(requestSlidersMatch(req, { Year: { min: 2021, max: 2023 } })).toBe(true);
    expect(requestSlidersMatch(req, { Year: { min: 2021, max: 2024 } })).toBe(false);
  });
});

describe('state transitions', () => {
  const T0 = 1_000_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const base = (known: number[], now = T0) =>
    withBaseline(createEntry(REQ, T0), { total: known.length, cars: cars(...known) }, now);

  it('reports arrivals once, remembers them on checks, and baselines without arrivals', () => {
    const results = { total: 2, cars: [cars(1)[0]!, parseInventoryCar(masked)!] };
    expect(withCheckResult(createEntry(REQ, T0), results, T0).arrivals).toEqual([]);
    const first = withCheckResult(base([1]), results, T0 + DAY);
    expect(first.arrivals).toEqual([HASH]);
    expect(first.entry.known?.[HASH]).toBe(T0 + DAY);
    const second = withCheckResult(first.entry, results, T0 + 2 * DAY);
    expect(second.arrivals).toEqual([]);
    expect(second.entry.newKeys).toEqual([HASH]);
  });

  it('a returning car is an arrival again only after two complete misses', () => {
    const empty = { total: 0, cars: [] };
    const firstMiss = withCheckResult(base([1]), empty, T0 + DAY).entry;
    expect(withCheckResult(firstMiss, { total: 1, cars: cars(1) }, T0 + 2 * DAY).arrivals).toEqual([]);
    const secondMiss = withCheckResult(firstMiss, empty, T0 + 2 * DAY).entry;
    expect(withCheckResult(secondMiss, { total: 1, cars: cars(1) }, T0 + 3 * DAY).arrivals).toEqual(keys(1));
  });

  it('truncated checks interrupt the two-miss sequence and never infer absence', () => {
    let e = withCheckResult(base([1]), { total: 0, cars: [] }, T0 + DAY).entry;
    for (const day of [2, 3]) {
      e = withCheckResult(e, { total: 500, cars: [], truncated: true }, T0 + day * DAY).entry;
      expect(e.known).toHaveProperty(vin(1));
    }
    e = withCheckResult(e, { total: 0, cars: [] }, T0 + 4 * DAY).entry;
    expect(e.known).toHaveProperty(vin(1));
    e = withCheckResult(e, { total: 0, cars: [] }, T0 + 5 * DAY).entry;
    expect(e.known).not.toHaveProperty(vin(1));
  });

  it('does not forget without a previous check or after a view refreshed the key', () => {
    const entry = { ...base([1]), lastCheckedAt: null };
    expect(withCheckResult(entry, { total: 0, cars: [] }, T0 + DAY).entry.known).toHaveProperty(vin(1));
    const missing = withCheckResult(base([]), { total: 0, cars: [] }, T0 + DAY).entry;
    const viewed = withViewed(missing, keys(1), T0 + DAY + 1);
    expect(withCheckResult(viewed, { total: 0, cars: [] }, T0 + 2 * DAY).entry.known).toHaveProperty(vin(1));
  });

  it('prunes old news and its badge acknowledgment along with forgotten keys', () => {
    const arrived = withCheckResult(base([]), { total: 1, cars: cars(1) }, T0 + DAY).entry;
    const acked = withBadgeAcked(arrived);
    const first = withCheckResult(acked, { total: 0, cars: [] }, T0 + 2 * DAY).entry;
    expect(first.badgeAckedKeys).toEqual(keys(1));
    const second = withCheckResult(first, { total: 0, cars: [] }, T0 + 3 * DAY).entry;
    expect(second.newKeys).toEqual([]);
    expect(second.badgeAckedKeys).toEqual([]);
  });

  it('keeps current results ahead of older keys at the cap, including tied timestamps', () => {
    const ns = Array.from({ length: KNOWN_CAP }, (_, i) => i);
    for (const at of [T0, T0 - DAY]) {
      const e = withCheckResult(base(ns, at), {
        total: 500, cars: cars(KNOWN_CAP + 1), truncated: true,
      }, T0).entry;
      expect(Object.keys(e.known!)).toHaveLength(KNOWN_CAP);
      expect(e.known?.[vin(KNOWN_CAP + 1)]).toBe(T0);
      expect(e.newKeys).toEqual(keys(KNOWN_CAP + 1));
    }
  });

  it('still applies the TTL backstop to truncated checks', () => {
    const e = withCheckResult(base([1]), { total: 500, cars: cars(2), truncated: true }, T0 + KNOWN_TTL_MS + 1).entry;
    expect(e.known).not.toHaveProperty(vin(1));
    expect(e.known).toHaveProperty(vin(2));
  });

  it('creates an entry without a baseline', () => {
    const e = createEntry(REQ, T0);
    expect(e.known).toBeNull();
    expect(e.newKeys).toEqual([]);
    expect(e.request).toBe(REQ);
  });

  it('withRequest replaces the request on an existing entry and keeps its state', () => {
    const e = base([1, 2]);
    const other = parseInventoryRequestUrl(requestUrl(requestBody({ zip: '94103' })))!;
    const next = withRequest(e, other, T0 + 5);
    expect(next.request).toBe(other);
    expect(next.capturedAt).toBe(T0 + 5);
    expect(next.known).toEqual(e.known);
    expect(withRequest(undefined, REQ, T0).known).toBeNull();
  });

  it('withRequest returns the same entry for an identical request', () => {
    const e = base([1]);
    const same = parseInventoryRequestUrl(requestUrl({ ...requestBody(), offset: 0 }))!;
    expect(withRequest(e, same, T0 + 5)).toBe(e);
  });

  it('the first check without a baseline becomes the baseline', () => {
    const e = withCheckResult(createEntry(REQ, T0), { total: 2, cars: cars(1, 2) }, T0).entry;
    expect(Object.keys(e.known ?? {})).toEqual(keys(1, 2));
    expect(e.newKeys).toEqual([]);
    expect(e.lastCheckedAt).toBe(T0);
  });

  it('reports cars not known before, and only those', () => {
    const e = withCheckResult(base([1, 2]), { total: 3, cars: cars(1, 2, 3) }, T0 + DAY).entry;
    expect(e.newKeys).toEqual([vin(3)]);
    expect(e.total).toBe(3);
    // Checks remember arrivals even before the shopper opens the search.
    expect(e.known?.[vin(3)]).toBe(T0 + DAY);
    expect(e.known?.[vin(1)]).toBe(T0 + DAY);
  });

  it('a new car survives one miss, then is forgotten after the second', () => {
    const e1 = withCheckResult(base([1]), { total: 2, cars: cars(1, 2) }, T0 + DAY).entry;
    const e2 = withCheckResult(e1, { total: 1, cars: cars(1) }, T0 + 2 * DAY).entry;
    expect(e2.newKeys).toEqual(keys(2));
    expect(e2.known).toHaveProperty(vin(2));
    const e3 = withCheckResult(e2, { total: 1, cars: cars(1) }, T0 + 3 * DAY).entry;
    expect(e3.known).not.toHaveProperty(vin(2));
    expect(e3.newKeys).toEqual([]);
  });

  it('keeps the badge acknowledgment for cars that are still new', () => {
    const e1 = withBadgeAcked(withCheckResult(base([1]), { total: 2, cars: cars(1, 2) }, T0 + DAY).entry);
    expect(unackedCount(e1)).toBe(0);
    const e2 = withCheckResult(e1, { total: 3, cars: cars(1, 2, 3) }, T0 + 2 * DAY).entry;
    expect(e2.newKeys).toEqual(keys(2, 3));
    expect(e2.badgeAckedKeys).toEqual([vin(2)]);
    expect(unackedCount(e2)).toBe(1);
  });

  it('withBadgeAcked returns the same entry when nothing is unacknowledged', () => {
    const e = base([1]);
    expect(withBadgeAcked(e)).toBe(e);
  });

  it('viewing marks new and rendered cars as known', () => {
    const e1 = withCheckResult(base([1]), { total: 2, cars: cars(1, 2) }, T0 + DAY).entry;
    const e2 = withViewed(e1, keys(1, 5), T0 + 2 * DAY);
    expect(e2.newKeys).toEqual([]);
    expect(e2.badgeAckedKeys).toEqual([]);
    expect(e2.known).toHaveProperty(vin(2));
    expect(e2.known).toHaveProperty(vin(5));
    const e3 = withCheckResult(e2, { total: 3, cars: cars(1, 2, 5) }, T0 + 3 * DAY).entry;
    expect(e3.newKeys).toEqual([]);
  });

  it('viewing returns the same entry when everything is already known', () => {
    const e = base([1, 2]);
    expect(withViewed(e, keys(1, 2), T0 + DAY)).toBe(e);
    expect(withViewed(e, keys(1, 3), T0 + DAY)).not.toBe(e);
  });

  it('viewing does nothing before the baseline exists', () => {
    const e = createEntry(REQ, T0);
    expect(withViewed(e, keys(1), T0)).toBe(e);
  });

  it('records truncation from the check', () => {
    const e = withCheckResult(base([1]), { total: 500, cars: cars(1), truncated: true }, T0).entry;
    expect(e.truncated).toBe(true);
  });
});

describe('pruneKnown', () => {
  const T0 = 1_000_000_000_000;

  it('forgets VINs unobserved past the TTL', () => {
    const known = { [vin(1)]: T0, [vin(2)]: T0 - KNOWN_TTL_MS - 1 };
    expect(Object.keys(pruneKnown(known, T0))).toEqual([vin(1)]);
  });

  it('keeps the most recently observed VINs under the cap', () => {
    const known = Object.fromEntries(
      Array.from({ length: KNOWN_CAP + 5 }, (_, i) => [vin(i), T0 - i]),
    );
    const pruned = pruneKnown(known, T0);
    expect(Object.keys(pruned)).toHaveLength(KNOWN_CAP);
    expect(pruned).toHaveProperty(vin(0));
    expect(pruned).not.toHaveProperty(vin(KNOWN_CAP + 4));
  });
});

describe('watch-level helpers', () => {
  const T0 = 1_000_000_000_000;
  const entry = (newN: number[], acked: number[] = []) => ({
    ...createEntry(REQ, T0),
    known: {},
    newKeys: keys(...newN),
    badgeAckedKeys: keys(...acked),
  });
  const search = (id: string) => ({ id }) as SavedSearch;

  it('drops old-shape and malformed entries consistently in every reader', () => {
    const good = entry([1, 2], [1]);
    const { known, newKeys, badgeAckedKeys, ...rest } = good;
    const old = { ...rest, seen: known, newVins: newKeys, badgeAckedVins: badgeAckedKeys };
    const raw = { good, old, broken: { ...good, known: { [HASH]: 'yesterday' } }, empty: null };
    expect(isSearchWatchEntry(old)).toBe(false);
    expect(validSearchWatch(raw)).toEqual({ good });
    expect(newCountsById(raw)).toEqual({ good: 2 });
    expect(unackedTotal(raw)).toBe(1);
    expect(pruneOrphans(raw, [search('good'), search('old')])).toEqual({ good });
    const clean = { good };
    expect(validSearchWatch(clean)).toBe(clean);
    for (const bad of [null, [], 'bad']) expect(validSearchWatch(bad)).toEqual({});
  });

  it('validates all fields of the new shape, including VIN and hash keys', () => {
    const good = { ...entry([]), known: { [HASH]: T0, [vin(1)]: T0 }, newKeys: [HASH] };
    expect(isSearchWatchEntry(good)).toBe(true);
    expect(isSearchWatchEntry(createEntry(REQ, T0))).toBe(true);
    for (const bad of [{ request: {} }, { capturedAt: NaN }, { known: [] },
      { known: { bad: T0 } }, { newKeys: [123] }, { badgeAckedKeys: [HASH.toUpperCase()] },
      { total: -1 }, { total: 1.5 }, { truncated: 1 }, { lastCheckedAt: Infinity },
    ]) expect(isSearchWatchEntry({ ...good, ...bad })).toBe(false);
  });

  it('pruneOrphans drops deleted searches and keeps the reference otherwise', () => {
    const watch: SearchWatch = { a: entry([]), b: entry([]) };
    expect(pruneOrphans(watch, [search('a'), search('b')])).toBe(watch);
    expect(Object.keys(pruneOrphans(watch, [search('a')]))).toEqual(['a']);
  });

  it('counts new matches per search and unacknowledged ones overall', () => {
    const watch: SearchWatch = { a: entry([1, 2], [1]), b: entry([]), c: entry([3]) };
    expect(newCountsById(watch)).toEqual({ a: 2, c: 1 });
    expect(unackedTotal(watch)).toBe(2);
  });
});

describe('composeBadge', () => {
  it('is empty with nothing to report', () => {
    expect(composeBadge(0, 0)).toMatchObject({ text: '', title: 'Tesla Inventory Helper' });
  });

  it('is red whenever a watched car changed, and sums both counts', () => {
    const b = composeBadge(2, 5);
    expect(b.text).toBe('7');
    expect(b.color).toBe(BADGE_RED);
    expect(b.title).toBe('Tesla Inventory Helper\n2 watchlist changes · 5 new search matches');
  });

  it('is amber with dark text when only searches have news', () => {
    const b = composeBadge(0, 1);
    expect(b.text).toBe('1');
    expect(b.color).toBe(BADGE_AMBER);
    expect(b.textColor).toBe('#171a20');
    expect(b.title).toBe('Tesla Inventory Helper\n1 new search match');
  });

  it('caps the text', () => {
    expect(composeBadge(1, 150).text).toBe('99+');
    expect(composeBadge(1, 0).title).toBe('Tesla Inventory Helper\n1 watchlist change');
  });
});
