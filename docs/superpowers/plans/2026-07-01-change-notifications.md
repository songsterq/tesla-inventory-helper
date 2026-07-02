# Change Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire a `chrome.notifications` OS notification when a background (alarm-triggered) price-check run detects a price drop or a car going gone/sold.

**Architecture:** A pure, unit-tested builder (`src/notify.ts`) turns a run's qualifying changes into notification content plus a click target. Shared price/car formatting moves into `src/format.ts` so the popup and the notification render identically. `entrypoints/background.ts` collects qualifying changes during a run, fires the notification only for alarm-triggered runs, and routes notification clicks (single car → listing tab; summary → watchlist popup window).

**Tech Stack:** WXT (Vite) + TypeScript, Vitest, `chrome.notifications` / `chrome.windows` via the `wxt/browser` polyfill.

## Global Constraints

- Pure logic (no `browser`/DOM) lives in `src/`; `browser`-touching code stays at the edges (`entrypoints/`). Only pure modules get unit tests.
- `npx vitest run` and `npx tsc --noEmit` (a.k.a. `npm test` / `npm run compile`) must be clean before any commit.
- Notifications fire only for `source === 'alarm'` runs. Manual "Check now" runs never notify.
- Only `price-drop` and `gone` changes notify. `price-rise` never notifies.
- No new user-facing toggle: auto-check "Off" is the switch.
- Commit messages must NOT add an agent co-author trailer.

---

### Task 1: Shared formatting module

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `CarSnapshot`, `SavedCar` types from `src/savedCars.ts`.
- Produces:
  - `priceSymbol(currency: string | null): string`
  - `formatPrice(snapshot: CarSnapshot): string`
  - `formatCarName(car: SavedCar): string`
  - `formatCarSubLine(car: SavedCar): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from '../src/format';
import type { CarSnapshot, SavedCar } from '../src/savedCars';

function snap(overrides: Partial<CarSnapshot> = {}): CarSnapshot {
  return { price: 46990, currency: 'USD', availability: 'available', at: 0, ...overrides };
}

function makeCar(overrides: Partial<SavedCar> = {}): SavedCar {
  const s = snap();
  return {
    vin: '7SAYGDEE5PF789500',
    url: 'https://www.tesla.com/my/order/7SAYGDEE5PF789500',
    model: 'Model Y',
    modelYear: 2024,
    likelyHw: 'HW4',
    trim: 'Long Range All-Wheel Drive',
    paintName: 'Stealth Grey',
    mileage: 42000,
    mileageUnit: 'mi',
    savedAt: 0,
    baseline: s,
    latest: s,
    history: [s],
    lastChange: 'none',
    lastCheckedAt: null,
    acknowledged: true,
    ...overrides,
  };
}

describe('priceSymbol', () => {
  it('maps known currencies and blanks unknown/null', () => {
    expect(priceSymbol('USD')).toBe('$');
    expect(priceSymbol('EUR')).toBe('€');
    expect(priceSymbol('ZZZ')).toBe('');
    expect(priceSymbol(null)).toBe('');
  });
});

describe('formatPrice', () => {
  it('prefixes the symbol and groups digits', () => {
    expect(formatPrice(snap({ price: 46990, currency: 'USD' }))).toBe('$46,990');
  });
  it('renders an em dash when price is null', () => {
    expect(formatPrice(snap({ price: null }))).toBe('—');
  });
});

describe('formatCarName', () => {
  it('joins year, model, trim', () => {
    expect(formatCarName(makeCar())).toBe('2024 Model Y Long Range All-Wheel Drive');
  });
  it('falls back to the VIN when name fields are all null', () => {
    expect(formatCarName(makeCar({ modelYear: null, model: null, trim: null }))).toBe(
      '7SAYGDEE5PF789500',
    );
  });
});

describe('formatCarSubLine', () => {
  it('joins paint, mileage+unit, and HW with a middle dot', () => {
    expect(formatCarSubLine(makeCar())).toBe('Stealth Grey · 42,000 mi · HW4');
  });
  it('omits mileage when absent', () => {
    expect(formatCarSubLine(makeCar({ mileage: null, mileageUnit: null }))).toBe(
      'Stealth Grey · HW4',
    );
  });
  it('omits paint when absent', () => {
    expect(formatCarSubLine(makeCar({ paintName: null }))).toBe('42,000 mi · HW4');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `../src/format`.

- [ ] **Step 3: Write the module**

Create `src/format.ts`:

```ts
import type { CarSnapshot, SavedCar } from './savedCars';

// Shared price/car formatting used by both the popup watchlist row and the
// background change notification, so the two surfaces render identically.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  AUD: 'A$',
  HKD: 'HK$',
  CHF: 'CHF ',
  AED: 'AED ',
  KRW: '₩',
};

export const priceSymbol = (currency: string | null): string =>
  currency ? (CURRENCY_SYMBOL[currency] ?? '') : '';

export function formatPrice(s: CarSnapshot): string {
  if (s.price === null) return '—';
  return `${priceSymbol(s.currency)}${s.price.toLocaleString()}`;
}

// Title line, e.g. "2024 Model Y Long Range All-Wheel Drive"; VIN when unknown.
export function formatCarName(car: SavedCar): string {
  return [car.modelYear, car.model, car.trim].filter(Boolean).join(' ') || car.vin;
}

// Sub-line, e.g. "Stealth Grey · 42,000 mi · HW4"; parts drop out when absent.
export function formatCarSubLine(car: SavedCar): string {
  const parts: (string | null)[] = [car.paintName];
  if (car.mileage && car.mileageUnit) {
    parts.push(`${car.mileage.toLocaleString()} ${car.mileageUnit}`);
  }
  parts.push(car.likelyHw);
  return parts.filter(Boolean).join(' · ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "Add shared price/car formatting helpers"
```

---

### Task 2: Adopt shared formatting in the popup

**Files:**
- Modify: `entrypoints/popup/main.ts`

**Interfaces:**
- Consumes: `formatCarName`, `formatCarSubLine`, `formatPrice`, `priceSymbol` from `src/format.ts` (Task 1).
- Produces: nothing new (behavior-preserving refactor).

This task has no new unit test — it is a refactor guarded by the existing suite and typecheck. The popup is DOM code (untested by convention); correctness here is "identical output, no dead code, clean typecheck".

- [ ] **Step 1: Import the shared helpers**

In `entrypoints/popup/main.ts`, add after the existing `savedCars` import block:

```ts
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from '../../src/format';
```

- [ ] **Step 2: Delete the popup's private copies**

Remove these now-duplicated definitions from `entrypoints/popup/main.ts`:
- the `CURRENCY_SYMBOL` constant,
- the `priceSymbol` arrow constant,
- the `formatPrice` function.

(Leave `statusLine` and everything else intact — `statusLine` keeps calling `priceSymbol`, now the imported one.)

- [ ] **Step 3: Use `formatCarName` for the row title**

In `renderCarRow`, replace:

```ts
  title.textContent = [car.modelYear, car.model, car.trim].filter(Boolean).join(' ') || car.vin;
```

with:

```ts
  title.textContent = formatCarName(car);
```

- [ ] **Step 4: Use `formatCarSubLine` for the sub-line**

In `renderCarRow`, replace:

```ts
  const parts = [car.paintName];
  if (car.mileage && car.mileageUnit) {
    parts.push(`${car.mileage.toLocaleString()} ${car.mileageUnit}`);
  }
  parts.push(car.likelyHw);
  sub.textContent = parts.filter(Boolean).join(' · ');
```

with:

```ts
  sub.textContent = formatCarSubLine(car);
```

- [ ] **Step 5: Typecheck and full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors (in particular, no "unused variable" for removed helpers), all tests pass.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/popup/main.ts
git commit -m "Use shared formatting helpers in the popup watchlist"
```

---

### Task 3: Notification builder

**Files:**
- Create: `src/notify.ts`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Consumes: `SavedCar` from `src/savedCars.ts`; `formatCarName`, `formatCarSubLine`, `formatPrice`, `priceSymbol` from `src/format.ts` (Task 1).
- Produces:
  - types `RunChange`, `NotifyTarget`, `ChangeNotification`
  - `buildChangeNotification(changes: RunChange[]): ChangeNotification | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/notify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildChangeNotification, type RunChange } from '../src/notify';
import type { CarSnapshot, SavedCar } from '../src/savedCars';

function snap(overrides: Partial<CarSnapshot> = {}): CarSnapshot {
  return { price: 46990, currency: 'USD', availability: 'available', at: 0, ...overrides };
}

function makeCar(overrides: Partial<SavedCar> = {}): SavedCar {
  const s = snap();
  return {
    vin: '7SAYGDEE5PF789500',
    url: 'https://www.tesla.com/my/order/7SAYGDEE5PF789500',
    model: 'Model Y',
    modelYear: 2024,
    likelyHw: 'HW4',
    trim: 'Long Range',
    paintName: 'Stealth Grey',
    mileage: 42000,
    mileageUnit: 'mi',
    savedAt: 0,
    baseline: s,
    latest: s,
    history: [s],
    lastChange: 'none',
    lastCheckedAt: null,
    acknowledged: true,
    ...overrides,
  };
}

describe('buildChangeNotification', () => {
  it('returns null when there are no changes', () => {
    expect(buildChangeNotification([])).toBeNull();
  });

  it('builds a single-car price-drop notification with the sub-line as context', () => {
    const car = makeCar({ latest: snap({ price: 45590, currency: 'USD' }) });
    const changes: RunChange[] = [{ car, change: 'price-drop', prevPrice: 46990 }];

    const n = buildChangeNotification(changes);

    expect(n).not.toBeNull();
    expect(n!.id).toBe('tih:car:7SAYGDEE5PF789500');
    expect(n!.title).toBe('2024 Model Y Long Range');
    expect(n!.message).toBe('Price dropped $1,400 → $45,590');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · HW4');
    expect(n!.target).toEqual({ kind: 'url', url: car.url });
  });

  it('builds a single-car gone notification', () => {
    const car = makeCar({ latest: snap({ availability: 'unavailable' }) });
    const changes: RunChange[] = [{ car, change: 'gone', prevPrice: 46990 }];

    const n = buildChangeNotification(changes);

    expect(n!.message).toBe('No longer listed');
    expect(n!.contextMessage).toBe('Stealth Grey · 42,000 mi · HW4');
    expect(n!.target).toEqual({ kind: 'url', url: car.url });
  });

  it('handles a drop with an unknown previous price (no delta)', () => {
    const car = makeCar({ latest: snap({ price: 45590 }) });
    const changes: RunChange[] = [{ car, change: 'price-drop', prevPrice: null }];

    expect(buildChangeNotification(changes)!.message).toBe('Price dropped → $45,590');
  });

  it('falls back to the VIN for the title when name fields are null', () => {
    const car = makeCar({ modelYear: null, model: null, trim: null });
    const changes: RunChange[] = [{ car, change: 'gone', prevPrice: null }];

    expect(buildChangeNotification(changes)!.title).toBe('7SAYGDEE5PF789500');
  });

  it('summarizes multiple changes and targets the popup', () => {
    const a = makeCar({ vin: 'AAA', model: 'Model 3', trim: 'RWD' });
    const b = makeCar({ vin: 'BBB', model: 'Model Y', trim: 'LR' });
    const changes: RunChange[] = [
      { car: a, change: 'price-drop', prevPrice: 40000 },
      { car: b, change: 'gone', prevPrice: 46990 },
    ];

    const n = buildChangeNotification(changes);

    expect(n!.id).toBe('tih:summary');
    expect(n!.title).toBe('2 watched cars changed');
    expect(n!.message).toBe('2024 Model 3 RWD, 2024 Model Y LR');
    expect(n!.contextMessage).toBeUndefined();
    expect(n!.target).toEqual({ kind: 'popup' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notify.test.ts`
Expected: FAIL — cannot resolve `../src/notify`.

- [ ] **Step 3: Write the module**

Create `src/notify.ts`:

```ts
import type { SavedCar } from './savedCars';
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from './format';

// A qualifying change observed during a single check run. Only price drops and
// gone/sold cars are collected — price rises never notify.
export type RunChange = {
  car: SavedCar; // the car AFTER the check result was applied (car.latest is the new snapshot)
  change: 'price-drop' | 'gone';
  prevPrice: number | null; // the price BEFORE this run, for the delta
};

// Where a click on the notification should take the user.
export type NotifyTarget = { kind: 'url'; url: string } | { kind: 'popup' };

export type ChangeNotification = {
  id: string;
  title: string;
  message: string;
  contextMessage?: string;
  target: NotifyTarget;
};

// Turn a run's qualifying changes into notification content, or null when there
// is nothing to announce. One changed car → a car-specific notification that
// deep-links to its listing; several → a summary that opens the watchlist.
export function buildChangeNotification(changes: RunChange[]): ChangeNotification | null {
  if (changes.length === 0) return null;

  if (changes.length === 1) {
    const { car, change, prevPrice } = changes[0]!;
    const base = {
      id: `tih:car:${car.vin}`,
      title: formatCarName(car),
      contextMessage: formatCarSubLine(car),
      target: { kind: 'url', url: car.url } as const,
    };
    if (change === 'gone') {
      return { ...base, message: 'No longer listed' };
    }
    const newPrice = car.latest.price;
    if (prevPrice !== null && newPrice !== null) {
      const drop = prevPrice - newPrice;
      const sym = priceSymbol(car.latest.currency);
      return { ...base, message: `Price dropped ${sym}${drop.toLocaleString()} → ${formatPrice(car.latest)}` };
    }
    return { ...base, message: `Price dropped → ${formatPrice(car.latest)}` };
  }

  const names = changes.map((c) => formatCarName(c.car)).join(', ');
  return {
    id: 'tih:summary',
    title: `${changes.length} watched cars changed`,
    message: names,
    target: { kind: 'popup' },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notify.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/notify.ts tests/notify.test.ts
git commit -m "Add change-notification content builder"
```

---

### Task 4: Wire notifications into the background worker

**Files:**
- Modify: `wxt.config.ts` (add `notifications` permission)
- Modify: `entrypoints/background.ts`

**Interfaces:**
- Consumes: `buildChangeNotification`, `RunChange` from `src/notify.ts` (Task 3); `savedCarsItem` from `src/storage.ts`.
- Produces: nothing consumed by later tasks (final task).

This task is `browser`-edge wiring and is not unit-tested. Verification is a clean typecheck + full suite, plus a manual smoke test noted at the end.

- [ ] **Step 1: Add the `notifications` permission**

In `wxt.config.ts`, change the permissions array from:

```ts
    permissions: ['storage', 'tabs', 'alarms'],
```

to:

```ts
    permissions: ['storage', 'tabs', 'alarms', 'notifications'],
```

- [ ] **Step 2: Import the builder in the background worker**

In `entrypoints/background.ts`, add after the `planAlarm` import:

```ts
import { buildChangeNotification, type ChangeNotification, type RunChange } from '../src/notify';
```

- [ ] **Step 3: Register the notification-click listener**

Inside `defineBackground(() => { ... })`, after the `browser.alarms.onAlarm.addListener(...)` block, add:

```ts
  browser.notifications.onClicked.addListener((id) => void handleNotificationClick(id));
```

- [ ] **Step 4: Thread a `source` argument through `runCheck`**

Change the signature:

```ts
async function runCheck(source: 'alarm' | 'manual'): Promise<void> {
```

Update the two call sites:
- In the `onAlarm` listener, `void runCheck()` → `void runCheck('alarm')`.
- In the `tih:check-now` message handler, `void runCheck()` → `void runCheck('manual')`.

- [ ] **Step 5: Collect qualifying changes during the run**

In `runCheck`, declare the accumulator near the other run-local state at the top of the function body (alongside `const openTabs = new Set<number>();`):

```ts
  const changes: RunChange[] = [];
```

Then, in the per-car loop, replace this block:

```ts
      if (existing) {
        const updated = [...current];
        updated[idx] = applyCheckResult(existing, snapshot);
        await savedCarsItem.setValue(updated);
      }
```

with:

```ts
      if (existing) {
        const result = applyCheckResult(existing, snapshot);
        const updated = [...current];
        updated[idx] = result;
        await savedCarsItem.setValue(updated);
        if (result.lastChange === 'price-drop' || result.lastChange === 'gone') {
          changes.push({ car: result, change: result.lastChange, prevPrice: existing.latest.price });
        }
      }
```

- [ ] **Step 6: Fire the notification for alarm runs**

In `runCheck`, at the end of the `try` block (immediately after the `for` loop closes, still inside `try`), add:

```ts
    if (source === 'alarm') await notifyChanges(changes);
```

- [ ] **Step 7: Add the notification + window helpers**

Add these module-level functions in `entrypoints/background.ts` (e.g. after `runCheck`):

```ts
// Best-effort OS notification summarizing an alarm run's changes. A failure here
// must never break the run, so every browser call is guarded.
async function notifyChanges(changes: RunChange[]): Promise<void> {
  const n: ChangeNotification | null = buildChangeNotification(changes);
  if (!n) return;
  await browser.notifications
    .create(n.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icon/128.png'),
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
    .create({ url: browser.runtime.getURL('popup.html'), type: 'popup', width: 420, height: 640 })
    .catch(() => {});
}
```

- [ ] **Step 8: Typecheck and full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass.

- [ ] **Step 9: Manual smoke test (build + load)**

Run: `npx wxt build` and load `.output/chrome-mv3/` as an unpacked extension. Then:
1. Track a car, set auto-check to a short interval for testing (or trigger the alarm via `chrome://extensions` service-worker console: `chrome.alarms.create('tih:auto-check', { when: Date.now() + 1000 })`).
2. Confirm: a drop/gone on a single tracked car shows a notification with the car name, `"Price dropped … → …"` / `"No longer listed"`, and the `"Color · Mileage · HW"` context line; clicking opens the listing.
3. With 2+ changed cars, confirm the summary notification; clicking opens the watchlist window and the badge clears.
4. Confirm a manual "Check now" run fires **no** notification.

- [ ] **Step 10: Commit**

```bash
git add wxt.config.ts entrypoints/background.ts
git commit -m "Notify on price drops and sold cars from background checks"
```

---

## Self-review notes

- **Spec coverage:** manifest permission (T4-S1), pure builder (T3), single-car drop/gone content incl. sub-line context (T3), delta from this-run prev price (T3/T4-S5), multi-car summary + popup target (T3), shared formatting incl. `formatCarSubLine` (T1) adopted by popup (T2), `source` gating so manual runs stay silent (T4-S4/S6), click routing split single→url / summary→window (T4-S7), badge unchanged (no task touches `updateBadge`), tests for builder and sub-line (T1, T3). All covered.
- **Type consistency:** `RunChange` / `ChangeNotification` / `NotifyTarget` names and shapes match across T3 and T4; `notifyChanges` (T4) is the wiring name, distinct from the pure `buildChangeNotification` (T3) it calls.
- **No placeholders:** every code and command step is concrete.
