import { parseRules, rulesEqual, type Rules } from './rules';

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

// The defaults as they shipped through v1.1.9, frozen. This is history, not
// config: never "fix" it to match the current rules, and note that the WMI list
// is inlined rather than sharing TESLA_WMIS above, so editing that constant
// can't retroactively rewrite what v1 looked like.
//
// Its only job is to answer "did this user save the old defaults verbatim?" in
// the storage migration below.
const V1_DEFAULT_RULES: Rules = [
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
];

/**
 * `sync:rules` v1 → v2.
 *
 * Users who never opened the rules editor have nothing stored and pick up the
 * new defaults from `fallback` on their own. This is for the ones who hit Save
 * or Reset at some point: they hold a private copy pinned to the v1 cutoffs,
 * which we now know were wrong for S/X and for Model 3.
 *
 * Only an untouched copy of the v1 defaults is replaced. Anything else is a
 * customization and is returned as-is — a rule set the user actually wrote is
 * theirs, and silently overwriting it would be worse than leaving it stale.
 * Unparseable values are also passed through untouched rather than "repaired",
 * so a migration can never be the thing that destroys someone's data.
 */
export function migrateRulesToV2(stored: unknown): Rules {
  const parsed = parseRules(stored);
  if (parsed.ok && rulesEqual(parsed.rules, V1_DEFAULT_RULES)) return defaultRules;
  return stored as Rules;
}
