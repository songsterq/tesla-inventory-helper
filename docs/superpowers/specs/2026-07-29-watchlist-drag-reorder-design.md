# Watchlist drag-and-drop reorder — design

## Goal

Let users reorder tracked cars in the popup watchlist by dragging a grip handle
on each row. The new order persists in `local:savedCars` and is what the popup
(and auto-check iteration) use thereafter.

## Background

Order today is insertion order: `addCar` appends, the popup renders
`for (const car of cars)`, and there is no sort. The array in
`local:savedCars` already *is* the order — reordering is a UI + pure move
helper, with no schema change.

## Decisions (confirmed)

1. **Affordance:** grip handle (⋮⋮ / six-dot) on the left of each row — not
   whole-row drag — so the title link, history chevron, and remove ✕ keep
   normal click behavior.
2. **Mechanism:** native HTML5 Drag and Drop (`draggable` on the handle only).
   No SortableJS or other dependency. Pointer-events custom sort deferred.
3. **New cars:** still append at the bottom (`addCar` unchanged).
4. **Keyboard reordering:** out of scope for v1 (handle DnD only).
5. **Auto-check order:** follows the array; a user’s manual order becomes check
   order. No special case.

## Changes

### 1. Data layer — `src/savedCars.ts`

Add a pure helper:

```ts
reorderCars(cars: SavedCars, fromIndex: number, toIndex: number): SavedCars
```

- Bounds-check both indices; if either is out of range or `fromIndex === toIndex`,
  return `cars` unchanged (same reference is fine).
- Otherwise splice the item out and insert it at `toIndex`, returning a new array.
- `addCar` / `removeCar` / check apply paths unchanged.

### 2. Popup — `entrypoints/popup/main.ts` + `style.css`

Each `.saved-car-row` gains a leading handle button before `.saved-car-info`:

```
li.saved-car[data-vin]
  └─ div.saved-car-row
       ├─ button.saved-car-handle   draggable; grip SVG; aria-label "Reorder <name>"
       ├─ div.saved-car-info        …
       ├─ div.saved-car-price       …
       ├─ button.saved-car-toggle?  …
       └─ button.saved-car-remove   …
```

Behavior:

- Only the handle is `draggable="true"`.
- `dragstart` on the handle stores the source VIN (or index) in
  `dataTransfer`.
- `dragover` / `dragleave` / `drop` on sibling `.saved-car` rows: prevent
  default so drop is allowed; show a simple insert cue (top or bottom border
  highlight on the target based on pointer Y within the row).
- On drop: resolve `fromIndex` / `toIndex` from the current cars array, call
  `reorderCars`, `savedCarsItem.setValue(...)`. Existing `watch` re-renders.
- Empty-state row is not a drop target.
- Handle styling: muted, `cursor: grab` / `grabbing`, aligned with remove
  control weight.

### 3. Tests — `tests/savedCars.test.ts`

Unit-test `reorderCars` only: move toward start, move toward end, no-op same
index, out-of-bounds no-op. No DnD e2e in Vitest.

## Edge cases

- Mid-drag storage write (e.g. auto-check finishes): `watch` re-renders and
  the drag cancels. Acceptable for a short-lived popup.
- Drop on self / invalid indices: `reorderCars` no-ops.
- Source VIN missing at drop time (removed concurrently): skip the write.

## Out of scope

- Keyboard ▲/▼ reordering
- Touch / pointer-events polish beyond what HTML5 DnD provides
- Changing where `addCar` inserts
- Third-party sort libraries
