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
// Rooms (rooms step 1, room-tab.js): a room is a tab (raku:room). While you're in a room, its tab stays a room:
// an address typed there opens in a new tab, and Back, Forward and Reload say to leave the room first.
// Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10): a record that isn't a tile, of a kind with a pinned
// renderer (config.js RENDERERS: places), opens in a tab: Raku reads the record, runs the renderer tile, hands it the
// record over the tiles spec's data protocol (renderers.js), opens what it asks for in a new tab (at:// only), and puts
// "Open in ▾" (PDSls, Taproot) beside the address box. Other records still open the link message.
// Ways (claude/raku-ways-plan.md, RW1 to RW8): Raku is a host for tiles with ways (a /ways.json: the maze, Winter
// Forest). It answers a tile's hello with which of its exits lead somewhere; when someone steps through one, Raku reads
// that exit's signpost and takes them on in the same tab (the tab's address becomes the way taken, raku:way/…), with a
// screen between places showing where they're going, "Pick a door" when a way leads to several places, and Back along
// the trail landing at the portal they left by. The rules are in ways.js.
// Play here and round C (claude/raku-play-here-plan.md, claude/raku-expand-plan.md): a tile post's tile runs in its post
// on Discover (playInPost), can be expanded to Raku's window (discover.js, expand-view.js), and travels by its ways
// inside the post, with a trail for "Back to …" (leavePost, travelTo, backInPost).

import { Tile } from '@dasl/tile-loader';
import { SITE, LIMITS, TIMES, PICKS, TAKEDOWNS_PAGE, TILE_POPUPS, TABLES, ROOMS, tableForTile, isRoomHouse, appmosphereCopy,
  rendererFor, pinnedRenderers, RENDER, RECORD_APPS, RECORD_APP_KEY, recordApp, explorerLink, WAYS, KEYS_AFTER_MS, PLAY_HERE } from './config.js';
import { bakedPick, bakedPictureUrl } from './picks.js';
import { parseAddress, parseTarget, atUri, SHELF_URI, ABOUT_URI, ROOM_URI, roomInHash, tableUri, DISCOVER_URI, discoverUri, wayUri, WAY_PREFIX } from './address.js';
import { createTabs, current, stateAt } from './tabs.js';
import { WAY_UP, readWays, entranceFor, readWayMessage, statusMessage, arriveMessage, testSignposts, createWayReader, chosenDoor, keepDoor,
  signpostGoTo, parseAtUri } from './ways.js';
import { describeTile, sizeVerdict, createPathLoader, blobCidOf } from './tiles.js';
import { formatBytes, NetError } from './net.js';
import { sniffPicture } from './moderation.js';
import { icon, ICON_WITH_PIP, brandPot, refreshBrandPots } from './icons.js';
import { createLookSetting } from './look.js';
import { h, createCardKit, bannerCid } from './cards.js';
import { drawYourShelf, drawAccountTiles, drawShelfTeaser } from './shelf-pages.js';
import { attachTypeahead } from './typeahead.js';
import { drawTable, createPanel } from './tables/table-page.js';
import { createPinnedLoader, TileChanged } from './tables/pinned.js';
import { READY, UP, DOWN, recordPayload, recordTitle, readOpenRequest, openDecision, createOpenGate, readGetRequest, getTarget, createGetBudget, readPictureRequest, pictureSource, PICTURE_TYPES } from './renderers.js';
import { createAccountMenu } from './account-menu.js';
import { createLinkMessage } from './link-message.js';
import { createDiscover, drawDiscover, drawTilePostPage } from './discover.js';
import { createPostBox } from './post-box.js';
import { createHearts } from './hearts.js';
import { createHeartSignIn } from './heart-signin.js';
import { canPostTile } from './tile-post-write.js';
import { drawAbout } from './about-page.js';
import { groupThreads } from './posts.js';
import { createRooms } from './room-tab.js';
import { setLeaveWarning } from './signin-ui.js';
import { isInstalled } from './app-shell.js';
import { playVerdict, createOneAtATime, wayPlan, createTrail, tabFor, createAutoplaySetting } from './play-here.js';
import { createPrefetcher } from './prefetch.js';

export function mountRaku(root, { mothership, resolver, moderation, files, shelf, auth, storage = null, session = null, returned = null, keepForReturn = () => {}, loc = globalThis.location, hist = globalThis.history, tableDeps = {}, install = null }) {
  // Preparing a tile while its card shows (claude/raku-prepare-tiles-plan.md): the early downloads (prefetch.js), asked
  // for by the cards (cards.js prepareCard) and by the Places renderer's { get } (answerGet).
  const prefetch = createPrefetcher({ files, resolver, moderation });
  const kit = createCardKit({ files, prefetch });
  // Discover (stage 6): what it keeps while Raku is open, shared by every Discover tab.
  const discover = createDiscover({ resolver, moderation, shelf, storage, loc });
  // Tables (stage 3): their tiles load through Raku's one mothership, but only the pinned versions.
  // Renderer tiles too (RT2): the same pinned loading, for the renderers on Raku's list.
  mothership.addLoader(createPinnedLoader({ Tile, pins: [...Object.values(TABLES).flatMap((t) => [t.house, t.player]), ...pinnedRenderers()], resolver }));
  const tabs = createTabs();
  // Ways (RW8): on this computer, ?sign=… in Raku's address can fill a signpost for testing; the live Raku ignores it.
  const wayOverrides = testSignposts(loc);
  const ways = createWayReader({ resolver, moderation, overrides: wayOverrides });
  const panes = new Map();          // tab id -> pane state
  const largeOk = new Set();        // tiles the visitor said "Open anyway" to, this visit
  let notice = null;

  // ---------- the frame of the page ----------
  // The pot beside the Raku label (stage 9, S8: everywhere the label shows). In the installed window with the
  // tabs in the title bar, the pot and the label are a handle for moving the window. Its picture is drawn in the
  // named --pot-… colours (light-mode groundwork, claude/raku-light-mode-plan.md).
  const pot = () => brandPot();
  const brand = h('span', { class: 'brand' }, pot(), SITE.name, SITE.lab ? h('span', { class: 'lab' }, ' (lab)') : null);
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
  // "Open in ▾" (renderer tiles, RT3): on a tab showing a record through its renderer, the record in an explorer (PDSls,
  // Taproot), the same list and the same remembered choice as the link message's (config.js RECORD_APPS, RECORD_APP_KEY).
  const openInBtn = h('button', { class: 'openin-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    title: 'Open this record in an explorer', onclick: () => toggleOpenIn() }, 'Open in', h('span', { class: 'openin-caret', 'aria-hidden': 'true' }, '▾'));
  const openInMenu = h('div', { class: 'openin-menu', role: 'menu', 'aria-label': 'Open this record in', hidden: true });
  const openIn = h('span', { class: 'openin', hidden: true }, openInBtn, openInMenu);
  // Post (claude/raku-write-posts-plan.md, WP8 A): on a tile's tab, beside the address box, only when the tile belongs to
  // one of the accounts signed in on this browser (WP1); it opens the post box (post-box.js). On a phone, the icon alone.
  const postBtn = h('button', { class: 'post-btn', type: 'button', hidden: true, title: 'Post this tile to Tile posts', 'aria-label': 'Post this tile to Tile posts',
    onclick: () => { const k = paneFor(tabs.active).keep; if (k && k.kind === 'tile') postBox.openForTile({ did: k.did, rkey: k.rkey }); } },
  icon('posts', 16), h('span', { class: 'lbl' }, 'Post'));
  // Ways (RW8): a quiet mark while some signposts come from the address (this computer only).
  const testMark = h('span', { class: 'testmark', hidden: !wayOverrides.size, title: 'This computer only: some signposts come from the address (?sign=…)' }, 'test signposts');
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
  // Stage 9 (S2): a new version of Raku is out. Only a note: the person chooses when to reload, so a game, a
  // tile or a call is never cut off. It stays until Reload or ×; × hides it for that version (a newer one shows again).
  let updateDismissed = null;
  const updateText = h('span', { class: 'update-text' }, 'A new version of Raku is ready. Your tabs come back after a reload, but tiles and games that are running start over.');
  const updateLine = h('div', { class: 'update-line', role: 'status', 'aria-live': 'polite', hidden: true },
    updateText,
    h('span', { class: 'update-actions' },
      h('button', { type: 'button', class: 'update-reload', onclick: () => loc.reload() }, 'Reload'),
      h('button', { type: 'button', class: 'update-close', 'aria-label': 'Hide this note', title: 'Hide this note', onclick: () => { updateLine.hidden = true; updateDismissed = updateLine.dataset.build || null; } }, icon('close', 14))));
  function showUpdate(build) {
    if (build && build === updateDismissed) return;
    updateLine.dataset.build = build || '';
    updateLine.hidden = false;
  }
  // "Sign in in this tab instead" (Q41): what to pick up afterwards, with the open tabs.
  const keep = (info) => keepForReturn({ ...info, hash: tabs.toHash() });
  // Autoplay (AU1, AU5): one choice for this browser, shown in the account menu and Tile posts' header.
  const autoplay = createAutoplaySetting({ storage });
  // The look (claude/raku-light-mode-plan.md): Match device / Light / Dark and the light style, in the account menu;
  // public/look.js put the saved choice on the page before the first paint, this keeps it (and follows the device).
  const look = createLookSetting({ storage, doc: root.ownerDocument });
  const menu = createAccountMenu({ auth, moderation, keepForReturn: keep, say: (t) => say(t), onAbout: () => goAbout(), install, autoplay, look });
  let pendingReturn = returned && returned.pending ? returned.pending : null;
  const stage = h('main', { class: 'stage' });
  const sheetList = h('ul', { class: 'sheet-list' });
  // Rooms step 4 (RR24, RR29): the call bar's place: under the address row on a computer, just above the toolbar on a
  // phone (style.css). The room tab in a call puts its bar here; it shows while another tab is in front.
  const callSlot = h('div', { class: 'call-slot' });
  const sheet = h('div', { class: 'sheet', hidden: true, role: 'dialog', 'aria-label': 'Open tabs' },
    h('div', { class: 'sheet-head' },
      h('span', {}, 'Open tabs'),
      h('button', { type: 'button', class: 'sheet-new', onclick: () => { toggleSheet(false); openNew(); } }, icon('plus', 16), 'New tab'),
      h('button', { type: 'button', class: 'sheet-done', onclick: () => toggleSheet(false) }, 'Done')),
    sheetList);

  root.replaceChildren(
    h('header', { class: 'chrome' },
      // Stage 9 (S7): in an installed window with its title bar folded away, this row is the title bar. The window
      // moves by the Raku label, the free space beside the tabs and this grip, which tabs never cover.
      h('div', { class: 'strip-row' }, brand, strip, newTabBtn, h('span', { class: 'wco-grip', 'aria-hidden': 'true' })),
      h('div', { class: 'bar' }, h('span', { class: 'brand brand-small' }, pot(), SITE.name),
        h('div', { class: 'nav' }, backBtn, fwdBtn, reloadBtn, shelfBtn, discoverBtn), form, postBtn, openIn, testMark, menu.button),
      updateLine, noteLine, menu.panel),
    callSlot, stage, toolbar, sheet);
  // The bowls are drawn before they're in the page: now in place, each takes its own colours (Smoke and clay's dark bar).
  refreshBrandPots(root.ownerDocument);
  // Links out of Raku (a post, a link in a post): Raku says where they go and opens them on a click.
  const linkMessage = createLinkMessage(root, { storage });
  // Writing tile posts (claude/raku-write-posts-plan.md): the post box over the stage. "See it in Tile posts" opens Tile
  // posts in a new tab, so a tile you posted from keeps running (WP10); from Tile posts itself, the page is drawn again.
  const POSTS_URI = discoverUri('posts');
  const postBox = createPostBox({
    auth, resolver, moderation, kit, tilePosts: discover.tilePosts, host: () => stage, say: (t) => say(t), keepForReturn: (info) => keep(info),
    onSeePosts: () => { if (current(tabs.active) === POSTS_URI) reload(tabs.active.id); else openNew(POSTS_URI); },
    onAfterPost: () => { if (current(tabs.active) === POSTS_URI) reload(tabs.active.id); },
  });
  // Hearts on tile posts (claude/raku-hearts-plan.md): counted Raku's own way, yours read from your own server; the two
  // panels a heart can open ("Sign in to heart", "Sign in again to heart").
  const hearts = createHearts({ resolver, moderation, auth });
  const heartSignIn = createHeartSignIn({ auth, host: () => stage, keepForReturn: (info) => keep(info) });
  // The Post button follows the accounts signed in here (signing in or out, another account added); so do the hearts
  // shown as yours (HT7: the current account's).
  auth.onChange(() => {
    drawChrome();
    const a = auth.current();
    if (a && a.did) hearts.readYours(a.did).catch(() => null);
    else hearts.redraw();
  });

  // Rooms (rooms step 1): at most one room in this window (RR6). A raku:page tab (not a room) or a first screen can
  // become the room tab; otherwise a new tab.
  // Raku's own pages: the first screen, raku:… (not the room), and a tile post's page (SL1, at its AT URI).
  const ownPage = (uri) => !uri || (uri.startsWith('raku:') && uri !== ROOM_URI) || parseTarget(uri).kind === 'tile-post';
  function openRoomTab() {
    if (ownPage(current(tabs.active))) rawGo(tabs.active.id, ROOM_URI);
    else openNew(ROOM_URI);
  }
  const rooms = createRooms({
    auth, mothership, resolver, session, storage, loc, tabs, stage, say: (t) => say(t),
    keepForReturn: (info) => keep(info), openRoomTab, closeTab: (id) => tabs.close(id),
    onExpand: () => showExpanded(),
    onCall: () => drawChrome(),
  });
  // Rooms step 3 (Expand, RR19 and RR20): while the room tab in front has its stage expanded, Raku hides its own rows
  // so the stage gets the room: in the installed window the address row (the tabs stay, in the title bar); on a phone
  // the top bar and the toolbar. A browser tab on a computer keeps Raku's top bar (its tabs live in it). Another tab in
  // front brings everything back.
  function showExpanded() {
    const html = root.ownerDocument?.documentElement;
    if (!html) return;
    const on = rooms.isExpanded(tabs.active.id);
    html.classList.toggle('room-expanded', on);
    html.classList.toggle('room-expanded-app', on && isInstalled(root.ownerDocument.defaultView || globalThis));
  }
  // Rooms step 4 (RR23 to RR32): the call bar of the room you're in, while another tab is in front (never with the room
  // itself in front: its own controls are there).
  function showCall() {
    const live = rooms.call;
    const bar = live ? live[1].bar : null;
    if (callSlot.firstChild && callSlot.firstChild !== bar?.el) { callSlot.replaceChildren(); }
    if (!bar) return;
    if (callSlot.firstChild !== bar.el) callSlot.append(bar.el);
    bar.show(live[0] !== tabs.active.id);
  }
  // "Sign in in this tab instead" while in a room would hang up: the sign-in's blocked-window box says so first.
  setLeaveWarning(() => (rooms.live ? 'This leaves your room: you can rejoin it afterwards.' : ''));
  // A room tab you're in stays a room (it would hang up otherwise): addresses open in a new tab; Back, Forward and
  // Reload ask you to leave the room first.
  const rawGo = tabs.go, rawBack = tabs.back, rawForward = tabs.forward;
  const inRoomHere = (id) => rooms.isLive(id);
  const leaveFirst = () => say('You’re in a room in this tab. Leave the room first, or use another tab.');
  tabs.go = (id, uri, state = null) => {
    if (inRoomHere(id) && uri !== ROOM_URI) { openNew(uri, state); return; }
    if (inRoomHere(id)) { tabs.activate(id); return; }
    rawGo(id, uri, state);
  };
  tabs.back = (id) => (inRoomHere(id) ? leaveFirst() : rawBack(id));
  tabs.forward = (id) => (inRoomHere(id) ? leaveFirst() : rawForward(id));
  // The Rooms card (and raku:room typed or kept on the shelf): a room tab comes to the front if there is one.
  function goRooms(tab, { inNew = false } = {}) {
    if (rooms.openRooms()) return;
    if (inNew) openNew(ROOM_URI); else tabs.go(tab.id, ROOM_URI);
  }

  function say(text) {
    clearTimeout(notice);
    noteLine.textContent = text || '';
    noteLine.hidden = !text;
    if (text) notice = setTimeout(() => { noteLine.hidden = true; }, 6000);
  }

  function openNew(uri = null, state = null) {
    const t = tabs.open(uri, { state });
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
    // The tab stays where it was, so the box goes back to the tab's own address (open links: it kept what was typed).
    if (r.kind === 'post') { tabAddress(); linkMessage.show({ post: { actor: r.actor, rkey: r.rkey }, from: 'A post address you typed. Raku shows tiles, so posts open in their app.' }); return; }
    // A record whose kind has a renderer (renderer tiles, RT2, RT8): in this tab, shown by the renderer.
    if (r.kind === 'record' && rendererFor(r.collection)) { tabs.go(tabs.active.id, r.uri); return; }
    // A record or collection that isn't tiles (open links, OL1/OL5): the link message with the explorers' menu.
    if (r.kind === 'record' || r.kind === 'collection') { tabAddress(); showRecord(r); return; }
    // An invite link (rooms step 1): the room's join screen, the code kept out of the address (RR2); one room at a
    // time (RR6). raku:room on its own: the room tab if there is one.
    if (r.kind === 'room-invite') { rooms.takeInvite({ room: r.room, hostKey: r.hostKey }); return; }
    if (r.kind === 'room' && !rooms.isRoomTab(tabs.active.id)) { goRooms(tabs.active); return; }
    tabs.go(tabs.active.id, r.uri);
  }

  function tabAddress() { input.value = paneFor(tabs.active).shownAddress || ''; }
  // The explorers (PDSls, Taproot) are given the account's DID (OL3): looked up for a handle, or the handle as typed
  // when the lookup fails. The tab stays where it was, as for a post.
  async function showRecord(r) {
    let did = r.actor;
    if (!did.startsWith('did:')) { try { did = await resolver.didFor(r.actor); } catch { did = r.actor; } }
    const uri = r.kind === 'record' ? `at://${did}/${r.collection}/${r.rkey}` : `at://${did}/${r.collection}`;
    const from = r.kind === 'record'
      ? `Raku doesn't show ${r.collection} records yet.`
      : `Raku doesn't show ${r.collection} records yet. This opens the list of them.`;
    linkMessage.show({ record: { uri }, from });
  }

  // The Discover button: like the Shelf button. A tab already on Discover comes to the front; else this tab if it
  // shows a first screen or one of Raku's pages; else a new tab (a running tile stays open).
  // The About page (Q134): an open About tab comes forward; else this tab if it shows one of Raku's own pages (so a
  // running tile stays open), else a new tab.
  function goAbout() {
    const open = tabs.list.find((t) => current(t) === ABOUT_URI);
    if (open) { tabs.activate(open.id); return; }
    const here = current(tabs.active);
    if (ownPage(here)) tabs.go(tabs.active.id, ABOUT_URI);
    else openNew(ABOUT_URI);
  }
  const onDiscover = (uri) => !!uri && (uri === DISCOVER_URI || uri.startsWith(`${DISCOVER_URI}/`) || uri.startsWith('raku:search/'));
  function goDiscover() {
    const open = tabs.list.find((t) => onDiscover(current(t)));
    if (open) { tabs.activate(open.id); return; }
    const here = current(tabs.active);
    if (ownPage(here)) tabs.go(tabs.active.id, DISCOVER_URI);
    else openNew(DISCOVER_URI);
  }

  // The Shelf button: your shelf comes to the front. If a tab already shows it, that tab; if this tab
  // shows a first screen or a shelf page, here; otherwise a new tab (so a running tile isn't closed).
  function goShelf() {
    const open = tabs.list.find((t) => current(t) === SHELF_URI);
    if (open) { tabs.activate(open.id); return; }
    const here = current(tabs.active);
    if (ownPage(here)) tabs.go(tabs.active.id, SHELF_URI);
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
      p = { el, uri: undefined, attempt: 0, timers: [], frame: null, title: 'New tab', icon: null, shownAddress: '', state: 'new', keep: null, dispose: null, panel: null, table: null, mark: null, record: null, renderer: null,
        ways: null, screen: null, arrival: null, freshWay: false, tripStarted: null };
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
    p.record = null;
    p.renderer = null;
    p.ways = null;
    if (p.screen?.url) URL.revokeObjectURL(p.screen.url);
    p.screen = null;
    p.arrival = null;
    p.el.replaceChildren();
  }

  function show(tab) {
    const p = paneFor(tab);
    const uri = current(tab);
    if (p.uri === uri) return;
    p.uri = uri;
    clearPane(p);
    const arrival = arrivalFor(tab);
    if (!uri) { p.title = 'New tab'; p.shownAddress = ''; p.state = 'new'; drawFirstScreen(p, tab); return; }
    const target = parseTarget(uri);
    if (target.ok && target.kind === 'shelf') { drawYourShelf(pageContext(p, tab)); drawChrome(); return; }
    if (target.ok && target.kind === 'about') { drawAbout(pageContext(p, tab)); return; }
    if (target.ok && target.kind === 'room') { rooms.draw(p, tab); drawChrome(); return; }
    if (target.ok && target.kind === 'account') { drawAccountTiles(pageContext(p, tab), target.actor); return; }
    if (target.ok && target.kind === 'table') { openTable(p, tab, target.id, target.sub); return; }
    if (target.ok && target.kind === 'discover') { drawDiscover(pageContext(p, tab), { source: target.source }); return; }
    if (target.ok && target.kind === 'search') { drawDiscover(pageContext(p, tab), { source: 'search', query: target.query }); return; }
    // A tile post's own page (claude/raku-post-links-plan.md, SL1): drawn by Raku, like Discover.
    if (target.ok && target.kind === 'tile-post') { drawTilePostPage(pageContext(p, tab), target); return; }
    if (target.ok && target.kind === 'record' && rendererFor(target.collection)) { openRecord(p, tab, target); return; }
    if (target.ok && target.kind === 'way') { openWay(p, tab, target, arrival); return; }
    openTile(p, tab, uri, { arrival });
  }
  // Back along a trail (ways): the place you go back to puts you at the portal you left it by (the next leg's exit),
  // when that place has an entrance of that name (else its first entrance).
  function arrivalFor(tab) {
    if (tab.moved !== 'back') return null;
    const after = stateAt(tab, tab.at + 1);
    return after && after.from && after.from.exit ? { entrance: after.from.exit, back: true } : null;
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
      p, tab, kit, shelf, tabs, resolver, moderation, openNew, say, drawChrome, discover, linkMessage, player, autoplay, postBox,
      auth, hearts, heartSignIn,
      alive: () => mine === p.attempt,
      status: (kind, text, ...actions) => status(p, kind, text, ...actions),
      hideStatus: () => hideStatus(p),
    };
  }

  function reload(id) {
    const tab = tabs.list.find((t) => t.id === id);
    if (!tab) return;
    if (rooms.isLive(id)) { leaveFirst(); return; }
    const p = paneFor(tab);
    p.uri = undefined;
    p.freshRecord = true;            // (a reload reads the tile's record again, PT1; as does Try again)
    // Reload on a way taken reads its signpost again (RW2), as a page reload does.
    p.freshWay = String(current(tab) || '').startsWith(WAY_PREFIX);
    show(tab);
  }

  function status(p, kind, text, ...actions) {
    // While the screen between places shows (ways), loading lines go on it; anything else takes its place.
    if (p.screen) {
      if (kind === 'loading') { p.screen.say(text, actions.filter(Boolean)); return; }
      removeScreen(p);
    }
    let box = p.el.querySelector('.tile-status');
    if (!box) { box = h('div', { class: 'tile-status' }); p.el.append(box); }
    box.dataset.kind = kind;
    actions = actions.filter(Boolean);
    box.replaceChildren(h('p', {}, text), ...(actions.length ? [h('div', { class: 'actions' }, actions)] : []));
    box.hidden = false;
  }
  function hideStatus(p) { const b = p.el.querySelector('.tile-status'); if (b) b.hidden = true; }
  const button = (label, onclick, cls = '') => h('button', { type: 'button', class: cls, onclick }, label);

  // opts.arrival: { entrance } to send once the tile says hello, if it has ways (Back along a trail). opts.way: the tile
  // is a door a way led to ({ door, entrance }): the tab keeps the way's address and the place's name, and the tile must
  // be the version the place was pointed at (its pinned CID), as on the travel page.
  async function openTile(p, tab, uri, opts = {}) {
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    const parsed = parseAddress(uri);
    const way = opts.way || null;
    p.arrival = way ? { entrance: way.entrance } : opts.arrival || null;
    p.state = 'finding';
    if (!way) {
      p.title = parsed.ok ? parsed.rkey : 'Tile';
      p.shownAddress = uri;
    }
    drawChrome();
    status(p, 'loading', 'Finding this tile…');
    if (!parsed.ok) { p.state = 'error'; status(p, 'error', parsed.reason); return; }

    let did, record, account;
    // PT1: a tile whose record was read in the last 5 minutes (its card was just drawn) starts at once from that copy and
    // is checked again once its page is in (checkRecord); not a door through a place (it must be the pinned version, as
    // now), nor after Reload or Try again.
    const fresh = !!p.freshRecord;
    p.freshRecord = false;
    let kept = null;
    try {
      did = await resolver.didFor(parsed.actor);
      if (!alive()) return;
      if (await moderation.isHidden(did, parsed.rkey) || (way && await moderation.isAccountHidden(did))) {
        if (!alive()) return;
        if (way) { wayBlocked(p, tab, "Where it leads isn't shown in Raku."); return; }
        p.state = 'hidden';
        p.title = 'Not shown';
        drawChrome();
        status(p, 'hidden', "This tile isn't shown in Raku.",
          h('a', { href: TAKEDOWNS_PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Reporting and takedowns ↗'));
        return;
      }
      kept = way || fresh ? null : resolver.keptTileRecord(did, parsed.rkey);
      [record, account] = await Promise.all([kept || resolver.tileRecord(did, parsed.rkey), resolver.account(did)]);
      if (!alive()) return;
    } catch (err) {
      if (!alive()) return;
      const msg = err instanceof NetError ? err.message : "Couldn't find this tile.";
      if (way) { wayBlocked(p, tab, msg); return; }
      p.state = 'error';
      // Try again only when trying again could help (not for a missing tile or a refused address).
      const retry = !(err instanceof NetError) || ['network', 'timeout', 'upstream'].includes(err.code);
      status(p, 'error', msg, retry ? button('Try again', () => reload(tab.id)) : null);
      return;
    }

    const d = describeTile(record);
    if (!d.ok) { if (way) { wayBlocked(p, tab, d.reason); return; } p.state = 'error'; status(p, 'error', d.reason); return; }
    // A door through a place opens exactly the version the place points at (as the travel page, and the tables' pins).
    if (way && way.door.pinned && record.cid !== way.door.pinned) { wayBlocked(p, tab, 'The tile there has changed since its place was pointed at it.'); return; }
    const keep = { kind: 'tile', did, rkey: parsed.rkey, name: d.name, by: '' };
    p.keep = keep;
    if (way) {
      if (p.screen) screenPicture(p, did, account.pds, d.manifest);
      resolver.checkedHandle(did).then((handle) => { if (handle) keep.by = handle; });
      drawChrome();
    } else {
      p.title = d.name;
      p.shownAddress = atUri(did, parsed.rkey);
      drawChrome();
      const didForm = p.shownAddress;
      resolver.checkedHandle(did).then((handle) => {
        // (the tile may have started meanwhile, so check the address rather than the attempt)
        if (handle && p.uri === uri && p.shownAddress === didForm) { p.shownAddress = atUri(handle, parsed.rkey); keep.by = handle; drawChrome(); }
      });
    }

    const verdict = sizeVerdict(d.declaredBytes);
    if (verdict === 'refuse') {
      p.state = 'error';
      status(p, 'refused', `This tile is too large to open here (${formatBytes(d.declaredBytes)}). Raku opens tiles up to ${formatBytes(LIMITS.maxBytes)}.`);
      return;
    }
    const sizeKey = atUri(did, parsed.rkey);
    const check = { did, rkey: parsed.rkey, cid: record.cid };
    if (verdict === 'ask' && !largeOk.has(sizeKey)) {
      p.state = 'asking';
      status(p, 'ask', `This tile is large (${formatBytes(d.declaredBytes)}). Open anyway?`,
        button('Open anyway', () => { largeOk.add(sizeKey); startTile(p, tab, uri, did, account.pds, d, kept ? check : null); }, 'primary'),
        button('Not now', () => (tabs.canBack(tab.id) ? tabs.back(tab.id) : tabs.go(tab.id, null))));
      return;
    }
    startTile(p, tab, uri, did, account.pds, d, kept ? check : null);
  }

  // check (PT1, PT5): { did, rkey, cid } when the tile started from a kept copy of its record: read again once its page
  // is in, and a note if it has changed or been deleted since.
  function startTile(p, tab, uri, did, pds, d, check = null) {
    const keep = p.keep, screen = p.screen, arrival = p.arrival;
    p.screen = null;                                   // (kept: clearPane would let go of its picture)
    clearPane(p);
    p.keep = keep;
    p.arrival = arrival;
    if (screen) { p.screen = screen; p.el.append(screen.el); }
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
          if (ok) {
            p.state = 'ready'; hideStatus(p); drawChrome();
            if (check) { const c = check; check = null; checkRecord(c, alive, (kind) => recordNote(p.el, kind, () => reload(tab.id))); }
            // The screen between places (ways): a destination without ways shows after a moment; one with ways when it
            // says hello (fromWayTile), or after a while if it never does.
            if (p.screen) { const s = p.screen; p.timers.push(setTimeout(() => { if (alive() && p.screen === s) revealScreen(p, 0); }, p.ways ? WAYS.helloMs : WAYS.plainMs)); }
            // RW10: a tile opened in the tab in front gets the keys once its page is in (twice, as its page settles); with
            // the screen between places up, revealScreen hands them over when it goes.
            else for (const ms of KEYS_AFTER_MS) p.timers.push(setTimeout(() => { if (alive() && !p.screen) focusIfFront(p); }, ms));
          }
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
    // A tile with ways (a /ways.json): Raku is its host (ways.js).
    if (d.manifest.resources?.['/ways.json']) hostWays(p, did, pds, d.manifest);
    // What this tile asks of Raku (decision 12): a small Messages button appears with its first message.
    p.panel = createPanel({ label: `What "${d.name}" asks of Raku` });
    p.panel.button.classList.add('panel-pill');
    p.panel.button.hidden = true;
    p.el.append(p.panel.el, p.panel.button);
    // One of a table's own tiles, opened on its own: say so, and offer the table (decision Q34).
    const table = keep && tableForTile(keep.did, keep.rkey);
    if (keep && isRoomHouse(keep.did, keep.rkey)) {
      const hint = h('div', { class: 'table-hint' }, h('span', {}, 'This tile holds the rules of Raku’s rooms.'),
        h('button', { type: 'button', class: 'primary', onclick: () => goRooms(tab) }, 'Open a room'),
        h('button', { type: 'button', class: 'table-hint-x', 'aria-label': 'Hide this note', onclick: () => hint.remove() }, icon('close', 14)));
      p.el.append(hint);
    }
    if (table) {
      const hint = h('div', { class: 'table-hint' }, h('span', {}, 'This tile is part of a table.'),
        h('button', { type: 'button', class: 'primary', onclick: () => tabs.go(tab.id, tableUri(table.id)) }, `Play ${table.name}`),
        h('button', { type: 'button', class: 'table-hint-x', 'aria-label': 'Hide this note', onclick: () => hint.remove() }, icon('close', 14)));
      p.el.append(hint);
    }
  }

  // PT1: a tile started from a kept copy of its record, read again in the background: changed → 'changed', deleted →
  // 'deleted'; the same, or the read failing (no connection, a slow server), says nothing.
  function checkRecord({ did, rkey, cid }, alive, onNews) {
    resolver.tileRecord(did, rkey).then((rec) => { if (alive() && rec.cid !== cid) onNews('changed'); })
      .catch((err) => { if (alive() && err instanceof NetError && err.code === 'not-found') onNews('deleted'); });
  }
  // PT5: the note at the bottom of the tile (the table-hint bar): "updated" with Reload (the new version) and ×, or
  // "deleted" with × only. The old version keeps running until then. One note at a time, in place of any other bar.
  function recordNote(holder, kind, onReload) {
    for (const old of holder.querySelectorAll(':scope > .table-hint')) old.remove();
    const hint = h('div', { class: 'table-hint record-hint', 'data-kind': kind, role: 'status' },
      h('span', {}, kind === 'changed' ? 'This tile has been updated since it opened.' : 'Its author has deleted this tile.'),
      kind === 'changed' ? h('button', { type: 'button', class: 'primary', onclick: () => { hint.remove(); onReload(); } }, 'Reload') : null,
      h('button', { type: 'button', class: 'table-hint-x', 'aria-label': 'Hide this note', onclick: () => hint.remove() }, icon('close', 14)));
    holder.append(hint);
    return hint;
  }

  // ---------- ways (claude/raku-ways-plan.md, RW1 to RW8) ----------
  // A way taken (raku:way/<account>/<signpost>, RW2): read the signpost (or take the door this tab's history kept, for
  // Back and Forward), then open where it leads in this tab, arriving at the signpost's entrance (or, going back, at
  // the portal you left by). Dormant: "This doesn't lead anywhere yet."; several places: "Pick a door"; anything in the
  // way (hidden, unreadable, changed since its place was pointed at it): "The way is blocked."
  async function openWay(p, tab, target, arrival) {
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    const st = stateAt(tab) || {};
    const fresh = p.freshWay;
    p.freshWay = false;
    p.state = 'finding';
    p.title = 'On the way…';
    p.shownAddress = target.uri;
    drawChrome();
    showScreen(p);
    let did;
    try {
      did = await resolver.didFor(target.actor);
      if (!alive()) return;
      if (await moderation.isAccountHidden(did)) { if (alive()) wayBlocked(p, tab, "This signpost isn't shown in Raku."); return; }
    } catch (err) {
      if (alive()) wayBlocked(p, tab, err instanceof NetError ? err.message : "Couldn't find this signpost's account.");
      return;
    }
    if (!alive()) return;
    const didForm = wayUri(did, target.rkey);
    p.shownAddress = didForm;
    drawChrome();
    // (the place's tile may have started meanwhile, which begins a new load on the pane: so check the address shown, as
    // openTile does, rather than the load; on Back and Forward the door is kept, and the tile starts at once)
    const shownFor = p.uri;
    resolver.checkedHandle(did).then((hd) => { if (hd && p.uri === shownFor && p.shownAddress === didForm) { p.shownAddress = wayUri(hd, target.rkey); drawChrome(); } });
    let door = !fresh && st.door ? st.door : null;
    if (!door) {
      const view = await ways.lookUp(did, target.rkey).catch(() => ({ state: 'error', doors: [] }));
      if (!alive()) return;
      if (view.state === 'dormant') {
        removeScreen(p);
        p.state = 'error';
        p.title = 'Leads nowhere yet';
        drawChrome();
        status(p, 'dormant', `This doesn't lead anywhere yet.${view.note ? ` (${view.note})` : ''}`, tabs.canBack(tab.id) ? button('Back', () => tabs.back(tab.id)) : null);
        return;
      }
      if (view.state !== 'open') { wayBlocked(p, tab, "The signpost couldn't be read just now."); return; }
      const usable = view.doors.filter((d) => !d.broken);
      const one = chosenDoor(view, st.pick) || (view.doors.length === 1 ? usable[0] : null);
      if (!one && !usable.length) { wayBlocked(p, tab, (view.doors[0] && view.doors[0].broken) || "Where it leads couldn't be opened."); return; }
      if (!one) {
        // Several places and none chosen yet (a reload, or a link): pick one here.
        p.state = 'ready';
        p.title = 'Pick a door';
        drawChrome();
        pickDoors(p, view, {
          onGo: (d) => { const kept = keepDoor(d); setWayState(tab, { ...st, door: kept }); enterDoor(p, tab, kept, arrival); },
          onBack: tabs.canBack(tab.id) ? () => tabs.back(tab.id) : null,
        });
        return;
      }
      door = keepDoor(one);
      setWayState(tab, { ...st, door });
    }
    enterDoor(p, tab, door, arrival);
  }
  // Keep the door with this place in the tab's history (Back and Forward come back to it without reading again).
  function setWayState(tab, state) { if (tab.states) tab.states[tab.at] = state; }

  function enterDoor(p, tab, door, arrival) {
    p.title = door.name;
    drawChrome();
    showScreen(p, { name: door.name, by: door.by });
    openTile(p, tab, door.tile, { way: { door, entrance: (arrival && arrival.entrance) || door.entrance } });
  }

  function wayBlocked(p, tab, why) {
    removeScreen(p);
    p.state = 'error';
    p.title = 'The way is blocked';
    drawChrome();
    status(p, 'error', `The way is blocked. ${why || ''}`.trim(),
      button('Try again', () => reload(tab.id)),
      tabs.canBack(tab.id) ? button('Back', () => tabs.back(tab.id)) : null);
  }

  // Raku as a host (RW3): read the tile's /ways.json and each exit's signpost (open or dormant) while the tile loads, so
  // its hello can be answered at once. A /ways.json that can't be read leaves Raku a plain viewer for that tile.
  function hostWays(p, did, pds, manifest) {
    const host = { ways: null, statuses: null, arrived: false, helloed: false, busy: false };
    p.ways = host;
    host.ready = (async () => {
      const cid = blobCidOf(manifest.resources['/ways.json']);
      if (!cid) return false;
      const buf = await files.get(pds, did, cid, { left: WAYS.waysBytes });
      const w = buf ? readWays(JSON.parse(new TextDecoder().decode(buf))) : null;
      if (!w) return false;
      const statuses = {};
      await Promise.all(w.exits.map(async (x) => { statuses[x.id] = await ways.state(x.signpost); }));
      host.ways = w;
      host.statuses = statuses;
      return true;
    })().catch(() => false);
  }

  const postTo = (pane, msg) => { try { pane.frame?.contentWindow?.postMessage(msg, '*'); } catch { /* the tile has gone */ } };
  // The keys to the tile (as the travel page's W40): its own window is inside the loader's frame, and a page may call
  // focus() on another site's window, so arrow keys reach the place without a click.
  function focusTile(pane) {
    try { pane.frame?.focus(); } catch { /* fine */ }
    try { const inner = pane.frame?.contentWindow?.frames[0]; if (inner) inner.focus(); } catch { /* fine */ }
  }

  // RW10: a tile that opens in the tab in front gets the keys, as a page does in an ordinary browser, however it got
  // there (the address box, a card, Back and Forward, a reload); one in a background tab never does. Never taken from
  // someone typing in one of Raku's own boxes or using one of its menus or dialogs meanwhile.
  function focusIfFront(pane) {
    if (!pane.frame || !tabs.active || panes.get(tabs.active.id) !== pane) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== pane.frame
      && (a.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || a.closest?.('[role="dialog"], [role="menu"]'))) return;
    focusTile(pane);
  }

  // ---------- "Play here" (claude/raku-play-here-plan.md, PH1 to PH8) ----------
  // A tile post's tile running inside its post on Discover, built as a tab builds one (startTile: the same loader, frame
  // and sandbox, the same size rule) but held by the post's slot. One at a time across Raku (play-here.js); it stops on
  // its ×, when another starts, when its page goes (the pane's dispose), or a few seconds fully out of view.
  // Round C (claude/raku-expand-plan.md): discover.js can expand the slot to Raku's window (the frame is never moved);
  // and a tile with ways travels inside the post (D, EX6, EX7): the screen between places and "Pick a door" on the
  // slot, the next place started in the same slot, a trail of the places passed through for "Back to …".
  const postSlots = createOneAtATime({ awayMs: PLAY_HERE.awayMs });
  let playing = null;          // the tile playing: { el (its slot), slot, frame, ways, attempt, arrival, timers, observer, trail, … }
  // onState(kind, detail): 'starting' | 'slow' | 'playing' | 'keys' (detail: true/false) | 'stopped' | 'error' (detail: words)
  //   | 'place' (detail: { name, by, travelled, backTo, tab }: the place now, after a trip or Back) | 'note' (detail: words)
  // expand(): the slot expanded to Raku's window (a promise, once it has grown); expanded(): whether it is.
  // quiet (Autoplay, AU3): started by itself, so it takes no keys until it is clicked or tapped (or expanded).
  function playInPost({ slot, uri, did, pds, d, onState, expand = null, expanded = () => false, quiet = false }) {
    const pane = { post: true, el: slot, slot, frame: null, ways: null, attempt: 0, arrival: null, timers: [], observer: null, state: 'loading', failed: null,
      onState, expand, expanded, quiet, inView: true, big: false, screen: null, tripStarted: null, trip: 0,
      trail: createTrail({ uri, did, pds, d, name: d.name, by: null }) };
    postSlots.start(slot, () => endPost(pane));
    playing = pane;
    onState('starting');
    runInPost(pane, pane.trail.here, { first: true });
    resolver.checkedHandle(did).then((hd) => { if (hd && pane.trail.length && pane.trail.here.did === did && !pane.trail.here.by) pane.trail.here.by = hd; }).catch(() => {});
    if (typeof IntersectionObserver === 'function') {
      pane.observer = new IntersectionObserver((entries) => {
        for (const en of entries) { pane.inView = en.isIntersecting; postSlots.seen(slot, pane.big || en.isIntersecting); }
      });
      pane.observer.observe(slot);
    }
  }
  // Start a place's tile in the slot (the post's own, or one reached by a way): a new frame in place of the last one.
  // first: the post's own tile, as Play starts it (its "Starting…" panel, Try again on failing); a place reached by a
  // way shows the screen between places until it says hello (or a moment after, without ways), as a tab does.
  function runInPost(pane, place, { first = false, arrival = null } = {}) {
    const mine = ++pane.attempt;
    const alive = () => playing === pane && pane.attempt === mine;
    pane.timers.forEach(clearTimeout);
    pane.timers = [];
    if (pane.frame) { pane.frame.remove(); pane.frame = null; }
    for (const n of pane.slot.querySelectorAll(':scope > .record-hint')) n.remove();   // (PT5's note belongs to the tile left)
    pane.ways = null;
    pane.arrival = arrival;
    pane.state = 'loading';
    if (first) pane.timers.push(setTimeout(() => { if (alive() && pane.state === 'loading') pane.onState('slow'); }, TIMES.retry));
    const { did, pds, d } = place;
    const loader = createPathLoader({
      files, pds, did, manifest: d.manifest,
      onFile(path, ok, err) {
        if (!alive() || (path !== '/' && path !== '/index.html')) return;
        if (!ok) {
          if (first || !pane.trail.travelled) { pane.failed = err?.message || "Couldn't load this tile."; postSlots.stop(pane.slot); return; }
          // A place reached by a way that won't load: back where you came from, at the portal left by.
          backInPost(pane, { note: `The way is blocked. ${err?.message || "Couldn't load where it leads."}` });
          return;
        }
        pane.state = 'ready';
        if (first) pane.onState('playing');
        // PT5: the post's own tile ran from the card's copy of its record: read it again, with the note inside the post
        if (first && !pane.checked && place.d.cid) {
          pane.checked = true;
          checkRecord({ did, rkey: place.uri.split('/').pop(), cid: place.d.cid }, alive,
            (kind) => recordNote(pane.slot, kind, () => reloadPost(pane)));
        }
        if (pane.screen) { const s = pane.screen; pane.timers.push(setTimeout(() => { if (alive() && pane.screen === s) revealScreen(pane, 0); }, pane.ways ? WAYS.helloMs : WAYS.plainMs)); }
        // PH4: the keys at once, as a tab gives them (RW10), twice as its page settles
        else if (!pane.quiet) for (const ms of KEYS_AFTER_MS) pane.timers.push(setTimeout(() => { if (alive() && !pane.screen) focusPost(pane); }, ms));
      },
    });
    const tile = new Tile(mothership, place.uri, d.manifest, loader);
    const frame = tile.renderContent(600);
    frame.className = 'tp-frame';
    frame.removeAttribute('style');
    frame.title = d.name;
    frame.setAttribute('allow', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    if (!TILE_POPUPS) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');
    pane.frame = frame;
    pane.slot.prepend(frame);           // (under the screen between places, which stays on top while it shows)
    if (d.manifest.resources?.['/ways.json']) hostWays(pane, did, pds, d.manifest);
  }
  // PT5's Reload inside a post: the post's own tile, its record read again, restarted in the same slot (expanded or not);
  // the post's card takes the new version too ('update'), for its next Play.
  async function reloadPost(pane) {
    if (playing !== pane || pane.trail.travelled) return;
    const here = pane.trail.here;
    try {
      const rec = await resolver.tileRecord(here.did, here.uri.split('/').pop());
      const d = describeTile(rec);
      if (playing !== pane || pane.trail.travelled) return;
      if (!d.ok) { postNote(pane, d.reason); return; }
      here.d = d;
      here.name = d.name;
      pane.onState('update', d);
      pane.onState('starting');
      runInPost(pane, here, { first: true });
    } catch (err) {
      if (playing === pane) postNote(pane, err instanceof NetError ? err.message : "Couldn't load this tile.");
    }
  }
  function endPost(pane) {
    if (playing === pane) playing = null;
    pane.timers.forEach(clearTimeout);
    if (pane.observer) pane.observer.disconnect();
    if (pane.frame) { pane.frame.remove(); pane.frame = null; }
    removeScreen(pane);
    pane.onState(pane.failed ? 'error' : 'stopped', pane.failed || undefined);
  }
  // PH4: the keys go to the tile unless someone is typing in one of Raku's boxes or using a menu meanwhile (as focusIfFront).
  function focusPost(pane) {
    if (!pane.frame || !pane.slot.isConnected) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== pane.frame
      && (a.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || a.closest?.('[role="dialog"], [role="menu"]'))) return;
    focusTile(pane);
  }
  // The ring (PH4): on while the tile's frame holds the keys. Focus moving into a frame blurs Raku's window.
  const keysToPost = () => {
    if (!playing) return;
    const has = document.activeElement === playing.frame;
    if (has) playing.quiet = false;          // (an auto-started tile, clicked or tapped: it has the keys now, AU3)
    playing.onState('keys', has);
  };
  addEventListener('blur', () => setTimeout(keysToPost, 0));
  addEventListener('focus', () => setTimeout(keysToPost, 0));
  document.addEventListener('focusin', keysToPost);
  document.addEventListener('pointerdown', (e) => { if (playing && !playing.frame?.contains(e.target)) setTimeout(keysToPost, 0); }, true);

  // A tile with ways in a post: its exits' status on hello, and the arrival when it was reached by a way or by Back;
  // stepping through a portal travels inside the post (leavePost).
  async function fromWayPost(pane, d) {
    const m = readWayMessage(d);
    const host = pane.ways;
    if (!m || !host) return;
    const mine = pane.attempt;
    if (!(await host.ready) || playing !== pane || mine !== pane.attempt || pane.ways !== host) return;
    if (m.kind === 'hello') {
      postTo(pane, statusMessage(host.statuses));
      if (pane.arrival && !host.arrived) {
        host.arrived = true;
        const e = entranceFor(host.ways, pane.arrival.entrance);
        if (e) postTo(pane, arriveMessage(e));
      }
      if (!host.helloed) { host.helloed = true; if (pane.screen) revealScreen(pane); }
      return;
    }
    if (m.kind === 'leave') leavePost(pane, m.exit);
  }
  const placeInfo = (pane) => {
    const t = pane.trail;
    return { name: t.here.name, by: t.here.by || null, travelled: t.travelled, backTo: t.before ? t.before.name : null, tab: tabFor(t, wayUri) };
  };
  const postNote = (pane, text) => pane.onState('note', text);
  // Stepping through a portal (D): the signpost read as a tab reads it: nowhere to go → back at that portal, "The way is
  // blocked."; one place → there, in this post; several → "Pick a door", with "Stay here". A small tile expands first
  // (EX6): the trip happens only in the expanded view.
  async function leavePost(pane, exitId) {
    const host = pane.ways;
    const exit = host && host.ways ? host.ways.exits.find((x) => x.id === exitId) : null;
    if (!exit || host.busy) return;
    host.busy = true;
    const mine = pane.attempt;
    const live = () => playing === pane && pane.attempt === mine;
    // Expanded: the screen at once, as a tab shows it. Small: the signpost first (a way that leads nowhere keeps the
    // tile where it is), then expand, then the screen.
    if (pane.expanded()) showScreen(pane);
    const at = parseAtUri(exit.signpost);
    const view = await ways.lookUp(at.did, at.rkey).catch(() => ({ state: 'error', doors: [] }));
    if (!live()) return;
    const stay = (note) => {
      removeScreen(pane);
      host.busy = false;
      const e = entranceFor(host.ways, exit.id);
      if (e) postTo(pane, arriveMessage(e));
      if (note) postNote(pane, note);
      focusPost(pane);
    };
    const plan = wayPlan(view);
    if (plan.kind === 'blocked') { stay('The way is blocked.'); return; }
    if (!pane.expanded() && pane.expand) { await pane.expand(); if (!live()) return; }
    showScreen(pane);
    // (the screen stays up from here to the next place, so its minimum time counts from stepping through, RW9)
    const go = (door) => travelTo(pane, door, { exit: exit.id, way: { did: at.did, rkey: at.rkey }, stay });
    if (plan.kind === 'go') { go(plan.door); return; }
    pickDoors(pane, view, { onGo: go, onStay: () => stay(null) });
  }
  // Through a door (D): the screen names the place; its tile is checked as a tab checks a way's door (hidden, the
  // place's pinned version, the size rule), then started in the same slot, arriving at the door's entrance. Anything
  // in the way: back at the portal, "The way is blocked." (the tile left keeps running underneath until then).
  async function travelTo(pane, door, { exit, way, stay }) {
    const mine = pane.attempt;
    const live = () => playing === pane && pane.attempt === mine;
    const sc = showScreen(pane, { name: door.name, by: door.by });
    const blocked = (why) => { if (live()) stay(`The way is blocked. ${why || ''}`.trim()); };
    let record, account;
    try {
      if (await moderation.isAccountHidden(door.did) || await moderation.isHidden(door.did, door.rkey)) { blocked("Where it leads isn't shown in Raku."); return; }
      [record, account] = await Promise.all([resolver.tileRecord(door.did, door.rkey), resolver.account(door.did)]);
    } catch (err) { blocked(err instanceof NetError ? err.message : "Couldn't find where it leads."); return; }
    if (!live()) return;
    const d = describeTile(record);
    if (!d.ok) { blocked(d.reason); return; }
    if (door.pinned && record.cid !== door.pinned) { blocked('The tile there has changed since its place was pointed at it.'); return; }
    const key = atUri(door.did, door.rkey);
    const arrive = () => {
      if (!live()) return;
      screenPicture(pane, door.did, account.pds, d.manifest);
      const place = pane.trail.go({ uri: door.tile, did: door.did, pds: account.pds, d, name: door.name, by: door.by || null },
        { exit, way: { ...way, door: keepDoor(door) } });
      if (pane.ways) pane.ways.busy = false;
      runInPost(pane, place, { arrival: { entrance: door.entrance } });
      pane.onState('place', placeInfo(pane));
    };
    const v = player.verdict(d.declaredBytes, key);
    if (v === 'refuse') { blocked(`This tile is too large to open here (${formatBytes(d.declaredBytes)}).`); return; }
    if (v === 'ask') {
      sc.say(`This tile is large (${formatBytes(d.declaredBytes)}). Go anyway?`, [
        button('Go anyway', () => { player.allow(key); arrive(); }, 'primary'),
        button('Stay here', () => stay(null))]);
      return;
    }
    arrive();
  }
  // "Back to …" (EX7): the place before, started again in the slot, arriving at the portal it was left by.
  function backInPost(pane, { note = null } = {}) {
    if (playing !== pane || !pane.trail.travelled) return;
    const before = pane.trail.before;
    pane.tripStarted = null;
    showScreen(pane, { name: before.name, by: before.by });
    screenPicture(pane, before.did, before.pds, before.d.manifest);
    const { place, entrance } = pane.trail.back();
    runInPost(pane, place, { arrival: entrance ? { entrance, back: true } : null });
    pane.onState('place', placeInfo(pane));
    if (note) postNote(pane, note);
  }

  // Expanding adds one step to the browser's history (EX5), so Back (the phone's gesture, the browser's button) closes
  // the expanded view rather than leaving Raku. Closing it another way (×, Escape) takes the step back off. Raku's own
  // address (the tabs, #t=…) is kept as it is now, whichever entry the browser lands on.
  let step = null;             // { onBack, leaving, done }
  function pushStep(onBack) {
    if (step) return;
    try { hist.pushState({ raku: 'expanded' }, ''); step = { onBack, leaving: false, done: null }; } catch { step = null; }
  }
  function dropStep() {
    return new Promise((resolve) => {
      if (!step) { resolve(); return; }
      step.leaving = true;
      step.done = resolve;
      const s = step;
      setTimeout(() => { if (step === s) { step = null; resolve(); } }, 700);
      try { hist.back(); } catch { step = null; resolve(); }
    });
  }
  globalThis.addEventListener?.('popstate', () => {
    if (!step) return;
    const s = step;
    step = null;
    const hash = tabs.toHash();
    if (loc.hash !== hash) { try { hist.replaceState(null, '', hash); } catch { /* fine */ } }
    if (s.leaving) { s.done(); return; }
    s.onBack();
  });

  // What Discover's tile posts use (discover.js tilePostCard).
  const playOk = new Set();      // tiles the visitor said "Play anyway" to, this visit (as largeOk for tabs)
  const playingIn = (slot) => (playing && playing.slot === slot ? playing : null);
  const player = {
    verdict: (bytes, key) => playVerdict(bytes, key, new Set([...largeOk, ...playOk])),
    allow: (key) => { playOk.add(key); largeOk.add(key); },
    play: playInPost,
    stop: (slot) => (slot ? postSlots.stop(slot) : postSlots.stop()),
    get current() { return postSlots.current; },
    // round C
    big(slot, on) {            // expanded or not: while expanded it never stops for being out of view
      const pane = playingIn(slot);
      if (!pane) return;
      pane.big = !!on;
      postSlots.seen(slot, pane.big || pane.inView);
    },
    focus(slot) { const pane = playingIn(slot); if (pane) focusPost(pane); },
    back(slot) { const pane = playingIn(slot); if (pane) backInPost(pane); },
    place(slot) { const pane = playingIn(slot); return pane ? placeInfo(pane) : null; },
    pushStep, dropStep,
  };

  // A tile's way messages: hello (answered with its exits' status, and the arrival when it was reached by a way or
  // by Back), leave (take the traveller on).
  async function fromWayTile(pane, tabId, d) {
    const m = readWayMessage(d);
    const host = pane.ways;
    if (!m || !host) return;
    const mine = pane.attempt;
    if (!(await host.ready) || mine !== pane.attempt || pane.ways !== host) return;
    if (m.kind === 'hello') {
      postTo(pane, statusMessage(host.statuses));
      if (pane.arrival && !host.arrived) {
        host.arrived = true;
        const e = entranceFor(host.ways, pane.arrival.entrance);
        if (e) postTo(pane, arriveMessage(e));
      }
      if (!host.helloed) { host.helloed = true; if (pane.screen) revealScreen(pane); if (tabs.active.id === tabId) focusTile(pane); }
      return;
    }
    if (m.kind === 'leave') leaveBy(pane, tabId, m.exit);
  }

  // Someone stepped through an exit: read its signpost; nowhere to go → back at that portal, "The way is blocked.";
  // one place → on, in this tab; several → "Pick a door" over the place, with "Stay here".
  async function leaveBy(pane, tabId, exitId) {
    const host = pane.ways;
    const exit = host && host.ways ? host.ways.exits.find((x) => x.id === exitId) : null;
    const tab = tabs.list.find((t) => t.id === tabId);
    if (!exit || !tab || host.busy) return;
    host.busy = true;
    const mine = pane.attempt;
    const sc = showScreen(pane);
    const at = parseAtUri(exit.signpost);
    const view = await ways.lookUp(at.did, at.rkey).catch(() => ({ state: 'error', doors: [] }));
    if (mine !== pane.attempt) return;
    const usable = view.state === 'open' ? view.doors.filter((d) => !d.broken) : [];
    const stay = (blocked) => {
      removeScreen(pane);
      host.busy = false;
      const e = entranceFor(host.ways, exit.id);
      if (e) postTo(pane, arriveMessage(e));
      if (blocked) say('The way is blocked.');
      focusTile(pane);
    };
    if (!usable.length) { stay(true); return; }
    const from = { exit: exit.id };
    // (the next place's screen counts its minimum time from this moment, RW9)
    const go = (door) => { host.busy = false; pane.tripStarted = sc.since; tabs.go(tab.id, wayUri(at.did, at.rkey), { door: keepDoor(door), from }); };
    if (view.doors.length === 1) { go(usable[0]); return; }
    pickDoors(pane, view, { onGo: go, onStay: () => stay(false) });
  }

  // The screen between places (RW4): the destination's banner, dimmed, behind its name and "by @handle"; a calm colour
  // until (or without) a banner. Loading lines go on it (status); it fades once the place has said hello.
  function showScreen(p, { name = '', by = '' } = {}) {
    let sc = p.screen;
    if (!sc) {
      const pic = h('img', { class: 'way-pic', alt: '', hidden: true });
      const nameEl = h('p', { class: 'way-name' });
      const byEl = h('p', { class: 'way-by' });
      const msgEl = h('p', { class: 'way-msg', role: 'status' });
      const acts = h('div', { class: 'way-actions' });
      const doorsEl = h('div', { class: 'way-doors', hidden: true });
      const el = h('div', { class: 'way-screen' }, pic, h('div', { class: 'way-inner' }, nameEl, byEl, msgEl, doorsEl, acts));
      // since: when the trip began (stepping through, carried over from the place left; else now), for RW9's minimum
      sc = { el, pic, nameEl, byEl, msgEl, acts, doorsEl, url: null, since: p.tripStarted || Date.now(),
        say(text, actions = []) { msgEl.textContent = text || ''; acts.replaceChildren(...actions); } };
      p.tripStarted = null;
      p.screen = sc;
      p.el.append(el);
    }
    sc.el.classList.remove('going');
    sc.nameEl.textContent = name;
    sc.byEl.textContent = by ? `by @${by}` : '';
    sc.msgEl.textContent = '';
    sc.acts.replaceChildren();
    sc.doorsEl.hidden = true;
    sc.doorsEl.replaceChildren();
    return sc;
  }
  function removeScreen(p) {
    const sc = p.screen;
    if (!sc) return;
    if (sc.url) URL.revokeObjectURL(sc.url);
    sc.el.remove();
    p.screen = null;
  }
  // The screen goes `after` ms from now, but never before WAYS.minScreenMs since the trip began (RW9); once it has gone,
  // the place gets the keys again (as the travel page: the first time, at its hello, the screen still covered it).
  function revealScreen(p, after = WAYS.revealMs) {
    const sc = p.screen;
    if (!sc) return;
    const wait = Math.max(after, WAYS.minScreenMs - (Date.now() - sc.since));
    setTimeout(() => {
      if (p.screen !== sc) return;
      sc.el.classList.add('going');
      setTimeout(() => {
        if (p.screen !== sc) return;
        removeScreen(p);
        if (p.post) { if (playing === p) focusPost(p); }
        else if (tabs.active && panes.get(tabs.active.id) === p) focusTile(p);
      }, WAYS.fadeMs);
    }, wait);
  }
  // (Only the screen itself decides whether the picture still belongs: starting the tile begins a new attempt on the
  // pane, but the screen stays up through it.)
  async function screenPicture(p, did, pds, manifest) {
    const sc = p.screen;
    const cid = bannerCid(manifest);
    if (!sc || !cid) return;
    try {
      const buf = await files.get(pds, did, cid, { left: WAYS.bannerBytes });
      const type = buf && sniffPicture(new Uint8Array(buf));
      if (!type || p.screen !== sc) return;
      sc.url = URL.createObjectURL(new Blob([buf], { type }));
      sc.pic.src = sc.url;
      sc.pic.hidden = false;
    } catch { /* the calm colour stays */ }
  }
  // "Pick a door": the places a way leads to, on the screen; "Stay here" on the way out of a place, Back on a way
  // opened by its address.
  function pickDoors(p, view, { onGo, onStay = null, onBack = null }) {
    const sc = showScreen(p, { name: 'Pick a door' });
    if (view.note) sc.msgEl.textContent = view.note;
    sc.doorsEl.hidden = false;
    sc.doorsEl.replaceChildren(h('ul', { class: 'way-door-list' }, ...view.doors.map((d) => h('li', {},
      d.broken
        ? h('div', { class: 'way-door broken' }, d.label ? h('span', { class: 'way-door-label' }, d.label) : null, h('span', { class: 'way-door-by' }, d.broken))
        : h('button', { type: 'button', class: 'way-door', onclick: () => onGo(d) },
          d.label ? h('span', { class: 'way-door-label' }, d.label) : null,
          h('span', { class: 'way-door-name' }, d.name),
          d.by ? h('span', { class: 'way-door-by' }, `by @${d.by}`) : null)))));
    sc.acts.replaceChildren(...[onStay ? button('Stay here', onStay) : null, onBack ? button('Back', onBack) : null].filter(Boolean));
  }

  // A record shown by its renderer (renderer tiles, RT1 to RT8): find the record (its account, moderation, the record
  // from the author's own server), then start the pinned renderer tile; the record is handed over when the tile says
  // it's ready (fromRenderer below). The address box shows the record's address; the star stays hidden (the shelf keeps
  // tiles and accounts); "Open in ▾" shows the record in an explorer.
  async function openRecord(p, tab, target) {
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    const renderer = rendererFor(target.collection);
    p.state = 'finding';
    p.title = target.rkey;
    p.shownAddress = target.uri;
    drawChrome();
    status(p, 'loading', 'Finding this record…');
    let did, rec;
    try {
      did = await resolver.didFor(target.actor);
      if (!alive()) return;
      if (await moderation.isAccountHidden(did)) {
        if (!alive()) return;
        p.state = 'hidden';
        p.title = 'Not shown';
        drawChrome();
        status(p, 'hidden', "This account's records aren't shown in Raku.",
          h('a', { href: TAKEDOWNS_PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Reporting and takedowns ↗'));
        return;
      }
      rec = await resolver.record(did, target.collection, target.rkey);
      if (!alive()) return;
    } catch (err) {
      if (!alive()) return;
      p.state = 'error';
      const msg = err instanceof NetError ? err.message : "Couldn't find this record.";
      const retry = !(err instanceof NetError) || ['network', 'timeout', 'upstream'].includes(err.code);
      status(p, 'error', msg, retry ? button('Try again', () => reload(tab.id)) : null);
      return;
    }
    const didForm = `at://${did}/${target.collection}/${target.rkey}`;
    p.title = recordTitle(rec.value, target.rkey);
    p.shownAddress = didForm;
    p.record = { uri: didForm };                    // for "Open in ▾": the explorers are given the DID (OL3)
    drawChrome();
    const handle = resolver.checkedHandle(did).catch(() => null);
    handle.then((hd) => {
      if (hd && alive() && p.shownAddress === didForm) { p.shownAddress = `at://${hd}/${target.collection}/${target.rkey}`; drawChrome(); }
    });
    // The record goes out with the handle once it checks out, or without one after a moment (the tile shows the DID).
    const handleSoon = Promise.race([handle, new Promise((r) => setTimeout(() => r(null), RENDER.handleMs))]);
    const record = { did, collection: target.collection, rkey: target.rkey, cid: rec.cid, value: rec.value };
    startRenderer(p, tab, renderer, async () => recordPayload({ ...record, handle: await handleSoon }), { uri: didForm, did, value: rec.value, handle: handleSoon });
  }

  async function startRenderer(p, tab, renderer, payload, given) {
    const mine = p.attempt;
    const alive = () => mine === p.attempt;
    p.state = 'loading';
    status(p, 'loading', 'Loading…');
    const again = () => button('Try again', () => reload(tab.id));
    p.timers = [
      setTimeout(() => { if (alive() && p.state === 'loading') status(p, 'loading', 'Still loading…'); }, TIMES.still),
      setTimeout(() => { if (alive() && p.state === 'loading') status(p, 'loading', 'Still loading…', again()); }, TIMES.retry),
    ];
    let tile = null;
    let error = null;
    try { tile = await mothership.loadTile(renderer.uri); } catch (err) { error = err; }
    if (!alive()) return;
    if (!tile) {
      p.timers.forEach(clearTimeout);
      p.state = 'error';
      if (error instanceof TileChanged) status(p, 'error', `The tile that shows these records (${renderer.name}) has changed since Raku was set up to use it, so Raku doesn't run it. "Open in" still shows the record.`);
      else status(p, 'error', `Raku couldn't load the tile that shows these records (${renderer.name}).`, again());
      return;
    }
    const frame = tile.renderContent(600);
    frame.className = 'tile-frame';
    frame.removeAttribute('style');
    frame.title = p.title;
    frame.setAttribute('allow', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    if (!TILE_POPUPS) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');
    p.frame = frame;
    p.el.prepend(frame);
    // seen: every record handed to this renderer in this load, by the address it was sent with (PC6: the pictures it
    // may ask for are the ones these records list).
    p.renderer = { payload, given, gate: createOpenGate(), gets: createGetBudget(), seen: new Map([[given.uri, { did: given.did, value: given.value }]]) };
    // RT12: the record's tab shows its renderer's own icon (the carved door, the trail signpost), read from the
    // renderer's record as a tile's tab reads its tile's; the dot until then, and if it has none.
    const rdid = (/^at:\/\/([^/]+)\//.exec(renderer.uri) || [])[1];
    if (rdid && tile.manifest) resolver.account(rdid).then(({ pds }) => loadIcon(p, rdid, pds, tile.manifest, alive)).catch(() => { /* the dot stays */ });
  }

  // A renderer's messages (RT1, RT5, SR6): "ready" is answered with the record (every time: a reloaded tile asks again);
  // { open: "at://…" } opens that address as if it had been typed, a tile or a record with a renderer in a new tab;
  // { get: "at://…" } is answered with that record when it's named in the record the renderer was given, or is in
  // that record's own account (at most RENDER.getMax per load; hidden accounts and tiles refused); { picture, from }
  // with that picture's bytes when one of the records it was handed lists it (PC6, the same allowance). Nothing else
  // is answered, and nothing a renderer sends can write anywhere.
  async function fromRenderer(pane, d) {
    const r = pane.renderer;
    if (d.action === READY) {
      const mine = pane.attempt;
      const payload = await r.payload();
      if (mine !== pane.attempt || !pane.frame) return;
      pane.frame.contentWindow.postMessage({ action: DOWN, payload }, '*');
      if (pane.state !== 'ready') { pane.timers.forEach(clearTimeout); pane.state = 'ready'; hideStatus(pane); drawChrome(); focusIfFront(pane); }
      return;
    }
    if (d.action !== UP) return;
    const wanted = readGetRequest(d.payload);
    if (wanted) { answerGet(pane, wanted); return; }
    const pic = readPictureRequest(d.payload);
    if (pic) { answerPicture(pane, pic); return; }
    const address = readOpenRequest(d.payload);
    if (!address || !r.gate.take()) return;
    // A signpost's "Go to" (RW5): that way, in a new tab, to the place chosen, arriving at the signpost's entrance.
    const goTo = signpostGoTo(r.given, address);
    if (goTo) { openNew(wayUri(goTo.did, goTo.rkey), { pick: goTo.pick }); return; }
    const decision = openDecision(address);
    if (decision.action === 'tab') openNew(decision.uri);
    else if (decision.action === 'record') showRecord(decision.target);
    else if (decision.action === 'post') linkMessage.show({ post: { actor: decision.target.actor, rkey: decision.target.rkey }, from: `"${pane.title}" asked to open a post. Raku shows tiles, so posts open in their app.` });
    else say(decision.reason);
  }

  // A renderer's { get } (SR6): read the record from its author's own server, as for the record itself, and send it back
  // in the same shape (RT4), or { got, error } with error one of not-allowed, too-many, hidden, not-found.
  async function answerGet(pane, address) {
    const mine = pane.attempt;
    const send = (payload) => { if (mine === pane.attempt && pane.frame) pane.frame.contentWindow.postMessage({ action: DOWN, payload }, '*'); };
    const r = pane.renderer;
    const handle = await r.given.handle;
    const t = getTarget(address, { ...r.given, handle });
    if (!t) return send({ got: address, error: 'not-allowed' });
    if (!r.gets.take()) return send({ got: address, error: 'too-many' });
    try {
      const did = await resolver.didFor(t.actor);
      if (await moderation.isAccountHidden(did) || (t.collection === 'ing.dasl.masl' && await moderation.isHidden(did, t.rkey))) return send({ got: address, error: 'hidden' });
      const rec = await resolver.record(did, t.collection, t.rkey);
      const hd = await Promise.race([resolver.checkedHandle(did).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), RENDER.handleMs))]);
      const record = recordPayload({ did, handle: hd, collection: t.collection, rkey: t.rkey, cid: rec.cid, value: rec.value });
      if (mine === pane.attempt) r.seen.set(record.uri, { did, value: rec.value });
      send({ got: address, record });
      // PT3: a tile handed to a renderer (the Places card) is likely opened next: its page, early (no hover inside a tile)
      if (t.collection === 'ing.dasl.masl') prefetch.seen(atUri(did, t.rkey));
    } catch {
      send({ got: address, error: 'not-found' });
    }
  }

  // A renderer's { picture, from } (PC6): one blob listed in a record already handed to it in this load, fetched from
  // that record's account's own server as a tab's icon is, a PNG, JPEG, WebP or GIF (by its bytes) of at most
  // RENDER.pictureMaxBytes; answered { gotPicture, from, type, bytes } or { gotPicture, from, error } with error one of
  // not-allowed, too-many, too-big, not-a-picture, not-found. It counts against the same allowance as { get }.
  async function answerPicture(pane, req) {
    const mine = pane.attempt;
    const r = pane.renderer;
    const send = (payload) => { if (mine === pane.attempt && pane.frame) pane.frame.contentWindow.postMessage({ action: DOWN, payload: { gotPicture: req.cid, from: req.from, ...payload } }, '*'); };
    const source = pictureSource(req, r.seen);
    if (!source) return send({ error: 'not-allowed' });
    if (!r.gets.take()) return send({ error: 'too-many' });
    try {
      const { pds } = await resolver.account(source.did);
      const buf = await files.get(pds, source.did, req.cid, { left: RENDER.pictureMaxBytes });
      if (!buf) return send({ error: 'not-found' });
      if (buf.byteLength > RENDER.pictureMaxBytes) return send({ error: 'too-big' });
      const type = sniffPicture(new Uint8Array(buf));
      if (!PICTURE_TYPES.includes(type)) return send({ error: 'not-a-picture' });
      send({ type, bytes: buf });
    } catch (err) {
      send({ error: err instanceof NetError && err.code === 'too-large' ? 'too-big' : 'not-found' });
    }
  }

  // "Open in ▾" (RT3): the explorers, the remembered one ticked; choosing one opens the record in a new window (no
  // opener, no referrer) and remembers it for records, as the link message does.
  function toggleOpenIn(open = openInMenu.hidden) {
    if (!open) { openInMenu.hidden = true; openInBtn.setAttribute('aria-expanded', 'false'); return; }
    const uri = paneFor(tabs.active).record?.uri;
    if (!uri) return;
    const chosen = recordApp(storage);
    openInMenu.replaceChildren(
      ...RECORD_APPS.map((a) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': a.id === chosen.id ? 'true' : 'false', class: 'openin-item',
        onclick: () => {
          try { storage?.setItem(RECORD_APP_KEY, a.id); } catch { /* fine: this visit only */ }
          toggleOpenIn(false);
          globalThis.open(explorerLink(a, uri), '_blank', 'noopener,noreferrer');
        } }, h('span', { class: 'openin-tick', 'aria-hidden': 'true' }, a.id === chosen.id ? '✓' : ''), a.name)),
      h('p', { class: 'openin-note' }, 'Remembered for records in this browser.'));
    openInMenu.hidden = false;
    openInBtn.setAttribute('aria-expanded', 'true');
    openInMenu.querySelector('[aria-checked="true"]')?.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (!openInMenu.hidden && !openIn.contains(e.target)) toggleOpenIn(false); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !openInMenu.hidden) { toggleOpenIn(false); openInBtn.focus(); } });

  // Messages from ordinary tiles (tiles-protocol-up-…): logged on their tab's panel. Raku doesn't answer
  // other protocols yet; the panel just shows what was asked. (A renderer's are answered: fromRenderer; a tile with
  // ways has its way messages answered: fromWayTile.)
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    // The tile playing in a tile post (Play here): only its way messages are answered.
    if (playing && playing.frame && playing.frame.contentWindow === e.source) { if (playing.ways && d.action === WAY_UP) fromWayPost(playing, d); return; }
    for (const [id, pane] of panes) {
      if (!pane.frame || pane.frame.contentWindow !== e.source) continue;
      if (pane.renderer) { fromRenderer(pane, d); return; }
      if (pane.ways && d.action === WAY_UP) { fromWayTile(pane, id, d); return; }
      if (!pane.panel) continue;
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
      h('p', { class: 'lede' }, 'A browser for web tiles. Paste a tile\'s address or someone\'s handle above, or start with one of these.'),
      grid);
    p.el.append(box);
    for (const uri of PICKS) grid.append(pickCard(uri, tab));
    box.append(h('div', { class: 'first-discover' },
      h('button', { type: 'button', class: 'more', onclick: () => goDiscover() }, icon('compass', 16), 'Discover more tiles'),
      h('span', { class: 'small-lede' }, 'Search, and new tiles from the accounts you keep.')));
    drawNewsRow(p, tab, box);
    // "Tables and rooms" (RR5, owner's wording): the tables, then the Rooms card.
    const tables = h('div', { class: 'cards tables' });
    box.append(h('h2', {}, 'Tables and rooms'), h('p', { class: 'small-lede' }, 'Groups of tiles that play together, and rooms for meeting up.'), tables);
    for (const t of Object.values(TABLES)) tables.append(tableCard(t, tab));
    tables.append(roomsCard(tab));
    drawShelfTeaser(pageContext(p, tab), box);
    box.append(h('p', { class: 'small first-about' }, 'Tiles run in their own sealed frames, loaded from their authors\' own accounts. Raku has no sign-in for browsing. ',
      h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, ABOUT_URI) }, 'About Raku: what it keeps, who it talks to \u2192')));
  }

  // The first screen's Tile news row (step 6b, Q85): the latest three posts from the Web Tiles feed, each opening
  // Tile news on Discover; More does too. Hidden when the feed can't be read or is empty.
  function drawNewsRow(p, tab, box) {
    if (!discover.feed) return;
    const mine = p.attempt;
    // NR1, NR2 (claude/raku-baked-picks-plan.md): the row holds its place from the start: three faint placeholders the
    // size of real items, replaced by the posts, or by a quiet line when the feed fails or has none. Nothing below moves.
    const placeholder = () => h('div', { class: 'news-item news-placeholder', 'aria-hidden': 'true' },
      h('span', { class: 'news-av' }),
      h('span', { class: 'news-words' }, h('span', { class: 'news-who' }, h('span', { class: 'news-ph' })),
        h('span', { class: 'news-text' }, h('span', { class: 'news-ph' }), h('span', { class: 'news-ph short' }))));
    const list = h('div', { class: 'news-row', 'aria-busy': 'true' }, placeholder(), placeholder(), placeholder());
    const part = h('section', { class: 'first-news' },
      h('div', { class: 'first-news-head' }, h('h2', {}, 'Tile news'),
        h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, discoverUri('news')) }, 'More')),
      list);
    box.append(part);
    const nothing = () => {
      list.style.minHeight = `${list.getBoundingClientRect().height}px`;   // the line keeps the placeholders' space (exactly)
      list.replaceChildren(h('p', { class: 'news-none' }, 'No tile news just now.'));
      list.removeAttribute('aria-busy');
    };
    discover.news().then((r) => {
      if (mine !== p.attempt) return;
      // one item per thread, as on Discover (Q123)
      const items = groupThreads(r.items).added.slice(0, 3).map((g) => g.item);
      if (!items.length) { nothing(); return; }
      list.replaceChildren(...items.map((it) => {
        const a = it.post.author;
        const reply = !!(it.context || it.post.replyTo);
        return h('button', { type: 'button', class: 'news-item', onclick: () => tabs.go(tab.id, discoverUri('news')) },
          h('span', { class: 'news-av' }, a.avatar ? h('img', { src: a.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null),
          h('span', { class: 'news-words' },
            h('span', { class: 'news-who' }, a.displayName || (a.handle ? `@${a.handle}` : 'Someone'),
              reply ? h('span', { class: 'news-reply' }, 'reply') : null),
            h('span', { class: 'news-text' }, (it.post.text || '').split('\n')[0].slice(0, 140) || (it.post.tile ? 'A web tile' : 'A post'))));
      }));
      list.removeAttribute('aria-busy');
    }).catch(() => { if (mine === p.attempt) nothing(); });   // the feed couldn't be read just now
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

  // The Rooms card (RR5): opens a room tab with the join screen; its picture is the house tile's banner.
  function roomsCard(tab) {
    const card = kit.tileCard({ name: ROOMS.name, description: ROOMS.blurb, onOpen: () => goRooms(tab), onOpenNew: () => goRooms(tab, { inNew: true }) });
    card.el.classList.add('rooms-card');
    (async () => {
      const [did, , rkey] = ROOMS.house.uri.replace(/^at:\/\//, '').split('/');
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (d.ok) card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
    })().catch(() => { /* the card stays without a picture */ });
    return card.el;
  }

  function pickCard(uri, tab) {
    const parsed = parseAddress(uri);
    const pickTable = parsed.ok && parsed.actor.startsWith('did:') ? tableForTile(parsed.actor, parsed.rkey) : null;
    const target = pickTable ? tableUri(pickTable.id) : parsed.ok && parsed.actor.startsWith('did:') && isRoomHouse(parsed.actor, parsed.rkey) ? ROOM_URI : uri;
    // Baked picks (claude/raku-baked-picks-plan.md, BP1): a pick baked into Raku draws its whole card at once from
    // Raku's own files; the checks below then run quietly and only change the card if something changed since the
    // bake. A pick with no baked copy waits for them, as before.
    const baked = bakedPick(uri);
    const card = kit.tileCard({ name: baked ? baked.name : '…', description: baked?.description || '', by: baked?.handle || '',
      onOpen: () => tabs.go(tab.id, target), onOpenNew: () => openNew(target), prepare: parsed.ok && target === uri ? uri : null });
    if (baked?.banner) card.picture({ url: bakedPictureUrl(baked), fallback: { url: appmosphereCopy(baked.did, baked.banner.cid), cid: baked.banner.cid } });
    (async () => {
      if (!parsed.ok) throw new Error('bad pick');
      const did = await resolver.didFor(parsed.actor);
      if (await moderation.isHidden(did, parsed.rkey)) { card.el.remove(); return; }
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, parsed.rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (!d.ok) throw new Error(d.reason);
      card.set({ name: d.name, description: d.description });
      // the banner from appmosphe.re's copy (one fast server; the picks are the same for everyone, so this reveals
      // nothing), else from the author's own server as before (Q128, Q129); a baked pick keeps its own copy unless
      // the banner changed since the bake
      const cid = bannerCid(d.manifest);
      if (!baked || cid !== (baked.banner?.cid || null)) card.picture({ url: appmosphereCopy(did, cid), fallback: { pds: acct.pds, did, cid } }, { replace: !!baked });
      // a baked handle stays unless a different one checks out now
      resolver.checkedHandle(did).then((hd) => { if (!baked || hd) card.set({ by: hd || '' }); });
    })().catch(() => { if (!baked) card.set({ name: "Couldn't load this pick", greyed: true }); });   // a baked card stays as baked
    return card.el;
  }

  // ---------- drawing the chrome ----------
  // Rooms step 4 (RR28): a room tab in a call shows the call's marker instead of its dot. Its own small target: a click
  // folds or unfolds the call bar and leaves you on the tab you're on (the rest of the tab brings the room forward).
  function roomMarker(tab, { sheetRow = false } = {}) {
    const e = rooms.inCall(tab.id);
    if (!e) return null;
    if (sheetRow) return e.sheetMarker;
    e.marker.onclick = (ev) => {
      if (tab.id === tabs.active.id) return;            // the room is in front: its controls are right there
      ev.stopPropagation();
      e.bar.toggle();
    };
    e.marker.title = `${e.marker.getAttribute('aria-label') || 'In a room'}. Click to ${e.bar.folded ? 'show' : 'fold'} the call bar.`;
    return e.marker;
  }
  function tabButton(tab) {
    const p = paneFor(tab);
    const on = tab.id === tabs.active.id;
    const mark = roomMarker(tab) || (p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state }));
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
          roomMarker(tab, { sheetRow: true }) || (p.icon ? h('img', { class: 'tab-icon', src: p.icon, alt: '' }) : h('span', { class: 'tab-dot', 'data-state': p.state })),
          h('span', { class: 'tab-title' }, p.title),
          p.mark ? h('span', { class: 'tab-signal', title: p.mark.title, 'aria-label': p.mark.title }, '●') : null),
        h('button', { type: 'button', class: 'sheet-x', 'aria-label': `Close ${p.title}`, onclick: () => { tabs.close(tab.id); drawSheet(); } }, icon('close', 18)));
    }));
  }

  function drawChrome() {
    showExpanded();
    showCall();
    strip.replaceChildren(...tabs.list.map(tabButton));
    const tab = tabs.active;
    const p = paneFor(tab);
    if (document.activeElement !== input) input.value = p.shownAddress || '';
    backBtn.disabled = backTool.disabled = !tabs.canBack(tab.id);
    fwdBtn.disabled = fwdTool.disabled = !tabs.canForward(tab.id);
    reloadBtn.disabled = reloadTool.disabled = !current(tab);
    const k = p.keep;
    starBtn.hidden = !k;
    postBtn.hidden = !(k && k.kind === 'tile' && canPostTile(k.did, auth.list()));
    openIn.hidden = !p.record;
    if (!p.record && !openInMenu.hidden) toggleOpenIn(false);
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
    // every icon link (favicon.ico, the PNG and the SVG, Oct 22), so the pip shows whichever one the browser uses;
    // each goes back to its own picture when the mark goes
    for (const link of document.querySelectorAll('link[rel="icon"]')) {
      if (!link.dataset.own) link.dataset.own = link.getAttribute('href');
      link.href = marked ? ICON_WITH_PIP : link.dataset.own;
    }
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
    if (what?.type === 'reload') { const p = panes.get(what.id); if (p) { p.uri = undefined; p.freshRecord = true; } }
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
  // Raku opened from an invite link (#r=…, rooms step 1): a room tab with that room's join screen; Raku's address
  // then holds the tab (raku:room), never the code (RR2).
  const startInvite = roomInHash(loc.hash);
  if (startInvite) { sync(); rooms.takeInvite(startInvite); } else if (!tabs.fromHash(loc.hash)) sync();
  // Back from "Sign in in this tab instead" at a room's join screen: that room's join screen again.
  if (pendingReturn && pendingReturn.kind === 'room') { const r = pendingReturn; pendingReturn = null; if (r.code) rooms.takeInvite({ room: r.code, hostKey: null }); }
  // Back from signing in in this tab to heart a post (HT6, HT14): give the heart, if the sign-in allows hearts.
  if (pendingReturn && pendingReturn.kind === 'heart') {
    const r = pendingReturn; pendingReturn = null;
    const a = auth.current();
    if (a && a.did && auth.coversHearts(a.did) && typeof r.uri === 'string' && typeof r.cid === 'string') {
      hearts.readYours(a.did).catch(() => null).finally(() => { if (!hearts.hearted(a.did, r.uri)) hearts.set(a.did, { uri: r.uri, cid: r.cid }, true).catch(() => say("Couldn't save your heart. Try again.")); });
    }
  }
  if (returned) say(returned.did && auth.current() ? `Signed in as @${auth.current().handle}.` : "Sign-in didn't finish. Try again.");
  globalThis.addEventListener?.('hashchange', () => {
    const inv = roomInHash(loc.hash);
    if (inv) { hist.replaceState(null, '', tabs.toHash()); rooms.takeInvite(inv); return; }
    if (loc.hash !== tabs.toHash()) tabs.fromHash(loc.hash);
  });
  // (for the checks and curious eyes: the table in the front tab, if any; the rooms)
  return { tabs, openNew, say, menu, showUpdate, rooms, get table() { return paneFor(tabs.active).table; } };
}
