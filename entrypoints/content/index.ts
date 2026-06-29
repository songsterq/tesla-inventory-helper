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
const PRICE_SELECTORS = ['.tds-price', '[class*="price" i]'];

const UNAVAILABLE_MARKERS = [
  'no longer available',
  'is no longer available',
  'sold out',
  'has been sold',
];

// Tesla paint names → an approximate swatch color. Order matters: more specific
// names first so e.g. "Stealth Grey" wins over a generic "grey".
const PAINT_HEX: Array<[RegExp, string]> = [
  [/quicksilver/i, '#b6b8ba'],
  [/stealth\s*gr[ea]y/i, '#4a4d50'],
  [/pearl white|white/i, '#e8e8e8'],
  [/obsidian black|solid black|black/i, '#171a20'],
  [/midnight silver|silver|gr[ea]y/i, '#5c5e62'],
  [/deep blue|midnight cherry|blue/i, '#1c2c4c'],
  [/ultra red|red/i, '#a82a2a'],
];

const PRICE_RE = /[$€£¥]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/;
const TRIM_RE =
  /(?:Standard Range|Long Range|Performance)\s+(?:All-Wheel Drive|Rear-Wheel Drive)|All-Wheel Drive|Rear-Wheel Drive/i;

// Scrape a price scoped to `root` so saving from an inventory card reads that
// card's price (not the whole page). Thousands-grouped regex can't absorb a
// trailing model year. Never throws — returns nulls on miss.
function scrapePriceIn(root: HTMLElement): { value: number | null; currency: string | null } {
  for (const sel of PRICE_SELECTORS) {
    const text = root.querySelector<HTMLElement>(sel)?.textContent?.trim();
    if (text) {
      const parsed = parsePrice(text);
      if (parsed.value !== null) return parsed;
    }
  }
  const m = (root.textContent ?? '').match(PRICE_RE);
  if (m) {
    const parsed = parsePrice(m[0]);
    if (parsed.value !== null) return parsed;
  }
  return { value: null, currency: null };
}

function scrapeTrim(root: HTMLElement): string | null {
  const m = (root.textContent ?? '').match(TRIM_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

const isVisibleColor = (c: string): boolean => {
  if (!c || c === 'transparent') return false;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = (m[1] ?? '').split(',').map((s) => parseFloat(s));
  return !(parts.length >= 4 && parts[3] === 0);
};

function scrapePaintColor(root: HTMLElement): string | null {
  // (a) A named paint in the text (details pages show e.g. "Stealth Grey Paint").
  const text = root.textContent ?? '';
  for (const [re, hex] of PAINT_HEX) if (re.test(text)) return hex;
  // (b) A color swatch next to a "Paint" label (inventory cards show only a swatch).
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (el.children.length !== 0 || el.textContent?.trim().toLowerCase() !== 'paint') continue;
    const candidates = [
      el.previousElementSibling,
      ...(el.parentElement ? Array.from(el.parentElement.children) : []),
    ].filter((n): n is HTMLElement => n instanceof HTMLElement && n !== el);
    for (const c of candidates) {
      const color = getComputedStyle(c).backgroundColor;
      if (isVisibleColor(color)) return color;
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
        const paintColor = scrapePaintColor(host);
        const snapshot = makeSnapshot(scraped.value, scraped.currency, 'available', Date.now());
        const result = addCar(cars, createSavedCar(info, urlFor(), snapshot, { trim, paintColor }));
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
