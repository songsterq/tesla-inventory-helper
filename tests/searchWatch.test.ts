import { describe, expect, it } from 'vitest';
import {
  asInventoryRequest,
  BADGE_AMBER,
  BADGE_RED,
  collectSearchResults,
  composeBadge,
  createEntry,
  inventoryPageUrl,
  MAX_PAGES,
  newCountsById,
  normalizeVins,
  PAGE_SIZE,
  pagesToFetch,
  parseInventoryRequestUrl,
  parseInventoryResponse,
  pruneOrphans,
  pruneSeen,
  requestsEqual,
  requestSlidersMatch,
  SEEN_CAP,
  SEEN_TTL_MS,
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
import type { SavedSearch } from '../src/savedSearches';

const API = '/inventory/api/v4/inventory-results';

// VINs are 17 chars from the VIN alphabet (no I, O, Q).
const vin = (n: number) => `7SAYGDEE5PF${String(n).padStart(6, '0')}`;
const vins = (...ns: number[]) => ns.map(vin);

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
  it('reads the total and well-formed VINs, deduplicated and upper-cased', () => {
    const json = {
      total_matches_found: 3,
      results: [{ VIN: vin(1) }, { VIN: vin(2).toLowerCase() }, { VIN: vin(1) }, { VIN: 'SHORT' }, {}],
    };
    expect(parseInventoryResponse(json)).toEqual({ total: 3, vins: vins(1, 2) });
  });

  it('accepts a numeric-string total and an empty result set', () => {
    expect(parseInventoryResponse({ total_matches_found: '0', results: [] })).toEqual({
      total: 0,
      vins: [],
    });
    expect(parseInventoryResponse({ total_matches_found: 0, results: {} })).toEqual({
      total: 0,
      vins: [],
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

describe('normalizeVins', () => {
  it('drops non-strings and malformed VINs', () => {
    expect(normalizeVins([vin(1), 42, null, 'IOQ00000000000000', ` ${vin(2)} `])).toEqual(vins(1, 2));
    expect(normalizeVins('nope')).toEqual([]);
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

  it('pages until the total is covered', async () => {
    const seen: number[] = [];
    const result = await collectSearchResults(
      REQ,
      async (url) => {
        const offset = offsetOf(url);
        seen.push(offset);
        return page(30, offset, offset === 0 ? 24 : 6);
      },
      opts,
    );
    expect(seen).toEqual([0, 24]);
    expect(result?.total).toBe(30);
    expect(result?.vins).toHaveLength(30);
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
    expect(result?.vins).toHaveLength(MAX_PAGES * PAGE_SIZE);
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
    expect(result).toEqual({ total: 0, vins: [], truncated: false });
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
  const base = (seen: number[], now = T0) =>
    withBaseline(createEntry(REQ, T0), { total: seen.length, vins: vins(...seen) }, now);

  it('creates an entry without a baseline', () => {
    const e = createEntry(REQ, T0);
    expect(e.seen).toBeNull();
    expect(e.newVins).toEqual([]);
    expect(e.request).toBe(REQ);
  });

  it('withRequest replaces the request on an existing entry and keeps its state', () => {
    const e = base([1, 2]);
    const other = parseInventoryRequestUrl(requestUrl(requestBody({ zip: '94103' })))!;
    const next = withRequest(e, other, T0 + 5);
    expect(next.request).toBe(other);
    expect(next.capturedAt).toBe(T0 + 5);
    expect(next.seen).toEqual(e.seen);
    expect(withRequest(undefined, REQ, T0).seen).toBeNull();
  });

  it('withRequest returns the same entry for an identical request', () => {
    const e = base([1]);
    const same = parseInventoryRequestUrl(requestUrl({ ...requestBody(), offset: 0 }))!;
    expect(withRequest(e, same, T0 + 5)).toBe(e);
  });

  it('the first check without a baseline becomes the baseline', () => {
    const e = withCheckResult(createEntry(REQ, T0), { total: 2, vins: vins(1, 2) }, T0);
    expect(Object.keys(e.seen ?? {})).toEqual(vins(1, 2));
    expect(e.newVins).toEqual([]);
    expect(e.lastCheckedAt).toBe(T0);
  });

  it('reports cars not seen before, and only those', () => {
    const e = withCheckResult(base([1, 2]), { total: 3, vins: vins(1, 2, 3) }, T0 + DAY);
    expect(e.newVins).toEqual([vin(3)]);
    expect(e.total).toBe(3);
    // New cars stay out of `seen` until the search is opened.
    expect(e.seen).not.toHaveProperty(vin(3));
    expect(e.seen?.[vin(1)]).toBe(T0 + DAY);
  });

  it('a new car that has since gone is no longer news', () => {
    const e1 = withCheckResult(base([1]), { total: 2, vins: vins(1, 2) }, T0 + DAY);
    const e2 = withCheckResult(e1, { total: 1, vins: vins(1) }, T0 + 2 * DAY);
    expect(e2.newVins).toEqual([]);
  });

  it('keeps the badge acknowledgment for cars that are still new', () => {
    const e1 = withBadgeAcked(withCheckResult(base([1]), { total: 2, vins: vins(1, 2) }, T0 + DAY));
    expect(unackedCount(e1)).toBe(0);
    const e2 = withCheckResult(e1, { total: 3, vins: vins(1, 2, 3) }, T0 + 2 * DAY);
    expect(e2.newVins).toEqual(vins(2, 3));
    expect(e2.badgeAckedVins).toEqual([vin(2)]);
    expect(unackedCount(e2)).toBe(1);
  });

  it('withBadgeAcked returns the same entry when nothing is unacknowledged', () => {
    const e = base([1]);
    expect(withBadgeAcked(e)).toBe(e);
  });

  it('viewing marks new and rendered cars as seen', () => {
    const e1 = withCheckResult(base([1]), { total: 2, vins: vins(1, 2) }, T0 + DAY);
    const e2 = withViewed(e1, vins(1, 5), T0 + 2 * DAY);
    expect(e2.newVins).toEqual([]);
    expect(e2.badgeAckedVins).toEqual([]);
    expect(e2.seen).toHaveProperty(vin(2));
    expect(e2.seen).toHaveProperty(vin(5));
    const e3 = withCheckResult(e2, { total: 3, vins: vins(1, 2, 5) }, T0 + 3 * DAY);
    expect(e3.newVins).toEqual([]);
  });

  it('viewing returns the same entry when everything is already seen', () => {
    const e = base([1, 2]);
    expect(withViewed(e, vins(1, 2), T0 + DAY)).toBe(e);
    expect(withViewed(e, vins(1, 3), T0 + DAY)).not.toBe(e);
  });

  it('viewing does nothing before the baseline exists', () => {
    const e = createEntry(REQ, T0);
    expect(withViewed(e, vins(1), T0)).toBe(e);
  });

  it('records truncation from the check', () => {
    const e = withCheckResult(base([1]), { total: 500, vins: vins(1), truncated: true }, T0);
    expect(e.truncated).toBe(true);
  });
});

describe('pruneSeen', () => {
  const T0 = 1_000_000_000_000;

  it('forgets VINs unobserved past the TTL', () => {
    const seen = { [vin(1)]: T0, [vin(2)]: T0 - SEEN_TTL_MS - 1 };
    expect(Object.keys(pruneSeen(seen, T0))).toEqual([vin(1)]);
  });

  it('keeps the most recently observed VINs under the cap', () => {
    const seen = Object.fromEntries(
      Array.from({ length: SEEN_CAP + 5 }, (_, i) => [vin(i), T0 - i]),
    );
    const pruned = pruneSeen(seen, T0);
    expect(Object.keys(pruned)).toHaveLength(SEEN_CAP);
    expect(pruned).toHaveProperty(vin(0));
    expect(pruned).not.toHaveProperty(vin(SEEN_CAP + 4));
  });
});

describe('watch-level helpers', () => {
  const T0 = 1_000_000_000_000;
  const entry = (newN: number[], acked: number[] = []) => ({
    ...createEntry(REQ, T0),
    seen: {},
    newVins: vins(...newN),
    badgeAckedVins: vins(...acked),
  });
  const search = (id: string) => ({ id }) as SavedSearch;

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
