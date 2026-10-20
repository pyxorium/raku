// The pinned loader for tables: loads a table's tiles, but only the exact versions on Raku's approved
// list (config.js TABLES: each tile's address and record CID; decided Oct 17: tables only for the owner's
// approved list, pinned by CID, re-approved after a republish).
//
// Adapted COPY of the site's src/sevenup/pinned-loader.js (and Daisy's): it refuses a tile whose record
// isn't the pinned one, and checks every file against its content address before handing it over. Here
// every request goes through Raku's careful fetching (net.js) and its account lookups (resolve.js).

import { fetchLimited, fetchJson } from '../net.js';
import { COLLECTION, LIMITS } from '../config.js';

const NOT_FOUND = { ok: false, status: 404, statusText: 'Not found' };
const MASL_HEADERS = ['content-disposition', 'content-encoding', 'content-language', 'content-security-policy', 'content-type',
  'link', 'permissions-policy', 'referrer-policy', 'service-worker-allowed', 'sourcemap', 'speculation-rules',
  'supports-loading-mode', 'x-content-type-options'];

function maslResponse(entry, body) {
  const headers = {};
  for (const k of MASL_HEADERS) if (typeof entry[k] !== 'undefined') headers[k] = entry[k];
  return { ok: true, status: 200, statusText: 'Ok', headers, body };
}

// A file's raw-codec CIDv1 ("bafkrei…"), as a PDS gives a blob.
export async function rawCid(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const all = new Uint8Array(4 + digest.length);
  all.set([0x01, 0x55, 0x12, 0x20], 0);
  all.set(digest, 4);
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'b', buffer = 0, bits = 0;
  for (const byte of all) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { out += A[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(buffer << (5 - bits)) & 31];
  return out;
}

export class TileChanged extends Error {}

// Tile: @dasl/tile-loader's Tile class, passed in (so this file runs in Node for the tests).
export function createPinnedLoader({ Tile, pins, resolver, fetchImpl = globalThis.fetch, onRefused = () => {} }) {
  const files = new Map();                     // cid → Promise<ArrayBuffer | null>, kept while Raku is open
  async function blob(pds, did, cid) {
    if (!files.has(cid)) {
      files.set(cid, (async () => {
        const r = await fetchLimited(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
          { timeoutMs: LIMITS.fileMs, maxBytes: 20 * 1024 * 1024, fetchImpl });
        if (!r.ok) return null;
        return (await rawCid(r.bytes)) === cid ? r.bytes.buffer : null;      // not the pinned bytes: refuse
      })().catch(() => null));
    }
    const buf = await files.get(cid);
    if (!buf) { files.delete(cid); return null; }
    return buf.slice(0);                       // a fresh copy each time (the loader may hand it on)
  }

  return {
    async load(url, mothership) {
      const pin = pins.find((p) => p.uri === url);
      if (!pin) return false;                  // only a table's own tiles
      const [did, collection, rkey] = url.replace(/^at:\/\//, '').split('/');
      if (collection !== COLLECTION) return false;
      const { pds } = await resolver.account(did);
      const r = await fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${COLLECTION}&rkey=${encodeURIComponent(rkey)}`,
        { timeoutMs: LIMITS.lookupMs, maxBytes: LIMITS.recordBytes, fetchImpl });
      if (!r.ok) return false;
      const body = r.json;
      if (!body || body.cid !== pin.cid || !body.value || !body.value.tile) {
        onRefused(url, body && body.cid);
        throw new TileChanged(`${url} has changed since Raku's table list was set up (record ${body && body.cid}, expected ${pin.cid}).`);
      }
      const manifest = body.value.tile;
      return new Tile(mothership, url, manifest, {
        async resolvePath(path) {
          const entry = manifest.resources && manifest.resources[path];
          const src = entry && entry.src;
          const cid = src && (src.$link || (src.ref && src.ref.$link));
          if (!cid) return NOT_FOUND;
          const data = await blob(pds, did, cid);
          return data ? maslResponse(entry, data) : NOT_FOUND;
        },
      });
    },
  };
}
