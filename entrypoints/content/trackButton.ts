import {
  formatHistoryTime,
  formatHistoryValue,
  formatPriceStatus,
  priceHistoryRows,
} from '../../src/format';
import type { SavedCar, SavedCars } from '../../src/savedCars';
import styles from './trackButton.css?raw';

// The on-page Track button: an overlay pill on each used inventory card and on
// the used order page's summary. Untracked it reads "Track"; tracked it shows
// the price change since the car was saved ("−$500", "Sold", or "✓ Tracking"
// when nothing moved), and hovering, focusing or clicking it opens a popover
// with the recent price history and a "Stop tracking" action.
//
// Storage-free on purpose, like searchPanel.ts: the content script owns the
// reads/writes and pushes the watchlist in through updateTrackButtons, so every
// button renders synchronously from one cached array.

export type TrackButtonHandlers = {
  onTrack: () => Promise<void>;
  onUntrack: (vin: string) => Promise<void>;
};

const ROOT_CLASS = 'tih-track-root';
// Grace period after the pointer leaves, so a slightly off path between the
// button and the popover doesn't snap it shut.
const LEAVE_DELAY_MS = 150;
// `.tih-glow` gives a matched card `position: relative; z-index: 1`, which makes
// it a stacking context: nothing inside can paint above a later glowing sibling,
// whatever its own z-index. So while a popover is open, lift the whole card.
const OPEN_HOST_Z_INDEX = '30';

type Instance = {
  host: HTMLElement;
  vin: string;
  handlers: TrackButtonHandlers;
  root: HTMLElement;
  shadow: ShadowRoot;
  btn: HTMLButtonElement;
  popover: HTMLElement;
  priceEl: HTMLElement;
  sinceEl: HTMLElement;
  listEl: HTMLElement;
  emptyEl: HTMLElement;
  hovered: boolean;
  focused: boolean;
  leaveTimer: ReturnType<typeof setTimeout> | undefined;
  // Last car the popover was built from; a reference check skips rebuilds.
  renderedCar: SavedCar | null;
  open: boolean;
  // The host's own inline z-index, restored when the popover closes.
  savedZIndex: { value: string; priority: string } | null;
};

let carsByVin = new Map<string, SavedCar>();
const instances = new Map<HTMLElement, Instance>();
// Module-level rather than per instance, so a popover pinned when Tesla
// re-renders the card comes back pinned on the re-mounted button.
let pinnedVin: string | null = null;
let listenerAbort: AbortController | null = null;

export function mountTrackButton(
  host: HTMLElement,
  vin: string,
  handlers: TrackButtonHandlers,
): void {
  pruneDisconnected();
  const existing = instances.get(host);
  if (existing) {
    if (existing.vin === vin && existing.root.isConnected) return;
    destroy(existing);
  }
  // A `display: contents` host generates no box, so it can never be the
  // containing block for the overlay — it would escape to the page corner.
  // Skip rather than render something misplaced.
  const computed = getComputedStyle(host);
  if (computed.display === 'contents') return;
  if (computed.position === 'static') host.style.position = 'relative';

  const root = document.createElement('div');
  root.className = ROOT_CLASS;
  // Defensive inline styles with !important so Tesla's rules can't dislodge the
  // host. Avoid resetting everything on the host — that sets `display` back to
  // inline and collapses the popover. The host matches `:focus` whenever
  // anything inside is focused, and Tesla's global focus outline would draw a
  // grey box around it after every click; the inner `:focus-visible` rings
  // cover keyboard focus instead.
  const hostStyles: Record<string, string> = {
    outline: 'none',
    position: 'absolute',
    top: '-12px',
    left: '12px',
    'z-index': '4',
    display: 'block',
    width: 'auto',
    height: 'auto',
    margin: '0',
    padding: '0',
    'pointer-events': 'auto',
  };
  for (const [prop, value] of Object.entries(hostStyles)) {
    root.style.setProperty(prop, value, 'important');
  }
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = styles;

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="card" role="group">
      <div class="pop-header">
        <span class="pop-price"></span>
        <span class="pop-since"></span>
      </div>
      <ul class="pop-list"></ul>
      <p class="pop-empty" hidden>No price changes yet</p>
      <div class="pop-footer"><button class="stop" type="button">Stop tracking</button></div>
    </div>
  `;
  shadow.append(style, btn, popover);

  const inst: Instance = {
    host,
    vin,
    handlers,
    root,
    shadow,
    btn,
    popover,
    priceEl: popover.querySelector<HTMLElement>('.pop-price')!,
    sinceEl: popover.querySelector<HTMLElement>('.pop-since')!,
    listEl: popover.querySelector<HTMLElement>('.pop-list')!,
    emptyEl: popover.querySelector<HTMLElement>('.pop-empty')!,
    hovered: false,
    focused: false,
    leaveTimer: undefined,
    renderedCar: null,
    open: false,
    savedZIndex: null,
  };

  wire(inst, popover.querySelector<HTMLButtonElement>('.stop')!);
  instances.set(host, inst);
  host.appendChild(root);
  installDocumentListeners();
  render(inst);
}

export function updateTrackButtons(cars: SavedCars): void {
  carsByVin = new Map(cars.map((car) => [car.vin, car]));
  if (pinnedVin !== null && !carsByVin.has(pinnedVin)) pinnedVin = null;
  pruneDisconnected();
  renderAll();
}

// Route change away from used pages: drop every button and all open state.
// The document listeners stay; they're cheap and re-used on the next mount.
export function clearTrackButtons(): void {
  for (const inst of [...instances.values()]) destroy(inst);
  pinnedVin = null;
}

// Content-script invalidation: also detach the document listeners.
export function disposeTrackButtons(): void {
  clearTrackButtons();
  listenerAbort?.abort();
  listenerAbort = null;
}

function wire(inst: Instance, stopBtn: HTMLButtonElement): void {
  const { root, shadow, btn, popover } = inst;

  // Tesla's card wrapper is button-like, so a click that reaches it navigates
  // to the car. Stop clicks from both the button and the popover at our host.
  // Only `click`: `mousedown` must keep bubbling so the document-level
  // outside-click closers (ours and the saved-searches panel's) still work.
  root.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  // Keep presses inside the popover away from Tesla's handlers (text
  // selection, drag), as the saved-searches panel does.
  popover.addEventListener('mousedown', (event) => event.stopPropagation());

  btn.addEventListener('click', () => {
    if (!carsByVin.has(inst.vin)) {
      void inst.handlers.onTrack();
      return;
    }
    if (pinnedVin === inst.vin) {
      pinnedVin = null;
      inst.focused = false;
    } else {
      pinnedVin = inst.vin;
    }
    renderAll();
  });

  stopBtn.addEventListener('click', () => {
    void inst.handlers.onUntrack(inst.vin);
    // Close now rather than waiting for the storage watch to re-render.
    if (pinnedVin === inst.vin) pinnedVin = null;
    inst.hovered = false;
    inst.focused = false;
    clearLeaveTimer(inst);
    render(inst);
  });

  root.addEventListener('mouseenter', () => {
    clearLeaveTimer(inst);
    inst.hovered = true;
    // One popover at a time: hovering another button closes the rest,
    // including a pinned one.
    for (const other of instances.values()) {
      if (other === inst) continue;
      clearLeaveTimer(other);
      other.hovered = false;
      other.focused = false;
    }
    if (pinnedVin !== null && pinnedVin !== inst.vin) pinnedVin = null;
    renderAll();
  });

  root.addEventListener('mouseleave', () => {
    clearLeaveTimer(inst);
    inst.leaveTimer = setTimeout(() => {
      inst.leaveTimer = undefined;
      inst.hovered = false;
      render(inst);
    }, LEAVE_DELAY_MS);
  });

  // Listen on the shadow root so targets aren't retargeted to the host. Only
  // keyboard focus opens the popover: a mouse click also focuses the button,
  // and that must not leave the popover stuck open after the pointer leaves.
  shadow.addEventListener('focusin', (event) => {
    const target = event.target as Element | null;
    if (!target?.matches(':focus-visible')) return;
    inst.focused = true;
    render(inst);
  });
  shadow.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && shadow.contains(next)) return;
    if (!inst.focused) return;
    inst.focused = false;
    render(inst);
  });
}

function installDocumentListeners(): void {
  if (listenerAbort) return;
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      if (pinnedVin === null && ![...instances.values()].some((i) => i.open)) return;
      pinnedVin = null;
      for (const inst of instances.values()) {
        clearLeaveTimer(inst);
        inst.hovered = false;
        inst.focused = false;
      }
      renderAll();
    },
    { signal },
  );

  // Unpin on a press anywhere outside the pinned button. Events from inside a
  // shadow root are retargeted to its host, so composedPath is the reliable
  // "was this inside us" test.
  document.addEventListener(
    'mousedown',
    (event) => {
      if (pinnedVin === null) return;
      const path = event.composedPath();
      for (const inst of instances.values()) {
        if (inst.vin === pinnedVin && path.includes(inst.root)) return;
      }
      pinnedVin = null;
      renderAll();
    },
    { signal },
  );
}

function renderAll(): void {
  for (const inst of instances.values()) render(inst);
}

function render(inst: Instance): void {
  const car = carsByVin.get(inst.vin) ?? null;
  const { btn } = inst;

  if (!car) {
    btn.className = 'btn';
    btn.textContent = 'Track';
    btn.removeAttribute('aria-label');
    btn.removeAttribute('aria-haspopup');
    btn.removeAttribute('aria-expanded');
  } else {
    const status = formatPriceStatus(car);
    let label: string;
    let ariaLabel: string;
    switch (status.cls) {
      case 'gone':
        label = 'Sold';
        ariaLabel = 'Tracking: sold';
        break;
      case 'down':
      case 'up':
        label = status.text;
        ariaLabel = `Tracking: ${status.text} since tracked`;
        break;
      default:
        label = '✓ Tracking';
        ariaLabel = 'Tracking';
    }
    btn.className = `btn saved ${status.cls}`;
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.setAttribute('aria-haspopup', 'true');
  }

  const open = car !== null && (inst.hovered || inst.focused || pinnedVin === inst.vin);
  if (car) btn.setAttribute('aria-expanded', String(open));
  if (open && inst.renderedCar !== car) buildPopover(inst, car!);
  inst.popover.hidden = !open;

  if (open !== inst.open) {
    inst.open = open;
    if (open) liftHost(inst);
    else restoreHost(inst);
  }
}

function buildPopover(inst: Instance, car: SavedCar): void {
  inst.renderedCar = car;
  inst.priceEl.textContent = formatHistoryValue(car.latest);
  inst.sinceEl.textContent = `Tracked since ${formatHistoryTime(car.savedAt)}`;

  const rows = priceHistoryRows(car);
  inst.listEl.replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'pop-row';
    const time = document.createElement('span');
    time.className = 'pop-time';
    time.textContent = formatHistoryTime(row.at);
    const value = document.createElement('span');
    value.className = 'pop-value';
    value.textContent = row.value;
    const delta = document.createElement('span');
    delta.className = `pop-delta ${row.cls}`;
    delta.textContent = row.delta;
    li.append(time, value, delta);
    inst.listEl.append(li);
  }
  inst.emptyEl.hidden = rows.length > 1;
}

function liftHost(inst: Instance): void {
  const { style } = inst.host;
  inst.savedZIndex = {
    value: style.getPropertyValue('z-index'),
    priority: style.getPropertyPriority('z-index'),
  };
  style.setProperty('z-index', OPEN_HOST_Z_INDEX, 'important');
}

function restoreHost(inst: Instance): void {
  const saved = inst.savedZIndex;
  inst.savedZIndex = null;
  if (!saved) return;
  const { style } = inst.host;
  if (saved.value) style.setProperty('z-index', saved.value, saved.priority);
  else style.removeProperty('z-index');
}

function clearLeaveTimer(inst: Instance): void {
  if (inst.leaveTimer === undefined) return;
  clearTimeout(inst.leaveTimer);
  inst.leaveTimer = undefined;
}

function destroy(inst: Instance): void {
  clearLeaveTimer(inst);
  if (inst.open) restoreHost(inst);
  inst.root.remove();
  instances.delete(inst.host);
}

// Tesla re-renders cards by replacing them, which detaches our roots without
// telling us. Forget those so the map doesn't grow and stale hosts aren't touched.
function pruneDisconnected(): void {
  for (const inst of [...instances.values()]) {
    if (!inst.root.isConnected) {
      clearLeaveTimer(inst);
      instances.delete(inst.host);
    }
  }
}
