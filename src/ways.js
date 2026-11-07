// Ways between tiles, with Raku as the host (claude/raku-ways-plan.md, RW1 to RW8). The plain rules, no DOM (tested in
// Node, test/ways.test.mjs); app.js does the drawing and the messages.
//
// The format (claude/escher-maze-ways-plan.md, M21 to M24): a tile lists its exits and entrances in its own
// /ways.json; each exit names a signpost (a cafe.thunderbird.way.signpost record) saying where it leads: a list of
// destinations, each a place (cafe.thunderbird.way.place: a stable name pointing at a tile and its exact version) or a
// tile, with an optional entrance and label. Empty: dormant. One: straight there. Several: "Pick a door".
//
// The messages, between Raku and a tile with ways (the maze's src/ways.js, M23):
//   tile → Raku   tiles-protocol-up-way-payload    { v: 1, kind: "hello", tile }                 when it loads
//   Raku → tile   tiles-protocol-down-way-payload  { v: 1, kind: "status", exits: { id: "open" | "dormant" } }
//   Raku → tile   tiles-protocol-down-way-payload  { v: 1, kind: "arrive", entrance }            someone arrives
//   tile → Raku   tiles-protocol-up-way-payload    { v: 1, kind: "leave", exit, facing }         stepping through
// The tile never says who is travelling. Raku reads signposts, places and tiles from their authors' own servers, as it
// reads everything else; nothing here writes anywhere.
//
// A tab that has travelled shows the way just taken (RW2): raku:way/<signpost's account>/<signpost's key>, e.g.
// raku:way/thunderbird.cafe/winter-forest.slide. A reload or a shared link replays that one leg: Raku reads the
// signpost now and you arrive where it leads.

export const WAY_UP = 'tiles-protocol-up-way-payload';
export const WAY_DOWN = 'tiles-protocol-down-way-payload';
export const WAY_V = 1;
export const PLACE = 'cafe.thunderbird.way.place';
export const SIGNPOST = 'cafe.thunderbird.way.signpost';
export const TILE = 'ing.dasl.masl';
const MAX_EXITS = 24;
const MAX_DOORS = 12;
const ID = /^[a-z0-9-]{1,64}$/;
const AT_URI = /^at:\/\/(did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%-]+))\/([a-zA-Z0-9.-]+)\/([A-Za-z0-9._:~-]{1,512})$/;

/** at://<did>/<collection>/<rkey> (a DID, as ways.json, places and signposts write them) → its parts, or null. */
export function parseAtUri(uri) {
  const m = AT_URI.exec(typeof uri === 'string' ? uri : '');
  return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
}

const clip = (s, n) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/** A tile's /ways.json, checked (v 1): { tile, place, entry, exits: [{ id, signpost }], entrances: [id] } or null. */
export function readWays(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || typeof json.tile !== 'string' || !ID.test(json.tile)) return null;
  const exits = (Array.isArray(json.exits) ? json.exits : []).slice(0, MAX_EXITS)
    .filter((e) => e && ID.test(e.id) && parseAtUri(e.signpost)?.collection === SIGNPOST)
    .map((e) => ({ id: e.id, signpost: e.signpost }));
  const entrances = (Array.isArray(json.entrances) ? json.entrances : []).slice(0, MAX_EXITS).map((e) => e && e.id).filter((id) => ID.test(id || ''));
  const place = parseAtUri(json.place)?.collection === PLACE ? json.place : null;
  return { tile: json.tile, place, entry: json.entry === 'ways-only' ? 'ways-only' : 'open', exits, entrances };
}

/** Which entrance to arrive at: the one asked for if the place has it, else its first (none: null). */
export const entranceFor = (ways, asked) => (!ways ? null : ways.entrances.includes(asked) ? asked : ways.entrances[0] || null);

/** A message from a tile, read: { kind: 'hello' } or { kind: 'leave', exit }, or null when it isn't one. */
export function readWayMessage(d) {
  if (!d || d.action !== WAY_UP || !d.payload || typeof d.payload !== 'object' || d.payload.v !== WAY_V) return null;
  const p = d.payload;
  if (p.kind === 'hello') return { kind: 'hello' };
  if (p.kind === 'leave' && typeof p.exit === 'string' && ID.test(p.exit)) return { kind: 'leave', exit: p.exit };
  return null;
}
export const statusMessage = (exits) => ({ action: WAY_DOWN, payload: { v: WAY_V, kind: 'status', exits } });
export const arriveMessage = (entrance) => ({ action: WAY_DOWN, payload: { v: WAY_V, kind: 'arrive', entrance } });

// ---------- test signposts (RW8) ----------
// On this computer only (127.0.0.1 or localhost), Raku's address may say what a signpost should lead to, as if it were
// filled, as the travel page's (W41), e.g. ?sign=winter-forest.wardrobe:maze@pyxorium.com/obelisk
//   <signpost's key>:<place's key>/<entrance>            the place in the same account as the signpost
//   <signpost's key>:<place's key>@<account>/<entrance>  the place in another account (a DID, or one of TEST_ACCOUNTS)
// Several destinations joined with commas; nothing after the colon means empty (dormant); several signposts, several
// sign= in the address. Everything else stays real. The live Raku ignores it. → Map(signpost key → [destination]).
export const TEST_ACCOUNTS = Object.freeze({ 'thunderbird.cafe': 'did:plc:6vxjigxrqizmbo56gojxico3', 'pyxorium.com': 'did:plc:rqbqpaaluty5v47jwciowpik' });
const here = (loc) => !!loc && ['127.0.0.1', 'localhost'].includes(loc.hostname);
export function testSignposts(loc = globalThis.location) {
  const out = new Map();
  if (!here(loc)) return out;
  for (const v of new URLSearchParams(loc.search || '').getAll('sign')) {
    const m = /^([A-Za-z0-9._~-]{1,200}):(.*)$/.exec(v);
    if (!m) continue;
    const to = [];
    for (const d of m[2].split(/[,\s]+/).filter(Boolean)) {      // (a "+" in an address reads as a space)
      const dm = /^([A-Za-z0-9._~-]{1,200})(?:@([A-Za-z0-9._:%-]{1,200}))?(?:\/([a-z0-9-]{1,64}))?$/.exec(d);
      if (!dm) continue;
      const did = dm[2] ? (dm[2].startsWith('did:') ? dm[2] : TEST_ACCOUNTS[dm[2]]) : null;
      if (dm[2] && !did) continue;
      to.push({ placeKey: dm[1], ...(did ? { did } : {}), ...(dm[3] ? { entrance: dm[3] } : {}) });
    }
    out.set(m[1], to);
  }
  return out;
}
/** The test destinations for a signpost (its DID and key), as a signpost's `to` would say them, or null. */
export function overrideFor(did, rkey, overrides) {
  if (!overrides || !overrides.has(rkey)) return null;
  return overrides.get(rkey).map((d) => ({ place: `at://${d.did || did}/${PLACE}/${d.placeKey}`, ...(d.entrance ? { entrance: d.entrance } : {}) }));
}

// ---------- reading signposts, places and tiles ----------
/**
 * createWayReader({ resolver, moderation, overrides }) reads ways the way Raku reads everything (resolve.js: the
 * author's own server, with its limits), honouring the test signposts:
 *   signpost(did, rkey)  → { state: 'dormant' | 'open' | 'error', note, to }    (missing: dormant)
 *   state(signpostUri)   → 'open' | 'dormant'                                    (unreadable: dormant)
 *   doors(to)            → [door]: { tile, did, rkey, pinned, place, entrance, label, name, by } or { label, broken }
 *   lookUp(did, rkey)    → signpost(), with its doors when open
 * A door is broken when it isn't a place or a tile, can't be read, its account or tile is hidden in Raku (RW3), or its
 * tile has changed since its place was pointed at it.
 */
export function createWayReader({ resolver, moderation = null, overrides = null }) {
  async function signpost(did, rkey) {
    const o = overrideFor(did, rkey, overrides);
    if (o) return { state: o.length ? 'open' : 'dormant', note: '', to: o, test: true };
    let rec;
    try { rec = await resolver.record(did, SIGNPOST, rkey); } catch (err) {
      if (err && err.code === 'not-found') return { state: 'dormant', note: '', to: [] };
      return { state: 'error', note: '', to: [] };
    }
    const v = rec.value || {};
    const to = Array.isArray(v.to) ? v.to.slice(0, MAX_DOORS).filter((d) => d && typeof d === 'object') : [];
    return { state: to.length ? 'open' : 'dormant', note: clip(v.note, 100), to };
  }
  async function state(uri) {
    const at = parseAtUri(uri);
    if (!at || at.collection !== SIGNPOST) return 'dormant';
    const s = await signpost(at.did, at.rkey).catch(() => ({ state: 'dormant' }));
    return s.state === 'open' ? 'open' : 'dormant';
  }
  async function door(dest) {
    const label = clip(dest.label, 100);
    const entrance = typeof dest.entrance === 'string' && ID.test(dest.entrance) ? dest.entrance : null;
    let tileUri = null, pinned = null, placeName = '', place = null;
    if (typeof dest.place === 'string') {
      const at = parseAtUri(dest.place);
      if (!at || at.collection !== PLACE) return { label, broken: "This way points at something that isn't a place." };
      if (moderation && await moderation.isAccountHidden(at.did)) return { label, broken: 'This place isn’t shown in Raku.', hidden: true };
      const rec = await resolver.record(at.did, PLACE, at.rkey);
      place = dest.place;
      tileUri = rec.value && rec.value.tile;
      pinned = rec.value && typeof rec.value.cid === 'string' ? rec.value.cid : null;
      placeName = clip(rec.value && rec.value.name, 100);
    } else if (typeof dest.tile === 'string') tileUri = dest.tile;
    const at = parseAtUri(tileUri);
    if (!at || at.collection !== TILE) return { label, broken: "This way points at something that isn't a tile." };
    if (moderation && (await moderation.isAccountHidden(at.did) || await moderation.isHidden(at.did, at.rkey))) return { label, broken: 'This tile isn’t shown in Raku.', hidden: true };
    const rec = await resolver.tileRecord(at.did, at.rkey);
    // A place opens exactly the version it points at (its cid), as the travel page does: a tile changed since then is
    // a way that's blocked for now.
    if (pinned && rec.cid && pinned !== rec.cid) return { label, broken: 'The tile there has changed since its place was pointed at it.' };
    const t = (rec.value && rec.value.tile) || {};
    const by = await resolver.checkedHandle(at.did).catch(() => null);
    return {
      tile: tileUri, did: at.did, rkey: at.rkey, pinned, place, entrance, label,
      name: placeName || clip(typeof t.name === 'string' ? t.name.trim() : '', 100) || 'A tile',
      by: by || null,
    };
  }
  async function doors(to) {
    return Promise.all(to.map((d) => door(d).catch(() => ({ label: clip(d && d.label, 100), broken: "This way couldn't be looked up just now." }))));
  }
  async function lookUp(did, rkey) {
    const s = await signpost(did, rkey);
    if (s.state !== 'open') return { ...s, doors: [] };
    return { ...s, doors: await doors(s.to) };
  }
  return { signpost, state, doors, lookUp };
}

/** The door a "Go to" chose (its destination's place or tile address, exactly as the signpost writes it), or null. */
export function chosenDoor(view, pick) {
  if (!pick || !view || !Array.isArray(view.doors)) return null;
  const i = (view.to || []).findIndex((d) => d && (d.place === pick || d.tile === pick));
  const door = i >= 0 ? view.doors[i] : null;
  return door && !door.broken ? door : null;
}

/** What a history entry keeps of a door (tabs.js state), so Back and Forward return without reading again. */
export const keepDoor = (d) => ({ tile: d.tile, did: d.did, rkey: d.rkey, pinned: d.pinned || null, place: d.place || null,
  entrance: d.entrance || null, label: d.label || '', name: d.name, by: d.by || null });

/** Whether a signpost renderer's "Go to" names one of the signpost's destinations → { pick, entrance } or null (RW5). */
export function signpostGoTo(given, address) {
  const at = parseAtUri(given && given.uri);
  if (!at || at.collection !== SIGNPOST || typeof address !== 'string') return null;
  const to = given.value && Array.isArray(given.value.to) ? given.value.to : [];
  const d = to.find((x) => x && (x.place === address || x.tile === address));
  return d ? { did: at.did, rkey: at.rkey, pick: address } : null;
}
