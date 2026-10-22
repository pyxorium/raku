// Raku's page: the tab strip, the address bar, and one pane per tab (a running tile, or the first screen).
//
// A tile opens in four steps, each shown in the tab:
//   1. find it (handle → account → its record), and check it isn't hidden (moderation.js);
//   2. read its size from the record: open, ask first ("Open anyway?") or refuse (config.js LIMITS);
//   3. start it through the tile loading server (a new frame, a fresh random name, a new worker);
//   4. watch it: "Still loading…" after 4 s, Try again after 8 s (as Daisy's frames.js and the blog's
//      web-tile-mount.js). Nothing restarts on its own.
// Background tabs keep running (decision 9): their panes are only moved out of sight.
// A tab can also show your shelf or an account's tiles (stage 2, src/shelf-pages.js), and a star at the
// end of the address box keeps the tile or account shown (shelf-store.js).
// Stage 4: the account menu in the top bar (account-menu.js) and saving at the tables (tables/saving.js).
// Stage 6: Discover (discover.js), a button beside the Shelf's; words typed in the address box search; a post's
// address opens through the link message (link-message.js), outside Raku.

import { Tile } from '@dasl/tile-loader';
import { SITE, LIMITS, TIMES, PICKS, TAKEDOWNS_PAGE, TILE_POPUPS, TABLES, tableForTile } from './config.js';
import { parseAddress, parseTarget, atUri, SHELF_URI, tableUri, DISCOVER_URI, discoverUri } from './address.js';
import { createTabs, current } from './tabs.js';
import { describeTile, sizeVerdict, createPathLoader, blobCidOf } from './tiles.js';
import { formatBytes, NetError } from './net.js';
import { sniffPicture } from './moderation.js';
import { icon, ICON_WITH_PIP } from './icons.js';
import { h, createCardKit, bannerCid } from './cards.js';
import { drawYourShelf, drawAccountTiles, drawShelfTeaser } from './shelf-pages.js';
import { attachTypeahead } from './typeahead.js';
import { drawTable, createPanel } from './tables/table-page.js';
import { createPinnedLoader } from './tables/pinned.js';
import { createAccountMenu } from './account-menu.js';
import { createLinkMessage } from './link-message.js';
import { createDiscover, drawDiscover } from './discover.js';
import { groupThreads } from './posts.js';

export function mountRaku(root, { mothership, resolver, moderation, files, shelf, auth, storage = null, returned = null, keepForReturn = () => {}, loc = globalThis.location, hist = globalThis.history, tableDeps = {} }) {
  const kit = createCardKit({ files });
  // Discover (stage 6): what it keeps while Raku is open, shared by every Discover tab.
  const discover = createDiscover({ resolver, moderation, shelf, storage, loc });
  // Tables (stage 3): their tiles load through Raku's one mothership, but only the pinned versions.
  mothership.addLoader(createPinnedLoader({ Tile, pins: Object.values(TABLES).flatMap((t) => [t.house, t.player]), resolver }));
  const tabs = createTabs();
  const panes = new Map();          // tab id -> pane state
  const largeOk = new Set();        // tiles the visitor said "Open anyway" to, this visit
  let notice = null;

  // ---------- the frame of the page ----------
  const brand = h('span', { class: 'brand' }, SITE.name, SITE.lab ? h('span', { class: 'lab' }, ' (lab)') : null);
  const strip = h('div', { class: 'tabstrip', role: 'tablist', 'aria-label': 'Open tabs' });
  const newTabBtn = h('button', { class: 'newtab', type: 'button', title: 'New tab', 'aria-label': 'New tab', onclick: () => openNew() }, icon('plus', 18));
  const backBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Back', 'aria-label': 'Back', onclick: () => tabs.back(tabs.active.id) }, icon('back', 18));
  const fwdBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Forward', 'aria-label': 'Forward', onclick: () => tabs.forward(tabs.active.id) }, icon('forward', 18));
  const reloadBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Reload this tile', 'aria-label': 'Reload this tile', onclick: () => reload(tabs.active.id) }, icon('reload', 18));
  const input = h('input', {
    class: 'addr', type: 'text', name: 'address', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': "A tile's address, someone's handle, or words to search for", placeholder: "Paste a tile's address, type a handle, or search tiles",
  });
  input.addEventListener('focus', () => input.select());
  // The star (decision Q30): keeps the tile or the account this tab shows; filled turquoise when kept.
  const starBtn = h('button', { class: 'star-btn', type: 'button', hidden: true, onclick: () => toggleKeep() });
  const form = h('form', { class: 'addr-form', role: 'search', onsubmit: (ev) => { ev.preventDefault(); submitAddress(); } }, input, starBtn);
  // Handle suggestions under the box (typeahead.js): choosing one opens that account's tiles.
  attachTypeahead(input, form, { onChoose: (handle) => { input.value = handle; submitAddress(); } });
  const shelfBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Your shelf', 'aria-label': 'Your shelf', onclick: () => goShelf() }, icon('shelf', 18));
  const discoverBtn = h('button', { class: 'nav-btn', type: 'button', title: 'Discover', 'aria-label': 'Discover', onclick: () => goDiscover() }, icon('compass', 18));
  // On a phone (decision, Oct 19: option A) the address gets the whole top row, and these four go in a
  // toolbar along the bottom, each a full thumb-size target. On a computer the toolbar is hidden.
  const toolBtn = (label, title, onclick) => h('button', { class: 'tool-btn', type: 'button', title, 'aria-label': title, onclick }, label);
  const backTool = toolBtn(icon('back'), 'Back', () => tabs.back(tabs.active.id));
  const fwdTool = toolBtn(icon('forward'), 'Forward', () => tabs.forward(tabs.active.id));
  const reloadTool = toolBtn(icon('reload'), 'Reload this tile', () => reload(tabs.active.id));
  const shelfTool = toolBtn(icon('shelf'), 'Your shelf', () => goShelf());
  const discoverTool = toolBtn(icon('compass'), 'Discover', () => goDiscover());
  const countBtn = h('button', { class: 'count', type: 'button', title: 'Open tabs', 'aria-label': 'Show open tabs', onclick: () => toggleSheet(true) }, h('span', {}, '1'));
  const toolbar = h('nav', { class: 'toolbar', 'aria-label': 'Browsing' }, backTool, fwdTool, reloadTool, shelfTool, discoverTool, countBtn);
  const noteLine = h('div', { class: 'note', role: 'status', 'aria-live': 'polite', hidden: true });
  // "Sign in in this tab instead" (Q41): what to pick up afterwards, with the open tabs.
  const keep = (info) => keepForReturn({ ...info, hash: tabs.toHash() });
  const menu = createAccountMenu({ auth, moderation, keepForReturn: keep, say: (t) => say(t) });
  let pendingReturn = returned && returned.pending ? returned.pending : null;
  const stage = h('main', { class: 'stage' });
  const sheetList = h('ul', { class: 'sheet-list' });
  const sheet = h('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-label': 'Open tabs' },
    h('div', { class: 'sheet-head' },
      h('span', {}, 'Open tabs'),
      h('button', { type: 'button', class: 'sheet-new', onclick: () => { toggleSheet(false); openNew(); } }, icon('plus', 16), 'New tab'),
      h('button', { type: 'button', class: 'sheet-done', onclick: () => toggleSheet(false) }, 'Done')),
    sheetList);

  root.replaceChildren(
    h('header', { class: 'chrome' },
      h('div', { class: 'strip-row' }, brand, strip, newTabBtn),
      h('div', { class: 'bar' }, h('span', { class: 'brand brand-small' }, SITE.name),
        h('div', { class: 'nav' }, backBtn, fwdBtn, reloadBtn, shelfBtn, discoverBtn), form, menu.button),
      noteLine, menu.panel),
    stage, toolbar, sheet);
  // Links out of Raku (a post, a link in a post): Raku says where they go and opens them on a click.
  const linkMessage = createLinkMessage(root, { storage });

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
    // An emptied address box on a search page leaves search (Q99): back to Discover, without "Search results".
    if (!input.value.trim() && String(current(tabs.active) || '').startsWith('raku:search/')) {
      discover.lastQuery = null;
      input.blur();
      tabs.go(tabs.active.id, DISCOVER_URI);
      return;
    }
    const r = parseTarget(input.value);
    if (!r.ok) { say(r.reason); return; }
    say('');
    input.blur();               // first, so the box shows the tab's own address afterwards (a table's, say)
    // A post opens outside Raku for now (stage 6, Q87/Q88), in the app chosen for posts, after the link message.
    if (r.kind === 'post') { linkMessage.show({ post: { actor: r.actor, rkey: r.rkey }, from: 'A post address you typed. Raku shows tiles, so posts open in their app.' }); return; }
    tabs.go(tabs.active.id, r.uri);
  }

  // The Discover button: like the Shelf button. A tab already on Discover comes to the front; else this tab if it
  // shows a first screen or one of Raku's pages; else a new tab (a running tile stays open).
  const onDiscover = (uri) => !!uri && (uri === DISCOVER_URI || uri.startsWith(`${DISCOVER_URI}/`) || uri.startsWith('raku:search/'));
  function goDiscover() {
    const open = tabs.list.find((t) => onDiscover(current(t)));
    if (open) { tabs.activate(open.id); return; }
    const here = current(tabs.active);
    if (!here || here.startsWith('raku:')) tabs.go(tabs.active.id, DISCOVER_URI);
    else openNew(DISCOVER_URI);
  }

  // The Shelf button: your shelf comes to the front. If a tab already shows it, that tab; if this tab
  // shows a first screen or a shelf page, here; otherwise a new tab (so a running tile isn't closed).
  function goShelf() {
    const open = tabs.list.find((t) => current(t) === SHELF_URI);
    if (open) { tabs.activate(open.id); return; }
    const here = current(tabs.active);
    if (!here || here.startsWith('raku:')) tabs.go(tabs.active.id, SHELF_URI);
    else openNew(SHELF_URI);
  }

  function toggleKeep() {
    const k = paneFor(tabs.active).keep;
    if (!k) return;
    if (k.kind === 'tile') {
      if (shelf.hasTile(k.did, k.rkey)) { shelf.removeTile(k.did, k.rkey); say('Removed from your shelf.'); }
      else if (shelf.keepTile(k)) say(shelf.saved ? 'Kept on your shelf.' : "Kept on your shelf for this visit (this browser isn't saving it).");
      else say('Your shelf is full.');
    } else {
      if (shelf.hasAccount(k.did)) { shelf.removeAccount(k.did); say('Removed from your shelf.'); }
      else if (shelf.keepAccount(k)) say(shelf.saved ? 'Account kept on your shelf.' : "Account kept for this visit (this browser isn't saving it).");
      else say('Your shelf is full.');
    }
    drawChrome();
  }

  function toggleSheet(open) { sheet.hidden = !open; if (open) drawSheet(); }

  // ---------- one pane per tab ----------
  function paneFor(tab) {
    let p = panes.get(tab.id);
    if (!p) {
      const el = h('section', { class: 'pane', 'data-tab': tab.id });
      p = { el, uri: undefined, attempt: 0, timers: [], frame: null, title: 'New tab', icon: null, shownAddress: '', state: 'new', keep: null, dispose: null, panel: null, table: null, mark: null };
      panes.set(tab.id, p);
      // Step 5b-2: a page can put a quiet mark on its tab (Daisy's lounge: someone arrived while it was behind).
      const pane = p;
      el.addEventListener('raku:mark', (e) => { pane.mark = e.detail || null; drawChrome(); });
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
    if (p.dispose) { try { p.dispose(); } catch { /* fine */ } p.dispose = null; }
    p.keep = null;
    p.panel = null;
    p.table = null;
    p.mark = null;
    p.el.replaceChildren();
  }

  function show(tab) {
    const p = paneFor(tab);
    const uri = current(tab);
    if (p.uri === uri) return;
    p.uri = uri;
    clearPane(p);
    if (!uri) { p.title = 'New tab'; p.shownAddress = ''; p.state = 'new'; drawFirstScreen(p, tab); return; }
    const target = parseTarget(uri);
    if (target.ok && target.kind === 'shelf') { drawYourShelf(pageContext(p, tab)); drawChrome(); return; }
    if (target.ok && target.kind === 'account') { drawAccountTiles(pageContext(p, tab), target.actor); return; }
    if (target.ok && target.kind === 'table') { openTable(p, tab, target.id, target.sub); return; }
    if (target.ok && target.kind === 'discover') { drawDiscover(pageContext(p, tab), { source: target.source }); return; }
    if (target.ok && target.kind === 'search') { drawDiscover(pageContext(p, tab), { source: 'search', query: target.query }); return; }
    openTile(p, tab, uri);
  }

  // A table (stage 3): the game's driver on the shared table core (src/tables/). Daisy's addresses can name
  // a screen (stage 5): raku:table/daisy/bot, or one table across two computers, raku:table/daisy/<id>.
  function openTable(p, tab, id, sub = null) {
    const table = TABLES[id];
    p.title = table ? table.name : 'No such table';
    p.shownAddress = tableUri(id, sub);
    p.state = 'ready';
    if (!table) { p.state = 'error'; status(p, 'error', `Raku has no table called "${id}". The tables are on the first screen.`); drawChrome(); return; }
    const [did, , rkey] = table.player.uri.replace(/^at:\/\//, '').split('/');
    p.keep = { kind: 'tile', did, rkey, name: table.name, by: '' };
    // Back from "Sign in in this tab instead" at this table: hand over the match kept for the trip.
    const pending = pendingReturn && pendingReturn.table === id ? pendingReturn : null;
    if (pending) pendingReturn = null;
    const t = drawTable({ p, mothership, resolver, auth, keepForReturn: keep, pending, say, go: (uri) => tabs.go(tab.id, uri), ...tableDeps }, id, sub);
    if (!t) { p.state = 'error'; status(p, 'error', `Raku doesn't know that ${table.name} address.`, button(`Open ${table.name}`, () => tabs.go(tab.id, tableUri(id)))); drawChrome(); return; }
    p.dispose = t.dispose;
    p.table = t;
    drawChrome();
  }

  // What the shelf pages need from the page.
  function pageContext(p, tab) {
    const mine = p.attempt;
    return {
      p, tab, kit, shelf, tabs, resolver, moderation, openNew, say, drawChrome, discover, linkMessage,
      alive: () => mine === p.attempt,
      status: (kind, text, ...actions) => status(p, kind, text, ...actions),
      hideStatus: () => hideStatus(p),
    };
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
    const keep = { kind: 'tile', did, rkey: parsed.rkey, name: d.name, by: '' };
    p.keep = keep;
    drawChrome();
    const didForm = p.shownAddress;
    resolver.checkedHandle(did).then((handle) => {
      // (the tile may have started meanwhile, so check the address rather than the attempt)
      if (handle && p.uri === uri && p.shownAddress === didForm) { p.shownAddress = atUri(handle, parsed.rkey); keep.by = handle; drawChrome(); }
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
    const keep = p.keep;
    clearPane(p);
    p.keep = keep;
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
    // What this tile asks of Raku (decision 12): a small Messages button appears with its first message.
    p.panel = createPanel({ label: `What "${d.name}" asks of Raku` });
    p.panel.button.classList.add('panel-pill');
    p.panel.button.hidden = true;
    p.el.append(p.panel.el, p.panel.button);
    // One of a table's own tiles, opened on its own: say so, and offer the table (decision Q34).
    const table = keep && tableForTile(keep.did, keep.rkey);
    if (table) {
      const hint = h('div', { class: 'table-hint' }, h('span', {}, 'This tile is part of a table.'),
        h('button', { type: 'button', class: 'primary', onclick: () => tabs.go(tab.id, tableUri(table.id)) }, `Play ${table.name}`),
        h('button', { type: 'button', class: 'table-hint-x', 'aria-label': 'Hide this note', onclick: () => hint.remove() }, icon('close', 14)));
      p.el.append(hint);
    }
  }

  // Messages from ordinary tiles (tiles-protocol-up-…): logged on their tab's panel. Raku doesn't answer
  // any protocol yet; the panel just shows what was asked.
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    for (const pane of panes.values()) {
      if (!pane.frame || pane.frame.contentWindow !== e.source || !pane.panel) continue;
      const what = d.action.slice('tiles-protocol-up-'.length);
      const kind = d.payload && typeof d.payload === 'object' && typeof d.payload.kind === 'string' ? `${what} · ${d.payload.kind}` : what;
      pane.panel.log({ dir: 'page', from: 'tile', to: 'Raku', kind: kind.slice(0, 80), note: "Raku doesn't answer this yet" });
      pane.panel.button.hidden = false;
      return;
    }
  });

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
    const grid = h('div', { class: 'cards picks' });
    const box = h('div', { class: 'first' },
      h('h1', {}, SITE.name, SITE.lab ? h('span', { class: 'lab' }, ' (lab)') : null),
      h('p', { class: 'lede' }, 'A browser for web tiles: small pages people publish to their own atproto accounts. Paste a tile\'s address or someone\'s handle above, or start with one of these.'),
      grid);
    p.el.append(box);
    for (const uri of PICKS) grid.append(pickCard(uri, tab));
    box.append(h('div', { class: 'first-discover' },
      h('button', { type: 'button', class: 'more', onclick: () => goDiscover() }, icon('compass', 16), 'Discover more tiles'),
      h('span', { class: 'small-lede' }, 'Search, and new tiles from the accounts you keep.')));
    drawNewsRow(p, tab, box);
    const tables = h('div', { class: 'cards tables' });
    box.append(h('h2', {}, 'Tables'), h('p', { class: 'small-lede' }, 'Groups of tiles that play together. Play the bot with no sign-in; sign in to save your matches, or to play Daisy with a friend on another computer.'), tables);
    for (const t of Object.values(TABLES)) tables.append(tableCard(t, tab));
    drawShelfTeaser(pageContext(p, tab), box);
    box.append(h('p', { class: 'small' }, 'Tiles run in their own sealed frames, loaded from their authors\' own accounts. Raku has no sign-in for browsing.'));
  }

  // The first screen's Tile news row (step 6b, Q85): the latest three posts from the Web Tiles feed, each opening
  // Tile news on Discover; More does too. Hidden when the feed can't be read or is empty.
  function drawNewsRow(p, tab, box) {
    if (!discover.feed) return;
    const mine = p.attempt;
    const list = h('div', { class: 'news-row' });
    const part = h('section', { class: 'first-news', hidden: true },
      h('div', { class: 'first-news-head' }, h('h2', {}, 'Tile news'),
        h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, discoverUri('news')) }, 'More')),
      list);
    box.append(part);
    discover.news().then((r) => {
      if (mine !== p.attempt || !r.items.length) return;
      // one item per thread, as on Discover (Q123)
      for (const it of groupThreads(r.items).added.slice(0, 3).map((g) => g.item)) {
        const a = it.post.author;
        const reply = !!(it.context || it.post.replyTo);
        list.append(h('button', { type: 'button', class: 'news-item', onclick: () => tabs.go(tab.id, discoverUri('news')) },
          h('span', { class: 'news-av' }, a.avatar ? h('img', { src: a.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null),
          h('span', { class: 'news-words' },
            h('span', { class: 'news-who' }, a.displayName || (a.handle ? `@${a.handle}` : 'Someone'),
              reply ? h('span', { class: 'news-reply' }, 'reply') : null),
            h('span', { class: 'news-text' }, (it.post.text || '').split('\n')[0].slice(0, 140) || (it.post.tile ? 'A web tile' : 'A post')))));
      }
      part.hidden = false;
    }).catch(() => { /* no row: the feed couldn't be read just now */ });
  }

  function tableCard(t, tab) {
    const card = kit.tileCard({ name: t.name, description: t.blurb, onOpen: () => tabs.go(tab.id, tableUri(t.id)), onOpenNew: () => openNew(tableUri(t.id)) });
    (async () => {
      const [did, , rkey] = t.player.uri.replace(/^at:\/\//, '').split('/');
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (d.ok) card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
    })().catch(() => { /* the card stays without a picture */ });
    return card.el;
  }

  function pickCard(uri, tab) {
    const parsed = parseAddress(uri);
    const pickTable = parsed.ok && parsed.actor.startsWith('did:') ? tableForTile(parsed.actor, parsed.rkey) : null;
    const target = pickTable ? tableUri(pickTable.id) : uri;
    const card = kit.tileCard({ name: '…', onOpen: () => tabs.go(tab.id, target), onOpenNew: () => openNew(target) });
    (async () => {
      if (!parsed.ok) throw new Error('bad pick');
      const did = await resolver.didFor(parsed.actor);
      if (await moderation.isHidden(did, parsed.rkey)) { card.el.remove(); return; }
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, parsed.rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (!d.ok) throw new Error(d.reason);
      card.set({ name: d.name, description: d.description });
      card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
      resolver.checkedHandle(did).then((hd) => card.set({ by: hd || '' }));
    })().catch(() => card.set({ name: "Couldn't load this pick", greyed: true }));
    return card.el;
  }

  // ---------- drawing the chrome ----------
  function tabButton(tab) {
    const p = paneFor(tab);
    const on = tab.id === tabs.active.id;
    const mark = p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state });
    const close = h('span', { class: 'tab-x', role: 'button', 'aria-label': `Close ${p.title}`, title: 'Close tab',
      onclick: (ev) => { ev.stopPropagation(); tabs.close(tab.id); } }, icon('close', 14));
    const b = h('div', { class: `tab${on ? ' on' : ''}`, role: 'tab', tabindex: '0', 'aria-selected': on ? 'true' : 'false', title: p.title,
      onclick: () => tabs.activate(tab.id),
      onauxclick: (ev) => { if (ev.button === 1) tabs.close(tab.id); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tabs.activate(tab.id); } } },
    mark, h('span', { class: 'tab-title' }, p.title),
    p.mark ? h('span', { class: 'tab-signal', title: p.mark.title, 'aria-label': p.mark.title }, '●') : null, close);
    if (p.mark) { b.classList.add('signal'); b.title = `${p.title}: ${p.mark.title}`; }
    return b;
  }

  function drawSheet() {
    sheetList.replaceChildren(...tabs.list.map((tab) => {
      const p = paneFor(tab);
      const on = tab.id === tabs.active.id;
      return h('li', { class: on ? 'on' : '' },
        h('button', { type: 'button', class: 'sheet-tab', onclick: () => { tabs.activate(tab.id); toggleSheet(false); } },
          p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state }),
          h('span', { class: 'tab-title' }, p.title),
          p.mark ? h('span', { class: 'tab-signal', title: p.mark.title, 'aria-label': p.mark.title }, '●') : null),
        h('button', { type: 'button', class: 'sheet-x', 'aria-label': `Close ${p.title}`, onclick: () => { tabs.close(tab.id); drawSheet(); } }, icon('close', 18)));
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
    const k = p.keep;
    starBtn.hidden = !k;
    if (k) {
      const kept = k.kind === 'tile' ? shelf.hasTile(k.did, k.rkey) : shelf.hasAccount(k.did);
      const what = k.kind === 'tile' ? 'this tile' : 'this account';
      starBtn.replaceChildren(icon(kept ? 'star-filled' : 'star', 18));
      starBtn.classList.toggle('kept', kept);
      starBtn.setAttribute('aria-pressed', kept ? 'true' : 'false');
      starBtn.title = kept ? `Remove ${what} from your shelf` : `Keep ${what} on your shelf`;
      starBtn.setAttribute('aria-label', starBtn.title);
    }
    const onShelf = current(tab) === SHELF_URI;
    shelfBtn.classList.toggle('on', onShelf);
    shelfTool.classList.toggle('on', onShelf);
    const onDisc = onDiscover(current(tab));
    discoverBtn.classList.toggle('on', onDisc);
    discoverTool.classList.toggle('on', onDisc);
    newTabBtn.disabled = tabs.full;
    countBtn.firstChild.textContent = String(tabs.list.length);
    // A pane coming to the front or going behind tells its page (step 5b: Daisy's lounge counts you as "here"
    // only while its tab is in front).
    for (const [id, pane] of panes) {
      const on = id === tab.id;
      if (pane.el.classList.contains('front') !== on) { pane.el.classList.toggle('front', on); pane.el.dispatchEvent(new CustomEvent('raku:front', { detail: on })); }
    }
    document.title = current(tab) ? `${p.title} · ${SITE.name}${SITE.lab ? ' (lab)' : ''}` : `${SITE.name}${SITE.lab ? ' (lab)' : ''}`;
    if (!sheet.hidden) drawSheet();
    drawIcon();
  }

  // Raku's browser icon: a turquoise pip while any tab has a quiet mark (step 5b-2, owner: the pip only, no
  // change to the title).
  let iconMarked = null;
  function drawIcon() {
    const marked = [...panes.values()].some((x) => x.mark);
    countBtn.classList.toggle('signal', marked);                 // on a phone: the tab count shows it too
    if (marked === iconMarked) return;
    iconMarked = marked;
    const link = document.querySelector('link[rel="icon"]');
    if (link) link.href = marked ? ICON_WITH_PIP : '/icon.svg';
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
  // When the shelf changes (the star, Import, another Raku tab), redraw the panes that show it, except
  // the one whose own card made the change (it already updated itself).
  shelf.onChange(({ source }) => {
    for (const tab of tabs.list) {
      const p = panes.get(tab.id);
      const uri = current(tab);
      if (!p || !(uri === SHELF_URI || uri === null)) continue;
      if (source === 'card' && tab.id === tabs.active.id) continue;
      p.uri = undefined;
      show(tab);
    }
    drawChrome();
  });
  if (!tabs.fromHash(loc.hash)) sync();
  if (returned) say(returned.did && auth.current() ? `Signed in as @${auth.current().handle}.` : "Sign-in didn't finish. Try again.");
  globalThis.addEventListener?.('hashchange', () => { if (loc.hash !== tabs.toHash()) tabs.fromHash(loc.hash); });
  // (for the checks and curious eyes: the table in the front tab, if any)
  return { tabs, openNew, say, menu, get table() { return paneFor(tabs.active).table; } };
}
