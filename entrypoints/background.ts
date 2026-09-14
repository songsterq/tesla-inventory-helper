import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {
  autoCheckHourItem,
  autoCheckMinutesItem,
  pendingSearchesItem,
  savedCarsItem,
  savedSearchesItem,
  type PendingSearch,
} from '../src/storage';
import type { SavedSearch } from '../src/savedSearches';
import {
  applyCheckResult,
  changedCount,
  makeSnapshot,
  type CarAvailability,
  type CarSnapshot,
  type SavedCars,
} from '../src/savedCars';
import { planAlarm } from '../src/autoCheck';
import { isSoldRedirect } from '../src/vin';
import { pollWithTimeout } from '../src/asyncPoll';
import { buildChangeNotification, toRunChange, type ChangeNotification, type RunChange } from '../src/notify';

const BADGE_COLOR = '#e82127';
const SCRAPE_INTERVAL_MS = 750;
const PER_CAR_TIMEOUT_MS = 30_000;
const KEEPALIVE_MS = 20_000;
const AUTO_CHECK_ALARM = 'tih:auto-check';
// A queued saved-search restore that no content script collected within this
// window is stale (the navigation failed or landed elsewhere) and is dropped.
const PENDING_SEARCH_TTL_MS = 120_000;

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

  // Reconcile the auto-check alarm on startup and whenever either the frequency
  // or the anchor hour changes. Both are inputs to the same schedule, so a change
  // to either re-derives the alarm from the latest stored values.
  void reconcileAlarm();
  autoCheckMinutesItem.watch(() => void reconcileAlarm());
  autoCheckHourItem.watch(() => void reconcileAlarm());

  // Reconcile on install/update too. Users upgrading from a pre-anchor build have
  // no stored hour (so it defaults to 9AM) but still hold an alarm the old code
  // created at an arbitrary wall-clock time. onInstalled is the one event Chrome
  // guarantees fires on update — it forces the worker to start and re-anchor the
  // schedule to 9AM promptly, rather than waiting for the next incidental wake.
  browser.runtime.onInstalled.addListener(() => void reconcileAlarm());

  // Fire an automatic run when the alarm elapses — but never pile onto a run that
  // is already going, and skip the no-op wake when the watchlist is empty.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_CHECK_ALARM || runState.running) return;
    void savedCarsItem.getValue().then((cars) => {
      if (cars.length > 0 && !runState.running) void runCheck('alarm');
    });
  });

  browser.notifications.onClicked.addListener((id) => void handleNotificationClick(id));

  // Drop a queued restore if its tab closes before the page asked for it.
  browser.tabs.onRemoved.addListener((tabId) => void clearPendingSearch(tabId));

  browser.runtime.onMessage.addListener((msg, sender) => {
    const type = (msg as { type?: string } | null)?.type;
    if (type === 'tih:open-search') {
      const { id, newTab } = msg as { id?: unknown; newTab?: unknown };
      if (typeof id !== 'string') return Promise.resolve({ ok: false });
      return openSavedSearch(id, newTab === true, sender.tab?.id);
    }
    if (type === 'tih:pending-search') {
      const tabId = sender.tab?.id;
      return tabId === undefined ? Promise.resolve(null) : takePendingSearch(tabId);
    }
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

// ─── Saved searches: hand a restore off to the tab that will load the URL ───
//
// tesla.com drops unknown query params and the URL hash on load, so the slider
// state can't ride along in the URL. Instead the worker records "tab N should
// restore search S" in session storage, navigates the tab, and the content
// script collects the entry via `tih:pending-search` once it boots.

// Serialize every read-modify-write of the pending map. A `tih:pending-search`
// from a fast-loading tab must see the entry `openSavedSearch` is still writing,
// so readers chain onto the same promise as writers.
let pendingChain: Promise<unknown> = Promise.resolve();

function withPendingSearches<T>(
  fn: (map: Record<string, PendingSearch>) => { map: Record<string, PendingSearch>; result: T },
): Promise<T> {
  const run = pendingChain.then(async () => {
    const now = Date.now();
    const stored = await pendingSearchesItem.getValue();
    const fresh: Record<string, PendingSearch> = {};
    for (const [tabId, entry] of Object.entries(stored)) {
      if (now - entry.queuedAt <= PENDING_SEARCH_TTL_MS) fresh[tabId] = entry;
    }
    const { map, result } = fn(fresh);
    await pendingSearchesItem.setValue(map);
    return result;
  });
  // Keep the chain alive past a failure so one bad write can't wedge the queue.
  pendingChain = run.catch(() => undefined);
  return run;
}

function queueSearchRestore(tabId: number, search: SavedSearch): Promise<void> {
  return withPendingSearches((map) => ({
    map: { ...map, [String(tabId)]: { search, queuedAt: Date.now() } },
    result: undefined,
  }));
}

function takePendingSearch(tabId: number): Promise<SavedSearch | null> {
  return withPendingSearches((map) => {
    const entry = map[String(tabId)];
    if (!entry) return { map, result: null };
    const rest = { ...map };
    delete rest[String(tabId)];
    return { map: rest, result: entry.search };
  });
}

function clearPendingSearch(tabId: number): Promise<void> {
  return withPendingSearches((map) => {
    if (!(String(tabId) in map)) return { map, result: undefined };
    const rest = { ...map };
    delete rest[String(tabId)];
    return { map: rest, result: undefined };
  }).catch(() => undefined);
}

// Open a saved search: either a new active tab (popup) or the sender's own tab
// (on-page panel). The pending entry is written before the navigation so the
// content script can never boot ahead of it.
async function openSavedSearch(
  id: string,
  newTab: boolean,
  senderTabId: number | undefined,
): Promise<{ ok: boolean }> {
  const search = (await savedSearchesItem.getValue()).find((s) => s.id === id);
  if (!search) return { ok: false };
  try {
    if (newTab) {
      const tab = await browser.tabs.create({ url: search.url, active: true });
      if (tab.id === undefined) return { ok: false };
      await queueSearchRestore(tab.id, search);
      return { ok: true };
    }
    if (senderTabId === undefined) return { ok: false };
    await queueSearchRestore(senderTabId, search);
    await browser.tabs.update(senderTabId, { url: search.url });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// Translate the stored frequency + anchor hour into a chrome.alarms schedule.
// Off / corrupted values clear the alarm; otherwise a repeating alarm whose
// first fire lands on the next anchor-aligned slot. The current local
// minute-of-day is computed here (planAlarm stays pure) so the anchor is
// interpreted in the user's timezone.
async function reconcileAlarm(): Promise<void> {
  const [minutes, hour] = await Promise.all([
    autoCheckMinutesItem.getValue(),
    autoCheckHourItem.getValue(),
  ]);
  const now = new Date();
  const nowMinuteOfDay = now.getHours() * 60 + now.getMinutes();
  const plan = planAlarm(minutes, hour, nowMinuteOfDay);
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
        snapshot = await checkOneCar(tabId, car.vin);
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
        const runChange = toRunChange(existing, result);
        if (runChange) changes.push(runChange);
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

async function checkOneCar(tabId: number | undefined, expectedVin: string): Promise<CarSnapshot> {
  if (tabId === undefined) return makeSnapshot(null, null, 'unknown', Date.now());

  const result = await pollWithTimeout<ScrapeReply | { sold: true }>(
    async () => {
      // A sold used car's order page redirects to the inventory listing. Detect
      // that as unavailable — otherwise the scrape runs against the wrong page,
      // never reports ready, and times out into a spurious 'unknown'.
      const tab = await browser.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'complete' && tab.url && isSoldRedirect(tab.url, expectedVin)) {
        return { sold: true };
      }
      const reply = (await browser.tabs
        .sendMessage(tabId, { type: 'tih:scrape' })
        .catch(() => null)) as ScrapeReply | null;
      return reply && reply.ready ? reply : null;
    },
    { intervalMs: SCRAPE_INTERVAL_MS, timeoutMs: PER_CAR_TIMEOUT_MS },
  );

  if (!result) return makeSnapshot(null, null, 'unknown', Date.now());
  if ('sold' in result) return makeSnapshot(null, null, 'unavailable', Date.now());
  const availability: CarAvailability = result.available ? 'available' : 'unavailable';
  return makeSnapshot(result.price ?? null, result.currency ?? null, availability, Date.now());
}
