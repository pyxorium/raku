// Discover (stage 6, claude/raku-stage6-plan.md): a page inside a tab, like your shelf.
//
// Three columns on a wide window (the owner's idea, like Bluesky's main screen, Q85 and Q86):
//   left    the sources: Tile news (step 6b), Recent tiles (stage 6c), Following, Search results; then, set
//           apart at the bottom, Make a tile (stage 6c: a page of tile makers, not a reading source);
//   centre  the search box (Q95 C) and the chosen source, widest;
//   right   previews of the other sources (the latest few of each); clicking one brings it to the centre.
// Narrower windows: the left column shrinks to icons, then the right column drops (style.css). A phone: one
// column, with the sources as chips across the top. Nothing on this page runs a tile: cards only, and a tile
// opens in the tab when its card is clicked.
//
// Addresses (address.js): raku:discover, raku:discover/news, raku:discover/recent, raku:discover/following,
// raku:discover/make, raku:search/<words>.

import { PICKS, SEARCH, RECENT, MAKE, FEED, NEWS_PINS, siteLabel, feedUri, postApp, appmosphereCopy } from './config.js';
import { atUri, discoverUri, searchUri, accountPageUri, parseAddress, parsePost, SHELF_URI, DISCOVER_URI, ABOUT_URI } from './address.js';
import { describeTile } from './tiles.js';
import { NetError } from './net.js';
import { h, bannerCid } from './cards.js';
import { icon } from './icons.js';
import { createFollowing } from './following.js';
import { createRecent } from './recent.js';
import { createMarks } from './marks.js';
import { createPublicReads } from './bluesky.js';
import { readPost, threadContext, whenText, groupThreads } from './posts.js';
import { postCard, threadCard } from './post-card.js';
import { searchAppmosphere, localMatches } from './search.js';

const SEARCH_KEEP_MS = 5 * 60 * 1000;

/** A post's time in ms for ordering Tile news (its own createdAt, else when Bluesky saw it); unknown sorts last. */
function postTime(...isos) {
  for (const iso of isos) { const t = Date.parse(iso); if (Number.isFinite(t)) return t; }
  return -Infinity;
}
const strip = ({ t, ...item }) => item;

/** What Discover keeps while Raku is open (shared by every Discover tab). */
export function createDiscover({ resolver, moderation, shelf, storage = null, loc = globalThis.location, fetchImpl = globalThis.fetch, pins = null } = {}) {
  const marks = createMarks({ storage });
  const following = createFollowing({ resolver, moderation, shelf, storage, marks });
  const recent = createRecent({ moderation, marks, fetchImpl });
  const reads = createPublicReads({ fetchImpl });
  const feed = feedUri(loc);
  const pinList = pins || (feed === FEED ? NEWS_PINS : []);   // hand-picked posts go with the real feed only
  const searches = new Map();   // query -> { at, remote, error }
  let lastQuery = null;

  /** Tile news (step 6b turns it on): the feed's posts, as post data, without hidden posts or hidden accounts.
   *  A reply comes with its thread context (Q97): the thread's first post and the post it answers, each checked
   *  the same way (a hidden one is shown as "Post not available").
   *  Hand-picked posts (NEWS_PINS, P1 A) are mixed in by date: a page gets the ones dated between its oldest post
   *  and the previous page's oldest, each placed before the first feed post older than it; the feed's last page
   *  gets all the older ones. The cursor is Raku's own ({ feed, before }): pass back what this returned.
   *  → { items: [{ post, context, pinned? }], posts, cursor } */
  async function news({ cursor = null, fresh = false } = {}) {
    const before = cursor && Number.isFinite(cursor.before) ? cursor.before : Infinity;
    const [page, pinViews] = await Promise.all([reads.getFeed(feed, { cursor: cursor ? cursor.feed : null, fresh }), pinned()]);
    // The feed's end: no cursor, or an empty page (some feeds hand out a cursor to nothing).
    const last = !page.cursor || !page.items.length;
    let oldest = before;
    for (const it of page.items) { const t = postTime(it.post?.record?.createdAt, it.post?.indexedAt); if (Number.isFinite(t) && t < oldest) oldest = t; }
    const floor = last ? -Infinity : oldest;
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
    // The hand-picked posts for this page, newest first, each checked like a feed post.
    const inFeed = new Set(page.items.map((it) => it.post.uri));
    const extra = [];
    for (const v of pinViews) {
      if (inFeed.has(v.uri)) continue;
      const post = readPost(v);
      if (!post || post.moderation.hide) continue;
      const t = postTime(post.createdAt);
      if (!(t >= floor && t < before)) continue;
      if (await moderation.isAccountHidden(post.did)) continue;
      extra.push({ post, context: null, pinned: true, t });
    }
    extra.sort((a, b) => b.t - a.t);
    const merged = [];
    for (const it of items) {
      const t = postTime(it.post.createdAt);
      while (extra.length && extra[0].t > t) merged.push(strip(extra.shift()));
      merged.push(it);
    }
    for (const x of extra) merged.push(strip(x));
    return { items: merged, posts: merged.map((x) => x.post), cursor: last ? null : { feed: page.cursor, before: oldest } };
  }

  // The hand-picked posts' views, read once (25 to a request); a failed read is tried again next time and the
  // feed is shown without them meanwhile.
  let pinJob = null;
  function pinned() {
    if (!pinList.length) return Promise.resolve([]);
    if (!pinJob) {
      pinJob = (async () => {
        const out = [];
        for (let i = 0; i < pinList.length; i += 25) out.push(...await reads.getPosts(pinList.slice(i, i + 25)));
        return out.filter((v) => v && typeof v.uri === 'string');
      })();
      pinJob.catch(() => { pinJob = null; });
    }
    return pinJob.catch(() => []);
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

  /** Tiles Raku already has in hand, for "Already in Raku" matches: the picks, Following's tiles and the
   *  Recent tiles already loaded. */
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
    for (const t of recent.loaded()) out.push({ did: t.did, rkey: t.rkey, name: t.name, description: t.description, by: t.handle });
    return out;
  }

  return {
    following, recent, reads, feed, news, remote, inHand,
    get lastQuery() { return lastQuery; },
    set lastQuery(q) { lastQuery = q; },
    cachedSearch: (q) => searches.get(q) || null,
    app: () => postApp(storage),
  };
}

const SOURCES = {
  news: { label: 'Tile news', icon: 'news', blurb: 'Posts about web tiles, from the Web Tiles feed.' },
  recent: { label: 'Recent tiles', icon: 'clock', blurb: `The newest tiles on the network, as listed by ${RECENT.name}.` },
  following: { label: 'Following', icon: 'people', blurb: 'New tiles from the accounts on your shelf, newest first.' },
  search: { label: 'Search results', icon: 'search', blurb: '' },
  make: { label: 'Make a tile', icon: 'brush', blurb: '' },
};

/** Draws Discover in a tab. ctx: the page context (app.js pageContext) with discover and linkMessage. */
export function drawDiscover(ctx, { source = null, query = '' } = {}) {
  const { p, tab, tabs, discover, drawChrome } = ctx;
  const sources = [...(discover.feed ? ['news'] : []), 'recent', 'following'];
  if (source === 'search') discover.lastQuery = query;
  if (discover.lastQuery) sources.push('search');
  const current = source || sources[0];
  const uriFor = (s) => (s === 'search' ? searchUri(discover.lastQuery) : discoverUri(s));

  p.title = current === 'search' ? `Search: ${query}` : current === 'make' ? 'Make a tile' : 'Discover';
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
  const srcButton = (s, extra = '') => h('button', {
    type: 'button', class: `dv-src${extra}${s === current ? ' on' : ''}`, 'data-source': s, title: SOURCES[s].label,
    'aria-current': s === current ? 'page' : null, onclick: () => tabs.go(tab.id, uriFor(s)),
  }, icon(SOURCES[s].icon, 20), h('span', { class: 'dv-src-label' }, SOURCES[s].label));
  // Make a tile sits apart at the bottom of the column (an icon when narrow, the last chip on a phone).
  const nav = h('nav', { class: 'dv-sources', 'aria-label': 'Discover' },
    sources.map((s) => srcButton(s)), h('span', { class: 'dv-src-gap', 'aria-hidden': 'true' }), srcButton('make', ' dv-make'));
  const left = h('aside', { class: 'dv-left' }, nav);

  // ---- centre and right ----
  const centre = h('section', { class: 'dv-centre', 'aria-label': SOURCES[current].label }, form);
  const right = h('aside', { class: 'dv-right', 'aria-label': 'More to discover' });
  p.el.append(h('div', { class: 'discover', 'data-source': current }, left, centre, right));
  // On a phone the sources are a row of chips that scrolls sideways: bring the chosen one into view.
  const on = nav.querySelector('.dv-src.on');
  if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - 16);

  if (current === 'following') drawFollowing(ctx, centre);
  else if (current === 'news') drawNews(ctx, centre);
  else if (current === 'recent') drawRecent(ctx, centre);
  else if (current === 'make') drawMake(ctx, centre);
  else drawSearch(ctx, centre, query);

  const others = sources.filter((s) => s !== current);
  for (const s of others) right.append(preview(ctx, s, uriFor(s)));
  right.append(h('div', { class: 'dv-about' },
    h('p', {}, `Search looks at your shelf first, here in this browser, then asks ${SEARCH.name}.`),
    h('p', {}, 'Nothing on this page runs: a tile starts only when you open its card.'),
    h('p', {}, h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, ABOUT_URI) }, 'About Raku \u2192'))));
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

/** A card for a tile known only by its address (search results): looked up first; null when it shouldn't show.
 *  copies (Q129): draw its banner from appmosphe.re's copy (only for results appmosphe.re itself gave). */
function addressCard(ctx, addr, onGone, { copies = false } = {}) {
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
      const cid = bannerCid(d.manifest);
      card.picture(copies ? { url: appmosphereCopy(did, cid), fallback: { pds: acct.pds, did, cid } } : { pds: acct.pds, did, cid });
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

// ---------- Make a tile (stage 6c, Q101/Q102) ----------
// Raku's own list of tile makers (config.js MAKE): Open goes straight to a new tab, no link message.
function drawMake(ctx, into) {
  const newTab = (url, kids, cls) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', class: cls }, kids);
  into.append(h('div', { class: 'dv-head' }, h('h1', {}, 'Make a tile'),
    h('p', { class: 'sub mk-intro' }, MAKE.intro, ' ', newTab(MAKE.learn.url, MAKE.learn.text, 'mk-learn'))));
  for (const g of MAKE.groups) {
    const list = h('div', { class: 'mk-list' });
    for (const m of g.makers) {
      list.append(h('article', { class: 'mk-card', 'data-maker': m.id },
        h('span', { class: `mk-mark mk-${m.glaze}`, 'aria-hidden': 'true' }, m.mark),
        h('div', { class: 'mk-words' },
          h('h3', { class: 'mk-name' }, m.name),
          h('p', { class: 'mk-site' }, siteLabel(m.url)),
          h('p', { class: 'mk-line' }, m.line)),
        newTab(m.url, ['Open', icon('newtab', 16)], 'mk-open')));
    }
    into.append(h('section', { class: 'dv-part mk-group' }, h('h2', {}, g.title), list));
  }
}

// ---------- Recent tiles (stage 6c) ----------
function recentCard(ctx, t, { badge = '' } = {}) {
  const { kit, tabs, tab, openNew } = ctx;
  const card = kit.tileCard({ name: t.name, description: t.description, by: t.handle || t.did, when: whenText(t.createdAt), badge,
    onOpen: () => tabs.go(tab.id, t.uri), onOpenNew: () => openNew(t.uri) });
  if (t.picture) card.picture({ url: t.picture }, { look: `${t.pictureIsIcon ? 'icon' : ''} ${t.blur ? 'blur' : ''}` });
  card.el.dataset.uri = t.uri;
  return card;
}

function drawRecent(ctx, into) {
  const { discover, alive } = ctx;
  into.append(h('div', { class: 'dv-head' }, h('h1', {}, 'Recent tiles'), h('p', { class: 'sub' }, SOURCES.recent.blurb)));
  const status = h('p', { class: 'dv-status' }, 'Loading recent tiles…');
  const grid = h('div', { class: 'cards' });
  const more = h('button', { type: 'button', class: 'more', hidden: true }, 'More');
  const end = h('p', { class: 'dv-status dv-end', hidden: true }, `That's every tile ${RECENT.name} lists.`);
  const foot = h('p', { class: 'dv-foot' }, `Listed by ${RECENT.name}.`);
  into.append(status, grid, more, end, foot);
  let next = 1;
  const shown = new Set();
  const page = async () => {
    more.disabled = true;
    more.textContent = 'Loading…';
    try {
      const r = await discover.recent.load(next);
      if (!alive()) return;
      for (const t of r.tiles) {
        if (shown.has(t.uri)) continue;     // the list moved while reading (a new tile pushed one onto the next page)
        shown.add(t.uri);
        grid.append(recentCard(ctx, t, { badge: discover.recent.isNew(t) ? 'New' : '' }).el);
      }
      if (next === 1) discover.recent.markSeen();
      next = r.page + 1;
      status.hidden = !!grid.childElementCount;
      status.textContent = grid.childElementCount ? '' : 'No tiles to show yet.';
      more.hidden = !r.more;
      end.hidden = r.more || !grid.childElementCount;
    } catch (err) {
      if (!alive()) return;
      status.hidden = false;
      status.textContent = `${grid.childElementCount ? 'More tiles' : 'Recent tiles'} couldn't be loaded. `;
      status.append(h('button', { type: 'button', class: 'linkish', onclick: () => page() }, 'Try again'));
      more.hidden = true;
    } finally {
      more.disabled = false;
      more.textContent = 'More';
    }
  };
  more.addEventListener('click', page);
  page();
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
  const seen = { threads: new Map(), posts: new Set() };
  const postCtx = postContext(ctx, 'Tile news');
  const page = async () => {
    more.disabled = true;
    try {
      const r = await discover.news({ cursor });
      if (!alive()) return;
      // One card per thread (Q123): a post already drawn isn't drawn again; later replies in a thread already
      // shown are counted on its card ("+1 more reply in this thread").
      const { added, counted } = groupThreads(r.items, seen);
      for (const g of added) {
        const it = g.item;
        g.el = it.context ? threadCard(it.post, it.context, postCtx) : postCard(it.post, postCtx);
        list.append(g.el);
        if (g.more) moreReplies(g, postCtx);
      }
      for (const g of counted) moreReplies(g, postCtx);
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

/** "+1 more reply in this thread" on a thread's card: opens the thread's first post (through the link message). */
function moreReplies(g, postCtx) {
  if (!g.el) return;
  const n = g.more;
  const words = `+${n} more ${n === 1 ? 'reply' : 'replies'} in this thread`;
  if (g.moreEl) { g.moreEl.firstChild.textContent = words; return; }
  const root = g.item.context && g.item.context.root && !g.item.context.root.unavailable ? g.item.context.root : null;
  const at = parsePost(g.key);
  const actor = (root && root.author && root.author.handle) || (at && at.ok ? at.actor : null);
  if (!actor || !at || !at.ok) return;
  g.moreEl = h('button', { type: 'button', class: 'post-more-replies', title: `Open the thread in ${postCtx.app.name}`,
    onclick: () => postCtx.linkMessage.show({ post: { actor, rkey: at.rkey }, from: `A thread in ${postCtx.from}.` }) }, words);
  g.el.append(g.moreEl);
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
      const c = addressCard(ctx, addr, () => { shown--; if (!shown && alive()) none(); }, { copies: true });
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
    const pic = picRef ? h('span', { class: `dv-mini-pic${picRef.look ? ` ${picRef.look}` : ''}` }) : null;
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
    } else if (source === 'recent') {
      const r = await discover.recent.load(1);
      if (!alive()) return;
      const n = r.tiles.filter((t) => discover.recent.isNew(t)).length;
      count.textContent = n ? `${n} new` : '';
      fill(r.tiles.slice(0, 3).map((t) => row(t.name, t.handle ? `@${t.handle}` : whenText(t.createdAt),
        t.picture ? { url: t.picture, look: [t.pictureIsIcon ? 'is-icon' : '', t.blur ? 'blurred' : ''].filter(Boolean).join(' ') } : null)), 'No tiles yet.');
    } else if (source === 'news') {
      const r = await discover.news();
      if (!alive()) return;
      fill(groupThreads(r.items).added.slice(0, 3).map((g) => g.item.post).map((post) => row(post.author.displayName || `@${post.author.handle || 'someone'}`, post.text.slice(0, 90), null)), 'No posts yet.');
    } else {
      const r = discover.cachedSearch(discover.lastQuery);
      const n = r ? r.remote.length : 0;
      fill(n ? [row(`${n} tile${n === 1 ? '' : 's'} found`, `From ${SEARCH.name}`, null)] : [], 'See the results again.');
    }
  })().catch(() => fill([], "Couldn't load this just now."));
  return btn;
}
