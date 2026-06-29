import { browser } from 'wxt/browser';
import { highlightingEnabledItem, rulesItem, savedCarsItem } from '../../src/storage';
import { defaultRules } from '../../src/defaultRules';
import { evalRules, parseRules } from '../../src/rules';
import {
  acknowledgeAll,
  changedCount,
  removeCar,
  type CarSnapshot,
  type SavedCar,
  type SavedCars,
} from '../../src/savedCars';

const textarea = document.getElementById('rules') as HTMLTextAreaElement;
const highlightingEnabledInput = document.getElementById(
  'highlighting-enabled',
) as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const restoreBtn = document.getElementById('restore') as HTMLButtonElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const testInput = document.getElementById('test-vin') as HTMLInputElement;
const testResult = document.getElementById('test-result') as HTMLParagraphElement;
const checkNowBtn = document.getElementById('check-now') as HTMLButtonElement;
const checkProgress = document.getElementById('check-progress') as HTMLParagraphElement;
const savedCarsList = document.getElementById('saved-cars') as HTMLUListElement;

void init();

async function init() {
  const rules = await rulesItem.getValue();
  highlightingEnabledInput.checked = await highlightingEnabledItem.getValue();
  textarea.value = JSON.stringify(rules, null, 2);
  highlightingEnabledInput.addEventListener('change', onHighlightingEnabledChange);
  saveBtn.addEventListener('click', onSave);
  restoreBtn.addEventListener('click', onRestore);
  textarea.addEventListener('input', runTest);
  testInput.addEventListener('input', runTest);
  checkNowBtn.addEventListener('click', onCheckNow);
  refreshStatus();
  runTest();

  // Watchlist: render, keep it live, and acknowledge changes so the badge clears.
  const cars = await savedCarsItem.getValue();
  renderSavedCars(cars);
  if (changedCount(cars) > 0) await savedCarsItem.setValue(acknowledgeAll(cars));
  savedCarsItem.watch((next) => renderSavedCars(next));
  void pollProgress();
}

function runTest() {
  const raw = testInput.value.trim().toUpperCase();
  if (testInput.value !== raw) testInput.value = raw;
  testResult.classList.remove('match', 'miss');

  if (raw.length === 0) {
    testResult.textContent = '';
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textarea.value);
  } catch {
    testResult.textContent = 'Fix rules JSON to test.';
    return;
  }
  const result = parseRules(parsedJson);
  if (!result.ok) {
    testResult.textContent = 'Fix rules to test.';
    return;
  }

  if (raw.length !== 17) {
    testResult.textContent = `Enter 17 characters (${raw.length} so far).`;
    return;
  }

  const hit = evalRules(raw, result.rules);
  if (hit) {
    testResult.classList.add('match');
    testResult.textContent = `✓ Matched: ${hit.name}`;
  } else {
    testResult.classList.add('miss');
    testResult.textContent = '✗ No rule matches this VIN.';
  }
}

async function onSave() {
  errorEl.hidden = true;
  errorEl.textContent = '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (err) {
    showError(`JSON syntax error: ${(err as Error).message}`);
    return;
  }
  const result = parseRules(parsed);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  await rulesItem.setValue(result.rules);
  textarea.value = JSON.stringify(result.rules, null, 2);
  flashStatus('Saved.');
  refreshStatus();
  runTest();
}

async function onRestore() {
  await rulesItem.setValue(defaultRules);
  textarea.value = JSON.stringify(defaultRules, null, 2);
  errorEl.hidden = true;
  flashStatus('Restored defaults.');
  refreshStatus();
  runTest();
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function flashStatus(message: string) {
  statusEl.textContent = message;
}

async function onHighlightingEnabledChange() {
  await highlightingEnabledItem.setValue(highlightingEnabledInput.checked);
  flashStatus(highlightingEnabledInput.checked ? 'Highlighting on.' : 'Highlighting off.');
  refreshStatus();
}

async function refreshStatus() {
  if (!highlightingEnabledInput.checked) {
    statusEl.textContent = 'Highlighting is off.';
    return;
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (
    !tab?.id ||
    !tab.url ||
    !/^https:\/\/www\.tesla\.com\/(inventory\/|[^/]+\/order\/)/.test(tab.url)
  ) {
    statusEl.textContent = 'Open a Tesla inventory or order page to see match counts.';
    return;
  }
  try {
    const reply = (await browser.tabs.sendMessage(tab.id, { type: 'tih:ping' })) as
      | { matched: number; total: number }
      | undefined;
    if (reply && typeof reply.matched === 'number' && typeof reply.total === 'number') {
      statusEl.textContent = `Highlighted ${reply.matched} of ${reply.total} cars.`;
    }
  } catch {
    statusEl.textContent = 'Reload the inventory page if highlights are missing.';
  }
}

browser.runtime.onMessage.addListener((msg) => {
  const m = msg as { type?: string; matched?: number; total?: number } | null;
  if (m && m.type === 'tih:status') {
    statusEl.textContent = `Highlighted ${m.matched} of ${m.total} cars.`;
  }
});

// ─── Watchlist ───

function renderSavedCars(cars: SavedCars) {
  savedCarsList.replaceChildren();
  if (cars.length === 0) {
    const li = document.createElement('li');
    li.className = 'saved-empty';
    li.textContent = 'No saved cars yet. Open a Tesla order page and click “Monitor this car”.';
    savedCarsList.appendChild(li);
    return;
  }
  for (const car of cars) savedCarsList.appendChild(renderCarRow(car));
}

function renderCarRow(car: SavedCar): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'saved-car';

  const info = document.createElement('div');
  info.className = 'saved-car-info';
  const title = document.createElement('a');
  title.className = 'saved-car-title';
  title.href = car.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = [car.modelYear, car.model].filter(Boolean).join(' ') || car.vin;
  const sub = document.createElement('span');
  sub.className = 'saved-car-sub';
  sub.textContent = `${car.vin} · ${car.likelyHw}`;
  info.append(title, sub);

  const meta = document.createElement('div');
  meta.className = 'saved-car-meta';
  const price = document.createElement('span');
  price.className = 'saved-car-price';
  price.textContent = formatPrice(car.latest);
  meta.append(price);
  const delta = priceDelta(car);
  if (delta) {
    const d = document.createElement('span');
    d.className = `saved-car-delta ${delta.cls}`;
    d.textContent = delta.text;
    meta.append(d);
  }

  const status = statusChip(car);
  const chip = document.createElement('span');
  chip.className = `chip ${status.cls}`;
  chip.textContent = status.text;

  const remove = document.createElement('button');
  remove.className = 'saved-car-remove';
  remove.type = 'button';
  remove.title = 'Remove from watchlist';
  remove.setAttribute('aria-label', `Remove ${car.vin} from watchlist`);
  remove.textContent = '✕';
  remove.addEventListener('click', async () => {
    const current = await savedCarsItem.getValue();
    await savedCarsItem.setValue(removeCar(current, car.vin));
  });

  const right = document.createElement('div');
  right.className = 'saved-car-right';
  right.append(chip, remove);

  li.append(info, meta, right);
  return li;
}

function formatPrice(s: CarSnapshot): string {
  if (s.price === null) return '—';
  const n = s.price.toLocaleString();
  return s.currency ? `${s.currency} ${n}` : n;
}

function priceDelta(car: SavedCar): { text: string; cls: string } | null {
  const a = car.baseline.price;
  const b = car.latest.price;
  if (a === null || b === null || a === b) return null;
  const diff = b - a;
  const sign = diff < 0 ? '−' : '+';
  return { text: `${sign}${Math.abs(diff).toLocaleString()}`, cls: diff < 0 ? 'down' : 'up' };
}

function statusChip(car: SavedCar): { text: string; cls: string } {
  switch (car.lastChange) {
    case 'gone':
      return { text: 'Sold', cls: 'chip-gone' };
    case 'price-drop':
      return { text: 'Price drop', cls: 'chip-drop' };
    case 'price-rise':
      return { text: 'Price up', cls: 'chip-rise' };
    default:
      return car.lastCheckedAt === null
        ? { text: 'Not checked', cls: 'chip-idle' }
        : { text: 'No change', cls: 'chip-idle' };
  }
}

async function onCheckNow() {
  checkNowBtn.disabled = true;
  const res = (await browser.runtime.sendMessage({ type: 'tih:check-now' }).catch(() => null)) as
    | { started: boolean; reason?: string }
    | null;
  if (res && !res.started && res.reason === 'busy') {
    checkProgress.textContent = 'A check is already running…';
  }
  void pollProgress();
}

async function pollProgress() {
  const p = (await browser.runtime.sendMessage({ type: 'tih:check-progress' }).catch(() => null)) as
    | { running: boolean; done: number; total: number; currentVin: string | null }
    | null;
  if (p && p.running) {
    checkNowBtn.disabled = true;
    checkProgress.textContent = `Checking ${Math.min(p.done + 1, p.total)} of ${p.total}…`;
    setTimeout(() => void pollProgress(), 1000);
  } else {
    checkNowBtn.disabled = false;
    checkProgress.textContent = '';
  }
}
