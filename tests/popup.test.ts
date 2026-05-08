import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('popup highlighting toggle', () => {
  it('uses the icon red as the popup accent color', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

    expect(css).toContain('--accent: #e82127;');
    expect(css).not.toContain('#cc8400');
    expect(css).not.toContain('#ffbf00');
  });

  it('does not show horizontal divider borders', async () => {
    const css = await readFile(new URL('../entrypoints/popup/style.css', import.meta.url), 'utf8');

    expect(css).not.toContain('border-top: 1px solid var(--border);');
    expect(css).not.toContain('border-bottom: 1px solid var(--border);');
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
  it('asks users to rate and optionally support the extension', async () => {
    const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');

    expect(html).toContain('Find this useful?');
    expect(html).toContain('>Rate this extension</a');
    expect(html).toContain('Really loving it?');
    expect(html).toContain('>Buy me a coffee</a');
    expect(html).toContain(
      'https://chromewebstore.google.com/detail/ehgoebfdmhafkkongmkidfacnaopncli/reviews',
    );
    expect(html).toContain('https://buymeacoffee.com/songsterq');
  });
});
