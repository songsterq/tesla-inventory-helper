import type { SavedCar } from './savedCars';
import { formatCarName, formatCarSubLine, formatPrice, priceSymbol } from './format';

// A qualifying change observed during a single check run. Only price drops and
// gone/sold cars are collected — price rises never notify.
export type RunChange = {
  car: SavedCar; // the car AFTER the check result was applied (car.latest is the new snapshot)
  change: 'price-drop' | 'gone';
  prevPrice: number | null; // the price BEFORE this run, for the delta
};

// Where a click on the notification should take the user.
export type NotifyTarget = { kind: 'url'; url: string } | { kind: 'popup' };

export type ChangeNotification = {
  id: string;
  title: string;
  message: string;
  contextMessage?: string;
  target: NotifyTarget;
};

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
