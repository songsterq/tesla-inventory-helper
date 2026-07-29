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

  it('maps Red_Paint_R2 swatch stems to Ultra Red', () => {
    expect(paintNameFromSwatchSrc('https://digitalassets.tesla.com/.../Paint_Red_Paint_R2.png')).toBe(
      'Ultra Red',
    );
    expect(paintNameFromSwatchSrc('https://digitalassets.tesla.com/.../MODELY_/Red_Paint_R2.png')).toBe(
      'Ultra Red',
    );
  });

  it('still spaces camelCase stems like StealthGrey', () => {
    expect(paintNameFromSwatchSrc('https://example.com/Paint_StealthGrey.png')).toBe('Stealth Grey');
  });
});
