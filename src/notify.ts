import type { SavedCar } from './savedCars';
import type { CarSummary } from './inventoryCar';
import { distanceUnitFromPath, orderUrl, type SavedSearch } from './savedSearches';
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from './format';

// A qualifying change observed during a single check run. Only price drops and
// gone/sold cars are collected — price rises never notify.
export type RunChange = {
  car: SavedCar; // the car AFTER the check result was applied (car.latest is the new snapshot)
  change: 'price-drop' | 'gone';
  prevPrice: number | null; // the price BEFORE this run, for the delta
};

// Where a click on the notification should take the user.
export type NotifyTarget = { kind: 'url'; url: string } | { kind: 'popup' } | { kind: 'search'; searchId: string };

export type ChangeNotification = {
  id: string;
  title: string;
  message: string;
  contextMessage?: string;
  target: NotifyTarget;
};

export type SearchAlertInput = { search: SavedSearch; label: string; cars: CarSummary[] };

const joinParts = (parts: (string | number | null)[], separator = ' · '): string =>
  parts.filter((part) => part !== null && part !== '').join(separator);

const summaryPrice = (car: CarSummary): string | null =>
  car.price === null ? null : `${priceSymbol(car.currency)}${car.price.toLocaleString()}`;

// Arrivals are per-run, not the persistent unread count. Repeated checks of an
// unread car must never keep notifying. The caller supplies alarm-run arrivals.
export function buildSearchAlertNotifications(perSearch: SearchAlertInput[]): ChangeNotification[] {
  return perSearch.flatMap(({ search, label, cars }): ChangeNotification[] => {
    if (search.alerts !== true || cars.length === 0) return [];
    const car = cars[0]!;
    if (cars.length === 1) {
      let unit: 'mi' | 'km' = 'mi';
      try { unit = distanceUnitFromPath(new URL(search.url).pathname); } catch { /* unknown locale */ }
      const url = orderUrl(search, car.orderId);
      return [{
        id: `tih:match:${search.id}:${car.orderId}`,
        title: `New match · ${label}`,
        message: joinParts([
          joinParts([car.year, car.model, car.trim], ' '),
          summaryPrice(car),
          search.condition === 'used' && car.odometer !== null
            ? `${car.odometer.toLocaleString()} ${unit}` : null,
        ]),
        contextMessage: joinParts([
          car.paint, car.wheels, car.interior, car.seats, car.towHitch ? 'Tow Hitch' : null,
        ]),
        target: url ? { kind: 'url', url } : { kind: 'popup' },
      }];
    }
    const lines = cars.slice(0, 3).map((c) => joinParts([c.trim, c.paint, summaryPrice(c)]));
    if (cars.length > 3) lines.push(`+${cars.length - 3} more`);
    return [{
      id: `tih:matches:${search.id}`,
      title: `${cars.length} new matches · ${label}`,
      message: lines.join('\n'),
      target: { kind: 'search', searchId: search.id },
    }];
  });
}

// Turn a run's qualifying changes into notification content, or null when there
// is nothing to announce. One changed car → a car-specific notification that
// deep-links to its listing; several → a summary that opens the watchlist.
export function buildChangeNotification(changes: RunChange[]): ChangeNotification | null {
  if (changes.length === 0) return null;

  if (changes.length === 1) {
    const { car, change, prevPrice } = changes[0]!;
    const base = {
      id: `tih:car:${car.vin}`,
      title: formatCarName(car),
      contextMessage: formatCarSubLine(car),
      target: { kind: 'url', url: car.url } as const,
    };
    if (change === 'gone') {
      return { ...base, message: 'No longer listed' };
    }
    const newPrice = car.latest.price;
    if (prevPrice !== null && newPrice !== null) {
      const drop = prevPrice - newPrice;
      const sym = priceSymbol(car.latest.currency);
      return { ...base, message: `Price dropped ${sym}${drop.toLocaleString()} → ${formatPrice(car.latest)}` };
    }
    return { ...base, message: `Price dropped → ${formatPrice(car.latest)}` };
  }

  const names = changes.map((c) => formatCarName(c.car)).join(', ');
  return {
    id: 'tih:summary',
    title: `${changes.length} watched cars changed`,
    message: names,
    target: { kind: 'popup' },
  };
}

// Decide whether a checked car's result is a change worth notifying about THIS
// run, and package it as a RunChange. Returns null when there is nothing new to
// announce. Price drops are inherently per-run (a stable price diffs to 'none').
// 'gone', however, is sticky — diffSnapshot reports 'gone' on every run while a
// car stays unavailable — so only a fresh transition into unavailable notifies.
export function toRunChange(existing: SavedCar, result: SavedCar): RunChange | null {
  if (result.lastChange === 'price-drop') {
    return { car: result, change: 'price-drop', prevPrice: existing.latest.price };
  }
  if (result.lastChange === 'gone' && existing.latest.availability !== 'unavailable') {
    return { car: result, change: 'gone', prevPrice: existing.latest.price };
  }
  return null;
}
