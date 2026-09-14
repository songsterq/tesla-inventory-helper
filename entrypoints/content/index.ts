import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { highlightingEnabledItem, rulesItem, savedCarsItem, savedSearchesItem } from '../../src/storage';
import { evalRules, type Rules } from '../../src/rules';
import {
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
} from '../../src/savedCars';
import { paintNameFromSwatchSrc } from '../../src/paint';
import { pollWithTimeout } from '../../src/asyncPoll';
import {
  addSearch,
  clampRange,
  conditionFromPath,
  createSavedSearch,
  groupsFromUrl,
  isInventoryListingPath,
  isSameSearchUrl,
  parseDigits,
  planRangeWrites,
  RANGE_KEYS,
  rangeWriteSettled,
  removeSearch,
  renameSearch,
  searchLabelShort,
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
  mountSearchPanel,
  renderSearchList,
  setPanelStatus,
  unmountSearchPanel,
  type SearchPanelHandlers,
} from './searchPanel';
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

// ─── Saved searches: sidebar capture + slider restore ───
//
// tesla.com keeps checkbox/radio filters, sort, zip and radius in the URL but
// NOT the three sliders (Payment, Mileage, Year), and it ignores them if passed
// as query params. So a saved search is the URL plus the slider values, and a
// restore writes those values back into the sidebar after the page loads.

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
// page or the sidebar hasn't rendered — never throws.
function captureView(): CapturedView | null {
  const condition = conditionFromPath(location.pathname);
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SEL);
  if (!condition || !sidebar) return null;
  const params = new URLSearchParams(location.search);
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
  const locale = /^\/([a-z]{2}_[A-Z]{2})\//.exec(location.pathname)?.[1] ?? 'en_US';
  const distanceUnit: 'mi' | 'km' =
    /\bkm\b/i.test(odometerText) || !['en_US', 'en_GB'].includes(locale) ? 'km' : 'mi';
  const rangeParam = params.get('range');
  const radius = rangeParam !== null && rangeParam !== '' ? Number(rangeParam) : NaN;
  const domGroups = captureGroups(sidebar);
  return {
    condition,
    model: captureModel(sidebar),
    paymentType: capturePaymentType(sidebar),
    // Collapsed accordions have no inputs in the DOM; fill those from the URL.
    groups: [...domGroups, ...groupsFromUrl(location.search, domGroups.map((g) => g.key))],
    ranges,
    currencySymbol,
    distanceUnit,
    sort: params.get('arrangeby'),
    zip: params.get('zip'),
    range: Number.isFinite(radius) ? radius : null,
  };
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

type ApplyResult = { applied: RangeKey[]; failed: RangeKey[] };

// Sequential on purpose — each write triggers a results refetch, and serial
// read-backs are unambiguous. A final pass a moment later catches a late
// sidebar re-render undoing an earlier write.
async function applyRanges(ranges: SavedSearch['ranges']): Promise<ApplyResult> {
  const applied: RangeKey[] = [];
  const failed: RangeKey[] = [];
  for (const key of RANGE_KEYS) {
    const target = ranges[key];
    if (!target) continue;
    if (await applyRange(key, target)) applied.push(key);
    else failed.push(key);
  }
  if (applied.length > 0) {
    await sleep(SLIDER_FINAL_PASS_MS);
    for (const key of applied) {
      const target = ranges[key];
      const r = readRange(key);
      if (!target || !r) continue;
      if (rangeWriteSettled(target, r.current, r.bounds ?? UNBOUNDED)) continue;
      if (!(await applyRange(key, target))) failed.push(key);
    }
  }
  return { applied: applied.filter((k) => !failed.includes(k)), failed };
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
    let rules: Rules = await rulesItem.getValue();
    let highlightingEnabled = await highlightingEnabledItem.getValue();
    let searches: SavedSearches = await savedSearchesItem.getValue();
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
      document.querySelectorAll('.tih-monitor-btn').forEach((el) => el.remove());
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

    const createMonitorButton = (
      vin: string,
      host: HTMLElement,
      urlFor: () => string,
      // Mileage lives outside the summary container on order pages, so allow a
      // wider text source than `host`; inventory cards keep their own card text.
      // innerText, not textContent — textContent glues adjacent nodes ("42,956
      // miLocated in Renton"), which kills the \b after the unit.
      mileageText: () => string = () => host.innerText ?? '',
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'tih-monitor-btn';
      btn.type = 'button';

      const refresh = async () => {
        const cars = await savedCarsItem.getValue();
        const saved = cars.some((c) => c.vin === vin);
        btn.textContent = saved ? '✓ Tracking' : 'Track';
        btn.classList.toggle('saved', saved);
      };

      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cars = await savedCarsItem.getValue();
        if (cars.some((c) => c.vin === vin)) {
          await savedCarsItem.setValue(removeCar(cars, vin)); // toggle off
          await refresh();
          return;
        }
        const info = decodeTeslaVin(vin);
        if (!info) return;
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
          cars,
          createSavedCar(info, urlFor(), snapshot, {
            trim,
            paintName,
            mileage: mileage.value,
            mileageUnit: mileage.unit,
          }),
        );
        if (result.ok) await savedCarsItem.setValue(result.cars);
        await refresh();
      });

      void refresh();
      return btn;
    };

    // Universal placement: float the button on the host's edge as an absolute
    // overlay (like the .tih-glow label) so it never shifts page content. Used
    // identically for the order-page summary and each inventory card.
    const attachMonitorButton = (
      host: HTMLElement,
      vin: string,
      urlFor: () => string,
      mileageText?: () => string,
    ) => {
      if (host.querySelector('.tih-monitor-btn')) return;
      // A `display: contents` host generates no box, so it can never be the
      // containing block for the button — the overlay would escape to the page
      // corner. Skip rather than render something misplaced.
      const style = getComputedStyle(host);
      if (style.display === 'contents') return;
      if (style.position === 'static') host.style.position = 'relative';
      const btn = createMonitorButton(vin, host, urlFor, mileageText);
      btn.classList.add('tih-monitor-card');
      host.appendChild(btn);
    };

    const injectOrderButton = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container) return;
      const vin = extractVinFromOrderPath(location.pathname);
      if (!vin) return;
      // Odometer sits in a specs section outside the summary; the order page shows a
      // single car, so scan the whole page for it.
      attachMonitorButton(container, vin, () => location.href, () => document.body?.innerText ?? '');
    };

    const injectInventoryButtons = () => {
      inventoryCards().forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        if (!vin) return;
        attachMonitorButton(article, vin, () => resolveInventoryUrl(article, vin));
      });
    };

    // ─── Saved searches ───

    const reportRestore = (search: SavedSearch, result: ApplyResult) => {
      const label = searchLabelShort(search);
      if (result.failed.length === 0) {
        setPanelStatus(`Applied "${label}".`, 'ok', 4000);
        return;
      }
      const which = result.failed.map((k) => RANGE_KEY_LABELS[k]).join(', ');
      setPanelStatus(`Applied "${label}", but couldn't set ${which}.`, 'error', 8000);
    };

    const panelHandlers: SearchPanelHandlers = {
      onSave: async () => {
        const view = captureView();
        if (!view) return { ok: false, reason: 'capture-failed' };
        const id = crypto.randomUUID().slice(0, 8);
        const search = createSavedSearch(view, location.href, Date.now(), id);
        const result = addSearch(searches, search);
        if (!result.ok) {
          if (result.reason === 'duplicate') {
            const existing = searches.find((s) => s.id === result.existingId);
            return {
              ok: false,
              reason: 'duplicate',
              existingLabel: existing ? searchLabelShort(existing) : undefined,
            };
          }
          return { ok: false, reason: result.reason };
        }
        try {
          await savedSearchesItem.setValue(result.searches);
        } catch {
          // chrome.storage.sync quota or write-rate error.
          return { ok: false, reason: 'quota' };
        }
        searches = result.searches;
        renderSearchList(searches, location.href);
        return { ok: true, label: searchLabelShort(search) };
      },
      onOpen: async (search) => {
        // Same listing already loaded → just push the sliders, no navigation.
        if (isSameSearchUrl(location.href, search.url)) {
          setPanelStatus(`Applying "${searchLabelShort(search)}"…`, 'info');
          reportRestore(search, await applyRanges(search.ranges));
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
      reportRestore(search, await applyRanges(search.ranges ?? {}));
    };

    const apply = () => {
      const path = location.pathname;
      // Match both `/inventory/...` (US) and `/<locale>/inventory/...` (e.g. `/en_CA/inventory/...`).
      if (/(^|\/)inventory\//.test(path)) {
        // The saved-search pill lives on used AND new listing pages; nowhere else.
        if (isInventoryListingPath(path)) {
          mountSearchPanel(panelHandlers);
          renderSearchList(searches, location.href);
        } else {
          unmountSearchPanel();
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
      unmountSearchPanel();
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

    // Keeps the on-page list in step with popup deletes and other devices.
    savedSearchesItem.watch((next) => {
      searches = next;
      renderSearchList(searches, location.href);
    });

    browser.runtime.onMessage.addListener((msg) => {
      const type = (msg as { type?: string } | null)?.type;
      if (type === 'tih:scrape') {
        return Promise.resolve(scrapeCar());
      }
      return undefined;
    });

    schedule();
    void restorePendingSearch();
  },
});
