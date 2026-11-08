// The expanded view (round C, claude/raku-expand-plan.md, EX1 to EX8): a tile post's playing tile opened in place to
// Raku's window, over Raku's own bars, on a dark backdrop. The slot holding the tile is pinned (position: fixed) over the
// stage, and a clip opens from its post's box (closed back on closing); it is never moved in the page, which would
// reload the tile. A spacer keeps its place in the post meanwhile. The bar: the place's name and author ("Now in" after a trip),
// "Back to …" after a trip, New tab, Full screen (the browser's own, where it allows it), ×.
// discover.js (playCard) opens and closes it; the rules (how it moves, play-here.js expandMotion) are tested in Node.

import { h } from './cards.js';
import { icon } from './icons.js';
import { clipInset } from './play-here.js';
import { PLAY_HERE } from './config.js';

const rect = (el) => el.getBoundingClientRect();
const box = (r) => ({ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
const SIDES = ['top', 'left', 'width', 'height'];

/**
 * createExpanded({ host, card, slot, motion, onClose, onNewTab, onBack }) → { open(), close({ instant }), setPlace(info),
 * note(text), isOpen, el }. host: Discover's pane (raised over Raku's bars while open); card: the post's tile card;
 * motion: play-here.js expandMotion() ({ technique, ms, ease }).
 */
export function createExpanded({ host, card, slot, motion, onClose, onNewTab, onBack, doc = globalThis.document, win = globalThis }) {
  const nameEl = h('span', { class: 'tp-x-name' });
  const byEl = h('span', { class: 'tp-x-by' });
  const backBtn = h('button', { type: 'button', class: 'tp-x-btn back', hidden: true, onclick: () => onBack() });
  const newBtn = h('button', { type: 'button', class: 'tp-x-btn tp-x-new', title: 'Open in a new tab', 'aria-label': 'Open in a new tab', onclick: () => onNewTab() },
    icon('newtab', 16), h('span', { class: 'lbl' }, 'New tab'));
  // EX1: the browser's own full screen where it's allowed (computers, Android, iPad); not on an iPhone (video only).
  const canFull = !!(doc.fullscreenEnabled && typeof slot.requestFullscreen === 'function');
  const fullBtn = h('button', { type: 'button', class: 'tp-x-btn tp-x-full', title: 'Full screen', 'aria-label': 'Full screen', hidden: !canFull,
    onclick: () => { try { slot.requestFullscreen().catch(() => {}); } catch { /* not allowed here */ } } },
  icon('fullscreen', 16), h('span', { class: 'lbl' }, 'Full screen'));
  const closeBtn = h('button', { type: 'button', class: 'tp-x-btn icon-only tp-x-close', title: 'Close (Esc, or Back)', 'aria-label': 'Close the expanded view', onclick: () => onClose() },
    icon('close', 16));
  const hole = h('div', { class: 'tp-x-hole' });
  const noteEl = h('p', { class: 'tp-x-note', role: 'status', hidden: true });
  const el = h('div', { class: 'tp-x', role: 'region', 'aria-label': 'Expanded tile' },
    h('div', { class: 'tp-x-bar' }, h('div', { class: 'tp-x-who' }, nameEl, byEl), backBtn, newBtn, fullBtn, closeBtn),
    h('div', { class: 'tp-x-stage' }, hole, noteEl));
  let spacer = null, state = 'closed', noteTimer = null;

  const pin = (r) => Object.assign(slot.style, box(r));
  const unpin = () => { for (const k of [...SIDES, 'opacity', 'clipPath']) slot.style[k] = ''; };
  const run = (target, frames, extra = {}) => target.animate(frames, { duration: motion.ms, easing: motion.ease, fill: 'forwards', ...extra });
  const settle = async (anims) => {
    try { await Promise.all(anims.map((a) => a.finished)); } catch { /* cancelled: fine */ }
    for (const a of anims) { try { a.commitStyles?.(); } catch { /* fine */ } a.cancel(); }
  };
  const onResize = () => { if (state === 'open' && doc.fullscreenElement !== slot) pin(rect(hole)); };

  // How it moves (EX4, EX8): window (owner, Nov 8: the live tile pinned at the stage at once, shown through a clip that
  // opens from the post's box, so the tile isn't redrawn at every size), or a plain fade with reduced motion.
  async function move(from, to, dir) {
    const backdrop = run(el, dir === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { easing: 'linear' });
    const big = dir === 'in' ? to : from, small = dir === 'in' ? from : to;
    pin(big);
    if (motion.technique === 'fade') {
      await settle([backdrop, run(slot, dir === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { easing: 'linear' })]);
      return;
    }
    const round = parseFloat(win.getComputedStyle?.(slot).borderTopLeftRadius) || 0;   // (10 px on a computer, none on a phone)
    const a = clipInset(small, big, round), b = clipInset(big, big, round);
    await settle([backdrop, run(slot, dir === 'in' ? [{ clipPath: a }, { clipPath: b }] : [{ clipPath: b }, { clipPath: a }])]);
    slot.style.clipPath = '';
  }

  async function open() {
    if (state !== 'closed') return;
    state = 'opening';
    const from = rect(slot);
    spacer = h('div', { class: 'tp-slot-spacer', 'aria-hidden': 'true' });
    spacer.style.height = `${from.height}px`;
    slot.before(spacer);                       // (a sibling: the slot itself stays where it is in the page)
    host.append(el);
    host.classList.add('tp-x-on');
    card.classList.add('x-open');
    slot.classList.add('expanded');
    const to = rect(hole);
    await move(from, to, 'in');
    if (state !== 'opening') return;
    slot.style.opacity = '';
    el.style.opacity = '';
    pin(rect(hole));
    state = 'open';
    win.addEventListener('resize', onResize);
  }

  async function close({ instant = false } = {}) {
    if (state === 'closed' || state === 'closing') return;
    const was = state;
    state = 'closing';
    win.removeEventListener('resize', onResize);
    clearTimeout(noteTimer);
    if (doc.fullscreenElement === slot) { try { await doc.exitFullscreen(); } catch { /* fine */ } }
    for (const a of [...slot.getAnimations(), ...el.getAnimations()]) a.cancel();
    if (!instant && was === 'open' && spacer && spacer.isConnected) await move(rect(slot), rect(spacer), 'out');
    unpin();
    slot.classList.remove('expanded');
    card.classList.remove('x-open');
    host.classList.remove('tp-x-on');
    el.style.opacity = '';
    el.remove();
    if (spacer) { spacer.remove(); spacer = null; }
    state = 'closed';
  }

  function setPlace({ name, by, travelled, backTo }) {
    nameEl.textContent = name || '';
    if (travelled) byEl.replaceChildren(h('b', {}, 'Now in'), by ? ` · by @${by}` : '');
    else byEl.replaceChildren(by ? `by @${by}` : '');
    backBtn.hidden = !backTo;
    backBtn.replaceChildren(icon('back', 16), h('span', { class: 'lbl' }, backTo ? `Back to ${backTo}` : ''));
    el.setAttribute('aria-label', `${name || 'Tile'}, expanded`);
  }

  function note(text) {
    clearTimeout(noteTimer);
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
    if (text) noteTimer = setTimeout(() => { noteEl.hidden = true; }, PLAY_HERE.noteMs);
  }

  return { open, close, setPlace, note, el, get isOpen() { return state === 'open' || state === 'opening'; }, get canFull() { return canFull; } };
}
