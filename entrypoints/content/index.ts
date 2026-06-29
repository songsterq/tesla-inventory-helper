import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { highlightingEnabledItem, rulesItem, savedCarsItem } from '../../src/storage';
import { evalRules, type Rules } from '../../src/rules';
import { extractVin, extractVinFromOrderPath } from '../../src/vin';
import { decodeTeslaVin, type TeslaModel } from '../../src/decoder';
import { addCar, createSavedCar, makeSnapshot, parsePrice, removeCar } from '../../src/savedCars';
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
};

// ─── BRITTLE: tesla.com DOM scraping. Keep guarded; never throw. ───
const PRICE_SELECTORS = [
  '.vehicle-summary-container .tds-price',
  '.vehicle-summary-container [class*="price" i]',
  '[class*="summary" i] [class*="price" i]',
];

const UNAVAILABLE_MARKERS = [
  'no longer available',
  'is no longer available',
  'sold out',
  'has been sold',
];

const onOrderPage = () => /\/order\/[A-Za-z0-9]+/.test(location.pathname);

function scrapePrice(): { value: number | null; currency: string | null } {
  for (const sel of PRICE_SELECTORS) {
    const text = document.querySelector<HTMLElement>(sel)?.textContent?.trim();
    if (text) {
      const parsed = parsePrice(text);
      if (parsed.value !== null) return parsed;
    }
  }
  // Fallback: pull a currency-formatted number out of the summary container text.
  const scope = document.querySelector<HTMLElement>('.vehicle-summary-container')?.textContent ?? '';
  const m = scope.match(/[$€£¥]\s?\d[\d.,]{2,}/);
  if (m) {
    const parsed = parsePrice(m[0]);
    if (parsed.value !== null) return parsed;
  }
  return { value: null, currency: null };
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
  if (document.querySelector('.vehicle-summary-container')) {
    const { value, currency } = scrapePrice();
    if (value !== null) return { ready: true, vin, price: value, currency, available: true };
  }
  return { ready: false };
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
    let scheduled = false;

    const broadcastStatus = (matched: number, total: number) => {
      try {
        browser.runtime.sendMessage({ type: 'tih:status', matched, total }).catch(() => {});
      } catch {
        // popup may not be open; ignore
      }
    };

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

    const applyInventory = () => {
      const articles = document.querySelectorAll<HTMLElement>(
        'main.inventory-content-wrapper article[data-id]',
      );
      if (!highlightingEnabled) {
        articles.forEach((article) => setGlow(article, null));
        broadcastStatus(0, articles.length);
        return;
      }

      let matched = 0;
      articles.forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        const hit = vin ? evalRules(vin, rules) : null;
        setGlow(article, hit?.name ?? null);
        if (hit) matched++;
      });
      broadcastStatus(matched, articles.length);
    };

    const applyOrder = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container) {
        broadcastStatus(0, 0);
        return;
      }
      if (!highlightingEnabled) {
        setGlow(container, null);
        broadcastStatus(0, 1);
        return;
      }

      const vin = extractVinFromOrderPath(location.pathname);
      const hit = vin ? evalRules(vin, rules) : null;
      setGlow(container, hit?.name ?? null);
      broadcastStatus(hit ? 1 : 0, 1);
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

    const createMonitorButton = (vin: string, urlFor: () => string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'tih-monitor-btn';
      btn.type = 'button';

      const refresh = async () => {
        const cars = await savedCarsItem.getValue();
        const saved = cars.some((c) => c.vin === vin);
        btn.textContent = saved ? '✓ Monitoring' : '+ Monitor this car';
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
        // Capture a price snapshot only on order pages (inventory grids don't
        // carry a reliable single-car price); the first check fills it in.
        const scraped = onOrderPage() ? scrapePrice() : { value: null, currency: null };
        const snapshot = makeSnapshot(scraped.value, scraped.currency, 'available', Date.now());
        const result = addCar(cars, createSavedCar(info, urlFor(), snapshot));
        if (result.ok) await savedCarsItem.setValue(result.cars);
        await refresh();
      });

      void refresh();
      return btn;
    };

    const injectOrderButton = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container || container.querySelector('.tih-monitor-btn')) return;
      const vin = extractVinFromOrderPath(location.pathname);
      if (!vin) return;
      container.prepend(createMonitorButton(vin, () => location.href));
    };

    const injectInventoryButtons = () => {
      const articles = document.querySelectorAll<HTMLElement>(
        'main.inventory-content-wrapper article[data-id]',
      );
      articles.forEach((article) => {
        if (article.querySelector('.tih-monitor-btn')) return;
        const vin = extractVin(article.getAttribute('data-id'));
        if (!vin) return;
        if (getComputedStyle(article).position === 'static') article.style.position = 'relative';
        const btn = createMonitorButton(vin, () => resolveInventoryUrl(article, vin));
        btn.classList.add('tih-monitor-card');
        article.appendChild(btn);
      });
    };

    const apply = () => {
      const path = location.pathname;
      // Match both `/inventory/...` (US) and `/<locale>/inventory/...` (e.g. `/en_CA/inventory/...`).
      if (/(^|\/)inventory\//.test(path)) {
        applyInventory();
        injectInventoryButtons();
        return;
      }
      if (/\/order\/[A-Za-z0-9]+/.test(path)) {
        applyOrder();
        injectOrderButton();
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
    ctx.onInvalidated(() => observer.disconnect());

    rulesItem.watch((next) => {
      rules = next;
      schedule();
    });

    highlightingEnabledItem.watch((next) => {
      highlightingEnabled = next;
      if (!highlightingEnabled) clearGlows();
      schedule();
    });

    browser.runtime.onMessage.addListener((msg) => {
      const type = (msg as { type?: string } | null)?.type;
      if (type === 'tih:scrape') {
        return Promise.resolve(scrapeCar());
      }
      if (msg && (msg as { type?: string }).type === 'tih:ping') {
        const matchedEls = document.querySelectorAll('.tih-glow');
        const isInventory = /(^|\/)inventory\//.test(location.pathname);
        const total = isInventory
          ? document.querySelectorAll('main.inventory-content-wrapper article[data-id]').length
          : document.querySelector('.vehicle-summary-container')
            ? 1
            : 0;
        return Promise.resolve({ matched: matchedEls.length, total });
      }
      return undefined;
    });

    schedule();
  },
});
