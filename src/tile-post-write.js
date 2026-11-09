// Writing tile posts from inside Raku (claude/raku-write-posts-plan.md, WP1 to WP13): the record, writing it to one of
// your signed-in accounts and reading it back, and the list of your accounts' tiles for "Write a post". No DOM here
// (tested in Node); post-box.js draws the post box.
//
// The record is the lexicon's (pyxorium/tile-posts, cafe.thunderbird.tile.post), built as the Foundry's
// src/core/tile-post.js and tile_post.py do: the tile by its exact version (a strongRef: its record's uri, by DID, and
// cid), optional text (up to 300 graphemes and 3000 bytes), optional alt (up to 1000 graphemes and 10000 bytes), up to
// three language tags, and createdAt. Blanks are left out. The key is a TID, like Bluesky's posts.
//
// Who can post what (WP1, WP2): Raku offers Post only on a tile whose account is one of the accounts signed in on this
// browser, and the post can come from any of them. (The rule lives in Raku's buttons: a record can't show that two
// accounts are one person's.)

import { COLLECTION, TILE_POSTS } from './config.js';
import { atUri, DID_PLC, DID_WEB } from './address.js';
import { describeTile } from './tiles.js';
import { newTid, tidTime } from './tables/daisy-shared/tid.js';
import { readTilePost } from './tile-posts.js';
import { SignInNeeded } from './auth.js';

export const POST_LIMITS = Object.freeze({ text: [300, 3000], alt: [1000, 10000], langs: 3 });
const LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/;
const CID = /^b[a-z2-7]{20,200}$/;
const isDid = (s) => typeof s === 'string' && (DID_PLC.test(s) || DID_WEB.test(s));

/** What a reader sees as characters (graphemes); code points where Intl.Segmenter is missing (never fewer than graphemes). */
export function graphemeCount(s) {
  const t = String(s ?? '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].length;
  return [...t].length;
}
const byteCount = (s) => new TextEncoder().encode(String(s ?? '')).length;

/** The language box: "en", "en, fr" or "en fr" → ['en', 'fr']; a tag that isn't one → { bad }. */
export function readLangs(input) {
  const list = (Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean);
  const bad = list.find((l) => !LANG.test(l));
  if (bad) return { bad };
  return { langs: [...new Set(list)] };
}

/** Is this text within a limit ([graphemes, bytes])? → '' or the reason, in words. */
function overLimit(what, s, [g, b]) {
  if (graphemeCount(s) > g) return `${what} is over ${g} characters.`;
  if (byteCount(s) > b) return `${what} is too long.`;
  return '';
}

/**
 * The record for a post. tile: { uri, cid } (the tile record's own uri, by DID, and its cid). → { ok: true, record } or
 * { ok: false, why } (in words, for the post box).
 */
export function buildPostRecord({ tile, text = '', alt = '', langs = '', createdAt = new Date().toISOString() } = {}) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(tile && typeof tile.uri === 'string' ? tile.uri : '');
  if (!m || !isDid(m[1]) || m[2] !== COLLECTION) return { ok: false, why: "This isn't a tile Raku can post." };
  if (!tile || typeof tile.cid !== 'string' || !CID.test(tile.cid)) return { ok: false, why: "This tile's version couldn't be read." };
  const t = String(text ?? '').trim();
  const a = String(alt ?? '').trim();
  const why = overLimit('The text', t, POST_LIMITS.text) || overLimit('The alt text', a, POST_LIMITS.alt);
  if (why) return { ok: false, why };
  const l = readLangs(langs);
  if (l.bad) return { ok: false, why: `“${l.bad}” isn't a language tag (for example en, fr or pt-BR).` };
  if (l.langs.length > POST_LIMITS.langs) return { ok: false, why: `At most ${POST_LIMITS.langs} languages.` };
  const record = { $type: TILE_POSTS.collection, tile: { uri: tile.uri, cid: tile.cid } };
  if (t) record.text = t;
  if (a) record.alt = a;
  if (l.langs.length) record.langs = l.langs;
  record.createdAt = createdAt;
  return { ok: true, record };
}

// The same object, whatever the order of its keys (a server may hand a record back with its keys reordered).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** A step that failed, for the post box: code 'write' (nothing written), 'scope' (the sign-in doesn't allow it),
 *  'signin' (the sign-in ran out), or 'verify' (written, but the check afterwards failed: it may be posted). */
export class PostError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Writes the post to `did`'s repo and reads it back from the account's server.
 *   auth: { putRecord(did, { collection, rkey, record, validate }) }   resolver: { record(did, collection, rkey) }
 * → { uri, cid, rkey, post } (post: as Tile posts reads it, to add to the list straight away). PostError otherwise.
 */
export async function writePost({ auth, resolver, did, record, rkey = newTid(), now = () => Date.now() }) {
  let put;
  try {
    put = await auth.putRecord(did, { collection: TILE_POSTS.collection, rkey, record, validate: false });
  } catch (err) {
    if (err && err.code === 'scope') throw new PostError('scope', "This sign-in doesn't allow posting. Sign in again to approve “Raku”.");
    if (err instanceof SignInNeeded) throw new PostError('signin', 'This account is no longer signed in here. Sign in again, then post.');
    throw new PostError('write', `Couldn't post: ${err && err.message ? err.message : "your account's server didn't answer."}`);
  }
  let back;
  try { back = await resolver.record(did, TILE_POSTS.collection, rkey); } catch { back = null; }
  if (!back || !same(back.value, record)) throw new PostError('verify', 'Raku couldn’t check the post afterwards.');
  const uri = put && put.uri ? put.uri : `at://${did}/${TILE_POSTS.collection}/${rkey}`;
  const post = readTilePost({ uri, cid: (put && put.cid) || back.cid || null, value: back.value }, did, now());
  return { uri, cid: (put && put.cid) || back.cid || null, rkey, post };
}

/** Deletes one of your tile posts (tests and tidying; not offered in the post box). */
export async function deletePost({ auth, did, rkey }) {
  return auth.call(did, 'com.atproto.repo.deleteRecord', { body: { repo: did, collection: TILE_POSTS.collection, rkey } });
}

/** Can this tile be posted from Raku? Only when its account is one of yours signed in here (WP1). */
export function canPostTile(tileDid, accounts) {
  return isDid(tileDid) && (accounts || []).some((a) => a && a.did === tileDid);
}

/** The From choice (WP2, WP9): your signed-in accounts, the tile's own first (where From starts). → [{ did, handle }] */
export function fromChoices(tileDid, accounts) {
  const list = (accounts || []).filter((a) => a && isDid(a.did));
  const own = list.find((a) => a.did === tileDid);
  return own ? [own, ...list.filter((a) => a !== own)] : list;
}

/**
 * "Write a post": your signed-in accounts' tiles, newest first, by account; hidden tiles left out (WP13).
 *   resolver.listTiles(did, cursor, limit) → { records, cursor }   moderation.onHideList(did, rkey) → boolean
 * → [{ did, handle, tiles: [{ did, rkey, uri, cid, name, time, record }], error? }]
 */
export async function yourTiles({ accounts, resolver, moderation, perAccount = 50 }) {
  const out = [];
  for (const a of accounts || []) {
    if (!a || !isDid(a.did)) continue;
    const entry = { did: a.did, handle: a.handle || a.did, tiles: [] };
    try {
      const page = await resolver.listTiles(a.did, null, perAccount);
      for (const rec of page.records) {
        if (await moderation.onHideList(a.did, rec.rkey)) continue;
        const d = describeTile(rec);
        if (!d.ok || typeof rec.cid !== 'string') continue;
        const c = Date.parse(rec.value && rec.value.createdAt);
        entry.tiles.push({ did: a.did, rkey: rec.rkey, uri: atUri(a.did, rec.rkey), cid: rec.cid, name: d.name, time: Number.isFinite(c) ? c : (tidTime(rec.rkey) || 0), record: rec });
      }
      entry.tiles.sort((x, y) => y.time - x.time);
    } catch {
      entry.error = "Couldn't list this account's tiles just now.";
    }
    out.push(entry);
  }
  return out;
}
