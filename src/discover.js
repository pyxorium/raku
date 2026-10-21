// Discover (stage 6, claude/raku-stage6-plan.md): a page inside a tab, like your shelf.
//
// Three columns on a wide window (the owner's idea, like Bluesky's main screen, Q85 and Q86):
//   left    the sources: Tile news (step 6b), Following, Search results;
//   centre  the search box (Q95 C) and the chosen source, widest;
//   right   previews of the other sources (the latest few of each); clicking one brings it to the centre.
// Narrower windows: the left column shrinks to icons, then the right column drops (style.css). A phone: one
// column, with the sources as chips across the top. Nothing on this page runs a tile: cards only, and a tile
// opens in the tab when its card is clicked.
//
// Addresses (address.js): raku:discover, raku:discover/following, raku:discover/news, raku:search/<words>.

import { PICKS, SEARCH, feedUri, postApp } from './config.js';
import { atUri, discoverUri, searchUri, accountPageUri, parseAddress, SHELF_URI, DISCOVER_URI } from './address.js';
import { describeTile } from './tiles.js';
import { NetError } from './net.js';
import { h, bannerCid } from './cards.js';
import { icon } from './icons.js';
import { createFollowing } from './following.js';
import { createPublicReads } from './bluesky.js';
import { readPost, threadContext } from './posts.js';
import { postCard, threadCard } from './post-card.js';
import { searchAppmosphere, localMatches } from './search.js';

const SEARCH_KEEP_MS = 5 * 60 * 1000;

/** What Discover keeps while Raku is open (shared by every Discover tab). */
export function createDiscover({ resolver, moderation, shelf, storage = null, loc = globalThis.location, fetchImpl = globalThis.fetch } = {}) {
  const following = createFollowing({ resolver, moderation, shelf, storage });
  const reads = createPublicReads({ fetchImpl });
  const feed = feedUri(loc);
  const searches = new Map();   // query -> { at, remote, error }
  let lastQuery = null;

  /** Tile news (step 6b turns it on): the feed's posts, as post data, without hidden posts or hidden accounts.
   *  A reply comes with its thread context (Q97): the thread's first post and the post it answers, each checked
   *  the same way (a hidden one is shown as "Post not available"). → { items: [{ post, context }], posts, cursor } */
  async function news({ cursor = null, fresh = false } = {}) {
    const page = await reads.getFeed(feed, { cursor, fresh });
    const items = [];
    const hiddenAccount = (p) => p && !p.unavailable && moderation.isAccountHidden(p.did);
    for (const it of page.items) {
      const post = readPost(it.post);
      if (!post || post.moderation.hide) continue;
      if (await moderation.isAccountHidden(post.did)) continue;     // the hide list's accounts, and Bluesky's own account moderation
      const context = threadContext(it);
      if (context) {
        for (const k of ['root', 'parent']) if (await hiddenAccount(context[k])) context[k] = { unavailable: true, uri: context[k].uri };
      }
      items.push({ post, context });
    }
    return { items, posts: items.map((x) => x.post), cursor: page.cursor };
  }

  /** appmosphe.re's answer for some words (kept a few minutes). → { remote: [{ actor, rkey, uri }], error } */
  async function remote(query, { fresh = false } = {}) {
    const k = searches.get(query);
    if (k && !fresh && Date.now() - k.at < SEARCH_KEEP_MS) return k;
    let value;
    try { value = { at: Date.now(), remote: await searchAppmosphere(query, { fetchImpl }), error: null }; } catch (err) {
      value = { at: Date.now(), remote: [], error: err instanceof NetError ? err.message : `Couldn't reach ${SEARCH.name}.` };
    }
    if (!value.error) searches.set(query, value);
    return value;
  }

  /** Tiles Raku already has in hand, for "On your shelf" matches: the picks and Following's tiles. */
  async function inHand() {
    const out = [];
    const picks = await Promise.all(PICKS.map(async (uri) => {
      try {
        const a = parseAddress(uri);
        const rec = await resolver.tileRecord(a.actor, a.rkey);
        const d = describeTile(rec);
        return d.ok ? { did: a.actor, rkey: a.rkey, name: d.name, description: d.description, by: '' } : null;
      } catch { return null; }
    }));
    out.push(...picks.filter(Boolean));
    for (const it of following.cached?.items || []) {
      const d = describeTile(it.record);
      if (d.ok) out.push({ did: it.did, rkey: it.rkey, name: d.name, description: d.description, by: '' });
    }
    return out;
  }

  return {
    following, reads, feed, news, remote, inHand,
    get lastQuery() { return lastQuery; },
    set lastQuery(q) { lastQuery = q; },
    cachedSearch: (q) => searches.get(q) || null,
    app: () => postApp(storage),
  };
}

const SOURCES = {
  news: { label: 'Tile news', icon: 'news', blurb: 'Posts about web tiles, from the Web Tiles feed.' },
  following: { label: 'Following', icon: 'people', blurb: 'New tiles from the accounts on your shelf, newest first.' },
  search: { label: 'Search results', icon: 'search', blurb: '' },
};

/** Draws Discover in a tab. ctx: the page context (app.js pageContext) with discover and linkMessage. */
export function drawDiscover(ctx, { source = null, query = '' } = {}) {
  const { p, tab, tabs, discover, drawChrome } = ctx;
  const sources = [...(discover.feed ? ['news'] : []), 'following'];
  if (source === 'search') discover.lastQuery = query;
  if (discover.lastQuery) sources.push('search');
  const current = source || sources[0];
  const uriFor = (s) => (s === 'search' ? searchUri(discover.lastQuery) : discoverUri(s));

  p.title = current === 'search' ? `Search: ${query}` : 'Discover';
  p.shownAddress = current === 'search' ? query : '';
  p.keep = null;
  p.state = 'ready';
  drawChrome();

  // ---- the search box (top of the centre) and the sources (left) ----
  const box = h('input', { type: 'search', name: 'q', class: 'dv-q', placeholder: 'Search tiles', 'aria-label': 'Search for tiles', autocomplete: 'off', spellcheck: 'false', maxlength: '200' });
  box.value = current === 'search' ? query : '';
  // An emptied box leaves search (Q99): Discover's first source, and "Search results" gone from the sources.
  const leave = () => {
    discover.lastQuery = null;
    tabs.go(tab.id, current === 'search' ? DISCOVER_URI : uriFor(current));
  };
  const form = h('form', { class: 'dv-search', role: 'search', onsubmit: (ev) => {
    ev.preventDefault();
    const q = box.value.trim();
    if (q) tabs.go(tab.id, searchUri(q));
    else if (discover.lastQuery) leave();
  } }, box, h('button', { type: 'submit', class: 'dv-go', title: 'Search', 'aria-label': 'Search' }, icon('search', 18)));
  // the box's own × (a search box's clear button) empties it: leave search too
  box.addEventListener('search', () => { if (!box.value.trim() && discover.lastQuery) leave(); });
  const nav = h('nav', { class: 'dv-sources', 'aria-label': 'Discover' },
    sources.map((s) => h('button', {
      type: 'button', class: `dv-src${s === current ? ' on' : ''}`, 'data-source': s, title: SOURCES[s].label,
      'aria-current': s === current ? 'page' : null, onclick: () => tabs.go(tab.id, uriFor(s)),
    }, icon(SOURCES[s].icon, 20), h('span', { class: 'dv-src-label' }, SOURCES[s].label))));
  const left = h('aside', { class: 'dv-left' }, nav);

  // ---- centre and right ----
  const centre = h('section', { class: 'dv-centre', 'aria-label': SOURCES[current].label }, form);
  const right = h('aside', { class: 'dv-right', 'aria-label': 'More to discover' });
  p.el.append(h('div', { class: 'discover', 'data-source': current }, left, centre, right));

  if (current === 'following') drawFollowing(ctx, centre);
  else if (current === 'news') drawNews(ctx, centre);
  else drawSearch(ctx, centre, query);

  const others = sources.filter((s) => s !== current);
  for (const s of others) right.append(preview(ctx, s, uriFor(s)));
  right.append(h('div', { class: 'dv-about' },
    h('p', {}, `Search looks at your shelf first, here in this browser, then asks ${SEARCH.name}.`),
    h('p', {}, 'Nothing on this page runs: a tile starts only when you open its card.')));
}

// ---------- Following ----------
function drawFollowing(ctx, into) {
  const { shelf, tabs, tab, discover, alive } = ctx;
  const head = h('div', { class: 'dv-head' }, h('h1', {}, 'Following'), h('p', { class: 'sub' }, SOURCES.following.blurb));
  into.append(head);
  if (!shelf.accounts().length) {
    into.append(h('div', { class: 'dv-empty' },
      h('p', {}, "Keep an account on your shelf and its new tiles show up here. Type someone's handle in the address box, then press the star at the end of the box."),
      h('button', { type: 'button', class: 'more', onclick: () => tabs.go(tab.id, SHELF_URI) }, 'Your shelf')));
    return;
  }
  const status = h('p', { class: 'dv-status' }, 'Looking for new tiles…');
  const grid = h('div', { class: 'cards' });
  const refresh = h('button', { type: 'button', class: 'dv-refresh', title: 'Look again now' }, icon('reload', 16), 'Refresh');
  head.append(refresh);
  into.append(status, grid);
  const fill = async (fresh) => {
    refresh.disabled = true;
    const r = await discover.following.load({ fresh });
    if (!alive()) return;
    refresh.disabled = false;
    grid.replaceChildren();
    const newCount = r.items.filter((it) => discover.following.isNew(it)).length;
    status.textContent = r.items.length
      ? `${r.items.length} tile${r.items.length === 1 ? '' : 's'} from ${r.accounts} account${r.accounts === 1 ? '' : 's'}${newCount ? ` · ${newCount} new since your last visit` : ''}.`
      : 'No tiles yet from the accounts on your shelf.';
    if (r.unreachable) status.textContent += ` Couldn't reach ${r.unreachable} account${r.unreachable === 1 ? '' : 's'} just now.`;
    for (const it of r.items) grid.append(tileItemCard(ctx, it, { badge: discover.following.isNew(it) ? 'New' : '' }).el);
    discover.following.markSeen();
  };
  refresh.addEventListener('click', () => fill(true));
  fill(false).catch(() => { if (alive()) status.textContent = "Couldn't look for new tiles just now."; });
}

/** A card for a tile Raku has the record of (Following). */
function tileItemCard(ctx, it, { badge = '' } = {}) {
  const { kit, tabs, tab, openNew, resolver } = ctx;
  const d = describeTile(it.record);
  const uri = atUri(it.did, it.rkey);
  const card = kit.tileCard({ name: d.name, description: d.description, badge, onOpen: () => tabs.go(tab.id, uri), onOpenNew: () => openNew(uri) });
  resolver.account(it.did).then((acct) => card.picture({ pds: acct.pds, did: it.did, cid: bannerCid(d.manifest) })).catch(() => {});
  resolver.checkedHandle(it.did).then((hd) => card.set({ by: hd || '' }));
  return card;
}

/** A card for a tile known only by its address (search results): looked up first; null when it shouldn't show. */
function addressCard(ctx, addr, onGone) {
  const { kit, tabs, tab, openNew, resolver, moderation } = ctx;
  let uri = addr.uri;
  const card = kit.tileCard({ name: '…', onOpen: () => tabs.go(tab.id, uri), onOpenNew: () => openNew(uri) });
  const job = async () => {
    try {
      const did = await resolver.didFor(addr.actor);
      if (await moderation.isHidden(did, addr.rkey)) { card.el.remove(); onGone(); return; }
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, addr.rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (!d.ok) { card.el.remove(); onGone(); return; }
      uri = atUri(did, addr.rkey);
      card.set({ name: d.name, description: d.description });
      card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
      resolver.checkedHandle(did).then((hd) => card.set({ by: hd || '' }));
    } catch { card.el.remove(); onGone(); }
  };
  return { el: card.el, job };
}

function limiter(max) {
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < max && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  };
  return (job) => { queue.push(job); pump(); };
}

// ---------- Tile news (shown once FEED is set, step 6b; ?feed= on this computer) ----------
function drawNews(ctx, into) {
  const { discover, alive } = ctx;
  into.append(h('div', { class: 'dv-head' }, h('h1', {}, 'Tile news'), h('p', { class: 'sub' }, SOURCES.news.blurb)));
  const list = h('div', { class: 'posts' });
  const status = h('p', { class: 'dv-status' }, 'Loading posts…');
  const more = h('button', { type: 'button', class: 'more', hidden: true }, 'More');
  into.append(status, list, more);
  let cursor = null;
  const drawn = new Set();
  const postCtx = postContext(ctx, 'Tile news');
  const page = async () => {
    more.disabled = true;
    try {
      const r = await discover.news({ cursor });
      if (!alive()) return;
      for (const it of r.items) {
        // A post already drawn (on its own or as a reply's context) isn't drawn again further down.
        if (drawn.has(it.post.uri)) continue;
        drawn.add(it.post.uri);
        if (it.context) for (const k of ['root', 'parent']) if (it.context[k] && it.context[k].uri) drawn.add(it.context[k].uri);
        list.append(it.context ? threadCard(it.post, it.context, postCtx) : postCard(it.post, postCtx));
      }
      cursor = r.cursor;
      status.textContent = list.childElementCount ? '' : 'No posts yet.';
      status.hidden = !status.textContent;
    } catch (err) {
      if (!alive()) return;
      status.hidden = false;
      status.textContent = err instanceof NetError ? err.message : "Couldn't load Tile news just now.";
    }
    more.hidden = !cursor;
    more.disabled = false;
  };
  more.addEventListener('click', page);
  page();
}

function postContext(ctx, from) {
  const { kit, resolver, moderation, linkMessage, tabs, tab, openNew, discover } = ctx;
  return {
    kit, resolver, moderation, linkMessage, from, app: discover.app(),
    openTile: (uri) => tabs.go(tab.id, uri),
    openTileNew: (uri) => openNew(uri),
    openAccount: (did) => tabs.go(tab.id, accountPageUri(did)),
  };
}

// ---------- Search results ----------
function drawSearch(ctx, into, query) {
  const { kit, shelf, tabs, tab, discover, alive, moderation } = ctx;
  into.append(h('div', { class: 'dv-head' }, h('h1', {}, `Results for “${query}”`)));
  const mine = h('section', { class: 'dv-part', hidden: true }, h('h2', {}, 'Already in Raku'),
    h('p', { class: 'dv-part-note' }, 'From your shelf, Following and the picks, searched here in this browser.'));
  const theirs = h('section', { class: 'dv-part' }, h('h2', {}, `From ${SEARCH.name}`));
  const status = h('p', { class: 'dv-status' }, `Asking ${SEARCH.name}…`);
  const grid = h('div', { class: 'cards' });
  theirs.append(status, grid);
  const foot = h('p', { class: 'dv-foot' }, `Searched with ${SEARCH.name}. Only the words you searched for were sent; "Already in Raku" was searched here in this browser.`);
  into.append(mine, theirs, foot);

  // Yours first, found here (nothing is sent).
  (async () => {
    const others = await discover.inHand();
    if (!alive()) return;
    const found = localMatches(query, { shelf, others });
    if (!found.tiles.length && !found.accounts.length) return;
    mine.hidden = false;
    if (found.accounts.length) {
      const row = h('div', { class: 'chips' });
      for (const a of found.accounts) {
        const chip = kit.accountChip({ handle: a.handle, did: a.did, onOpen: () => tabs.go(tab.id, accountPageUri(a.handle || a.did)) });
        row.append(chip.el);
        moderation.profile(a.did).then((prof) => chip.set({ avatar: prof.avatar }));
      }
      mine.append(row);
    }
    if (found.tiles.length) {
      const g = h('div', { class: 'cards' });
      const run = limiter(3);
      for (const t of found.tiles) {
        const c = addressCard(ctx, { actor: t.did, rkey: t.rkey, uri: atUri(t.did, t.rkey) }, () => {});
        g.append(c.el);
        run(c.job);
      }
      mine.append(g);
    }
  })().catch(() => {});

  // Then appmosphe.re.
  const ask = async (fresh) => {
    status.hidden = false;
    status.textContent = `Asking ${SEARCH.name}…`;
    grid.replaceChildren();
    const r = await discover.remote(query, { fresh });
    if (!alive()) return;
    if (r.error) {
      status.textContent = `${r.error} `;
      status.append(h('button', { type: 'button', class: 'linkish', onclick: () => ask(true) }, 'Try again'));
      return;
    }
    let shown = r.remote.length;
    const none = () => { status.hidden = false; status.textContent = `${SEARCH.name} found no tiles for “${query}”.`; };
    if (!shown) { none(); return; }
    status.hidden = true;
    const run = limiter(4);
    for (const addr of r.remote) {
      const c = addressCard(ctx, addr, () => { shown--; if (!shown && alive()) none(); });
      grid.append(c.el);
      run(c.job);
    }
  };
  ask(false);
}

// ---------- the right column: previews of the other sources ----------
function preview(ctx, source, uri) {
  const { tabs, tab, discover, kit, resolver, alive } = ctx;
  const count = h('span', { class: 'dv-pv-count' });
  const list = h('span', { class: 'dv-pv-list' }, h('span', { class: 'dv-pv-wait' }, 'Loading…'));
  const btn = h('button', { type: 'button', class: 'dv-preview', 'data-source': source, onclick: () => tabs.go(tab.id, uri) },
    h('span', { class: 'dv-pv-head' }, icon(SOURCES[source].icon, 16), h('span', {}, source === 'search' ? `Search: ${discover.lastQuery}` : SOURCES[source].label), count),
    list);
  const row = (title, sub, picRef) => {
    const pic = picRef ? h('span', { class: 'dv-mini-pic' }) : null;
    if (pic) kit.picture(pic, picRef);
    return h('span', { class: 'dv-mini' }, pic, h('span', { class: 'dv-mini-words' }, h('span', { class: 'dv-mini-title' }, title), sub ? h('span', { class: 'dv-mini-sub' }, sub) : null));
  };
  const fill = (rows, empty) => { list.replaceChildren(...(rows.length ? rows : [h('span', { class: 'dv-pv-wait' }, empty)])); };
  (async () => {
    if (source === 'following') {
      if (!ctx.shelf.accounts().length) { fill([], 'Keep accounts on your shelf to follow their new tiles.'); return; }
      const r = await discover.following.load();
      if (!alive()) return;
      const n = r.items.filter((it) => discover.following.isNew(it)).length;
      count.textContent = n ? `${n} new` : '';
      const rows = [];
      for (const it of r.items.slice(0, 3)) {
        const d = describeTile(it.record);
        const acct = await resolver.account(it.did).catch(() => null);
        const hd = await resolver.checkedHandle(it.did);
        rows.push(row(d.name, hd ? `@${hd}` : '', acct ? { pds: acct.pds, did: it.did, cid: bannerCid(d.manifest) } : null));
      }
      if (alive()) fill(rows, 'No tiles yet.');
    } else if (source === 'news') {
      const r = await discover.news();
      if (!alive()) return;
      fill(r.posts.slice(0, 3).map((post) => row(post.author.displayName || `@${post.author.handle || 'someone'}`, post.text.slice(0, 90), null)), 'No posts yet.');
    } else {
      const r = discover.cachedSearch(discover.lastQuery);
      const n = r ? r.remote.length : 0;
      fill(n ? [row(`${n} tile${n === 1 ? '' : 's'} found`, `From ${SEARCH.name}`, null)] : [], 'See the results again.');
    }
  })().catch(() => fill([], "Couldn't load this just now."));
  return btn;
}
