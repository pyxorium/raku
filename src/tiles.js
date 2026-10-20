// Raku's tile loader: finds a tile's record and serves its files to the tile, from the author's own
// account server.
//
// Adapted COPY of C:\thunderbird-cafe\pyxorium.github.io\src\lib\at-tile-loader.js (Oct 2026): the same
// record reading, file lookup and kept-files cache, with what Raku needs on top because its address box
// opens anyone's tile:
//   - every request goes through net.js (https only, no private addresses, time and size limits);
//   - the tile's size is read from its record before anything runs (the "Open anyway?" question);
//   - each tile may download at most LIMITS.maxBytes in all, whatever its record says.
// Everything that keeps tiles safe in the browser (the sandboxed frames, the loading server, its
// worker's no-network policy) is still the official @dasl/tile-loader and our loading server.

import { fetchLimited, NetError } from './net.js';
import { LIMITS } from './config.js';

const NOT_FOUND = { ok: false, status: 404, statusText: 'Not found' };
// Same header list as @dasl/tile-loader's lib/masl.js (not exported by the package).
const MASL_HEADERS = [
  'content-disposition', 'content-encoding', 'content-language', 'content-security-policy', 'content-type',
  'link', 'permissions-policy', 'referrer-policy', 'service-worker-allowed', 'sourcemap', 'speculation-rules',
  'supports-loading-mode', 'x-content-type-options',
];
function maslResponse(entry, body) {
  const headers = {};
  for (const k of MASL_HEADERS) if (typeof entry[k] !== 'undefined') headers[k] = entry[k];
  return { ok: true, status: 200, statusText: 'Ok', headers, body };
}

export const blobCidOf = (entry) => {
  const src = entry?.src;
  const cid = src && (src.$link || src.ref?.$link);
  return typeof cid === 'string' && /^[a-z0-9]{20,120}$/.test(cid) ? cid : null;
};

/** What a tile's record says about it: its name, files and declared size. */
export function describeTile(record) {
  const value = record?.value || {};
  const t = value.tile;
  if (!t || typeof t !== 'object' || !t.resources || typeof t.resources !== 'object') {
    return { ok: false, reason: "This record isn't a tile Raku can run (it has no files listed)." };
  }
  let declaredBytes = 0;
  let unknownSizes = 0;
  let files = 0;
  for (const entry of Object.values(t.resources)) {
    files++;
    const size = Number(entry?.src?.size);
    if (Number.isFinite(size) && size >= 0) declaredBytes += size;
    else unknownSizes++;
  }
  if (!t.resources['/'] && !t.resources['/index.html']) {
    return { ok: false, reason: 'This tile has no page to show (no "/" file).' };
  }
  const w = Number(t.sizing?.width);
  const h = Number(t.sizing?.height);
  return {
    ok: true,
    manifest: t,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 120) : 'Untitled tile',
    description: typeof t.description === 'string' ? t.description.slice(0, 300) : '',
    declaredBytes, unknownSizes, files,
    sizing: w >= 100 && w <= 4000 && h >= 100 && h <= 4000 ? { width: w, height: h } : null,
  };
}

/** Whether to open a tile straight away, ask first, or refuse, by its declared size. */
export function sizeVerdict(declaredBytes, limits = LIMITS) {
  if (declaredBytes > limits.maxBytes) return 'refuse';
  if (declaredBytes > limits.askBytes) return 'ask';
  return 'open';
}

// ---- files, shared and kept (as at-tile-loader.js) ----
export function createFileStore({ fetchImpl = globalThis.fetch, limits = LIMITS } = {}) {
  const kept = new Map();      // `${did} ${cid}` -> Uint8Array, least recently used first
  const pending = new Map();
  let keptBytes = 0;

  function keep(key, bytes) {
    if (kept.has(key)) return;
    kept.set(key, bytes);
    keptBytes += bytes.byteLength;
    for (const [k, b] of kept) {
      if (keptBytes <= limits.keepBytes || k === key) break;
      kept.delete(k);
      keptBytes -= b.byteLength;
    }
  }

  /** The bytes of one file; `budget` is the tile's remaining allowance (an object with .left). */
  async function get(pds, did, cid, budget) {
    const key = `${did} ${cid}`;
    let bytes = kept.get(key);
    if (bytes) {
      kept.delete(key);
      kept.set(key, bytes);
    } else {
      let p = pending.get(key);
      if (!p) {
        const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
        p = fetchLimited(url, { timeoutMs: limits.fileMs, maxBytes: Math.max(0, budget.left), fetchImpl })
          .then((r) => (r.ok ? r.bytes : null))
          .finally(() => pending.delete(key));
        pending.set(key, p);
      }
      bytes = await p;
      if (!bytes) return null;
      keep(key, bytes);
    }
    budget.left -= bytes.byteLength;
    return bytes.slice().buffer;   // a fresh copy each time (the loader may hand the buffer on)
  }

  return { get, forget() { kept.clear(); pending.clear(); keptBytes = 0; }, get keptBytes() { return keptBytes; } };
}

/**
 * A path loader for one tile: the object @dasl/tile-loader's Tile asks for each file.
 * onFile(path, ok, err) is told about every file (the tab's status line and, from stage 3, the message panel).
 */
export function createPathLoader({ files, pds, did, manifest, limits = LIMITS, onFile = () => {} }) {
  const budget = { left: limits.maxBytes };
  return {
    budget,
    async resolvePath(path) {
      const entry = manifest?.resources?.[path] || (path === '/' ? manifest?.resources?.['/index.html'] : null);
      const cid = blobCidOf(entry);
      if (!cid) { onFile(path, false, null); return NOT_FOUND; }
      try {
        const data = await files.get(pds, did, cid, budget);
        if (!data) { onFile(path, false, null); return NOT_FOUND; }
        onFile(path, true, null);
        return maslResponse(entry, data);
      } catch (err) {
        onFile(path, false, err instanceof NetError ? err : null);
        return NOT_FOUND;
      }
    },
  };
}
