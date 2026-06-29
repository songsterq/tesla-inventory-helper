import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { highlightingEnabledItem, rulesItem, savedCarsItem } from '../../src/storage';
import { evalRules, type Rules } from '../../src/rules';
import { extractVin, extractVinFromOrderPath } from '../../src/vin';
import { decodeTeslaVin, type TeslaModel } from '../../src/decoder';
import {
  addCar,
  createSavedCar,
  makeSnapshot,
  parsePrice,
  pickBestPrice,
  removeCar,
} from '../../src/savedCars';
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
const PRICE_EXCLUDE = /reduc|save|\boff\b|\bwas\b|\/mo|per month|month|lease|\bdue\b|down/i;

const UNAVAILABLE_MARKERS = [
  'no longer available',
  'is no longer available',
  'sold out',
  'has been sold',
];

const TRIM_RE =
  /(?:Standard Range|Long Range|Performance)\s+(?:All-Wheel Drive|Rear-Wheel Drive)|All-Wheel Drive|Rear-Wheel Drive/i;

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
  const m = (root.textContent ?? '').match(TRIM_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

const cleanPaintName = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const name = raw.replace(/\s*paint\b/i, '').replace(/\s+/g, ' ').trim();
  return name.length >= 3 && name.length <= 30 ? name : null;
};

function scrapePaintName(root: HTMLElement): string | null {
  // (a) Details pages: the Capitalized phrase before the word "Paint" (Capitalized
  // only, so it can't grab the glued mileage/"mi"). First match wins.
  const named = (root.textContent ?? '').match(
    /([A-Z][a-z]+(?:[\s-][A-Z][a-z]+){0,3})\s*Paint\b/,
  );
  const fromText = cleanPaintName(named?.[1]);
  if (fromText) return fromText;
  // (b) Inventory cards (no name in text): the swatch's accessible name — the
  // previous sibling of the "Paint" leaf label.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (el.children.length !== 0 || el.textContent?.trim().toLowerCase() !== 'paint') continue;
    const swatch = el.previousElementSibling;
    if (swatch instanceof HTMLElement) {
      const label =
        swatch.getAttribute('title') ??
        swatch.getAttribute('aria-label') ??
        swatch.querySelector('img')?.getAttribute('alt') ??
        null;
      const name = cleanPaintName(label);
      if (name) return name;
    }
  }
  return null;
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
        const snapshot = makeSnapshot(scraped.value, scraped.currency, 'available', Date.now());
        const result = addCar(cars, createSavedCar(info, urlFor(), snapshot, { trim, paintName }));
        if (result.ok) await savedCarsItem.setValue(result.cars);
        await refresh();
      });

      void refresh();
      return btn;
    };

    // Universal placement: float the button on the host's edge as an absolute
    // overlay (like the .tih-glow label) so it never shifts page content. Used
    // identically for the order-page summary and each inventory card.
    const attachMonitorButton = (host: HTMLElement, vin: string, urlFor: () => string) => {
      if (host.querySelector('.tih-monitor-btn')) return;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const btn = createMonitorButton(vin, host, urlFor);
      btn.classList.add('tih-monitor-card');
      host.appendChild(btn);
    };

    const injectOrderButton = () => {
      const container = document.querySelector<HTMLElement>('.vehicle-summary-container');
      if (!container) return;
      const vin = extractVinFromOrderPath(location.pathname);
      if (!vin) return;
      attachMonitorButton(container, vin, () => location.href);
    };

    const injectInventoryButtons = () => {
      const articles = document.querySelectorAll<HTMLElement>(
        'main.inventory-content-wrapper article[data-id]',
      );
      articles.forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        if (!vin) return;
        attachMonitorButton(article, vin, () => resolveInventoryUrl(article, vin));
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
      return undefined;
    });

    schedule();
  },
});
