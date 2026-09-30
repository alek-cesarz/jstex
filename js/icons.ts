/** Inline SVG icons (currentColor, 16×16 viewBox) — no icon font needed in a blob-loaded widget. */
const svg = (body: string) =>
  `<svg class="jstex-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke =
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICON = {
  search: svg(
    `<circle cx="7" cy="7" r="4.5" ${stroke}/><path d="M10.4 10.4 14 14" ${stroke}/>`
  ),
  polygon: svg(`<path d="M3 5.5 8 2.5l5 3.5-1.8 6.5H4.6z" ${stroke}/>`),
  box: svg(
    `<rect x="2.5" y="3.5" width="11" height="9" rx="1" ${stroke} stroke-dasharray="2.4 1.6"/>`
  ),
  upload: svg(
    `<path d="M8 10.5V2.8M5 5.6 8 2.6l3 3M3 10.5v2.2h10v-2.2" ${stroke}/>`
  ),
  target: svg(
    `<circle cx="8" cy="8" r="4.5" ${stroke}/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" ${stroke}/>`
  ),
  close: svg(`<path d="M4.5 4.5l7 7m0-7-7 7" ${stroke}/>`),
  chevronRight: svg(`<path d="M6 3.5 10.5 8 6 12.5" ${stroke}/>`),
  chevronLeft: svg(`<path d="M10 3.5 5.5 8l4.5 4.5" ${stroke}/>`),
  info: svg(
    `<circle cx="8" cy="8" r="6.2" ${stroke}/><path d="M8 7.2v4M8 4.9v.1" ${stroke}/>`
  ),
  warn: svg(
    `<path d="M8 2.2 14.3 13.5H1.7z" ${stroke}/><path d="M8 6.5v3.2M8 11.6v.1" ${stroke}/>`
  ),
  layers: svg(
    `<path d="m8 2.5 6 3-6 3-6-3zM2 8.5l6 3 6-3M2 11.2l6 3 6-3" ${stroke}/>`
  ),
  calendar: svg(
    `<rect x="2.5" y="3.5" width="11" height="10" rx="1.2" ${stroke}/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" ${stroke}/>`
  ),
  filter: svg(`<path d="M2.5 3.5h11L9.3 8.6v4.2l-2.6-1.3V8.6z" ${stroke}/>`),
  plus: svg(`<path d="M8 3v10M3 8h10" ${stroke}/>`),
  copy: svg(
    `<rect x="5.5" y="5.5" width="8" height="8" rx="1.2" ${stroke}/><path d="M10.5 3.5v-.3c0-.7-.5-1.2-1.2-1.2H3.7c-.7 0-1.2.5-1.2 1.2v5.6c0 .7.5 1.2 1.2 1.2h.3" ${stroke}/>`
  ),
  link: svg(
    `<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7" ${stroke}/>`
  ),
  code: svg(
    `<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" ${stroke}/>`
  ),
  clock: svg(
    `<circle cx="8" cy="8" r="6" ${stroke}/><path d="M8 4.8V8l2.2 1.4" ${stroke}/>`
  ),
  cloud: svg(
    `<path d="M4.6 12.5h7a2.9 2.9 0 0 0 .3-5.8 3.9 3.9 0 0 0-7.5.9 2.5 2.5 0 0 0 .2 4.9z" ${stroke}/>`
  )
};
