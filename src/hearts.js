// Hearts on tile posts (claude/raku-hearts-plan.md, HT1 to HT15): cafe.thunderbird.tile.like records (the lexicon in
// pyxorium/tile-posts; Bluesky's like shape: subject, a strongRef, and createdAt) in each hearting account's own repo.
// No DOM here (tested in Node); discover.js draws the heart under each post.
//
// Counting, Raku's own way (HT1, HT8, HT9): Bluesky's relay is asked which accounts hold hearts
// (com.atproto.sync.listReposByCollection), each one's hearts are read from its own server (listRecords, a few accounts
// at a time), and one pass counts every post at once: distinct accounts per post, hidden accounts (the hide list,
// Bluesky's moderation) left out, hearts on anything but a tile post ignored (HT3: the record allows tiles later).
// Kept a few minutes, as Tile posts. Written so another counter (Constellation, say) could stand in for pass() later.
//
// Yours (HT7, HT10): the current account's hearts are read straight from its own server, so yours is right at once;
// a heart shows filled the moment it's tapped, and is saved in the background, the last choice only. A count is the
// pass's accounts other than yours, plus one if you've hearted, so your own heart never counts twice or lags.

import { HEARTS } from './config.js';
import { fetchJson, NetError } from './net.js';
import { DID_PLC, DID_WEB } from './address.js';
import { newTid } from './tables/daisy-shared/tid.js';
import { SignInNeeded } from './auth.js';

export const HEART_COLLECTION = HEARTS.collection;
const RKEY = /^[A-Za-z0-9._~:-]{1,512}$/;
const CID = /^b[a-z2-7]{20,200}$/;
const isDid = (s) => typeof s === 'string' && (DID_PLC.test(s) || DID_WEB.test(s));
const POST_URI = /^at:\/\/(did:[a-z]+:[^/]+)\/cafe\.thunderbird\.tile\.post\/([A-Za-z0-9._~:-]{1,512})$/;

/** Is this the address of a tile post (by DID)? Hearts on anything else aren't shown this round (HT3). */
export const isPostUri = (uri) => typeof uri === 'string' && POST_URI.test(uri) && isDid(POST_URI.exec(uri)[1]);

/** One record from listRecords, checked. → { did, rkey, subject } (subject: a tile post's address) | null */
export function readHeart(rec, did) {
  if (!rec || typeof rec !== 'object' || typeof rec.uri !== 'string') return null;
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(rec.uri);
  if (!m || m[1] !== did || m[2] !== HEART_COLLECTION || !RKEY.test(m[3])) return null;
  const v = rec.value;
  if (!v || typeof v !== 'object' || (v.$type !== undefined && v.$type !== HEART_COLLECTION)) return null;
  const s = v.subject;
  if (!s || typeof s !== 'object' || typeof s.cid !== 'string' || !CID.test(s.cid) || !isPostUri(s.uri)) return null;
  return { did, rkey: m[3], subject: s.uri };
}

/** The record for a heart on a post (HT2). post: { uri, cid } (the post record's own address and version). */
export function buildHeartRecord(post, createdAt = new Date().toISOString()) {
  if (!post || !isPostUri(post.uri) || typeof post.cid !== 'string' || !CID.test(post.cid)) return null;
  return { $type: HEART_COLLECTION, subject: { uri: post.uri, cid: post.cid }, createdAt };
}

/** A step that failed, for the heart: 'scope' (the sign-in predates hearts), 'signin' (it ran out), 'write' (not saved). */
export class HeartError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Asks the relay which accounts hold hearts, 100 at a time. → { dids, ok } */
export async function heartAccounts({ fetchImpl = globalThis.fetch, limits = HEARTS } = {}) {
  const dids = [];
  let cursor = null;
  try {
    for (let page = 0; page < Math.ceil(limits.maxAccounts / limits.relayPage) + 1; page++) {
      let url = `${limits.relay}/xrpc/com.atproto.sync.listReposByCollection?collection=${encodeURIComponent(limits.collection)}&limit=${limits.relayPage}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      const r = await fetchJson(url, { timeoutMs: limits.relayMs, maxBytes: 1024 * 1024, fetchImpl });
      if (!r.ok || !Array.isArray(r.json?.repos)) throw new NetError('upstream', "The relay didn't list the accounts.");
      for (const x of r.json.repos) if (x && isDid(x.did) && !dids.includes(x.did)) dids.push(x.did);
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

/**
 * What Raku keeps for hearts while it's open.
 *   resolver: { account(did) → { pds } }   moderation: { profiles(dids), isAccountHidden(did) }
 *   auth: { putRecord(did, …), call(did, nsid, { body }) } (writing; reading needs no sign-in)
 */
export function createHearts({ resolver, moderation, auth = null, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = HEARTS } = {}) {
  let kept = null;              // { at, value: { byPost: Map(uri → Set(did)), ok } }
  let loading = null;
  const yours = new Map();      // did → Map(post uri → [rkey…])  (read from the account's own server)
  const wanted = new Map();     // `${did} ${uri}` → true | false   (the last choice, shown at once)
  const saving = new Map();     // `${did} ${uri}` → promise         (one save at a time per post)
  const listeners = new Set();
  const changed = () => { for (const f of listeners) { try { f(); } catch { /* a drawn card gone */ } } };

  /** One account's hearts, from its own server, a page at a time. → [heart] */
  async function accountHearts(did) {
    const { pds } = await resolver.account(did);
    const out = [];
    let cursor = null;
    for (let page = 0; page < limits.pages; page++) {
      let url = `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(limits.collection)}&limit=${limits.pageSize}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      const r = await fetchJson(url, { timeoutMs: limits.accountMs, maxBytes: 2 * 1024 * 1024, fetchImpl });
      if (r.status === 400 && /RepoNotFound|RepoTakendown|RepoDeactivated/.test(r.json?.error || '')) return out;
      if (!r.ok || !Array.isArray(r.json?.records)) throw new NetError('upstream', "The account's server didn't list its hearts.");
      for (const rec of r.json.records) { const x = readHeart(rec, did); if (x) out.push(x); }
      cursor = typeof r.json.cursor === 'string' && r.json.cursor && r.json.records.length ? r.json.cursor : null;
      if (!cursor) break;
    }
    return out;
  }

  /** Everyone's hearts, counted per post (HT9). → { byPost, ok, accounts, unreachable } */
  async function pass({ fresh = false } = {}) {
    if (!fresh && kept && now() - kept.at < limits.keepMs) return kept.value;
    if (loading) return loading;
    loading = (async () => {
      const relay = await heartAccounts({ fetchImpl, limits });
      const dids = relay.dids;
      await moderation.profiles(dids).catch(() => null);      // 25 to a request, as Tile posts
      const run = limiter(limits.atOnce);
      const byPost = new Map();
      let unreachable = 0;
      await Promise.all(dids.map((did) => run(async () => {
        try {
          if (await moderation.isAccountHidden(did)) return;    // HT8: left out, silently
          for (const x of await accountHearts(did)) {
            if (!byPost.has(x.subject)) byPost.set(x.subject, new Set());
            byPost.get(x.subject).add(did);                      // distinct accounts (HT2)
          }
        } catch { unreachable++; }
      })));
      const value = { byPost, ok: relay.ok, accounts: dids.length, unreachable };
      kept = { at: now(), value };
      return value;
    })().finally(() => { loading = null; });
    const v = await loading;
    changed();
    return v;
  }

  /** The current account's hearts, read straight from its server (yours is right at once, HT9). */
  async function readYours(did, { fresh = false } = {}) {
    if (!isDid(did)) return null;
    if (!fresh && yours.has(did)) return yours.get(did);
    const map = new Map();
    for (const x of await accountHearts(did)) {
      if (!map.has(x.subject)) map.set(x.subject, []);
      map.get(x.subject).push(x.rkey);
    }
    yours.set(did, map);
    changed();
    return map;
  }

  /** Has `did` hearted this post, as shown now (the last choice, else what its server holds)? */
  function hearted(did, uri) {
    const k = `${did} ${uri}`;
    if (wanted.has(k)) return wanted.get(k);
    const m = isDid(did) ? yours.get(did) : null;
    if (m) return !!(m.has(uri) && m.get(uri).length);
    const set = kept ? kept.value.byPost.get(uri) : null;      // not read yet: what the pass found
    return !!(set && isDid(did) && set.has(did));
  }

  /** The count shown for a post: the pass's accounts other than you, plus one if you've hearted. null: not counted yet. */
  function count(uri, did = null) {
    if (!kept) return null;
    const set = kept.value.byPost.get(uri);
    let n = set ? set.size : 0;
    if (isDid(did) && set && set.has(did)) n--;
    return n + (isDid(did) && hearted(did, uri) ? 1 : 0);
  }

  const counted = () => !!kept;

  async function write(did, post, want) {
    const map = yours.get(did) || new Map();
    yours.set(did, map);
    const keys = map.get(post.uri) || [];
    try {
      if (want && !keys.length) {
        const record = buildHeartRecord(post);
        if (!record) throw new HeartError('write', "This post can't be hearted.");
        const rkey = newTid();
        await auth.putRecord(did, { collection: limits.collection, rkey, record, validate: false });
        map.set(post.uri, [rkey]);
      } else if (!want && keys.length) {
        for (const rkey of keys) await auth.call(did, 'com.atproto.repo.deleteRecord', { body: { repo: did, collection: limits.collection, rkey } });
        map.delete(post.uri);
      }
    } catch (err) {
      if (err instanceof HeartError) throw err;
      if (err && (err.code === 'scope' || err.status === 403 || /scope/i.test(String(err.error || '')))) throw new HeartError('scope', "This sign-in doesn't allow hearts yet.");
      if (err instanceof SignInNeeded) throw new HeartError('signin', 'This account is no longer signed in here.');
      throw new HeartError('write', "Couldn't save your heart.");
    }
    return want;
  }

  /**
   * Hearts or un-hearts a post as `did` (HT10): shown at once; saved in the background, only the last choice (heart,
   * un-heart, heart → one heart). → a promise of the saved state; on failure the heart goes back as the server has it
   * and the promise rejects with a HeartError (the card says "Couldn't save your heart", or asks to sign in again).
   */
  function set(did, post, want) {
    const k = `${did} ${post.uri}`;
    wanted.set(k, !!want);
    changed();
    if (saving.has(k)) return saving.get(k);
    const p = (async () => {
      let last;
      try {
        if (!yours.has(did)) await readYours(did).catch(() => null);
        for (;;) {
          last = wanted.get(k);
          await write(did, post, last);
          if (wanted.get(k) === last) break;          // a newer choice came while saving: save that too
        }
        wanted.delete(k);
        return last;
      } catch (err) {
        wanted.delete(k);                              // back to what the server holds
        throw err;
      } finally {
        saving.delete(k);
        changed();
      }
    })();
    saving.set(k, p);
    return p;
  }

  /** Called whenever a count or a heart may have changed (cards redraw their heart). → stop listening */
  function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

  /** Something outside changed (signed out, another account current): cards redraw their heart. */
  const redraw = () => changed();

  return { pass, readYours, hearted, count, counted, set, onChange, redraw, get cached() { return kept ? kept.value : null; } };
}

