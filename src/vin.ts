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

// A sold used car's order page redirects to the inventory listing, which is
// Tesla's signal that the car is gone. Given a tab's final URL and the VIN we
// asked about, report that redirect. Deliberately conservative: only a bounce
// to an `/inventory/` listing counts. Still being on the car's own order page,
// an unrelated redirect (login/error), or an unparseable URL all return false,
// so a flaky load is never mistaken for a confirmed "gone".
export function isSoldRedirect(finalUrl: string, expectedVin: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    return false;
  }
  if (extractVinFromOrderPath(pathname) === expectedVin) return false;
  return /\/inventory\//.test(pathname);
}
