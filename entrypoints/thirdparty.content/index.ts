import { defineContentScript } from 'wxt/utils/define-content-script';
import { decodeTeslaVin, findTeslaVins, type TeslaVinInfo } from '../../src/decoder';
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

const DISMISSED_KEY = 'tih:dismissedVins';
const SCAN_DEBOUNCE_MS = 250;

export default defineContentScript({
  matches: ALLOWLIST_MATCHES,
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  main(ctx) {
    let currentVin: string | null = null;
    let scanScheduled = false;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;

    const getDismissed = (): Set<string> => {
      try {
        const raw = sessionStorage.getItem(DISMISSED_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed : []);
      } catch {
        return new Set();
      }
    };

    const markDismissed = (vin: string) => {
      try {
        const set = getDismissed();
        set.add(vin);
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
      } catch {
        // session storage may be blocked; non-fatal
      }
    };

    const pickVin = (): TeslaVinInfo | null => {
      const text = document.body?.innerText ?? '';
      if (!text) return null;
      const dismissed = getDismissed();
      const candidates = findTeslaVins(text);
      for (const vin of candidates) {
        if (dismissed.has(vin)) continue;
        const info = decodeTeslaVin(vin);
        if (info) return info;
      }
      return null;
    };

    const runScan = () => {
      scanScheduled = false;
      const info = pickVin();
      if (!info) {
        if (currentVin !== null) {
          unmountBadge();
          currentVin = null;
        }
        return;
      }
      if (info.vin === currentVin) {
        updateBadge(info);
        return;
      }
      currentVin = info.vin;
      mountBadge(info, {
        onDismiss: () => {
          if (currentVin) markDismissed(currentVin);
          unmountBadge();
          currentVin = null;
        },
      });
    };

    const schedule = () => {
      if (scanScheduled) return;
      scanScheduled = true;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(runScan, SCAN_DEBOUNCE_MS);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    ctx.onInvalidated(() => {
      observer.disconnect();
      if (scanTimer) clearTimeout(scanTimer);
      unmountBadge();
    });

    schedule();
  },
});
