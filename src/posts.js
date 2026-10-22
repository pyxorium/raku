// Posts, as data (stage 6, claude/raku-stage6-plan.md): one Bluesky-style post (any atproto app's: Bluesky,
// Blacksky, Northsky and the like all write app.bsky.feed.post records) turned into what Raku draws.
// No DOM and no network here (tested in Node). Stage 6 draws posts as cards in Tile news (post-card.js); a
// post page, a read-only thread and replying may come later and reuse this as it is (owner, Q88).
//
// What's read, and from where:
//   - the author (DID, checked-by-the-server handle, display name, avatar only from Bluesky's picture server);
//   - the text, with its facets (links, mentions, hashtags) as byte ranges of the UTF-8 text;
//   - pictures (thumbnail and full size, only from cdn.bsky.app), a link card, a quoted post, a video (noted only);
//   - a tile: a link (as the post's link card, or in its text) to a tile's address.
//   - labels: hidden, a content warning, or pictures to blur (moderatePost below).

import { MODERATION_SERVICES } from './config.js';
import { parseAddress, parsePost, isDid, isHandle } from './address.js';

const PICS = 'https://cdn.bsky.app/';
const pic = (u) => (typeof u === 'string' && u.startsWith(PICS) ? u : null);
const str = (s, n = 3000) => (typeof s === 'string' ? s.slice(0, n) : '');
const httpLink = (u) => {
  if (typeof u !== 'string' || u.length > 2000) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null; } catch { return null; }
};
const CID = /^b[a-z2-7]{20,120}$/;

/** A tile named by an at:// address (and maybe one version's CID). → { did?, actor, rkey, uri, cid } or null */
export function tileRef(uri, cid = null) {
  if (typeof uri !== 'string') return null;
  const a = parseAddress(uri);
  if (!a.ok) return null;
  return { actor: a.actor, rkey: a.rkey, uri: a.uri, cid: typeof cid === 'string' && CID.test(cid) ? cid : null };
}

/**
 * The text cut into pieces by its facets. Facet ranges are UTF-8 byte offsets (atproto rich text); pieces
 * that overlap, run past the end or fall inside a character are left as plain text.
 * → [{ text, link? (http/https), mention? (a DID), tag? }]
 */
export function segments(text, facets) {
  const t = str(text, 10000);
  const bytes = new TextEncoder().encode(t);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const ranges = (Array.isArray(facets) ? facets : [])
    .map((f) => {
      const s = Number(f?.index?.byteStart);
      const e = Number(f?.index?.byteEnd);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > bytes.length) return null;
      const feats = Array.isArray(f.features) ? f.features : [];
      let kind = null;
      for (const x of feats) {
        const type = String(x?.$type || '');
        if (type.endsWith('#link')) { const u = httpLink(x.uri); if (u) { kind = { link: u }; break; } }
        else if (type.endsWith('#mention') && typeof x.did === 'string' && isDid(x.did)) { kind = { mention: x.did }; break; }
        else if (type.endsWith('#tag') && typeof x.tag === 'string' && x.tag) { kind = { tag: x.tag.slice(0, 64) }; break; }
      }
      return kind ? { s, e, kind } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s);
  const out = [];
  let at = 0;
  const piece = (s, e) => { try { return dec.decode(bytes.slice(s, e)); } catch { return null; } };
  for (const r of ranges) {
    if (r.s < at) continue;                               // overlapping: skip
    const before = piece(at, r.s);
    const inside = piece(r.s, r.e);
    if (before === null || inside === null) continue;      // inside a character: leave as plain text
    if (before) out.push({ text: before });
    out.push({ text: inside, ...r.kind });
    at = r.e;
  }
  const rest = piece(at, bytes.length);
  if (rest) out.push({ text: rest });
  else if (rest === null) return [{ text: t }];
  return out;
}

// Label values that blur pictures (from a moderation service Raku follows, or the author's own self-labels).
const ADULT = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);
const live = (l, now) => l && !l.neg && !(l.exp && Date.parse(l.exp) <= now);

/**
 * What a post's labels mean for drawing it. Only moderation services in `services` count, plus the author's
 * own self-labels for pictures. → { hide, warn, blurMedia }
 *   hide: !hide / !takedown on the post or its author (the post isn't drawn at all);
 *   warn: !warn (drawn behind "Show post");
 *   blurMedia: adult or graphic pictures (drawn blurred until "Show pictures").
 */
export function moderatePost(view, { services = MODERATION_SERVICES, now = Date.now() } = {}) {
  const author = view?.author?.did;
  const trusted = new Set(services);
  const labels = [...(Array.isArray(view?.labels) ? view.labels : []), ...(Array.isArray(view?.author?.labels) ? view.author.labels : [])];
  const selfVals = Array.isArray(view?.record?.labels?.values) ? view.record.labels.values.map((v) => v?.val) : [];
  let hide = false, warn = false, blurMedia = false;
  for (const l of labels) {
    if (!live(l, now)) continue;
    const fromService = trusted.has(l.src);
    if (fromService && (l.val === '!hide' || l.val === '!takedown')) hide = true;
    if (fromService && l.val === '!warn') warn = true;
    if ((fromService || l.src === author) && ADULT.has(l.val)) blurMedia = true;
  }
  if (selfVals.some((v) => ADULT.has(v))) blurMedia = true;
  return { hide, warn, blurMedia };
}

function images(viewImages) {
  return (Array.isArray(viewImages) ? viewImages : []).slice(0, 4).map((i) => ({
    thumb: pic(i?.thumb), full: pic(i?.fullsize), alt: str(i?.alt, 1000),
    aspect: Number(i?.aspectRatio?.width) > 0 && Number(i?.aspectRatio?.height) > 0 ? i.aspectRatio.width / i.aspectRatio.height : null,
  })).filter((i) => i.thumb);
}

function external(ext) {
  if (!ext) return null;
  const uri = httpLink(ext.uri);
  if (!uri) return null;
  return { uri, title: str(ext.title, 300), description: str(ext.description, 600), thumb: pic(ext.thumb) };
}

/** A strong reference's post address in Raku's form (at://<did>/app.bsky.feed.post/<rkey>), or null. */
function refUri(ref) {
  const p = ref && typeof ref.uri === 'string' ? parsePost(ref.uri) : null;
  return p && p.ok ? p.uri : null;
}

/**
 * A reply's place in its thread, as the Bluesky app shows it in a feed (Q97): the thread's first post, the
 * post it answers, and whether posts were skipped between them. From a feed item's `reply: { root, parent }`
 * (post views, or notFoundPost / blockedPost). Each side is post data, or { unavailable: true } when it was
 * deleted, blocked, or hidden by moderation. → { root, parent, gap } or null when the item isn't a reply.
 *   - parent is the root (a direct reply to the first post): root only, no parent, no gap;
 *   - gap: the parent itself answers something other than the root (posts in between aren't shown).
 */
export function threadContext(item, opts = {}) {
  const r = item && item.reply;
  if (!r || (!r.root && !r.parent)) return null;
  const side = (v) => {
    if (!v || String(v.$type || '').match(/#(notFoundPost|blockedPost)$/) || v.notFound || v.blocked) return { unavailable: true, uri: refUri(v) };
    const p = readPost(v, opts);
    if (!p || p.moderation.hide) return { unavailable: true, uri: p ? p.uri : refUri(v) };
    return p;
  };
  const root = r.root ? side(r.root) : null;
  const parent = r.parent ? side(r.parent) : null;
  const rootUri = root && root.uri;
  if (parent && rootUri && parent.uri === rootUri) return { root, parent: null, gap: false };
  const gap = !!(parent && !parent.unavailable && parent.replyTo && parent.replyTo.parent && parent.replyTo.parent !== rootUri);
  return { root, parent, gap };
}

/** Which thread a feed item belongs to (Q123): its thread's first post's address; a post on its own is the
 *  first post of its own thread. item: { post, context } as Discover's news() gives them. */
export function threadKey(item) {
  return (item && item.context && item.context.root && item.context.root.uri) || (item && item.post && item.post.replyTo && item.post.replyTo.root) || (item && item.post && item.post.uri) || '';
}

/**
 * One card per thread (Q123, C): the first item of a thread (the newest: feeds come newest first) is kept; later
 * items from the same thread are counted on it ("+1 more reply in this thread"). An item whose post was already
 * drawn (on its own or as a reply's context) is left out without counting: it's on the page already.
 * `seen` carries on across pages (More): pass the same object each time.
 * → { added: [{ item, key, more }], counted: Set of earlier groups whose count went up }
 */
export function groupThreads(items, seen = { threads: new Map(), posts: new Set() }) {
  const added = [];
  const counted = new Set();
  for (const item of items) {
    if (!item || !item.post) continue;
    if (seen.posts.has(item.post.uri)) continue;
    seen.posts.add(item.post.uri);
    const key = threadKey(item);
    const group = seen.threads.get(key);
    if (group) {
      group.more++;
      if (!added.includes(group)) counted.add(group);
      continue;
    }
    const g = { item, key, more: 0 };
    seen.threads.set(key, g);
    if (item.context) for (const k of ['root', 'parent']) if (item.context[k] && item.context[k].uri) seen.posts.add(item.context[k].uri);
    added.push(g);
  }
  return { added, counted };
}

/**
 * One post (a PostView from a feed or app.bsky.feed.getPosts) as plain data, or null when it can't be read.
 */
export function readPost(view, { services = MODERATION_SERVICES, now = Date.now() } = {}) {
  if (!view || typeof view.uri !== 'string') return null;
  const where = parsePost(view.uri);
  if (!where || !where.ok) return null;
  const a = view.author || {};
  if (typeof a.did !== 'string' || !isDid(a.did)) return null;
  const record = view.record && typeof view.record === 'object' ? view.record : {};
  const handle = typeof a.handle === 'string' && isHandle(a.handle) && a.handle !== 'handle.invalid' ? a.handle.toLowerCase() : null;

  // Bluesky's view of the embed (pictures with their addresses on its picture server, the link card, a quote).
  const e = view.embed || {};
  const type = String(e.$type || '');
  const media = type.includes('recordWithMedia') ? (e.media || {}) : e;
  const mtype = String(media.$type || type);
  const imgs = mtype.includes('embed.images') ? images(media.images) : [];
  const card = mtype.includes('embed.external') ? external(media.external) : null;
  const video = mtype.includes('embed.video');
  const q = type.includes('recordWithMedia') ? e.record?.record : (type.includes('embed.record') ? e.record : null);
  const quoted = q && typeof q.uri === 'string' ? parsePost(q.uri) : null;
  const quote = quoted && quoted.ok ? {
    uri: quoted.uri, actor: quoted.actor, rkey: quoted.rkey,
    handle: typeof q.author?.handle === 'string' && isHandle(q.author.handle) ? q.author.handle.toLowerCase() : null,
    text: str(q.value?.text, 300),
  } : null;

  const segs = segments(record.text, record.facets);
  // The tile: a link card, or a link in the text, to a tile's address.
  let tile = card ? tileRef(card.uri) : null;
  if (!tile) for (const s of segs) { if (s.link) { tile = tileRef(s.link); if (tile) break; } }

  return {
    uri: where.uri, cid: typeof view.cid === 'string' ? view.cid : null, did: a.did, rkey: where.rkey,
    author: { did: a.did, handle, displayName: str(a.displayName, 80), avatar: pic(a.avatar) },
    text: str(record.text, 10000), segments: segs,
    createdAt: typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt)) ? record.createdAt : (view.indexedAt || null),
    reply: !!record.reply,
    // what it replies to (stage 6, Q97): the post just above it, and the thread's first post
    replyTo: record.reply ? { parent: refUri(record.reply.parent), root: refUri(record.reply.root) } : null,
    images: imgs, external: card, video, quote, tile,
    moderation: moderatePost(view, { services, now }),
  };
}

/** For a card's line (stage 6c): "just now", "3h ago", "2d ago", or a date on its own ("Oct 3"). */
export function whenText(iso, now = Date.now()) {
  const a = ago(iso, now);
  return !a ? '' : a === 'now' ? 'just now' : /^\d+[mhd]$/.test(a) ? `${a} ago` : a;
}

/** "now", "5m", "3h", "2d", "Oct 3", "Oct 3 2025" */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return d.getUTCFullYear() === new Date(now).getUTCFullYear() ? md : `${md} ${d.getUTCFullYear()}`;
}

