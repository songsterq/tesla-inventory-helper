import { browser } from 'wxt/browser';
import {
  autoCheckHourItem,
  autoCheckMinutesItem,
  highlightingEnabledItem,
  rulesItem,
  savedCarsItem,
} from '../../src/storage';
import { defaultRules } from '../../src/defaultRules';
import { evalRules, parseRules } from '../../src/rules';
import {
  acknowledgeAll,
  changedCount,
  displayableHistory,
  removeCar,
  reorderCars,
  type SavedCar,
  type SavedCars,
} from '../../src/savedCars';
import {
  formatCarName,
  formatCarSubLine,
  formatHistoryTime,
  formatHistoryValue,
  formatPrice,
  priceSymbol,
} from '../../src/format';

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
const autoCheckSelect = document.getElementById('auto-check') as HTMLSelectElement;
const autoCheckTimeSelect = document.getElementById('auto-check-time') as HTMLSelectElement;
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
  autoCheckSelect.value = String(await autoCheckMinutesItem.getValue());
  autoCheckTimeSelect.value = String(await autoCheckHourItem.getValue());
  syncTimeVisibility();
  autoCheckSelect.addEventListener('change', onAutoCheckChange);
  autoCheckTimeSelect.addEventListener('change', onAutoCheckTimeChange);
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
  runTest();
}

async function onRestore() {
  await rulesItem.setValue(defaultRules);
  textarea.value = JSON.stringify(defaultRules, null, 2);
  errorEl.hidden = true;
  flashStatus('Restored defaults.');
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
}

// The frequency clause of the status line, keyed by the stored minutes. The
// time-of-day clause is appended separately by autoCheckStatus.
const AUTO_CHECK_CADENCE: Record<string, string> = {
  '180': 'every 3 hours',
  '360': 'every 6 hours',
  '720': 'every 12 hours',
  '1440': 'daily',
};

// Format an anchor hour (0–23) as a friendly 12-hour label, e.g. 9 → "9 AM".
function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

// The status flashed when either dropdown changes. Off ignores the time; a daily
// check reads "…daily at 9 AM"; sub-daily reads "…every 6 hours from 9 AM".
function autoCheckStatus(minutes: number, hour: number): string {
  if (minutes <= 0) return 'Automatic checks off.';
  const cadence = AUTO_CHECK_CADENCE[String(minutes)];
  if (!cadence) return 'Automatic check updated.';
  const at = minutes === 1440 ? 'at' : 'from';
  return `Checking automatically ${cadence} ${at} ${formatHour(hour)}.`;
}

// The time dropdown is meaningless when checks are off, so hide it there.
function syncTimeVisibility() {
  autoCheckTimeSelect.hidden = autoCheckSelect.value === '0';
}

async function onAutoCheckChange() {
  const minutes = Number(autoCheckSelect.value);
  await autoCheckMinutesItem.setValue(minutes);
  syncTimeVisibility();
  flashStatus(autoCheckStatus(minutes, Number(autoCheckTimeSelect.value)));
}

async function onAutoCheckTimeChange() {
  const hour = Number(autoCheckTimeSelect.value);
  await autoCheckHourItem.setValue(hour);
  flashStatus(autoCheckStatus(Number(autoCheckSelect.value), hour));
}

// ─── Watchlist ───

// Disclosure chevron for the price-history toggle. A crisp stroked SVG (not a
// text glyph) so it reads clearly at small sizes; CSS rotates it 90° when the
// row's `.saved-car-toggle` gets the `open` class.
const CHEVRON_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const GRIP_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<circle cx="5" cy="3" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="3" r="1.25" fill="currentColor"/>' +
  '<circle cx="5" cy="8" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="8" r="1.25" fill="currentColor"/>' +
  '<circle cx="5" cy="13" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="13" r="1.25" fill="currentColor"/>' +
  '</svg>';

// Convert "drop before/after targetIndex" into the post-removal toIndex
// that reorderCars expects.
function dropToIndex(fromIndex: number, targetIndex: number, placeAfter: boolean): number {
  let to = placeAfter ? targetIndex + 1 : targetIndex;
  if (fromIndex < to) to -= 1;
  return to;
}

function clearDragOver(list: HTMLElement) {
  for (const el of list.querySelectorAll('.saved-car.drag-over-before, .saved-car.drag-over-after')) {
    el.classList.remove('drag-over-before', 'drag-over-after');
  }
}

function renderSavedCars(cars: SavedCars) {
  savedCarsList.replaceChildren();
  if (cars.length === 0) {
    const li = document.createElement('li');
    li.className = 'saved-empty';
    li.textContent = 'No saved cars yet. Open a Tesla order page and click “Track”.';
    savedCarsList.appendChild(li);
    return;
  }
  for (const car of cars) savedCarsList.appendChild(renderCarRow(car));
}

function renderCarRow(car: SavedCar): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'saved-car';
  li.dataset.vin = car.vin;

  const info = document.createElement('div');
  info.className = 'saved-car-info';

  const title = document.createElement('a');
  title.className = 'saved-car-title';
  title.href = car.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = formatCarName(car);
  info.append(title);

  const sub = document.createElement('span');
  sub.className = 'saved-car-sub';
  sub.textContent = formatCarSubLine(car);
  info.append(sub);

  const priceBlock = document.createElement('div');
  priceBlock.className = 'saved-car-price';
  const current = document.createElement('span');
  current.className = 'price-current';
  current.textContent = formatPrice(car.latest);
  const status = statusLine(car);
  const statusEl = document.createElement('span');
  statusEl.className = `price-status ${status.cls}`;
  statusEl.textContent = status.text;
  priceBlock.append(current, statusEl);

  const remove = document.createElement('button');
  remove.className = 'saved-car-remove';
  remove.type = 'button';
  remove.title = 'Remove from watchlist';
  remove.setAttribute('aria-label', `Remove ${car.vin} from watchlist`);
  remove.textContent = '✕';
  remove.addEventListener('click', async () => {
    const cars = await savedCarsItem.getValue();
    await savedCarsItem.setValue(removeCar(cars, car.vin));
  });

  const handle = document.createElement('button');
  handle.className = 'saved-car-handle';
  handle.type = 'button';
  handle.draggable = true;
  handle.setAttribute('aria-label', `Reorder ${formatCarName(car)}`);
  handle.title = 'Drag to reorder';
  handle.innerHTML = GRIP_SVG;

  handle.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', car.vin);
    e.dataTransfer!.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearDragOver(savedCarsList);
  });

  const row = document.createElement('div');
  row.className = 'saved-car-row';
  row.append(handle, info, priceBlock, remove);
  li.append(row);

  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    clearDragOver(savedCarsList);
    li.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
  });
  li.addEventListener('dragleave', (e) => {
    if (li.contains(e.relatedTarget as Node)) return;
    li.classList.remove('drag-over-before', 'drag-over-after');
  });
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    clearDragOver(savedCarsList);
    const fromVin = e.dataTransfer?.getData('text/plain');
    if (!fromVin || fromVin === car.vin) return;
    const cars = await savedCarsItem.getValue();
    const fromIndex = cars.findIndex((c) => c.vin === fromVin);
    const targetIndex = cars.findIndex((c) => c.vin === car.vin);
    if (fromIndex < 0 || targetIndex < 0) return;
    const rect = li.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    const toIndex = dropToIndex(fromIndex, targetIndex, placeAfter);
    const next = reorderCars(cars, fromIndex, toIndex);
    if (next === cars) return;
    await savedCarsItem.setValue(next);
  });


  // Timeline panel: only worth showing once a change has been recorded beyond
  // the save-time baseline — i.e. at least two real observations. Failed-scrape
  // ('unknown') snapshots are filtered out so they don't appear as a bare "—".
  const timeline = displayableHistory(car.history);
  if (timeline.length >= 2) {
    const panelId = `history-${car.vin}`;

    const carName = formatCarName(car);

    const toggle = document.createElement('button');
    toggle.className = 'saved-car-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    toggle.setAttribute('aria-label', `Show price history for ${carName}`);
    toggle.innerHTML = CHEVRON_SVG;

    const panel = document.createElement('ul');
    panel.className = 'saved-car-history';
    panel.id = panelId;
    panel.hidden = true;
    for (const s of timeline) {
      const line = document.createElement('li');
      line.className = 'saved-car-history-line';
      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatHistoryTime(s.at);
      const value = document.createElement('span');
      value.className = 'history-value';
      value.textContent = formatHistoryValue(s);
      line.append(time, value);
      panel.append(line);
    }

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.classList.toggle('open', !open);
      toggle.setAttribute(
        'aria-label',
        open ? `Show price history for ${carName}` : `Hide price history for ${carName}`,
      );
      panel.hidden = open;
    });

    // The chevron lives in the right cluster, just before the remove button, so
    // car names stay flush-left whether or not a row has history to expand.
    row.insertBefore(toggle, remove);
    li.append(panel);
  }

  return li;
}

// The compact second line under the price: a signed delta, "Sold", or a muted
// "No change" / "Not checked".
function statusLine(car: SavedCar): { text: string; cls: string } {
  if (car.lastChange === 'gone') return { text: 'Sold', cls: 'gone' };
  if (car.lastChange === 'price-drop' || car.lastChange === 'price-rise') {
    const a = car.baseline.price;
    const b = car.latest.price;
    if (a !== null && b !== null && a !== b) {
      const diff = b - a;
      const sym = priceSymbol(car.latest.currency);
      return {
        text: `${diff < 0 ? '−' : '+'}${sym}${Math.abs(diff).toLocaleString()}`,
        cls: diff < 0 ? 'down' : 'up',
      };
    }
  }
  // Before the first check, say nothing — "No change" only appears once checked.
  return car.lastCheckedAt === null
    ? { text: '', cls: 'idle' }
    : { text: 'No change', cls: 'idle' };
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
