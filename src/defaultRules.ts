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
  // 2023 is the transition year, so each rule needs a serial cutoff. Every 2023
  // rule is model-scoped: the cutoffs come from separate serial sequences and
  // are meaningless applied across lines. Model 3 has no 2023 rule on purpose —
  // see AGENTS.md.
  {
    name: 'HW4 Model Y Fremont 2023',
    conditions: [
      { type: 'chars', pos: 4, op: '==', value: 'Y' },
      { type: 'chars', pos: 10, op: '==', value: 'PF' },
      { type: 'number', from: 12, op: '>=', value: 789500 },
    ],
  },
  {
    name: 'HW4 Model Y Austin 2023',
    conditions: [
      { type: 'chars', pos: 4, op: '==', value: 'Y' },
      { type: 'chars', pos: 10, op: '==', value: 'PA' },
      { type: 'number', from: 12, op: '>=', value: 131200 },
    ],
  },
  // S and X run their own serial sequences and switched to HW4 months earlier,
  // at serials well below where the Y line was that May. These sit below the
  // generic Fremont rule only for naming — a 2023 S or X never reaches 789500,
  // so the rule above can't claim them first.
  {
    name: 'HW4 Model S Fremont 2023',
    conditions: [
      { type: 'chars', pos: 4, op: '==', value: 'S' },
      { type: 'chars', pos: 10, op: '==', value: 'PF' },
      { type: 'number', from: 12, op: '>=', value: 510000 },
    ],
  },
  {
    name: 'HW4 Model X Fremont 2023',
    conditions: [
      { type: 'chars', pos: 4, op: '==', value: 'X' },
      { type: 'chars', pos: 10, op: '==', value: 'PF' },
      { type: 'number', from: 12, op: '>=', value: 385000 },
    ],
  },
];
