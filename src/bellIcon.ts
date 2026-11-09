// The saved-search alert bell, shared by the popup and the on-page panel so the
// two toggles stay identical. Outline by default; each surface's CSS fills it
// (`fill: currentColor`) while `aria-pressed="true"`.
export const BELL_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M10 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
