// A tile post's Share button and its small menu (claude/raku-post-links-plan.md, SL2, SL3, SL8): on every post card, in
// Tile posts and on the post's own page. The menu:
//   Open post     (Tile posts only) the post's page in this tab (SL3, SL4)
//   Copy link     Raku's address with that one post in front (address.js shareLink), never the page's own address
//   Share via…    the device's share sheet (navigator.share), only where there is one: the post's words, the link, and
//                 "@handle's tile post" as the title (SL8)
// One menu is open at a time; Escape, a click outside or Tab closes it; the arrow keys move through it. No inline
// styles (the page policy): the look is in style.css (.ps-…).

import { h } from './cards.js';
import { icon } from './icons.js';
import { shareLink } from './address.js';

/** Does this browser have a share sheet? (Edge and Chrome on Windows, phones; not Firefox on a computer.) */
export const hasShareSheet = (nav = globalThis.navigator) => !!nav && typeof nav.share === 'function';

/**
 * What "Share via…" hands the share sheet (SL8). handle: the author's handle when known (else no @ in the title).
 * The words go as plain text; a post without words sends the title and link only. → { title, text?, url }
 */
export function shareData(post, handle = null, origin) {
  const url = shareLink(post.uri, origin);
  const title = handle ? `@${handle}'s tile post` : 'A tile post';
  const text = typeof post.text === 'string' ? post.text.trim() : '';
  return text ? { title, text, url } : { title, url };
}

let openOne = null;   // the menu open now, if any: { close() }

/**
 * The Share button with its menu. → the element (a span holding the button and the menu).
 * post: a readTilePost result. handle(): the author's handle when known. open: opens the post's page (null on the page itself).
 */
export function shareMenu({ post, handle = () => null, open = null, nav = globalThis.navigator, origin } = {}) {
  const btn = h('button', { type: 'button', class: 'ps-btn', title: 'Share', 'aria-label': 'Share this post', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('share', 17));
  const menu = h('div', { class: 'ps-menu', role: 'menu', 'aria-label': 'Share this post', hidden: true });
  const done = h('span', { class: 'ps-done', role: 'status' });
  const wrap = h('span', { class: 'ps' }, btn, menu, done);
  let doneTimer = null;

  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const item = (label, ic, onclick) => h('button', { type: 'button', role: 'menuitem', class: 'ps-item', tabindex: '-1', onclick }, icon(ic, 16), h('span', {}, label));

  function onOutside(e) { if (!wrap.contains(e.target)) close(); }
  function close({ focus = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (openOne && openOne.close === close) openOne = null;
    if (focus) btn.focus();
  }
  function say(words) {
    clearTimeout(doneTimer);
    done.textContent = words;
    doneTimer = setTimeout(() => { done.textContent = ''; }, 1800);
  }
  // The clipboard refused (an old browser, a setting): the link shown selected, to copy by hand.
  function byHand(link) {
    const box = h('input', { type: 'text', class: 'ps-link', readonly: true, value: link, 'aria-label': 'The link to this post', onfocus: (e) => e.target.select() });
    menu.replaceChildren(h('p', { class: 'ps-note' }, 'Select and copy the link:'), box);
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    box.focus();
    box.select();
  }
  async function copy() {
    const link = shareLink(post.uri, origin);
    try {
      await nav.clipboard.writeText(link);
      close({ focus: true });
      say('Link copied');
    } catch {
      byHand(link);
    }
  }
  async function share() {
    close({ focus: true });
    try { await nav.share(shareData(post, handle(), origin)); } catch (err) {
      if (err && err.name === 'AbortError') return;     // the sheet closed without sharing: nothing to say
      byHand(shareLink(post.uri, origin));
    }
  }
  function show() {
    if (openOne) openOne.close();
    menu.replaceChildren(
      ...(open ? [item('Open post', 'posts', () => { close(); open(); })] : []),
      item('Copy link', 'link', () => copy()),
      ...(hasShareSheet(nav) ? [item('Share via…', 'share', () => share())] : []));
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    openOne = { close };
    items()[0]?.focus();
  }

  btn.addEventListener('click', () => (menu.hidden ? show() : close()));
  btn.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menu.hidden) { e.preventDefault(); show(); if (e.key === 'ArrowUp') items().at(-1)?.focus(); }
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ focus: true }); return; }
    if (e.key === 'Tab') { close(); return; }
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list.at(-1).focus(); }
  });
  return wrap;
}
