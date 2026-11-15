// Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10): the plain rules for talking to a renderer, no DOM
// (tested in Node, test/renderers.test.mjs). app.js does the drawing and the messages.
//
// The talk is the tiles spec's data protocol (tp-data, https://dasl.ing/tp-data.html):
//   tile → Raku   tiles-protocol-up-data-ready                 (its listen(): ready for the record)
//   Raku → tile   tiles-protocol-down-data-payload  { uri, cid, did, handle, collection, rkey, value }   (RT4)
//   tile → Raku   tiles-protocol-up-data-payload    { open: "at://…" }                                  (RT5)
//   tile → Raku   tiles-protocol-up-data-payload    { get: "at://…" }                                   (SR2, SR6)
//   Raku → tile   tiles-protocol-down-data-payload  { got: "at://…", record: { …RT4's shape… } }  or  { got, error }
//   tile → Raku   tiles-protocol-up-data-payload    { picture: "<blob cid>", from: "at://…" }                (PC6)
//   Raku → tile   tiles-protocol-down-data-payload  { gotPicture, from, type, bytes }  or  { gotPicture, from, error }
//   tile → Raku   tiles-protocol-up-data-payload    { audio: "<blob cid>", from: "at://…" }                 (R3c-4)
//   Raku → tile   tiles-protocol-down-data-payload  { audioProgress, from, received, total }  (while it downloads)
//                                                   then { gotAudio, from, type, bytes }  or  { gotAudio, from, error }
// Raku answers every "ready" (a reloaded tile asks again) and each allowed get, and never sends anything else. Nothing
// a renderer sends can write to any account: it can ask to open an address, as if it had been typed, or to read a
// record named in the one it was given (or in that record's own account), so it can show names (the signpost
// renderer: claude/raku-renderer-tiles-plan.md, "The signpost renderer"), or to fetch a picture one of the records it
// was handed lists as a file, so it can show it (Places' tile card: claude/raku-places-card-plan.md, PC1 to PC6), or
// to fetch the song a song record lists as its audio, so it can play it (Tracks: claude/mixtape-3c-track-renderer-notes.md,
// R3c-4).

import { parseTarget } from './address.js';
import { RENDERERS, rendererFor, RENDER } from './config.js';

export const READY = 'tiles-protocol-up-data-ready';
export const UP = 'tiles-protocol-up-data-payload';
export const DOWN = 'tiles-protocol-down-data-payload';

/** What Raku hands a renderer: the record as stored, and where it came from (RT4). The same shape for every kind. */
export function recordPayload({ did, handle = null, collection, rkey, cid, value }) {
  return { uri: `at://${did}/${collection}/${rkey}`, cid: typeof cid === 'string' ? cid : null, did, handle: handle || null, collection, rkey, value };
}

/** A tab's title for a record: its own `name` when it has one (a common field; Raku reads nothing else), else its key. */
export function recordTitle(value, rkey) {
  const n = value && typeof value === 'object' && typeof value.name === 'string' ? value.name.replace(/\s+/g, ' ').trim() : '';
  return (n || rkey || 'Record').slice(0, 120);
}

/** The address a renderer asks Raku to open, or null when the request isn't one Raku takes (RT5: at:// only). */
export function readOpenRequest(payload, limits = RENDER) {
  const open = payload && typeof payload === 'object' ? payload.open : null;
  if (typeof open !== 'string' || open.length > limits.openMaxChars || !/^at:\/\/[^\s]+$/i.test(open)) return null;
  return open;
}

/**
 * What to do with an address a renderer asked for, as if it had been typed (RT5):
 *   { action: 'tab', uri }           a tile, an account, or a record with a renderer: a new Raku tab
 *   { action: 'record', target }     a record or collection with no renderer: the link message with the explorers
 *   { action: 'post', target }       a post: the link message, in the app chosen for posts
 *   { action: 'refuse', reason }     anything else
 */
export function openDecision(address, renderers = RENDERERS) {
  const r = parseTarget(address);
  if (!r.ok) return { action: 'refuse', reason: r.reason || "Raku can't read that address." };
  if (r.kind === 'tile' || r.kind === 'account') return { action: 'tab', uri: r.uri };
  if (r.kind === 'record' && rendererFor(r.collection, renderers)) return { action: 'tab', uri: r.uri };
  if (r.kind === 'record' || r.kind === 'collection') return { action: 'record', target: r };
  if (r.kind === 'post') return { action: 'post', target: r };
  return { action: 'refuse', reason: "Raku doesn't open that kind of address for a tile." };
}

/** The address a renderer asks Raku to read, or null when the request isn't one (SR6: an at:// address). */
export function readGetRequest(payload, limits = RENDER) {
  const get = payload && typeof payload === 'object' ? payload.get : null;
  if (typeof get !== 'string' || get.length > limits.openMaxChars || !/^at:\/\/[^\s]+$/i.test(get)) return null;
  return get;
}

// Every string in a record (a few levels deep, at most a few hundred): where SR6 looks for the addresses it names.
function stringsIn(value, out = new Set(), depth = 0) {
  if (out.size >= 500 || depth > 8) return out;
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsIn(v, out, depth + 1);
  return out;
}

/**
 * May a renderer that was given `given` ({ did, handle, value }) have Raku read `address`? (SR6) → the parsed target
 * ({ actor, collection, rkey, uri }) when yes, else null. Only a single record (not a collection, not an account),
 * and only one named in the given record exactly as written there, or one in the given record's own account.
 */
export function getTarget(address, given) {
  const r = parseTarget(address);
  if (!r.ok || !given) return null;
  const t = r.kind === 'tile' ? { ...r, collection: 'ing.dasl.masl' } : r.kind === 'record' || r.kind === 'post' ? r : null;
  if (!t || !t.collection || !t.rkey) return null;
  const sameAccount = t.actor === given.did || (!!given.handle && t.actor === given.handle);
  return sameAccount || stringsIn(given.value).has(address) ? t : null;
}

/** How many records one renderer tab may have Raku read (SR6): at most `getMax`, counted per load. */
export function createGetBudget({ max = RENDER.getMax } = {}) {
  let used = 0;
  return { take() { if (used >= max) return false; used += 1; return true; } };
}

/** A small gate per tab: one request at a time, none within `gapMs` of the last (RT5). */
export function createOpenGate({ gapMs = RENDER.gapMs, now = () => Date.now() } = {}) {
  let last = -Infinity;
  return { take() { const t = now(); if (t - last < gapMs) return false; last = t; return true; } };
}

// ---------- pictures (claude/raku-places-card-plan.md, PC6) ----------

/** The pictures Raku hands a renderer: no SVG (it can carry script), only these, checked from the bytes. */
export const PICTURE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** The picture a renderer asks for, { cid, from }, or null when the request isn't one (a blob cid, an at:// record). */
export function readPictureRequest(payload, limits = RENDER) {
  if (!payload || typeof payload !== 'object') return null;
  const { picture: cid, from } = payload;
  if (typeof cid !== 'string' || !/^b[a-z2-7]{20,120}$/.test(cid)) return null;
  if (typeof from !== 'string' || from.length > limits.openMaxChars || !/^at:\/\/[^\s]+$/i.test(from)) return null;
  return { cid, from };
}

// Every blob a record lists ({ $type: "blob", ref: { $link } }, as records come from getRecord), a few levels deep.
function blobsIn(value, out = new Set(), depth = 0) {
  if (out.size >= 500 || depth > 8 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const v of value) blobsIn(v, out, depth + 1); return out; }
  if (value.$type === 'blob' && value.ref && typeof value.ref.$link === 'string') out.add(value.ref.$link);
  for (const v of Object.values(value)) blobsIn(v, out, depth + 1);
  return out;
}

/**
 * May a renderer have Raku fetch this picture? (PC6) `seen` maps each record address Raku has handed this renderer in
 * this load (the record it was given, and each record a { get } sent back, by the address sent) to { did, value }.
 * → that record's { did } when `from` is one of them and it lists `cid` as a blob, else null.
 */
export function pictureSource(req, seen) {
  const rec = req && seen && typeof seen.get === 'function' ? seen.get(req.from) : null;
  return rec && blobsIn(rec.value).has(req.cid) ? { did: rec.did } : null;
}

// ---------- songs (claude/mixtape-3c-track-renderer-notes.md, R3c-4) ----------

/** The song files Raku hands a renderer, checked from the bytes (not the server's label: ours comes back "video/webm"). */
export const AUDIO_TYPES = Object.freeze(['audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/wav', 'audio/mp4']);

/** The song a renderer asks for, { cid, from }, or null when the request isn't one (a blob cid, an at:// record). */
export function readAudioRequest(payload, limits = RENDER) {
  if (!payload || typeof payload !== 'object') return null;
  const { audio: cid, from } = payload;
  if (typeof cid !== 'string' || !/^b[a-z2-7]{20,120}$/.test(cid)) return null;
  if (typeof from !== 'string' || from.length > limits.openMaxChars || !/^at:\/\/[^\s]+$/i.test(from)) return null;
  return { cid, from };
}

/**
 * May a renderer have Raku fetch this song? Only the audio file of the record it was handed (not a record a { get }
 * sent back, and no other file in it): `from` must be that record's address, as sent, and its `audioBlob` must be that
 * file. → { did, size } (size: as the record declares it, 0 when it doesn't), else null.
 */
export function audioSource(req, given) {
  if (!req || !given || req.from !== given.uri) return null;
  const b = given.value && typeof given.value === 'object' ? given.value.audioBlob : null;
  const cid = b && typeof b === 'object' && b.ref && typeof b.ref.$link === 'string' ? b.ref.$link : null;
  if (!cid || cid !== req.cid) return null;
  const size = Number(b.size);
  return { did: given.did, size: Number.isFinite(size) && size > 0 ? size : 0 };
}

/** A song file's kind from its first bytes, or null: MP3, WebM (Opus), Ogg, FLAC, WAV or M4A. */
export function sniffAudio(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';                       // "ID3"
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'audio/mpeg';        // an MPEG audio frame
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';      // EBML (WebM)
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';       // "OggS"
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return 'audio/flac';      // "fLaC"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return 'audio/wav';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {                          // "ftyp": an MP4 box
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(M4A |M4B |mp42|isom|mp41|dash)$/.test(brand)) return 'audio/mp4';
  }
  return null;
}

/** How many songs one renderer tab may have Raku fetch (R3c-4): at most `max`, counted per load. */
export function createAudioBudget({ max = RENDER.audioMax } = {}) {
  let used = 0;
  return { take() { if (used >= max) return false; used += 1; return true; } };
}

/** A progress reporter that speaks at most every `gapMs` (and always for the last bytes). */
export function createProgress(send, { gapMs = RENDER.progressMs, now = () => Date.now() } = {}) {
  let last = -Infinity;
  return (received, total) => {
    const t = now();
    if (t - last < gapMs && !(total && received >= total)) return;
    last = t;
    send(received, total);
  };
}
