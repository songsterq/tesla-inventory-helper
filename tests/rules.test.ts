import { describe, expect, it } from 'vitest';
import { evalRules, parseRules, type Rules } from '../src/rules';
import { defaultRules } from '../src/defaultRules';
import { extractVin, extractVinFromOrderPath } from '../src/vin';

describe('extractVin', () => {
  it('returns the leading VIN segment from a data-id', () => {
    expect(extractVin('7SAYGDEE5PF633523-search-result-container')).toBe('7SAYGDEE5PF633523');
  });

  it('returns null for empty / short inputs', () => {
    expect(extractVin(null)).toBeNull();
    expect(extractVin('')).toBeNull();
    expect(extractVin('SHORT-search-result-container')).toBeNull();
  });
});

describe('extractVinFromOrderPath', () => {
  it('pulls the VIN from /my/order/<VIN>', () => {
    expect(extractVinFromOrderPath('/my/order/7SAYGDED8PF946749')).toBe('7SAYGDED8PF946749');
  });

  it('handles other model code prefixes', () => {
    expect(extractVinFromOrderPath('/m3/order/5YJ3E1EA1NF000001')).toBe('5YJ3E1EA1NF000001');
  });

  it('uppercases the result', () => {
    expect(extractVinFromOrderPath('/my/order/7sAyGDED8PF946749')).toBe('7SAYGDED8PF946749');
  });

  it('returns null when no /order/ segment is present', () => {
    expect(extractVinFromOrderPath('/my/inventory/used/m3')).toBeNull();
  });

  it('returns null on a too-short VIN segment', () => {
    expect(extractVinFromOrderPath('/my/order/SHORT')).toBeNull();
  });

  it('returns null on empty / null input', () => {
    expect(extractVinFromOrderPath(null)).toBeNull();
    expect(extractVinFromOrderPath('')).toBeNull();
  });
});

describe('evalRules with default seed rules', () => {
  it('skips a 2023 Fremont VIN below the cutoff', () => {
    expect(evalRules('7SAYGDEE5PF633523', defaultRules)).toBeNull();
  });

  it('matches a 2023 Fremont VIN at the cutoff', () => {
    const hit = evalRules('7SAYGDEE5PF789500', defaultRules);
    expect(hit?.name).toBe('HW4 Fremont 2023+');
  });

  it('matches a 2023 Austin VIN above the cutoff', () => {
    const hit = evalRules('7SAYGAEE2PA200000', defaultRules);
    expect(hit?.name).toBe('HW4 Austin 2023+');
  });

  it('skips a 2023 Austin VIN below the cutoff', () => {
    expect(evalRules('7SAYGAEE2PA100000', defaultRules)).toBeNull();
  });

  it('matches a 2024 VIN via the generic 2024+ rule (early exit)', () => {
    const hit = evalRules('7SAYGDEE5RF000001', defaultRules);
    expect(hit?.name).toBe('HW4 (any 2024+)');
  });
});

describe('evalRules edge cases', () => {
  it('returns null on empty / short VIN without throwing', () => {
    expect(evalRules('', defaultRules)).toBeNull();
    expect(evalRules('7SAY', defaultRules)).toBeNull();
  });

  it('honors rule order for early exit', () => {
    const rules: Rules = [
      { name: 'first', conditions: [{ type: 'chars', pos: 1, op: '==', value: '7' }] },
      { name: 'second', conditions: [{ type: 'chars', pos: 1, op: '==', value: '7' }] },
    ];
    expect(evalRules('7SAYGDEE5PF633523', rules)?.name).toBe('first');
  });

  it('rejects non-numeric tail in number condition', () => {
    const rules: Rules = [
      { name: 'tail', conditions: [{ type: 'number', from: 1, op: '>=', value: 0 }] },
    ];
    expect(evalRules('ABCDEF', rules)).toBeNull();
  });

  it('returns null when number "to" exceeds VIN length', () => {
    const rules: Rules = [
      {
        name: 'too far',
        conditions: [{ type: 'number', from: 12, to: 99, op: '>=', value: 0 }],
      },
    ];
    expect(evalRules('7SAYGDEE5PF633523', rules)).toBeNull();
  });
});

describe('parseRules', () => {
  it('round-trips the default rules', () => {
    const result = parseRules(JSON.parse(JSON.stringify(defaultRules)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rules).toEqual(defaultRules);
    }
  });

  it('rejects non-array top level', () => {
    const result = parseRules({ name: 'foo' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/array/i);
  });

  it('rejects unknown condition type', () => {
    const result = parseRules([
      { name: 'x', conditions: [{ type: 'foo', pos: 1, op: '==', value: 'A' }] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/type/i);
  });

  it('rejects missing rule name', () => {
    const result = parseRules([{ conditions: [{ type: 'chars', pos: 1, op: '==', value: 'A' }] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name/i);
  });

  it('rejects empty conditions array', () => {
    const result = parseRules([{ name: 'x', conditions: [] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/conditions/i);
  });

  it('rejects bad op', () => {
    const result = parseRules([
      { name: 'x', conditions: [{ type: 'chars', pos: 1, op: '~', value: 'A' }] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/op/i);
  });

  it('rejects non-positive pos', () => {
    const result = parseRules([
      { name: 'x', conditions: [{ type: 'chars', pos: 0, op: '==', value: 'A' }] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pos/i);
  });
});
