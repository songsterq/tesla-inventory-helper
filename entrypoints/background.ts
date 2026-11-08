import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {
  autoCheckHourItem,
  autoCheckMinutesItem,
  migratedFromSyncItem,
  pendingSearchesItem,
  savedCarsItem,
  savedSearchesItem,
  searchWatchItem,
  type PendingSearch,
} from '../src/storage';
import type { SavedSearch } from '../src/savedSearches';
import {
  applyCheckResult,
  changedCount,
  makeSnapshot,
  type CarAvailability,
  type CarSnapshot,
} from '../src/savedCars';
import {
  asInventoryRequest,
  composeBadge,
  normalizeVins,
  pruneOrphans,
  unackedTotal,
  withBadgeAcked,
  withBaseline,
  withCheckResult,
  withRequest,
  withViewed,
  type InventoryRequest,
  type SearchResults,
  type SearchWatch,
} from '../src/searchWatch';
import { LEGACY_SYNC_KEYS, planSyncToLocal } from '../src/syncMigration';
import { planAlarm } from '../src/autoCheck';
import { isSoldRedirect } from '../src/vin';
import { pollWithTimeout } from '../src/asyncPoll';
import { buildChangeNotification, toRunChange, type ChangeNotification, type RunChange } from '../src/notify';

const SCRAPE_INTERVAL_MS = 750;
const PER_CAR_TIMEOUT_MS = 30_000;
// How long the hidden check tab gets to boot its content script. Only the wait
// for a first answer is bounded here; the paged fetch itself is bounded by the
// content script's per-request timeout.
const SEARCH_TAB_READY_MS = 30_000;
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

// The one-time copy of pre-v1.2.5 `sync` values into `local`. Every storage
// read in this worker waits for it, and so does every message: the popup and
// content scripts wait on `tih:storage-ready` (src/storageReady.ts).
let storageReady: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  storageReady = migrateFromSync();

  // Listeners register synchronously (an MV3 requirement for waking the worker);
  // the startup work below them waits for storage.
  void storageReady.then(() => {
    void updateBadge();
    void savedSearchesItem.getValue().then(pruneSearchWatch);
    void reconcileAlarm();
  });

  // Keep the badge in sync with the watchlist and saved-search news, even after
  // a worker restart.
  savedCarsItem.watch(() => void updateBadge());
  searchWatchItem.watch(() => void updateBadge());

  // A deleted search takes its new-match state with it.
  savedSearchesItem.watch((searches) => void pruneSearchWatch(searches));

  // Reconcile the auto-check alarm on startup and whenever either the frequency
  // or the anchor hour changes. Both are inputs to the same schedule, so a change
  // to either re-derives the alarm from the latest stored values.
  autoCheckMinutesItem.watch(() => void reconcileAlarm());
  autoCheckHourItem.watch(() => void reconcileAlarm());

  // Reconcile on install/update too. Users upgrading from a pre-anchor build have
  // no stored hour (so it defaults to 9AM) but still hold an alarm the old code
  // created at an arbitrary wall-clock time. onInstalled is the one event Chrome
  // guarantees fires on update — it forces the worker to start and re-anchor the
  // schedule to 9AM promptly, rather than waiting for the next incidental wake.
  browser.runtime.onInstalled.addListener(() => void storageReady.then(reconcileAlarm));

  // Fire an automatic run when the alarm elapses — but never pile onto a run that
  // is already going, and skip the no-op wake when there is nothing to check.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_CHECK_ALARM || runState.running) return;
    void storageReady.then(hasAnythingToCheck).then((yes) => {
      if (yes && !runState.running) void runCheck('alarm');
    });
  });

  browser.notifications.onClicked.addListener(
    (id) => void storageReady.then(() => handleNotificationClick(id)),
  );

  // Drop a queued restore if its tab closes before the page asked for it.
  browser.tabs.onRemoved.addListener((tabId) => void clearPendingSearch(tabId));

  browser.runtime.onMessage.addListener((msg, sender) => {
    const type = (msg as { type?: string } | null)?.type;
    if (typeof type !== 'string' || !type.startsWith('tih:')) return undefined;
    return storageReady.then(() => handleMessage(type, msg, sender.tab?.id));
  });
});

function handleMessage(type: string, msg: unknown, senderTabId: number | undefined): unknown {
  if (type === 'tih:storage-ready') return true;
  if (type === 'tih:open-search') {
    const { id, newTab } = msg as { id?: unknown; newTab?: unknown };
    if (typeof id !== 'string') return { ok: false };
    return openSavedSearch(id, newTab === true, senderTabId);
  }
  if (type === 'tih:pending-search') {
    return senderTabId === undefined ? null : takePendingSearch(senderTabId);
  }
  if (type === 'tih:check-now') {
    if (runState.running) return { started: false, reason: 'busy' };
    void runCheck('manual');
    return { started: true };
  }
  if (type === 'tih:check-progress') return { ...runState };
  if (type === 'tih:search-viewed') return onSearchViewed(msg);
  if (type === 'tih:search-baseline') return onSearchBaseline(msg);
  if (type === 'tih:ack-search-badge') return ackSearchBadge();
  return undefined;
}

// Copy the pre-v1.2.5 `sync` values into `local`, once (src/syncMigration.ts).
// On failure the flag stays unset, so the next worker start tries again; the
// extension runs on defaults meanwhile rather than not at all.
async function migrateFromSync(): Promise<void> {
  try {
    if (await migratedFromSyncItem.getValue()) return;
    const keys = [...LEGACY_SYNC_KEYS];
    const [sync, local] = await Promise.all([
      browser.storage.sync.get(keys),
      browser.storage.local.get(keys),
    ]);
    const writes = planSyncToLocal(sync, local);
    if (Object.keys(writes).length > 0) await browser.storage.local.set(writes);
    await migratedFromSyncItem.setValue(true);
  } catch (err) {
    console.error('[TIH] copying settings from sync storage failed', err);
  }
}

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
      // Create a non-matching page first so the destination content script
      // cannot ask for its one-shot restore before the queue entry exists.
      const tab = await browser.tabs.create({ url: 'about:blank', active: true });
      if (tab.id === undefined) return { ok: false };
      await queueSearchRestore(tab.id, search);
      await browser.tabs.update(tab.id, { url: search.url });
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

// One badge for both features: watchlist changes plus unacknowledged new
// search matches; see composeBadge for the color and tooltip rules.
async function updateBadge(): Promise<void> {
  const [cars, watch] = await Promise.all([savedCarsItem.getValue(), searchWatchItem.getValue()]);
  const badge = composeBadge(changedCount(cars), unackedTotal(watch));
  await browser.action.setBadgeText({ text: badge.text }).catch(() => {});
  await browser.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});
  await browser.action.setBadgeTextColor({ color: badge.textColor }).catch(() => {});
  await browser.action.setTitle({ title: badge.title }).catch(() => {});
}

// Check every saved car (one background tab each: scrape, diff vs the snapshot,
// persist after every car so progress survives a mid-run worker termination),
// then every saved search with a captured request (one shared hidden tab).
async function runCheck(source: 'alarm' | 'manual'): Promise<void> {
  runState.running = true;
  runState.done = 0;
  runState.currentVin = null;
  const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo().catch(() => {}), KEEPALIVE_MS);
  const openTabs = new Set<number>();
  const changes: RunChange[] = [];

  try {
    const cars = await savedCarsItem.getValue();
    const searchTargets = await searchCheckTargets();
    runState.total = cars.length + searchTargets.length;

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

    // Watchlist notifications go out before the search phase so they aren't
    // held up by it. New search matches never notify; the badge carries them.
    if (source === 'alarm') await notifyChanges(changes);

    runState.currentVin = null;
    await checkSearches(searchTargets, openTabs);
  } finally {
    for (const id of openTabs) await browser.tabs.remove(id).catch(() => {});
    clearInterval(keepAlive);
    runState.running = false;
    runState.currentVin = null;
    await updateBadge();
  }
}

// ─── Saved searches: new matches ───
//
// Tesla's inventory API 403s this worker (Akamai), so every API call runs in a
// tesla.com page via the content script: the hidden check tab below, or the
// page the shopper is viewing (baseline). The worker only orchestrates and is
// the SINGLE WRITER of searchWatchItem.

// Serialize every read-modify-write of searchWatchItem: a check result, a page
// view and a badge ack can land at the same moment. `fn` returns the same
// reference when nothing changed, which skips the write.
let watchChain: Promise<unknown> = Promise.resolve();

function updateSearchWatch<T>(
  fn: (watch: SearchWatch) => { watch: SearchWatch; result: T },
): Promise<T> {
  const run = watchChain.then(async () => {
    const current = await searchWatchItem.getValue();
    const { watch, result } = fn(current);
    if (watch !== current) await searchWatchItem.setValue(watch);
    return result;
  });
  // Keep the chain alive past a failure so one bad write can't wedge the queue.
  watchChain = run.catch(() => undefined);
  return run;
}

function pruneSearchWatch(searches: SavedSearch[]): Promise<void> {
  return updateSearchWatch((watch) => ({ watch: pruneOrphans(watch, searches), result: undefined })).catch(
    () => undefined,
  );
}

type SearchTarget = { id: string; url: string; request: InventoryRequest };

// Searches with a captured request on this device. A search saved elsewhere and
// never opened here has none yet, and is skipped until it is.
async function searchCheckTargets(): Promise<SearchTarget[]> {
  const [searches, watch] = await Promise.all([
    savedSearchesItem.getValue(),
    searchWatchItem.getValue(),
  ]);
  return searches.flatMap((s) => {
    const entry = watch[s.id];
    return entry ? [{ id: s.id, url: s.url, request: entry.request }] : [];
  });
}

async function hasAnythingToCheck(): Promise<boolean> {
  if ((await savedCarsItem.getValue()).length > 0) return true;
  return (await searchCheckTargets()).length > 0;
}

// The hidden tab is only a vehicle for same-origin requests, so load the bare
// listing path: any tesla.com inventory page runs the content script.
function checkTabUrl(searchUrl: string): string {
  try {
    const u = new URL(searchUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return 'https://www.tesla.com/inventory/used/my';
  }
}

async function checkSearches(targets: SearchTarget[], openTabs: Set<number>): Promise<void> {
  const first = targets[0];
  if (!first) return;
  let tabId: number | undefined;
  try {
    const tab = await browser.tabs.create({ url: checkTabUrl(first.url), active: false });
    tabId = tab.id;
    if (tabId !== undefined) openTabs.add(tabId);
    for (const target of targets) {
      const results = tabId === undefined ? null : await fetchSearchInTab(tabId, target.request);
      // A failed fetch leaves the entry untouched — never a fabricated change.
      if (results) {
        await updateSearchWatch((watch) => {
          const entry = watch[target.id];
          if (!entry) return { watch, result: undefined }; // deleted mid-run
          return {
            watch: { ...watch, [target.id]: withCheckResult(entry, results, Date.now()) },
            result: undefined,
          };
        });
      }
      runState.done++;
    }
  } catch {
    // Tab creation failed: every search keeps its previous state.
  } finally {
    if (tabId !== undefined) {
      openTabs.delete(tabId);
      await browser.tabs.remove(tabId).catch(() => {});
    }
  }
}

type FetchSearchReply =
  | { ok: true; total: number; vins: string[]; truncated: boolean }
  | { ok: false };

// Retries only until the tab's content script answers; its answer (success or
// failure) is final.
async function fetchSearchInTab(
  tabId: number,
  request: InventoryRequest,
): Promise<(SearchResults & { truncated: boolean }) | null> {
  const reply = await pollWithTimeout<FetchSearchReply>(
    async () => {
      const r = (await browser.tabs
        .sendMessage(tabId, { type: 'tih:fetch-search', request })
        .catch(() => null)) as FetchSearchReply | null;
      return r && typeof r === 'object' && typeof r.ok === 'boolean' ? r : null;
    },
    { intervalMs: SCRAPE_INTERVAL_MS, timeoutMs: SEARCH_TAB_READY_MS },
  );
  return reply?.ok ? asResults(reply) : null;
}

// Validate results that crossed a message boundary.
function asResults(x: unknown): (SearchResults & { truncated: boolean }) | null {
  const r = x as { total?: unknown; vins?: unknown; truncated?: unknown } | null;
  if (!r || typeof r.total !== 'number' || !Number.isInteger(r.total) || r.total < 0) return null;
  if (!Array.isArray(r.vins)) return null;
  return { total: r.total, vins: normalizeVins(r.vins), truncated: r.truncated === true };
}

// Only state for a search that exists: an id from a stale page must not
// resurrect a deleted search's entry.
async function savedSearchId(id: unknown): Promise<string | null> {
  if (typeof id !== 'string') return null;
  return (await savedSearchesItem.getValue()).some((s) => s.id === id) ? id : null;
}

// The shopper has a saved search on screen: store Tesla's latest request for it
// and mark what's new or rendered as seen. Tells the page whether it still has
// to take the baseline.
async function onSearchViewed(msg: unknown): Promise<{ needsBaseline: boolean }> {
  const { id: rawId, request: raw, renderedVins } = msg as {
    id?: unknown;
    request?: unknown;
    renderedVins?: unknown;
  };
  const request = asInventoryRequest(raw);
  const id = request ? await savedSearchId(rawId) : null;
  if (!request || !id) return { needsBaseline: false };
  const rendered = normalizeVins(renderedVins);
  return updateSearchWatch((watch) => {
    const now = Date.now();
    const entry = withViewed(withRequest(watch[id], request, now), rendered, now);
    const next = entry === watch[id] ? watch : { ...watch, [id]: entry };
    return { watch: next, result: { needsBaseline: entry.seen === null } };
  });
}

// The page fetched everything the search matches. With no baseline yet this is
// the baseline; otherwise the shopper is looking at it, so it all counts as seen.
async function onSearchBaseline(msg: unknown): Promise<{ ok: boolean }> {
  const { id: rawId, request: raw, results: rawResults } = msg as {
    id?: unknown;
    request?: unknown;
    results?: unknown;
  };
  const request = asInventoryRequest(raw);
  const results = asResults(rawResults);
  const id = request && results ? await savedSearchId(rawId) : null;
  if (!request || !results || !id) return { ok: false };
  await updateSearchWatch((watch) => {
    const now = Date.now();
    const withReq = withRequest(watch[id], request, now);
    const entry =
      withReq.seen === null ? withBaseline(withReq, results, now) : withViewed(withReq, results.vins, now);
    return { watch: entry === watch[id] ? watch : { ...watch, [id]: entry }, result: undefined };
  });
  return { ok: true };
}

// Opening the popup clears the badge for current news; row chips stay until
// each search is opened.
async function ackSearchBadge(): Promise<void> {
  await updateSearchWatch((watch) => {
    let changed = false;
    const next: SearchWatch = {};
    for (const [id, entry] of Object.entries(watch)) {
      const acked = withBadgeAcked(entry);
      if (acked !== entry) changed = true;
      next[id] = acked;
    }
    return { watch: changed ? next : watch, result: undefined };
  });
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
