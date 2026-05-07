export function extractVin(dataId: string | null | undefined): string | null {
  if (!dataId) return null;
  const first = dataId.split('-')[0];
  if (!first || first.length < 17) return null;
  return first.slice(0, 17).toUpperCase();
}

export function extractVinFromOrderPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = pathname.match(/\/order\/([A-Za-z0-9]+)/);
  if (!match || !match[1] || match[1].length < 17) return null;
  return match[1].slice(0, 17).toUpperCase();
}
