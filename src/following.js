// Following (stage 6, Q91): new tiles from the accounts kept on your shelf, newest first, all mixed, with a
// quiet "New" on tiles that appeared since your last visit to Following.
//
// Raku asks each kept account's own server for its latest few tiles (FOLLOWING.perAccount), four accounts at
// a time, and keeps the answers for a few minutes; nothing goes anywhere else. Hidden accounts and tiles
// (the coded hide list, Bluesky's moderation) are left out, and so are records Raku can't run.
// "Your last visit" is remembered in this browser only (FOLLOWING.seenKey); the first visit marks nothing.

import { FOLLOWING } from './config.js';
import { atUri } from './address.js';
import { describeTile } from './tiles.js';

// A record key made by atproto (a TID: 13 characters of base32-sortable) carries the time it was made.
const S32 = '234567abcdefghijklmnopqrstuvwxyz';
export function tidTime(rkey) {
  if (typeof rkey !== 'string' || !/^[2-7a-z]{13}$/.test(rkey)) return null;
  let n = 0n;
  for (const c of rkey) n = n * 32n + BigInt(S32.indexOf(c));
  const micros = n >> 10n;                     // the top bits are microseconds since 1970, then a clock id
  const ms = Number(micros / 1000n);
  return ms > Date.UTC(2023, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
}

/** When a tile was made: its record's createdAt (unless it's in the future), else its record key. */
export function tileTime(rec, now = Date.now()) {
  const c = Date.parse(rec?.value?.createdAt);
  if (Number.isFinite(c) && c <= now + 24 * 3600 * 1000 && c > Date.UTC(2023, 0, 1)) return c;
  return tidTime(rec?.rkey) || 0;
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

export function createFollowing({ resolver, moderation, shelf, storage = null, now = () => Date.now(), limits = FOLLOWING } = {}) {
  let kept = null;          // { at, key, value }
  let loading = null;
  let sessionSeen;          // the "last visit" this page load compares against (read once, then today's visit is stored)

  /** Everyone's newest tiles. → { items: [{ did, rkey, uri, record, time }], accounts, unreachable } */
  async function load({ fresh = false } = {}) {
    const accounts = shelf.accounts();
    const key = accounts.map((a) => a.did).sort().join(' ');
    if (!fresh && kept && kept.key === key && now() - kept.at < limits.keepMs) return kept.value;
    if (loading && loading.key === key) return loading.p;
    const run = limiter(4);
    const p = (async () => {
      let unreachable = 0;
      const lists = await Promise.all(accounts.map((a) => run(async () => {
        try {
          if (await moderation.isAccountHidden(a.did)) return [];
          const page = await resolver.listTiles(a.did, null, limits.perAccount);
          const out = [];
          for (const rec of page.records) {
            if (await moderation.onHideList(a.did, rec.rkey)) continue;
            if (!describeTile(rec).ok) continue;
            out.push({ did: a.did, rkey: rec.rkey, uri: atUri(a.did, rec.rkey), record: rec, time: tileTime(rec, now()) });
          }
          return out;
        } catch {
          unreachable++;
          return [];
        }
      })));
      const items = lists.flat().sort((x, y) => y.time - x.time).slice(0, limits.max);
      const value = { items, accounts: accounts.length, unreachable };
      kept = { at: now(), key, value };
      return value;
    })().finally(() => { loading = null; });
    loading = { key, p };
    return p;
  }

  /** The last visit's time (for "New"), the same all through this page load; null on a first visit. */
  function lastSeen() {
    if (sessionSeen === undefined) {
      let v = null;
      try { v = Number(storage?.getItem(limits.seenKey)) || null; } catch { v = null; }
      sessionSeen = v;
    }
    return sessionSeen;
  }
  /** Today's visit: remembered for next time (this page load keeps comparing against the earlier one). */
  function markSeen() {
    lastSeen();
    try { storage?.setItem(limits.seenKey, String(now())); } catch { /* fine: no markers next time */ }
  }
  const isNew = (item) => { const s = lastSeen(); return !!s && item.time > s; };

  return { load, lastSeen, markSeen, isNew, get cached() { return kept ? kept.value : null; } };
}
