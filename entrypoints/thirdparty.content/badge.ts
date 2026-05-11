import type { TeslaPlant, TeslaModel, TeslaVinInfo } from '../../src/decoder';
import styles from './badge.css?raw';

const ROOT_ID = 'tih-thirdparty-root';

type MountOptions = {
  onDismiss: () => void;
};

let root: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;

const ICON_SVG = `<svg class="brand-icon" viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="22" fill="#ffffff"/><g fill="#E82127"><rect x="20" y="32" width="88" height="18" rx="3"/><rect x="55" y="50" width="18" height="50" rx="3"/></g></svg>`;

export function mountBadge(info: TeslaVinInfo, options: MountOptions): void {
  unmountBadge();
  root = document.createElement('div');
  root.id = ROOT_ID;
  // Defensive inline styles: position the host at top-right of the viewport
  // with !important so host-page rules targeting wildcard selectors can't
  // dislodge it. Avoid `all: initial` here — it would reset `display` to
  // `inline`, which breaks the popover layout.
  root.style.setProperty('position', 'fixed', 'important');
  root.style.setProperty('top', '16px', 'important');
  root.style.setProperty('right', '16px', 'important');
  root.style.setProperty('display', 'block', 'important');
  root.style.setProperty('z-index', '2147483647', 'important');
  root.style.setProperty('width', 'auto', 'important');
  root.style.setProperty('height', 'auto', 'important');
  root.style.setProperty('margin', '0', 'important');
  root.style.setProperty('padding', '0', 'important');
  root.style.setProperty('pointer-events', 'auto', 'important');
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.innerHTML = `
    <div class="panel-header">
      ${ICON_SVG}
      <span class="panel-title">Tesla VIN detected</span>
      <button class="close" type="button" aria-label="Hide">×</button>
    </div>
    <div class="panel-body"></div>
    <div class="panel-footer">Powered by Tesla Inventory Helper</div>
  `;

  bodyEl = panelEl.querySelector<HTMLElement>('.panel-body');
  renderBody(info);

  panelEl.querySelector<HTMLButtonElement>('.close')?.addEventListener('click', () => {
    options.onDismiss();
  });

  shadow.appendChild(panelEl);
  document.documentElement.appendChild(root);
}

export function updateBadge(info: TeslaVinInfo): void {
  if (!bodyEl) return;
  renderBody(info);
}

export function unmountBadge(): void {
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  panelEl = null;
  bodyEl = null;
}

function renderBody(info: TeslaVinInfo): void {
  if (!bodyEl) return;
  bodyEl.innerHTML = `
    <div class="vin"><span class="label">VIN</span><span class="value mono">${escape(info.vin)}</span></div>
    <div class="row"><span class="label">Model</span><span class="value">${escape(formatModel(info.model))}</span></div>
    <div class="row"><span class="label">Year</span><span class="value">${escape(formatYear(info.modelYear))}</span></div>
    <div class="row"><span class="label">Plant</span><span class="value">${escape(formatPlant(info.plant))}</span></div>
    <div class="row"><span class="label">Build</span><span class="value">${escape(formatSerial(info.serial))}</span></div>
    <div class="row"><span class="label">Autopilot HW</span><span class="value">${escape(formatHw(info))}</span></div>
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

function formatHw(info: TeslaVinInfo): string {
  const { likelyHw, modelYear } = info;
  if (likelyHw === 'Unknown') return 'Unknown';
  // Hedge the label only for 2023, the transition year where the plant +
  // serial heuristic is doing the work. 2022-and-earlier is HW3 with no
  // exceptions; 2024+ is HW4 across all plants.
  const certain = modelYear !== null && (modelYear >= 2024 || modelYear <= 2022);
  return certain ? likelyHw : `Likely ${likelyHw}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
