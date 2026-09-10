export type TeslaPlant = 'Fremont' | 'Austin' | 'Shanghai' | 'Berlin';
export type TeslaModel = 'Model S' | 'Model 3' | 'Model X' | 'Model Y' | 'Cybertruck';
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

// 5YJ = passenger car (S/3), 7SA = MPV (X/Y), 7G2 = truck (Cybertruck, and the
// Semi, which never shows up in consumer inventory). LRW/XP7 are Shanghai and
// Berlin. Per Tesla's NHTSA Part 565 filings through MY2027 and the vPIC WMI
// registry; the Cybercab is registered as a model name but had no public VIN
// pattern as of Sep 2026, and isn't sold to consumers anyway.
export const TESLA_WMIS = ['5YJ', '7SA', 'LRW', 'XP7', '7G2'] as const;

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
  '7G2': 'Austin',
};

// Model Y L (the six-seat long-wheelbase Y; China Aug 2025, US as a MY2027 from
// Jul 2026) still decodes as 'Model Y' here. Tesla kept pos 4 = Y for it, and
// as of Sep 2026 NHTSA's vPIC registers no separate series, trim, wheelbase, or
// seat count for any 2026/2027 Model Y VIN pattern, and no delivered Model Y L
// VIN has surfaced publicly. The most plausible marker is the restraint digit
// (pos 6): Tesla's own scheme uses `B` = FR, SR*2, TR*2, i.e. a 2+2+2 layout,
// which no regular Model Y ships in (they use `D` five-seat or `A` seven-seat).
// Don't act on that until real VINs confirm it — see AGENTS.md.
const MODEL_BY_POS4: Record<string, TeslaModel> = {
  S: 'Model S',
  '3': 'Model 3',
  X: 'Model X',
  Y: 'Model Y',
  C: 'Cybertruck',
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
    // S = single motor standard (2024+ service manual); T = dual motor
    // performance, which replaced C on Highland (MY2025 NHTSA filing).
    S: 'Single Motor',
    T: 'Dual Motor',
  },
  'Model Y': {
    D: 'Single Motor',
    E: 'Dual Motor',
    F: 'Dual Motor',
    J: 'Single Motor',
    K: 'Dual Motor',
    L: 'Single Motor',
    R: 'Single Motor',
    // S = single motor standard (2025+ service manual); T = the 2026 Juniper
    // Performance's dual motor (vPIC decodes 7SAYGDET*TA as "Dual Motor:
    // Performance", though the MY2026 PDF filing only lists D/E).
    S: 'Single Motor',
    T: 'Dual Motor',
  },
  // NHTSA MY2024–2025 filings + Cybertruck service manual. `C` (single-motor
  // RWD) appears in the MY2025 filing only.
  Cybertruck: {
    C: 'Single Motor',
    D: 'Dual Motor',
    E: 'Tri Motor',
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
  const re = /\b(?:5YJ|7SA|LRW|XP7|7G2)[A-HJ-NPR-Z0-9]{14}\b/gi;
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
  const likelyHw = guessHardware(model, plant, modelYear, serial);

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

// 2023 transition serials, keyed by model line then plant. Tesla numbers each
// line separately, so these are not comparable to each other: S and X switched
// over in early 2023, while the Y line didn't switch until that May, by which
// point it had run far higher serials. Community-pinned; see AGENTS.md.
//
// Every gap here is deliberate, and each one means 'Unknown' rather than a
// guess: Model 3 has no pinned 2023 cutoff at all (the Highland changeover
// doesn't map cleanly to a serial), and Berlin / Shanghai have none for any
// model.
const HW4_SERIAL_2023: Partial<Record<TeslaModel, Partial<Record<TeslaPlant, number>>>> = {
  'Model S': { Fremont: 510000 },
  'Model X': { Fremont: 385000 },
  'Model Y': { Fremont: 789500, Austin: 131200 },
};

function guessHardware(
  model: TeslaModel | null,
  plant: TeslaPlant | null,
  year: number | null,
  serial: number | null,
): TeslaHwGuess {
  // Every Cybertruck shipped on HW4 (deliveries began Nov 2023, after the
  // transition), so the model settles it before the year does.
  if (model === 'Cybertruck') return 'HW4';
  if (year === null) return 'Unknown';
  // 'HW4' here means the AI4 family (incl. the "HW4 Plus"/AI4.5 revisions,
  // which the VIN can't separate). AI5 isn't slated for volume production
  // until mid-2027, so this holds through MY2027; revisit once AI5 cars ship.
  if (year >= 2024) return 'HW4';
  if (year <= 2022) return 'HW3';
  // year === 2023: hardware transitioned mid-year; depends on model + plant +
  // serial.
  if (model === null || plant === null || serial === null) return 'Unknown';
  const cutoff = HW4_SERIAL_2023[model]?.[plant];
  if (cutoff === undefined) return 'Unknown';
  return serial >= cutoff ? 'HW4' : 'HW3';
}
