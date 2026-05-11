import type { Rules } from './rules';

// The "any 2024+" rule already covers Berlin (XP7) and Shanghai (LRW) cars
// from model year 2024 onwards. The plant-specific rules below catch the 2023
// HW3→HW4 transition. Fremont/Austin thresholds are community-pinned; Berlin
// and Shanghai 2023 cutoffs aren't, so those rules currently match any 2023
// car from those plants and may over-include early-2023 HW3 builds.
export const defaultRules: Rules = [
  {
    name: 'HW4 (any 2024+)',
    conditions: [{ type: 'chars', pos: 10, op: '>', value: 'P' }],
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
  {
    name: 'HW4 Berlin 2023+',
    conditions: [
      { type: 'chars', pos: 1, op: '==', value: 'XP7' },
      { type: 'chars', pos: 10, op: '==', value: 'P' },
    ],
  },
  {
    name: 'HW4 Shanghai 2023+',
    conditions: [
      { type: 'chars', pos: 1, op: '==', value: 'LRW' },
      { type: 'chars', pos: 10, op: '==', value: 'P' },
    ],
  },
];
