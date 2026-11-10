// Discover (stage 6, claude/raku-stage6-plan.md): a page inside a tab, like your shelf.
//
// Three columns on a wide window (the owner's idea, like Bluesky's main screen, Q85 and Q86):
//   left    the sources: Tile news (step 6b), Tile posts (Nov 2026), Recent tiles (stage 6c), Following, Search results; then, set
//           apart at the bottom, Make a tile (stage 6c: a page of tile makers, not a reading source);
//   centre  the search box (Q95 C) and the chosen source, widest;
//   right   previews of the other sources (the latest few of each); clicking one brings it to the centre.
// Narrower windows: the left column shrinks to icons, then the right column drops (style.css). A phone: one
// column, with the sources as chips across the top. Nothing on this page runs a tile until asked: a tile opens in the
// tab when its card is clicked, and a tile post's tile can play inside its post (Play here, claude/raku-play-here-plan.md).
//
// Addresses (address.js): raku:discover, raku:discover/news, raku:discover/posts, raku:discover/recent,
// raku:discover/following, raku:discover/make, raku:search/<words>.

import { PICKS, SEARCH, RECENT, MAKE, FEED, NEWS_PINS, TILE_POSTS, PLAY_HERE, TAKEDOWNS_PAGE, siteLabel, feedUri, postApp, appmosphereCopy } from './config.js';
import { atUri, discoverUri, searchUri, accountPageUri, parseAddress, parsePost, SHELF_URI, DISCOVER_URI, ABOUT_URI, tilePostUri, TILE_POST_COLLECTION } from './address.js';
import { shareMenu } from './post-share.js';
import { describeTile } from './tiles.js';
import { NetError, formatBytes } from './net.js';
import { h, bannerCid } from './cards.js';
import { icon } from './icons.js';
import { createFollowing } from './following.js';
import { createRecent, createCollapser, earlierLine } from './recent.js';
import { createMarks } from './marks.js';
import { createPublicReads } from './bluesky.js';
import { readPost, threadContext, whenText, groupThreads, ago } from './posts.js';
import { postCard, threadCard } from './post-card.js';
import { searchAppmosphere, localMatches } from './search.js';
import { createTilePosts, tileState, readTilePost } from './tile-posts.js';
import { expandMotion, createAutoplayWatch, autoplaySize, autoplayMayStart } from './play-here.js';
import { switchButton } from './account-menu.js';
import { createExpanded } from './expand-view.js';

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
  const tilePosts = createTilePosts({ resolver, moderation, shelf, fetchImpl });
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
    following, recent, tilePosts, reads, feed, news, remote, inHand,
    get lastQuery() { return lastQuery; },
    set lastQuery(q) { lastQuery = q; },
    cachedSearch: (q) => searches.get(q) || null,
    app: () => postApp(storage),
  };
}

const SOURCES = {
  news: { label: 'Tile news', icon: 'news', blurb: 'Posts about web tiles, from the Web Tiles feed.' },
  posts: { label: 'Tile posts', icon: 'posts', blurb: "Tiles people have posted, with a few words, from their own accounts. Everyone's, newest first." },
  recent: { label: 'Recent tiles', icon: 'clock', blurb: `The newest tiles on the network, as listed by ${RECENT.name}.` },
  following: { label: 'Following', icon: 'people', blurb: 'New tiles from the accounts on your shelf, newest first.' },
  search: { label: 'Search results', icon: 'search', blurb: '' },
  make: { label: 'Make a tile', icon: 'brush', blurb: '' },
};

/** Draws Discover in a tab. ctx: the page context (app.js pageContext) with discover and linkMessage. */
export function drawDiscover(ctx, { source = null, query = '' } = {}) {
  const { p, tab, tabs, discover, drawChrome } = ctx;
  const sources = [...(discover.feed ? ['news'] : []), 'posts', 'recent', 'following'];
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
  else if (current === 'posts') drawTilePosts(ctx, centre);
  else if (current === 'recent') drawRecent(ctx, centre);
  else if (current === 'make') drawMake(ctx, centre);
  else drawSearch(ctx, centre, query);

  const others = sources.filter((s) => s !== current);
  for (const s of others) right.append(preview(ctx, s, uriFor(s)));
  right.append(h('div', { class: 'dv-about' },
    h('p', {}, `Search looks at your shelf first, here in this browser, then asks ${SEARCH.name}.`),
    h('p', {}, 'Nothing on this page runs until you ask: a tile starts when you open its card or press Play here, or, if you turn on Autoplay, when its post has been on screen a moment.'),
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
// Repeats collapse (Oct 30, claude/raku-recent-repeats.md): one card for the same account, name and description,
// the newest, with a quiet "+23 earlier versions" line that opens the account's page (recent.js createCollapser).
function recentCard(ctx, t, { badge = '', earlier = 0 } = {}) {
  const { kit, tabs, tab, openNew } = ctx;
  const card = kit.tileCard({ name: t.name, description: t.description, by: t.handle || t.did, when: whenText(t.createdAt), badge,
    onOpen: () => tabs.go(tab.id, t.uri), onOpenNew: () => openNew(t.uri) });
  if (t.picture) card.picture({ url: t.picture }, { look: `${t.pictureIsIcon ? 'icon' : ''} ${t.blur ? 'blur' : ''}` });
  card.el.dataset.uri = t.uri;
  const line = h('button', { type: 'button', class: 'card-earlier', hidden: true,
    title: `Every tile by ${t.handle ? `@${t.handle}` : 'this account'}`, onclick: () => tabs.go(tab.id, accountPageUri(t.handle || t.did)) });
  card.el.append(line);
  card.earlier = (n) => {
    line.hidden = !n;
    line.textContent = n ? earlierLine(n) : '';
    card.el.classList.toggle('has-earlier', !!n);
  };
  card.earlier(earlier);
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
  const cards = createCollapser();
  const drawn = new Map();            // a collapser card -> its tile card
  const fillCards = RECENT.fillCards ?? 12, fillPages = RECENT.fillPages ?? 3;
  const page = async () => {
    more.disabled = true;
    more.textContent = 'Loading…';
    try {
      // One press (or the first visit): a page, and more pages while repeats leave it thin (a few at most). Only
      // repeats trigger it: a page that's short for other reasons (the hide list, say) stays as it is.
      let fresh = 0, folded = 0, extra = 0, r;
      do {
        r = await discover.recent.load(next);
        if (!alive()) return;
        const { added, grown } = cards.add(r.tiles);
        for (const c of added) {
          const card = recentCard(ctx, c.tile, { badge: discover.recent.isNew(c.tile) ? 'New' : '', earlier: c.earlier });
          drawn.set(c, card);
          grid.append(card.el);
        }
        for (const c of [...added, ...grown]) drawn.get(c)?.earlier(c.earlier);
        fresh += added.length;
        folded += r.tiles.length - added.length;
        if (next === 1) discover.recent.markSeen();
        next = r.page + 1;
      } while (r.more && folded > 0 && fresh < fillCards && extra++ < fillPages);
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
// The next batch loads by itself when you scroll near the bottom (owner, Oct 25: no More button), so the
// hand-picked posts at the end are reached by scrolling. A browser without IntersectionObserver gets the More
// button instead. A batch that fails says so at the bottom, with Try again.
function drawNews(ctx, into, { observe = globalThis.IntersectionObserver } = {}) {
  const { discover, alive } = ctx;
  into.append(h('div', { class: 'dv-head' }, h('h1', {}, 'Tile news'), h('p', { class: 'sub' }, SOURCES.news.blurb)));
  const list = h('div', { class: 'posts' });
  const status = h('p', { class: 'dv-status' }, 'Loading posts…');
  const sentinel = h('div', { class: 'news-sentinel', 'aria-hidden': 'true' });
  const loading = h('p', { class: 'dv-status news-loading', hidden: true }, 'Loading more posts…');
  const failed = h('p', { class: 'dv-status news-failed', hidden: true });
  const more = h('button', { type: 'button', class: 'more', hidden: true }, 'More');
  const end = h('p', { class: 'dv-end news-end', hidden: true }, "That's everything in Tile news.");
  into.append(status, list, sentinel, loading, failed, more, end);
  let cursor = null;
  let busy = false;
  let watcher = null;
  const seen = { threads: new Map(), posts: new Set() };
  const postCtx = postContext(ctx, 'Tile news');
  const stop = () => { if (watcher) { watcher.disconnect(); watcher = null; } };
  // Watch the bottom again: the observer reports at once whether it's still in view (a short batch, a tall
  // window), so the next batch follows until the page fills or the feed ends.
  const rewatch = () => { if (watcher) { watcher.unobserve(sentinel); watcher.observe(sentinel); } };
  const page = async () => {
    if (busy) return;
    busy = true;
    more.disabled = true;
    failed.hidden = true;
    if (list.childElementCount) loading.hidden = false;
    let ok = false;
    try {
      const r = await discover.news({ cursor });
      if (!alive()) { stop(); return; }
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
      ok = true;
    } catch (err) {
      if (!alive()) { stop(); return; }
      const words = err instanceof NetError ? err.message : "Couldn't load Tile news just now.";
      if (list.childElementCount) {
        failed.replaceChildren(`${words} `, h('button', { type: 'button', class: 'linkish', onclick: () => page() }, 'Try again'));
        failed.hidden = false;
      } else {
        status.hidden = false;
        status.textContent = words;
      }
    } finally {
      busy = false;
      loading.hidden = true;
      more.disabled = false;
    }
    if (!ok) { if (!list.childElementCount) more.hidden = !cursor; return; }   // a failed later batch waits for Try again
    end.hidden = !!cursor || !list.childElementCount;
    if (!cursor) { stop(); more.hidden = true; return; }
    if (watcher) rewatch(); else more.hidden = false;
  };
  if (typeof observe === 'function') {
    watcher = new observe((entries) => {
      if (!alive()) { stop(); return; }
      if (entries.some((e) => e.isIntersecting) && cursor && !busy && failed.hidden) page();
    }, { rootMargin: '0px 0px 800px 0px' });
  }
  more.addEventListener('click', page);
  page();
}

// ---------- Tile posts (Nov 2026, claude/tile-posts-plan.md) ----------
// Everyone's tile posts, newest first: the author (avatar, name, @handle), the time, the text, and the tile's card
// (the same card Raku uses elsewhere; tapping it opens the tile in this tab). The banner's description is the post's
// `alt`, or the tile's own description (TP8). Nothing runs here.
function drawTilePosts(ctx, into) {
  const { discover, alive } = ctx;
  const head = h('div', { class: 'dv-head' }, h('h1', {}, 'Tile posts'), h('p', { class: 'sub' }, SOURCES.posts.blurb));
  const refresh = h('button', { type: 'button', class: 'dv-refresh', title: 'Look again now' }, icon('reload', 16), 'Refresh');
  // Autoplay (AU5): the switch beside Refresh, the same choice as the account menu's.
  const { autoplay } = ctx;
  const autoSwitch = autoplay ? switchButton(autoplay, 'Autoplay') : null;
  const autoLabel = autoplay ? h('label', { class: 'dv-autoplay', title: 'Start a post\u2019s tile once it\u2019s been on screen a moment' }, h('span', {}, 'Autoplay'), autoSwitch) : null;
  // Write a post (claude/raku-write-posts-plan.md, WP8 C): before Autoplay and Refresh; signed out it asks you to sign in first.
  if (ctx.postBox) head.append(h('button', { type: 'button', class: 'dv-write', onclick: () => ctx.postBox.openWrite() }, icon('plus', 16), h('span', {}, 'Write', h('span', { class: 'lbl-long' }, ' a post'))));
  if (autoLabel) head.append(autoLabel);
  head.append(refresh);
  const status = h('p', { class: 'dv-status' }, 'Looking for tile posts…');
  const note = h('p', { class: 'dv-status tp-note', hidden: true });
  const list = h('div', { class: 'posts tile-posts' });
  const empty = h('div', { class: 'dv-empty', hidden: true },
    h('p', {}, 'No tile posts yet.'),
    h('p', { class: 'tp-how' }, 'Open one of your tiles and press Post, or use Write a post above. A tile post is a record in your own account; a small script can write them too: ',
      h('a', { href: TILE_POSTS.repo, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, 'pyxorium/tile-posts'), '.'));
  into.append(head, status, note, list, empty);
  // PH2: the tile playing in a post stops when this page goes (another page in the tab, or the tab closed) or redraws.
  const { p, player } = ctx;
  const auto = autoplay ? autoplayFor(ctx, list, autoSwitch) : null;
  ctx.auto = auto;
  const before = p.dispose;
  p.dispose = () => { player.stop(); if (auto) auto.dispose(); if (before) before(); };
  const fill = async (fresh) => {
    refresh.disabled = true;
    status.hidden = false;
    status.textContent = 'Looking for tile posts…';
    let r;
    try { r = await discover.tilePosts.load({ fresh }); } catch {
      if (!alive()) return;
      refresh.disabled = false;
      status.textContent = "Couldn't look for tile posts just now.";
      return;
    }
    if (!alive()) return;
    refresh.disabled = false;
    if (player.current && list.contains(player.current)) player.stop();
    if (auto) auto.clear();
    list.replaceChildren(...r.items.map((post) => tilePostCard(ctx, post)));
    const words = [];
    if (!r.relayOk) words.push("Couldn't reach the network just now, showing accounts you know.");
    if (r.unreachable) words.push(`Couldn't reach ${r.unreachable} account${r.unreachable === 1 ? '' : 's'} just now.`);
    note.textContent = words.join(' ');
    note.hidden = !words.length;
    status.hidden = true;
    empty.hidden = !!r.items.length;
  };
  refresh.addEventListener('click', () => fill(true));
  fill(false);
}

// ---------- A tile post's own page (claude/raku-post-links-plan.md, SL1 to SL7) ----------
// at://<did or handle>/cafe.thunderbird.tile.post/<rkey> in a tab: a small heading, "Tile post", with "All tile posts"
// beside it (someone arriving by a shared link has no Back, SL5), then the post's card as Tile posts draws it, with Play
// here, expand and Autoplay. When it can't be shown, the heading stays and a line says why, as a tile's tab speaks
// (SL6): deleted ("No such post"), its author or its tile hidden ("Not shown", never which list or why), or its tile
// gone or changed (the card shows "This tile can't be shown." as in the list). The tab: "@handle's post" (SL7).
export function drawTilePostPage(ctx, target) {
  const { p, tab, tabs, resolver, moderation, drawChrome, alive, player, autoplay } = ctx;
  p.title = 'Tile post';
  p.shownAddress = target.uri;
  p.keep = null;
  p.state = 'loading';
  drawChrome();
  const status = h('p', { class: 'dv-status', role: 'status' }, 'Finding this tile post…');
  const holder = h('div', { class: 'posts tile-posts' });
  const head = h('div', { class: 'tpp-head' }, h('h1', {}, 'Tile post'),
    h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, discoverUri('posts')) }, 'All tile posts'));
  p.el.append(h('div', { class: 'tp-page' }, head, status, holder));
  // PH2: the tile playing in the post stops when this page goes; Autoplay watches the one slot, as in Tile posts.
  const auto = autoplay ? autoplayFor(ctx, holder, null) : null;
  ctx.auto = auto;
  const before = p.dispose;
  p.dispose = () => { player.stop(); if (auto) auto.dispose(); if (before) before(); };
  const note = (title, state, ...words) => {
    status.remove();
    holder.replaceChildren(h('p', { class: 'post-note tpp-note' }, ...words));
    p.title = title;
    p.state = state;
    drawChrome();
  };
  const gone = () => note('No such post', 'error', "There's no tile post at that address (it may have been deleted).");
  const hidden = () => note('Not shown', 'hidden', "This tile post isn't shown in Raku. ",
    h('a', { href: TAKEDOWNS_PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Reporting and takedowns ↗'));
  (async () => {
    const did = await resolver.didFor(target.actor);
    if (!alive()) return;
    if (await moderation.isAccountHidden(did)) { if (alive()) hidden(); return; }
    const rec = await resolver.record(did, TILE_POST_COLLECTION, target.rkey);
    if (!alive()) return;
    const post = readTilePost(rec, did);
    if (!post) { gone(); return; }      // not a tile post Raku can show (as the list leaves it out)
    if (await moderation.isHidden(post.tile.did, post.tile.rkey)) { if (alive()) hidden(); return; }
    if (!alive()) return;
    status.remove();
    holder.replaceChildren(tilePostCard(ctx, post, { own: true, onHandle: (hd) => { if (!alive()) return; p.title = `@${hd}'s post`; drawChrome(); } }));
    p.state = 'ready';
    drawChrome();
  })().catch((err) => {
    if (!alive()) return;
    if (err && (err.code === 'not-found' || err.code === 'no-handle')) { gone(); return; }
    note('Tile post', 'error', "Couldn't reach the post's server just now. ",
      h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, target.uri) }, 'Try again'));
  });
}

/**
 * Autoplay on Tile posts (claude/raku-expand-plan.md, "After C", AU1 to AU6): watches the tile posts' slots and starts the
 * newest to be about two-thirds on screen for a moment (play-here.js createAutoplayWatch), when the switch is on. It
 * never takes over from a tile you started or clicked yourself (one with the keys, or expanded), never restarts one you
 * stopped with its × (while you stay on this page), and never starts one over 25 MB (AU4). Reduced motion doesn't
 * matter here (AU6). Each playCard registers itself (add).
 */
function autoplayFor(ctx, list, autoSwitch) {
  const { autoplay, player, p } = ctx;
  const cards = new Map();                // slot → the card's autoplay side: { canAuto(), startAuto(), touched(), stopAuto() }
  const declined = new Set();             // slots stopped with their × after starting by themselves
  let lastPointer = 'mouse';              // "Click" or "Tap" in the label (AU3): from the last pointer seen, not the screen's kind
  const onPointer = (e) => { lastPointer = e.pointerType === 'touch' ? 'touch' : 'mouse'; };
  document.addEventListener('pointerdown', onPointer, true);
  const busyByHand = () => { const cur = player.current; const c = cur && cards.get(cur); return !!(cur && (!c || c.touched())); };
  // (Nov 9 2026: a tile that started by itself and is still well on screen keeps playing; another showing too waits for it
  // to scroll away, instead of the two stopping each other over and over: autoplayMayStart.)
  let watch = null;
  watch = createAutoplayWatch({
    canStart: (slot) => {
      const c = cards.get(slot);
      const cur = player.current;
      return autoplay.on && !!c && slot.isConnected && p.el.classList.contains('front') && !declined.has(slot)
        && autoplayMayStart({ slot, current: cur, byHand: busyByHand(), currentRatio: cur && cards.has(cur) ? watch.ratio(cur) : 0 }) && c.canAuto();
    },
    start: (slot) => cards.get(slot)?.startAuto(),
  });
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { for (const en of entries) watch.update(en.target, en.isIntersecting ? en.intersectionRatio + 0.005 : 0); },
      { threshold: [0, 0.25, 0.5, 0.66, 0.75, 0.9, 1] })
    : null;
  const unsubscribe = autoplay.onChange((on) => {
    if (autoSwitch) autoSwitch.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) watch.recheck();
    else { const c = player.current && cards.get(player.current); if (c && !c.touched()) player.stop(); }   // off: an untouched one stops
  });
  return {
    add(slot, side) { cards.set(slot, side); if (io) io.observe(slot); },
    // a tile stopped (scrolled away, ×, another started): one already showing may start now (after settling)
    settle() { if (autoplay.on) watch.recheck(); },
    decline(slot) { declined.add(slot); },
    get pointer() { return lastPointer; },
    clear() { if (io) io.disconnect(); watch.stop(); cards.clear(); declined.clear(); },
    dispose() { this.clear(); unsubscribe(); document.removeEventListener('pointerdown', onPointer, true); },
  };
}

/**
 * One tile post as a card (post.css's look): author, time, text, then the tile's card or "This tile can't be shown", and
 * the Share button (claude/raku-post-links-plan.md, SL2). In Tile posts the time opens the post's page in this tab, and so
 * does "Open post" in the Share menu (SL3, SL4); on the post's own page (own: true) the time is plain and the menu has no
 * "Open post". onHandle(handle): the author's handle once known (the page's tab title, SL7).
 */
function tilePostCard(ctx, post, { own = false, onHandle = null } = {}) {
  const { kit, tabs, tab, openNew, resolver, moderation } = ctx;
  const av = h('span', { class: 'post-av' });
  const name = h('span', { class: 'post-name', hidden: true });
  const handle = h('span', { class: 'post-handle' }, post.did);
  let knownHandle = null;
  const gotHandle = (hd) => { knownHandle = hd; handle.textContent = `@${hd}`; if (onHandle) onHandle(hd); };
  const page = tilePostUri(post.did, post.rkey);
  const openPage = own ? null : () => tabs.go(tab.id, page);
  const iso = post.time ? new Date(post.time).toISOString() : '';
  const when = post.time ? ago(iso) : '';
  const time = own || !when
    ? h('span', { class: 'post-time', title: iso }, when)
    : h('button', { type: 'button', class: 'post-time post-time-link', title: iso, 'aria-label': `Open this post (${when})`, onclick: openPage,
      onauxclick: (ev) => { if (ev.button === 1) { ev.preventDefault(); openNew(page); } } }, when);
  const head = h('header', { class: 'post-head' },
    h('button', { type: 'button', class: 'post-who', title: 'Their tiles in Raku', onclick: () => tabs.go(tab.id, accountPageUri(post.did)) },
      av, h('span', { class: 'post-names' }, name, handle)),
    time);
  const body = h('div', { class: 'post-body' }, post.text ? h('p', { class: 'post-text' }, post.text) : null);
  const actions = h('footer', { class: 'post-actions' }, shareMenu({ post, handle: () => knownHandle, open: openPage }));
  const card = h('article', { class: 'post tile-post', 'data-uri': post.uri }, head, body, actions);
  moderation.profile(post.did).then((prof) => {
    if (prof.avatar && !av.firstChild) av.append(h('img', { src: prof.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }));
    if (prof.displayName) { name.textContent = prof.displayName; name.hidden = false; }
    if (prof.handle) gotHandle(prof.handle);
    else resolver.checkedHandle(post.did).then((hd) => { if (hd) gotHandle(hd); });
  }).catch(() => {});

  const t = post.tile;
  const tileCard = playCard(ctx, t);
  body.append(tileCard.el);
  const cannot = () => {
    tileCard.el.replaceWith(h('p', { class: 'post-note tp-gone' }, "This tile can't be shown."));
  };
  (async () => {
    const [rec, acct] = await Promise.all([resolver.tileRecord(t.did, t.rkey), resolver.account(t.did)]);
    const d = describeTile(rec);
    if (!d.ok || tileState(post, rec) !== 'ok') { cannot(); return; }
    tileCard.ready({ d, pds: acct.pds, alt: post.alt || d.description || d.name || '' });
    resolver.checkedHandle(t.did).then((hd) => tileCard.set({ by: hd || '' }));
  })().catch((err) => {
    if (err && err.code === 'not-found') cannot();
    else tileCard.set({ note: "Couldn't reach the tile's server just now." });
  });
  return card;
}

/**
 * A tile post's tile card with "Play here" (claude/raku-play-here-plan.md): the slot (the banner, then the tile running
 * in its place) above the card's words. The words open the tile in this tab and the corner button in a new tab, as any
 * card; Play runs it here (ctx.player, app.js). ready() once the tile record is checked: until then there is no Play.
 * Round C (claude/raku-expand-plan.md): a playing tile's expand button grows it to Raku's window (expand-view.js);
 * ×, Escape or Back shrink it back. After a trip inside the post (D), a "Now in" line with "Back to …" (EX7), and the
 * new-tab buttons open the way taken.
 */
function playCard(ctx, t) {
  const { kit, tabs, tab, openNew, player, say } = ctx;
  const slot = h('div', { class: 'tp-slot' });
  const title = h('span', { class: 'card-title' }, '…');
  const desc = h('span', { class: 'card-desc' });
  const byLine = h('span', { class: 'card-by' });
  const noteLine = h('span', { class: 'card-note' });
  const main = h('button', { type: 'button', class: 'card-main', onclick: () => tabs.go(tab.id, t.uri),
    onauxclick: (ev) => { if (ev.button === 1) { ev.preventDefault(); openNew(t.uri); } } },
  h('span', { class: 'card-text' }, title, desc, byLine, noteLine));
  // The new-tab buttons open the place now: the post's own tile, or after a trip the way taken (EX7).
  const tabNow = () => (player.current === slot && player.place(slot)) ? player.place(slot).tab : { uri: t.uri, state: null };
  const openTabNow = () => { const x = tabNow(); openNew(x.uri, x.state); };
  const corner = h('div', { class: 'card-corner' },
    h('button', { type: 'button', class: 'card-btn', title: 'Open in a new tab', 'aria-label': 'Open this tile in a new tab', onclick: () => openTabNow() }, icon('newtab', 16)));
  // EX7: after a trip, where the post's tile is now, and the way back.
  const nowWhere = h('span', {});
  const nowBack = h('button', { type: 'button', onclick: () => player.back(slot) });
  const nowLine = h('div', { class: 'tp-now', hidden: true }, nowWhere, nowBack);
  const el = h('article', { class: 'card post-tile tp-card', 'data-tile': t.uri }, slot, nowLine, main, corner);
  let tile = null;           // { d, pds }
  let over = null, play = null, stopBtn = null, expandBtn = null, hint = null, hintTimer = null;
  let view = null;           // the expanded view, while open (expand-view.js)
  let place = null;          // the place now, after a trip ({ name, by, travelled, backTo, tab })
  // Autoplay (AU2, AU3): phase says what the slot shows; byItself: started by Autoplay; touched: clicked or tapped since
  // (or started by hand), so it has had the keys.
  let phase = 'wait', byItself = false, touched = false;
  const clear = () => {
    for (const x of [over, play, stopBtn, expandBtn, hint]) if (x) x.remove();
    over = play = stopBtn = expandBtn = hint = null;
    clearTimeout(hintTimer);
    slot.classList.remove('playing', 'keys');
  };
  const panel = (...kids) => { over = h('div', { class: 'tp-over' }, ...kids); slot.append(over); };
  const name = () => (tile ? tile.d.name : 'this tile');
  const by = () => (byLine.textContent || '').replace(/^by @/, '') || null;
  function banner() {
    clear();
    phase = 'wait';
    if (!tile) return;
    const v = player.verdict(tile.d.declaredBytes, t.uri);
    if (v === 'refuse') { panel(h('p', {}, `This tile is too large to open (${formatBytes(tile.d.declaredBytes)}).`)); return; }
    play = h('button', { type: 'button', class: 'tp-play', 'aria-label': `Play ${name()} here`, onclick: () => press() }, icon('play', 16), 'Play here');
    slot.append(play);
    phase = 'banner';
  }
  function press() {
    if (player.verdict(tile.d.declaredBytes, t.uri) === 'ask') {
      clear();
      phase = 'ask';
      panel(h('p', {}, `This tile is large (${formatBytes(tile.d.declaredBytes)}). Play anyway?`),
        h('div', { class: 'tp-row' },
          h('button', { type: 'button', class: 'go', onclick: () => { player.allow(t.uri); start(); } }, 'Play anyway'),
          h('button', { type: 'button', onclick: () => banner() }, 'Cancel')));
      return;
    }
    start();
  }
  function start({ quiet = false } = {}) {
    showPlace(null);
    byItself = quiet;
    touched = !quiet;
    phase = 'starting';
    player.play({ slot, uri: t.uri, did: t.did, pds: tile.pds, d: tile.d, onState, expand: () => expand(), expanded: () => !!view, quiet });
  }
  function showPlace(info) {
    place = info && info.travelled ? info : null;
    nowLine.hidden = !place;
    if (place) {
      nowWhere.replaceChildren(h('b', {}, 'Now in:'), ` ${place.name}${place.by ? `, by @${place.by}` : ''}`);
      nowBack.textContent = `Back to ${place.backTo}`;
    }
    if (view) view.setPlace(info || { name: name(), by: by(), travelled: false, backTo: null });
  }

  // ---- the expanded view (EX1 to EX5, EX8) ----
  const onKey = (e) => { if (e.key === 'Escape' && view && !document.fullscreenElement) { e.preventDefault(); collapse(); } };
  const onFront = (e) => { if (e.detail === false && view) collapse({ instant: true }); };   // another Raku tab in front
  async function expand() {
    if (view || player.current !== slot) return;
    const reduce = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const v = createExpanded({ host: ctx.p.el, card: el, slot, motion: expandMotion({ reduce }),
      onClose: () => collapse(), onNewTab: () => newTabFromView(), onBack: () => player.back(slot) });
    view = v;
    v.setPlace(place || { name: name(), by: by(), travelled: false, backTo: null });
    player.pushStep(() => collapse({ fromBack: true }));
    document.addEventListener('keydown', onKey);
    ctx.p.el.addEventListener('raku:front', onFront);
    player.big(slot, true);
    await v.open();
    if (view === v) player.focus(slot);
  }
  async function collapse({ instant = false, fromBack = false } = {}) {
    const v = view;
    if (!v) return;
    view = null;
    document.removeEventListener('keydown', onKey);
    ctx.p.el.removeEventListener('raku:front', onFront);
    const dropping = fromBack ? null : player.dropStep();
    await v.close({ instant });
    player.big(slot, false);
    if (dropping) await dropping;
    // (the keys back to the tile after ×, Escape or Back; not when another tab came to the front, or a new one opens)
    if (!instant && player.current === slot) player.focus(slot);
  }
  async function newTabFromView() {
    const x = tabNow();
    await collapse({ instant: true });
    openNew(x.uri, x.state);
  }

  function onState(kind, detail) {
    if (kind === 'keys') {
      if (slot.classList.contains('playing')) slot.classList.toggle('keys', !!detail);
      if (detail && !touched) { touched = true; if (hint) { hint.remove(); hint = null; } }   // AU3: clicked or tapped: the keys, the ring
      return;
    }
    if (kind === 'place') { showPlace(detail); return; }
    if (kind === 'note') { if (view) view.note(detail); else say(detail); return; }
    if (kind === 'stopped' || kind === 'error') {
      if (view) collapse({ instant: true });
      showPlace(null);
      byItself = false; touched = false;
      if (kind === 'stopped') setTimeout(() => ctx.auto?.settle(), 0);
    }
    if (kind === 'stopped') { banner(); return; }
    if (kind === 'error') {
      clear();
      phase = 'error';
      panel(h('p', {}, detail || "Couldn't load this tile."), h('div', { class: 'tp-row' }, h('button', { type: 'button', class: 'go', onclick: () => start() }, 'Try again')));
      return;
    }
    if (kind === 'starting' || kind === 'slow') {
      clear();
      panel(h('div', { class: 'tp-spin', 'aria-hidden': 'true' }), h('p', { class: 'tp-quiet', role: 'status' }, kind === 'slow' ? 'Still starting…' : 'Starting the tile…'),
        kind === 'slow' ? h('div', { class: 'tp-row' }, h('button', { type: 'button', onclick: () => player.stop(slot) }, 'Stop')) : null);
      return;
    }
    if (kind === 'playing') {
      clear();
      slot.classList.add('playing');
      // EX2: expand in the corner of the playing tile, left of the × and the card's new-tab button
      expandBtn = h('button', { type: 'button', class: 'card-btn tp-expand', title: 'Expand', 'aria-label': `Expand ${name()}`, onclick: () => expand() }, icon('expand', 16));
      // (× also tells Autoplay not to start this one again while you stay on this page)
      stopBtn = h('button', { type: 'button', class: 'card-btn tp-stop', title: 'Stop', 'aria-label': `Stop ${name()}`, onclick: () => { ctx.auto?.decline(slot); player.stop(slot); } }, icon('close', 16));
      phase = 'playing';
      if (byItself && !touched) {
        // AU3: started by itself: no keys and (the browser's hold) no sound until clicked or tapped; the label stays till then
        const verb = ctx.auto && ctx.auto.pointer === 'touch' ? 'Tap' : 'Click';
        hint = h('span', { class: 'tp-keys-hint tp-auto-hint', 'aria-hidden': 'true' }, `${verb} to play with keys and sound`);
        slot.append(expandBtn, stopBtn, hint);
      } else {
        hint = h('span', { class: 'tp-keys-hint', 'aria-hidden': 'true' }, 'Keys go to the tile');
        slot.append(expandBtn, stopBtn, hint);
        hintTimer = setTimeout(() => { if (hint) hint.classList.add('gone'); }, PLAY_HERE.hintMs);
      }
    }
  }
  return {
    el,
    set({ by: who, note }) {
      if (who !== undefined) byLine.textContent = who ? `by @${who}` : '';
      if (note !== undefined) noteLine.textContent = note;
    },
    ready({ d, pds, alt }) {
      tile = { d, pds };
      title.textContent = d.name || 'Untitled tile';
      desc.textContent = d.description || '';
      const cid = bannerCid(d.manifest);
      if (cid) kit.picture(slot, { pds, did: t.did, cid, alt });
      banner();
      // Autoplay: this card may start by itself when its banner shows Play here and it isn't over 25 MB (AU4)
      if (ctx.auto) ctx.auto.add(slot, {
        canAuto: () => phase === 'banner' && autoplaySize(d.declaredBytes) && player.verdict(d.declaredBytes, t.uri) === 'start',
        startAuto: () => start({ quiet: true }),
        touched: () => touched || !!view,
      });
    },
  };
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
      const shown = createCollapser().add(r.tiles).added.map((c) => c.tile);     // repeats as one (Oct 30)
      const n = shown.filter((t) => discover.recent.isNew(t)).length;
      count.textContent = n ? `${n} new` : '';
      fill(shown.slice(0, 3).map((t) => row(t.name, t.handle ? `@${t.handle}` : whenText(t.createdAt),
        t.picture ? { url: t.picture, look: [t.pictureIsIcon ? 'is-icon' : '', t.blur ? 'blurred' : ''].filter(Boolean).join(' ') } : null)), 'No tiles yet.');
    } else if (source === 'posts') {
      const r = await discover.tilePosts.load();
      if (!alive()) return;
      const rows = [];
      for (const post of r.items.slice(0, 3)) {
        const prof = await ctx.moderation.profile(post.did).catch(() => null);
        const hd = (prof && prof.handle) || await resolver.checkedHandle(post.did);
        rows.push(row((prof && prof.displayName) || (hd ? `@${hd}` : 'Someone'), post.text.slice(0, 90) || ago(post.createdAt), null));
      }
      if (alive()) fill(rows, 'No tile posts yet.');
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
