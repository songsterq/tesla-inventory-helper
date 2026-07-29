// Paint swatch filenames → display names. Filenames are usually prefixed
// ("Paint_StealthGrey.png") but some plants/models serve them unprefixed
// (".../MODELY_/DiamondBlack.png"). A few stems are product codes that need an
// explicit marketing-name alias (e.g. Silver_R1 → Quicksilver).

const PAINT_STEM_ALIASES: Record<string, string> = {
  Silver_R1: 'Quicksilver',
  Red_Paint_R2: 'Ultra Red',
};

const cleanPaintName = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const name = raw.replace(/\s*paint\b/i, '').replace(/\s+/g, ' ').trim();
  return name.length >= 3 && name.length <= 30 ? name : null;
};

export function paintNameFromSwatchSrc(src: string | null | undefined): string | null {
  const filename = src?.split('/').pop()?.split(/[?#]/)[0];
  const stem = filename?.replace(/\.[a-z0-9]+$/i, '').replace(/^Paint_/i, '');
  if (!stem) return null;
  const aliased = PAINT_STEM_ALIASES[stem];
  if (aliased) return aliased;
  return cleanPaintName(stem.replace(/([a-z])([A-Z])/g, '$1 $2'));
}
