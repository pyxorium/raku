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
import { POST_APPS, POST_APP_KEY, postApp, postLink, RECORD_APPS, RECORD_APP_KEY, recordApp, explorerLink } from './config.js';

// The two "Open in" menus: one for posts (stage 6b, Q98), one for records and collections that aren't tiles (open
// links, OL4). Each remembers its own choice in this browser.
function menuFor({ post, record }, storage) {
  if (post) return {
    apps: POST_APPS, key: POST_APP_KEY, app: postApp(storage), label: 'Open posts in',
    note: 'Remembered for posts in this browser.', link: (a) => postLink(a, post.actor, post.rkey), names: '.post-app-name',
  };
  if (record) return {
    apps: RECORD_APPS, key: RECORD_APP_KEY, app: recordApp(storage), label: 'Open records in',
    note: 'Remembered for records in this browser.', link: (a) => explorerLink(a, record.uri), names: null,
  };
  return null;
}

export function safeLink(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch { return null; }
}

/**
 * createLinkMessage(holder, { open, storage }) → { show({ url, from } | { post: { actor, rkey }, from } |
 *   { record: { uri }, from }), close() };
 * open(url) is a new window by default. For a post (stage 6b, Q98), the message carries "Open in [app ▾]": the
 * app that shows posts (Bluesky by default), remembered in this browser; switching it updates the address shown,
 * and every "Open post in …" on the page (elements with class post-app-name).
 */
export function createLinkMessage(holder, { open = (url) => globalThis.open(url, '_blank', 'noopener,noreferrer'), storage = null } = {}) {
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

  /**
   * Shows the message. `from` is a short line saying what's asking (optional). A post ({ actor, rkey }) or a record
   * ({ uri }: an at:// address of a record or collection that isn't a tile) carries an "Open in" menu.
   * → false if the address isn't openable.
   */
  function show({ url = null, post = null, record = null, from = '' }) {
    const menu = menuFor({ post, record }, storage);
    let u = safeLink(menu ? menu.link(menu.app) : url);
    close();
    if (!u) return false;
    before = document.activeElement;
    const site = h('b', {}, u.hostname.replace(/^www\./, ''));
    const full = h('p', { class: 'link-msg-url' }, u.toString());
    let choice = null;
    if (menu) {
      const select = h('select', { class: 'link-msg-app', 'aria-label': menu.label },
        menu.apps.map((a) => h('option', { value: a.id, selected: a.id === menu.app.id }, a.name)));
      select.addEventListener('change', () => {
        const app = menu.apps.find((a) => a.id === select.value) || menu.apps[0];
        const next = safeLink(menu.link(app));
        if (!next) return;
        u = next;
        site.textContent = u.hostname.replace(/^www\./, '');
        full.textContent = u.toString();
        try { storage?.setItem(menu.key, app.id); } catch { /* fine: this visit only */ }
        if (menu.names) for (const el of document.querySelectorAll(menu.names)) el.textContent = app.name;
      });
      choice = h('div', { class: 'link-msg-choice' }, h('label', {}, 'Open in ', select), h('span', { class: 'small' }, menu.note));
    }
    const openBtn = h('button', { type: 'button', class: 'primary', onclick: () => { const go = u.toString(); close(); open(go); } }, 'Open');
    const cancel = h('button', { type: 'button', onclick: close }, 'Cancel');
    box = h('div', { class: 'link-msg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rk-link-title', onclick: (e) => { if (e.target === box) close(); } },
      h('div', { class: 'link-msg-box' },
        h('button', { type: 'button', class: 'rk-dialog-x', 'aria-label': 'Cancel', onclick: close }, icon('close', 18)),
        h('h2', { id: 'rk-link-title' }, 'This opens a page outside Raku'),
        h('p', { class: 'link-msg-site' }, site),
        full,
        choice,
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
