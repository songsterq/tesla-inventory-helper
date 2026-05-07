import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
