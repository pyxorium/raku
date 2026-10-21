// Public reads of posts and feeds (stage 6): one small module, so the server (config.js APPVIEW) can change
// and later reads (one post, a thread) go in the same place. No sign-in: these are Bluesky's public, cached
// answers, the same for everyone. Every request goes through net.js (https, time and size limits, no cookies,
// no referrer).

import { fetchJson, NetError } from './net.js';
import { APPVIEW, LIMITS } from './config.js';

const FEED_URI = /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.generator\/[A-Za-z0-9._~-]{1,64}$/;
const KEEP_MS = 2 * 60 * 1000;

export function createPublicReads({ fetchImpl = globalThis.fetch, appview = APPVIEW, now = () => Date.now() } = {}) {
  const kept = new Map();   // key -> { at, value }
  const opts = { timeoutMs: LIMITS.lookupMs, maxBytes: 4 * 1024 * 1024, fetchImpl };

  async function get(path, params, what) {
    const q = new URLSearchParams(params).toString();
    let r;
    try { r = await fetchJson(`${appview}/xrpc/${path}?${q}`, opts); } catch (err) {
      if (err instanceof NetError) throw err;
      throw new NetError('network', `Couldn't reach ${new URL(appview).hostname}.`);
    }
    if (!r.ok || !r.json) throw new NetError(r.status >= 500 || !r.status ? 'upstream' : 'refused', `${what} didn't load (${new URL(appview).hostname} answered ${r.status}).`);
    return r.json;
  }

  /** One page of a feed. → { items: [{ post, reply }], posts: [PostView], cursor } (kept two minutes for the first
   *  page). `reply` is the item's thread context when the post is a reply: { root, parent } (Q97). */
  async function getFeed(feed, { cursor = null, limit = 30, fresh = false } = {}) {
    if (!FEED_URI.test(String(feed || ''))) throw new NetError('bad-url', "That isn't a feed's address.");
    const key = `f:${feed}:${limit}`;
    const k = !cursor && kept.get(key);
    if (k && !fresh && now() - k.at < KEEP_MS) return k.value;
    const params = { feed, limit: String(limit) };
    if (cursor) params.cursor = cursor;
    const j = await get('app.bsky.feed.getFeed', params, 'The feed');
    const items = (Array.isArray(j.feed) ? j.feed : [])
      .filter((x) => x && x.post && typeof x.post.uri === 'string')
      .map((x) => ({ post: x.post, reply: x.reply && typeof x.reply === 'object' ? { root: x.reply.root || null, parent: x.reply.parent || null } : null }));
    const value = { items, posts: items.map((x) => x.post), cursor: typeof j.cursor === 'string' && j.cursor ? j.cursor : null };
    if (!cursor) kept.set(key, { at: now(), value });
    return value;
  }

  /** A feed's own description (its name, avatar, who made it). */
  async function getFeedGenerator(feed) {
    if (!FEED_URI.test(String(feed || ''))) throw new NetError('bad-url', "That isn't a feed's address.");
    const j = await get('app.bsky.feed.getFeedGenerator', { feed }, "The feed's description");
    return j.view || null;
  }

  /** Several posts by their at:// addresses (up to 25), for a post page or a quoted post later. */
  async function getPosts(uris) {
    const list = [...new Set(uris)].slice(0, 25);
    if (!list.length) return [];
    const params = new URLSearchParams();
    for (const u of list) params.append('uris', u);
    const j = await get('app.bsky.feed.getPosts', params, 'The posts');
    return Array.isArray(j.posts) ? j.posts : [];
  }

  return { getFeed, getFeedGenerator, getPosts, get server() { return appview; } };
}
