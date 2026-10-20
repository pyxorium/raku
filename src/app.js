// Raku's page: the tab strip, the address bar, and one pane per tab (a running tile, or the first screen).
//
// A tile opens in four steps, each shown in the tab:
//   1. find it (handle → account → its record), and check it isn't hidden (moderation.js);
//   2. read its size from the record: open, ask first ("Open anyway?") or refuse (config.js LIMITS);
//   3. start it through the tile loading server (a new frame, a fresh random name, a new worker);
//   4. watch it: "Still loading…" after 4 s, Try again after 8 s (as Daisy's frames.js and the blog's
//      web-tile-mount.js). Nothing restarts on its own.
// Background tabs keep running (decision 9): their panes are only moved out of sight.

import { Tile } from '@dasl/tile-loader';
import { SITE, LIMITS, TIMES, PICKS, TAKEDOWNS_PAGE, TILE_POPUPS } from './config.js';
import { parseAddress, atUri } from './address.js';
import { createTabs, current } from './tabs.js';
import { describeTile, sizeVerdict, createPathLoader, blobCidOf } from './tiles.js';
import { formatBytes, NetError } from './net.js';
import { sniffPicture } from './moderation.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};

export function mountRaku(root, { mothership, resolver, moderation, files, loc = globalThis.location, hist = globalThis.history }) {
  const tabs = createTabs();
  const panes = new Map();          // tab id -> pane state
  const largeOk = new Set();        // tiles the visitor said "Open anyway" to, this visit
  let notice = null;

  // ---------- the frame of the page ----------
  const brand = h('span', { class: 'brand' }, SITE.name, SITE.lab ? h('span', { class: 'lab' }, ' (lab)') : null);
  const strip = h('div', { class: 'tabstrip', role: 'tablist', 'aria-label': 'Open tabs' });
  const newTabBtn = h('button', { class: 'newtab', type: 'button', title: 'New tab', 'aria-label': 'New tab', onclick: () => openNew() }, '+');
  const backBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Back', 'aria-label': 'Back', onclick: () => tabs.back(tabs.active.id) }, '←');
  const fwdBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Forward', 'aria-label': 'Forward', onclick: () => tabs.forward(tabs.active.id) }, '→');
  const reloadBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Reload this tile', 'aria-label': 'Reload this tile', onclick: () => reload(tabs.active.id) }, '↻');
  const input = h('input', {
    class: 'addr', type: 'text', name: 'address', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': "A tile's address", placeholder: "Paste a tile's address (at://…, a lexicographer.space link, tile://…)",
  });
  input.addEventListener('focus', () => input.select());
  const form = h('form', { class: 'addr-form', role: 'search', onsubmit: (ev) => { ev.preventDefault(); submitAddress(); } }, input);
  // On a phone (decision, Oct 19: option A) the address gets the whole top row, and these four go in a
  // toolbar along the bottom, each a full thumb-size target. On a computer the toolbar is hidden.
  const toolBtn = (label, title, onclick) => h('button', { class: 'tool-btn', type: 'button', title, 'aria-label': title, onclick }, label);
  const backTool = toolBtn('←', 'Back', () => tabs.back(tabs.active.id));
  const fwdTool = toolBtn('→', 'Forward', () => tabs.forward(tabs.active.id));
  const reloadTool = toolBtn('↻', 'Reload this tile', () => reload(tabs.active.id));
  const countBtn = h('button', { class: 'count', type: 'button', title: 'Open tabs', 'aria-label': 'Show open tabs', onclick: () => toggleSheet(true) }, h('span', {}, '1'));
  const toolbar = h('nav', { class: 'toolbar', 'aria-label': 'Browsing' }, backTool, fwdTool, reloadTool, countBtn);
  const noteLine = h('div', { class: 'note', role: 'status', 'aria-live': 'polite', hidden: true });
  const stage = h('main', { class: 'stage' });
  const sheetList = h('ul', { class: 'sheet-list' });
  const sheet = h('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-label': 'Open tabs' },
    h('div', { class: 'sheet-head' },
      h('span', {}, 'Open tabs'),
      h('button', { type: 'button', class: 'sheet-new', onclick: () => { toggleSheet(false); openNew(); } }, '+ New tab'),
      h('button', { type: 'button', class: 'sheet-done', onclick: () => toggleSheet(false) }, 'Done')),
    sheetList);

  root.replaceChildren(
    h('header', { class: 'chrome' },
      h('div', { class: 'strip-row' }, brand, strip, newTabBtn),
      h('div', { class: 'bar' }, h('span', { class: 'brand brand-small' }, SITE.name),
        h('div', { class: 'nav' }, backBtn, fwdBtn, reloadBtn), form),
      noteLine),
    stage, toolbar, sheet);

  function say(text) {
    clearTimeout(notice);
    noteLine.textContent = text || '';
    noteLine.hidden = !text;
    if (text) notice = setTimeout(() => { noteLine.hidden = true; }, 6000);
  }

  function openNew(uri = null) {
    const t = tabs.open(uri);
    if (!t) { say(`Raku keeps up to ${tabs.max} tabs open. Close one to open another.`); return null; }
    if (!uri) setTimeout(() => input.focus(), 0);
    return t;
  }

  function submitAddress() {
    const r = parseAddress(input.value);
    if (!r.ok) { say(r.reason); return; }
    say('');
    tabs.go(tabs.active.id, r.uri);
    input.blur();
  }

  function toggleSheet(open) { sheet.hidden = !open; if (open) drawSheet(); }

  // ---------- one pane per tab ----------
  function paneFor(tab) {
    let p = panes.get(tab.id);
    if (!p) {
      const el = h('section', { class: 'pane', 'data-tab': tab.id });
      p = { el, uri: undefined, attempt: 0, timers: [], frame: null, title: 'New tab', icon: null, shownAddress: '', state: 'new' };
      panes.set(tab.id, p);
      stage.append(el);
    }
    return p;
  }

  function clearPane(p) {
    p.attempt++;
    p.timers.forEach(clearTimeout);
    p.timers = [];
    if (p.frame) { p.frame.remove(); p.frame = null; }
    if (p.icon) { URL.revokeObjectURL(p.icon); p.icon = null; }
    p.el.replaceChildren();
  }

  function show(tab) {
    const p = paneFor(tab);
    const uri = current(tab);
    if (p.uri === uri) return;
    p.uri = uri;
    clearPane(p);
    if (!uri) { p.title = 'New tab'; p.shownAddress = ''; p.state = 'new'; drawFirstScreen(p, tab); }
    else openTile(p, tab, uri);
  }

  function reload(id) {
    const tab = tabs.list.find((t) => t.id === id);
    if (!tab) return;
    const p = paneFor(tab);
    p.uri = undefined;
    show(tab);
  }

  function status(p, kind, text, ...actions) {
    let box = p.el.querySelector('.tile-status');
    if (!box) { box = h('div', { class: 'tile-status' }); p.el.append(box); }
    box.dataset.kind = kind;
    actions = actions.filter(Boolean);
    box.replaceChildren(h('p', {}, text), ...(actions.length ? [h('div', { class: 'actions' }, actions)] : []));
    box.hidden = false;
  }
  function hideStatus(p) { const b = p.el.querySelector('.tile-status'); if (b) b.hidden = true; }
  const button = (label, onclick, cls = '') => h('button', { type: 'button', class: cls, onclick }, label);

  async function openTile(p, tab, uri) {
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    const parsed = parseAddress(uri);
    p.state = 'finding';
    p.title = parsed.ok ? parsed.rkey : 'Tile';
    p.shownAddress = uri;
    drawChrome();
    status(p, 'loading', 'Finding this tile…');
    if (!parsed.ok) { p.state = 'error'; status(p, 'error', parsed.reason); return; }

    let did, record, account;
    try {
      did = await resolver.didFor(parsed.actor);
      if (!alive()) return;
      if (await moderation.isHidden(did, parsed.rkey)) {
        if (!alive()) return;
        p.state = 'hidden';
        p.title = 'Not shown';
        drawChrome();
        status(p, 'hidden', "This tile isn't shown in Raku.",
          h('a', { href: TAKEDOWNS_PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Reporting and takedowns ↗'));
        return;
      }
      [record, account] = await Promise.all([resolver.tileRecord(did, parsed.rkey), resolver.account(did)]);
      if (!alive()) return;
    } catch (err) {
      if (!alive()) return;
      p.state = 'error';
      const msg = err instanceof NetError ? err.message : "Couldn't find this tile.";
      // Try again only when trying again could help (not for a missing tile or a refused address).
      const retry = !(err instanceof NetError) || ['network', 'timeout', 'upstream'].includes(err.code);
      status(p, 'error', msg, retry ? button('Try again', () => reload(tab.id)) : null);
      return;
    }

    const d = describeTile(record);
    if (!d.ok) { p.state = 'error'; status(p, 'error', d.reason); return; }
    p.title = d.name;
    p.shownAddress = atUri(did, parsed.rkey);
    drawChrome();
    const didForm = p.shownAddress;
    resolver.checkedHandle(did).then((handle) => {
      // (the tile may have started meanwhile, so check the address rather than the attempt)
      if (handle && p.uri === uri && p.shownAddress === didForm) { p.shownAddress = atUri(handle, parsed.rkey); drawChrome(); }
    });

    const verdict = sizeVerdict(d.declaredBytes);
    if (verdict === 'refuse') {
      p.state = 'error';
      status(p, 'refused', `This tile is too large to open here (${formatBytes(d.declaredBytes)}). Raku opens tiles up to ${formatBytes(LIMITS.maxBytes)}.`);
      return;
    }
    if (verdict === 'ask' && !largeOk.has(p.shownAddress)) {
      p.state = 'asking';
      status(p, 'ask', `This tile is large (${formatBytes(d.declaredBytes)}). Open anyway?`,
        button('Open anyway', () => { largeOk.add(p.shownAddress); startTile(p, tab, uri, did, account.pds, d); }, 'primary'),
        button('Not now', () => (tabs.canBack(tab.id) ? tabs.back(tab.id) : tabs.go(tab.id, null))));
      return;
    }
    startTile(p, tab, uri, did, account.pds, d);
  }

  function startTile(p, tab, uri, did, pds, d) {
    clearPane(p);
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    p.state = 'loading';
    status(p, 'loading', 'Loading tile…');
    p.timers = [
      setTimeout(() => { if (alive() && p.state === 'loading') status(p, 'loading', 'Still loading…'); }, TIMES.still),
      setTimeout(() => { if (alive() && p.state === 'loading') status(p, 'loading', 'Still loading…', button('Try again', () => startTile(p, tab, uri, did, pds, d))); }, TIMES.retry),
    ];
    const loader = createPathLoader({
      files, pds, did, manifest: d.manifest,
      onFile(path, ok, err) {
        if (!alive()) return;
        if (path === '/' || path === '/index.html') {
          p.timers.forEach(clearTimeout);
          if (ok) { p.state = 'ready'; hideStatus(p); drawChrome(); }
          else { p.state = 'error'; status(p, 'error', err?.message || "Couldn't load this tile.", button('Try again', () => startTile(p, tab, uri, did, pds, d))); }
        } else if (!ok && err?.code === 'too-large') {
          say(`"${d.name}" asked for more than ${formatBytes(LIMITS.maxBytes)} of files; Raku stopped there.`);
        }
      },
    });
    const tile = new Tile(mothership, uri, d.manifest, loader);
    const frame = tile.renderContent(600);
    frame.className = 'tile-frame';
    frame.removeAttribute('style');
    frame.title = d.name;
    frame.setAttribute('allow', '');                 // no camera, microphone, location… for tiles (stage 1)
    frame.setAttribute('referrerpolicy', 'no-referrer');
    if (!TILE_POPUPS) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');
    p.frame = frame;
    p.el.prepend(frame);
    loadIcon(p, did, pds, d.manifest, alive);
  }

  async function loadIcon(p, did, pds, manifest, alive) {
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const entry = icons.length ? manifest.resources?.[icons[0].src] : null;
    const cid = blobCidOf(entry);
    if (!cid) return;
    try {
      const buf = await files.get(pds, did, cid, { left: 512 * 1024 });
      const type = buf && sniffPicture(new Uint8Array(buf));
      if (!type || !alive()) return;
      p.icon = URL.createObjectURL(new Blob([buf], { type }));
      drawChrome();
    } catch { /* no icon: the dot stays */ }
  }

  // ---------- the first screen ----------
  function drawFirstScreen(p, tab) {
    const grid = h('div', { class: 'picks' });
    p.el.append(h('div', { class: 'first' },
      h('h1', {}, SITE.name, SITE.lab ? h('span', { class: 'lab' }, ' (lab)') : null),
      h('p', { class: 'lede' }, 'A browser for web tiles: small pages people publish to their own atproto accounts. Paste a tile\'s address above, or start with one of these.'),
      grid,
      h('p', { class: 'small' }, 'Tiles run in their own sealed frames, loaded from their authors\' own accounts. Raku has no sign-in for browsing.')));
    for (const uri of PICKS) grid.append(pickCard(uri, tab));
  }

  function pickCard(uri, tab) {
    const parsed = parseAddress(uri);
    const pic = h('div', { class: 'pick-pic' });
    const title = h('span', { class: 'pick-title' }, '…');
    const desc = h('span', { class: 'pick-desc' }, '');
    const by = h('span', { class: 'pick-by' }, '');
    const card = h('button', { type: 'button', class: 'pick', onclick: () => tabs.go(tab.id, uri) }, pic, h('span', { class: 'pick-text' }, title, desc, by));
    (async () => {
      if (!parsed.ok) throw new Error('bad pick');
      const did = await resolver.didFor(parsed.actor);
      if (await moderation.isHidden(did, parsed.rkey)) { card.remove(); return; }
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, parsed.rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (!d.ok) throw new Error(d.reason);
      title.textContent = d.name;
      desc.textContent = d.description;
      resolver.checkedHandle(did).then((hd) => { by.textContent = hd ? `by @${hd}` : ''; });
      const shots = Array.isArray(d.manifest.screenshots) ? d.manifest.screenshots : [];
      const cid = blobCidOf(shots.length ? d.manifest.resources?.[shots[0].src] : null);
      if (cid) {
        const buf = await files.get(acct.pds, did, cid, { left: LIMITS.cardImageBytes });
        const type = buf && sniffPicture(new Uint8Array(buf));
        if (type) pic.append(h('img', { src: URL.createObjectURL(new Blob([buf], { type })), alt: '' }));
      }
    })().catch(() => { title.textContent = title.textContent === '…' ? "Couldn't load this pick" : title.textContent; });
    return card;
  }

  // ---------- drawing the chrome ----------
  function tabButton(tab) {
    const p = paneFor(tab);
    const on = tab.id === tabs.active.id;
    const icon = p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state });
    const close = h('span', { class: 'tab-x', role: 'button', 'aria-label': `Close ${p.title}`, title: 'Close tab',
      onclick: (ev) => { ev.stopPropagation(); tabs.close(tab.id); } }, '×');
    const b = h('div', { class: `tab${on ? ' on' : ''}`, role: 'tab', tabindex: '0', 'aria-selected': on ? 'true' : 'false', title: p.title,
      onclick: () => tabs.activate(tab.id),
      onauxclick: (ev) => { if (ev.button === 1) tabs.close(tab.id); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tabs.activate(tab.id); } } },
    icon, h('span', { class: 'tab-title' }, p.title), close);
    return b;
  }

  function drawSheet() {
    sheetList.replaceChildren(...tabs.list.map((tab) => {
      const p = paneFor(tab);
      const on = tab.id === tabs.active.id;
      return h('li', { class: on ? 'on' : '' },
        h('button', { type: 'button', class: 'sheet-tab', onclick: () => { tabs.activate(tab.id); toggleSheet(false); } },
          p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state }),
          h('span', { class: 'tab-title' }, p.title)),
        h('button', { type: 'button', class: 'sheet-x', 'aria-label': `Close ${p.title}`, onclick: () => { tabs.close(tab.id); drawSheet(); } }, '×'));
    }));
  }

  function drawChrome() {
    strip.replaceChildren(...tabs.list.map(tabButton));
    const tab = tabs.active;
    const p = paneFor(tab);
    if (document.activeElement !== input) input.value = p.shownAddress || '';
    backBtn.disabled = backTool.disabled = !tabs.canBack(tab.id);
    fwdBtn.disabled = fwdTool.disabled = !tabs.canForward(tab.id);
    reloadBtn.disabled = reloadTool.disabled = !current(tab);
    newTabBtn.disabled = tabs.full;
    countBtn.firstChild.textContent = String(tabs.list.length);
    for (const [id, pane] of panes) pane.el.classList.toggle('front', id === tab.id);
    document.title = current(tab) ? `${p.title} · ${SITE.name}${SITE.lab ? ' (lab)' : ''}` : `${SITE.name}${SITE.lab ? ' (lab)' : ''}`;
    if (!sheet.hidden) drawSheet();
  }

  function sync() {
    for (const id of [...panes.keys()]) {
      if (!tabs.list.some((t) => t.id === id)) { const p = panes.get(id); clearPane(p); p.el.remove(); panes.delete(id); }
    }
    for (const tab of tabs.list) show(tab);
    drawChrome();
    const hash = tabs.toHash();
    if (loc.hash !== hash) { try { hist.replaceState(null, '', hash); } catch { /* fine */ } }
  }

  tabs.onChange((what) => {
    if (what?.type === 'reload') { const p = panes.get(what.id); if (p) p.uri = undefined; }
    sync();
  });
  if (!tabs.fromHash(loc.hash)) sync();
  globalThis.addEventListener?.('hashchange', () => { if (loc.hash !== tabs.toHash()) tabs.fromHash(loc.hash); });
  return { tabs, openNew, say };
}
