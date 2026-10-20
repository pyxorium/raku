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

import { COLLECTION } from './config.js';

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

/**
 * Everything the address box accepts: a tile (as parseAddress), your shelf, or an account's tiles
 * (a handle or DID on its own: @thunderbird.cafe, thunderbird.cafe, did:plc:…, at://handle, or a
 * lexicographer.space / appmosphe.re link to an account). → { ok, kind: 'tile' | 'shelf' | 'account', uri, … }
 */
export function parseTarget(input) {
  const s = String(input || '').trim();
  if (s === SHELF_URI) return { ok: true, kind: 'shelf', uri: SHELF_URI };
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
  if (/^[^\s:/]+$/.test(s) && !s.includes('.')) {
    return fail(`"${s}" isn't a tile's address or an account's handle. (Searching for tiles comes later.)`);
  }
  return tile;
}
