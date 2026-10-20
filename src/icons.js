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
};
export const ICON_NAMES = Object.keys(PATHS);

/** An icon element: icon('back'). Hidden from screen readers (the button carries the words). */
export function icon(name, size = 22) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon icon-${name}`);
  for (const d of PATHS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
