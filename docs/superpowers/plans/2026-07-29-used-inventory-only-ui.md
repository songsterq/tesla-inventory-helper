# Used-Inventory-Only Highlight & Track UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Tesla.com glow highlights and Track buttons only on used inventory listings and used order pages; clear them on new-inventory / new-order URLs.

**Architecture:** Two pure URL helpers in `src/vin.ts` decide whether the current page is used inventory or a used order page. The content script’s `apply()` router calls them before injecting UI, and runs a small cleanup (clear glows + remove `.tih-monitor-btn`) when the page is not eligible — so SPA navigations between used and new don’t leave stale pills. Manifest matches stay broad.

**Tech Stack:** WXT extension, TypeScript, Vitest (Node, no jsdom).

## Global Constraints

- Node/Vitest tests run in a plain Node environment (no jsdom/happy-dom). Do not write tests that touch `document` or `window`.
- `npx vitest run` and `npx tsc --noEmit` (aka `npm run compile`) must be clean before any commit.
- Do **not** narrow manifest `matches` / `host_permissions` — gating is runtime-only.
- Do **not** change watchlist auto-check or background scrape behavior.
- Follow existing code style: 2-space indent, single quotes, trailing commas, existing comment density.
- Compare `titleStatus` case-insensitively (`toLowerCase()`), so `Used` / `NEW` still behave correctly if Tesla ever varies casing.

## File map

| File | Role |
|------|------|
| `src/vin.ts` | Add `isUsedInventoryPath`, `isUsedOrderUrl` |
| `tests/vin.test.ts` | Unit tests for both helpers |
| `entrypoints/content/index.ts` | Gate `apply()`; cleanup on ineligible pages |
| `AGENTS.md` | Document used-only UI + `titleStatus` / VIN rule |

---

### Task 1: URL helpers in `src/vin.ts`

**Files:**
- Modify: `src/vin.ts`
- Test: `tests/vin.test.ts`

**Interfaces:**
- Consumes: existing `extractVinFromOrderPath(pathname): string | null`.
- Produces:
  - `isUsedInventoryPath(pathname: string | null | undefined): boolean`
  - `isUsedOrderUrl(href: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

In `tests/vin.test.ts`, update the import and append:

```ts
import {
  extractVinFromOrderPath,
  isSoldRedirect,
  isUsedInventoryPath,
  isUsedOrderUrl,
} from '../src/vin';

describe('isUsedInventoryPath', () => {
  it('is true for US and locale-prefixed used inventory paths', () => {
    expect(isUsedInventoryPath('/inventory/used/my')).toBe(true);
    expect(isUsedInventoryPath('/en_CA/inventory/used/my')).toBe(true);
    expect(isUsedInventoryPath('/inventory/used')).toBe(true);
  });

  it('is false for new inventory, bare inventory, and unrelated paths', () => {
    expect(isUsedInventoryPath('/inventory/new/my')).toBe(false);
    expect(isUsedInventoryPath('/inventory/my')).toBe(false);
    expect(isUsedInventoryPath('/my/order/' + VIN)).toBe(false);
    expect(isUsedInventoryPath(null)).toBe(false);
    expect(isUsedInventoryPath('')).toBe(false);
  });
});

describe('isUsedOrderUrl', () => {
  it('is true when titleStatus=used', () => {
    expect(
      isUsedOrderUrl(
        `https://www.tesla.com/my/order/${VIN}?range=200&titleStatus=used&redirect=no`,
      ),
    ).toBe(true);
  });

  it('is false when titleStatus=new (even with a VIN-looking path)', () => {
    expect(
      isUsedOrderUrl(
        `https://www.tesla.com/my/order/${VIN}?range=200&titleStatus=new&redirect=no`,
      ),
    ).toBe(false);
    expect(
      isUsedOrderUrl(
        'https://www.tesla.com/my/order/7SAY238_bf98b6663c5453c1a6a56e7b47161285?titleStatus=new',
      ),
    ).toBe(false);
  });

  it('when titleStatus is missing, is true only if the path has a real VIN', () => {
    expect(isUsedOrderUrl(`https://www.tesla.com/my/order/${VIN}`)).toBe(true);
    expect(isUsedOrderUrl(`/m3/order/${VIN}`)).toBe(true);
    expect(
      isUsedOrderUrl(
        'https://www.tesla.com/my/order/7SAY238_bf98b6663c5453c1a6a56e7b47161285',
      ),
    ).toBe(false);
    expect(isUsedOrderUrl('/my/order/SHORT')).toBe(false);
  });

  it('is false for null/unparseable input', () => {
    expect(isUsedOrderUrl(null)).toBe(false);
    expect(isUsedOrderUrl('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/vin.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/vin.ts` (after `extractVinFromOrderPath` is fine; keep `isSoldRedirect` where it is):

```ts
// Highlight/Track UI is used-inventory only. Locale-prefixed paths
// (`/en_CA/inventory/used/...`) still match.
export function isUsedInventoryPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /(^|\/)inventory\/used(\/|$)/i.test(pathname);
}

// Order-page UI gate. titleStatus wins when present; when absent, a real
// 17-char VIN in the path counts as used (watchlist re-check URLs omit the param).
export function isUsedOrderUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  let url: URL;
  try {
    url = new URL(href, 'https://www.tesla.com');
  } catch {
    return false;
  }
  const status = url.searchParams.get('titleStatus')?.toLowerCase();
  if (status === 'used') return true;
  if (status === 'new') return false;
  return extractVinFromOrderPath(url.pathname) !== null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/vin.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/vin.ts tests/vin.test.ts
git commit -m "Add used-inventory and used-order URL helpers"
```

---

### Task 2: Gate content-script `apply()` and update AGENTS.md

**Files:**
- Modify: `entrypoints/content/index.ts` (`apply` around the inventory/order router; imports)
- Modify: `AGENTS.md` (Tesla.com URL handling section; intro bullet if needed)

**Interfaces:**
- Consumes: `isUsedInventoryPath`, `isUsedOrderUrl` from Task 1; existing `clearGlows`, `applyInventory`, `injectInventoryButtons`, `applyOrder`, `injectOrderButton`.
- Produces: no new exports. Behavior: UI only on used pages; cleanup otherwise.

- [ ] **Step 1: Wire the content script**

1. Update the import from `../../src/vin`:

```ts
import {
  extractVin,
  extractVinFromOrderPath,
  isUsedInventoryPath,
  isUsedOrderUrl,
} from '../../src/vin';
```

2. Add a local cleanup helper next to `clearGlows` (inside `main`):

```ts
    const clearMonitorUi = () => {
      clearGlows();
      document.querySelectorAll('.tih-monitor-btn').forEach((el) => el.remove());
    };
```

3. Replace the body of `apply` with:

```ts
    const apply = () => {
      const path = location.pathname;
      // Match both `/inventory/...` (US) and `/<locale>/inventory/...` (e.g. `/en_CA/inventory/...`).
      if (/(^|\/)inventory\//.test(path)) {
        if (isUsedInventoryPath(path)) {
          applyInventory();
          injectInventoryButtons();
        } else {
          clearMonitorUi();
        }
        return;
      }
      if (/\/order\/[A-Za-z0-9]+/.test(path)) {
        if (isUsedOrderUrl(location.href)) {
          applyOrder();
          injectOrderButton();
        } else {
          clearMonitorUi();
        }
        return;
      }
    };
```

Note: the order-path regex still matches Tesla’s alphanumeric-prefix ids (e.g. `7SAY238_…` — the `[A-Za-z0-9]+` stops at `_`, but the branch still runs). `isUsedOrderUrl` then rejects `titleStatus=new` / non-VIN fallbacks. Do not “fix” that regex as part of this task.

- [ ] **Step 2: Update AGENTS.md**

In the intro bullet, change Tesla.com wording to used inventory/order:

```md
1. **Tesla.com (worldwide):** glow-highlights cars whose VIN matches user-defined rules, on **used** inventory and used order pages.
```

Replace the **Tesla.com URL handling** section with:

```md
## Tesla.com URL handling

Supports both US (`/inventory/...`, `/<model>/order/<VIN>`) and locale-prefixed international (`/<locale>/inventory/...`, `/<locale>/my/order/<VIN>`) URLs. The `apply()` router uses regexes (not `startsWith`) to handle both.

Highlight and Track UI run only on **used** inventory (`/inventory/used/...`) and **used** order pages. Order eligibility: `titleStatus=used` → yes; `titleStatus=new` → no; param missing → yes only if the path has a real 17-char VIN (`isUsedInventoryPath` / `isUsedOrderUrl` in `src/vin.ts`). New-inventory/new-order pages clear any leftover glow/Track pills (SPA navigations). Manifest matches stay broad so the content script still loads on those URLs.
```

- [ ] **Step 3: Add a lightweight wiring assertion**

Append to `tests/vin.test.ts` (file-string check; no jsdom):

```ts
describe('content script used-only gating', () => {
  it('imports and calls the used-page helpers in apply()', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../entrypoints/content/index.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('isUsedInventoryPath');
    expect(src).toContain('isUsedOrderUrl');
    expect(src).toContain('clearMonitorUi');
  });
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/vin.test.ts && npm run compile`
Expected: PASS / clean.

- [ ] **Step 5: Manual smoke (recommended)**

Load `.output/chrome-mv3/` (after `npm run build` if needed):

- Used inventory → glow + Track on cards
- New inventory → no glow, no Track
- Used order (`titleStatus=used` or bare VIN URL) → glow + Track
- New order (`titleStatus=new`) → no glow, no Track
- SPA toggle used→new on inventory → pills disappear

- [ ] **Step 6: Commit**

```bash
git add entrypoints/content/index.ts AGENTS.md tests/vin.test.ts
git commit -m "Gate Tesla.com highlight and Track UI to used pages only"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `isUsedInventoryPath` | Task 1 |
| `isUsedOrderUrl` (used / new / missing+VIN) | Task 1 |
| Unit tests for helpers | Task 1 |
| Gate inventory + order in `apply()` | Task 2 |
| Cleanup glows + Track buttons on wrong page | Task 2 |
| AGENTS.md note | Task 2 |
| Manifest matches unchanged | Global Constraints |
| Watchlist/scrape unchanged | Global Constraints |
