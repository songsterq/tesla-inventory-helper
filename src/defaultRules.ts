import type { Rules } from './rules';

const TESLA_WMIS = ['5YJ', '7SA', 'LRW', 'XP7'];

export const defaultRules: Rules = [
  {
    name: 'HW4 (any 2024+)',
    conditions: [
      { type: 'chars', pos: 1, op: 'in', value: TESLA_WMIS },
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
];
