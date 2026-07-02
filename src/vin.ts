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
