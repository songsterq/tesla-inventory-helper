import { browser } from 'wxt/browser';
import { rulesItem } from '../../src/storage';
import { defaultRules } from '../../src/defaultRules';
import { evalRules, parseRules } from '../../src/rules';

const textarea = document.getElementById('rules') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const restoreBtn = document.getElementById('restore') as HTMLButtonElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const testInput = document.getElementById('test-vin') as HTMLInputElement;
const testResult = document.getElementById('test-result') as HTMLParagraphElement;

void init();

async function init() {
  const rules = await rulesItem.getValue();
  textarea.value = JSON.stringify(rules, null, 2);
  saveBtn.addEventListener('click', onSave);
  restoreBtn.addEventListener('click', onRestore);
  textarea.addEventListener('input', runTest);
  testInput.addEventListener('input', runTest);
  refreshStatus();
  runTest();
}

function runTest() {
  const raw = testInput.value.trim().toUpperCase();
  if (testInput.value !== raw) testInput.value = raw;
  testResult.classList.remove('match', 'miss');

  if (raw.length === 0) {
    testResult.textContent = '';
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textarea.value);
  } catch {
    testResult.textContent = 'Fix rules JSON to test.';
    return;
  }
  const result = parseRules(parsedJson);
  if (!result.ok) {
    testResult.textContent = 'Fix rules to test.';
    return;
  }

  if (raw.length !== 17) {
    testResult.textContent = `Enter 17 characters (${raw.length} so far).`;
    return;
  }

  const hit = evalRules(raw, result.rules);
  if (hit) {
    testResult.classList.add('match');
    testResult.textContent = `✓ Matched: ${hit.name}`;
  } else {
    testResult.classList.add('miss');
    testResult.textContent = '✗ No rule matches this VIN.';
  }
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
  runTest();
}

async function onRestore() {
  await rulesItem.setValue(defaultRules);
  textarea.value = JSON.stringify(defaultRules, null, 2);
  errorEl.hidden = true;
  flashStatus('Restored defaults.');
  refreshStatus();
  runTest();
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
  if (
    !tab?.id ||
    !tab.url ||
    !/^https:\/\/www\.tesla\.com\/(inventory\/|[^/]+\/order\/)/.test(tab.url)
  ) {
    statusEl.textContent = 'Open a Tesla inventory or order page to see match counts.';
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
