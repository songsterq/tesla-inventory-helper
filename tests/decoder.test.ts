import { describe, expect, it } from 'vitest';
import { decodeTeslaVin, findTeslaVins, isTeslaVin } from '../src/decoder';
import { defaultRules } from '../src/defaultRules';
import { evalRules } from '../src/rules';

describe('isTeslaVin', () => {
  it('accepts known Tesla WMIs with valid VIN shape', () => {
    expect(isTeslaVin('5YJ3E1EA1NF000001')).toBe(true);
    expect(isTeslaVin('7SAYGDEE5PF633523')).toBe(true);
    expect(isTeslaVin('LRWYGCEK7RC000001')).toBe(true);
    expect(isTeslaVin('XP7YGCEE1RB000001')).toBe(true);
  });

  it('rejects non-Tesla WMIs', () => {
    expect(isTeslaVin('1HGCM82633A004352')).toBe(false);
    expect(isTeslaVin('WBA00000000000000')).toBe(false);
  });

  it('rejects wrong-length or malformed VINs', () => {
    expect(isTeslaVin('')).toBe(false);
    expect(isTeslaVin('5YJ3E1EA1NF00001')).toBe(false);
    expect(isTeslaVin('5YJ3E1EA1NF0000I1')).toBe(false); // contains forbidden 'I'
    expect(isTeslaVin('5YJ3E1EA1NF0000Q1')).toBe(false); // contains forbidden 'Q'
  });
});

describe('decodeTeslaVin — model line', () => {
  it('decodes Model 3', () => {
    expect(decodeTeslaVin('5YJ3E1EA1NF000001')?.model).toBe('Model 3');
  });
  it('decodes Model Y', () => {
    expect(decodeTeslaVin('7SAYGDEE5PF633523')?.model).toBe('Model Y');
  });
  it('decodes Model S', () => {
    expect(decodeTeslaVin('5YJSA1E20NF000001')?.model).toBe('Model S');
  });
  it('decodes Model X', () => {
    expect(decodeTeslaVin('5YJXCBE20NF000001')?.model).toBe('Model X');
  });
  it('returns null model for unknown position-4 code', () => {
    expect(decodeTeslaVin('5YJZE1EA1NF000001')?.model).toBeNull();
  });
});

describe('decodeTeslaVin — model year', () => {
  it('decodes 2022 (N)', () => {
    expect(decodeTeslaVin('5YJ3E1EA1NF000001')?.modelYear).toBe(2022);
  });
  it('decodes 2023 (P)', () => {
    expect(decodeTeslaVin('7SAYGDEE5PF633523')?.modelYear).toBe(2023);
  });
  it('decodes 2024 (R)', () => {
    expect(decodeTeslaVin('7SAYGDEE5RF000001')?.modelYear).toBe(2024);
  });
  it('decodes 2025 (S)', () => {
    expect(decodeTeslaVin('7SAYGDEE5SF000001')?.modelYear).toBe(2025);
  });
  it('decodes 2026 (T)', () => {
    expect(decodeTeslaVin('7SAYGDEE5TF000001')?.modelYear).toBe(2026);
  });
});

describe('decodeTeslaVin — plant', () => {
  it('decodes Fremont from pos 11 = F', () => {
    expect(decodeTeslaVin('5YJ3E1EA1NF000001')?.plant).toBe('Fremont');
  });
  it('decodes Austin from pos 11 = A', () => {
    expect(decodeTeslaVin('7SAYGAEE2PA200000')?.plant).toBe('Austin');
  });
  it('decodes Berlin from pos 11 = B', () => {
    expect(decodeTeslaVin('XP7YGCEE1RB000001')?.plant).toBe('Berlin');
  });
  it('decodes Shanghai from pos 11 = R', () => {
    expect(decodeTeslaVin('LRWYGCEK7RR000001')?.plant).toBe('Shanghai');
  });
  it('decodes Shanghai from pos 11 = C', () => {
    expect(decodeTeslaVin('LRWYGCEK7RC000001')?.plant).toBe('Shanghai');
  });
  it('falls back to WMI when pos 11 is not a known plant code', () => {
    expect(decodeTeslaVin('LRWYGCEK7R1000001')?.plant).toBe('Shanghai');
  });
});

describe('decodeTeslaVin — drivetrain (position 8)', () => {
  it('decodes Model 3 single motor (A)', () => {
    expect(decodeTeslaVin('5YJ3E1EA1NF000001')?.drivetrain).toBe('Single Motor');
  });
  it('decodes Model 3 dual motor (B)', () => {
    expect(decodeTeslaVin('5YJ3E1EB1NF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes Model 3 dual motor performance (C)', () => {
    expect(decodeTeslaVin('5YJ3E1EC1NF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes Model Y single motor (D)', () => {
    expect(decodeTeslaVin('7SAYGDED5PF000001')?.drivetrain).toBe('Single Motor');
  });
  it('decodes Model Y dual motor (E)', () => {
    expect(decodeTeslaVin('7SAYGDEE5PF633523')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes Model Y dual motor performance (F)', () => {
    expect(decodeTeslaVin('7SAYGDEF5PF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes Model S dual motor (2)', () => {
    expect(decodeTeslaVin('5YJSA1E20NF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes Model S Plaid tri motor (6)', () => {
    expect(decodeTeslaVin('5YJSA1E60NF000001')?.drivetrain).toBe('Tri Motor');
  });
  it('decodes Model X dual motor (2)', () => {
    expect(decodeTeslaVin('5YJXCBE20NF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('decodes hairpin K as dual on Model Y', () => {
    expect(decodeTeslaVin('7SAYGDEK5RF000001')?.drivetrain).toBe('Dual Motor');
  });
  it('returns null for an undocumented position-8 code', () => {
    expect(decodeTeslaVin('5YJ3E1EZ1NF000001')?.drivetrain).toBeNull();
  });
});

describe('decodeTeslaVin — serial', () => {
  it('parses the 6-digit production serial', () => {
    expect(decodeTeslaVin('7SAYGDEE5PF633523')?.serial).toBe(633523);
  });
  it('returns null when tail is non-numeric', () => {
    expect(decodeTeslaVin('7SAYGDEE5PFABC123')?.serial).toBeNull();
  });
});

describe('decodeTeslaVin — likely hardware', () => {
  it('returns HW4 for any 2024+ regardless of plant', () => {
    expect(decodeTeslaVin('7SAYGDEE5RF000001')?.likelyHw).toBe('HW4');
    expect(decodeTeslaVin('XP7YGCEE1SB000001')?.likelyHw).toBe('HW4');
    expect(decodeTeslaVin('LRWYGCEK7TC000001')?.likelyHw).toBe('HW4');
  });
  it('returns HW3 for 2022 or earlier', () => {
    expect(decodeTeslaVin('5YJ3E1EA1NF000001')?.likelyHw).toBe('HW3');
    expect(decodeTeslaVin('5YJ3E1EA1MF000001')?.likelyHw).toBe('HW3');
  });
  it('uses serial threshold for Model Y Fremont 2023', () => {
    expect(decodeTeslaVin('5YJYGDEE1PF789499')?.likelyHw).toBe('HW3');
    expect(decodeTeslaVin('5YJYGDEE1PF789500')?.likelyHw).toBe('HW4');
  });
  it('uses serial threshold for Model Y Austin 2023', () => {
    expect(decodeTeslaVin('7SAYGDEE5PA131199')?.likelyHw).toBe('HW3');
    expect(decodeTeslaVin('7SAYGDEE5PA131200')?.likelyHw).toBe('HW4');
  });
  // Model 3 has no pinned 2023 cutoff. The Model Y serial must not stand in for
  // one, in either direction — 2023 Model 3 is 'Unknown', not HW3 or HW4.
  it('returns Unknown for a 2023 Model 3 at any serial', () => {
    expect(decodeTeslaVin('5YJ3E1EA1PF789499')?.likelyHw).toBe('Unknown');
    expect(decodeTeslaVin('5YJ3E1EA1PF800000')?.likelyHw).toBe('Unknown');
    expect(decodeTeslaVin('5YJ3E1EA1PA999999')?.likelyHw).toBe('Unknown');
  });
  it('returns HW4 for a 2024 Model 3', () => {
    expect(decodeTeslaVin('5YJ3E1EA1RF000001')?.likelyHw).toBe('HW4');
  });
  // S and X are numbered on their own lines and switched to HW4 months before
  // the Y line did, at much lower serials.
  it('uses per-model serial thresholds for Fremont 2023 S / X', () => {
    expect(decodeTeslaVin('5YJSA1E50PF509999')?.likelyHw).toBe('HW3');
    expect(decodeTeslaVin('5YJSA1E50PF510000')?.likelyHw).toBe('HW4');
    expect(decodeTeslaVin('5YJXCBE21PF384999')?.likelyHw).toBe('HW3');
    expect(decodeTeslaVin('5YJXCBE21PF385000')?.likelyHw).toBe('HW4');
  });
  it('agrees with the default highlight rules on 2023 Fremont S / X', () => {
    // A VIN must never glow as a rule match while the popover calls it HW3.
    for (const vin of ['5YJSA1E50PF550000', '5YJXCBE21PF400000']) {
      expect(decodeTeslaVin(vin)?.likelyHw).toBe('HW4');
      expect(evalRules(vin, defaultRules)).not.toBeNull();
    }
  });
  it('returns Unknown for Berlin/Shanghai 2023 (no community-pinned threshold)', () => {
    expect(decodeTeslaVin('XP7YGCEE1PB050000')?.likelyHw).toBe('Unknown');
    expect(decodeTeslaVin('LRWYGCEK7PR050000')?.likelyHw).toBe('Unknown');
  });
});

describe('decodeTeslaVin — rejection', () => {
  it('returns null for non-Tesla VINs', () => {
    expect(decodeTeslaVin('1HGCM82633A004352')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(decodeTeslaVin('')).toBeNull();
    expect(decodeTeslaVin('not a vin')).toBeNull();
  });
});

describe('findTeslaVins', () => {
  it('finds a Tesla VIN embedded in text', () => {
    const text = 'VIN: 7SAYGDEE5PF633523\nOther info here.';
    expect(findTeslaVins(text)).toEqual(['7SAYGDEE5PF633523']);
  });
  it('returns multiple distinct VINs in document order', () => {
    const text = 'A 5YJ3E1EA1NF000001 and later XP7YGCEE1RB000123 appear.';
    expect(findTeslaVins(text)).toEqual(['5YJ3E1EA1NF000001', 'XP7YGCEE1RB000123']);
  });
  it('deduplicates repeated VINs', () => {
    const text = '7SAYGDEE5PF633523 ... 7SAYGDEE5PF633523';
    expect(findTeslaVins(text)).toEqual(['7SAYGDEE5PF633523']);
  });
  it('does not match non-Tesla 17-char strings', () => {
    expect(findTeslaVins('1HGCM82633A004352 in the page.')).toEqual([]);
  });
  it('returns an empty array when no Tesla VIN is present', () => {
    expect(findTeslaVins('no vins here')).toEqual([]);
  });
  it('lower-case input is normalized to upper-case output', () => {
    expect(findTeslaVins('7sayGdee5pF633523')).toEqual(['7SAYGDEE5PF633523']);
  });
});
