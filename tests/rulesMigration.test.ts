import { describe, expect, it } from 'vitest';
import { defaultRules, migrateRulesToV2 } from '../src/defaultRules';
import { evalRules, parseRules, rulesEqual, type Rules } from '../src/rules';

// The v1.1.9 defaults, as a user who hit Save would have them stored: run
// through parseRules, then JSON round-tripped by chrome.storage.
const V1_STORED = JSON.parse(
  JSON.stringify([
    {
      name: 'HW4 (any 2024+)',
      conditions: [
        { type: 'chars', pos: 1, op: 'in', value: ['5YJ', '7SA', 'LRW', 'XP7'] },
        { type: 'chars', pos: 10, op: '>', value: 'P' },
      ],
    },
    {
      name: 'HW4 Fremont 2023+',
      conditions: [
        { type: 'chars', pos: 10, op: '==', value: 'PF' },
        { type: 'number', from: 12, op: '>=', value: 789500 },
      ],
    },
    {
      name: 'HW4 Austin 2023+',
      conditions: [
        { type: 'chars', pos: 10, op: '==', value: 'PA' },
        { type: 'number', from: 12, op: '>=', value: 131200 },
      ],
    },
  ]),
);

describe('rulesEqual', () => {
  it('matches a value that has been through parseRules and JSON', () => {
    const parsed = parseRules(JSON.parse(JSON.stringify(defaultRules)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(rulesEqual(parsed.rules, defaultRules)).toBe(true);
  });

  it('ignores key order', () => {
    const reordered: Rules = [
      {
        conditions: [{ value: 'PF', op: '==', pos: 10, type: 'chars' }],
        name: 'x',
      } as unknown as Rules[number],
    ];
    const straight: Rules = [
      { name: 'x', conditions: [{ type: 'chars', pos: 10, op: '==', value: 'PF' }] },
    ];
    expect(rulesEqual(reordered, straight)).toBe(true);
  });

  it('separates rule sets that differ only in a threshold', () => {
    const a: Rules = [
      { name: 'x', conditions: [{ type: 'number', from: 12, op: '>=', value: 789500 }] },
    ];
    const b: Rules = [
      { name: 'x', conditions: [{ type: 'number', from: 12, op: '>=', value: 510000 }] },
    ];
    expect(rulesEqual(a, b)).toBe(false);
  });

  it('separates rule sets that differ in name, length, or `in` values', () => {
    const base: Rules = [
      { name: 'x', conditions: [{ type: 'chars', pos: 1, op: 'in', value: ['5YJ', '7SA'] }] },
    ];
    expect(
      rulesEqual(base, [
        { name: 'y', conditions: [{ type: 'chars', pos: 1, op: 'in', value: ['5YJ', '7SA'] }] },
      ]),
    ).toBe(false);
    expect(
      rulesEqual(base, [
        { name: 'x', conditions: [{ type: 'chars', pos: 1, op: 'in', value: ['5YJ'] }] },
      ]),
    ).toBe(false);
    expect(rulesEqual(base, [])).toBe(false);
  });

  it('separates a chars string value from a single-entry `in` list', () => {
    const asString: Rules = [
      { name: 'x', conditions: [{ type: 'chars', pos: 1, op: 'in', value: '5YJ' } as never] },
    ];
    const asList: Rules = [
      { name: 'x', conditions: [{ type: 'chars', pos: 1, op: 'in', value: ['5YJ'] }] },
    ];
    expect(rulesEqual(asString, asList)).toBe(false);
  });
});

describe('migrateRulesToV2', () => {
  it('re-seeds an untouched copy of the v1 defaults', () => {
    expect(migrateRulesToV2(V1_STORED)).toEqual(defaultRules);
  });

  it('fixes the S/X and Model 3 verdicts for a re-seeded user', () => {
    const migrated = migrateRulesToV2(V1_STORED);
    // Was missed under v1 — S runs its own, much lower serial sequence.
    expect(evalRules('5YJSA1E50PF550000', migrated)?.name).toBe('HW4 Model S Fremont 2023');
    // Was a false positive under v1 — 789500 is a Model Y number.
    expect(evalRules('5YJ3E1EA1PF800000', V1_STORED)).not.toBeNull();
    expect(evalRules('5YJ3E1EA1PF800000', migrated)).toBeNull();
  });

  it('leaves a customized rule set alone', () => {
    const custom = JSON.parse(JSON.stringify(V1_STORED));
    custom[1].conditions[1].value = 800000;
    expect(migrateRulesToV2(custom)).toBe(custom);
  });

  it('leaves an added or removed rule alone', () => {
    const extra = JSON.parse(JSON.stringify(V1_STORED));
    extra.push({ name: 'mine', conditions: [{ type: 'chars', pos: 4, op: '==', value: 'Y' }] });
    expect(migrateRulesToV2(extra)).toBe(extra);

    const fewer = JSON.parse(JSON.stringify(V1_STORED)).slice(0, 2);
    expect(migrateRulesToV2(fewer)).toBe(fewer);
  });

  it('leaves the already-current defaults alone', () => {
    const current = JSON.parse(JSON.stringify(defaultRules));
    expect(migrateRulesToV2(current)).toBe(current);
  });

  it('passes unparseable values through rather than repairing them', () => {
    // A migration must never be the thing that destroys someone's data.
    const junk = { not: 'rules' };
    expect(migrateRulesToV2(junk)).toBe(junk);
    expect(migrateRulesToV2(null)).toBeNull();
    const halfBad = [{ name: 'x', conditions: [{ type: 'nope' }] }];
    expect(migrateRulesToV2(halfBad)).toBe(halfBad);
  });
});
