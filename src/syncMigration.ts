import { RULES_STORAGE_VERSION, upgradeRules } from './defaultRules';

// Until v1.2.5, the rules, the highlight toggle, the auto-check schedule and
// saved searches lived in chrome.storage.sync; everything else in local. Now
// everything is `local`: one place, per device. This plans the one-time copy of
// the old sync values into local. PURE; the background worker runs it once
// (gated by migratedFromSyncItem) and every other context waits for it.
//
// The sync copy is deliberately left in place, not deleted: removing it would
// propagate to the user's other devices, wiping the data an older build there
// still reads and that its own copy step will need once it updates.

// WXT stores `sync:rules` and `local:rules` under the same raw key, `rules`,
// with its version metadata at `rules$`.
export const LEGACY_SYNC_KEYS = [
  'rules',
  'rules$',
  'highlightingEnabled',
  'autoCheckMinutes',
  'autoCheckHour',
  'savedSearches',
] as const;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// The raw local writes that carry the sync values over. A value already in
// local wins (the user changed it on this device after updating), except saved
// searches, which merge by id so a search saved here in the moments before the
// copy ran can't hide the synced ones.
export function planSyncToLocal(
  sync: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Upgraded on the way: the local item's own migrations key off the local
  // `rules$`, which the copy writes as current.
  if (local.rules == null && sync.rules != null) {
    const meta = sync['rules$'];
    const from = isRecord(meta) && typeof meta.v === 'number' ? meta.v : 1;
    if (from <= RULES_STORAGE_VERSION) {
      out.rules = upgradeRules(sync.rules, from);
      out['rules$'] = { v: RULES_STORAGE_VERSION };
    }
  }

  if (local.highlightingEnabled == null && typeof sync.highlightingEnabled === 'boolean') {
    out.highlightingEnabled = sync.highlightingEnabled;
  }
  for (const key of ['autoCheckMinutes', 'autoCheckHour'] as const) {
    if (local[key] == null && typeof sync[key] === 'number') out[key] = sync[key];
  }

  if (Array.isArray(sync.savedSearches)) {
    const mine: unknown[] = Array.isArray(local.savedSearches) ? local.savedSearches : [];
    const ids = new Set(mine.map((s) => (isRecord(s) ? s.id : undefined)));
    const extra = sync.savedSearches.filter(
      (s) => isRecord(s) && typeof s.id === 'string' && !ids.has(s.id),
    );
    if (extra.length > 0) out.savedSearches = [...mine, ...extra];
  }

  return out;
}
