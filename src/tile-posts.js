// Tile posts (claude/tile-posts-plan.md, stage 3): posts that share a tile, written as records of the kind
// cafe.thunderbird.tile.post in people's own accounts (the lexicon lives in pyxorium/tile-posts). Discover shows
// them as a source beside Tile news (raku:discover/posts): everyone's, newest first.
//
// No DOM here (tested in Node); discover.js draws them.
//
// Finding the accounts (TP11): Bluesky's relay is asked which accounts hold tile posts
// (com.atproto.sync.listReposByCollection, 100 at a time), and the owner's accounts and the accounts on your shelf
// are always added. If the relay can't be reached, those are shown with a quiet note. Each account's posts are read
// from its own server (listRecords), a few accounts at a time, kept a few minutes.
//
// What shows: a post whose author is hidden (the hide list, Bluesky's moderation) doesn't, and neither does a post
// whose tile is hidden. A post record that doesn't name a tile properly (a strongRef to an ing.dasl.masl record) is
// left out. Text longer than the lexicon allows is cut. The tile itself is read when its card is drawn: a tile that
// is gone, or whose record no longer matches the version the post names (its CID), shows "This tile can't be shown."
//
// Song posts (claude/mixtape-3c-track-renderer-notes.md, R3c-11, PB2): a post may also name a `record` (a strongRef),
// the record it is about when that isn't a tile; its `tile` is then the renderer tile that showed it when posted
// (Tracks for songs). Raku shows such a post as a song card and plays the song with its currently pinned Tracks
// (discover.js). A `record` of a kind Raku has no card for is left aside: the post shows its tile, as before. A song
// whose account is hidden leaves the post out, as a hidden tile does.

import { TILE_POSTS, COLLECTION, rendererFor } from './config.js';
import { fetchJson, NetError } from './net.js';
import { atUri, DID_PLC, DID_WEB } from './address.js';
import { tidTime } from './following.js';

export const POST_COLLECTION = 'cafe.thunderbird.tile.post';
// The kinds a song post can name (Tracks plays them, R3c-6).
export const SONG_KINDS = Object.freeze(['cafe.thunderbird.audio.track', 'fm.plyr.track']);
export const TEXT_MAX = 300;      // graphemes (the lexicon's maxGraphemes)
export const ALT_MAX = 1000;

const RKEY = /^[A-Za-z0-9._~:-]{1,512}$/;
const CID = /^b[a-z2-7]{20,200}$/;
const isDid = (s) => typeof s === 'string' && (DID_PLC.test(s) || DID_WEB.test(s));

/** Splits text into what a reader sees as characters (graphemes); plain code points where Intl.Segmenter is missing. */
function graphemes(s) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

/** Text cut to `max` graphemes ("…" after a cut). Anything but a string is ''. */
export function cutText(s, max = TEXT_MAX) {
  if (typeof s !== 'string') return '';
  const t = s.length > max * 40 ? s.slice(0, max * 40) : s;       // nobody needs more than this to cut from
  const g = graphemes(t);
  return g.length > max || t.length < s.length ? `${g.slice(0, max).join('')}…` : t;
}

/** A tile's address from a strongRef's uri: at://<did>/ing.dasl.masl/<rkey> (a DID, not a handle). → { did, rkey, uri } | null */
export function tileOf(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(typeof uri === 'string' ? uri : '');
  if (!m || !isDid(m[1]) || m[2] !== COLLECTION || !RKEY.test(m[3])) return null;
  return { did: m[1], rkey: m[3], uri: atUri(m[1], m[3]) };
}

/**
 * A song post's `record` (PB2): a strongRef to a song (by DID) whose kind has a pinned renderer. → { did, collection,
 * rkey, uri, cid } | null (not a song, not by DID, no renderer, a bad version).
 */
export function songRefOf(ref, renderers) {
  if (!ref || typeof ref !== 'object' || typeof ref.cid !== 'string' || !CID.test(ref.cid)) return null;
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(typeof ref.uri === 'string' ? ref.uri : '');
  if (!m || !isDid(m[1]) || !SONG_KINDS.includes(m[2]) || !RKEY.test(m[3])) return null;
  if (!(renderers ? renderers[m[2]] : rendererFor(m[2]))) return null;
  return { did: m[1], collection: m[2], rkey: m[3], uri: `at://${m[1]}/${m[2]}/${m[3]}`, cid: ref.cid };
}

const plainText = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2002-04-20" → "April 20, 2002" (as Tracks writes it); anything else as given, or ''. */
export function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof d === 'string' ? d.trim() : '');
  if (!m || +m[2] < 1 || +m[2] > 12) return plainText(d, 40);
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}
/** 437 → "7:17"; 3725 → "1:02:05"; nothing → ''. */
export function songLength(s) {
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return '';
  const x = Math.round(s), hh = Math.floor(x / 3600), mm = Math.floor((x % 3600) / 60), ss = x % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
/**
 * What a song card says (the song posts mockup, PB4), from the song's record as stored. → { title, artist, where, when,
 * length, plyr, playable } — where: "venue, place" (ours) or the show from the album without the band; when: the date
 * written out, or the album's year; playable: its audio is on its account's own server (an audioBlob).
 */
export function songOf(value, collection) {
  const v = value && typeof value === 'object' ? value : {};
  const rec = v.recording && typeof v.recording === 'object' ? v.recording : {};
  const title = plainText(v.title) || 'Untitled song';
  const artist = plainText(v.artist);
  let where = [plainText(rec.venue), plainText(rec.place)].filter(Boolean).join(', ');
  let when = longDate(rec.date);
  if (!where || !when) {
    // "Band · Show · 2011-02-17" (the importer's and plyr.fm's albums): the parts after the band
    const parts = plainText(v.album).split(' · ').map((x) => x.trim()).filter(Boolean);
    if (parts.length && artist && parts[0] === artist) parts.shift();
    const date = parts.length && /^\d{4}(-\d{2}-\d{2})?$/.test(parts[parts.length - 1]) ? parts.pop() : '';
    if (!where) where = parts.join(' · ');
    if (!when && date) when = longDate(date);
  }
  const blob = v.audioBlob;
  const playable = !!(blob && typeof blob === 'object' && blob.ref && typeof blob.ref.$link === 'string');
  return { title, artist, where, when, length: songLength(v.duration), plyr: collection === 'fm.plyr.track', playable };
}

/** When a post was made: its createdAt if sensible (after 2023, not more than a day ahead), else its key's time. */
export function postTime(value, rkey, now = Date.now()) {
  const c = Date.parse(value?.createdAt);
  if (Number.isFinite(c) && c > Date.UTC(2023, 0, 1) && c <= now + 24 * 3600 * 1000) return c;
  return tidTime(rkey) || 0;
}

/**
 * One record from listRecords, checked. → null when it isn't a tile post Raku can show, else
 * { did, rkey, uri, cid, text, alt, langs, createdAt, time, tile: { did, rkey, uri, cid } }
 */
export function readTilePost(rec, did, now = Date.now()) {
  if (!rec || typeof rec !== 'object' || typeof rec.uri !== 'string') return null;
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(rec.uri);
  if (!m || m[1] !== did || m[2] !== POST_COLLECTION || !RKEY.test(m[3])) return null;
  const v = rec.value;
  if (!v || typeof v !== 'object') return null;
  if (v.$type !== undefined && v.$type !== POST_COLLECTION) return null;
  const ref = v.tile;
  if (!ref || typeof ref !== 'object' || typeof ref.cid !== 'string' || !CID.test(ref.cid)) return null;
  const tile = tileOf(ref.uri);
  if (!tile) return null;
  const rkey = m[3];
  return {
    did, rkey, uri: rec.uri, cid: typeof rec.cid === 'string' ? rec.cid : null,
    text: cutText(v.text, TEXT_MAX),
    alt: cutText(v.alt, ALT_MAX),
    langs: Array.isArray(v.langs) ? v.langs.filter((l) => typeof l === 'string' && l.length <= 32).slice(0, 3) : [],
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : null,
    time: postTime(v, rkey, now),
    tile: { ...tile, cid: ref.cid },
    record: songRefOf(v.record),
  };
}

/** Many accounts' posts as one list, newest first (ties: by address, so the order is stable), at most `max`. */
export function mergePosts(lists, max = Infinity) {
  return lists.flat().sort((a, b) => (b.time - a.time) || (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)).slice(0, max);
}

/** The accounts to read, in order: the ones Raku always reads, the shelf's, then the relay's; no repeats, at most `max`. */
export function accountsToRead({ always = [], shelf = [], relay = [] }, max = TILE_POSTS.maxAccounts) {
  const out = [];
  const seen = new Set();
  for (const did of [...always, ...shelf, ...relay]) {
    if (!isDid(did) || seen.has(did)) continue;
    seen.add(did);
    out.push(did);
    if (out.length >= max) break;
  }
  return out;
}

/** Can the post's tile be shown, given the tile record Raku read? 'ok' | 'changed' (another version than the post names). */
export function tileState(post, rec) {
  return rec && typeof rec.cid === 'string' && rec.cid === post.tile.cid ? 'ok' : 'changed';
}

/** Asks the relay which accounts hold tile posts, 100 at a time, up to `max`. → { dids, ok } (ok: false when it failed). */
export async function relayAccounts({ fetchImpl = globalThis.fetch, limits = TILE_POSTS } = {}) {
  const dids = [];
  let cursor = null;
  try {
    for (let page = 0; page < Math.ceil(limits.maxAccounts / limits.relayPage) + 1; page++) {
      let url = `${limits.relay}/xrpc/com.atproto.sync.listReposByCollection?collection=${encodeURIComponent(POST_COLLECTION)}&limit=${limits.relayPage}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      const r = await fetchJson(url, { timeoutMs: limits.relayMs, maxBytes: 1024 * 1024, fetchImpl });
      if (!r.ok || !Array.isArray(r.json?.repos)) throw new NetError('upstream', "The relay didn't list the accounts.");
      for (const x of r.json.repos) if (x && isDid(x.did)) dids.push(x.did);
      cursor = typeof r.json.cursor === 'string' && r.json.cursor && r.json.repos.length ? r.json.cursor : null;
      if (!cursor || dids.length >= limits.maxAccounts) break;
    }
    return { dids: dids.slice(0, limits.maxAccounts), ok: true };
  } catch {
    return { dids, ok: false };
  }
}

function limiter(max) {
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < max && queue.length) {
      const { job, ok, no } = queue.shift();
      running++;
      job().then(ok, no).finally(() => { running--; pump(); });
    }
  };
  return (job) => new Promise((ok, no) => { queue.push({ job, ok, no }); pump(); });
}

/** What Discover keeps for Tile posts while Raku is open. */
export function createTilePosts({ resolver, moderation, shelf, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = TILE_POSTS } = {}) {
  let kept = null;          // { at, key, value }
  let loading = null;

  /** One account's newest tile posts, from its own server. → [post] */
  async function accountPosts(did) {
    const { pds } = await resolver.account(did);
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(POST_COLLECTION)}&limit=${limits.perAccount}`;
    const r = await fetchJson(url, { timeoutMs: limits.accountMs, maxBytes: 2 * 1024 * 1024, fetchImpl });
    if (r.status === 400 && /RepoNotFound|RepoTakendown|RepoDeactivated/.test(r.json?.error || '')) return [];
    if (!r.ok || !Array.isArray(r.json?.records)) throw new NetError('upstream', "The account's server didn't list its tile posts.");
    return r.json.records.map((rec) => readTilePost(rec, did, now())).filter(Boolean);
  }

  // Posts written from this Raku (claude/raku-write-posts-plan.md, WP10): shown straight away, without waiting for the
  // relay or a Refresh, until a load finds them on their own.
  const written = new Map();          // uri → post
  const withWritten = (value) => {
    for (const uri of written.keys()) if (value.items.some((x) => x.uri === uri)) written.delete(uri);
    return written.size ? { ...value, items: mergePosts([value.items, [...written.values()]], limits.max) } : value;
  };

  /** Everyone's newest tile posts. → { items: [post], accounts, unreachable, relayOk } */
  async function load({ fresh = false } = {}) {
    const mine = shelf.accounts().map((a) => a.did);
    const key = mine.slice().sort().join(' ');
    if (!fresh && kept && kept.key === key && now() - kept.at < limits.keepMs) return withWritten(kept.value);
    if (loading && loading.key === key) return loading.p;
    const p = (async () => {
      const relay = await relayAccounts({ fetchImpl, limits });
      const dids = accountsToRead({ always: limits.always, shelf: mine, relay: relay.dids }, limits.maxAccounts);
      await moderation.profiles(dids).catch(() => null);     // Bluesky's view of every author, 25 to a request
      const run = limiter(limits.atOnce);
      let unreachable = 0;
      const lists = await Promise.all(dids.map((did) => run(async () => {
        try {
          if (await moderation.isAccountHidden(did)) return [];
          const out = [];
          for (const post of await accountPosts(did)) {
            if (await moderation.isHidden(post.tile.did, post.tile.rkey)) continue;   // a hidden tile, or its account
            if (post.record && await moderation.isAccountHidden(post.record.did)) continue;   // a song post: the song's account
            out.push(post);
          }
          return out;
        } catch {
          unreachable++;
          return [];
        }
      })));
      const value = { items: mergePosts(lists, limits.max), accounts: dids.length, unreachable, relayOk: relay.ok };
      kept = { at: now(), key, value };
      return withWritten(value);
    })().finally(() => { loading = null; });
    loading = { key, p };
    return p;
  }

  /** A post just written from Raku (a readTilePost result): in the list at once, newest first. */
  function add(post) { if (post && post.uri) written.set(post.uri, post); }

  return { load, add, get cached() { return kept ? withWritten(kept.value) : null; } };
}
