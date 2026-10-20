// Raku: every setting in one place.
//
// Raku's own address lives here and only here (SITE.origin): public/CNAME, the
// sign-in description (stage 4) and anything else that names the address are
// checked against it by test/config.test.mjs, so a move (to a generic address
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
    house: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my27cwible2m', cid: 'bafyreibnphpuuoe5ukn2mmwok4vdwi7ov7ssniwpli5d4cgizpppht2tga' },
    player: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3my27d43kry2d', cid: 'bafyreif4m335ieeh3bfkayyz7zrkqtp45tc3af66un2vhea44xogqebdya' },
  }),
  daisy: Object.freeze({
    id: 'daisy',
    name: 'Daisy',
    blurb: 'A dice race: roll or bank, a 1 loses the turn, first to 25 wins.',
    page: 'https://thunderbird.cafe/webtiles/daisy/',
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
const isLocal = (loc) => !!loc && ['127.0.0.1', 'localhost'].includes(loc.hostname);
export function loadSourceOverride(loc = globalThis.location) {
  if (!isLocal(loc)) return null;
  const v = new URLSearchParams(loc.search).get('loader');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?\/\.well-known\/web-tiles\/$/i.test(v) ? v : null;
}

// The page's own security policy, a <meta> tag on the built page (GitHub Pages can't send headers;
// frame-ancestors can't be set this way, so src/frame-guard.js refuses to run inside a frame instead).
// - scripts and styles only from Raku itself;
// - pictures only Raku's own, made here from downloaded bytes (blob:), or avatars from Bluesky's picture server;
// - connections over https (lookups, the authors' account servers, Bluesky's public API);
// - frames only from the tile loading server.
export function pageCsp(loadDomain = TILE_LOAD_DOMAIN, scheme = 'https') {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data: https://cdn.bsky.app",
    "font-src 'self'",
    "connect-src 'self' https:",
    `frame-src ${scheme}://${loadDomain} ${scheme}://*.${base}`,
    "worker-src 'none'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
