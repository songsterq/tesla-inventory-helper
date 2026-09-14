import { abbreviateTrim } from './format';

// Saved inventory searches: a listing URL plus the state of the three slider
// filters (Payment, Mileage, Year) that tesla.com does NOT put in the URL. All
// logic here is PURE (no `browser`/DOM) so it is unit-testable; the brittle
// parts (sidebar scraping, slider writes, tab hand-off) stay at the edges in the
// content script and background worker.

export type SearchCondition = 'used' | 'new';

// Tesla's own keys for the slider groups — they match the `filter-<KEY>` sidebar
// class and the `inputMin-<KEY>` / `inputMax-<KEY>` text inputs.
export type RangeKey = 'paymentRange' | 'Odometer' | 'Year';
export const RANGE_KEYS = ['paymentRange', 'Odometer', 'Year'] as const satisfies readonly RangeKey[];

// A slider as read off the page: the user's values plus the slider's current
// bounds, so we can tell "left at default" from "deliberately set".
export type CapturedRange = { min: number; max: number; boundMin: number; boundMax: number };

// One checkbox/radio group with the labels of its checked inputs. Model and
// PaymentType are reported separately (see CapturedView), not as groups.
export type CapturedGroup = { key: string; title: string; labels: string[] };

// Everything the content script scrapes at save time. DOM-free so describeView
// can be tested without a browser.
export type CapturedView = {
  condition: SearchCondition;
  model: string | null; // checked Model radio label, e.g. "Model Y"
  paymentType: string | null; // 'cash' | 'finance' | 'lease' (Tesla's values)
  groups: CapturedGroup[]; // sidebar order
  ranges: Partial<Record<RangeKey, CapturedRange>>;
  currencySymbol: string; // leading symbol of the payment box, e.g. "$"
  distanceUnit: 'mi' | 'km';
  sort: string | null; // `arrangeby` value
  zip: string | null;
  range: number | null; // search radius; 0 = any distance
};

export type SavedRange = { min: number; max: number };

// The stored record. Deliberately slim (see MAX_SAVED_SEARCHES): the description
// is computed once at save time rather than storing per-group labels, and only
// ranges the user actually moved are kept.
export type SavedSearch = {
  id: string;
  name: string; // optional custom label; '' when the user hasn't set one
  description: string; // auto-generated summary of what was applied; the label when `name` is empty
  url: string; // normalized listing URL (see normalizeSearchUrl)
  condition: SearchCondition;
  ranges: Partial<Record<RangeKey, SavedRange>>;
  createdAt: number;
};

export type SavedSearches = SavedSearch[];

// The list lives in chrome.storage.sync, which caps a single item at 8,192
// bytes (key + JSON value). A record is ~450–650 bytes typically (URL, name,
// description) and ~1 KB with many filters, so 12 fits comfortably in the
// common case and the byte budget below catches the heavy-URL case before
// setValue would fail. 12 is also plenty for real shopping (a few model /
// payment variants).
export const MAX_SAVED_SEARCHES = 12;
export const SYNC_ITEM_BUDGET_BYTES = 7000;
export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 200;

// Listing pages only: `/inventory/used/my`, `/en_CA/inventory/new/m3`. Not
// order pages. Distinct from isUsedInventoryPath (src/vin.ts), which gates the
// used-only highlight/Track features.
const LISTING_RE = /(^|\/)inventory\/(used|new)(\/|$)/i;

export function isInventoryListingPath(pathname: string): boolean {
  return LISTING_RE.test(pathname);
}

export function conditionFromPath(pathname: string): SearchCondition | null {
  const m = pathname.match(LISTING_RE);
  if (!m) return null;
  return m[2]?.toLowerCase() === 'new' ? 'new' : 'used';
}

// Canonical form of a listing URL: hash dropped, empty params dropped, params
// sorted. Tesla reorders/rewrites its own query string between loads, so both
// the stored URL and comparisons go through this.
export function normalizeSearchUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href, 'https://www.tesla.com');
  } catch {
    return href.split('#')[0] ?? href;
  }
  const pairs = [...url.searchParams.entries()].filter(([, v]) => v !== '');
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? cmp(av, bv) : cmp(ak, bk)));
  const qs = new URLSearchParams(pairs).toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

export function isSameSearchUrl(a: string, b: string): boolean {
  return normalizeSearchUrl(a) === normalizeSearchUrl(b);
}

// "$25,000" → 25000, "2,000" → 2000, "" → null.
export function parseDigits(text: string | null | undefined): number | null {
  const digits = (text ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

// Keep only the sliders the user moved off their bounds.
export function userSetRanges(
  ranges: CapturedView['ranges'],
): Partial<Record<RangeKey, SavedRange>> {
  const out: Partial<Record<RangeKey, SavedRange>> = {};
  for (const key of RANGE_KEYS) {
    const r = ranges[key];
    if (!r) continue;
    if (r.min !== r.boundMin || r.max !== r.boundMax) out[key] = { min: r.min, max: r.max };
  }
  return out;
}

// ─── Description ───

const SORT_LABELS: Record<string, string> = {
  plh: 'Price ↑',
  phl: 'Price ↓',
  mlh: 'Miles ↑',
  mhl: 'Miles ↓',
  ylh: 'Newest',
  yhl: 'Oldest',
  distance: 'Nearest',
};

// Tesla's checkbox labels are long; shorten the common ones so a description
// fits on a line. Unknown labels pass through untouched.
const SHORT_LABELS: Record<string, string> = {
  'No Reported Accidents/Damage': 'No accidents',
  'Previously Repaired': 'Repaired',
  'Available for Demo Drive': 'Demo drive',
  'Five Seat Interior': '5 seats',
  'Six Seat Interior': '6 seats',
  'Seven Seat Interior': '7 seats',
  'Full Self-Driving (Supervised)': 'FSD',
  'Performance Upgrade': 'Perf. upgrade',
  'Acceleration Boost': 'Accel. boost',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  finance: 'Finance',
  lease: 'Lease',
};

const MAX_LABELS_PER_GROUP = 3;
const SEP = ' · ';
const DASH = '–';

// Groups whose state is expressed elsewhere in the description (or in the URL
// only) and must not be listed as plain labels.
const NON_LABEL_GROUPS = new Set(['Model', 'PaymentType', 'paymentRange', 'Odometer', 'Year']);

// 350 → "350", 25000 → "25k", 12500 → "12.5k". Only for money and mileage —
// years are never compacted.
export function compactAmount(n: number): string {
  if (n < 1000) return String(n);
  if (n % 1000 === 0) return `${n / 1000}k`;
  return `${(n / 1000).toFixed(1)}k`;
}

const shortLabel = (label: string): string => {
  const trimmed = label.replace(/\s+/g, ' ').trim();
  const short = SHORT_LABELS[trimmed];
  if (short) return short;
  // `18" Wheels` → `18"`
  return trimmed.replace(/^(\d+")\s+Wheels$/i, '$1');
};

const joinLabels = (labels: string[]): string => {
  const shown = labels.slice(0, MAX_LABELS_PER_GROUP);
  const extra = labels.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
};

// "$25k–$35k", "≤ $35k", "≥ $400" — one-sided when only one end was moved.
const formatSpan = (
  r: CapturedRange,
  fmt: (n: number) => string,
  suffix = '',
): string => {
  const minMoved = r.min !== r.boundMin;
  const maxMoved = r.max !== r.boundMax;
  if (minMoved && maxMoved) return `${fmt(r.min)}${DASH}${fmt(r.max)}${suffix}`;
  if (maxMoved) return `≤ ${fmt(r.max)}${suffix}`;
  return `≥ ${fmt(r.min)}${suffix}`;
};

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const conditionLabel = (c: SearchCondition): string => (c === 'new' ? 'New' : 'Used');

export function defaultName(view: CapturedView): string {
  return `${conditionLabel(view.condition)} ${view.model ?? 'inventory'}`;
}

export function describeView(view: CapturedView): string {
  const parts: string[] = [defaultName(view)];

  const trimGroup = view.groups.find((g) => g.key === 'TRIM');
  if (trimGroup && trimGroup.labels.length > 0) {
    parts.push(joinLabels(trimGroup.labels.map((l) => abbreviateTrim(l))));
  }

  const sym = view.currencySymbol || '$';
  const pt = view.paymentType?.toLowerCase() ?? null;
  const payment = view.ranges.paymentRange;
  const paymentMoved =
    payment !== undefined && (payment.min !== payment.boundMin || payment.max !== payment.boundMax);
  if (pt) {
    const label = PAYMENT_LABELS[pt] ?? capitalize(pt);
    if (payment && paymentMoved) {
      const perMonth = pt === 'cash' ? '' : '/mo';
      parts.push(`${label} ${formatSpan(payment, (n) => `${sym}${compactAmount(n)}`, perMonth)}`);
    } else if (pt !== 'cash') {
      parts.push(label);
    }
  } else if (payment && paymentMoved) {
    parts.push(formatSpan(payment, (n) => `${sym}${compactAmount(n)}`));
  }

  const odo = view.ranges.Odometer;
  if (odo && (odo.min !== odo.boundMin || odo.max !== odo.boundMax)) {
    parts.push(formatSpan(odo, compactAmount, ` ${view.distanceUnit}`));
  }

  const year = view.ranges.Year;
  if (year && (year.min !== year.boundMin || year.max !== year.boundMax)) {
    const minMoved = year.min !== year.boundMin;
    const maxMoved = year.max !== year.boundMax;
    if (minMoved && maxMoved) parts.push(`${year.min}${DASH}${year.max}`);
    else if (minMoved) parts.push(`${year.min}+`);
    else parts.push(`≤ ${year.max}`);
  }

  for (const g of view.groups) {
    if (g.key === 'TRIM' || NON_LABEL_GROUPS.has(g.key) || g.labels.length === 0) continue;
    parts.push(joinLabels(g.labels.map(shortLabel)));
  }

  const sort = view.sort ? SORT_LABELS[view.sort] : undefined;
  if (sort) parts.push(sort);

  if (view.zip) {
    if (view.range === null) parts.push(view.zip);
    else if (view.range <= 0) parts.push(`${view.zip} (any distance)`);
    else parts.push(`${view.zip} (${view.range} ${view.distanceUnit})`);
  }

  return truncate(parts.join(SEP), MAX_DESCRIPTION_LENGTH);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Tesla renders a collapsed accordion's inputs lazily, so a group the user
// filtered and then collapsed (or one Tesla applied from the URL on load) has
// no DOM to read. Its state is still in the URL; map the codes back to labels.
const URL_VALUE_LABELS: Record<string, Record<string, string>> = {
  WHEELS: { EIGHTEEN: '18"', NINETEEN: '19"', TWENTY: '20"', TWENTY_ONE: '21"', TWENTY_TWO: '22"' },
  AUTOPILOT: { AUTOSTEER: 'Autosteer', FSD: 'FSD', ENHANCED_AUTOPILOT: 'Enhanced Autopilot' },
  CABIN_CONFIG: { FIVE: '5 seats', SIX: '6 seats', SEVEN: '7 seats' },
  ADL_OPTS: { PERFORMANCE_UPGRADE: 'Perf. upgrade', TOWING: 'Tow hitch', ACCELERATION_BOOST: 'Accel. boost' },
  VehicleHistory: { CLEAN: 'No accidents', 'PREVIOUS ACCIDENT(S)': 'Repaired' },
  DemoDrive: { true: 'Demo drive' },
};

// Query params that are not checkbox groups (or are described elsewhere).
const URL_NON_GROUP_PARAMS = new Set([
  'arrangeby',
  'zip',
  'range',
  'lat',
  'lng',
  'titleStatus',
  'source',
  'Model',
  'PaymentType',
  ...RANGE_KEYS,
]);

const TRIM_TOKENS: Record<string, string> = {
  LR: 'Long Range',
  SR: 'Standard Range',
  PR: 'Premium',
  P: 'Performance',
  PLAID: 'Plaid',
  RWD: 'Rear-Wheel Drive',
  AWD: 'All-Wheel Drive',
};

// `MY_LR_AWD` → "Long Range All-Wheel Drive"; unknown tokens pass through.
const trimFromCode = (code: string): string =>
  code
    .replace(/^(MY|M3|MS|MX|CT)_/i, '')
    .split('_')
    .map((t) => TRIM_TOKENS[t.toUpperCase()] ?? capitalize(t.toLowerCase()))
    .join(' ');

// `PREMIUM_BLACK` → "Premium black" as a last resort.
const prettifyCode = (code: string): string => capitalize(code.replace(/_/g, ' ').toLowerCase());

export function groupsFromUrl(search: string, capturedKeys: Iterable<string>): CapturedGroup[] {
  const have = new Set(capturedKeys);
  const out: CapturedGroup[] = [];
  for (const [key, raw] of new URLSearchParams(search).entries()) {
    if (URL_NON_GROUP_PARAMS.has(key) || have.has(key)) continue;
    const values = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const labels = values.map((v) =>
      key === 'TRIM' ? trimFromCode(v) : (URL_VALUE_LABELS[key]?.[v] ?? prettifyCode(v)),
    );
    out.push({ key, title: key, labels });
  }
  return out;
}

// ─── List operations ───

// What a search is called in lists and messages: the custom name if the user
// set one, else the auto description. Searches are deliberately NOT given a
// generated name — "Used Model Y (2)" says nothing the description doesn't.
export function searchLabel(search: SavedSearch): string {
  return search.name || search.description;
}

// Same, kept short enough for a one-line status message.
export function searchLabelShort(search: SavedSearch, max = 48): string {
  return truncate(searchLabel(search), max);
}

const cleanName = (name: string): string =>
  truncate(name.replace(/\s+/g, ' ').trim(), MAX_NAME_LENGTH);

export function createSavedSearch(
  view: CapturedView,
  href: string,
  now: number,
  id: string,
  name = '',
): SavedSearch {
  return {
    id,
    name: cleanName(name),
    description: describeView(view),
    url: normalizeSearchUrl(href),
    condition: view.condition,
    ranges: userSetRanges(view.ranges),
    createdAt: now,
  };
}

export const rangesEqual = (a: SavedSearch['ranges'], b: SavedSearch['ranges']): boolean =>
  RANGE_KEYS.every((key) => {
    const x = a[key];
    const y = b[key];
    if (!x && !y) return true;
    return !!x && !!y && x.min === y.min && x.max === y.max;
  });

// "Current" means the page IS this search: same listing URL and the sliders
// where the search saved them. `pageRanges` is the page's user-set slider state
// (see userSetRanges), so several searches saved from one URL with different
// sliders never all light up at once.
export function isCurrentSearch(
  search: SavedSearch,
  href: string,
  pageRanges: SavedSearch['ranges'],
): boolean {
  return isSameSearchUrl(href, search.url) && rangesEqual(search.ranges, pageRanges);
}

export function findDuplicate(searches: SavedSearches, candidate: SavedSearch): SavedSearch | undefined {
  return searches.find((s) => s.url === candidate.url && rangesEqual(s.ranges, candidate.ranges));
}

export function byteSize(searches: SavedSearches): number {
  return new TextEncoder().encode(JSON.stringify(searches)).length;
}

export type AddSearchResult =
  | { ok: true; searches: SavedSearches }
  | { ok: false; reason: 'duplicate'; existingId: string }
  | { ok: false; reason: 'full' | 'quota' };

// Newest first, so the panel shows what was just saved at the top.
export function addSearch(searches: SavedSearches, search: SavedSearch): AddSearchResult {
  const dup = findDuplicate(searches, search);
  if (dup) return { ok: false, reason: 'duplicate', existingId: dup.id };
  if (searches.length >= MAX_SAVED_SEARCHES) return { ok: false, reason: 'full' };
  const next = [search, ...searches];
  if (byteSize(next) > SYNC_ITEM_BUDGET_BYTES) return { ok: false, reason: 'quota' };
  return { ok: true, searches: next };
}

export function removeSearch(searches: SavedSearches, id: string): SavedSearches {
  return searches.filter((s) => s.id !== id);
}

// Set or clear the custom name: whitespace is trimmed, the length capped, and
// an empty name removes the custom label so the description shows again.
export function renameSearch(searches: SavedSearches, id: string, name: string): SavedSearches {
  const clean = cleanName(name);
  return searches.map((s) => (s.id === id && s.name !== clean ? { ...s, name: clean } : s));
}

// ─── Restore helpers ───

export type Bounds = { min: number; max: number };

// A missing saved range means the slider was at its bounds when the search was
// saved. When restoring in place, turn that omission back into an explicit
// bounds target if the page currently has a restriction; otherwise there is
// nothing to write. A missing DOM bounds read means the slider is unavailable
// on this page (for example Odometer on new inventory), so skip it.
export function restoreRangeTarget(
  saved: SavedRange | undefined,
  current: Bounds,
  bounds: Bounds | null,
): SavedRange | null {
  if (saved) return saved;
  if (!bounds) return null;
  return current.min === bounds.min && current.max === bounds.max ? null : bounds;
}

const clamp = (n: number, b: Bounds): number => Math.min(Math.max(n, b.min), b.max);

// A saved value can fall outside today's data-driven bounds (inventory moved).
// Tesla clamps such writes, so aim for the clamped value and keep min ≤ max.
export function clampRange(target: SavedRange, bounds: Bounds): SavedRange {
  const min = clamp(target.min, bounds);
  const max = clamp(target.max, bounds);
  return min <= max ? { min, max } : { min: max, max };
}

// Tesla clamps each end against the other one's *current* value: writing a min
// above the current max gets clamped to that max. Write the end that moves the
// window "outward" first so the second write has room.
export function planRangeWrites(target: SavedRange, current: Bounds): Array<'min' | 'max'> {
  return target.min > current.max ? ['max', 'min'] : ['min', 'max'];
}

// True once the page shows the target (or its clamped equivalent), which ends
// the verify-and-retry loop without spinning on an unreachable value.
export function rangeWriteSettled(target: SavedRange, readBack: Bounds, bounds: Bounds): boolean {
  const want = clampRange(target, bounds);
  return readBack.min === want.min && readBack.max === want.max;
}
