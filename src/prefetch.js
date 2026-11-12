// Preparing a tile while its card shows (claude/raku-prepare-tiles-plan.md, PT2 to PT4, decided Nov 11 2026).
//
// Two sizes of early download, asked for by the cards (cards.js prepareCard):
//   - seen(uri): the card has been on screen a moment: fetch only the tile's page ("/", or "/index.html");
//   - interest(uri): the pointer rests on the card, or it is touched: fetch the rest of its files, smallest first,
//     up to PREPARE.bytes in all (the page counts too).
// The files go into Raku's kept-files store (tiles.js createFileStore), so opening the tile takes them from there; each
// early download spends a throwaway allowance, and the tile's own download limit is charged only when it's opened (as
// for any kept file). Nothing runs and nothing on screen changes.
//
// Never: a tile Raku doesn't show (moderation), one that isn't a tile it can run, one over LIMITS.askBytes, and nothing
// at all with the browser's data saver on. At most PREPARE.atOnce tiles at a time; a touch or a resting pointer goes
// first; of the cards merely seen, the newest go first and only a few wait (older ones are dropped, so scrolling never
// piles up downloads that slow Raku's own screens). No DOM here: tested in Node (test/prefetch.test.mjs).

import { LIMITS, PREPARE } from './config.js';
import { describeTile, blobCidOf } from './tiles.js';
import { parseAddress } from './address.js';

const SEEN = 1;
const INTEREST = 2;

/** The tile's page: its first file to fetch. → { path, cid, size } or null */
export function pageFile(manifest) {
  for (const path of ['/', '/index.html']) {
    const entry = manifest?.resources?.[path];
    const cid = blobCidOf(entry);
    if (cid) return { path, cid, size: sizeOf(entry) };
  }
  return null;
}
function sizeOf(entry) {
  const n = Number(entry?.src?.size);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Which of a tile's files an interest download fetches: the page first, then the others smallest first, while the
 * total stays within `bytes`. Files whose size the record doesn't give are left for opening; a file shared by two paths
 * is fetched once. → [{ path, cid, size }]
 */
export function planFiles(manifest, bytes) {
  const page = pageFile(manifest);
  if (!page || page.size == null || page.size > bytes) return [];
  const out = [page];
  const have = new Set([page.cid]);
  let total = page.size;
  const rest = [];
  for (const [path, entry] of Object.entries(manifest.resources || {})) {
    const cid = blobCidOf(entry);
    const size = sizeOf(entry);
    if (!cid || size == null || have.has(cid)) continue;
    have.add(cid);
    rest.push({ path, cid, size });
  }
  rest.sort((a, b) => a.size - b.size || (a.path < b.path ? -1 : 1));
  for (const f of rest) {
    if (total + f.size > bytes) break;      // (smallest first: nothing after this one fits either)
    out.push(f);
    total += f.size;
  }
  return out;
}

/**
 * files: createFileStore(); resolver: createResolver(); moderation: { isHidden(did, rkey) } (optional).
 * saveData(): whether the browser asks to save data (navigator.connection.saveData by default).
 */
export function createPrefetcher({ files, resolver, moderation = null, limits = LIMITS, prepare = PREPARE,
  saveData = () => !!globalThis.navigator?.connection?.saveData } = {}) {
  const tiles = new Map();     // uri -> { want, done, running, queued, skip, target }
  const hot = [];              // interest: first come, first served
  const seenList = [];         // seen: newest first served, oldest dropped
  let running = 0;

  function stateOf(uri) {
    let st = tiles.get(uri);
    if (!st) { st = { want: 0, done: 0, running: false, queued: false, skip: false, target: null }; tiles.set(uri, st); }
    return st;
  }

  function ask(uri, level) {
    if (typeof uri !== 'string' || !uri) return;
    if (saveData()) return;
    const st = stateOf(uri);
    if (st.skip || st.done >= level) return;
    st.want = Math.max(st.want, level);
    if (st.running) return;                     // (it looks again when it finishes)
    if (st.queued) {
      if (level === INTEREST) {                 // a seen card touched or pointed at: to the front
        const i = seenList.indexOf(uri);
        if (i >= 0) { seenList.splice(i, 1); hot.push(uri); }
      }
      pump();
      return;
    }
    st.queued = true;
    if (level === INTEREST) hot.push(uri);
    else {
      seenList.push(uri);
      while (seenList.length > prepare.waiting) stateOf(seenList.shift()).queued = false;
    }
    pump();
  }

  function pump() {
    while (running < prepare.atOnce && (hot.length || seenList.length)) {
      const uri = hot.length ? hot.shift() : seenList.pop();
      const st = stateOf(uri);
      st.queued = false;
      if (st.skip || st.done >= st.want) continue;
      st.running = true;
      running++;
      run(uri, st).catch(() => { st.skip = true; })    // (a failed lookup isn't retried; opening tries again anyway)
        .finally(() => {
          st.running = false;
          running--;
          if (!st.skip && st.want > st.done) ask(uri, st.want);
          pump();
        });
    }
  }

  async function locate(uri, st) {
    if (st.target) return st.target;
    const a = parseAddress(uri);
    if (!a.ok) return null;
    const did = await resolver.didFor(a.actor);
    if (moderation && await moderation.isHidden(did, a.rkey)) return null;
    const record = resolver.keptTileRecord?.(did, a.rkey) || await resolver.tileRecord(did, a.rkey);
    const d = describeTile(record);
    if (!d.ok || d.unknownSizes || d.declaredBytes > limits.askBytes) return null;
    const { pds } = await resolver.account(did);
    st.target = { did, pds, manifest: d.manifest };
    return st.target;
  }

  async function run(uri, st) {
    const want = st.want;
    const t = await locate(uri, st);
    if (!t) { st.skip = true; return; }
    if (saveData()) { st.done = want; return; }
    const list = want >= INTEREST ? planFiles(t.manifest, prepare.bytes) : [pageFile(t.manifest)].filter((f) => f && f.size != null && f.size <= prepare.bytes);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const f = list[next++];
        try { await files.get(t.pds, t.did, f.cid, { left: prepare.bytes }); } catch { /* left for opening */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(prepare.filesAtOnce, list.length) }, worker));
    st.done = want;
  }

  return {
    seen: (uri) => ask(uri, SEEN),
    interest: (uri) => ask(uri, INTEREST),
    /** (tests) what's known of one tile */
    state: (uri) => { const st = tiles.get(uri); return st ? { want: st.want, done: st.done, running: st.running, queued: st.queued, skip: st.skip } : null; },
    get running() { return running; },
    get waiting() { return hot.length + seenList.length; },
  };
}
