// Tile addresses: everything the address box accepts, turned into one form.
//
// Accepted (claude/raku-plan.md, stage 1):
//   at://<did or handle>/ing.dasl.masl/<rkey>
//   https://lexicographer.space/@<did or handle>/<rkey>     (the viewer; www. too)
//   https://appmosphe.re/@<did or handle>/<rkey>            (same short form)
//   https://webtil.es/browser/#url=<at:// address, plain or encoded>
//   tile://<rkey>.<did, encoded>/                           (Beaver's form, webbeef's browser)
//   @<did or handle>/<rkey>
// Everything here is plain string work: no network, so it's tested in Node.

import { COLLECTION, SITE } from './config.js';

export const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
export const DID_WEB = /^did:web:[a-z0-9.-]+(%3[Aa][0-9]+)?$/i;
// atproto handles: dot-separated labels, a letter-led last label (no IP addresses).
const HANDLE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i;
// Record keys: atproto's allowed characters, not "." or "..".
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;

export const isDid = (s) => DID_PLC.test(s) || DID_WEB.test(s);
export const isHandle = (s) => HANDLE.test(s);
export const isRkey = (s) => RKEY.test(s) && s !== '.' && s !== '..';

const VIEWER_HOSTS = new Set(['lexicographer.space', 'www.lexicographer.space', 'appmosphe.re', 'www.appmosphe.re']);
const WEBTILES_HOSTS = new Set(['webtil.es', 'www.webtil.es']);

const fail = (reason) => ({ ok: false, reason });
const HINT = "Paste a tile's address: at://…, a lexicographer.space, appmosphe.re or webtil.es link, or tile://…";

function actorAndKey(actor, rkey) {
  actor = String(actor || '').replace(/^@/, '');
  if (actor.startsWith('did:')) {
    if (!isDid(actor)) return fail("That account (a DID) isn't one Raku can look up: did:plc and did:web only.");
    if (actor.startsWith('did:plc:')) actor = actor.toLowerCase();
    else actor = 'did:web:' + actor.slice(8).toLowerCase();
  } else {
    actor = actor.toLowerCase();
    if (!isHandle(actor)) return fail(`"${actor}" isn't a handle or a DID.`);
  }
  if (!isRkey(rkey)) return fail("The tile's record key is missing or not valid.");
  return { ok: true, actor, rkey, uri: `at://${actor}/${COLLECTION}/${rkey}` };
}

function fromAtUri(s) {
  const m = s.match(/^at:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$/);
  if (!m) return fail('That at:// address needs three parts: an account, ing.dasl.masl and a record key.');
  if (m[2] !== COLLECTION) return fail(`That record isn't a web tile (its collection is ${m[2]}, not ${COLLECTION}).`);
  return actorAndKey(decodeURIComponent(m[1]), m[3]);
}

function fromTileUri(s) {
  // tile://<rkey>.<did, percent-encoded>/  e.g. tile://3mabc.did%3Aplc%3Axyz/
  const m = s.match(/^tile:\/\/([^/?#]+)\/?$/i);
  if (!m) return fail('That tile:// address should look like tile://<record key>.<account>/');
  const host = m[1];
  const at = host.search(/\.did(%3a|:)/i);
  if (at < 1) return fail('That tile:// address should look like tile://<record key>.<account>/');
  let did;
  try { did = decodeURIComponent(host.slice(at + 1)); } catch { return fail("That tile:// address's account can't be read."); }
  return actorAndKey(did, host.slice(0, at));
}

/** Reads what someone typed or pasted. → { ok: true, actor, rkey, uri } or { ok: false, reason } */
export function parseAddress(input) {
  const s = String(input || '').trim();
  if (!s) return fail(HINT);
  if (/^at:\/\//i.test(s)) return fromAtUri(s.replace(/^at:\/\//i, 'at://'));
  if (/^tile:\/\//i.test(s)) return fromTileUri(s);
  if (/^@?[^/\s]+\/[^/\s]+$/.test(s) && !/^https?:/i.test(s)) {
    const [actor, rkey] = s.split('/');
    return actorAndKey(actor, rkey);
  }
  let u;
  try { u = new URL(s); } catch { return fail(HINT); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail(HINT);
  const host = u.hostname.toLowerCase();
  if (WEBTILES_HOSTS.has(host)) {
    const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
    const inner = hash.get('url');
    if (!inner) return fail("That webtil.es link doesn't name a tile.");
    return /^at:\/\//i.test(inner) ? fromAtUri(inner) : fail("That webtil.es link doesn't name a tile.");
  }
  if (VIEWER_HOSTS.has(host)) {
    const m = u.pathname.match(/^\/@([^/]+)\/([^/]+)\/?$/);
    if (!m) return fail(`That ${host} link isn't a tile's page.`);
    return actorAndKey(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  }
  return fail(`Raku opens web tiles, not other web pages. ${HINT}`);
}

/** The at:// address for an account's DID and a record key. */
export const atUri = (did, rkey) => `at://${did}/${COLLECTION}/${rkey}`;

/** Beaver's form of the same address. */
export const tileUri = (did, rkey) => `tile://${rkey}.${encodeURIComponent(did)}/`;

/** The short form shown in the address box: @handle/rkey when the handle is known and checked. */
export const shortForm = (actor, rkey) => `@${actor}/${rkey}`;

// ---- pages that aren't tiles (stage 2) ----
// Your shelf and an account's tiles are pages inside a tab too, with addresses of their own so the
// tab's history and the page address (after #) can hold them:
//   raku:shelf             your shelf
//   raku:tiles/<actor>     an account's tiles (a handle or a DID)
export const SHELF_URI = 'raku:shelf';
// The About page (going public, Q134).
export const ABOUT_URI = 'raku:about';
//   raku:table/<id>        a table (stage 3: sevenup, daisy); for Daisy, its start screen (stage 5)
//   raku:table/daisy/bot   Daisy against the bot (stage 5)
//   raku:table/daisy/<table id>   one Daisy table across two computers (stage 5): the link a player sends
export const tableUri = (id, sub = null) => (sub ? `raku:table/${id}/${sub}` : `raku:table/${id}`);
const TABLE_SUB = /^(bot|[a-z0-9]{8,32})$/;
// The Daisy page's own table links (thunderbird.cafe/webtiles/daisy/?table=…) open the same table in Raku:
// both run the same pinned house through the same relay (stage 5, Q44).
const DAISY_PAGE = { host: 'thunderbird.cafe', path: '/webtiles/daisy/' };
export const accountPageUri = (actor) => `raku:tiles/${actor}`;

function account(actor) {
  actor = String(actor || '').replace(/^@/, '');
  if (actor.startsWith('did:')) {
    if (!isDid(actor)) return fail("That account (a DID) isn't one Raku can look up: did:plc and did:web only.");
    actor = actor.startsWith('did:plc:') ? actor.toLowerCase() : 'did:web:' + actor.slice(8).toLowerCase();
  } else {
    actor = actor.toLowerCase();
    if (!isHandle(actor)) return fail(`"${actor}" isn't a handle or a DID.`);
  }
  return { ok: true, kind: 'account', actor, uri: accountPageUri(actor) };
}

// ---- stage 6: Discover, search and posts ----
//   raku:discover              the Discover page (its first source)
//   raku:discover/<source>     one source in the centre: news, recent (stage 6c), following, make (stage 6c:
//                              Make a tile)
//   raku:search/<words>        search results (the words percent-encoded)
export const DISCOVER_URI = 'raku:discover';
export const DISCOVER_SOURCES = Object.freeze(['following', 'news', 'recent', 'make']);
export const discoverUri = (source = null) => (source ? `${DISCOVER_URI}/${source}` : DISCOVER_URI);
export const searchUri = (query) => `raku:search/${encodeURIComponent(String(query || '').trim())}`;
export const SEARCH_MAX_CHARS = 200;

// A post (Q87/Q88: posts open outside Raku for now, after the link message; a reader may come later, and
// these addresses are kept for it). Any atproto app's post link counts, not only bsky.app's:
//   at://<did or handle>/app.bsky.feed.post/<rkey>
//   https://<any app>/profile/<did or handle>/post/<rkey>
export const POST_COLLECTION = 'app.bsky.feed.post';
export const postUri = (actor, rkey) => `at://${actor}/${POST_COLLECTION}/${rkey}`;
/** A post's address, or null when what's given isn't one. → { ok, kind: 'post', actor, rkey, uri } or a failure */
export function parsePost(input) {
  const s = String(input || '').trim();
  let actor, rkey;
  const at = s.match(/^at:\/\/([^/?#\s]+)\/app\.bsky\.feed\.post\/([^/?#\s]+)\/?$/i);
  if (at) { actor = at[1]; rkey = at[2]; } else {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
    if (!m) return null;
    actor = m[1]; rkey = m[2];
  }
  try { actor = decodeURIComponent(actor); rkey = decodeURIComponent(rkey); } catch { return null; }
  const a = actorAndKey(actor, rkey);
  if (!a.ok) return a;
  return { ok: true, kind: 'post', actor: a.actor, rkey: a.rkey, uri: postUri(a.actor, a.rkey) };
}

// Words to search for: anything typed that isn't an address of some kind (Q95: a single word with a dot is
// tried as a handle first, before this).
function looksLikeWords(s) {
  if (!s || s.length > SEARCH_MAX_CHARS) return false;
  if (s.includes('://') || /^(at|tile|raku|did|https?|mailto|javascript|data):/i.test(s)) return false;
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Everything the address box accepts: a tile (as parseAddress), your shelf, or an account's tiles
 * (a handle or DID on its own: @thunderbird.cafe, thunderbird.cafe, did:plc:…, at://handle, or a
 * lexicographer.space / appmosphe.re link to an account), Discover, a post (stage 6), or words to search
 * for. → { ok, kind: 'tile' | 'shelf' | 'account' | 'table' | 'discover' | 'search' | 'post', uri, … }
 */
export function parseTarget(input, { inner = false } = {}) {
  const s = String(input || '').trim();
  if (s === SHELF_URI) return { ok: true, kind: 'shelf', uri: SHELF_URI };
  if (s === ABOUT_URI) return { ok: true, kind: 'about', uri: ABOUT_URI };
  if (s === DISCOVER_URI) return { ok: true, kind: 'discover', source: null, uri: DISCOVER_URI };
  const disc = s.match(/^raku:discover\/([a-z]{1,20})$/);
  if (disc) {
    if (!DISCOVER_SOURCES.includes(disc[1])) return fail("That Discover address isn't one Raku knows.");
    return { ok: true, kind: 'discover', source: disc[1], uri: discoverUri(disc[1]) };
  }
  const search = s.match(/^raku:search\/(.*)$/s);
  if (search) {
    let q;
    try { q = decodeURIComponent(search[1]).trim(); } catch { return fail("That search address can't be read."); }
    if (!q || q.length > SEARCH_MAX_CHARS) return fail('Type a few words to search for tiles.');
    return { ok: true, kind: 'search', query: q, uri: searchUri(q) };
  }
  const post = parsePost(s);
  if (post) return post;
  const table = s.match(/^raku:table\/([a-z0-9-]{1,40})(?:\/([a-z0-9]{1,40}))?$/);
  if (table) {
    if (table[2] !== undefined && !TABLE_SUB.test(table[2])) return fail("That table's address isn't one Raku knows.");
    return { ok: true, kind: 'table', id: table[1], sub: table[2] || null, uri: tableUri(table[1], table[2] || null) };
  }
  const link = otherLink(s, inner);
  if (link) return link;
  const page = s.match(/^raku:tiles\/([^/\s]+)$/);
  if (page) return account(decodeURIComponent(page[1]));
  const tile = parseAddress(s);
  if (tile.ok) return { ...tile, kind: 'tile' };
  // An account on its own.
  if (/^@?(did:[a-z]+:[^/\s]+|[a-z0-9.-]+\.[a-z][a-z0-9-]*)$/i.test(s)) return account(s);
  const at = s.match(/^at:\/\/([^/?#\s]+)(\/ing\.dasl\.masl)?\/?$/i);
  if (at) return account(decodeURIComponent(at[1]));
  try {
    const u = new URL(s);
    if (VIEWER_HOSTS.has(u.hostname.toLowerCase())) {
      const m = u.pathname.match(/^\/@([^/]+)\/?$/);
      if (m) return account(decodeURIComponent(m[1]));
    }
  } catch { /* not a link */ }
  // Anything else that reads as words: a search (stage 6, Q95).
  if (looksLikeWords(s)) return { ok: true, kind: 'search', query: s, uri: searchUri(s) };
  return tile;
}

// A link to a Daisy table on the Daisy page, or a Raku link (raku.lexicographer.space/#t=…), pasted into the
// address box: what it opens. A Raku link opens the tab it had in front. → a target, or null.
function otherLink(s, inner) {
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if ((host === DAISY_PAGE.host || host === `www.${DAISY_PAGE.host}`) && u.pathname === DAISY_PAGE.path) {
    const t = u.searchParams.get('table');
    // A match against the bot lives in the browser that started it: its link opens Daisy's start screen.
    if (t && TABLE_SUB.test(t) && t !== 'bot' && u.searchParams.get('bot') !== '1') return { ok: true, kind: 'table', id: 'daisy', sub: t, uri: tableUri('daisy', t) };
    return { ok: true, kind: 'table', id: 'daisy', sub: null, uri: tableUri('daisy') };
  }
  if (host === SITE.host && !inner) {
    const p = new URLSearchParams(u.hash.replace(/^#/, ''));
    const list = (p.get('t') || '').split(',');
    const a = Math.min(Math.max(0, Number(p.get('a')) || 0), list.length - 1);
    let one = list[a] || '';
    try { one = decodeURIComponent(one); } catch { return null; }
    if (!one) return null;
    const r = parseTarget(one, { inner: true });
    return r.ok ? r : null;
  }
  return null;
}
