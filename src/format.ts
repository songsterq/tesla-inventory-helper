import type { CarSnapshot, SavedCar } from './savedCars';

// Shared price/car formatting used by both the popup watchlist row and the
// background change notification, so the two surfaces render identically.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  CAD: 'CA$',
  EUR: '€',
  GBP: '£',
  CNY: '¥',
  JPY: '¥',
  AUD: 'A$',
  HKD: 'HK$',
  CHF: 'CHF ',
  AED: 'AED ',
  KRW: '₩',
};

export const priceSymbol = (currency: string | null): string =>
  currency ? (CURRENCY_SYMBOL[currency] ?? '') : '';

export function formatPrice(s: CarSnapshot): string {
  if (s.price === null) return '—';
  return `${priceSymbol(s.currency)}${s.price.toLocaleString()}`;
}

// Title line, e.g. "2024 Model Y Long Range All-Wheel Drive"; VIN when unknown.
export function formatCarName(car: SavedCar): string {
  return [car.modelYear, car.model, car.trim].filter(Boolean).join(' ') || car.vin;
}

// Sub-line, e.g. "Stealth Grey · 42,000 mi · HW4"; parts drop out when absent.
export function formatCarSubLine(car: SavedCar): string {
  const parts: (string | null)[] = [car.paintName];
  if (car.mileage && car.mileageUnit) {
    parts.push(`${car.mileage.toLocaleString()} ${car.mileageUnit}`);
  }
  parts.push(car.likelyHw);
  return parts.filter(Boolean).join(' · ');
}
