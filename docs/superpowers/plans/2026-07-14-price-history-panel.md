# Price-History Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible per-car panel in the popup watchlist that shows the car's price history as a chronological timeline.

**Architecture:** The `SavedCar.history` ring already stores the timeline. One data-layer guard stops `unknown` scrape failures from entering it; two pure format helpers turn a snapshot into a `time` + `value` pair; the popup restructures each watchlist `<li>` into a row plus a hidden history panel toggled by a chevron disclosure button.

**Tech Stack:** WXT (Vite) extension, TypeScript, Vitest. No DOM test environment is configured — pure logic is unit-tested; popup rendering is verified via CSS string tests plus `npm run build` / `npm run compile`.

## Global Constraints

- Node/Vitest tests run in a plain Node environment (no jsdom/happy-dom). Do not write tests that touch `document` or `window`.
- `npx vitest run` and `npx tsc --noEmit` (aka `npm run compile`) must be clean before any commit.
- The popup CSS test allows exactly **one** `border-top: 1px solid var(--border);` in `entrypoints/popup/style.css` (the footer). Do **not** add another.
- History is stored oldest-first, newest-last. Render in that order (newest at the bottom).
- Follow existing code style: 2-space indent, single quotes, trailing commas, existing comment density.

---

### Task 1: Drop `unknown` observations from history

**Files:**
- Modify: `src/savedCars.ts` (function `appendHistory`, around line 249)
- Test: `tests/savedCars.test.ts` (add to the existing `describe('applyCheckResult', …)` block)

**Interfaces:**
- Consumes: existing `applyCheckResult(car: SavedCar, snapshot: CarSnapshot): SavedCar`, `makeSnapshot`, `CarSnapshot`.
- Produces: no signature change. Behavior change only: a snapshot with `availability === 'unknown'` never appends to `history`.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('applyCheckResult', () => { … })` block in `tests/savedCars.test.ts`:

```ts
  it('does not add an unknown (flaky) observation to history', () => {
    let c = car('7SAYGDEE5PF789500', snap(42990, 'available', 100));
    c = applyCheckResult(c, snap(null, 'unknown', 200));
    expect(c.history).toHaveLength(1);
    expect(c.history.at(-1)?.availability).toBe('available');
  });

  it('still appends a real price change after an unknown check', () => {
    let c = car('7SAYGDEE5PF789500', snap(42990, 'available', 100));
    c = applyCheckResult(c, snap(null, 'unknown', 200));
    c = applyCheckResult(c, snap(41990, 'available', 300));
    expect(c.history).toHaveLength(2);
    expect(c.history.at(-1)?.price).toBe(41990);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/savedCars.test.ts`
Expected: FAIL — the first test sees `history` length 2 (the unknown snapshot was appended).

- [ ] **Step 3: Implement the guard**

In `src/savedCars.ts`, change `appendHistory` so it ignores unknown observations. Replace:

```ts
function appendHistory(history: CarSnapshot[], snapshot: CarSnapshot): CarSnapshot[] {
  const last = history[history.length - 1];
```

with:

```ts
function appendHistory(history: CarSnapshot[], snapshot: CarSnapshot): CarSnapshot[] {
  // A failed/flaky scrape yields availability:'unknown' with no real price. That
  // is a measurement gap, not a data point — keep it out of the timeline so the
  // history stays pure price/Sold events and unknowns don't consume ring slots.
  if (snapshot.availability === 'unknown') return history;
  const last = history[history.length - 1];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/savedCars.test.ts`
Expected: PASS (all, including the pre-existing history tests).

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/savedCars.ts tests/savedCars.test.ts
git commit -m "Keep unknown scrape results out of price history"
```

---

### Task 2: Format helpers for a history line

**Files:**
- Modify: `src/format.ts` (append two functions)
- Test: `tests/format.test.ts` (add a new `describe` block)

**Interfaces:**
- Consumes: existing `formatPrice(s: CarSnapshot): string`, type `CarSnapshot`.
- Produces:
  - `formatHistoryValue(s: CarSnapshot): string` — `'Sold'` when `s.availability === 'unavailable'`, otherwise `formatPrice(s)`.
  - `formatHistoryTime(at: number): string` — localized `"Jul 10, 9:34 AM"`-style label.

- [ ] **Step 1: Write the failing test**

Add to `tests/format.test.ts` (the file already imports from `../src/format` and defines a `snap` helper — add `formatHistoryValue, formatHistoryTime` to that import):

```ts
describe('formatHistoryValue', () => {
  it('shows the formatted price for an available snapshot', () => {
    expect(formatHistoryValue(snap({ price: 39000, currency: 'USD' }))).toBe('$39,000');
  });

  it('shows "Sold" for an unavailable snapshot', () => {
    expect(formatHistoryValue(snap({ availability: 'unavailable', price: null }))).toBe('Sold');
  });

  it('shows a dash when an available snapshot has no price', () => {
    expect(formatHistoryValue(snap({ price: null, currency: null }))).toBe('—');
  });
});

describe('formatHistoryTime', () => {
  it('renders a date-and-time label containing the day and a time separator', () => {
    // Noon UTC keeps the calendar day stable across common test timezones.
    const at = Date.UTC(2026, 6, 10, 12, 34); // 2026-07-10T12:34Z
    const out = formatHistoryTime(at);
    expect(out).toContain('10');
    expect(out).toMatch(/\d:\d{2}/);
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — `formatHistoryValue`/`formatHistoryTime` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/format.ts`:

```ts
// One line of the popup price-history panel: the observation's value. A sold car
// reads "Sold"; anything else shows its price ("—" when the price is unknown).
export function formatHistoryValue(s: CarSnapshot): string {
  if (s.availability === 'unavailable') return 'Sold';
  return formatPrice(s);
}

// The timestamp column of a history line, e.g. "Jul 10, 9:34 AM". Localized to
// the user's runtime locale; `at` is a Date.now()-style epoch in ms.
const HISTORY_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatHistoryTime(at: number): string {
  return HISTORY_TIME_FMT.format(at);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "Add price-history line formatters"
```

---

### Task 3: Render the collapsible panel in the popup

**Files:**
- Modify: `entrypoints/popup/main.ts` (function `renderCarRow`, around line 202; import block around line 18)
- Modify: `entrypoints/popup/style.css` (Watchlist section, around lines 328–415)
- Test: `tests/popup.test.ts` (add assertions for the new CSS classes / divider rule)

**Interfaces:**
- Consumes: `formatHistoryValue`, `formatHistoryTime` from `src/format`; existing `SavedCar` with `history: CarSnapshot[]`.
- Produces: DOM only — no exported API. A `<button.saved-car-toggle>` disclosure control and a `<ul.saved-car-history>` panel, rendered only when `car.history.length >= 2`.

- [ ] **Step 1: Write the failing CSS test**

Add to `tests/popup.test.ts`:

```ts
describe('popup price-history panel', () => {
  it('styles the history toggle and panel', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.saved-car-row');
    expect(css).toContain('.saved-car-toggle');
    expect(css).toContain('.saved-car-history');
    expect(css).toContain('.saved-car-history-line');
  });

  it('adds no new full-strength divider border for the panel', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    // Still exactly one border-top divider (the footer) after this feature.
    const borderTopMatches = css.match(/border-top: 1px solid var\(--border\);/g) ?? [];
    expect(borderTopMatches.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/popup.test.ts`
Expected: FAIL — the new class selectors are not present in the CSS yet.

- [ ] **Step 3: Restructure the row in `renderCarRow`**

In `entrypoints/popup/main.ts`, extend the format import (around line 18) to include the new helpers:

```ts
import {
  formatCarName,
  formatCarSubLine,
  formatHistoryTime,
  formatHistoryValue,
  formatPrice,
  priceSymbol,
} from '../../src/format';
```

Replace the final assembly at the end of `renderCarRow` (the current `li.append(info, priceBlock, remove); return li;`) with a row wrapper plus an optional history panel. Change the function so it builds a `.saved-car-row` div holding the existing children, then appends a panel when history warrants:

```ts
  const row = document.createElement('div');
  row.className = 'saved-car-row';
  row.append(info, priceBlock, remove);
  li.append(row);

  // Timeline panel: only worth showing once a change has been recorded beyond
  // the save-time baseline (history.length >= 2).
  if (car.history.length >= 2) {
    const panelId = `history-${car.vin}`;

    const toggle = document.createElement('button');
    toggle.className = 'saved-car-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panelId);
    toggle.setAttribute('aria-label', `Show price history for ${formatCarName(car)}`);
    toggle.textContent = '▸';

    const panel = document.createElement('ul');
    panel.className = 'saved-car-history';
    panel.id = panelId;
    panel.hidden = true;
    for (const s of car.history) {
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
      toggle.textContent = open ? '▸' : '▾';
      panel.hidden = open;
    });

    // Leading chevron sits at the start of the row.
    row.prepend(toggle);
    li.append(panel);
  }

  return li;
```

Remove the old `li.append(info, priceBlock, remove);` / `return li;` lines that this replaces. (The construction of `info`, `priceBlock`, and `remove` above stays exactly as-is.)

- [ ] **Step 4: Add the CSS**

In `entrypoints/popup/style.css`, in the Watchlist section, change `.saved-car` to a column and add the new rules. Replace the existing `.saved-car { … }` block:

```css
.saved-car {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hover-bg);
}
```

with:

```css
.saved-car {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hover-bg);
}

.saved-car-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.saved-car-toggle {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 0 2px;
  font-size: 11px;
  line-height: 1;
  font-weight: 400;
  cursor: pointer;
  flex: 0 0 auto;
}

.saved-car-toggle:hover {
  color: var(--fg);
  filter: none;
}

.saved-car-history {
  list-style: none;
  margin: 6px 0 0;
  padding: 6px 2px 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.saved-car-history-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--muted);
}

.saved-car-history-line .history-value {
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
}
```

- [ ] **Step 5: Run the CSS test to verify it passes**

Run: `npx vitest run tests/popup.test.ts`
Expected: PASS.

- [ ] **Step 6: Full test + typecheck**

Run: `npx vitest run && npm run compile`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Build to confirm the popup compiles**

Run: `npm run build`
Expected: build completes, output in `.output/chrome-mv3/`.

- [ ] **Step 8: Commit**

```bash
git add entrypoints/popup/main.ts entrypoints/popup/style.css tests/popup.test.ts
git commit -m "Add collapsible price-history panel to watchlist rows"
```

---

## Manual verification (after Task 3)

Load `.output/chrome-mv3/` as an unpacked extension. On a watchlist with a car
that has at least one recorded change, confirm:
- A `▸` chevron appears at the left of that car's row; cars with no recorded
  change (only the baseline) show no chevron.
- Clicking the chevron reveals the timeline oldest-first, newest at the bottom,
  each line `"Jul 10, 9:34 AM   $40,000"`, with a Sold car reading `"Sold"`.
- The chevron flips to `▾` while open and back to `▸` when collapsed.
- Light and dark mode both read cleanly.

## Self-Review notes

- **Spec coverage:** unknown-drop → Task 1; `formatHistoryValue`/`formatHistoryTime`
  → Task 2; chevron disclosure, `history.length >= 2` gate, oldest→newest lines,
  no extra divider border → Task 3. All spec sections covered.
- **Type consistency:** `formatHistoryValue(s: CarSnapshot)` and
  `formatHistoryTime(at: number)` are defined in Task 2 and consumed with those
  exact signatures in Task 3.
- **No DOM tests:** rendering is verified by CSS string tests + build + the manual
  pass above, consistent with the repo's existing popup test approach.
