import type { TeslaHwGuess, TeslaPlant, TeslaModel, TeslaVinInfo } from '../../src/decoder';
import styles from './badge.css?raw';

const ROOT_ID = 'tih-thirdparty-root';

type MountOptions = {
  onDismiss: () => void;
};

let root: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let chipEl: HTMLButtonElement | null = null;
let bodyEl: HTMLElement | null = null;
let expanded = false;

export function mountBadge(info: TeslaVinInfo, options: MountOptions): void {
  unmountBadge();
  root = document.createElement('div');
  root.id = ROOT_ID;
  // Inline reset so the host page can't push our wrapper around with cascading styles.
  root.style.cssText = 'all: initial; position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;';
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  chipEl = document.createElement('button');
  chipEl.className = 'chip';
  chipEl.type = 'button';
  chipEl.setAttribute('aria-label', 'Tesla VIN detected — show details');
  chipEl.innerHTML = `<span class="chip-mark" aria-hidden="true">T</span><span class="chip-label">Tesla VIN</span>`;
  chipEl.addEventListener('click', () => togglePanel());

  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.hidden = true;
  panelEl.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Tesla VIN detected</span>
      <div class="panel-actions">
        <button class="icon-btn close" type="button" aria-label="Dismiss for this session">×</button>
      </div>
    </div>
    <div class="panel-body"></div>
    <div class="panel-footer">Tesla Inventory Helper</div>
  `;

  bodyEl = panelEl.querySelector<HTMLElement>('.panel-body');
  renderBody(info);

  panelEl.querySelector<HTMLButtonElement>('.close')?.addEventListener('click', () => {
    options.onDismiss();
  });

  shadow.appendChild(chipEl);
  shadow.appendChild(panelEl);
  document.documentElement.appendChild(root);

  // Close the panel when the user clicks outside our shadow root.
  document.addEventListener('click', onDocumentClick, true);
}

export function updateBadge(info: TeslaVinInfo): void {
  if (!bodyEl) return;
  renderBody(info);
}

export function unmountBadge(): void {
  document.removeEventListener('click', onDocumentClick, true);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  panelEl = null;
  chipEl = null;
  bodyEl = null;
  expanded = false;
}

function togglePanel(): void {
  if (!panelEl) return;
  expanded = !expanded;
  panelEl.hidden = !expanded;
}

function onDocumentClick(event: MouseEvent): void {
  if (!expanded || !root) return;
  if (event.composedPath().includes(root)) return;
  expanded = false;
  if (panelEl) panelEl.hidden = true;
}

function renderBody(info: TeslaVinInfo): void {
  if (!bodyEl) return;
  bodyEl.innerHTML = `
    <div class="vin"><span class="label">VIN</span><span class="value mono">${escape(info.vin)}</span></div>
    <div class="row"><span class="label">Model</span><span class="value">${escape(formatModel(info.model))}</span></div>
    <div class="row"><span class="label">Year</span><span class="value">${escape(formatYear(info.modelYear))}</span></div>
    <div class="row"><span class="label">Plant</span><span class="value">${escape(formatPlant(info.plant))}</span></div>
    <div class="row"><span class="label">Build</span><span class="value">${escape(formatSerial(info.serial))}</span></div>
    <div class="row"><span class="label">Autopilot HW</span><span class="value">${escape(formatHw(info.likelyHw))}</span></div>
  `;
}

function formatModel(model: TeslaModel | null): string {
  return model ?? 'Unknown';
}

function formatYear(year: number | null): string {
  return year !== null ? String(year) : 'Unknown';
}

function formatPlant(plant: TeslaPlant | null): string {
  if (!plant) return 'Unknown';
  if (plant === 'Berlin') return 'Berlin (Grünheide)';
  return plant;
}

function formatSerial(serial: number | null): string {
  if (serial === null) return 'Unknown';
  return `#${serial.toLocaleString('en-US')}`;
}

function formatHw(hw: TeslaHwGuess): string {
  switch (hw) {
    case 'HW4':
      return 'Likely HW4';
    case 'HW3':
      return 'Likely HW3';
    default:
      return 'Unknown';
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
