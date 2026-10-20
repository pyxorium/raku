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
