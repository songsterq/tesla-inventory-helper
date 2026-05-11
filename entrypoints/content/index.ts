import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { highlightingEnabledItem, rulesItem } from '../../src/storage';
import { evalRules, type Rules } from '../../src/rules';
import { extractVin, extractVinFromOrderPath } from '../../src/vin';
import './style.css';

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

    const apply = () => {
      const path = location.pathname;
      // Match both `/inventory/...` (US) and `/<locale>/inventory/...` (e.g. `/en_CA/inventory/...`).
      if (/(^|\/)inventory\//.test(path)) return applyInventory();
      if (/\/order\/[A-Za-z0-9]+/.test(path)) return applyOrder();
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
