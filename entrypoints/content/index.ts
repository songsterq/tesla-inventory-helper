import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  highlightingEnabledItem,
  rulesItem,
  savedCarsItem,
  savedSearchesItem,
  searchWatchItem,
} from '../../src/storage';
import { whenStorageReady } from '../../src/storageReady';
import { evalRules, type Rules } from '../../src/rules';
import {
  carKeyFromDataId,
  extractVin,
  extractVinFromOrderPath,
  isUsedInventoryPath,
  isUsedOrderUrl,
} from '../../src/vin';
import { decodeTeslaVin, type TeslaModel } from '../../src/decoder';
import {
  addCar,
  createSavedCar,
  makeSnapshot,
  parseMileage,
  parsePrice,
  parseTrim,
  pickBestPrice,
  removeCar,
  type SavedCars,
} from '../../src/savedCars';
import { paintNameFromSwatchSrc } from '../../src/paint';
import { pollWithTimeout } from '../../src/asyncPoll';
import {
  addSearch,
  clampRange,
  conditionFromPath,
  createSavedSearch,
  distanceUnitFromPath,
  groupsFromUrl,
  isCurrentSearch,
  isInventoryListingPath,
  isSameListing,
  parseDigits,
  planRangeWrites,
  RANGE_KEYS,
  rangeWriteSettled,
  removeSearch,
  renameSearch,
  setSearchAlerts,
  restoreRangeTarget,
  savedSearchRange,
  searchLabelShort,
  userSetRanges,
  withSearchedRange,
  type Bounds,
  type CapturedGroup,
  type CapturedRange,
  type CapturedView,
  type RangeKey,
  type SavedRange,
  type SavedSearch,
  type SavedSearches,
} from '../../src/savedSearches';
import {
  asInventoryRequest,
  collectSearchResults,
  newCountsById,
  parseInventoryRequestUrl,
  requestRange,
  requestsEqual,
  requestSlidersMatch,
  validSearchWatch,
  type InventoryRequest,
  type SearchResults,
  type SearchWatch,
  type SliderValues,
} from '../../src/searchWatch';
import {
  mountSearchPanel,
  renderSearchList,
  setPanelStatus,
  setSearchNewCounts,
  unmountSearchPanel,
  type SearchPanelHandlers,
} from './searchPanel';
import {
  clearTrackButtons,
  disposeTrackButtons,
  mountTrackButton,
  updateTrackButtons,
} from './trackButton';
import './style.css';

// Result of scraping the current order page for the monitoring feature.
type ScrapeResult =
  | { ready: false }
  | {
      ready: true;
      vin: string | null;
      price: number | null;
      currency: string | null;
      available: boolean;
    };

const MODEL_SLUG: Record<TeslaModel, string> = {
  'Model S': 'ms',
  'Model 3': 'm3',
  'Model X': 'mx',
  'Model Y': 'my',
  'Model Y L': 'my',
  Cybertruck: 'ct',
};

// ─── BRITTLE: tesla.com DOM scraping. Keep guarded; never throw. ───
// Gate for scrape diagnostics (mirrors the third-party script's flag). MUST be
// false in release builds — see AGENTS.md.
const DEBUG = false;

const PRICE_EXCLUDE = /reduc|save|\boff\b|\bwas\b|\/mo|per month|month|lease|\bdue\b|down/i;

const UNAVAILABLE_MARKERS = [
  'no longer available',
  'is no longer available',
  'sold out',
  'has been sold',
];

// Scrape a price scoped to `root` so saving from an inventory card reads that
// card's price (not the whole page). Prefers Tesla's dedicated price element,
// else picks the real purchase price out of the text (ignoring "Reduced by",
// "$/mo", "Was $X", etc.). Never throws — returns nulls on miss.
function scrapePriceIn(root: HTMLElement): { value: number | null; currency: string | null } {
  const tds = root.querySelector<HTMLElement>('.tds-price')?.textContent?.trim();
  if (tds && !PRICE_EXCLUDE.test(tds)) {
    const parsed = parsePrice(tds);
    if (parsed.value !== null) return parsed;
  }
  return pickBestPrice(root.textContent ?? '');
}

function scrapeTrim(root: HTMLElement): string | null {
  return parseTrim(root.textContent ?? '');
}

const cleanPaintName = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const name = raw.replace(/\s*paint\b/i, '').replace(/\s+/g, ' ').trim();
  return name.length >= 3 && name.length <= 30 ? name : null;
};

function scrapePaintName(root: HTMLElement): string | null {
  // (a) Order pages: the Capitalized phrase before the word "Paint" ("Stealth Grey
  // Paint" feature line). innerText, not textContent — textContent glues adjacent
  // nodes ("…Paint19'' Gemini…") which kills the \b after "Paint". Separators stay
  // within a line so a preceding unrelated line can't join the capture.
  const named = (root.innerText ?? '').match(/([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,3}) ?Paint\b/);
  const fromText = cleanPaintName(named?.[1]);
  if (fromText) return fromText;
  // (b) Inventory cards: no name in visible text — the card's "Paint" feature-list
  // item wraps a swatch <img> next to a label whose own text is literally "Paint".
  // Find that item by its label (not by the image src, which isn't reliably
  // prefixed — see paintNameFromSwatchSrc) and derive the name from its swatch.
  const paintLabel = Array.from(root.querySelectorAll<HTMLElement>('span,div')).find(
    (el) => el.children.length === 0 && el.textContent?.trim() === 'Paint',
  );
  const labelledSrc = paintLabel
    ?.closest('div,li')
    ?.querySelector<HTMLImageElement>('img[src]')
    ?.getAttribute('src');
  const fromLabel = paintNameFromSwatchSrc(labelledSrc);
  if (fromLabel) return fromLabel;
  // (c) Last resort: any swatch image whose filename still carries the "Paint_"
  // prefix (covers layouts where the label lookup above doesn't apply).
  const src = root.querySelector<HTMLImageElement>('img[src*="Paint_" i]')?.getAttribute('src');
  return paintNameFromSwatchSrc(src);
}

function detectUnavailable(): boolean {
  const text = (document.body?.innerText ?? '').toLowerCase();
  return UNAVAILABLE_MARKERS.some((marker) => text.includes(marker));
}

// Returns {ready:false} while the SPA is still rendering so the worker keeps
// polling; only reports availability/price once it can make a determination.
function scrapeCar(): ScrapeResult {
  const vin = extractVinFromOrderPath(location.pathname);
  if (detectUnavailable()) {
    return { ready: true, vin, price: null, currency: null, available: false };
  }
  const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
  if (container) {
    const { value, currency } = scrapePriceIn(container);
    if (value !== null) return { ready: true, vin, price: value, currency, available: true };
  }
  return { ready: false };
}

// ─── Saved searches: sidebar capture + radius and slider restore ───
//
// tesla.com keeps checkbox/radio filters, sort and zip in the URL but NOT the
// three sliders (Payment, Mileage, Year), and it ignores them if passed as
// query params. The radius is in the URL but Tesla searches its own stored
// radius on load (see VIEW_IGNORED_PARAMS in src/savedSearches.ts). So a saved
// search is the URL plus the slider values, and a restore writes the radius and
// the sliders back into the page after it loads.

const SIDEBAR_SEL = 'div.filter-content-wrapper';
const SLIDER_WAIT_MS = 15_000;
const SLIDER_POLL_MS = 250;
const SLIDER_SETTLE_MS = 800;
const SLIDER_ATTEMPTS = 6;
const SLIDER_FINAL_PASS_MS = 2500;
const UNBOUNDED: Bounds = { min: -Infinity, max: Infinity };
const RANGE_KEY_LABELS: Record<RangeKey, string> = {
  paymentRange: 'payment',
  Odometer: 'mileage',
  Year: 'year',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Each slider is backed by two text boxes (`inputMin-<KEY>` / `inputMax-<KEY>`)
// that display formatted values ("$25,000", "2,000"), plus two native range
// inputs that carry the numeric bounds.
const rangeTextInput = (key: RangeKey, end: 'Min' | 'Max'): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>(`input[name="input${end}-${key}"]`);

const rangeBounds = (textInput: HTMLInputElement): Bounds | null => {
  const widget = textInput.closest<HTMLElement>('.dual-range-input--container')?.parentElement;
  const sliders = widget?.querySelectorAll<HTMLInputElement>(
    'input.dual-range-slider-input[type="range"]',
  );
  if (!sliders || sliders.length < 2) return null;
  const min = Number(sliders[0]?.min);
  const max = Number(sliders[1]?.max);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
};

type RangeRead = { current: Bounds; bounds: Bounds | null };

const readRange = (key: RangeKey): RangeRead | null => {
  const minEl = rangeTextInput(key, 'Min');
  const maxEl = rangeTextInput(key, 'Max');
  if (!minEl || !maxEl) return null;
  const min = parseDigits(minEl.value);
  const max = parseDigits(maxEl.value);
  if (min === null || max === null) return null;
  return { current: { min, max }, bounds: rangeBounds(minEl) };
};

const captureRange = (key: RangeKey): CapturedRange | null => {
  const r = readRange(key);
  if (!r) return null;
  const bounds = r.bounds ?? r.current;
  return { min: r.current.min, max: r.current.max, boundMin: bounds.min, boundMax: bounds.max };
};

const cleanText = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

// Paint/Interior inputs have no data-id, but every sidebar input has an id
// with a matching <label for>, so labels come from there.
const labelFor = (input: HTMLInputElement): string | null => {
  const byFor = input.id
    ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(input.id)}"]`)
    : null;
  const text = cleanText((byFor ?? input.closest('label'))?.textContent);
  return text || null;
};

// Every filter group is `div.filter.filter-<KEY>` where KEY is Tesla's URL param
// name. Model and PaymentType are captured separately; slider groups have no
// checkboxes to list.
const GROUP_KEY_RE = /^filter-([A-Za-z][A-Za-z_]*)$/;
const NON_GROUP_KEYS = new Set<string>(['Model', 'PaymentType', ...RANGE_KEYS]);

function captureGroups(sidebar: HTMLElement): CapturedGroup[] {
  const out: CapturedGroup[] = [];
  for (const group of sidebar.querySelectorAll<HTMLElement>('div.filter')) {
    const key = Array.from(group.classList)
      .map((c) => GROUP_KEY_RE.exec(c)?.[1])
      .find((k): k is string => !!k);
    if (!key || NON_GROUP_KEYS.has(key)) continue;
    const title = cleanText(group.querySelector('summary')?.textContent) || key;
    const labels = Array.from(group.querySelectorAll<HTMLInputElement>('input:checked'))
      .map(labelFor)
      .filter((l): l is string => !!l);
    out.push({ key, title, labels });
  }
  return out;
}

const captureModel = (sidebar: HTMLElement): string | null => {
  const checked = sidebar.querySelector<HTMLInputElement>('div.filter-Model input:checked');
  return checked ? labelFor(checked) : null;
};

const capturePaymentType = (sidebar: HTMLElement): string | null => {
  const checked = sidebar.querySelector<HTMLInputElement>('div.filter-PaymentType input:checked');
  if (!checked) return null;
  const fromDataId = /^(.+)-PaymentType-filter$/.exec(checked.getAttribute('data-id') ?? '')?.[1];
  return fromDataId ?? (checked.value || null);
};

// Snapshot everything the description needs. Null when this isn't a listing
// page or the sidebar hasn't rendered — never throws. `href` is the page URL
// with the searched radius filled in, so the description names the radius the
// page really shows.
function captureView(href: string): CapturedView | null {
  const condition = conditionFromPath(location.pathname);
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SEL);
  if (!condition || !sidebar) return null;
  let params: URLSearchParams;
  try {
    params = new URL(href, location.origin).searchParams;
  } catch {
    params = new URLSearchParams(location.search);
  }
  const ranges: CapturedView['ranges'] = {};
  for (const key of RANGE_KEYS) {
    const r = captureRange(key);
    if (r) ranges[key] = r;
  }
  const paymentText = rangeTextInput('paymentRange', 'Min')?.value ?? '';
  const currencySymbol = /^[^\d]+/.exec(paymentText)?.[0]?.trim() || '$';
  // Tesla shows no unit next to the odometer boxes; fall back to the locale
  // prefix (everything outside the US/UK paths reads in km).
  const odometerText = rangeTextInput('Odometer', 'Min')?.closest('div.filter')?.textContent ?? '';
  const distanceUnit: 'mi' | 'km' =
    /\bkm\b/i.test(odometerText) ? 'km' : distanceUnitFromPath(location.pathname);
  const rangeParam = params.get('range');
  const radius = rangeParam !== null && rangeParam !== '' ? Number(rangeParam) : NaN;
  const domGroups = captureGroups(sidebar);
  return {
    condition,
    model: captureModel(sidebar),
    paymentType: capturePaymentType(sidebar),
    // Collapsed accordions have no inputs in the DOM; fill those from the URL.
    groups: [...domGroups, ...groupsFromUrl(params.toString(), domGroups.map((g) => g.key))],
    ranges,
    currencySymbol,
    distanceUnit,
    sort: params.get('arrangeby'),
    zip: params.get('zip'),
    range: Number.isFinite(radius) ? radius : null,
  };
}

// The page's current user-set slider state, in the same shape a search stores,
// so the panel can tell which saved search (if any) the page is showing.
function currentPageRanges(): SavedSearch['ranges'] {
  const captured: CapturedView['ranges'] = {};
  for (const key of RANGE_KEYS) {
    const r = captureRange(key);
    if (r) captured[key] = r;
  }
  return userSetRanges(captured);
}

// The ONLY write path that makes Tesla's React app accept a slider value and
// refetch results (verified): set the text box through the native value setter
// (so React's own tracker sees a change), then input + change + Enter + blur.
// Dispatching on the native range inputs updates the thumbs but never refetches.
function writeRangeEnd(el: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  el.focus();
  if (setter) setter.call(el, String(value));
  else el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
  );
  el.blur();
}

// Write one slider and verify it stuck, retrying a few times: Tesla re-renders
// the sidebar as results load, and clamps each end against the other's current
// value (hence planRangeWrites) and against the data-driven bounds (hence
// clampRange / rangeWriteSettled). Inputs are re-queried on every attempt
// because a re-render can replace the nodes.
async function applyRange(key: RangeKey, target: SavedRange): Promise<boolean> {
  const ready = await pollWithTimeout<true>(() => (readRange(key) ? true : null), {
    intervalMs: SLIDER_POLL_MS,
    timeoutMs: SLIDER_WAIT_MS,
  });
  if (!ready) return false;
  for (let attempt = 0; attempt < SLIDER_ATTEMPTS; attempt++) {
    const r = readRange(key);
    if (!r) return false;
    const bounds = r.bounds ?? UNBOUNDED;
    if (rangeWriteSettled(target, r.current, bounds)) return true;
    const want = clampRange(target, bounds);
    for (const end of planRangeWrites(want, r.current)) {
      if (r.current[end] === want[end]) continue;
      const input = rangeTextInput(key, end === 'min' ? 'Min' : 'Max');
      if (!input) break;
      writeRangeEnd(input, want[end]);
      await sleep(SLIDER_SETTLE_MS);
    }
  }
  const final = readRange(key);
  return !!final && rangeWriteSettled(target, final.current, final.bounds ?? UNBOUNDED);
}

// The radius dropdown lives in Tesla's "Search Area" dialog, opened from the ZIP
// link in the listing header, and leaves the DOM when the dialog closes. Setting
// it through the native value setter plus `change` makes Tesla refetch, rewrite
// the URL's `range` and store the new radius (verified Nov 2026). Options are
// Tesla's radii in the listing's unit; 0 is "All Deliverable".
const SEARCH_AREA_OPEN_SEL = '.postal-code-results-cta button';
const SEARCH_AREA_DIALOG_SEL = 'dialog.postal-search-modal--container';
const RADIUS_SELECT_SEL = 'select[data-id="search-radius-dropdown"]';
const SEARCH_AREA_POLL_MS = 100;
const SEARCH_AREA_WAIT_MS = 5000;
const RADIUS_REQUEST_WAIT_MS = 10_000;

function closeSearchArea(): void {
  const dialog = document.querySelector<HTMLDialogElement>(SEARCH_AREA_DIALOG_SEL);
  if (!dialog) return;
  const close = dialog.querySelector<HTMLElement>('button.tds-modal-close');
  if (close) close.click();
  else dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

// Set Tesla's search radius and wait for its request at that radius, so the
// slider restore that follows sees bounds for the new results. `searchedRange`
// reads the radius of Tesla's latest request (null until one is observed).
async function applyRadius(target: number, searchedRange: () => number | null): Promise<boolean> {
  // Tesla's first request has usually landed by now; waiting for it skips the
  // dialog entirely when the stored radius already matches.
  const initial = await pollWithTimeout(searchedRange, {
    intervalMs: SLIDER_POLL_MS,
    timeoutMs: RADIUS_REQUEST_WAIT_MS,
  });
  if (initial === target) return true;
  const opener = await pollWithTimeout(
    () => document.querySelector<HTMLElement>(SEARCH_AREA_OPEN_SEL),
    { intervalMs: SLIDER_POLL_MS, timeoutMs: SLIDER_WAIT_MS },
  );
  if (!opener) return false;
  opener.click();
  const value = String(target);
  let set = false;
  try {
    const select = await pollWithTimeout(
      () => document.querySelector<HTMLSelectElement>(RADIUS_SELECT_SEL),
      { intervalMs: SEARCH_AREA_POLL_MS, timeoutMs: SEARCH_AREA_WAIT_MS },
    );
    // A radius Tesla doesn't offer here (another market's units, say) fails
    // rather than picking a neighbour.
    if (select && Array.from(select.options).some((o) => o.value === value)) {
      if (select.value !== value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(select, value);
        else select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      set = select.value === value;
    }
  } finally {
    closeSearchArea();
  }
  if (!set) return false;
  await pollWithTimeout(() => (searchedRange() === target ? true : null), {
    intervalMs: SLIDER_POLL_MS,
    timeoutMs: RADIUS_REQUEST_WAIT_MS,
  });
  return true;
}

type ApplyResult = { applied: RangeKey[]; failed: RangeKey[] };

// Sequential on purpose — each write triggers a results refetch, and serial
// read-backs are unambiguous. A final pass a moment later catches a late
// sidebar re-render undoing an earlier write.
async function applyRanges(ranges: SavedSearch['ranges']): Promise<ApplyResult> {
  const applied: RangeKey[] = [];
  const failed: RangeKey[] = [];
  const targets: Partial<Record<RangeKey, SavedRange>> = {};
  for (const key of RANGE_KEYS) {
    const initial = readRange(key);
    const target = initial
      ? restoreRangeTarget(ranges[key], initial.current, initial.bounds)
      : ranges[key] ?? null;
    if (!target) continue;
    targets[key] = target;
    if (await applyRange(key, target)) applied.push(key);
    else failed.push(key);
  }
  if (applied.length > 0) {
    await sleep(SLIDER_FINAL_PASS_MS);
    for (const key of applied) {
      const target = targets[key];
      const r = readRange(key);
      if (!target || !r) continue;
      if (rangeWriteSettled(target, r.current, r.bounds ?? UNBOUNDED)) continue;
      if (!(await applyRange(key, target))) failed.push(key);
    }
  }
  return { applied: applied.filter((k) => !failed.includes(k)), failed };
}

// ─── Saved searches: Tesla's inventory API ───
//
// Listing pages load results from /inventory/api/v4/inventory-results. The
// endpoint 403s the extension's service worker (Akamai) but answers this
// content script like the page itself, so every call for "new matches" runs
// here — on the page the shopper is viewing (baseline) or in the hidden check
// tab the worker opens. See src/searchWatch.ts.

const SEARCH_FETCH_TIMEOUT_MS = 15_000;
const SEARCH_PAGE_PAUSE_MS = 300;
// A reused tab can show a different search. Our fetches must never replace
// Tesla's request for that page; also covers baseline fetches on visible pages.
const ownSearchUrls = new Set<string>();
const OWN_SEARCH_URL_LIMIT = 50;
// After the request a view starts from, how long until its cards count as
// rendered (tags appear, the first view report goes out).
const VIEW_SETTLE_MS = 1000;
// Coalesces view reports while infinite scroll renders more cards.
const VIEW_REPORT_DEBOUNCE_MS = 1000;

// The live slider values (not just user-set ones), for matching a captured
// request against what the page shows.
function liveSliderValues(): SliderValues {
  const out: SliderValues = {};
  for (const key of RANGE_KEYS) {
    const r = readRange(key);
    if (r) out[key] = r.current;
  }
  return out;
}

async function fetchInventoryJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_FETCH_TIMEOUT_MS);
  try {
    const url = new URL(path, location.origin).href;
    ownSearchUrls.delete(url);
    ownSearchUrls.add(url);
    if (ownSearchUrls.size > OWN_SEARCH_URL_LIMIT) {
      ownSearchUrls.delete(ownSearchUrls.values().next().value!);
    }
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fetchSearchResults(
  request: InventoryRequest,
): Promise<(SearchResults & { truncated: boolean }) | null> {
  return collectSearchResults(request, fetchInventoryJson, {
    pauseMs: SEARCH_PAGE_PAUSE_MS,
    sleep,
  });
}
// ─── end brittle section ───

export default defineContentScript({
  matches: [
    'https://www.tesla.com/inventory/*',
    'https://www.tesla.com/*/inventory/*',
    'https://www.tesla.com/*/order/*',
  ],
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main(ctx) {
    await whenStorageReady();
    let rules: Rules = await rulesItem.getValue();
    let highlightingEnabled = await highlightingEnabledItem.getValue();
    let searches: SavedSearches = await savedSearchesItem.getValue();
    let cars: SavedCars = await savedCarsItem.getValue();
    updateTrackButtons(cars);
    let searchWatch: SearchWatch = validSearchWatch(await searchWatchItem.getValue());
    setSearchNewCounts(newCountsById(searchWatch));
    let scheduled = false;

    const setGlow = (el: HTMLElement, ruleName: string | null) => {
      if (ruleName) {
        el.classList.add('tih-glow');
        el.dataset.tihMatch = ruleName;
      } else {
        el.classList.remove('tih-glow');
        delete el.dataset.tihMatch;
      }
    };

    const clearGlows = () => {
      document.querySelectorAll<HTMLElement>('.tih-glow').forEach((el) => setGlow(el, null));
    };

    const clearMonitorUi = () => {
      clearGlows();
      clearTrackButtons();
    };

    // Tesla nests two `article[data-id]` elements per car: an outer wrapper with
    // `display: contents` (no box at all) around the real card. Decorating the
    // wrapper is what produced stray pills in the page corners — with no box, its
    // `position: relative` is a no-op and our absolutely-positioned overlays
    // resolve against the initial containing block instead. Keep only the
    // innermost article, which is the one that actually lays out.
    const inventoryCards = (): HTMLElement[] =>
      Array.from(
        document.querySelectorAll<HTMLElement>('main.inventory-content-wrapper article[data-id]'),
      ).filter((article) => !article.querySelector('article[data-id]'));

    const applyInventory = () => {
      const articles = inventoryCards();
      if (!highlightingEnabled) {
        articles.forEach((article) => setGlow(article, null));
        return;
      }

      articles.forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        const hit = vin ? evalRules(vin, rules) : null;
        setGlow(article, hit?.name ?? null);
      });
    };

    const applyOrder = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container) return;
      if (!highlightingEnabled) {
        setGlow(container, null);
        return;
      }

      const vin = extractVinFromOrderPath(location.pathname);
      const hit = vin ? evalRules(vin, rules) : null;
      setGlow(container, hit?.name ?? null);
    };

    const resolveInventoryUrl = (article: HTMLElement, vin: string): string => {
      const anchor =
        article.querySelector<HTMLAnchorElement>('a[href*="/order/"]') ??
        article.querySelector<HTMLAnchorElement>('a[href*="/inventory/"]');
      if (anchor?.href) return anchor.href;
      // Last resort: build an order-style URL from the decoded model.
      const info = decodeTeslaVin(vin);
      const slug = info?.model ? MODEL_SLUG[info.model] : null;
      return slug ? `${location.origin}/${slug}/order/${vin}` : location.href;
    };

    const driveLabel = (dt: string | null): string | null => {
      if (dt === 'Single Motor') return 'Rear-Wheel Drive';
      return dt ? 'All-Wheel Drive' : null;
    };

    // Scrape the card/summary the button lives in and add the car to the
    // watchlist. Builds from a fresh read so a track can't overwrite a removal,
    // reorder or check result that arrived since the last watch fired.
    const trackCar = async (
      vin: string,
      host: HTMLElement,
      urlFor: () => string,
      mileageText: () => string,
    ) => {
      const info = decodeTeslaVin(vin);
      if (!info) return;
      const current = await savedCarsItem.getValue();
      if (current.some((c) => c.vin === vin)) return;
      // Capture price + trim + paint from the card/summary this button lives in.
      const scraped = scrapePriceIn(host);
      const trim = scrapeTrim(host) ?? driveLabel(info.drivetrain);
      const paintName = scrapePaintName(host);
      const mileageSrc = mileageText();
      const mileage = parseMileage(mileageSrc);
      if (DEBUG) {
        console.debug('[TIH] mileage scrape', {
          vin,
          result: mileage,
          sample: mileageSrc.replace(/\s+/g, ' ').slice(0, 300),
        });
      }
      const snapshot = makeSnapshot(scraped.value, scraped.currency, 'available', Date.now());
      const result = addCar(
        current,
        createSavedCar(info, urlFor(), snapshot, {
          trim,
          paintName,
          mileage: mileage.value,
          mileageUnit: mileage.unit,
        }),
      );
      if (!result.ok) return;
      await savedCarsItem.setValue(result.cars);
      cars = result.cars;
      updateTrackButtons(cars);
    };

    const untrackCar = async (vin: string) => {
      const next = removeCar(await savedCarsItem.getValue(), vin);
      await savedCarsItem.setValue(next);
      cars = next;
      updateTrackButtons(cars);
    };

    // Mileage lives outside the summary container on order pages, so allow a
    // wider text source than `host`; inventory cards keep their own card text.
    // innerText, not textContent — textContent glues adjacent nodes ("42,956
    // miLocated in Renton"), which kills the \b after the unit.
    const attachTrackButton = (
      host: HTMLElement,
      vin: string,
      urlFor: () => string,
      mileageText: () => string = () => host.innerText ?? '',
    ) => {
      mountTrackButton(host, vin, {
        onTrack: () => trackCar(vin, host, urlFor, mileageText),
        onUntrack: untrackCar,
      });
    };

    const injectOrderButton = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container) return;
      const vin = extractVinFromOrderPath(location.pathname);
      if (!vin) return;
      // Odometer sits in a specs section outside the summary; the order page shows a
      // single car, so scan the whole page for it.
      attachTrackButton(container, vin, () => location.href, () => document.body?.innerText ?? '');
    };

    const injectInventoryButtons = () => {
      inventoryCards().forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        if (!vin) return;
        attachTrackButton(article, vin, () => resolveInventoryUrl(article, vin));
      });
    };

    // ─── Saved searches ───

    // Latest Tesla inventory request by start time. A slow reply to an older
    // request (filters since changed) must not replace a newer one.
    let lastRequest: { request: InventoryRequest; startTime: number } | null = null;

    // The page URL with the radius Tesla actually searched filled in when the
    // URL has none, which is what saving, the panel and viewing compare
    // against (see withSearchedRange).
    // The radius of Tesla's latest request: what the page really searched.
    const searchedRange = (): number | null =>
      lastRequest ? requestRange(lastRequest.request) : null;

    const pageSearchHref = (): string => withSearchedRange(location.href, searchedRange());

    const renderPanelList = () => renderSearchList(searches, pageSearchHref(), currentPageRanges());

    // `failed` names what couldn't be set ("search radius", "mileage", ...).
    const reportRestore = (search: SavedSearch, failed: string[]) => {
      const label = searchLabelShort(search);
      if (failed.length === 0) {
        setPanelStatus(`Applied "${label}".`, 'ok', 4000);
        return;
      }
      setPanelStatus(`Applied "${label}", but couldn't set ${failed.join(', ')}.`, 'error', 8000);
    };

    // The radius first (its refetch changes the sliders' data-driven bounds),
    // then the sliders one at a time, so the page passes through states that
    // match some other saved search. Viewing (which marks cars viewed) is paused
    // until the restore is done.
    let restoring = false;
    const restoreSearch = async (search: SavedSearch): Promise<string[]> => {
      restoring = true;
      endView();
      try {
        const failed: string[] = [];
        const radius = savedSearchRange(search);
        if (radius !== null && !(await applyRadius(radius, searchedRange))) {
          failed.push('search radius');
        }
        const sliders = await applyRanges(search.ranges ?? {});
        failed.push(...sliders.failed.map((k) => RANGE_KEY_LABELS[k]));
        return failed;
      } finally {
        restoring = false;
        evaluateView();
      }
    };

    const panelHandlers: SearchPanelHandlers = {
      onSave: async () => {
        const href = pageSearchHref();
        const view = captureView(href);
        if (!view) return { ok: false, reason: 'capture-failed' };
        const id = crypto.randomUUID().slice(0, 8);
        const search = createSavedSearch(view, href, Date.now(), id);
        // Build from a fresh read so a save cannot overwrite a rename, delete,
        // or save that arrived since this content script's watch last fired.
        const current = await savedSearchesItem.getValue();
        const result = addSearch(current, search);
        if (!result.ok) {
          if (result.reason === 'duplicate') {
            const existing = current.find((s) => s.id === result.existingId);
            return {
              ok: false,
              reason: 'duplicate',
              existingLabel: existing ? searchLabelShort(existing) : undefined,
            };
          }
          return { ok: false, reason: result.reason };
        }
        // A failed write throws through to the panel's "Couldn't save" status.
        await savedSearchesItem.setValue(result.searches);
        searches = result.searches;
        renderPanelList();
        return { ok: true, label: searchLabelShort(search) };
      },
      onOpen: async (search) => {
        // Same listing already loaded → just set the radius and sliders, no
        // navigation.
        if (isSameListing(location.href, search.url)) {
          setPanelStatus(`Applying "${searchLabelShort(search)}"…`, 'info');
          reportRestore(search, await restoreSearch(search));
          renderPanelList();
          return;
        }
        setPanelStatus(`Opening "${searchLabelShort(search)}"…`, 'info');
        const res = (await browser.runtime
          .sendMessage({ type: 'tih:open-search', id: search.id, newTab: false })
          .catch(() => null)) as { ok?: boolean } | null;
        if (!res?.ok) setPanelStatus("Couldn't open that search.", 'error', 6000);
      },
      onRename: async (id, name) => {
        const current = await savedSearchesItem.getValue();
        const next = renameSearch(current, id, name);
        if (next !== current) await savedSearchesItem.setValue(next);
      },
      onAlerts: async (id, on) => {
        const current = await savedSearchesItem.getValue();
        const next = setSearchAlerts(current, id, on);
        if (next !== current) await savedSearchesItem.setValue(next);
      },
      onDelete: async (id) => {
        await savedSearchesItem.setValue(removeSearch(await savedSearchesItem.getValue(), id));
      },
    };

    // On boot, ask the worker whether this tab was navigated here to restore a
    // search (see openSavedSearch in the background). Only listing pages can.
    const restorePendingSearch = async () => {
      if (!isInventoryListingPath(location.pathname)) return;
      const search = (await browser.runtime
        .sendMessage({ type: 'tih:pending-search' })
        .catch(() => null)) as SavedSearch | null;
      if (!search || typeof search !== 'object' || typeof search.description !== 'string') return;
      setPanelStatus(`Restoring "${searchLabelShort(search)}"…`, 'info');
      reportRestore(search, await restoreSearch(search));
      renderPanelList();
    };

    // ─── Saved searches: new matches ───
    //
    // While the page IS a saved search (URL and sliders match) and the tab is
    // visible, this page "views" it: Tesla's latest request is stored as that
    // search's query, everything new or rendered is marked viewed, and cards the
    // shopper hadn't viewed before get a "New" tag. A hidden tab — including the
    // worker's check tab — never views anything. The worker owns every write;
    // this side only reports.

    type SearchView = {
      id: string;
      request: InventoryRequest;
      // Known keys excluding unviewed arrivals when the view began. Cards
      // outside this snapshot stay "New" for this page session. null = no baseline.
      knownAtStart: Set<string> | null;
      settled: boolean; // results for this request have had time to render
      reported: Set<string>;
      reportedOnce: boolean;
      baselining: boolean;
    };
    let view: SearchView | null = null;
    let reportTimer: ReturnType<typeof setTimeout> | undefined;

    const renderedCardKeys = (): string[] =>
      inventoryCards()
        .map((article) => carKeyFromDataId(article.getAttribute('data-id')))
        .filter((v): v is string => !!v);

    const clearNewTags = () => {
      document.querySelectorAll<HTMLElement>('.tih-new').forEach((el) => el.classList.remove('tih-new'));
    };

    const applyNewTags = () => {
      const known = view?.settled ? view.knownAtStart : null;
      if (!known) {
        clearNewTags();
        return;
      }
      for (const article of inventoryCards()) {
        const key = carKeyFromDataId(article.getAttribute('data-id'));
        article.classList.toggle('tih-new', !!key && !known.has(key));
      }
    };

    const endView = () => {
      view = null;
      if (reportTimer !== undefined) clearTimeout(reportTimer);
      reportTimer = undefined;
      clearNewTags();
    };

    // Tell the worker what's on screen. The first report always goes out (it
    // carries the request even with no cards); later ones only for new cards.
    const reportView = async (v: SearchView) => {
      if (view !== v) return;
      const fresh = renderedCardKeys().filter((key) => !v.reported.has(key));
      if (v.reportedOnce && fresh.length === 0) return;
      v.reportedOnce = true;
      fresh.forEach((key) => v.reported.add(key));
      const res = (await browser.runtime
        .sendMessage({ type: 'tih:search-viewed', id: v.id, request: v.request, renderedKeys: fresh })
        .catch(() => null)) as { needsBaseline?: boolean } | null;
      if (!res?.needsBaseline || v.baselining || view !== v) return;
      // First view on this device: everything matching right now is the baseline.
      v.baselining = true;
      const results = await fetchSearchResults(v.request);
      if (DEBUG) console.debug('[TIH] search baseline', { id: v.id, results });
      if (!results) return;
      await browser.runtime
        .sendMessage({ type: 'tih:search-baseline', id: v.id, request: v.request, results })
        .catch(() => null);
    };

    const scheduleViewReport = () => {
      const v = view;
      if (!v?.settled || reportTimer !== undefined) return;
      reportTimer = setTimeout(() => {
        reportTimer = undefined;
        void reportView(v);
      }, VIEW_REPORT_DEBOUNCE_MS);
    };

    const startView = (id: string, request: InventoryRequest) => {
      endView();
      const entry = searchWatch[id];
      const known = entry?.known;
      const knownAtStart = known ? new Set(Object.keys(known)) : null;
      // Checks now remember arrivals immediately. They still need a tag until
      // viewed, and this snapshot must survive the worker clearing newKeys.
      for (const key of entry?.newKeys ?? []) knownAtStart?.delete(key);
      const v: SearchView = {
        id,
        request,
        knownAtStart,
        settled: false,
        reported: new Set(),
        reportedOnce: false,
        baselining: false,
      };
      view = v;
      if (DEBUG) console.debug('[TIH] search view', { id, request });
      // Give the results of this request time to replace the previous cards, so
      // neither the tags nor the view report pick up the old ones.
      setTimeout(() => {
        if (view !== v) return;
        v.settled = true;
        applyNewTags();
        void reportView(v);
      }, VIEW_SETTLE_MS);
    };

    // Re-run whenever Tesla makes a request, the tab's visibility changes, or
    // the saved searches change.
    const evaluateView = () => {
      const req = lastRequest?.request;
      if (
        restoring ||
        document.visibilityState !== 'visible' ||
        !req ||
        !isInventoryListingPath(location.pathname)
      ) {
        endView();
        return;
      }
      const pageRanges = currentPageRanges();
      const href = pageSearchHref();
      const search = searches.find((s) => isCurrentSearch(s, href, pageRanges));
      if (!search) {
        endView();
        return;
      }
      if (view && view.id !== search.id) endView();
      // Wait for the request that reflects the sliders on screen.
      if (!requestSlidersMatch(req, liveSliderValues())) return;
      if (view && requestsEqual(view.request, req)) return;
      startView(search.id, req);
    };

    const onSearchPage = () => {
      applyNewTags();
      scheduleViewReport();
    };

    // Tesla's own requests, observed through resource timing. An observer (unlike
    // getEntriesByType) keeps receiving entries after the 250-entry timeline
    // buffer fills, which a long SPA session can reach.
    const requestObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (ownSearchUrls.has(entry.name)) continue;
        const request = parseInventoryRequestUrl(entry.name);
        if (!request) continue;
        if (lastRequest && entry.startTime < lastRequest.startTime) continue;
        lastRequest = { request, startTime: entry.startTime };
        if (DEBUG) console.debug('[TIH] inventory request', request);
      }
      evaluateView();
    });
    try {
      requestObserver.observe({ type: 'resource', buffered: true });
    } catch {
      // No resource timing: new-match tracking stays off on this page.
    }
    document.addEventListener('visibilitychange', evaluateView);

    const apply = () => {
      const path = location.pathname;
      // Match both `/inventory/...` (US) and `/<locale>/inventory/...` (e.g. `/en_CA/inventory/...`).
      if (/(^|\/)inventory\//.test(path)) {
        // The saved-search pill lives on used AND new listing pages; nowhere else.
        if (isInventoryListingPath(path)) {
          mountSearchPanel(panelHandlers);
          renderPanelList();
          onSearchPage();
        } else {
          unmountSearchPanel();
          endView();
        }
        if (isUsedInventoryPath(path)) {
          applyInventory();
          injectInventoryButtons();
        } else {
          clearMonitorUi();
        }
        return;
      }
      if (/\/order\/[A-Za-z0-9]+/.test(path)) {
        unmountSearchPanel();
        endView();
        if (isUsedOrderUrl(location.href)) {
          applyOrder();
          injectOrderButton();
        } else {
          clearMonitorUi();
        }
        return;
      }
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      requestObserver.disconnect();
      document.removeEventListener('visibilitychange', evaluateView);
      endView();
      unmountSearchPanel();
      disposeTrackButtons();
    });

    rulesItem.watch((next) => {
      rules = next;
      schedule();
    });

    highlightingEnabledItem.watch((next) => {
      highlightingEnabled = next;
      if (!highlightingEnabled) clearGlows();
      schedule();
    });

    // Keeps the on-page list in step with popup deletes and other devices. A
    // save on this page also lands here, which starts viewing the new search.
    savedSearchesItem.watch((next) => {
      searches = next;
      renderPanelList();
      evaluateView();
    });

    // New-match counts for the pill and rows, kept live as checks and views
    // land. A view in progress keeps its own start-of-view snapshot.
    searchWatchItem.watch((next) => {
      searchWatch = validSearchWatch(next);
      setSearchNewCounts(newCountsById(next));
    });

    // Keeps every mounted Track button in step with popup removals and
    // background price checks; buttons render from this cached array.
    savedCarsItem.watch((next) => {
      cars = next;
      updateTrackButtons(cars);
    });

    browser.runtime.onMessage.addListener((msg) => {
      const type = (msg as { type?: string } | null)?.type;
      if (type === 'tih:search-ready') return Promise.resolve(true);
      if (type === 'tih:scrape') {
        return Promise.resolve(scrapeCar());
      }
      // The worker's created or reused tab: page through one search's results.
      if (type === 'tih:fetch-search') {
        const request = asInventoryRequest((msg as { request?: unknown }).request);
        if (!request) return Promise.resolve({ ok: false });
        return fetchSearchResults(request).then((r) => (r ? { ok: true, ...r } : { ok: false }));
      }
      return undefined;
    });

    schedule();
    void restorePendingSearch();
  },
});
