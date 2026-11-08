import { isCarSummary, parseInventoryCar, type CarSummary } from './inventoryCar';
import { LISTING_HASH_RE, VIN_RE } from './vin';
import { RANGE_KEYS, type RangeKey, type SavedSearches } from './savedSearches';

// "New matches" for saved searches: arrivals the shopper hasn't viewed on
// this device. All logic here is PURE (no `browser`/DOM;
// the fetch is injected) so it is unit-testable; the brittle parts (capturing
// Tesla's request, the hidden check tab) stay at the edges.
//
// Tesla's listing pages load results from a JSON endpoint (verified Oct 2026):
//   GET /inventory/api/v4/inventory-results?query=<url-encoded JSON>
// The JSON carries every filter, including the three sliders the page URL
// can't, plus lat/lng/region geocoded from the zip — so a search's query can't
// be rebuilt from its saved URL; the content script captures Tesla's own
// request instead. The endpoint 403s the extension's service worker (Akamai),
// so every call runs from a tesla.com page.

const API_PATH_RE = /(^|\/)inventory\/api\/v\d+\/inventory-results$/;
// Tesla returns at most 24 results per request whatever `count` asks for.
export const PAGE_SIZE = 24;
// 5 pages = the first 120 cars in the search's own sort order. A broad search
// (hundreds of matches) would otherwise mean megabytes per check.
export const MAX_PAGES = 5;
// Bounds per-search storage: car keys unobserved this long are forgotten, and the
// set never exceeds the cap (oldest-observed dropped first).
export const KNOWN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const KNOWN_CAP = 300;

// Tesla's request with the paging fields removed. `path` is kept rather than
// assumed, in case a locale serves the endpoint under a different prefix.
export type InventoryRequest = { path: string; body: Record<string, unknown> };

export type SearchResults = { total: number; cars: CarSummary[] };

export type SearchWatchEntry = {
  request: InventoryRequest;
  capturedAt: number;
  // Car key → last time it was observed (ms). null until the baseline is taken, so
  // a search's existing matches are never reported as new.
  known: Record<string, number> | null;
  newKeys: string[]; // arrivals not yet viewed
  badgeAckedKeys: string[]; // the part of newKeys the popup already acknowledged
  total: number | null; // total_matches_found at the last observation
  truncated: boolean; // total exceeded MAX_PAGES * PAGE_SIZE
  lastCheckedAt: number | null;
};

// Keyed by saved-search id. Lives in `local`: per-device by design.
export type SearchWatch = Record<string, SearchWatchEntry>;

// The live slider values on the page, as numbers.
export type SliderValues = Partial<Record<RangeKey, { min: number; max: number }>>;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const PAGING_KEYS = ['offset', 'count', 'outsideOffset', 'outsideSearch'];

// A resource-timing URL → the request it made, or null for anything else.
// "Outside" requests (cars beyond the search radius, which Tesla fetches when
// results run thin) are a different query and never stand for the search.
export function parseInventoryRequestUrl(url: string): InventoryRequest | null {
  let u: URL;
  try {
    u = new URL(url, 'https://www.tesla.com');
  } catch {
    return null;
  }
  if (!API_PATH_RE.test(u.pathname)) return null;
  const raw = u.searchParams.get('query');
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.query)) return null;
  if (parsed.outsideSearch === true) return null;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!PAGING_KEYS.includes(k)) body[k] = v;
  }
  return { path: u.pathname, body };
}

// Validate a request that crossed a message boundary.
export function asInventoryRequest(x: unknown): InventoryRequest | null {
  if (!isRecord(x) || typeof x.path !== 'string' || !API_PATH_RE.test(x.path)) return null;
  if (!isRecord(x.body) || !isRecord(x.body.query)) return null;
  return { path: x.path, body: x.body };
}

export function requestsEqual(a: InventoryRequest, b: InventoryRequest): boolean {
  return a.path === b.path && JSON.stringify(a.body) === JSON.stringify(b.body);
}

// Relative URL for one page of results.
export function inventoryPageUrl(request: InventoryRequest, offset: number): string {
  const query = {
    ...request.body,
    offset,
    count: PAGE_SIZE,
    outsideOffset: 0,
    outsideSearch: false,
  };
  return `${request.path}?query=${encodeURIComponent(JSON.stringify(query))}`;
}

export function normalizeKeys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const key = v.trim();
    if (VIN_RE.test(key.toUpperCase())) out.add(key.toUpperCase());
    else if (LISTING_HASH_RE.test(key)) out.add(key);
  }
  return [...out];
}

const isKey = (x: unknown): x is string =>
  typeof x === 'string' && (VIN_RE.test(x) || LISTING_HASH_RE.test(x));
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function isSearchWatchEntry(x: unknown): x is SearchWatchEntry {
  if (!isRecord(x) || !asInventoryRequest(x.request) || !isFiniteNumber(x.capturedAt)) return false;
  if (
    x.known !== null && (
      !isRecord(x.known) ||
      !Object.entries(x.known).every(([key, at]) => isKey(key) && isFiniteNumber(at))
    )
  ) return false;
  return (
    Array.isArray(x.newKeys) && x.newKeys.every(isKey) &&
    Array.isArray(x.badgeAckedKeys) && x.badgeAckedKeys.every(isKey) &&
    (x.total === null || (isFiniteNumber(x.total) && Number.isInteger(x.total) && x.total >= 0)) &&
    typeof x.truncated === 'boolean' &&
    (x.lastCheckedAt === null || isFiniteNumber(x.lastCheckedAt))
  );
}

// Pre-release state may use the old VIN-only shape. All readers share this
// filter; preserving a clean watch's reference lets the writer skip no-ops.
export function validSearchWatch(raw: unknown): SearchWatch {
  if (!isRecord(raw)) return {};
  const entries = Object.entries(raw);
  const valid = entries.filter((pair): pair is [string, SearchWatchEntry] => isSearchWatchEntry(pair[1]));
  return valid.length === entries.length ? (raw as SearchWatch) : Object.fromEntries(valid);
}

// The same validation covers baseline messages and hidden-tab check replies.
export function asSearchResults(x: unknown): (SearchResults & { truncated: boolean }) | null {
  if (!isRecord(x) || !isFiniteNumber(x.total) || !Number.isInteger(x.total) || x.total < 0) return null;
  if (!Array.isArray(x.cars) || !x.cars.every(isCarSummary) || typeof x.truncated !== 'boolean') return null;
  return { total: x.total, cars: x.cars, truncated: x.truncated };
}

// One page of the response. Null on any unexpected shape — a format change
// must read as "unknown", never as "no matches".
export function parseInventoryResponse(json: unknown): SearchResults | null {
  if (!isRecord(json)) return null;
  const rawTotal = json.total_matches_found;
  const total =
    typeof rawTotal === 'number'
      ? rawTotal
      : typeof rawTotal === 'string' && /^\d+$/.test(rawTotal)
        ? Number(rawTotal)
        : NaN;
  if (!Number.isInteger(total) || total < 0) return null;
  const { results } = json;
  if (!Array.isArray(results)) return total === 0 ? { total, cars: [] } : null;
  const cars: CarSummary[] = [];
  for (const record of results) {
    const car = parseInventoryCar(record);
    if (!car) return null;
    cars.push(car);
  }
  return { total, cars };
}

export function pagesToFetch(total: number): number {
  return Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
}

export type CollectOptions = {
  pauseMs: number;
  sleep: (ms: number) => Promise<void>;
};

// Page through a search's results. Any failed or malformed page fails the
// whole collection: a partial car set would make the missing cars look gone
// and then "new" again on the next complete check.
export async function collectSearchResults(
  request: InventoryRequest,
  fetchJson: (url: string) => Promise<unknown>,
  options: CollectOptions,
): Promise<(SearchResults & { truncated: boolean }) | null> {
  const first = parseInventoryResponse(await fetchJson(inventoryPageUrl(request, 0)));
  if (!first) return null;
  const cars = new Map(first.cars.map((car) => [car.key, car]));
  const pages = pagesToFetch(first.total);
  for (let page = 1; page < pages; page++) {
    await options.sleep(options.pauseMs);
    const next = parseInventoryResponse(await fetchJson(inventoryPageUrl(request, page * PAGE_SIZE)));
    if (!next) return null;
    for (const car of next.cars) if (!cars.has(car.key)) cars.set(car.key, car);
  }
  return { total: first.total, cars: [...cars.values()], truncated: first.total > MAX_PAGES * PAGE_SIZE };
}

// "350,900" or [2020, 2021, 2026] → [min, max]; null when unreadable.
function readPair(v: unknown): [number, number] | null {
  let nums: number[] = [];
  if (typeof v === 'string') nums = v.split(',').map((s) => Number(s.trim()));
  else if (Array.isArray(v)) nums = v.map((n) => Number(n));
  else return null;
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

function requestSlider(query: Record<string, unknown>, key: RangeKey): [number, number] | null {
  if (key === 'Year') {
    const options = isRecord(query.options) ? query.options : {};
    return readPair(options.Year ?? query.Year);
  }
  return readPair(query[key]);
}

// Does this request reflect the sliders on screen? Guards attribution: a reply
// to a request made before the user moved a slider must not be stored for the
// search the page has since become. A slider missing on either side can't be
// compared and doesn't count against the match.
export function requestSlidersMatch(request: InventoryRequest, page: SliderValues): boolean {
  const query = isRecord(request.body.query) ? request.body.query : {};
  for (const key of RANGE_KEYS) {
    const live = page[key];
    const sent = requestSlider(query, key);
    if (!live || !sent) continue;
    if (live.min !== sent[0] || live.max !== sent[1]) return false;
  }
  return true;
}

// ─── State transitions ───

export function createEntry(request: InventoryRequest, now: number): SearchWatchEntry {
  return {
    request,
    capturedAt: now,
    known: null,
    newKeys: [],
    badgeAckedKeys: [],
    total: null,
    truncated: false,
    lastCheckedAt: null,
  };
}

// Newest capture wins: re-capturing on every view keeps up with Tesla changing
// its request format. An identical request returns the same entry, so a
// repeat view doesn't cost a storage write.
export function withRequest(
  entry: SearchWatchEntry | undefined,
  request: InventoryRequest,
  now: number,
): SearchWatchEntry {
  if (!entry) return createEntry(request, now);
  if (requestsEqual(entry.request, request)) return entry;
  return { ...entry, request, capturedAt: now };
}

export function pruneKnown(
  known: Record<string, number>,
  now: number,
  current: Set<string> = new Set(),
): Record<string, number> {
  const fresh = Object.entries(known).filter(([, at]) => now - at <= KNOWN_TTL_MS);
  // A check can share a millisecond with the preceding view/check. Keep its
  // current results ahead of absent keys when those timestamps tie at the cap.
  fresh.sort((a, b) => b[1] - a[1] || Number(current.has(b[0])) - Number(current.has(a[0])));
  return Object.fromEntries(fresh.slice(0, KNOWN_CAP));
}

export function withBaseline(
  entry: SearchWatchEntry,
  results: SearchResults & { truncated?: boolean },
  now: number,
): SearchWatchEntry {
  return {
    ...entry,
    known: pruneKnown(Object.fromEntries(results.cars.map((car) => [car.key, now])), now),
    newKeys: [],
    badgeAckedKeys: [],
    total: results.total,
    truncated: results.truncated ?? false,
    lastCheckedAt: now,
  };
}

export function withCheckResult(
  entry: SearchWatchEntry,
  results: SearchResults & { truncated?: boolean },
  now: number,
): { entry: SearchWatchEntry; arrivals: string[] } {
  if (entry.known === null) return { entry: withBaseline(entry, results, now), arrivals: [] };
  const keys = new Set(results.cars.map((car) => car.key));
  const prior = entry.known;
  const arrivals = [...keys].filter((key) => !(key in prior));
  const known = { ...prior };
  for (const key of keys) known[key] = now;
  const truncated = results.truncated ?? false;
  // Only two complete checks can establish absence. A truncated page set says
  // nothing about cars outside it, so it also interrupts the two-miss sequence.
  if (!truncated && !entry.truncated && entry.lastCheckedAt !== null) {
    for (const [key, at] of Object.entries(known)) {
      if (!keys.has(key) && at < entry.lastCheckedAt) delete known[key];
    }
  }
  const pruned = pruneKnown(known, now, keys);
  const newKeys = [...new Set([...entry.newKeys, ...arrivals])].filter((key) => key in pruned);
  const news = new Set(newKeys);
  return {
    entry: {
      ...entry,
      known: pruned,
      newKeys,
      badgeAckedKeys: entry.badgeAckedKeys.filter((key) => news.has(key)),
      total: results.total,
      truncated,
      lastCheckedAt: now,
    },
    arrivals,
  };
}

// The search is on screen: everything new is now viewed, plus whatever the page
// rendered (which can include cars that arrived after the last check). Without
// a baseline there is nothing to mark against yet. Returns the same entry when
// there is nothing to mark, so the frequent re-reports while a page is open
// (scrolling loads more cards) don't each cost a storage write.
export function withViewed(
  entry: SearchWatchEntry,
  renderedKeys: string[],
  now: number,
): SearchWatchEntry {
  if (entry.known === null) return entry;
  const prior = entry.known;
  if (entry.newKeys.length === 0 && renderedKeys.every((v) => v in prior)) return entry;
  const known = { ...prior };
  for (const v of entry.newKeys) known[v] = now;
  for (const v of renderedKeys) known[v] = now;
  return { ...entry, known: pruneKnown(known, now), newKeys: [], badgeAckedKeys: [] };
}

// Opening the popup clears the toolbar badge; the row chips stay.
export function withBadgeAcked(entry: SearchWatchEntry): SearchWatchEntry {
  if (entry.badgeAckedKeys.length === entry.newKeys.length) return entry;
  return { ...entry, badgeAckedKeys: [...entry.newKeys] };
}

export function unackedCount(entry: SearchWatchEntry): number {
  const acked = new Set(entry.badgeAckedKeys);
  return entry.newKeys.filter((v) => !acked.has(v)).length;
}

// Searches deleted (on any device) take their state with them. Returns the same
// reference when nothing changed so callers can skip the write.
export function pruneOrphans(raw: unknown, searches: SavedSearches): SearchWatch {
  const watch = validSearchWatch(raw);
  const ids = new Set(searches.map((s) => s.id));
  const kept = Object.entries(watch).filter(([id]) => ids.has(id));
  return kept.length === Object.keys(watch).length ? watch : Object.fromEntries(kept);
}

export function newCountsById(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(validSearchWatch(raw))) {
    if (entry.newKeys.length > 0) out[id] = entry.newKeys.length;
  }
  return out;
}

export function unackedTotal(raw: unknown): number {
  return Object.values(validSearchWatch(raw)).reduce((sum, e) => sum + unackedCount(e), 0);
}

// ─── Toolbar badge ───

export const BADGE_RED = '#e82127';
export const BADGE_AMBER = '#ffbf00';
const BADGE_DARK_TEXT = '#171a20';
const BADGE_LIGHT_TEXT = '#ffffff';
const BADGE_TITLE = 'Tesla Inventory Helper';

export type Badge = { text: string; color: string; textColor: string; title: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One number for both features. Red whenever a watched car changed (the more
// urgent signal), amber when only saved searches have news; the tooltip splits
// the two.
export function composeBadge(watchlistChanges: number, searchNew: number): Badge {
  const total = watchlistChanges + searchNew;
  const parts: string[] = [];
  if (watchlistChanges > 0) {
    parts.push(plural(watchlistChanges, 'watchlist change', 'watchlist changes'));
  }
  if (searchNew > 0) parts.push(plural(searchNew, 'new search match', 'new search matches'));
  const red = watchlistChanges > 0;
  return {
    text: total === 0 ? '' : total > 99 ? '99+' : String(total),
    color: red ? BADGE_RED : BADGE_AMBER,
    textColor: red ? BADGE_LIGHT_TEXT : BADGE_DARK_TEXT,
    title: parts.length > 0 ? `${BADGE_TITLE}\n${parts.join(' · ')}` : BADGE_TITLE,
  };
}
