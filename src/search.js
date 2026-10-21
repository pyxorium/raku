// Search (stage 6, Q95 and Q96): your own things first ("Already in Raku"), searched here in the browser (nothing is sent), then
// appmosphe.re's search (Robin's gallery; its CORS header lets a page ask it), only when someone searches.
//
// appmosphe.re is asked only for the words; Raku reads just the tile addresses out of its answer and then
// looks each tile up itself, from its author's own server, through the same moderation as everything else
// (so a card is always the tile's current record, and a hidden tile stays hidden). Reading only addresses
// also means Raku doesn't depend on the exact shape of appmosphe.re's answer: any at://…/ing.dasl.masl/…,
// tile:// or appmosphe.re / lexicographer.space tile link in it counts, as does a { did, rkey } pair.

import { SEARCH } from './config.js';
import { parseAddress, isDid, isRkey } from './address.js';
import { fetchJson, NetError } from './net.js';

/** The tile addresses in a search answer, in order, without repeats. → [{ actor, rkey, uri }] */
export function addressesFrom(json, max = SEARCH.max) {
  const out = [];
  const seen = new Set();
  let nodes = 0;
  const add = (actor, rkey) => {
    const a = parseAddress(`at://${actor}/ing.dasl.masl/${rkey}`);
    if (!a.ok || seen.has(a.uri) || out.length >= max) return;
    seen.add(a.uri);
    out.push({ actor: a.actor, rkey: a.rkey, uri: a.uri });
  };
  const walk = (x, depth) => {
    if (out.length >= max || ++nodes > 20000 || depth > 8 || x == null) return;
    if (typeof x === 'string') {
      if (x.length > 2048 || !/(at|tile|https?):\/\//i.test(x)) return;
      const a = parseAddress(x);
      if (a.ok) add(a.actor, a.rkey);
      return;
    }
    if (Array.isArray(x)) { for (const v of x) walk(v, depth + 1); return; }
    if (typeof x !== 'object') return;
    // One result as an object: its own address first (uri / at-uri / url fields), else its { did, rkey }.
    const before = out.length;
    for (const k of ['uri', 'atUri', 'at_uri', 'aturi', 'url', 'link', 'href']) if (typeof x[k] === 'string') walk(x[k], depth + 1);
    const did = [x.did, x.repo, x.author?.did, x.authorDid].find((d) => typeof d === 'string' && isDid(d));
    if (out.length === before && did && typeof x.rkey === 'string' && isRkey(x.rkey)) add(did, x.rkey);
    for (const [k, v] of Object.entries(x)) if (v && typeof v === 'object') walk(v, depth + 1);
    else if (typeof v === 'string' && !['uri', 'atUri', 'at_uri', 'aturi', 'url', 'link', 'href'].includes(k)) walk(v, depth + 1);
  };
  walk(json, 0);
  return out;
}

/** Asks appmosphe.re. → [{ actor, rkey, uri }] ; NetError when it can't be reached or answers badly. */
export async function searchAppmosphere(query, { fetchImpl = globalThis.fetch, max = SEARCH.max } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return [];
  const r = await fetchJson(`${SEARCH.url}?q=${encodeURIComponent(q)}`, { timeoutMs: 10000, maxBytes: SEARCH.maxBytes, fetchImpl });
  if (!r.ok) throw new NetError('upstream', `${SEARCH.name} answered ${r.status}.`);
  if (!r.json) throw new NetError('upstream', `${SEARCH.name}'s answer couldn't be read.`);
  return addressesFrom(r.json, max);
}

/** The words of a search, for matching here in the browser. */
export const searchWords = (q) => String(q || '').toLowerCase().split(/\s+/).map((w) => w.replace(/^[@#]/, '')).filter(Boolean).slice(0, 12);

/** Does a piece of text hold every word? */
export const matches = (words, ...texts) => {
  const hay = texts.filter((t) => typeof t === 'string').join(' ').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
};

/**
 * Your own things that match (Q96): kept tiles (by name and author), kept accounts (by handle), and any
 * other tiles Raku already has in hand (the picks, Following), by name, description and author.
 * → { tiles: [{ did, rkey, name, by }], accounts: [{ did, handle }] }
 */
export function localMatches(query, { shelf, others = [] } = {}) {
  const words = searchWords(query);
  if (!words.length) return { tiles: [], accounts: [] };
  const tiles = [];
  const seen = new Set();
  const take = (t) => {
    const k = `${t.did} ${t.rkey}`;
    if (seen.has(k)) return;
    seen.add(k);
    tiles.push({ did: t.did, rkey: t.rkey, name: t.name || '', by: t.by || '' });
  };
  for (const t of shelf ? shelf.tiles() : []) if (matches(words, t.name, t.by)) take(t);
  for (const t of others) if (t && t.did && t.rkey && matches(words, t.name, t.description, t.by)) take(t);
  const accounts = (shelf ? shelf.accounts() : []).filter((a) => matches(words, a.handle)).map((a) => ({ did: a.did, handle: a.handle }));
  return { tiles: tiles.slice(0, 24), accounts: accounts.slice(0, 24) };
}
