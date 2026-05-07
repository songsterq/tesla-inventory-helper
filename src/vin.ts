export function extractVin(dataId: string | null | undefined): string | null {
  if (!dataId) return null;
  const first = dataId.split('-')[0];
  if (!first || first.length < 17) return null;
  return first.slice(0, 17);
}
