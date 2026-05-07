import { browser } from 'wxt/browser';
import { rulesItem } from '../../src/storage';
import { defaultRules } from '../../src/defaultRules';
import { parseRules } from '../../src/rules';

const textarea = document.getElementById('rules') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const restoreBtn = document.getElementById('restore') as HTMLButtonElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

void init();

async function init() {
  const rules = await rulesItem.getValue();
  textarea.value = JSON.stringify(rules, null, 2);
  saveBtn.addEventListener('click', onSave);
  restoreBtn.addEventListener('click', onRestore);
  refreshStatus();
}

async function onSave() {
  errorEl.hidden = true;
  errorEl.textContent = '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (err) {
    showError(`JSON syntax error: ${(err as Error).message}`);
    return;
  }
  const result = parseRules(parsed);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  await rulesItem.setValue(result.rules);
  textarea.value = JSON.stringify(result.rules, null, 2);
  flashStatus('Saved.');
  refreshStatus();
}

async function onRestore() {
  await rulesItem.setValue(defaultRules);
  textarea.value = JSON.stringify(defaultRules, null, 2);
  errorEl.hidden = true;
  flashStatus('Restored defaults.');
  refreshStatus();
}

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function flashStatus(message: string) {
  statusEl.textContent = message;
}

async function refreshStatus() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https:\/\/www\.tesla\.com\/inventory\//.test(tab.url)) {
    statusEl.textContent = 'Open a Tesla inventory page to see match counts.';
    return;
  }
  try {
    const reply = (await browser.tabs.sendMessage(tab.id, { type: 'tih:ping' })) as
      | { matched: number; total: number }
      | undefined;
    if (reply && typeof reply.matched === 'number' && typeof reply.total === 'number') {
      statusEl.textContent = `Highlighted ${reply.matched} of ${reply.total} cars.`;
    }
  } catch {
    statusEl.textContent = 'Reload the inventory page if highlights are missing.';
  }
}

browser.runtime.onMessage.addListener((msg) => {
  const m = msg as { type?: string; matched?: number; total?: number } | null;
  if (m && m.type === 'tih:status') {
    statusEl.textContent = `Highlighted ${m.matched} of ${m.total} cars.`;
  }
});
