import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { autoCheckMinutesItem, savedCarsItem } from '../src/storage';
import {
  applyCheckResult,
  changedCount,
  makeSnapshot,
  type CarAvailability,
  type CarSnapshot,
  type SavedCars,
} from '../src/savedCars';
import { planAlarm } from '../src/autoCheck';
import { pollWithTimeout } from '../src/asyncPoll';
import { buildChangeNotification, type ChangeNotification, type RunChange } from '../src/notify';

const BADGE_COLOR = '#e82127';
const SCRAPE_INTERVAL_MS = 750;
const PER_CAR_TIMEOUT_MS = 20_000;
const KEEPALIVE_MS = 20_000;
const AUTO_CHECK_ALARM = 'tih:auto-check';

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

  // Reconcile the auto-check alarm on startup and whenever the setting changes.
  void autoCheckMinutesItem.getValue().then(reconcileAlarm);
  autoCheckMinutesItem.watch((minutes) => void reconcileAlarm(minutes));

  // Fire an automatic run when the alarm elapses — but never pile onto a run that
  // is already going, and skip the no-op wake when the watchlist is empty.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_CHECK_ALARM || runState.running) return;
    void savedCarsItem.getValue().then((cars) => {
      if (cars.length > 0 && !runState.running) void runCheck('alarm');
    });
  });

  browser.notifications.onClicked.addListener((id) => void handleNotificationClick(id));

  browser.runtime.onMessage.addListener((msg) => {
    const type = (msg as { type?: string } | null)?.type;
    if (type === 'tih:check-now') {
      if (runState.running) return Promise.resolve({ started: false, reason: 'busy' });
      void runCheck('manual');
      return Promise.resolve({ started: true });
    }
    if (type === 'tih:check-progress') {
      return Promise.resolve({ ...runState });
    }
    return undefined;
  });
});

// Translate the stored frequency into a chrome.alarms schedule. Off / corrupted
// values clear the alarm; otherwise a repeating alarm delayed by a full period.
async function reconcileAlarm(minutes: number): Promise<void> {
  const plan = planAlarm(minutes);
  if ('clear' in plan) {
    await browser.alarms.clear(AUTO_CHECK_ALARM).catch(() => {});
    return;
  }
  browser.alarms.create(AUTO_CHECK_ALARM, plan);
}

async function updateBadge(cars: SavedCars): Promise<void> {
  const count = changedCount(cars);
  await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' }).catch(() => {});
}

// Open each saved car in a background tab, scrape it, diff vs the snapshot, and
// persist after every car so progress survives a mid-run worker termination.
async function runCheck(source: 'alarm' | 'manual'): Promise<void> {
  runState.running = true;
  runState.done = 0;
  runState.currentVin = null;
  const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo().catch(() => {}), KEEPALIVE_MS);
  const openTabs = new Set<number>();
  const changes: RunChange[] = [];

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
        const result = applyCheckResult(existing, snapshot);
        const updated = [...current];
        updated[idx] = result;
        await savedCarsItem.setValue(updated);
        if (result.lastChange === 'price-drop' || result.lastChange === 'gone') {
          changes.push({ car: result, change: result.lastChange, prevPrice: existing.latest.price });
        }
      }
      runState.done++;
    }

    if (source === 'alarm') await notifyChanges(changes);
  } finally {
    for (const id of openTabs) await browser.tabs.remove(id).catch(() => {});
    clearInterval(keepAlive);
    runState.running = false;
    runState.currentVin = null;
    await updateBadge(await savedCarsItem.getValue());
  }
}

// Best-effort OS notification summarizing an alarm run's changes. A failure here
// must never break the run, so every browser call is guarded.
async function notifyChanges(changes: RunChange[]): Promise<void> {
  const n: ChangeNotification | null = buildChangeNotification(changes);
  if (!n) return;
  await browser.notifications
    .create(n.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: n.title,
      message: n.message,
      ...(n.contextMessage ? { contextMessage: n.contextMessage } : {}),
    })
    .catch(() => {});
}

// Route a notification click. Single-car ids deep-link to the listing (or the
// watchlist if the car was removed since); the summary opens the watchlist.
async function handleNotificationClick(id: string): Promise<void> {
  await browser.notifications.clear(id).catch(() => {});
  const CAR_PREFIX = 'tih:car:';
  if (id.startsWith(CAR_PREFIX)) {
    const vin = id.slice(CAR_PREFIX.length);
    const cars = await savedCarsItem.getValue();
    const car = cars.find((c) => c.vin === vin);
    if (car) {
      await browser.tabs.create({ url: car.url }).catch(() => {});
      return;
    }
  }
  await openWatchlistWindow();
}

// Open the popup page as a small standalone window. Its init() runs
// acknowledgeAll, which clears the badge — same "seen" semantics as the popup.
async function openWatchlistWindow(): Promise<void> {
  await browser.windows
    .create({ url: browser.runtime.getURL('/popup.html'), type: 'popup', width: 420, height: 640 })
    .catch(() => {});
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
