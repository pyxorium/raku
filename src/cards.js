// Cards: one tile as a card (its banner picture, name, a line of description, "by @handle"), and one
// account as a chip (avatar, handle, how many tiles). Used by the first screen's picks, your shelf and
// an account's tiles (stage 2). Nothing runs from a card: opening one starts the tile in a tab.
//
// Pictures load as a card comes near the screen, three at a time, through the same careful fetching as
// tiles (net.js: https, public hosts, size and time limits), and only as plain picture types
// (moderation.js sniffPicture: PNG, JPEG, WebP, GIF, SVG drawn as an image).

import { LIMITS } from './config.js';
import { blobCidOf } from './tiles.js';
import { sniffPicture } from './moderation.js';
import { icon } from './icons.js';

export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};

/** The banner (first screenshot) of a tile's manifest, as a blob reference. */
export function bannerCid(manifest) {
  const shots = Array.isArray(manifest?.screenshots) ? manifest.screenshots : [];
  for (const s of shots) {
    const cid = blobCidOf(manifest.resources?.[s?.src]);
    if (cid) return cid;
  }
  return null;
}

export function createCardKit({ files }) {
  const waiting = [];
  let running = 0;
  const MAX = 3;

  function pump() {
    while (running < MAX && waiting.length) {
      const job = waiting.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  }
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer.unobserve(e.target);
        const load = e.target._loadPicture;
        if (load) { delete e.target._loadPicture; waiting.push(load); pump(); }
      }
    }, { rootMargin: '400px' })
    : null;

  /** Loads a banner into `holder` when it comes near the screen: a tile's own file ({ pds, did, cid }), downloaded
   *  and checked; or (stage 6c, Q122) a picture at an https address ({ url }: appmosphe.re's /img/ copies, which can't
   *  be downloaded by a page), drawn as an ordinary picture in its own lane: the browser loads it when it comes near
   *  the screen, sends no referrer, and draws it only if it is a picture. */
  function picture(holder, { pds, did, cid, url }) {
    if (url) {
      if (!/^https:\/\//.test(url)) return;
      const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      holder.append(img);
      return;
    }
    holder._loadPicture = async () => {
      try {
        const buf = await files.get(pds, did, cid, { left: LIMITS.cardImageBytes });
        const type = buf && sniffPicture(new Uint8Array(buf));
        if (type && holder.isConnected) holder.append(h('img', { src: URL.createObjectURL(new Blob([buf], { type })), alt: '' }));
      } catch { /* the plain background stays */ }
    };
    if (observer) observer.observe(holder);
    else { waiting.push(holder._loadPicture); pump(); }
  }

  /**
   * A tile's card. The whole card opens the tile (in this tab); corner buttons open it in a new tab and,
   * on your shelf, remove it. `note` (a sentence) and `greyed` mark tiles that can't be opened.
   */
  // by: a handle ("by @handle"), or an account's DID when no handle could be checked ("by did:plc:…");
  // when (stage 6c): a short time after it ("3h ago").
  const byText = (b, w) => [b ? (b.startsWith('did:') ? `by ${b}` : `by @${b}`) : '', w || ''].filter(Boolean).join(' · ');
  function tileCard({ name, description = '', by = '', when = '', note = '', greyed = false, badge = '', onOpen, onOpenNew, onRemove, removeLabel }) {
    // badge: a short word over the picture (stage 6: "New" in Following)
    const pic = h('div', { class: 'card-pic' }, badge ? h('span', { class: 'card-badge' }, badge) : null);
    const title = h('span', { class: 'card-title' }, name || 'Untitled tile');
    const desc = h('span', { class: 'card-desc' }, description);
    let byNow = by;
    const whenNow = when;
    const byLine = h('span', { class: 'card-by' }, byText(by, when));
    const noteLine = h('span', { class: 'card-note' }, note);
    const main = h('button', { type: 'button', class: 'card-main', disabled: greyed || !onOpen, onclick: () => onOpen?.(),
      onauxclick: (ev) => { if (ev.button === 1 && onOpenNew) { ev.preventDefault(); onOpenNew(); } } },
    pic, h('span', { class: 'card-text' }, title, desc, byLine, noteLine));
    const corner = h('div', { class: 'card-corner' },
      onOpenNew && !greyed ? h('button', { type: 'button', class: 'card-btn', title: 'Open in a new tab', 'aria-label': `Open ${name} in a new tab`, onclick: onOpenNew }, icon('newtab', 16)) : null,
      onRemove ? h('button', { type: 'button', class: 'card-btn', title: removeLabel || 'Remove from your shelf', 'aria-label': `${removeLabel || 'Remove from your shelf'}: ${name}`, onclick: onRemove }, icon('close', 16)) : null);
    const card = h('article', { class: `card${greyed ? ' greyed' : ''}` }, main, corner);
    return {
      el: card,
      set({ name: n, description: d, by: b, note: t, greyed: g }) {
        if (n !== undefined) { title.textContent = n || 'Untitled tile'; }
        if (d !== undefined) desc.textContent = d;
        if (b !== undefined) { byNow = b; byLine.textContent = byText(byNow, whenNow); }
        if (t !== undefined) noteLine.textContent = t;
        if (g !== undefined) { card.classList.toggle('greyed', g); main.disabled = g || !onOpen; }
      },
      // look (stage 6c): 'icon' draws a small picture whole instead of filling the card; 'blur' blurs it (an
      // account labelled adult or graphic)
      picture(ref, { look = '' } = {}) {
        if (!ref?.cid && !ref?.url) return;
        if (look.includes('icon')) pic.classList.add('is-icon');
        if (look.includes('blur')) pic.classList.add('blurred');
        picture(pic, ref);
      },
    };
  }

  /** An account as a chip: avatar, handle, how many tiles. */
  function accountChip({ handle, did, onOpen, onRemove }) {
    const av = h('span', { class: 'chip-av' });
    const name = h('span', { class: 'chip-name' }, handle ? `@${handle}` : did);
    const count = h('small', { class: 'chip-count' }, '');
    const chip = h('div', { class: 'chip' },
      h('button', { type: 'button', class: 'chip-main', onclick: onOpen }, av, name, count),
      onRemove ? h('button', { type: 'button', class: 'chip-x', title: 'Remove from your shelf', 'aria-label': `Remove @${handle || did} from your shelf`, onclick: onRemove }, icon('close', 14)) : null);
    return {
      el: chip,
      set({ handle: hd, avatar, count: n }) {
        if (hd) name.textContent = `@${hd}`;
        if (avatar && !av.firstChild) av.append(h('img', { src: avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }));
        if (n) count.textContent = ` · ${n.count}${n.more ? '+' : ''} tile${n.count === 1 && !n.more ? '' : 's'}`;
      },
    };
  }

  return { tileCard, accountChip, picture };
}
