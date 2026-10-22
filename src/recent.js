// Recent tiles (stage 6c, claude/raku-stage6c-plan.md): the newest tiles on the network, as listed by
// appmosphe.re (GET https://appmosphe.re/api/tiles?page=N: 30 a page, newest first by each tile's createdAt).
//
// - appmosphe.re's order as it is (Q106 A), no grouping by author (Q107 C), cards only (nothing runs).
// - Moderation: the coded hide list (a tile or its whole account), and each author's Bluesky account checked
//   in one request per 25 authors (moderation.js profiles): a hiding label leaves out all their tiles, an adult
//   label blurs their pictures. The handle shown is the one Bluesky checked; else the account's DID.
// - Pictures: the tile's first screenshot, else its icon, only from appmosphe.re's own /img/ copies.
// - A quiet "New" on tiles made since your last visit (Q110 A), remembered on this device (marks.js).
// Raku reads only what it needs from each entry, and checks every piece (an address Raku can open, text of
// sensible length), so a changed answer can't put anything strange on the page.

import { RECENT } from './config.js';
import { isDid, isRkey, atUri } from './address.js';
import { fetchJson, NetError } from './net.js';
import { createMarks } from './marks.js';

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** An appmosphe.re picture address, or null (only its own /img/ copies, over https). */
export function recentPicture(v) {
  if (typeof v !== 'string' || v.length > 1024) return null;
  let u;
  try { u = new URL(v, RECENT.imgPrefix); } catch { return null; }
  return u.href.startsWith(RECENT.imgPrefix) && !u.username && !u.password ? u.href : null;
}

/** One page of appmosphe.re's list, read carefully. → { page, pages, total, tiles: [{ did, rkey, uri, name, description, createdAt, picture, pictureIsIcon }] } */
export function readRecentPage(json) {
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const out = { page: num(json?.page), pages: num(json?.pages), total: num(json?.total), tiles: [] };
  const seen = new Set();
  for (const t of Array.isArray(json?.tiles) ? json.tiles.slice(0, 100) : []) {
    const did = typeof t?.did === 'string' ? t.did : t?.author?.did;
    const rkey = t?.rkey;
    if (typeof did !== 'string' || !isDid(did) || typeof rkey !== 'string' || !isRkey(rkey)) continue;
    const uri = atUri(did, rkey);
    if (seen.has(uri)) continue;
    seen.add(uri);
    const shots = Array.isArray(t.screenshots) ? t.screenshots : [];
    const shot = shots.map((s) => recentPicture(typeof s === 'string' ? s : s?.url)).find(Boolean) || null;
    const iconPic = recentPicture(typeof t.icon === 'string' ? t.icon : t.icon?.url);
    const created = Date.parse(t.createdAt);
    out.tiles.push({
      did, rkey, uri,
      name: text(t.name, 120) || 'Untitled tile',
      description: text(t.description, 300),
      createdAt: Number.isFinite(created) ? new Date(created).toISOString() : '',
      picture: shot || iconPic,
      pictureIsIcon: !shot && !!iconPic,
    });
  }
  return out;
}

export function createRecent({ moderation, storage = null, marks = null, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = RECENT } = {}) {
  marks = marks || createMarks({ storage, now });
  const pages = new Map();        // page number -> { at, value }
  const loading = new Map();
  let sessionSeen = null;

  /** One page, moderated. → { page, pages, total, more, tiles: [{ …, handle, blur }] } ; NetError when appmosphe.re can't be read. */
  async function load(page = 1, { fresh = false } = {}) {
    const n = Math.max(1, Math.min(limits.maxPages, Math.floor(Number(page)) || 1));
    const k = pages.get(n);
    if (!fresh && k && now() - k.at < limits.keepMs) return k.value;
    if (loading.has(n)) return loading.get(n);
    const p = (async () => {
      sessionSeen = await marks.lastSeen('recent');
      const r = await fetchJson(`${limits.url}?page=${n}`, { timeoutMs: 10000, maxBytes: limits.maxBytes, fetchImpl });
      if (!r.ok) throw new NetError('upstream', `${limits.name} answered ${r.status}.`);
      if (!r.json) throw new NetError('upstream', `${limits.name}'s list couldn't be read.`);
      const raw = readRecentPage(r.json);
      const profs = await moderation.profiles(raw.tiles.map((t) => t.did));
      const tiles = [];
      for (const t of raw.tiles) {
        const prof = profs.get(t.did) || {};
        if (prof.hidden) continue;                                   // Bluesky's moderation: the whole account
        if (await moderation.onHideList(t.did, t.rkey)) continue;    // the hide list: the tile or its account
        tiles.push({ ...t, handle: prof.handle || '', blur: !!prof.blur });
      }
      const value = { page: n, pages: raw.pages, total: raw.total, more: raw.pages > n && n < limits.maxPages, tiles };
      pages.set(n, { at: now(), value });
      return value;
    })().finally(() => loading.delete(n));
    loading.set(n, p);
    return p;
  }

  /** Made since your last visit? (Nothing is new on a first visit.) */
  const isNew = (t) => { const c = Date.parse(t.createdAt); return !!sessionSeen && Number.isFinite(c) && c > sessionSeen && c <= now() + 24 * 3600 * 1000; };
  const markSeen = () => marks.markSeen('recent');
  /** The tiles already loaded (for search's "Already in Raku"). */
  const loaded = () => [...pages.values()].flatMap((p) => p.value.tiles);

  return { load, isNew, markSeen, loaded, lastSeen: () => sessionSeen };
}
