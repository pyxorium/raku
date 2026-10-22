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
  // stage 6c: Recent tiles
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.5 2'],
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

// Raku's own icon (public/icon.svg) with a turquoise pip in the corner, for the browser tab while a tab has a
// quiet mark (step 5b-2). A data: address (the page policy allows data: pictures).
const RAKU_ICON = '<rect width="64" height="64" rx="14" fill="#26211d"/><path d="M14 44c0-13 8-24 18-24s18 11 18 24c0 4-8 6-18 6s-18-2-18-6z" fill="#2fa596"/><path d="M22 30l6 6-3 7M38 27l-4 8 7 5" stroke="#1f1a16" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="21" rx="9" ry="3" fill="#7fd6c8"/>';
export const ICON_WITH_PIP = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${RAKU_ICON}<circle cx="51" cy="13" r="11" fill="#7fffe9" stroke="#26211d" stroke-width="4"/></svg>`)}`;
