// Opening a .tile file (claude/tile-files-plan.md, part 1): reads a tile saved as a file, a "CARball" as the tiles spec
// describes it (https://dasl.ing/tiles.html, "Tiles in CAR"; https://dasl.ing/masl.html):
//   - a CAR, version 1, whose header is the tile's manifest (MASL, bundle mode) plus CAR's own `version: 1` and `roots`;
//   - every one of the tile's files as a block after the header, found by the address (CID) in its `resources` entry.
// The Web Tile Foundry's "Save as .tile" (v0.39.0) writes them; so do Robin's own tools (atile bundle).
//
// A file is a stranger's bytes, so this reads them warily, and Raku runs it in a worker (tile-file-worker.js), off the
// page that holds the sign-in:
//   - a size limit before anything is read, and limits on the header (its size, how deep it nests, how many files);
//   - every block's bytes are checked against the sha-256 in its address: a file whose contents don't match is refused;
//   - only the plain kind of file address (CIDv1, raw, sha-256: "bafkrei…", as atproto blobs) is accepted;
//   - the manifest must have a name, a "/" page and a file for every path it lists; paths must start with "/", and none
//     may sit under the loading server's own /.well-known/web-tiles/.
// Nothing here touches the network. Pure: runs the same in a worker, the page and Node (the tests).

export const TILE_FILE_LIMITS = Object.freeze({
  maxBytes: 100 * 1024 * 1024,     // a whole .tile file (the Foundry's biggest type, Mixtape, stays well under this)
  maxHeaderBytes: 1024 * 1024,     // the manifest
  maxFiles: 2000,                  // paths in the manifest, and blocks in the file
  maxDepth: 24,                    // how deep the manifest may nest
  maxPathChars: 1024,
});

const RESERVED = '/.well-known/web-tiles/';
const CID_RAW = 0x55, HASH_SHA256 = 0x12, SHA256_LEN = 32;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export class TileFileError extends Error {
  constructor(message) { super(message); this.name = 'TileFileError'; }
}
const refuse = (message) => { throw new TileFileError(message); };

export function base32Lower(bytes) {
  let out = '', buf = 0, bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(buf >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

function readVarint(buf, at, what) {
  let n = 0, mul = 1;
  for (let i = 0; i < 8; i++) {
    if (at >= buf.length) refuse(`The file ends in the middle of ${what}.`);
    const b = buf[at++];
    n += (b & 0x7f) * mul;
    if (b < 0x80) return [n, at];
    mul *= 0x80;
  }
  return refuse(`The file has a length that's too long to be real (${what}).`);
}

// ---- the manifest: DAG-CBOR (DRISL), definite lengths only, tag 42 for addresses ----
function decodeHeader(buf, limits) {
  let at = 0;
  const td = new TextDecoder('utf-8', { fatal: true });
  let items = 0;
  function need(n) { if (at + n > buf.length) refuse("The tile file's manifest is cut short."); }
  function arg(info) {
    if (info < 24) return info;
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : refuse("The tile file's manifest isn't written the usual way.");
    need(len);
    let n = 0;
    for (let i = 0; i < len; i++) n = n * 256 + buf[at++];
    if (!Number.isSafeInteger(n)) refuse("The tile file's manifest has a number that's too large.");
    return n;
  }
  function item(depth) {
    if (depth > limits.maxDepth) refuse("The tile file's manifest nests too deep.");
    if (++items > limits.maxFiles * 16) refuse("The tile file's manifest is too long.");
    need(1);
    const first = buf[at++];
    const major = first >> 5, info = first & 31;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 27) { need(8); const v = new DataView(buf.buffer, buf.byteOffset + at, 8).getFloat64(0); at += 8; return v; }
      return refuse("The tile file's manifest has a value Raku doesn't read.");
    }
    const n = arg(info);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { need(n); const b = buf.slice(at, at + n); at += n; return b; }
    if (major === 3) {
      need(n);
      let s;
      try { s = td.decode(buf.subarray(at, at + n)); } catch { refuse("The tile file's manifest has text that isn't UTF-8."); }
      at += n;
      return s;
    }
    if (major === 4) {
      if (n > limits.maxFiles * 4) refuse("The tile file's manifest has a list that's too long.");
      const out = [];
      for (let i = 0; i < n; i++) out.push(item(depth + 1));
      return out;
    }
    if (major === 5) {
      if (n > limits.maxFiles + 64) refuse("The tile file's manifest has too many entries.");
      const out = Object.create(null);
      for (let i = 0; i < n; i++) {
        const k = item(depth + 1);
        if (typeof k !== 'string') refuse("The tile file's manifest has a name that isn't text.");
        if (k in out) refuse("The tile file's manifest names something twice.");
        out[k] = item(depth + 1);
      }
      return out;
    }
    if (major === 6) {
      if (n !== 42) refuse("The tile file's manifest has a kind of value Raku doesn't read.");
      const b = item(depth + 1);
      if (!(b instanceof Uint8Array) || b.length < 2 || b[0] !== 0x00) refuse("The tile file's manifest has a file address Raku can't read.");
      return { $link: 'b' + base32Lower(b.subarray(1)) };
    }
    return refuse("The tile file's manifest isn't written the usual way.");
  }
  const value = item(0);
  if (at !== buf.length) refuse("The tile file's manifest has something extra after it.");
  return value;
}

const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);

// Plain objects again (the decoder makes prototype-free ones, so a key like "__proto__" is just a key).
function toPlain(v) {
  if (Array.isArray(v)) return v.map(toPlain);
  if (v instanceof Uint8Array) return v;
  if (plain(v)) { const o = {}; for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: toPlain(v[k]), enumerable: true, writable: true, configurable: true }); return o; }
  return v;
}

function checkManifest(m, limits) {
  if (!plain(m)) refuse("This file doesn't start with a tile's manifest.");
  if (m.version !== 1) refuse("This isn't a tile file Raku can read (its CAR version isn't 1).");
  if (m.roots !== undefined && !Array.isArray(m.roots)) refuse("This tile file's header is malformed (roots).");
  if (typeof m.name !== 'string' || !m.name.trim()) refuse("This tile file has no name.");
  if (!plain(m.resources)) refuse("This tile file lists no files.");
  const paths = Object.keys(m.resources);
  if (paths.length > limits.maxFiles) refuse(`This tile file lists more than ${limits.maxFiles} files.`);
  if (!m.resources['/']) refuse('This tile file has no page to show (no "/" file).');
  for (const path of paths) {
    if (!path.startsWith('/') || path.length > limits.maxPathChars) refuse(`This tile file has a path Raku won't use (${path.slice(0, 60)}).`);
    if (path.startsWith(RESERVED)) refuse(`This tile file has a file under ${RESERVED}, which belongs to the loading server.`);
    const e = m.resources[path];
    if (!plain(e) || !plain(e.src) || typeof e.src.$link !== 'string') refuse(`This tile file doesn't say where ${path} is.`);
    if (e['content-type'] !== undefined && typeof e['content-type'] !== 'string') refuse(`This tile file has a strange type for ${path}.`);
  }
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Reads a .tile file's bytes. → { ok: true, name, manifest, files: Map<path, Uint8Array>, totalBytes }
 * or { ok: false, reason } (a sentence to show). `manifest` is the header without CAR's version and roots, with each
 * file's src as { $link: "bafkrei…" }.
 */
export async function readTileFile(input, limits = TILE_FILE_LIMITS) {
  try {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (buf.length > limits.maxBytes) refuse(`This file is too large to open (more than ${Math.round(limits.maxBytes / 1024 / 1024)} MB).`);
    if (buf.length < 4) refuse("This file is empty, or isn't a tile file.");
    const [hlen, hstart] = readVarint(buf, 0, 'its header');
    if (hlen > limits.maxHeaderBytes) refuse("This file's header is too large for a tile file.");
    if (hstart + hlen > buf.length) refuse("This isn't a tile file (or it's cut short).");
    const head = toPlain(decodeHeader(buf.subarray(hstart, hstart + hlen), limits));
    checkManifest(head, limits);

    const blocks = new Map();
    let at = hstart + hlen, count = 0;
    while (at < buf.length) {
      if (++count > limits.maxFiles) refuse(`This tile file has more than ${limits.maxFiles} files inside.`);
      const [len, s] = readVarint(buf, at, 'a file');
      const end = s + len;
      if (end > buf.length || len < 4) refuse('This tile file is cut short, or damaged.');
      // A file's address: CIDv1, raw, sha-256 (each part a one-byte varint here).
      if (buf[s] !== 0x01 || buf[s + 1] !== CID_RAW || buf[s + 2] !== HASH_SHA256 || buf[s + 3] !== SHA256_LEN || len < 4 + SHA256_LEN) {
        refuse("This tile file has a file stored a way Raku doesn't accept (only plain sha-256 file addresses).");
      }
      const digest = buf.subarray(s + 4, s + 4 + SHA256_LEN);
      const data = buf.subarray(s + 4 + SHA256_LEN, end);
      const got = await sha256(data);
      for (let i = 0; i < SHA256_LEN; i++) if (got[i] !== digest[i]) refuse("A file inside this tile doesn't match its address: the tile file has been changed or damaged.");
      blocks.set('b' + base32Lower(buf.subarray(s, s + 4 + SHA256_LEN)), data);
      at = end;
    }

    const { version, roots, ...manifest } = head;
    const files = new Map();
    let totalBytes = 0;
    for (const [path, entry] of Object.entries(manifest.resources)) {
      const data = blocks.get(entry.src.$link);
      if (!data) refuse(`This tile file lists ${path.slice(0, 60)}, but the file isn't inside.`);
      files.set(path, data);
      totalBytes += data.length;
    }
    return { ok: true, name: manifest.name.trim().slice(0, 120), manifest, files, totalBytes };
  } catch (err) {
    if (err instanceof TileFileError) return { ok: false, reason: err.message };
    return { ok: false, reason: "This file couldn't be read as a tile file." };
  }
}

// ---- for the page ----

// Same header list as @dasl/tile-loader's lib/masl.js (as tiles.js).
const MASL_HEADERS = [
  'content-disposition', 'content-encoding', 'content-language', 'content-security-policy', 'content-type',
  'link', 'permissions-policy', 'referrer-policy', 'service-worker-allowed', 'sourcemap', 'speculation-rules',
  'supports-loading-mode', 'x-content-type-options',
];
const NOT_FOUND = { ok: false, status: 404, statusText: 'Not found' };

/** The path loader @dasl/tile-loader's Tile asks for each file, from a file already read. onFile(path, ok) as tiles.js. */
export function filePathLoader({ manifest, files }, onFile = () => {}) {
  return {
    async resolvePath(path) {
      const entry = manifest.resources?.[path];
      const data = entry && files.get(path);
      if (!data) { onFile(path, false); return NOT_FOUND; }
      const headers = {};
      for (const k of MASL_HEADERS) if (typeof entry[k] === 'string') headers[k] = entry[k];
      onFile(path, true);
      return { ok: true, status: 200, statusText: 'Ok', headers, body: data.slice() };
    },
  };
}

/** Tiles opened from files while Raku is open (they're gone after a reload: Raku keeps no copy yet). */
export function createOpenedFiles({ max = 12, newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16) } = {}) {
  const opened = new Map();
  return {
    add(entry) {
      const id = newId();
      opened.set(id, entry);
      while (opened.size > max) opened.delete(opened.keys().next().value);
      return id;
    },
    get: (id) => opened.get(id) || null,
    get size() { return opened.size; },
  };
}

/** Whether something dragged over Raku is (or holds) a file. */
export const draggingFiles = (dt) => !!dt && Array.from(dt.types || []).includes('Files');

/**
 * Reads a picked or dropped File in a worker (tile-file-worker.js). → the same answer as readTileFile, with `files` as a
 * Map again. makeWorker() returns a new Worker; each file gets its own, ended afterwards.
 */
export async function readTileFileInWorker(file, { makeWorker, limits = TILE_FILE_LIMITS, timeoutMs = 60000 } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') return { ok: false, reason: "That isn't a file Raku can open." };
  if (file.size > limits.maxBytes) return { ok: false, reason: `This file is too large to open (more than ${Math.round(limits.maxBytes / 1024 / 1024)} MB).` };
  let worker;
  try { worker = makeWorker(); } catch { return { ok: false, reason: "Raku couldn't start reading the file in this browser." }; }
  try {
    const bytes = await file.arrayBuffer();
    const answer = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, reason: 'Reading the file took too long.' }), timeoutMs);
      worker.onmessage = (ev) => { clearTimeout(t); resolve(ev.data || { ok: false, reason: "This file couldn't be read as a tile file." }); };
      worker.onerror = () => { clearTimeout(t); resolve({ ok: false, reason: "This file couldn't be read as a tile file." }); };
      worker.postMessage({ id: 1, bytes }, [bytes]);
    });
    if (!answer.ok) return { ok: false, reason: String(answer.reason || "This file couldn't be read as a tile file.") };
    return { ok: true, name: answer.name, manifest: answer.manifest, files: new Map(answer.files.map(([p, d]) => [p, new Uint8Array(d)])), totalBytes: answer.totalBytes };
  } finally {
    worker.terminate();
  }
}
