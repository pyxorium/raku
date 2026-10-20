// Accounts: handle → DID, DID → its document (handle, PDS), and a tile's record.
// Every lookup goes through net.js (https, public hosts, time and size limits). Answers are kept for
// a few minutes while Raku is open; failures aren't kept.

import { fetchJson, NetError } from './net.js';
import { HANDLE_RESOLVER, PLC_DIRECTORY, COLLECTION, LIMITS } from './config.js';
import { DID_PLC, DID_WEB } from './address.js';

const KEEP_MS = 5 * 60 * 1000;

export function createResolver({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const kept = new Map();   // key -> { at, value }
  const pending = new Map();

  function remember(key, make) {
    const k = kept.get(key);
    if (k && now() - k.at < KEEP_MS) return Promise.resolve(k.value);
    if (pending.has(key)) return pending.get(key);
    const p = make().then((value) => { kept.set(key, { at: now(), value }); return value; })
      .finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }
  const opts = (maxBytes = LIMITS.docBytes) => ({ timeoutMs: LIMITS.lookupMs, maxBytes, fetchImpl });

  function didDocumentUrl(did) {
    if (DID_PLC.test(did)) return `${PLC_DIRECTORY}/${did}`;
    if (DID_WEB.test(did)) return `https://${did.slice(8).replace(/%3a/i, ':')}/.well-known/did.json`;
    throw new NetError('bad-did', `Raku can't look up ${did}.`);
  }

  /** handle → DID */
  function resolveHandle(handle) {
    return remember(`h:${handle}`, async () => {
      const r = await fetchJson(`${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, opts());
      const did = r.json?.did;
      if (!r.ok || typeof did !== 'string' || !(DID_PLC.test(did) || DID_WEB.test(did))) {
        throw new NetError('no-handle', `Couldn't find the account @${handle}.`);
      }
      return did;
    });
  }

  /** DID → { did, handle (unchecked), pds } */
  function account(did) {
    return remember(`d:${did}`, async () => {
      const r = await fetchJson(didDocumentUrl(did), opts());
      const doc = r.json;
      if (!r.ok || !doc || doc.id !== did) throw new NetError('no-account', `Couldn't look up the account ${did}.`);
      const handle = (doc.alsoKnownAs || []).find((x) => typeof x === 'string' && x.startsWith('at://'))?.slice(5) || null;
      const svc = (doc.service || []).find((s) => s && (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`));
      const pds = typeof svc?.serviceEndpoint === 'string' ? svc.serviceEndpoint.replace(/\/+$/, '') : null;
      if (!pds) throw new NetError('no-pds', `The account ${did} names no server.`);
      return { did, handle, pds };
    });
  }

  /** The handle shown for an account: only when it points back to the same DID. */
  async function checkedHandle(did) {
    try {
      const a = await account(did);
      if (!a.handle) return null;
      const back = await resolveHandle(a.handle);
      return back === did ? a.handle : null;
    } catch {
      return null;
    }
  }

  /** at:// actor (DID or handle) → DID */
  async function didFor(actor) {
    return actor.startsWith('did:') ? actor : resolveHandle(actor);
  }

  /** A tile's record. → { uri, cid, value } ; NetError 'not-found' when there's none. */
  async function tileRecord(did, rkey) {
    const { pds } = await account(did);
    const url = `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${COLLECTION}&rkey=${encodeURIComponent(rkey)}`;
    const r = await fetchJson(url, { timeoutMs: LIMITS.lookupMs, maxBytes: LIMITS.recordBytes, fetchImpl });
    if (r.status === 400 || r.status === 404) throw new NetError('not-found', "There's no tile at that address (it may have been deleted).");
    if (!r.ok || !r.json?.value) throw new NetError('upstream', "The tile's account server didn't answer properly.");
    return r.json;
  }

  return { resolveHandle, account, checkedHandle, didFor, tileRecord, didDocumentUrl };
}
