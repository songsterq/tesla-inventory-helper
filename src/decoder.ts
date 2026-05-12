export type TeslaPlant = 'Fremont' | 'Austin' | 'Shanghai' | 'Berlin';
export type TeslaModel = 'Model S' | 'Model 3' | 'Model X' | 'Model Y';
export type TeslaHwGuess = 'HW3' | 'HW4' | 'Unknown';
export type TeslaDrivetrain = 'Single Motor' | 'Dual Motor' | 'Tri Motor';

export type TeslaVinInfo = {
  vin: string;
  model: TeslaModel | null;
  modelYear: number | null;
  plant: TeslaPlant | null;
  serial: number | null;
  drivetrain: TeslaDrivetrain | null;
  likelyHw: TeslaHwGuess;
};

export const TESLA_WMIS = ['5YJ', '7SA', 'LRW', 'XP7'] as const;

const TESLA_WMI_SET: ReadonlySet<string> = new Set(TESLA_WMIS);

const PLANT_BY_POS11: Record<string, TeslaPlant> = {
  F: 'Fremont',
  A: 'Austin',
  B: 'Berlin',
  R: 'Shanghai',
  C: 'Shanghai',
};

const PLANT_BY_WMI: Record<string, TeslaPlant> = {
  '5YJ': 'Fremont',
  '7SA': 'Austin',
  LRW: 'Shanghai',
  XP7: 'Berlin',
};

const MODEL_BY_POS4: Record<string, TeslaModel> = {
  S: 'Model S',
  '3': 'Model 3',
  X: 'Model X',
  Y: 'Model Y',
};

// Position 8 = motor / drive unit. Letter codes overlap across models (e.g.
// `D` is single-motor on Model Y but dual-motor on Cybertruck), so the table
// is keyed by both model and code. Codes that aren't documented for a given
// model return null — we'd rather show "Unknown" than guess wrong.
const DRIVETRAIN_BY_MODEL_AND_POS8: Record<TeslaModel, Record<string, TeslaDrivetrain>> = {
  'Model S': {
    '1': 'Single Motor',
    '2': 'Dual Motor',
    '3': 'Single Motor',
    '4': 'Dual Motor',
    '5': 'Dual Motor',
    '6': 'Tri Motor',
  },
  'Model X': {
    '1': 'Single Motor',
    '2': 'Dual Motor',
    '3': 'Single Motor',
    '4': 'Dual Motor',
    '5': 'Dual Motor',
    '6': 'Tri Motor',
  },
  'Model 3': {
    A: 'Single Motor',
    B: 'Dual Motor',
    C: 'Dual Motor',
    J: 'Single Motor',
    K: 'Dual Motor',
    L: 'Single Motor',
    R: 'Single Motor',
  },
  'Model Y': {
    D: 'Single Motor',
    E: 'Dual Motor',
    F: 'Dual Motor',
    J: 'Single Motor',
    K: 'Dual Motor',
    L: 'Single Motor',
    R: 'Single Motor',
  },
};

// NHTSA model-year letter codes for years 2010+ (skipping I, O, Q, U, Z and 0).
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isTeslaVin(s: string): boolean {
  if (s.length !== 17) return false;
  if (!VIN_REGEX.test(s)) return false;
  return TESLA_WMI_SET.has(s.slice(0, 3));
}

export function findTeslaVins(text: string): string[] {
  const re = /\b(?:5YJ|7SA|LRW|XP7)[A-HJ-NPR-Z0-9]{14}\b/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(re)) {
    const vin = match[0].toUpperCase();
    if (seen.has(vin)) continue;
    seen.add(vin);
    out.push(vin);
  }
  return out;
}

export function decodeTeslaVin(input: string): TeslaVinInfo | null {
  const vin = input.toUpperCase();
  if (!isTeslaVin(vin)) return null;

  const plant = decodePlant(vin);
  const model = MODEL_BY_POS4[vin.charAt(3)] ?? null;
  const modelYear = decodeYear(vin.charAt(9));
  const serial = decodeSerial(vin.slice(11));
  const drivetrain = decodeDrivetrain(vin, model);
  const likelyHw = guessHardware(plant, modelYear, serial);

  return { vin, model, modelYear, plant, serial, drivetrain, likelyHw };
}

function decodeDrivetrain(vin: string, model: TeslaModel | null): TeslaDrivetrain | null {
  if (!model) return null;
  const table = DRIVETRAIN_BY_MODEL_AND_POS8[model];
  return table[vin.charAt(7)] ?? null;
}

function decodePlant(vin: string): TeslaPlant | null {
  const fromPos11 = PLANT_BY_POS11[vin.charAt(10)];
  if (fromPos11) return fromPos11;
  return PLANT_BY_WMI[vin.slice(0, 3)] ?? null;
}

function decodeYear(code: string): number | null {
  const idx = YEAR_CODES.indexOf(code);
  if (idx < 0) return null;
  return 2010 + idx;
}

function decodeSerial(tail: string): number | null {
  if (!/^\d{6}$/.test(tail)) return null;
  return parseInt(tail, 10);
}

function guessHardware(
  plant: TeslaPlant | null,
  year: number | null,
  serial: number | null,
): TeslaHwGuess {
  if (year === null) return 'Unknown';
  if (year >= 2024) return 'HW4';
  if (year <= 2022) return 'HW3';
  // year === 2023: hardware transitioned mid-year; depends on plant + serial.
  if (plant === 'Fremont') {
    if (serial === null) return 'Unknown';
    return serial >= 789500 ? 'HW4' : 'HW3';
  }
  if (plant === 'Austin') {
    if (serial === null) return 'Unknown';
    return serial >= 131200 ? 'HW4' : 'HW3';
  }
  // Berlin / Shanghai 2023 transition serials are not yet community-pinned.
  return 'Unknown';
}
