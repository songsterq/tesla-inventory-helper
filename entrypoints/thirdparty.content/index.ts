import { defineContentScript } from 'wxt/utils/define-content-script';
import { decodeTeslaVin, findTeslaVins, type TeslaVinInfo } from '../../src/decoder';
import { highlightingEnabledItem } from '../../src/storage';
import { mountBadge, unmountBadge, updateBadge } from './badge';

const ALLOWLIST_MATCHES = [
  '*://*.autotrader.com/*',
  '*://*.cargurus.com/*',
  '*://*.cars.com/*',
  '*://*.carvana.com/*',
  '*://*.carmax.com/*',
  '*://*.truecar.com/*',
  '*://*.edmunds.com/*',
  '*://*.kbb.com/*',
  '*://*.findmyelectric.com/*',
  '*://*.onlyusedtesla.com/*',
];

const SCAN_DEBOUNCE_MS = 250;
const DEBUG = true;

const debug = (...args: unknown[]) => {
  if (!DEBUG) return;
  console.debug('[tih:thirdparty]', ...args);
};

export default defineContentScript({
  matches: ALLOWLIST_MATCHES,
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main(ctx) {
    debug('content script loaded on', location.href);
    let currentVin: string | null = null;
    let dismissedThisLoad = false;
    let scanScheduled = false;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    let lastHref = location.href;
    let enabled = await highlightingEnabledItem.getValue();

    const collectScanText = (): string => {
      // outerHTML catches VINs in attributes, hidden elements, and JSON blobs
      // (e.g. inline <script type="application/ld+json">) that innerText misses.
      return document.documentElement?.outerHTML ?? '';
    };

    const pickVin = (): TeslaVinInfo | null => {
      const text = collectScanText();
      if (!text) return null;
      const candidates = findTeslaVins(text);
      debug('scan: candidates', candidates);
      for (const vin of candidates) {
        const info = decodeTeslaVin(vin);
        if (info) return info;
      }
      return null;
    };

    const runScan = () => {
      scanScheduled = false;
      if (!enabled || dismissedThisLoad) {
        if (currentVin !== null) {
          unmountBadge();
          currentVin = null;
        }
        return;
      }
      let info: TeslaVinInfo | null = null;
      try {
        info = pickVin();
      } catch (err) {
        debug('scan: pickVin threw', err);
        return;
      }
      if (!info) {
        if (currentVin !== null) {
          unmountBadge();
          currentVin = null;
        }
        return;
      }
      if (info.vin === currentVin) {
        try {
          updateBadge(info);
        } catch (err) {
          debug('scan: updateBadge threw', err);
        }
        return;
      }
      debug('scan: mounting for', info.vin);
      currentVin = info.vin;
      try {
        mountBadge(info, {
          onDismiss: () => {
            // Hide for this page-load only. A reload (or SPA navigation)
            // brings the popover back. To turn the extension off entirely,
            // use the popup's "Highlight Matches" toggle.
            dismissedThisLoad = true;
            unmountBadge();
            currentVin = null;
          },
        });
      } catch (err) {
        debug('scan: mountBadge threw', err);
      }
    };

    const schedule = () => {
      if (scanScheduled) return;
      scanScheduled = true;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(runScan, SCAN_DEBOUNCE_MS);
    };

    const observer = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        currentVin = null;
        dismissedThisLoad = false;
        unmountBadge();
      }
      schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('popstate', schedule);

    const unwatch = highlightingEnabledItem.watch((next) => {
      enabled = next;
      if (!enabled) {
        unmountBadge();
        currentVin = null;
      } else {
        schedule();
      }
    });

    ctx.onInvalidated(() => {
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
      if (scanTimer) clearTimeout(scanTimer);
      unwatch();
      unmountBadge();
    });

    schedule();
  },
});
