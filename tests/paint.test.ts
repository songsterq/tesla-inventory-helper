import { describe, expect, it } from 'vitest';
import { paintNameFromSwatchSrc } from '../src/paint';

describe('paintNameFromSwatchSrc', () => {
  it('maps Silver_R1 swatch stems to Quicksilver', () => {
    expect(paintNameFromSwatchSrc('https://digitalassets.tesla.com/.../Paint_Silver_R1.png')).toBe(
      'Quicksilver',
    );
    expect(paintNameFromSwatchSrc('https://digitalassets.tesla.com/.../MODELY_/Silver_R1.png')).toBe(
      'Quicksilver',
    );
  });

  it('still spaces camelCase stems like StealthGrey', () => {
    expect(paintNameFromSwatchSrc('https://example.com/Paint_StealthGrey.png')).toBe('Stealth Grey');
  });
});
