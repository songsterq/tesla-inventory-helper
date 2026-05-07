import { storage } from 'wxt/utils/storage';
import type { Rules } from './rules';
import { defaultRules } from './defaultRules';

export const rulesItem = storage.defineItem<Rules>('sync:rules', {
  fallback: defaultRules,
});
