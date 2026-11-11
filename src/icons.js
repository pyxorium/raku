// Raku's own icons, drawn as small SVG pictures (owner, Oct 19): the same size and line on every
// phone and computer, instead of text characters (← → ↻ + ×) that each device's fonts draw differently.
// 24 × 24, one stroke in the current text colour, rounded ends. No inline styles (the page policy).

const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
  forward: ['M5 12h14', 'M13 6l6 6-6 6'],
  reload: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4.5H15'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  // stage 2
  shelf: ['M4 3v18', 'M20 3v18', 'M4 12h16', 'M4 20.5h16', 'M7.5 12V6.5', 'M10.5 12V7.5', 'M13.5 12l2-5', 'M9 20.5v-1.5a3 3 0 0 1 6 0v1.5'],
  star: ['M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z'],
  newtab: ['M14 4h6v6', 'M20 4l-8.5 8.5', 'M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'],
  // stage 4: the account button when nobody is signed in (a phone shows only this; a computer adds "Sign in")
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  // stage 6: Discover (a compass), search, Tile news, Following
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.3 15.3L20 20'],
  news: ['M5 4.5h10.5v15H6.5A1.5 1.5 0 0 1 5 18z', 'M15.5 8.5H19v9.5a1.5 1.5 0 0 1-1.5 1.5H15.5', 'M8 8.5h4.5', 'M8 12h4.5', 'M8 15.5h4.5'],
  people: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.8 20a6.2 6.2 0 0 1 12.4 0', 'M15.5 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.3a6.2 6.2 0 0 1 3.2 5.7'],
  // tile posts (Nov 2026): a speech bubble holding a tile
  posts: ['M5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5v-9A1.5 1.5 0 0 1 5.5 4z', 'M8.5 7.5h7v5h-7z'],
  // Play here (a tile post's tile in its post): a play triangle, filled by the button's CSS
  play: ['M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z'],
  // round C: expand (a tile post's tile to Raku's window) and the browser's own full screen
  expand: ['M14 4h6v6', 'M20 4l-6.5 6.5', 'M10 20H4v-6', 'M4 20l6.5-6.5'],
  fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  // stage 6c: Recent tiles, Make a tile
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.5 2'],
  // going public: the About page's link in the account menu
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.6v.1'],
  // stage 9: Install Raku in the account menu
  install: ['M12 4v10.5', 'M7.5 10l4.5 4.5 4.5-4.5', 'M5 19.5h14'],
  brush: ['M10.2 12.4l8.3-8.3a1.8 1.8 0 0 1 2.5 2.5l-8.3 8.3', 'M8.6 13.4a3.1 3.1 0 0 1 3.1 3.1c0 2.6-2.6 4.1-6.7 4.1 1-1 1.3-2.2 1.3-3.5a3.1 3.1 0 0 1 2.3-3.7z'],
  // a tile post's Share button (claude/raku-post-links-plan.md, SL2): a curved arrow, as Bluesky's; Copy link: two links of a chain
  share: ['M14 5l6 6-6 6', 'M20 11h-9a6 6 0 0 0-6 6v2'],
  link: ['M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'],
  // a tile post's heart (claude/raku-hearts-plan.md, HT4): an outline; filled by CSS when it's yours
  heart: ['M12 20.2s-7.6-4.6-9.4-9.3C1.4 7.6 3.6 4.4 7 4.4c2.1 0 3.7 1.2 5 3 1.3-1.8 2.9-3 5-3 3.4 0 5.6 3.2 4.4 6.5-1.8 4.7-9.4 9.3-9.4 9.3z'],
};
const FILLED = new Set(['star-filled']);
export const ICON_NAMES = Object.keys(PATHS);

/** An icon element: icon('back'). Hidden from screen readers (the button carries the words). */
export function icon(name, size = 22) {
  const filled = FILLED.has(name);
  if (filled) name = name.replace(/-filled$/, '');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name}${filled ? ' icon-filled' : ''}`);
  for (const d of PATHS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// Raku's own icon (public/icon.svg: since stage 9 the pot alone on transparency, enlarged, with a thin charcoal
// outline; the sheet's option B, claude/raku-icon-sheet.html) with a turquoise pip in the corner, for the browser
// tab while a tab has a quiet mark (step 5b-2). A data: address (the page policy allows data: pictures).
// test/app.test.mjs checks this is the same drawing as public/icon.svg.
// The pot's five shapes, each with the named colour that paints it beside the Raku label (the light-mode
// groundwork, claude/raku-light-mode-plan.md: `part` is the --pot-… name in src/style.css). The tab and app
// icons are drawn from the same shapes with the colours as written here, the same in any look.
const POT_BODY = 'M14 44c0-13 8-24 18-24s18 11 18 24c0 4-8 6-18 6s-18-2-18-6z';
const POT_PARTS = [
  { tag: 'path', part: 'edge', attrs: { d: POT_BODY, fill: 'none', stroke: '#26211d', 'stroke-width': '2.2', 'stroke-linejoin': 'round' } },
  { tag: 'ellipse', part: 'edge', attrs: { cx: '32', cy: '21', rx: '9', ry: '3', fill: 'none', stroke: '#26211d', 'stroke-width': '2.2' } },
  { tag: 'path', part: 'body', attrs: { d: POT_BODY, fill: '#2fa596' } },
  { tag: 'path', part: 'crackle', attrs: { d: 'M22 30l6 6-3 7M38 27l-4 8 7 5', stroke: '#1f1a16', 'stroke-width': '2', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  { tag: 'ellipse', part: 'rim', attrs: { cx: '32', cy: '21', rx: '9', ry: '3', fill: '#7fd6c8' } },
];
const POT_TRANSFORM = 'translate(32 32) scale(1.6) translate(-32 -34)';
/** Which shape takes which named colour, and the colour written on it (test/app.test.mjs matches src/style.css). */
export const POT_PAINT = POT_PARTS.map(({ part, attrs }) => ({ part, paint: attrs.fill !== 'none' ? 'fill' : 'stroke', colour: attrs.fill !== 'none' ? attrs.fill : attrs.stroke }));
const drawPot = (colours = {}) => `<g transform="${POT_TRANSFORM}">${POT_PARTS.map(({ tag, part, attrs }) => {
  const paint = attrs.fill !== 'none' ? 'fill' : 'stroke';
  const a = { ...attrs, [paint]: colours[part] || attrs[paint] };
  return `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
}).join('')}</g>`;
export const RAKU_ICON = drawPot();
const HEX = /^#[0-9a-f]{3,8}$/i;
/** The pot beside the Raku label as a picture (data: address), its colours given by part ({ edge, body, … }). */
export function potPicture(colours = {}) {
  const safe = Object.fromEntries(Object.entries(colours).filter(([, v]) => HEX.test(v)));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${drawPot(safe)}</svg>`)}`;
}
/** The named --pot-… colours as the page has them now (none yet, e.g. before the style sheet: the drawing's own). */
export function potColours(root = globalThis.document?.documentElement) {
  if (!root || typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(root);
  return Object.fromEntries(POT_PAINT.map(({ part }) => [part, cs.getPropertyValue(`--pot-${part}`).trim()]).filter(([, v]) => v));
}
/** The pot beside the Raku label (stage 9, S8): a picture drawn in the named --pot-… colours. A picture rather than
 *  drawing in the page, so it looks exactly as before (an inline drawing shifted the anti-aliasing of nearby text
 *  in the groundwork's pixel check). A later look redraws it with refreshBrandPots(). */
export function brandPot() {
  const img = document.createElement('img');
  img.className = 'brand-pot';
  img.src = potPicture(potColours());
  img.alt = '';
  img.width = 18; img.height = 18;   // as before; the style sheet sets 18 or 16 px
  img.draggable = false;
  return img;
}
/** Redraws every pot beside the Raku label in the --pot-… colours where it sits (for a change of look, and once in
 *  place: Smoke and clay's top bar keeps the dark colours while the page is light). */
export function refreshBrandPots(doc = document) {
  for (const img of doc.querySelectorAll('img.brand-pot')) {
    const src = potPicture(potColours(img));
    if (img.src !== src) img.src = src;
  }
}
export const ICON_WITH_PIP = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${RAKU_ICON}<circle cx="51" cy="13" r="11" fill="#7fffe9" stroke="#26211d" stroke-width="4"/></svg>`)}`;
