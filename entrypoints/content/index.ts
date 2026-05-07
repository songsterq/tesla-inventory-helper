import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { rulesItem } from '../../src/storage';
import { evalRules, type Rules } from '../../src/rules';
import { extractVin } from '../../src/vin';
import './style.css';

export default defineContentScript({
  matches: ['https://www.tesla.com/inventory/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main(ctx) {
    let rules: Rules = await rulesItem.getValue();
    let scheduled = false;

    const broadcastStatus = (matched: number, total: number) => {
      try {
        browser.runtime.sendMessage({ type: 'tih:status', matched, total }).catch(() => {});
      } catch {
        // popup may not be open; ignore
      }
    };

    const apply = () => {
      const articles = document.querySelectorAll<HTMLElement>(
        'main.inventory-content-wrapper article[data-id]',
      );
      let matched = 0;
      articles.forEach((article) => {
        const vin = extractVin(article.getAttribute('data-id'));
        const hit = vin ? evalRules(vin, rules) : null;
        if (hit) {
          article.classList.add('tih-glow');
          article.dataset.tihMatch = hit.name;
          matched++;
        } else {
          article.classList.remove('tih-glow');
          delete article.dataset.tihMatch;
        }
      });
      broadcastStatus(matched, articles.length);
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

    browser.runtime.onMessage.addListener((msg) => {
      if (msg && (msg as { type?: string }).type === 'tih:ping') {
        const articles = document.querySelectorAll<HTMLElement>(
          'main.inventory-content-wrapper article[data-id]',
        );
        const matched = document.querySelectorAll('article.tih-glow').length;
        return Promise.resolve({ matched, total: articles.length });
      }
      return undefined;
    });

    schedule();
  },
});
