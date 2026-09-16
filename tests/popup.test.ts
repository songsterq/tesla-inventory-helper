import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('popup highlighting toggle', () => {
  it('uses the icon red as the popup accent color', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

    expect(css).toContain('--accent: #e82127;');
    expect(css).not.toContain('#cc8400');
    expect(css).not.toContain('#ffbf00');
  });

  it('keeps internal sections free of horizontal divider borders', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

    expect(css).not.toContain('border-bottom: 1px solid var(--border);');
    // The footer is the only element allowed to use border-top as a divider —
    // anything else should remain borderless.
    const borderTopMatches = css.match(/border-top: 1px solid var\(--border\);/g) ?? [];
    expect(borderTopMatches.length).toBe(1);
    const footerBlock = css.slice(css.indexOf('.footer'));
    expect(footerBlock).toContain('border-top: 1px solid var(--border);');
  });

  it('keeps the popup compact enough to avoid scrolling', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

    expect(css).toContain('height: 280px;');
    expect(css).toContain('gap: 6px;');
    expect(css).toContain('padding: 6px 14px 10px;');
  });

  it('shows highlighting as enabled by default at the top of the popup', async () => {
    const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');

    expect(html).toContain('Highlight Matches');
    expect(html).toContain('id="highlighting-enabled"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('class="switch"');
    expect(html).not.toContain('Highlight matching cars');
    expect(html).not.toContain('Show the glow on Tesla inventory and order pages.');
    expect(html.indexOf('id="highlighting-enabled"')).toBeLessThan(html.indexOf('id="rules"'));
  });

  it('persists highlighting as enabled by default', async () => {
    const storage = await readFile(new URL('../src/storage.ts', import.meta.url), 'utf8');

    expect(storage).toContain('highlightingEnabledItem');
    expect(storage).toContain("storage.defineItem<boolean>('sync:highlightingEnabled'");
    expect(storage).toContain('fallback: true');
  });

  it('has the content script react to highlighting setting changes', async () => {
    const contentScript = await readFile(
      new URL('../entrypoints/content/index.ts', import.meta.url),
      'utf8',
    );

    expect(contentScript).toContain('highlightingEnabledItem');
    expect(contentScript).toContain('highlightingEnabledItem.watch');
    expect(contentScript).toContain('if (!highlightingEnabled)');
  });
});

describe('popup support links', () => {
  it('groups rate, donate, and Tesla referral links into a footer', async () => {
    const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');

    expect(html).toContain('class="footer"');
    expect(html).toContain(
      'https://chromewebstore.google.com/detail/ehgoebfdmhafkkongmkidfacnaopncli/reviews',
    );
    expect(html).toContain('https://buymeacoffee.com/songsterq');
    expect(html).toContain('https://www.tesla.com/referral/song752203');
    expect(html).toContain('>Rate</span>');
    expect(html).toContain('>Donate</span>');
    expect(html).toContain('>Order Tesla</span>');
  });
});

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

  it('honors the panel `hidden` attribute despite its display value', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    // .saved-car-history sets an explicit `display`, which beats the UA
    // `[hidden] { display: none }` rule (lowest specificity). Without a matching
    // override the panel renders even when hidden, so the chevron never toggles.
    expect(css).toMatch(/\.saved-car-history\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});

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

describe('popup saved searches', () => {
  it('renders a saved-searches section between the watchlist and the rules editor', async () => {
    const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="saved-searches"');
    expect(html.indexOf('id="saved-searches"')).toBeGreaterThan(html.indexOf('id="saved-cars"'));
    expect(html.indexOf('id="saved-searches"')).toBeLessThan(html.indexOf('class="rules-editor"'));
  });

  it('opens searches through the background worker, never chrome.tabs', async () => {
    const src = await readFile(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');
    expect(src).toContain("type: 'tih:open-search'");
    expect(src).toContain('newTab: true');
    expect(src).not.toContain('browser.tabs');
    expect(src).not.toContain('chrome.tabs');
  });

  it('styles the list without adding a divider border', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.saved-searches');
    expect(css).toContain('.saved-search .saved-car-sub');
    const borderTopMatches = css.match(/border-top: 1px solid var\(--border\);/g) ?? [];
    expect(borderTopMatches.length).toBe(1);
  });
});

describe('track button', () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

  it('has the popup share the price status helper with the on-page button', async () => {
    const src = await read('../entrypoints/popup/main.ts');
    expect(src).toContain('formatPriceStatus(car)');
    expect(src).not.toContain('function statusLine');
  });

  it('keeps mounted buttons in step with the watchlist', async () => {
    const src = await read('../entrypoints/content/index.ts');
    expect(src).toContain('savedCarsItem.watch');
    expect(src).toContain('updateTrackButtons(');
    expect(src).toContain('clearTrackButtons()');
    expect(src).toContain('disposeTrackButtons()');
    expect(src).not.toContain('✓ Tracking');
    expect(src).not.toContain('tih-monitor-btn');
  });

  it('keeps the track-time scrape intact in the content script', async () => {
    const src = await read('../entrypoints/content/index.ts');
    expect(src).toContain('scrapePriceIn(host)');
    expect(src).toContain('scrapePaintName(host)');
    expect(src).toContain("makeSnapshot(scraped.value, scraped.currency, 'available'");
    expect(src).toContain('createSavedCar(info, urlFor(), snapshot');
  });

  it('renders in a storage-free closed shadow root with the popover wiring', async () => {
    const src = await read('../entrypoints/content/trackButton.ts');
    expect(src).toContain("attachShadow({ mode: 'closed' })");
    expect(src).toContain('composedPath()');
    expect(src).toContain("'Escape'");
    expect(src).toContain('LEAVE_DELAY_MS = 150');
    expect(src).toContain('priceHistoryRows(');
    expect(src).toContain('formatPriceStatus(');
    expect(src).toContain('Stop tracking');
    // Lifts the card out of the `.tih-glow` stacking context while open.
    expect(src).toContain("setProperty('z-index', OPEN_HOST_Z_INDEX, 'important')");
    // Tesla's global :focus outline would otherwise box the host after a click.
    expect(src).toContain("outline: 'none'");
    expect(src).not.toContain('all: initial');
    expect(src).not.toContain('savedCarsItem');
  });

  it('honors the popover `hidden` attribute and defines every dark token in light too', async () => {
    const css = await read('../entrypoints/content/trackButton.css');
    expect(css).toMatch(/\.popover\[hidden\]\s*\{[^}]*display:\s*none/);
    expect(css).not.toContain('all: revert');
    const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
    expect(darkAt).toBeGreaterThan(0);
    const light = css.slice(0, darkAt);
    const darkBlock = css.slice(darkAt, css.indexOf('\n}\n', darkAt));
    const darkTokens = [...darkBlock.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
    expect(darkTokens.length).toBeGreaterThan(0);
    for (const token of darkTokens) expect(light).toContain(`${token}:`);
  });

  it('drops the old light-DOM button rules but keeps the glow', async () => {
    const css = await read('../entrypoints/content/style.css');
    expect(css).not.toContain('.tih-monitor-btn');
    expect(css).toContain('.tih-glow');
  });
});
