import { describe, expect, it } from 'vitest';
import { defaultRules, RULES_STORAGE_VERSION, upgradeRules } from '../src/defaultRules';
import { planSyncToLocal } from '../src/syncMigration';
import type { Rules } from '../src/rules';

// The v1.1.9 defaults as a user who hit Save would have them in storage.
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

const CUSTOM: Rules = [
  { name: 'Mine', conditions: [{ type: 'chars', pos: 10, op: '>=', value: 'R' }] },
];

const search = (id: string) => ({ id, name: '', description: id, url: `u/${id}`, condition: 'used', ranges: {}, createdAt: 1 });

describe('upgradeRules', () => {
  it('runs an untouched v1 copy up to the current defaults', () => {
    expect(upgradeRules(V1_STORED, 1)).toEqual(defaultRules);
  });

  it('leaves custom rules and current-version values alone', () => {
    expect(upgradeRules(CUSTOM, 1)).toEqual(CUSTOM);
    expect(upgradeRules(CUSTOM, RULES_STORAGE_VERSION)).toBe(CUSTOM);
  });
});

describe('planSyncToLocal', () => {
  it('does nothing for a fresh install', () => {
    expect(planSyncToLocal({}, {})).toEqual({});
  });

  it('copies every synced value into an empty local', () => {
    const sync = {
      rules: CUSTOM,
      rules$: { v: RULES_STORAGE_VERSION },
      highlightingEnabled: false,
      autoCheckMinutes: 360,
      autoCheckHour: 7,
      savedSearches: [search('a'), search('b')],
    };
    expect(planSyncToLocal(sync, {})).toEqual({
      rules: CUSTOM,
      rules$: { v: RULES_STORAGE_VERSION },
      highlightingEnabled: false,
      autoCheckMinutes: 360,
      autoCheckHour: 7,
      savedSearches: [search('a'), search('b')],
    });
  });

  it('upgrades old synced rules on the way and stamps the current version', () => {
    const v1 = planSyncToLocal({ rules: V1_STORED }, {});
    expect(v1.rules).toEqual(defaultRules);
    expect(v1.rules$).toEqual({ v: RULES_STORAGE_VERSION });
    const v2meta = planSyncToLocal({ rules: CUSTOM, rules$: { v: 2 } }, {});
    expect(v2meta.rules).toEqual(CUSTOM);
  });

  it('never overwrites a value already set on this device', () => {
    const sync = { rules: CUSTOM, highlightingEnabled: false, autoCheckMinutes: 360, autoCheckHour: 7 };
    const local = { rules: defaultRules, highlightingEnabled: true, autoCheckMinutes: 0, autoCheckHour: 0 };
    expect(planSyncToLocal(sync, local)).toEqual({});
  });

  it('skips rules stored by a newer version', () => {
    expect(planSyncToLocal({ rules: CUSTOM, rules$: { v: RULES_STORAGE_VERSION + 1 } }, {})).toEqual({});
  });

  it('ignores synced values of the wrong type', () => {
    expect(
      planSyncToLocal({ highlightingEnabled: 'yes', autoCheckMinutes: '360', savedSearches: 'x' }, {}),
    ).toEqual({});
  });

  it('merges saved searches by id, keeping local ones first', () => {
    const plan = planSyncToLocal(
      { savedSearches: [search('a'), search('b'), { bad: true }] },
      { savedSearches: [search('c'), search('a')] },
    );
    expect((plan.savedSearches as { id: string }[]).map((s) => s.id)).toEqual(['c', 'a', 'b']);
    // Nothing new to add → no write.
    expect(planSyncToLocal({ savedSearches: [search('a')] }, { savedSearches: [search('a')] })).toEqual({});
  });
});
