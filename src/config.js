// Raku: every setting in one place.
//
// Raku's own address lives here and only here (SITE.origin): public/CNAME, the
// sign-in description (oauth.json, written from oauthMetadata() below by vite.config.js on build) and
// anything else that names the address are checked against it by test/config.test.mjs, so a move (to a generic address
// before going public, say) is one edit here plus the DNS.

export const SITE = Object.freeze({
  name: 'Raku',
  lab: false,                                  // true: "Raku (lab)", noindex, robots.txt keeps search engines out (a hidden
                                               // lab, Oct 19 to the launch); public since the go-public commit (Q136)
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
// The About page (raku:about): who makes Raku (a handle, opened as that account's tiles), its public code, and the
// blog post about it (Oct 23 2026).
export const MADE_BY = 'thunderbird.cafe';
export const SOURCE_CODE = 'https://github.com/pyxorium/raku';
export const BLOG_POST = 'https://thunderbird.cafe/blog/raku/';

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
// their links out and new windows are blocked (checked in the sandbox, Oct 19).
// Decided (owner, Oct 22, Q133 A): allowed, as on every other tile host, and said plainly on the About page and
// in the README. Revisit when tiles have a shared way to ask their host to open a link (likely wishes).
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
    house: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myfnyphiuw2t', cid: 'bafyreidwwralslcgks5hwet7adtcthwti74k7vo47bcuipbwcqmspqk5zu' },
    player: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myfnywxt6v2r', cid: 'bafyreif3zbe7lxc2wbiszai4c3yk7ltzxzaszwnsdqtxl6rtx5kiwwn2be' },
  }),
});
/** The table a tile belongs to (its house or player tile), or null. */
export function tableForTile(did, rkey) {
  const uri = `at://${did}/${COLLECTION}/${rkey}`;
  return Object.values(TABLES).find((t) => t.house.uri === uri || t.player.uri === uri) || null;
}
export const TABLE_TIMES = Object.freeze({ still: 4000, retry: 8000, heartbeat: 3000, misses: 2, tick: 1000 });

// ---------- Rooms (rooms in Raku, step 1; claude/raku-rooms-plan.md, RR1 to RR10) ----------
// The room itself is rooms-lab's code (package.json "rooms-lab", pinned to a GitHub tag; src/room-tab.js hosts it).
// These are the addresses Raku names itself (its page policy, its sign-in, its About page, the shelf); they're the
// same as rooms-lab's src/config.js and published.json, and test/rooms.test.mjs checks that they agree, so a new
// rooms-lab tag can't move them without the test saying so.
export const ROOMS = Object.freeze({
  name: 'Rooms',
  blurb: 'Voice, one shared screen, and tiles opened for everyone. For small meetups among friends.',
  relay: 'wss://relay.rooms.thunderbird.cafe/',
  // The connection helpers each computer asks for its own address (rooms-lab ICE_SERVERS); TURN credentials come
  // from the relay (Cloudflare's), only while you're in a room.
  stun: Object.freeze(['stun.l.google.com', 'stun.cloudflare.com']),
  turn: 'Cloudflare',
  // The "Rooms" permission set (published from thunderbird.cafe, rooms-lab lexicons/): a pass for this relay's
  // join, nothing else in the account. Asked the first time an account joins a room (RR4).
  scope: 'include:cafe.thunderbird.rooms.authJoin?aud=did:web:relay.rooms.thunderbird.cafe%23rooms_relay',
  audience: 'did:web:relay.rooms.thunderbird.cafe#rooms_relay',
  join: 'cafe.thunderbird.rooms.join',
  // The house tile (the room's rules), pinned like a table's tiles: rooms-lab's published.json.
  house: Object.freeze({ uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mymwzw63gp2g', cid: 'bafyreidyssz5pnugrwbjs22g3kbgfgdqpyztae3cyeuxdol5xamt4hm5ue' }),
  // The lab page's own invite links (thunderbird.cafe), taken too while the lab page is still up (RR3).
  labPage: 'https://thunderbird.cafe/webtiles/rooms-lab/',
  // sessionStorage, this tab only (RR2, RR10): the room you're in ({ code, name?, did?, handle?, host? }).
  keepKey: 'raku-room',
});
/** The rooms relay: the live one; on this computer ?roomsRelay=ws://… for the checks (Daisy's ?relay= is its own). */
export function roomsRelayUrl(loc = globalThis.location) {
  if (!isLocal(loc)) return ROOMS.relay;
  const v = new URLSearchParams(loc.search || '').get('roomsRelay');
  return v && /^wss?:\/\/[^\s]+$/.test(v) ? v : ROOMS.relay;
}
/** Does a sign-in's permissions cover rooms (the pass for the rooms relay)? Every form a grant comes in (readGrant). */
export function coversRooms(scope) {
  const g = readGrant(scope);
  return g.rpc === '*' || g.rpc.has(ROOMS.join);
}
/** The room's house tile: the shelf keeps it for the Rooms card (as a table keeps its player tile). */
export const isRoomHouse = (did, rkey) => ROOMS.house.uri === `at://${did}/${COLLECTION}/${rkey}`;

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

// ---------- signing in and saving (stage 4, claude/raku-stage4-plan.md; one sign-in since Nov 2026) ----------
// Browsing never needs a sign-in. Since claude/raku-write-posts-plan.md (WP3 to WP7, owner Nov 8 2026) a sign-in asks
// once for everything Raku does: one permission set, "Raku" (cafe.thunderbird.authRaku, published from thunderbird.cafe;
// lexicons/ in this repo): saving match results, the Daisy lounge, joining rooms, and posting tiles. (Before, each
// game, the lounge and Rooms asked for their own set the first time; the names are kept below, for the Daisy and
// Seven-Up pages and rooms-lab, and so an older grant still reads correctly.) Several accounts can be signed in on
// this browser, one of them current (Q38).
export const RAKU_SET = 'cafe.thunderbird.authRaku';
export const RAKU_SCOPE = `atproto include:${RAKU_SET}`;
export const SIGNIN = Object.freeze({
  // Changing it signs everyone out (WP5, Nov 2026: it was /oauth.json; the new address made every sign-in ask for "Raku").
  clientId: `${SITE.origin}/client-metadata.json`,
  redirectUri: `${SITE.origin}/`,
  handleResolver: 'https://bsky.social',        // as the Foundry, Seven-Up and Daisy
  windowName: 'raku-signin',
  windowFeatures: 'width=600,height=700,menubar=no,toolbar=no',
  accountsKey: 'raku-accounts',                // localStorage: [{ did, handle }] signed in on this browser
  currentKey: 'raku-account',                  // localStorage: the current account's DID
  alwaysKey: 'raku-always',                    // localStorage: "Always" choices, per account and game (Q37)
  returnKey: 'raku-signin-return',             // sessionStorage: what to pick up after "Sign in in this tab instead" (Q41)
});
// Shown beside sign-in, in the account menu and on the About page (Q43; since WP11, Nov 2026: one sign-in, tile posts).
export const SIGNIN_PROMISE = "Signing in lets Raku save your match results, show you in rooms and game lounges, and post tiles from your accounts. It asks once, for all of these. Raku doesn't touch your Bluesky posts, likes, follows or anything else.";
export const recordLink = (uri) => `https://pdsls.dev/${uri}`;

/** Everything Raku asks for, at every sign-in (client-metadata.json's scope too): the one set, "Raku". */
export const fullScope = () => RAKU_SCOPE;
/** What the "Raku" set holds: the same lists as lexicons/cafe.thunderbird.authRaku.json (test/publish-lexicons.test.mjs
 *  checks they agree). The records Raku writes, and the methods it asks passes for. */
export function rakuSet() {
  const lounges = Object.values(TABLES).filter((t) => t.lounge).map((t) => t.lounge);
  return {
    repo: [...Object.values(TABLES).map((t) => t.collection), ...lounges.map((L) => L.collection), TILE_POSTS.collection],
    rpc: [...lounges.map((L) => L.enter), ROOMS.join],
  };
}
// The sets Raku knows by name, and what each holds: an account's server usually hands back the plain permissions, but a
// grant can also still name a set.
function knownSets() {
  const name = (s) => String(s).replace(/^include:/, '').split('?')[0];
  const sets = { [RAKU_SET]: rakuSet(), [name(ROOMS.scope)]: { repo: [], rpc: [ROOMS.join] } };
  for (const t of Object.values(TABLES)) {
    sets[name(t.scope)] = { repo: [t.collection], rpc: [] };
    if (t.lounge) sets[name(t.lounge.scope)] = { repo: [t.lounge.collection], rpc: [t.lounge.enter] };
  }
  return sets;
}
/**
 * What a sign-in's granted permissions (its token's scope) allow: { repo, rpc }, each a Set of NSIDs, or '*' for any.
 * Reads every form a server writes (the probe, Nov 8 2026: Bluesky hands back the grouped form):
 *   repo:<nsid>[?action=…]   repo?collection=<nsid>&collection=<nsid>…   repo:*
 *   rpc:<lxm>?aud=…          rpc?lxm=<lxm>&lxm=<lxm>&aud=…               rpc:*?aud=…
 *   include:<set>[?aud=…]    (a set Raku knows by name)                  transition:generic (everything)
 * Actions and audiences are left to the account's server, which refuses what the grant doesn't allow.
 */
export function readGrant(scope) {
  const grant = { repo: new Set(), rpc: new Set() };
  const add = (kind, list) => { if (grant[kind] === '*') return; if (list.includes('*')) grant[kind] = '*'; else list.forEach((v) => v && grant[kind].add(v)); };
  const sets = knownSets();
  for (const tok of String(scope || '').split(/\s+/).filter(Boolean)) {
    if (tok === 'transition:generic') { grant.repo = '*'; grant.rpc = '*'; continue; }
    const m = /^(repo|rpc|include)(?::([^?]*))?(?:\?(.*))?$/.exec(tok);
    if (!m) continue;
    const [, kind, pos, query] = m;
    const params = new URLSearchParams(query || '');
    if (kind === 'include') { const s = sets[pos]; if (s) { add('repo', s.repo); add('rpc', s.rpc); } continue; }
    const named = pos !== undefined && pos !== '' ? [decodeURIComponent(pos)] : params.getAll(kind === 'repo' ? 'collection' : 'lxm');
    add(kind, named);
  }
  return grant;
}
const has = (g, kind, nsid) => g[kind] === '*' || g[kind].has(nsid);
/** Does a sign-in's permissions cover saving at this table? */
export function coversTable(scope, table) { return !!table && has(readGrant(scope), 'repo', table.collection); }
/** Does a sign-in's permissions cover a table's lounge? The record and the pass, both. */
export function coversLounge(scope, table) {
  const L = table && table.lounge;
  if (!L) return false;
  const g = readGrant(scope);
  return has(g, 'repo', L.collection) && has(g, 'rpc', L.enter);
}
/** Does a sign-in's permissions cover writing tile posts? */
export function coversPosts(scope) { return has(readGrant(scope), 'repo', TILE_POSTS.collection); }
/** Does a sign-in's permissions cover everything in "Raku"? (A sign-in from before WP5 doesn't, nor a refused one.) */
export function coversRaku(scope) {
  const g = readGrant(scope);
  const s = rakuSet();
  return s.repo.every((c) => has(g, 'repo', c)) && s.rpc.every((l) => has(g, 'rpc', l));
}

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

// The first screen's picks: tiles the owner chooses (claude/raku-plan.md decision 6; chosen Oct 19,
// replaced by these six Oct 21, in this order). Kept by DID, so a pick survives a handle change; the
// handles are only notes. They aren't pinned: a card follows its author's changes.
export const PICKS = Object.freeze([
  'at://did:plc:vryspragp5yyohzghxpgqm7i/ing.dasl.masl/3mx27cvoqvz2g',   // gabriellanonino.com: a sprite
  'at://did:plc:qpdjl22sgfejceds2ibabye6/ing.dasl.masl/3mx2yq4ti6g2s',   // jackvalinsky.com: a glass lantern
  'at://did:plc:jatbf7xbmjzy4uol34yyeh6t/ing.dasl.masl/3mxrdcu5qrk2d',   // justinerickson.me: Moab Red Hot
  'at://did:plc:33k6yq7knpf5ecf532kdi5xy/ing.dasl.masl/3mxrcgrmw452v',   // center.for.cybernetic.beauty: Four On The Floor
  'at://did:plc:mhu5ya2asqislku2audcqmtm/ing.dasl.masl/3mxjvqfkjo22o',   // lowpoly.gg: 3D CSS Saturn
  'at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3mx6h2wjtgq2h',   // pyxorium.com: Roller Coaster
]);

// ---------- Raku's own link card (stage 6, Q93) ----------
// When someone shares Raku's address (Bluesky, other atproto apps, chat apps), the card is built from these
// tags in the page's head. Written into index.html by vite.config.js from here, so the address stays named in
// one place. The pictures are public/card.png (1200 × 630) and public/banner.png (1280 × 720, a tile-style
// banner for places that list apps beside tiles; not used by the tags).
export const CARD = Object.freeze({
  title: SITE.lab ? `${SITE.name} (lab)` : SITE.name,
  description: 'A browser for atproto web tiles: tabs, a shelf, tables and tile news.',
  image: 'card.png', width: 1200, height: 630,
  alt: 'Raku: a turquoise raku pot beside a browser window holding tile cards in glaze colours.',
});
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function cardTags() {
  const img = `${SITE.origin}/${CARD.image}`;
  return [
    ['name', 'description', CARD.description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', SITE.name],
    ['property', 'og:title', CARD.title],
    ['property', 'og:description', CARD.description],
    ['property', 'og:url', `${SITE.origin}/`],
    ['property', 'og:image', img],
    ['property', 'og:image:width', String(CARD.width)],
    ['property', 'og:image:height', String(CARD.height)],
    ['property', 'og:image:alt', CARD.alt],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', CARD.title],
    ['name', 'twitter:description', CARD.description],
    ['name', 'twitter:image', img],
  ].map(([k, n, v]) => `<meta ${k}="${n}" content="${attr(v)}">`).join('\n  ');
}

// ---------- Discover (stage 6, claude/raku-stage6-plan.md) ----------
// The Discover page (raku:discover): sources in a left column, the chosen one in the centre, previews of the
// others on the right (Q85, Q86): Tile news (the "Web Tiles" feed, published from thunderbird.cafe through
// Graze, Q84; step 6b), Following and search (step 6a).
// The "Web Tiles" feed (step 6b, Oct 21): published from thunderbird.cafe, made with Graze (did:web:api.graze.social).
export const FEED = 'at://did:plc:6vxjigxrqizmbo56gojxico3/app.bsky.feed.generator/Web-Tiles';
// Hand-picked posts for Tile news (Oct 24): older posts Graze won't take any more (its manual add stops at about
// four weeks). Raku reads them with the feed and mixes them in by date (P1 A), so most sit after the feed's own
// posts, reached by scrolling (the next batch loads near the bottom). Only the real feed gets them (not a ?feed=
// stand-in). Addresses by DID, so a handle change doesn't break them; a deleted post simply drops out. Oldest
// first; the running list with notes is claude/raku-tile-news-pins-plan.md. To add one: its at:// address (bsky.app's /profile/<handle>/post/<key> with
// the handle swapped for the account's DID).
export const NEWS_PINS = Object.freeze([
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3juhmexrpxd2m',   // Robin, 2023-04-28: very early Web Tiles working
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3kdcsolocpe2b',   // Robin, 2023-11-03: the Web Tiles essay
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3l4eegzitgq2j',   // Robin, 2024-09-17: first tile in his atproto app
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mdldo4iey225',   // Robin, 2026-01-29: next-gen web in an old browser
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mej27i74zk2t',   // Robin, 2026-02-10: webtil.es launch
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mexs4hbh6s2z',   // Robin, 2026-02-16: DASLing Group meeting
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mf54rcwomc22',   // Robin, 2026-02-18: tiles and lexicon embeds
  'at://did:plc:2cxgdrgtsmrbqnjkwyplmp43/app.bsky.feed.post/3mf56pkszzc2d',   // bmann.ca, 2026-02-18: on Robin's wishes idea
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mgcvswucbk2o',   // Robin, 2026-03-05: atile writes .tile files
  'at://did:plc:2cxgdrgtsmrbqnjkwyplmp43/app.bsky.feed.post/3mh4pmxkwu22e',   // bmann.ca, 2026-03-15: tiles, lexicon embeds, schema.org
  'at://did:plc:f25qr3njhaoeolu46vylylju/app.bsky.feed.post/3mi36vbkgms2c',   // webbeef, 2026-03-27: native tiles in Beaver with at:// URLs
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mia346rdic2b',   // Robin, 2026-03-29: AtmosphereConf session
  'at://did:plc:f25qr3njhaoeolu46vylylju/app.bsky.feed.post/3midfko3gp22w',   // webbeef, 2026-03-31: Teach the Web new Tricks #3: Web Tiles (a video)
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mjf6xuzgtk2t',   // Robin, 2026-04-13: the talk's recording
  'at://did:plc:dy6ekftqerqu5bcz76kgy6ux/app.bsky.feed.post/3mjpqxf4o2s2k',   // hyl.st, 2026-04-17: native embeds, webtiles among them
  'at://did:plc:f25qr3njhaoeolu46vylylju/app.bsky.feed.post/3mjumkr73ek2o',   // webbeef, 2026-04-19: WebTasks and wishes
  'at://did:plc:7ho7ntz7g2yglmpw5vsto7ht/app.bsky.feed.post/3mmznydfans2y',   // dysbulic, 2026-05-29: learning about WebTiles
  'at://did:plc:3x5npw4cb2twifyqcox7jmqj/app.bsky.feed.post/3mn4eubkwic2j',   // ekana.org, 2026-05-31: a website as a bento box of webtiles
  'at://did:plc:ephkzpinhaqcabtkugtbzrwu/app.bsky.feed.post/3mo4is2taw22d',   // byjp.me, 2026-06-12: tiles as views for AT collections
  'at://did:plc:lrphxvv25aibthe7xoc2eeyy/app.bsky.feed.post/3mpoocrgvps24',   // kandake.africa, 2026-07-02: a page built from DASL tiles (a video)
  'at://did:plc:lrphxvv25aibthe7xoc2eeyy/app.bsky.feed.post/3mpwiehjgoc2y',   // kandake.africa, 2026-07-05: the page's tiles now use DASL
  'at://did:plc:2cxgdrgtsmrbqnjkwyplmp43/app.bsky.feed.post/3mqpcsiqzxc2f',   // bmann.ca, 2026-07-15: twinkl.social demo, widgets for building tiles
  'at://did:plc:izttpdp3l6vss5crelt5kcux/app.bsky.feed.post/3mqtyyypye22e',   // Robin, 2026-07-17: two new things, a tile protocol registry
  'at://did:plc:lrphxvv25aibthe7xoc2eeyy/app.bsky.feed.post/3mvb4lmwshk27',   // kandake.africa, 2026-09-11: more usage of dasl.ing (a quote)
  'at://did:plc:6vxjigxrqizmbo56gojxico3/app.bsky.feed.post/3mw7avbjkd22n',   // thunderbird.cafe, 2026-09-23: rotatable 3D object tile
  'at://did:plc:ro563p5faldqu44apudq44k4/app.bsky.feed.post/3mw7cja67ie2z',   // colorado.atprotocol.space, 2026-09-23: the Atproto Colorado cube
  'at://did:plc:piwl4w3haqco46y37flufjcv/app.bsky.feed.post/3mwb3aghqfz2c',   // supramundane.agency, 2026-09-24: the WebTiles Showcase talk
]);
// Public reads of posts and feeds (no sign-in): one server, named here, so it can change (another AppView,
// Q90 notes) without touching the code that draws posts.
export const APPVIEW = BLUESKY_API;
// Moderation services whose labels Raku follows on posts (Bluesky's first; Blacksky's or Northsky's could be added).
export const MODERATION_SERVICES = Object.freeze([BLUESKY_MODERATION]);
// Search (Q95, Q96): appmosphe.re's search (Robin's CORS header, live since Oct 20), only when someone
// searches (Enter in the address box, or the search box on Discover); nothing is sent while typing.
export const SEARCH = Object.freeze({ name: 'appmosphe.re', url: 'https://appmosphe.re/api/search', max: 24, maxBytes: 1024 * 1024 });
// Following (Q91): the newest few tiles of each account kept on your shelf, a few accounts at a time.
export const FOLLOWING = Object.freeze({ perAccount: 10, max: 60, keepMs: 5 * 60 * 1000 });
// Tile posts (claude/tile-posts-plan.md, TP11): posts that share a tile (cafe.thunderbird.tile.post records, the
// lexicon in pyxorium/tile-posts). Bluesky's relay says which accounts have them (100 a request, up to maxAccounts);
// the owner's accounts (`always`: thunderbird.cafe, pyxorium.com) and the shelf's are always read too, so the
// source still works when the relay doesn't answer. The newest few posts of each account, a few accounts at a time.
export const TILE_POSTS = Object.freeze({
  collection: 'cafe.thunderbird.tile.post',
  relay: 'https://relay1.us-east.bsky.network', relayPage: 100, relayMs: 8000,
  always: Object.freeze(['did:plc:6vxjigxrqizmbo56gojxico3', 'did:plc:rqbqpaaluty5v47jwciowpik']),
  maxAccounts: 500, perAccount: 10, max: 100, atOnce: 4, accountMs: 10000, keepMs: 5 * 60 * 1000,
  repo: 'https://github.com/pyxorium/tile-posts',
});
// "Play here" (claude/raku-play-here-plan.md): a tile post's tile running in its post. awayMs: how long fully out of view
// before it stops (PH2); hintMs: how long "Keys go to the tile" shows after Play (PH8). Round C
// (claude/raku-expand-plan.md): expanding opens the tile to Raku's window in expandMs, expandEase (EX4: window, 400 ms,
// linear, chosen with the real maze; a plain fade with reduced motion, EX8); noteMs: how long a note ("The way is blocked.") shows in the
// expanded view.
export const PLAY_HERE = Object.freeze({ awayMs: 3000, hintMs: 2500, expand: 'window', expandMs: 400, expandEase: 'linear', noteMs: 5000 });
// Autoplay (claude/raku-expand-plan.md, "After C", AU1 to AU6): off by default, remembered in this browser under key;
// a tile post's tile starts by itself once share (about two-thirds) of it is on screen and has stayed so settleMs (AU2);
// it stops as Play here does (awayMs above). Over LIMITS.askBytes it never starts by itself (AU4).
export const AUTOPLAY = Object.freeze({ key: 'raku-autoplay', share: 0.66, settleMs: 1000 });
// Recent tiles (stage 6c, Q106 to Q110): appmosphe.re's list of every tile it has seen, newest first by each
// tile's createdAt, 30 a page (?page=N), shown in appmosphe.re's own order. Cards only; pictures are
// appmosphe.re's copies (/img/), drawn as ordinary pictures straight from appmosphe.re (Q122: its /img/ answers
// carry no CORS header, so they can't be downloaded and checked like the other card pictures; an <img> can't run
// anything, an SVG included). The page policy allows pictures from RECENT.imgOrigin for this.
export const RECENT = Object.freeze({
  name: 'appmosphe.re', url: 'https://appmosphe.re/api/tiles', imgPrefix: 'https://appmosphe.re/img/', imgOrigin: 'https://appmosphe.re',
  keepMs: 5 * 60 * 1000, maxBytes: 2 * 1024 * 1024, maxPages: 100,
  // Repeats collapse (Oct 30, Q147): a page left thin by collapsing fills itself from the next pages, until it has
  // fillCards new cards, reading at most fillPages more pages each time.
  fillCards: 12, fillPages: 3,
});
// Make a tile (stage 6c, Q101/Q102, Q112 to Q118): makers of tiles, in two groups (Q113 C: "No code needed",
// then "From your own files"; alphabetical inside each). Each card: a drawn mark (a letter in a glaze colour,
// no logos: Q118 A), the name, the site, one line, and Open (a new tab: Raku's own list, so no link message).
// Glazes are reused as makers are added (owner, Oct 22): only neighbours in a group must differ.
// szzt (burrito.space, Oct 22: "yeah link it!"): a testbed implementation of the specs; tried by the owner (a page
// published with szzt ran in Raku exactly as expected).
export const MAKE = Object.freeze({
  intro: 'A web tile is a small page or app stored in your own atproto account. Anyone can open it in a tile browser like Raku.',
  learn: Object.freeze({ text: 'New to tiles? Read about them at dasl.ing', url: 'https://dasl.ing/' }),
  groups: Object.freeze([
    Object.freeze({ title: 'No code needed', makers: Object.freeze([
      Object.freeze({ id: 'atmosynth', name: 'ATMOSYNTH', url: 'https://atmosynth.at/', mark: 'A', glaze: 'turquoise',
        line: 'Make synth patches in your browser and play them together live. Start under "Create"; you don\'t need an account to begin.' }),
      Object.freeze({ id: 'treeline', name: 'Treeline', url: 'https://treeline.world/', mark: 'T', glaze: 'copper',
        line: 'Outdoor fitness and adventure logs on atproto. Turn an activity, with its GPS track, into a tile with "Share as webtile".' }),
      Object.freeze({ id: 'foundry', name: 'Web Tile Foundry', url: 'https://foundry.thunderbird.cafe/', mark: 'F', glaze: 'cream',
        line: 'Fill in a form and publish: a walking sprite, a stained-glass lantern, a roller coaster, a mixtape or a zine.' }),
    ]) }),
    Object.freeze({ title: 'From your own files', makers: Object.freeze([
      Object.freeze({ id: 'appmosphere', name: 'appmosphe.re publish', url: 'https://appmosphe.re/publish', mark: 'a', glaze: 'smoke',
        line: 'Upload a folder with an index.html (and an optional manifest.json), or a .tile file. Preview it, publish it to your account, and update your tiles later.' }),
      Object.freeze({ id: 'szzt', name: 'szzt', url: 'https://szzt.app/publish/', mark: 's', glaze: 'turquoise',
        line: 'Drag and drop a page, a folder or a .zip, see it run in the preview panel, then publish. A testbed for the web tile specs.' }),
    ]) }),
  ]),
});
/** "foundry.thunderbird.cafe", "appmosphe.re/publish": a maker's address as shown on its card. */
export const siteLabel = (url) => { const u = new URL(url); return (u.host + u.pathname).replace(/\/$/, ''); };

// appmosphe.re's copy of one of a tile's pictures (the same address shape as Recent tiles' pictures). Used only
// where it reveals nothing about the visitor (Q129): the first screen's picks (the same for everyone) and the
// results of a search appmosphe.re itself answered. Never for Your shelf, Following or "Already in Raku".
export const appmosphereCopy = (did, cid) => (did && cid ? `${RECENT.imgPrefix}${did}/${cid}` : null);
// "Last visit" marks for Following and Recent tiles (marks.js): kept on this device only (Q111), in one entry.
// Following's older entry (raku-following-seen) moves in the first time it's read.
export const MARKS = Object.freeze({ key: 'raku-marks', legacy: Object.freeze({ following: 'raku-following-seen' }) });
// Where a post opens outside Raku (Q90; chosen in the link message, Q98; Bluesky by default). Every one of these apps
// shows a post at https://<host>/profile/<handle or DID>/post/<record key>.
export const POST_APPS = Object.freeze([
  Object.freeze({ id: 'bluesky', name: 'Bluesky', host: 'bsky.app' }),
  Object.freeze({ id: 'blacksky', name: 'Blacksky', host: 'blacksky.community' }),
  Object.freeze({ id: 'mu', name: 'mu', host: 'mu.social' }),
  Object.freeze({ id: 'northsky', name: 'Northsky', host: 'northsky.app' }),   // confirmed Oct 22 (a post link from the owner)
]);
export const POST_APP_KEY = 'raku-post-app';           // localStorage: the chosen app's id (chosen in the link message, Q98)
export function postApp(storage = null) {
  let id = null;
  try { id = storage?.getItem(POST_APP_KEY); } catch { id = null; }
  return POST_APPS.find((a) => a.id === id) || POST_APPS[0];
}
export const postLink = (app, actor, rkey) => `https://${app.host}/profile/${actor}/post/${rkey}`;
// Where a record or collection that isn't a tile (or a post) opens outside Raku (open links, OL1/OL4; PDSls by
// default). Each explorer shows one at https://<host><prefix><at:// address> (seen in the owner's browser, Nov 5).
// Kept apart from the post apps: its own choice, its own key.
export const RECORD_APPS = Object.freeze([
  Object.freeze({ id: 'pdsls', name: 'PDSls', host: 'pdsls.dev', prefix: '/' }),
  Object.freeze({ id: 'taproot', name: 'Taproot', host: 'atproto.at', prefix: '/uri/' }),
]);
export const RECORD_APP_KEY = 'raku-record-app';       // localStorage: the chosen explorer's id
export function recordApp(storage = null) {
  let id = null;
  try { id = storage?.getItem(RECORD_APP_KEY); } catch { id = null; }
  return RECORD_APPS.find((a) => a.id === id) || RECORD_APPS[0];
}
export const explorerLink = (app, uri) => `https://${app.host}${app.prefix}${uri}`;

// ---------- Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10) ----------
// A record that isn't a tile opens in a tab when its kind (collection) has a renderer here: a tile written to show
// records of that kind, pinned by its record CID like a table's tiles (RT2), so Raku runs exactly the version that was
// checked. Raku hands it the record over the tiles spec's data protocol (tp-data, RT1 and RT4) and lets it ask for one
// thing: to open an at:// address in a new tab (RT5). Kinds without a renderer open the link message, as before.
// The place renderer is published from C:\thunderbird-cafe\maze-tiles (node scripts/publish.mjs --place, which prints
// these two values; its published.json keeps them under "place-renderer"). Without both, places open the link message. Republishing it means a new pin here, or Raku refuses the changed tile (publish and pin before pushing).
export const RENDERERS = Object.freeze({
  'cafe.thunderbird.way.place': Object.freeze({ name: 'Places', uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mzp2cmnlwa26',
    cid: 'bafyreigdzwamcyeeqxfaf6okekdyosybbilwznlb7qolyucky3pj4w6ica' }),   // republished Nov 7 2026 (the tile's card)
  // The signpost renderer (claude/raku-renderer-tiles-plan.md, "The signpost renderer"): node scripts/publish.mjs
  // --signpost in C:\thunderbird-cafe\maze-tiles prints these two values (its published.json: "signpost-renderer").
  'cafe.thunderbird.way.signpost': Object.freeze({ name: 'Signposts', uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mzoty54cln2u',
    cid: 'bafyreifeyejtny7l7dc6kv33yiyasihzfvgd2mjdvyr5ubxlkt2lj7b4fa' }),   // published Nov 6 2026
});
/** The pinned renderer for records of this kind, or null (none, or not pinned yet). */
export function rendererFor(collection, renderers = RENDERERS) {
  const r = Object.prototype.hasOwnProperty.call(renderers, collection) ? renderers[collection] : null;
  return r && typeof r.uri === 'string' && r.uri.startsWith(`at://`) && typeof r.cid === 'string' && r.cid ? r : null;
}
/** Every pinned renderer (for the pinned loader). */
export const pinnedRenderers = (renderers = RENDERERS) => Object.keys(renderers).map((c) => rendererFor(c, renderers)).filter(Boolean);
// A renderer asking Raku to open an address (RT5): at:// addresses only, at most this long, and requests closer than
// gapMs to the last one from the same tab are ignored. handleMs: how long the record waits for its author's handle
// to check out before it's sent without one (the tile shows the DID then). getMax: how many records a renderer may
// have Raku read for it, per load (SR6: only records named in the one it was given, or in that record's account);
// its picture requests count against the same allowance. pictureMaxBytes: the largest picture Raku hands a renderer
// (claude/raku-places-card-plan.md, PC6: a tile's banner).
export const RENDER = Object.freeze({ openMaxChars: 600, gapMs: 1000, handleMs: 1500, getMax: 20, pictureMaxBytes: 1024 * 1024 });
// Ways (claude/raku-ways-plan.md, RW1 to RW8): Raku carries travellers between tiles with ways, as the travel pages do
// (maze-tiles site/travel.js). After a place says hello and Raku sends its arrival, the screen between places stays
// revealMs (the tile plays its own arrival under it), then fades over fadeMs; a destination without ways shows plainMs
// after its page loads; a tile with ways that never says hello lets the screen go helloMs after its page loads.
// minScreenMs (RW9): however fast the place loads, the screen stays at least this long from the moment you step
// through, so its name and banner can be read. waysBytes: the most a tile's /ways.json may be. bannerBytes: the largest
// banner shown on the screen (RW4).
// RW10 (claude/raku-ways-plan.md): a tile opened in the tab in front gets the keys this long after its page is served
// (twice, as its page settles).
export const KEYS_AFTER_MS = Object.freeze([300, 1200]);
export const WAYS = Object.freeze({ revealMs: 450, fadeMs: 400, plainMs: 1200, helloMs: 8000, minScreenMs: 1500, waysBytes: 64 * 1024, bannerBytes: 2 * 1024 * 1024 });
// On this computer only: ?feed=at://…/app.bsky.feed.generator/… shows Tile news from another feed (the checks'
// stand-in feed, say).
export function feedUri(loc = globalThis.location) {
  if (isLocal(loc)) {
    const v = new URLSearchParams(loc.search).get('feed');
    if (v && /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.generator\/[A-Za-z0-9._~-]{1,64}$/.test(v)) return v;
  }
  return FEED;
}

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
// - pictures only Raku's own, made here from downloaded bytes (blob:), avatars from Bluesky's picture server, or
//   (stage 6c) Recent tiles' pictures from appmosphe.re's /img/ copies;
// - connections over https (lookups, the authors' account servers, Bluesky's public API), and the relays named
//   one by one: the tables' (stage 5: wss://relay.daisy.thunderbird.cafe/) and the rooms relay (rooms step 1);
//   a room's voice and screens go between the computers (WebRTC), which the policy doesn't cover;
// - frames only from the tile loading server.
export const tableRelays = () => [...new Set(Object.values(TABLES).map((t) => t.relay).filter(Boolean).map((u) => new URL(u).origin))];
/** Every relay Raku's page connects to: the tables' and the rooms relay. */
export const pageRelays = () => [...new Set([...tableRelays(), new URL(ROOMS.relay).origin])];
export function pageCsp(loadDomain = TILE_LOAD_DOMAIN, scheme = 'https', relays = pageRelays()) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' blob: data: https://cdn.bsky.app ${RECENT.imgOrigin}`,
    "font-src 'self'",
    ["connect-src 'self' https:", ...relays].join(' '),
    `frame-src ${scheme}://${loadDomain} ${scheme}://*.${base}`,
    "worker-src 'self'",                   // stage 9: Raku's own service worker (public/sw.js), nothing else
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
