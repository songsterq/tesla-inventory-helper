# Watchlist Drag-and-Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reorder the popup watchlist by dragging a grip handle on each row; persist the new array order in `local:savedCars`.

**Architecture:** A pure `reorderCars(cars, fromIndex, toIndex)` helper owns the array move. The popup adds a left-side drag handle (`draggable` only on that control), uses HTML5 DnD with an inset `box-shadow` insert cue on drop targets, and writes the reordered array via `savedCarsItem.setValue`. Existing `watch` re-renders. No schema change; `addCar` still appends.

**Tech Stack:** WXT (Vite) extension, TypeScript, Vitest (Node, no jsdom). Native HTML5 Drag and Drop only — no SortableJS.

## Global Constraints

- Node/Vitest tests run in a plain Node environment (no jsdom/happy-dom). Do not write tests that touch `document` or `window`.
- `npx vitest run` and `npx tsc --noEmit` (aka `npm run compile`) must be clean before any commit.
- The popup CSS test allows exactly **one** `border-top: 1px solid var(--border);` in `entrypoints/popup/style.css` (the footer). Do **not** add another. Use `box-shadow: inset …` for drag insert cues instead of `border-top`/`border-bottom` dividers.
- Do not add a third-party drag library.
- Keyboard reordering is out of scope.
- Follow existing code style: 2-space indent, single quotes, trailing commas, existing comment density.

## File map

| File | Role |
|------|------|
| `src/savedCars.ts` | Add pure `reorderCars` |
| `tests/savedCars.test.ts` | Unit tests for `reorderCars` |
| `entrypoints/popup/main.ts` | Grip handle + HTML5 DnD wiring |
| `entrypoints/popup/style.css` | Handle + drop-cue styles |
| `tests/popup.test.ts` | CSS string assertions for handle/cue classes |

---

### Task 1: `reorderCars` helper

**Files:**
- Modify: `src/savedCars.ts` (export `reorderCars` near `removeCar`)
- Test: `tests/savedCars.test.ts` (extend the `describe('addCar / removeCar', …)` block, or add a sibling `describe('reorderCars', …)`)

**Interfaces:**
- Consumes: `SavedCars` type.
- Produces: `reorderCars(cars: SavedCars, fromIndex: number, toIndex: number): SavedCars`
  - Out-of-range or `fromIndex === toIndex` → return `cars` unchanged (same reference).
  - Otherwise copy, `splice` out at `fromIndex`, `splice` in at `toIndex` (post-removal index; caller is responsible for computing the final index).

- [ ] **Step 1: Write the failing tests**

In `tests/savedCars.test.ts`, add `reorderCars` to the import list from `../src/savedCars`, then add:

```ts
describe('reorderCars', () => {
  const list = (): SavedCars => [
    car('5YJ3E1EA0PF000001', snap(1)),
    car('5YJ3E1EA0PF000002', snap(2)),
    car('5YJ3E1EA0PF000003', snap(3)),
  ];

  it('moves an item toward the start', () => {
    const after = reorderCars(list(), 2, 0);
    expect(after.map((c) => c.vin)).toEqual([
      '5YJ3E1EA0PF000003',
      '5YJ3E1EA0PF000001',
      '5YJ3E1EA0PF000002',
    ]);
  });

  it('moves an item toward the end', () => {
    const after = reorderCars(list(), 0, 2);
    expect(after.map((c) => c.vin)).toEqual([
      '5YJ3E1EA0PF000002',
      '5YJ3E1EA0PF000003',
      '5YJ3E1EA0PF000001',
    ]);
  });

  it('returns the same reference when from === to', () => {
    const cars = list();
    expect(reorderCars(cars, 1, 1)).toBe(cars);
  });

  it('returns the same reference for out-of-bounds indices', () => {
    const cars = list();
    expect(reorderCars(cars, -1, 1)).toBe(cars);
    expect(reorderCars(cars, 1, 99)).toBe(cars);
    expect(reorderCars(cars, 99, 0)).toBe(cars);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/savedCars.test.ts`
Expected: FAIL — `reorderCars` is not exported / not a function.

- [ ] **Step 3: Implement `reorderCars`**

In `src/savedCars.ts`, immediately after `removeCar`, add:

```ts
export function reorderCars(cars: SavedCars, fromIndex: number, toIndex: number): SavedCars {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= cars.length ||
    toIndex >= cars.length
  ) {
    return cars;
  }
  const next = [...cars];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return cars;
  next.splice(toIndex, 0, item);
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/savedCars.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/savedCars.ts tests/savedCars.test.ts
git commit -m "Add reorderCars for watchlist drag-and-drop"
```

---

### Task 2: Popup grip handle, styles, and HTML5 DnD

**Files:**
- Modify: `entrypoints/popup/main.ts` (`renderCarRow`, imports)
- Modify: `entrypoints/popup/style.css` (handle + drop-cue rules near `.saved-car-row`)
- Test: `tests/popup.test.ts` (new `describe('popup watchlist reorder', …)` block)

**Interfaces:**
- Consumes: `reorderCars(cars, fromIndex, toIndex): SavedCars` from Task 1; `savedCarsItem`; `formatCarName`; existing `renderCarRow` / `renderSavedCars`.
- Produces: each car `<li>` has `data-vin` and a leading `.saved-car-handle` button; drop on a sibling row persists a new order.

**Index math on drop** (implement exactly this helper in `main.ts`, module-local — not exported):

```ts
// Convert "drop before/after targetIndex" into the post-removal toIndex
// that reorderCars expects.
function dropToIndex(fromIndex: number, targetIndex: number, placeAfter: boolean): number {
  let to = placeAfter ? targetIndex + 1 : targetIndex;
  if (fromIndex < to) to -= 1;
  return to;
}
```

- [ ] **Step 1: Write the failing CSS assertions**

Append to `tests/popup.test.ts`:

```ts
describe('popup watchlist reorder', () => {
  it('styles the drag handle and drop cues', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.saved-car-handle');
    expect(css).toContain('.saved-car.drag-over-before');
    expect(css).toContain('.saved-car.drag-over-after');
    expect(css).toContain('cursor: grab');
  });

  it('uses inset box-shadow for drop cues, not a new divider border', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    const borderTopMatches = css.match(/border-top: 1px solid var\(--border\);/g) ?? [];
    expect(borderTopMatches.length).toBe(1);
    expect(css).toContain('box-shadow: inset 0 2px 0 var(--accent)');
    expect(css).toContain('box-shadow: inset 0 -2px 0 var(--accent)');
  });

  it('wires reorderCars and a drag handle in the popup script', async () => {
    const src = await readFile(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');
    expect(src).toContain('reorderCars');
    expect(src).toContain('saved-car-handle');
    expect(src).toContain('draggable');
    expect(src).toContain('dropToIndex');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/popup.test.ts`
Expected: FAIL — CSS/script strings not found.

- [ ] **Step 3: Add CSS**

In `entrypoints/popup/style.css`, after the `.saved-car-row` block, add:

```css
.saved-car-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 2px;
  line-height: 0;
  cursor: grab;
  flex: 0 0 auto;
}

.saved-car-handle:active {
  cursor: grabbing;
}

.saved-car-handle:hover {
  color: var(--fg);
  filter: none;
}

.saved-car-handle svg {
  display: block;
  pointer-events: none;
}

.saved-car.drag-over-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.saved-car.drag-over-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.saved-car.dragging {
  opacity: 0.5;
}
```

- [ ] **Step 4: Wire the handle and DnD in `main.ts`**

1. Add `reorderCars` to the import from `../../src/savedCars`.

2. Near `CHEVRON_SVG`, add a grip SVG constant:

```ts
const GRIP_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<circle cx="5" cy="3" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="3" r="1.25" fill="currentColor"/>' +
  '<circle cx="5" cy="8" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="8" r="1.25" fill="currentColor"/>' +
  '<circle cx="5" cy="13" r="1.25" fill="currentColor"/>' +
  '<circle cx="11" cy="13" r="1.25" fill="currentColor"/>' +
  '</svg>';
```

3. Add the module-local helpers (above `renderCarRow`):

```ts
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
```

4. In `renderCarRow`, set `li.dataset.vin = car.vin` (or `li.setAttribute('data-vin', car.vin)`).

5. Build the handle before appending the row children:

```ts
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
```

6. Change `row.append(info, priceBlock, remove)` to `row.append(handle, info, priceBlock, remove)`.

7. On the `li`, attach drop-target listeners:

```ts
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
```

Keep history-toggle insertion (`row.insertBefore(toggle, remove)`) unchanged — it still inserts before ✕, after the handle/info/price cluster.

- [ ] **Step 5: Run popup + savedCars tests**

Run: `npx vitest run tests/popup.test.ts tests/savedCars.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and build**

Run: `npm run compile && npm run build`
Expected: both succeed.

- [ ] **Step 7: Manual smoke (optional but recommended)**

Load the extension from `.output/chrome-mv3/`, open the popup with ≥2 tracked cars, drag by the grip handle to reorder, close and reopen — order should stick.

- [ ] **Step 8: Commit**

```bash
git add entrypoints/popup/main.ts entrypoints/popup/style.css tests/popup.test.ts
git commit -m "Add drag-handle reordering to the watchlist popup"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `reorderCars` pure helper + bounds/no-op | Task 1 |
| Unit tests: start/end/same/OOB | Task 1 |
| Left grip handle, handle-only `draggable` | Task 2 |
| HTML5 DnD + insert cue (top/bottom) | Task 2 |
| Persist via `savedCarsItem.setValue` | Task 2 |
| Empty state not a drop target | Task 2 (only `.saved-car` rows get listeners) |
| Missing source VIN → skip write | Task 2 (`fromIndex < 0`) |
| `addCar` still appends | unchanged |
| No SortableJS / no keyboard reorder | Global Constraints |
| No extra footer-style `border-top` divider | Task 2 (box-shadow cues + CSS test) |
