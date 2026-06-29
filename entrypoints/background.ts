import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { savedCarsItem } from '../src/storage';
import {
  applyCheckResult,
  changedCount,
  makeSnapshot,
  type CarAvailability,
  type CarSnapshot,
  type SavedCars,
} from '../src/savedCars';
import { pollWithTimeout } from '../src/asyncPoll';

const BADGE_COLOR = '#e82127';
const SCRAPE_INTERVAL_MS = 750;
const PER_CAR_TIMEOUT_MS = 20_000;
const KEEPALIVE_MS = 20_000;

type ScrapeReply = {
  ready: boolean;
  vin?: string | null;
  price?: number | null;
  currency?: string | null;
  available?: boolean;
};

// In-memory progress for the popup. Resets to not-running on worker restart,
// which is the correct fallback if the service worker was killed mid-run.
const runState = {
  running: false,
  done: 0,
  total: 0,
  currentVin: null as string | null,
};

export default defineBackground(() => {
  browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});

  // Keep the badge in sync with the watchlist even after a worker restart.
  void savedCarsItem.getValue().then(updateBadge);
  savedCarsItem.watch((cars) => void updateBadge(cars));

  browser.runtime.onMessage.addListener((msg) => {
    const type = (msg as { type?: string } | null)?.type;
    if (type === 'tih:check-now') {
      if (runState.running) return Promise.resolve({ started: false, reason: 'busy' });
      void runCheck();
      return Promise.resolve({ started: true });
    }
    if (type === 'tih:check-progress') {
      return Promise.resolve({ ...runState });
    }
    return undefined;
  });
});

async function updateBadge(cars: SavedCars): Promise<void> {
  const count = changedCount(cars);
  await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' }).catch(() => {});
}

// Open each saved car in a background tab, scrape it, diff vs the snapshot, and
// persist after every car so progress survives a mid-run worker termination.
async function runCheck(): Promise<void> {
  runState.running = true;
  runState.done = 0;
  runState.currentVin = null;
  const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo().catch(() => {}), KEEPALIVE_MS);
  const openTabs = new Set<number>();

  try {
    const cars = await savedCarsItem.getValue();
    runState.total = cars.length;

    for (const car of cars) {
      runState.currentVin = car.vin;
      let tabId: number | undefined;
      let snapshot: CarSnapshot;
      try {
        const tab = await browser.tabs.create({ url: car.url, active: false });
        tabId = tab.id;
        if (tabId !== undefined) openTabs.add(tabId);
        snapshot = await checkOneCar(tabId);
      } catch {
        // Any failure (tab error, port closed) → 'unknown' so we never fabricate a change.
        snapshot = makeSnapshot(null, null, 'unknown', Date.now());
      } finally {
        if (tabId !== undefined) {
          openTabs.delete(tabId);
          await browser.tabs.remove(tabId).catch(() => {});
        }
      }

      // Re-read in case the user removed a car mid-run; match by VIN.
      const current = await savedCarsItem.getValue();
      const idx = current.findIndex((c) => c.vin === car.vin);
      const existing = idx >= 0 ? current[idx] : undefined;
      if (existing) {
        const updated = [...current];
        updated[idx] = applyCheckResult(existing, snapshot);
        await savedCarsItem.setValue(updated);
      }
      runState.done++;
    }
  } finally {
    for (const id of openTabs) await browser.tabs.remove(id).catch(() => {});
    clearInterval(keepAlive);
    runState.running = false;
    runState.currentVin = null;
    await updateBadge(await savedCarsItem.getValue());
  }
}

async function checkOneCar(tabId: number | undefined): Promise<CarSnapshot> {
  if (tabId === undefined) return makeSnapshot(null, null, 'unknown', Date.now());

  const result = await pollWithTimeout<ScrapeReply>(
    async () => {
      const reply = (await browser.tabs
        .sendMessage(tabId, { type: 'tih:scrape' })
        .catch(() => null)) as ScrapeReply | null;
      return reply && reply.ready ? reply : null;
    },
    { intervalMs: SCRAPE_INTERVAL_MS, timeoutMs: PER_CAR_TIMEOUT_MS },
  );

  if (!result) return makeSnapshot(null, null, 'unknown', Date.now());
  const availability: CarAvailability = result.available ? 'available' : 'unavailable';
  return makeSnapshot(result.price ?? null, result.currency ?? null, availability, Date.now());
}
