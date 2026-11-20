// Saving a published tile as a .tile file (claude/tile-files-plan.md, part 2a): the tile open in a tab, its record and
// files (fetched as Raku runs it, most already kept), packed the way the Web Tile Foundry packs them (a CAR whose header
// is the manifest plus version 1 and empty roots, every file a raw sha-256 block), so the file opens wherever Foundry
// files do (Raku's "Open a tile file", Robin's CARTileLoader).
//
// The header also says where the tile came from, under `savedFrom`: its at:// address, its author's DID, the record's
// CID (the version saved), when, by what, and, when the author's server gave it, `proof`: the root of the signed proof
// from com.atproto.sync.getRecord (the record, the repo's signed commit and the path between them), carried as extra
// DAG-CBOR blocks. Nothing checks the proof yet (part 2b): a file saved here still opens as "author not verified".
//
// Pure apart from what's passed in (getFile, fetchProof), so the tests run it in Node.

import { base32Lower, decodeDagCbor, TILE_FILE_LIMITS } from './tile-file.js';

export const TILE_COLLECTION = 'ing.dasl.masl';
const CODEC_RAW = 0x55, CODEC_DAG_CBOR = 0x71, HASH_SHA256 = 0x12, SHA256_LEN = 32;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

// ---- DAG-CBOR (DRISL), as the Foundry's src/core/dagcbor.js, with floats; { $link } becomes a CID link (tag 42) ----
const te = new TextEncoder();
function base32Decode(text) {
  const out = []; let buf = 0, bits = 0;
  for (const ch of text) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error(`Not base32: ${JSON.stringify(ch)}`);
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { out.push((buf >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}
/** The bytes of a "b…" CIDv1 string. */
export function cidBytes(cid) {
  if (typeof cid !== 'string' || cid[0] !== 'b' || cid.length < 10) throw new Error(`Not a CIDv1: ${JSON.stringify(cid)}`);
  return base32Decode(cid.slice(1));
}
function head(major, n, out) {
  const m = major << 5;
  if (n < 24) out.push(m | n);
  else if (n < 0x100) out.push(m | 24, n);
  else if (n < 0x10000) out.push(m | 25, n >> 8, n & 0xff);
  else if (n < 0x100000000) out.push(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  else { const hi = Math.floor(n / 0x100000000), lo = n >>> 0; out.push(m | 27, (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff); }
}
const cmp = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
function enc(v, out) {
  if (v === null) return out.push(0xf6);
  if (v === true) return out.push(0xf5);
  if (v === false) return out.push(0xf4);
  if (typeof v === 'number') {
    if (Number.isSafeInteger(v)) return v >= 0 ? head(0, v, out) : head(1, -1 - v, out);
    if (!Number.isFinite(v)) throw new Error('A number in the record can\'t be written.');
    const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); out.push(0xfb, ...b); return undefined;
  }
  if (typeof v === 'string') { const b = te.encode(v); head(3, b.length, out); for (const x of b) out.push(x); return undefined; }
  if (v instanceof Uint8Array) { head(2, v.length, out); for (const x of v) out.push(x); return undefined; }
  if (Array.isArray(v)) { head(4, v.length, out); for (const x of v) enc(x, out); return undefined; }
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 1 && keys[0] === '$link' && typeof v.$link === 'string') {
      const link = cidBytes(v.$link); head(6, 42, out); head(2, link.length + 1, out); out.push(0); for (const x of link) out.push(x); return undefined;
    }
    const entries = keys.map((k) => [te.encode(k), v[k]]).sort((a, b) => a[0].length - b[0].length || cmp(a[0], b[0]));
    head(5, entries.length, out);
    for (const [k, x] of entries) { head(3, k.length, out); for (const c of k) out.push(c); enc(x, out); }
    return undefined;
  }
  throw new Error(`Can't write ${typeof v} into a tile file.`);
}
export function encodeDagCbor(value) { const out = []; enc(value, out); return new Uint8Array(out); }

export function varint(n) {
  const out = [];
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
  return new Uint8Array(out);
}

async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
/** The raw-codec CIDv1 of some bytes ("bafkrei…"), as a PDS gives a blob. */
export async function rawCid(bytes) {
  return 'b' + base32Lower(new Uint8Array([0x01, CODEC_RAW, HASH_SHA256, SHA256_LEN, ...(await sha256(bytes))]));
}

const blobCid = (src) => (src && typeof src === 'object' ? (typeof src.$link === 'string' ? src.$link : src.ref && typeof src.ref.$link === 'string' ? src.ref.$link : null) : null);

/** The manifest for the file's header: the record's `tile`, each src its file's plain address. */
export function fileManifestFromRecord(tile) {
  if (!tile || typeof tile !== 'object' || !tile.resources || typeof tile.resources !== 'object') throw new Error("This record isn't a tile.");
  const out = {};
  for (const [k, v] of Object.entries(tile)) if (k !== 'resources' && k !== 'version' && k !== 'roots' && k !== 'savedFrom') out[k] = v;
  out.resources = {};
  for (const [path, entry] of Object.entries(tile.resources)) {
    const cid = blobCid(entry && entry.src);
    if (!cid) throw new Error(`The tile doesn't say where ${path.slice(0, 60)} is.`);
    const e = {};
    for (const [k, v] of Object.entries(entry)) if (k !== 'src') e[k] = v;
    e.src = { $link: cid };
    out.resources[path] = e;
  }
  return out;
}

/** The blocks of a CAR (the proof from com.atproto.sync.getRecord): [{ cid, bytes, data }], each hash checked. */
export async function readCarBlocks(buf, { maxBlocks = 64 } = {}) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const readV = (at) => { let n = 0, mul = 1; for (let i = 0; i < 8; i++) { if (at >= u.length) throw new Error('cut short'); const b = u[at++]; n += (b & 0x7f) * mul; if (b < 0x80) return [n, at]; mul *= 0x80; } throw new Error('bad length'); };
  const [hlen, hs] = readV(0);
  if (hs + hlen > u.length) throw new Error('cut short');
  const out = [];
  let at = hs + hlen;
  while (at < u.length) {
    if (out.length >= maxBlocks) throw new Error('too many blocks');
    const [len, s] = readV(at);
    const end = s + len;
    if (end > u.length || len < 36) throw new Error('cut short');
    if (u[s] !== 0x01 || (u[s + 1] !== CODEC_DAG_CBOR && u[s + 1] !== CODEC_RAW) || u[s + 2] !== HASH_SHA256 || u[s + 3] !== SHA256_LEN) throw new Error('an address of another kind');
    const cidB = u.slice(s, s + 36), data = u.slice(s + 36, end);
    const got = await sha256(data);
    for (let i = 0; i < SHA256_LEN; i++) if (got[i] !== cidB[4 + i]) throw new Error("a block doesn't match its address");
    out.push({ cid: 'b' + base32Lower(cidB), bytes: cidB, data });
    at = end;
  }
  return out;
}
/** The root a CAR names (its header's first root), or null. */
export function carRoot(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let n = 0, mul = 1, at = 0;
  for (;;) { if (at >= u.length || at > 8) return null; const b = u[at++]; n += (b & 0x7f) * mul; if (b < 0x80) break; mul *= 0x80; }
  if (at + n > u.length || n > 4096) return null;
  try {
    const h = decodeDagCbor(u.subarray(at, at + n));
    const r = h && Array.isArray(h.roots) ? h.roots[0] : null;
    return r && typeof r.$link === 'string' ? r.$link : null;
  } catch { return null; }
}

/** "Cosmic Junkyard!" → "cosmic-junkyard.tile" (as the Foundry names its files). */
export function saveFileName(name) {
  const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return (base || 'tile') + '.tile';
}

/** What won't work from the file, when Raku can tell (D3): its ways; a game's saving. games(did, rkey) → [{ name }] */
export function savedNotes(manifest, { did, rkey, games = () => [] } = {}) {
  const notes = [];
  if (manifest && manifest.resources && manifest.resources['/ways.json']) notes.push("Its ways to other places won't work from the file.");
  if (games(did, rkey).length) notes.push("Saving runs won't work from the file.");
  return notes;
}

/** The whole file: header (manifest, version, roots, savedFrom), the tile's files, then the proof's blocks. */
export function encodeSavedTile({ manifest, files, savedFrom, proofBlocks = [] }) {
  const header = encodeDagCbor({ ...manifest, version: 1, roots: [], savedFrom });
  const parts = [varint(header.length), header];
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.cid)) continue;
    seen.add(f.cid);
    const c = cidBytes(f.cid);
    parts.push(varint(c.length + f.bytes.length), c, f.bytes);
  }
  for (const b of proofBlocks) {
    if (seen.has(b.cid)) continue;
    seen.add(b.cid);
    parts.push(varint(b.bytes.length + b.data.length), b.bytes, b.data);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Saves the tile open in a tab. source: { did, rkey, tile (the record's `tile`), recordCid, name }.
 * getFile(cid, budget) → ArrayBuffer | null (Raku's kept files). fetchProof() → ArrayBuffer | null (sync.getRecord's CAR).
 * onProgress(done, total). → { ok: true, bytes, fileName, totalBytes, proof: bool } or { ok: false, reason }
 */
export async function buildSavedTile({ source, getFile, fetchProof = async () => null, onProgress = () => {}, now = () => new Date(), limits = TILE_FILE_LIMITS }) {
  let manifest;
  try { manifest = fileManifestFromRecord(source.tile); } catch (err) { return { ok: false, reason: err.message }; }
  const entries = Object.entries(manifest.resources);
  if (!manifest.resources['/']) return { ok: false, reason: 'This tile has no page to show (no "/" file), so it can\'t be saved.' };
  if (entries.length > limits.maxFiles) return { ok: false, reason: `This tile has more than ${limits.maxFiles} files.` };
  const declared = Object.values(source.tile.resources).reduce((n, e) => n + (Number(e && e.src && e.src.size) || 0), 0);
  if (declared > limits.maxBytes) return { ok: false, reason: `This tile is too large to save as a file (more than ${Math.round(limits.maxBytes / 1024 / 1024)} MB).` };

  const cids = [...new Set(entries.map(([, e]) => e.src.$link))];
  const budget = { left: limits.maxBytes };
  const files = [];
  let done = 0, totalBytes = 0;
  onProgress(0, cids.length);
  for (const cid of cids) {
    let buf;
    try { buf = await getFile(cid, budget); } catch { buf = null; }
    if (!buf) return { ok: false, reason: "One of the tile's files couldn't be fetched just now. Try again in a moment." };
    const bytes = new Uint8Array(buf);
    if ((await rawCid(bytes)) !== cid) return { ok: false, reason: "One of the tile's files didn't match its address, so it wasn't saved." };
    totalBytes += bytes.length;
    if (totalBytes > limits.maxBytes) return { ok: false, reason: `This tile is too large to save as a file (more than ${Math.round(limits.maxBytes / 1024 / 1024)} MB).` };
    files.push({ cid, bytes });
    onProgress(++done, cids.length);
  }

  // The signed proof, when the author's server gives it, and it holds this very record (else the file goes without).
  let proofBlocks = [], proofRoot = null;
  try {
    const car = await fetchProof();
    if (car) {
      const blocks = await readCarBlocks(car);
      const root = carRoot(car);
      if (root && blocks.some((b) => b.cid === root) && blocks.some((b) => b.cid === source.recordCid)) { proofBlocks = blocks; proofRoot = root; }
    }
  } catch { /* no proof: the file is still the tile */ }

  const savedFrom = {
    uri: `at://${source.did}/${TILE_COLLECTION}/${source.rkey}`,
    did: source.did,
    ...(typeof source.recordCid === 'string' && source.recordCid.startsWith('b') ? { record: { $link: source.recordCid } } : {}),
    ...(proofRoot ? { proof: { $link: proofRoot } } : {}),
    savedAt: now().toISOString(),
    savedBy: 'Raku',
  };
  const bytes = encodeSavedTile({ manifest, files, savedFrom, proofBlocks });
  return { ok: true, bytes, fileName: saveFileName(source.name || manifest.name), totalBytes, proof: !!proofRoot };
}

/** Hands the file to the browser as a download (browser only). */
export function downloadFile(bytes, fileName, doc = globalThis.document) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = doc.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener';
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
