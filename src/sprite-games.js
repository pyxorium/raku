// Sprite games (claude/raku-sprite-games-plan.md, SG1 to SG8): Raku hands a game tile the signed-in account's rpg.actor
// character. The plain rules, no DOM (tested in Node, test/sprite-games.test.mjs); app.js does the messages and the
// account menu the switch.
//
// The messages are Cosmic Junkyard's (its published code, and rpg-sprite-wish-demo-project.md), on the tiles spec's data
// channel, the same envelopes as the renderers':
//   tile → Raku   tiles-protocol-up-data-payload    { kind: "hello", v: 1 }          when it loads
//   tile → Raku   tiles-protocol-up-data-payload    { kind: "sprite-request" }       its "Load my sprite" button
//   Raku → tile   tiles-protocol-down-data-payload  { kind: "sprite-status", state }  ready | loading | no-sprite | error | cancelled
//   Raku → tile   tiles-protocol-down-data-payload  { kind: "sprite", v: 1, image (a PNG Blob), frameWidth, frameHeight,
//                                                     sheetWidth, sheetHeight, handle }
// Any tile that says the hello is answered (SG7): with the character when an account is signed in and its "Show my
// character in games" is on (SG4), else with "ready", which shows the game's button; the button opens Raku's account
// menu (SG2, SG3). The character comes from rpg.actor's Compendium tile (SG1), read again only when it has changed
// (SG6), else from the account's own actor.rpg.sprite record. Nothing here writes anywhere.

import { UP, DOWN } from './renderers.js';
import { fetchJson, fetchLimited, NetError } from './net.js';
import { SPRITE_GAMES } from './config.js';
import { rawCid } from './tables/pinned.js';

export const STATES = Object.freeze(['ready', 'loading', 'no-sprite', 'error', 'cancelled']);

/** A message from a tile, read: { kind: 'hello' } or { kind: 'request' }, or null when it isn't one of these. */
export function readSpriteGameMessage(d) {
  if (!d || d.action !== UP || !d.payload || typeof d.payload !== 'object' || Array.isArray(d.payload)) return null;
  const p = d.payload;
  if (p.kind === 'hello' && p.v === 1) return { kind: 'hello' };
  if (p.kind === 'sprite-request') return { kind: 'request' };
  return null;
}

export function statusMessage(state) {
  if (!STATES.includes(state)) throw new Error(`not a sprite status: ${state}`);
  return { action: DOWN, payload: { kind: 'sprite-status', state } };
}

/** The character, as Cosmic Junkyard takes it. image: a Blob (or a data:image/… string). */
export function spriteMessage({ image, frameWidth, frameHeight, sheetWidth, sheetHeight, handle = null }) {
  const payload = { kind: 'sprite', v: 1, image, frameWidth, frameHeight, sheetWidth, sheetHeight };
  if (typeof handle === 'string' && handle) payload.handle = handle;
  return { action: DOWN, payload };
}

// ---------- the sprite itself ----------

/** A PNG's size from its header, or null when the bytes aren't a PNG. */
export function pngSize(bytes) {
  const b = bytes;
  if (!b || b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const at = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const width = at(16), height = at(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const whole = (n, max) => Number.isInteger(n) && n > 0 && n <= max;

/**
 * The sizes a game gets, from a record's (or the catalog's) layout and the picture's own size: { frameWidth,
 * frameHeight, sheetWidth, sheetHeight }, or null when they don't fit together. The sheet's size is the picture's;
 * the frame's is the layout's (some sheets have extra pixels per frame: rpg.actor's help says use the listed layout),
 * else the picture split into its columns and rows (3 × 4 when it names none).
 */
export function spriteSizes(layout, png, maxSide = SPRITE_GAMES.maxSide) {
  if (!png || !whole(png.width, maxSide) || !whole(png.height, maxSide)) return null;
  const g = layout && typeof layout === 'object' ? layout : {};
  const columns = g.columns ?? 3, rows = g.rows ?? 4;
  if (!whole(columns, 64) || !whole(rows, 64)) return null;
  const frameWidth = g.frameWidth ?? png.width / columns;
  const frameHeight = g.frameHeight ?? png.height / rows;
  if (!whole(frameWidth, maxSide) || !whole(frameHeight, maxSide)) return null;
  if (frameWidth * columns > png.width || frameHeight * rows > png.height) return null;
  return { frameWidth, frameHeight, sheetWidth: png.width, sheetHeight: png.height };
}

/**
 * An account's entry in the Compendium's catalog → { cid, path, layout, stale } or null when it has none (not there,
 * no sprite, its picture unavailable).
 */
export function catalogEntry(catalog, did) {
  const list = catalog && Array.isArray(catalog.records) ? catalog.records : [];
  const r = list.find((x) => x && x.did === did);
  const a = r && r.sprite && r.sprite.asset;
  if (!a || typeof a.cid !== 'string' || typeof a.path !== 'string' || !a.path) return null;
  const layout = (r.sprite && r.sprite.geometry) || r.geometry || null;
  return { cid: a.cid, path: a.path.startsWith('/') ? a.path : `/${a.path}`, layout, stale: r.stale === true };
}

/** A catalog Raku can read: rpg.actor's sprite-compendium schema with its list of characters. */
export function isCatalog(json) {
  return !!json && typeof json === 'object' && typeof json.schema === 'string' && json.schema.startsWith('rpg.actor.sprite-compendium/')
    && Array.isArray(json.records);
}

const blobOf = (entry) => (entry && entry.src && entry.src.ref && typeof entry.src.ref.$link === 'string' ? entry.src.ref.$link : null);

// ---------- the Compendium (SG1, SG6) ----------

/**
 * createCompendium({ resolver, fetchImpl, now }) reads rpg.actor's Compendium tile, kept in memory:
 *   catalog() → { catalog, resources, did, pds }   the catalog and the tile's files, read again only when rpg.actor's
 *                                                  account has changed (getLatestCommit) and, then, only when the
 *                                                  catalog's own file has changed; at most every checkGapMs
 *   spriteFor(did) → { bytes, layout } | null     an account's sprite from it (null: not in it)
 */
export function createCompendium({ resolver, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = SPRITE_GAMES }) {
  const { did, rkey, catalogPath } = limits.compendium;
  let kept = null;              // { rev, recordCid, catalogCid, catalog, resources, pds }
  let checkedAt = -Infinity;
  let reading = null;

  async function look() {
    const { pds } = await resolver.account(did);
    const commit = await fetchJson(`${pds}/xrpc/com.atproto.sync.getLatestCommit?did=${encodeURIComponent(did)}`,
      { timeoutMs: limits.lookupMs, maxBytes: 64 * 1024, fetchImpl });
    const rev = commit.ok && commit.json && typeof commit.json.rev === 'string' ? commit.json.rev : null;
    if (kept && rev && kept.rev === rev && kept.pds === pds) return kept;
    const rec = await fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=ing.dasl.masl&rkey=${encodeURIComponent(rkey)}`,
      { timeoutMs: limits.lookupMs, maxBytes: limits.recordBytes, fetchImpl });
    const resources = rec.ok && rec.json && rec.json.value && rec.json.value.tile && rec.json.value.tile.resources;
    if (!resources || typeof resources !== 'object') throw new NetError('upstream', "rpg.actor's Compendium couldn't be read.");
    const catalogCid = blobOf(resources[catalogPath]);
    if (!catalogCid) throw new NetError('upstream', "rpg.actor's Compendium has no catalog.");
    if (kept && kept.catalogCid === catalogCid && kept.pds === pds) {
      kept = { ...kept, rev, recordCid: rec.json.cid || null, resources };
      return kept;
    }
    const got = await fetchLimited(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(catalogCid)}`,
      { timeoutMs: limits.catalogMs, maxBytes: limits.catalogBytes, fetchImpl });
    if (!got.ok) throw new NetError('upstream', "rpg.actor's Compendium catalog couldn't be downloaded.");
    if ((await rawCid(got.bytes)) !== catalogCid) throw new NetError('changed', "rpg.actor's Compendium catalog didn't match its record.");
    let catalog = null;
    try { catalog = JSON.parse(new TextDecoder().decode(got.bytes)); } catch { /* not JSON */ }
    if (!isCatalog(catalog)) throw new NetError('upstream', "rpg.actor's Compendium catalog isn't one Raku can read.");
    kept = { rev, recordCid: rec.json.cid || null, catalogCid, catalog, resources, pds };
    return kept;
  }

  async function catalog() {
    if (kept && now() - checkedAt < limits.checkGapMs) return kept;
    if (!reading) {
      reading = look().then((k) => { checkedAt = now(); return k; }).finally(() => { reading = null; });
    }
    return reading;
  }

  async function spriteFor(account) {
    const k = await catalog();
    const e = catalogEntry(k.catalog, account);
    if (!e) return null;
    const cid = blobOf(k.resources[e.path]);
    if (!cid || cid !== e.cid) return null;            // its picture isn't in the package as listed: not in it
    const got = await fetchLimited(`${k.pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
      { timeoutMs: limits.lookupMs, maxBytes: limits.spriteBytes, fetchImpl });
    if (!got.ok) throw new NetError('upstream', "The character's picture couldn't be downloaded from the Compendium.");
    if ((await rawCid(got.bytes)) !== cid) throw new NetError('changed', "The character's picture didn't match the Compendium.");
    return { bytes: got.bytes, layout: e.layout, from: 'compendium' };
  }

  return { catalog, spriteFor, get kept() { return kept; } };
}

// ---------- an account's own record (SG1: when the Compendium hasn't got it) ----------

/** An account's own actor.rpg.sprite/self → { bytes, layout } | null (no record). */
export async function ownSprite({ resolver, did, fetchImpl = globalThis.fetch, limits = SPRITE_GAMES }) {
  const { pds } = await resolver.account(did);
  const rec = await fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${limits.spriteCollection}&rkey=${limits.spriteRkey}`,
    { timeoutMs: limits.lookupMs, maxBytes: 256 * 1024, fetchImpl });
  if (rec.status === 400 || rec.status === 404) return null;
  const v = rec.ok && rec.json && rec.json.value;
  if (!v || typeof v !== 'object') throw new NetError('upstream', "Your account's server didn't answer properly.");
  const cid = blobOf({ src: v.spriteSheet });
  if (!cid) return null;
  const got = await fetchLimited(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
    { timeoutMs: limits.lookupMs, maxBytes: limits.spriteBytes, fetchImpl });
  if (!got.ok) throw new NetError('upstream', "Your character's picture couldn't be downloaded.");
  if ((await rawCid(got.bytes)) !== cid) throw new NetError('changed', "Your character's picture didn't match its record.");
  const layout = { columns: v.columns, rows: v.rows, frameWidth: v.frameWidth, frameHeight: v.frameHeight };
  return { bytes: got.bytes, layout, from: 'record' };
}

/**
 * createCharacters({ resolver, fetchImpl }) → { forAccount(did) }: the character a game gets, checked:
 *   { bytes (a PNG), sizes, from: 'compendium' | 'record' } | null (none anywhere). Throws when it can't be read.
 */
export function createCharacters({ resolver, fetchImpl = globalThis.fetch, now, compendium = null, limits = SPRITE_GAMES }) {
  const comp = compendium || createCompendium({ resolver, fetchImpl, now, limits });
  function checked(s) {
    if (!s) return null;
    const png = pngSize(s.bytes);
    const sizes = png && spriteSizes(s.layout, png, limits.maxSide);
    if (!sizes) throw new NetError('not-a-sprite', "That character's picture isn't a sprite sheet Raku can hand over.");
    return { bytes: s.bytes, sizes, from: s.from };
  }
  async function forAccount(did) {
    let s = null;
    try { s = await comp.spriteFor(did); } catch { s = null; }     // the Compendium unreadable: the record, as when it isn't there
    if (s) { try { return checked(s); } catch { /* a bad sheet there: try the record */ } }
    return checked(await ownSprite({ resolver, did, fetchImpl, limits }));
  }
  return { forAccount, compendium: comp };
}

// ---------- the switch (SG4) ----------

/** "Show my character in games", per account: on unless the account is listed in localStorage. */
export function createCharacterSwitch({ storage = null, key = SPRITE_GAMES.switchKey } = {}) {
  const listeners = new Set();
  const read = () => {
    try { const v = JSON.parse(storage?.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
  };
  return {
    isOn(did) { return !!did && !read().includes(did); },
    set(did, on) {
      if (!did) return;
      const off = new Set(read());
      if (on) off.delete(did); else off.add(did);
      try { storage?.setItem(key, JSON.stringify([...off])); } catch { /* fine: this visit only */ }
      for (const fn of listeners) { try { fn(did, on); } catch { /* fine */ } }
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** How many characters one tile may be sent per load (SG7). */
export function createAnswerBudget({ max = SPRITE_GAMES.answersMax } = {}) {
  let used = 0;
  return { take() { if (used >= max) return false; used += 1; return true; } };
}

/**
 * What Raku answers a hello, or does for the button (SG2 to SG4), given who's signed in:
 *   answerHello(account, on) → 'feed' (send the character) | 'ready' (show the game's button)
 *   answerRequest(account, on) → 'signin' | 'switch' | 'accounts': which part of the account menu opens
 */
export const answerHello = (account, on) => (account && on ? 'feed' : 'ready');
export const answerRequest = (account, on) => (!account ? 'signin' : !on ? 'switch' : 'accounts');
