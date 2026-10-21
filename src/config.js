// Raku: every setting in one place.
//
// Raku's own address lives here and only here (SITE.origin): public/CNAME, the
// sign-in description (oauth.json, written from oauthMetadata() below by vite.config.js on build) and
// anything else that names the address are checked against it by test/config.test.mjs, so a move (to a generic address
// before going public, say) is one edit here plus the DNS.

export const SITE = Object.freeze({
  name: 'Raku',
  lab: true,                                   // "Raku (lab)", noindex, robots.txt: while it's a hidden lab
  origin: 'https://raku.lexicographer.space',
  host: 'raku.lexicographer.space',
});

// The tile loading server (C:\thunderbird-cafe\tiles-loading-server, Fly app tiles-loading-server):
// load.tiles.lexicographer.space sends each tile to a fresh random name under tiles.lexicographer.space,
// so every tile runs on its own origin.
export const TILE_LOAD_DOMAIN = 'load.tiles.lexicographer.space';

// This computer (http://127.0.0.1 or localhost): the only place the testing switches (?loader=, ?relay=,
// ?timers=) do anything.
export const isLocal = (loc) => !!loc && ['127.0.0.1', 'localhost'].includes(loc.hostname);

// Public lookups.
export const HANDLE_RESOLVER = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';
export const COLLECTION = 'ing.dasl.masl';

// Moderation (the viewer's rules, claude/viewer-plan.md decisions 5 and 10):
// - the hide list: a coded copy of lexicographer.space's hide-list.json (hashes only, no notes),
//   downloaded when Raku starts and checked again about every hour;
// - Bluesky's moderation: an account Bluesky has taken down, or labelled !takedown / !hide by its
//   own moderation service, is treated the same way.
// The list is published by the viewer (C:\thunderbird-cafe\lexicographer-viewer, step 1b) from its
// hide-list.json at every deploy, readable from any site.
export const HIDE_LIST_URL = 'https://lexicographer.space/hidden-tiles.json';
export const HIDE_LIST_RECHECK_MS = 60 * 60 * 1000;
export const BLUESKY_API = 'https://public.api.bsky.app';
export const BLUESKY_MODERATION = 'did:plc:ar7c4by46qjdydhdevvrndac';   // moderation.bsky.app
export const MODERATION_KEEP_MS = 10 * 60 * 1000;
export const TAKEDOWNS_PAGE = 'https://lexicographer.space/takedowns';

// Sizes and times. A tile's size is what its record says its files add up to.
export const LIMITS = Object.freeze({
  askBytes: 25 * 1024 * 1024,      // above this: "This tile is large (60 MB). Open anyway?"
  maxBytes: 500 * 1024 * 1024,     // above this: refused (also the most one tile may download in all)
  lookupMs: 10000,                 // a handle, a DID document, a record
  fileMs: 60000,                   // one of a tile's files
  docBytes: 256 * 1024,            // a DID document or a lookup answer
  recordBytes: 2 * 1024 * 1024,    // a tile's record
  keepBytes: 150 * 1024 * 1024,    // files kept while Raku is open (shared by all tabs)
  cardImageBytes: 5 * 1024 * 1024, // a card picture on the first screen
});

// New windows from tiles (links with target=_blank, window.open after a click). The loading server lets a tile
// open them (its sandbox allows popups), so a tile can link out, and a click can also carry data out in the
// new window's address. Set to false to give every tile frame a sandbox without popups: tiles still run, but
// their links out and new windows are blocked (checked in the sandbox, Oct 19). Owner's decision pending.
export const TILE_POPUPS = true;

// Tables (stage 3): groups of tiles that work together, each with a small driver in src/tables/.
// The approved list, pinned by record CID (decided Oct 17: only the owner's approved tables; re-approve
// after a republish). These are the same pins as the site's src/sevenup/published.generated.js and
// src/daisy/published.generated.js: when a game is republished, update them here too.
export const BOT = Object.freeze({ did: 'did:plc:hd2efebmfhpqcusfya4lguce', handle: 'dicesprite.thunderbird.cafe' });
export const TABLES = Object.freeze({
  sevenup: Object.freeze({
    id: 'sevenup',
    name: 'Seven-Up',
    blurb: 'Two dice, three rounds each: roll until a 7. A hidden house tile referees.',
    page: 'https://thunderbird.cafe/webtiles/sevenup/',
    // Saving (stage 4): the game's permission set (published from thunderbird.cafe, sevenup-tiles
    // lexicons/cafe.thunderbird.sevenup.authPlay.json: "Play Seven-Up") and the one kind of record it covers.
    scope: 'include:cafe.thunderbird.sevenup.authPlay',
    collection: 'cafe.thunderbird.sevenup.match',
    house: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my27cwible2m', cid: 'bafyreibnphpuuoe5ukn2mmwok4vdwi7ov7ssniwpli5d4cgizpppht2tga' },
    player: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my27d43kry2d', cid: 'bafyreif4m335ieeh3bfkayyz7zrkqtp45tc3af66un2vhea44xogqebdya' },
  }),
  daisy: Object.freeze({
    id: 'daisy',
    name: 'Daisy',
    blurb: 'A dice race: roll or bank, a 1 loses the turn, first to 25 wins.',
    page: 'https://thunderbird.cafe/webtiles/daisy/',
    scope: 'include:cafe.thunderbird.daisy.authPlay',      // "Play Daisy" (daisy-tiles lexicons/)
    collection: 'cafe.thunderbird.daisy.match',
    // Two computers (stage 5): Daisy's own relay (C:\thunderbird-cafe\daisy-relay, Fly app thunderbird-daisy-relay),
    // the same one the Daisy page uses, so a table opened in Raku or on the Daisy page can be joined from either.
    relay: 'wss://relay.daisy.thunderbird.cafe/',
    // The lounge (step 5b): the same as the Daisy page's (daisy-tiles lexicons/cafe.thunderbird.daisy.authLounge.json,
    // "Daisy lounge"): a lounge record in your own account and a pass that proves to the relay who you are,
    // asked only the first time you turn mingling on. The relay's lounge is at <relay>/lounge.
    lounge: Object.freeze({
      scope: 'include:cafe.thunderbird.daisy.authLounge?aud=did:web:relay.daisy.thunderbird.cafe%23daisy_relay',
      collection: 'cafe.thunderbird.daisy.lounge',
      audience: 'did:web:relay.daisy.thunderbird.cafe#daisy_relay',
      enter: 'cafe.thunderbird.daisy.lounge.enter',
    }),
    house: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my6ucagtd32m', cid: 'bafyreib473vajcpexj5m7xcpah4dtwyzfazknnuqss4mokiclqcvgvye54' },
    player: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my6uchoghd2m', cid: 'bafyreihsiqt4owq4p2bfudfwvz5qbxub3bw3q63b3ufnuepfa35p6yui7m' },
  }),
});
/** The table a tile belongs to (its house or player tile), or null. */
export function tableForTile(did, rkey) {
  const uri = `at://${did}/${COLLECTION}/${rkey}`;
  return Object.values(TABLES).find((t) => t.house.uri === uri || t.player.uri === uri) || null;
}
export const TABLE_TIMES = Object.freeze({ still: 4000, retry: 8000, heartbeat: 3000, misses: 2, tick: 1000 });

// ---------- Daisy across two computers (stage 5, claude/raku-plan.md section 15) ----------
// The same rules as the Daisy page (the site's src/daisy/config.js), so the two can share a table:
// - the relay: the live one, or on this computer the stand-in (node scripts/relay-standin.mjs in
//   C:\thunderbird-cafe\daisy-tiles), or ?relay=… (this computer only), e.g. ?relay=wss://relay.daisy.thunderbird.cafe/;
// - the timers: the real ones (nudge 1 min, turn 3 min, away 2 min), or ?timers=short on this computer only
//   (both pages must ask for the same set, or the houses won't start the table);
// - this browser keeps your seat and your house's state (with its secret seed) for a day, under Raku's own
//   names (a seat taken in Raku lives in Raku; the Daisy page keeps its own).
export const DAISY_LOCAL_RELAY = 'ws://127.0.0.1:8787/';
export const DAISY_AWAY_MS = Object.freeze({ real: 120000, short: 20000 });
export const DAISY_KEEP = Object.freeze({ tablePrefix: 'raku-daisy-table:', tabPrefix: 'raku-daisy-tab:', keepFor: 24 * 60 * 60 * 1000 });
export function daisyRelayUrl(loc = globalThis.location) {
  if (!isLocal(loc)) return TABLES.daisy.relay;
  const v = new URLSearchParams(loc.search).get('relay');
  return v && /^wss?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v) ? v : DAISY_LOCAL_RELAY;
}
export function daisyTimers(loc = globalThis.location) {
  return isLocal(loc) && new URLSearchParams(loc.search).get('timers') === 'short' ? 'short' : 'real';
}
// A table's id, as the Daisy page makes them (the relay accepts 8 to 32 of a-z and 0-9).
export const isTableId = (x) => typeof x === 'string' && /^[a-z0-9]{8,32}$/.test(x);
export const daisyLoungeUrl = (loc = globalThis.location) => daisyRelayUrl(loc).replace(/\/?$/, '/lounge');
// The lounge on the page's side (the relay keeps its own times, relay lounge.js); with ?timers=short on this
// computer "No answer" comes after 4 s.
export const LOUNGE_TIMES = Object.freeze({ noAnswer: 60000, hereEvery: 60000, reconnect: [1000, 2000, 4000, 8000, 15000] });
export const loungeTimes = (loc = globalThis.location) => (daisyTimers(loc) === 'short' ? { ...LOUNGE_TIMES, noAnswer: 4000 } : LOUNGE_TIMES);
export function newTableId() {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return [...b].map((x) => 'abcdefghijkmnopqrstuvwxyz23456789'[x % 33]).join('');
}

// ---------- signing in and saving (stage 4, claude/raku-stage4-plan.md) ----------
// Browsing never needs a sign-in. Signing in is only for saving match results from the tables, and each
// game's permission set is asked the first time you save at that game (Q36): the first sign-in asks for
// your account plus that table's set; another game adds its own with one short Authorize. Several
// accounts can be signed in on this browser, one of them current (Q38).
export const SIGNIN = Object.freeze({
  clientId: `${SITE.origin}/oauth.json`,       // changing it signs everyone out
  redirectUri: `${SITE.origin}/`,
  handleResolver: 'https://bsky.social',        // as the Foundry, Seven-Up and Daisy
  windowName: 'raku-signin',
  windowFeatures: 'width=600,height=700,menubar=no,toolbar=no',
  accountsKey: 'raku-accounts',                // localStorage: [{ did, handle }] signed in on this browser
  currentKey: 'raku-account',                  // localStorage: the current account's DID
  alwaysKey: 'raku-always',                    // localStorage: "Always" choices, per account and game (Q37)
  returnKey: 'raku-signin-return',             // sessionStorage: what to pick up after "Sign in in this tab instead" (Q41)
});
// Shown beside "Sign in to save matches" and in the account menu (Q43).
// Since step 5b (Q53) it also names the lounge, which only asks when you turn mingling on.
export const SIGNIN_PROMISE = `Signing in lets ${SITE.host} save your match results from the tables you play and, if you choose to mingle, let other players see you're in a game's lounge. Each game asks for its own permission the first time. Raku doesn't touch your posts, likes, follows or anything else.`;
export const recordLink = (uri) => `https://pdsls.dev/${uri}`;

/** The permissions for a sign-in: your account, plus the sets of the given tables (ids). */
export function scopeFor(tableIds = []) {
  const sets = [...new Set(tableIds)].map((id) => TABLES[id] && TABLES[id].scope).filter(Boolean);
  return ['atproto', ...sets].join(' ');
}
/** Everything Raku may ever ask for (oauth.json's scope): every approved table's set, and their lounges' sets. */
export const fullScope = () => [scopeFor(Object.keys(TABLES)), ...Object.values(TABLES).map((t) => t.lounge && t.lounge.scope).filter(Boolean)].join(' ');
/** Does a sign-in's permissions cover a table's lounge? The server expands the set into the record and the pass. */
export function coversLounge(scope, table) {
  const L = table && table.lounge;
  if (!L) return false;
  const s = ` ${String(scope || '')} `;
  if (s.includes(` ${L.scope} `)) return true;
  const col = L.collection.replace(/\./g, '\\.');
  return new RegExp(`\\srepo:(\\*|${col})(\\?[^\\s]*)?\\s`).test(s) && s.includes(` rpc:${L.enter}`);
}
/** Does a sign-in's permissions (its token's scope) cover saving at this table? The account's server
 *  expands a set into plain permissions (repo:<collection>), so either form counts. */
export function coversTable(scope, table) {
  const s = ` ${String(scope || '')} `;
  if (!table) return false;
  if (s.includes(` ${table.scope} `)) return true;
  const esc = table.collection.replace(/\./g, '\\.');
  return new RegExp(`\\srepo:(\\*|${esc})(\\?[^\\s]*)?\\s`).test(s);
}
/** Which tables a sign-in's permissions cover (ids). */
export const tablesCovered = (scope) => Object.keys(TABLES).filter((id) => coversTable(scope, TABLES[id]));

/** The sign-in description file, published at SIGNIN.clientId (made by vite.config.js on build). */
export function oauthMetadata() {
  return {
    client_id: SIGNIN.clientId,
    client_name: SITE.lab ? `${SITE.name} (lab)` : SITE.name,
    client_uri: `${SITE.origin}/`,
    redirect_uris: [SIGNIN.redirectUri],
    scope: fullScope(),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

export const TABS = Object.freeze({ max: 10 });
export const TIMES = Object.freeze({ still: 4000, retry: 8000 });

// The first screen's picks: tiles the owner chooses (claude/raku-plan.md decision 6; chosen Oct 19).
export const PICKS = Object.freeze([
  'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mw763im3qw2t',
  'at://did:plc:joer5rzmwgec3dkr4srfmq45/ing.dasl.masl/3mwwhkjfvfq2o',
  'at://did:plc:joer5rzmwgec3dkr4srfmq45/ing.dasl.masl/3mwztqi2rl2i4',
]);

// On this computer only (http://127.0.0.1 or localhost): ?loader=<a loading server's
// /.well-known/web-tiles/ address>, for the browser checks' stand-in loading server.
export function loadSourceOverride(loc = globalThis.location) {
  if (!isLocal(loc)) return null;
  const v = new URLSearchParams(loc.search).get('loader');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?\/\.well-known\/web-tiles\/$/i.test(v) ? v : null;
}

// The page's own security policy, a <meta> tag on the built page (GitHub Pages can't send headers;
// frame-ancestors can't be set this way, so src/frame-guard.js refuses to run inside a frame instead).
// - scripts and styles only from Raku itself;
// - pictures only Raku's own, made here from downloaded bytes (blob:), or avatars from Bluesky's picture server;
// - connections over https (lookups, the authors' account servers, Bluesky's public API), and the tables'
//   own relays (stage 5: wss://relay.daisy.thunderbird.cafe/), named one by one;
// - frames only from the tile loading server.
export const tableRelays = () => [...new Set(Object.values(TABLES).map((t) => t.relay).filter(Boolean).map((u) => new URL(u).origin))];
export function pageCsp(loadDomain = TILE_LOAD_DOMAIN, scheme = 'https', relays = tableRelays()) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data: https://cdn.bsky.app",
    "font-src 'self'",
    ["connect-src 'self' https:", ...relays].join(' '),
    `frame-src ${scheme}://${loadDomain} ${scheme}://*.${base}`,
    "worker-src 'none'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
