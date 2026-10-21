// The link message (stage 6, and stage 7 later): Raku itself shows where a link goes, and opens it only when
// the person clicks Open. Used for everything that leaves Raku from a page Raku draws (a post, a link in a
// post, a link card); built general so stage 7 can use it for links that tiles ask to open (raku-plan.md
// section 7, "Link message").
//
// Drawn by Raku outside any tile: the destination's site name in bold plus the full address, what's asking
// ("A post in Tile news", a tile's name and author), "Only continue if you trust this site", Open / Cancel.
// Open makes a new window with no opener and no referrer. Only http and https addresses are ever opened.

import { h } from './cards.js';
import { icon } from './icons.js';

export function safeLink(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch { return null; }
}

/** createLinkMessage(holder, { open }) → { show({ url, from }), close() }; open(url) is a new window by default. */
export function createLinkMessage(holder, { open = (url) => globalThis.open(url, '_blank', 'noopener,noreferrer') } = {}) {
  let box = null;
  let before = null;

  function close() {
    if (!box) return;
    box.remove();
    box = null;
    document.removeEventListener('keydown', onKey, true);
    if (before && before.isConnected) { try { before.focus(); } catch { /* fine */ } }
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

  /** Shows the message. `from` is a short line saying what's asking (optional). → false if the address isn't openable. */
  function show({ url, from = '' }) {
    const u = safeLink(url);
    close();
    if (!u) return false;
    before = document.activeElement;
    const host = u.hostname.replace(/^www\./, '');
    const openBtn = h('button', { type: 'button', class: 'primary', onclick: () => { const go = u.toString(); close(); open(go); } }, 'Open');
    const cancel = h('button', { type: 'button', onclick: close }, 'Cancel');
    box = h('div', { class: 'link-msg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rk-link-title', onclick: (e) => { if (e.target === box) close(); } },
      h('div', { class: 'link-msg-box' },
        h('button', { type: 'button', class: 'rk-dialog-x', 'aria-label': 'Cancel', onclick: close }, icon('close', 18)),
        h('h2', { id: 'rk-link-title' }, 'This opens a page outside Raku'),
        h('p', { class: 'link-msg-site' }, h('b', {}, host)),
        h('p', { class: 'link-msg-url' }, u.toString()),
        from ? h('p', { class: 'link-msg-from' }, from) : null,
        h('p', { class: 'link-msg-trust' }, 'Only continue if you trust this site.'),
        h('div', { class: 'actions' }, openBtn, cancel)));
    holder.append(box);
    document.addEventListener('keydown', onKey, true);
    openBtn.focus();
    return true;
  }

  return { show, close, get shown() { return !!box; } };
}
