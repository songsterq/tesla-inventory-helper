import {
  isSameSearchUrl,
  MAX_SAVED_SEARCHES,
  type SavedSearch,
  type SavedSearches,
} from '../../src/savedSearches';
import styles from './searchPanel.css?raw';

// The on-page "Saved searches" control: a pill that lives inline in Tesla's
// sticky inventory header (left of the sort dropdown) and drops a panel below
// it. Inline rather than fixed on purpose — Tesla's site header isn't sticky
// and its top-right corner is the Menu button, so a fixed element would cover
// it, and then cover cards once the page scrolls. Rendered in a closed shadow
// root with the same defensive host styling as the third-party badge.

const ROOT_ID = 'tih-search-root';
// Verified on both used and new listing pages: `.view-options` holds the sort
// form on used pages and is present-but-empty on new pages.
const ANCHOR_SEL = 'section.inventory-header-wrapper div.view-options';
const ANCHOR_FALLBACK_SEL = 'section.inventory-header-wrapper';

export type SaveOutcome =
  | { ok: true; name: string }
  | {
      ok: false;
      reason: 'duplicate' | 'full' | 'quota' | 'capture-failed';
      existingName?: string;
    };

export type SearchPanelHandlers = {
  onSave: () => Promise<SaveOutcome>;
  onOpen: (search: SavedSearch) => void | Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type StatusKind = 'info' | 'ok' | 'error';

const ICON_SVG =
  '<svg class="pill-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  '<path d="M3.5 2.5h9a1 1 0 0 1 1 1v10.2l-5.5-3.1-5.5 3.1V3.5a1 1 0 0 1 1-1z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let handlers: SearchPanelHandlers | null = null;
let root: HTMLElement | null = null;
let pillEl: HTMLButtonElement | null = null;
let pillCountEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let saveBtn: HTMLButtonElement | null = null;
let statusEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;

// State that must survive Tesla re-rendering the header row (which discards
// our host): whether the panel is open, what's being shown, and any status.
let open = false;
let editingId: string | null = null;
let currentSearches: SavedSearches = [];
let currentHref = '';
let renderedSearches: SavedSearches | null = null;
let renderedHref = '';
let status: { text: string; kind: StatusKind } | null = null;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
// True while the panel is open only because a status message opened it (e.g.
// a restore on page load), so it can close itself again once that clears.
let openedByStatus = false;
let documentListenersInstalled = false;

export function mountSearchPanel(h: SearchPanelHandlers): void {
  handlers = h;
  if (root?.isConnected) return;
  const anchor = document.querySelector<HTMLElement>(ANCHOR_SEL);
  const fallback = anchor ? null : document.querySelector<HTMLElement>(ANCHOR_FALLBACK_SEL);
  const host = anchor ?? fallback;
  if (!host) return;
  unmountSearchPanel(); // drop a detached root from a previous render

  root = document.createElement('div');
  root.id = ROOT_ID;
  // Defensive inline styles with !important so Tesla's wildcard rules can't
  // dislodge the host. Avoid `all: initial` — it resets `display` to inline,
  // which collapses the panel.
  root.style.setProperty('position', 'relative', 'important');
  root.style.setProperty('display', 'inline-block', 'important');
  root.style.setProperty('flex', '0 0 auto', 'important');
  root.style.setProperty('margin', anchor ? '0 12px 0 0' : '0 0 0 auto', 'important');
  root.style.setProperty('padding', '0', 'important');
  root.style.setProperty('z-index', '50', 'important');
  root.style.setProperty('pointer-events', 'auto', 'important');
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  pillEl = document.createElement('button');
  pillEl.className = 'pill';
  pillEl.type = 'button';
  pillEl.setAttribute('aria-haspopup', 'true');
  pillEl.innerHTML = `${ICON_SVG}<span class="pill-label">Saved searches</span><span class="pill-count" hidden></span>`;
  pillCountEl = pillEl.querySelector<HTMLElement>('.pill-count');
  pillEl.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openedByStatus = false;
    setOpen(!open);
  });

  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.hidden = true;
  panelEl.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">Saved searches</span>
      <button class="save" type="button">Save current view</button>
      <button class="close" type="button" aria-label="Close">×</button>
    </div>
    <p class="status" hidden></p>
    <ul class="list"></ul>
    <div class="panel-footer">Powered by Tesla Inventory Helper</div>
  `;
  saveBtn = panelEl.querySelector<HTMLButtonElement>('.save');
  statusEl = panelEl.querySelector<HTMLElement>('.status');
  listEl = panelEl.querySelector<HTMLElement>('.list');
  panelEl.querySelector<HTMLButtonElement>('.close')?.addEventListener('click', () => setOpen(false));
  saveBtn?.addEventListener('click', () => void doSave());
  // Keep clicks inside the panel from reaching Tesla's handlers (or our own
  // outside-click closer, which listens on the document).
  panelEl.addEventListener('mousedown', (event) => event.stopPropagation());

  shadow.append(pillEl, panelEl);
  if (anchor) anchor.prepend(root);
  else host.appendChild(root);

  installDocumentListeners();
  renderedSearches = null; // force a render into the fresh DOM
  renderSearchList(currentSearches, currentHref);
  applyOpenState();
  renderStatus();
}

export function unmountSearchPanel(): void {
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  pillEl = null;
  pillCountEl = null;
  panelEl = null;
  saveBtn = null;
  statusEl = null;
  listEl = null;
  renderedSearches = null;
}

// Re-render the list. Cheap to call on every page mutation: it returns early
// unless the array reference or the page URL changed, and it never clobbers a
// rename that is in progress.
export function renderSearchList(searches: SavedSearches, href: string): void {
  currentSearches = searches;
  currentHref = href;
  if (!listEl) return;
  if (editingId !== null) return;
  if (renderedSearches === searches && renderedHref === href) return;
  renderedSearches = searches;
  renderedHref = href;

  if (pillCountEl) {
    pillCountEl.textContent = String(searches.length);
    pillCountEl.hidden = searches.length === 0;
  }

  listEl.replaceChildren();
  if (searches.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No saved searches yet. Set your filters, then click Save current view.';
    listEl.appendChild(empty);
    return;
  }
  for (const search of searches) listEl.appendChild(renderRow(search, href));
}

export function setPanelStatus(text: string, kind: StatusKind = 'info', autoClearMs?: number): void {
  status = { text, kind };
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  statusTimer = undefined;
  if (autoClearMs !== undefined) {
    statusTimer = setTimeout(() => {
      status = null;
      statusTimer = undefined;
      renderStatus();
      if (openedByStatus) {
        openedByStatus = false;
        setOpen(false);
      }
    }, autoClearMs);
  }
  // A restore in progress is worth seeing without a click; the panel closes
  // itself again when the final status clears.
  if (kind !== 'ok' && !open) {
    setOpen(true);
    openedByStatus = true;
  }
  renderStatus();
}

function renderStatus(): void {
  if (!statusEl) return;
  if (!status) {
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.className = 'status';
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = status.text;
  statusEl.className = `status ${status.kind}`;
}

function setOpen(next: boolean): void {
  open = next;
  applyOpenState();
}

function applyOpenState(): void {
  if (panelEl) panelEl.hidden = !open;
  if (pillEl) pillEl.setAttribute('aria-expanded', String(open));
  if (!open && editingId !== null) {
    editingId = null;
    renderedSearches = null;
    renderSearchList(currentSearches, currentHref);
  }
}

function installDocumentListeners(): void {
  if (documentListenersInstalled) return;
  documentListenersInstalled = true;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  });
  // Close on a click anywhere outside our host. Events from inside the shadow
  // root are retargeted to the host, so a composedPath check is the reliable
  // "was this inside us" test.
  document.addEventListener('mousedown', (event) => {
    if (!open || !root) return;
    if (event.composedPath().includes(root)) return;
    setOpen(false);
  });
}

async function doSave(): Promise<void> {
  if (!handlers || !saveBtn) return;
  saveBtn.disabled = true;
  try {
    const result = await handlers.onSave();
    if (result.ok) {
      setPanelStatus(`Saved "${result.name}".`, 'ok', 4000);
      return;
    }
    switch (result.reason) {
      case 'duplicate':
        setPanelStatus(
          result.existingName ? `Already saved as "${result.existingName}".` : 'Already saved.',
          'info',
          5000,
        );
        break;
      case 'full':
        setPanelStatus(`List is full (${MAX_SAVED_SEARCHES} max). Delete one to save another.`, 'error');
        break;
      case 'quota':
        setPanelStatus('Not enough sync storage left for this search. Delete one and retry.', 'error');
        break;
      default:
        setPanelStatus("Couldn't read the filters on this page.", 'error', 6000);
    }
  } catch {
    setPanelStatus("Couldn't save this search.", 'error', 6000);
  } finally {
    saveBtn.disabled = false;
  }
}

function renderRow(search: SavedSearch, href: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = search.id;
  const isCurrent = isSameSearchUrl(href, search.url);
  if (isCurrent) li.classList.add('current');

  const main = document.createElement('div');
  main.className = 'row-main';

  const name = document.createElement('button');
  name.className = 'name';
  name.type = 'button';
  name.textContent = search.name;
  name.title = isCurrent ? 'Re-apply this search here' : 'Open this search';
  name.addEventListener('click', () => {
    if (!handlers) return;
    void handlers.onOpen(search);
  });

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = search.description;
  desc.title = search.description;

  main.append(name, desc);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const rename = document.createElement('button');
  rename.className = 'icon-btn';
  rename.type = 'button';
  rename.title = 'Rename';
  rename.setAttribute('aria-label', `Rename ${search.name}`);
  rename.textContent = '✎';
  rename.addEventListener('click', () => startRename(li, search));

  const remove = document.createElement('button');
  remove.className = 'icon-btn';
  remove.type = 'button';
  remove.title = 'Delete';
  remove.setAttribute('aria-label', `Delete ${search.name}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    if (!handlers) return;
    void handlers.onDelete(search.id);
  });

  actions.append(rename, remove);
  li.append(main, actions);
  return li;
}

function startRename(li: HTMLLIElement, search: SavedSearch): void {
  const nameBtn = li.querySelector<HTMLButtonElement>('.name');
  if (!nameBtn || editingId !== null) return;
  editingId = search.id;

  const input = document.createElement('input');
  input.className = 'rename';
  input.type = 'text';
  input.maxLength = 60;
  input.value = search.name;
  input.setAttribute('aria-label', 'Search name');

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    editingId = null;
    const next = input.value.trim();
    if (commit && next && next !== search.name && handlers) {
      void handlers.onRename(search.id, next);
    }
    // Re-render from the current list so the row goes back to a button even if
    // the rename was a no-op (the storage watch won't fire for those).
    renderedSearches = null;
    renderSearchList(currentSearches, currentHref);
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));

  nameBtn.replaceWith(input);
  input.focus();
  input.select();
}
