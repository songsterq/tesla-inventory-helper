import { browser } from 'wxt/browser';
import { migratedFromSyncItem } from './storage';

// The popup and content scripts await this before their first storage read.
// Right after an update from a pre-v1.2.5 build, the background worker is still
// copying the old `sync` values into `local`; reading before it finishes would
// show defaults — and in the popup, a Save could then write over the user's
// real rules. Once the copy has run (every later page load), this is one local
// read.
export async function whenStorageReady(): Promise<void> {
  if (await migratedFromSyncItem.getValue()) return;
  // The worker answers only once its copy is done; asking also wakes it.
  await browser.runtime.sendMessage({ type: 'tih:storage-ready' }).catch(() => null);
}
