// Preparing a tile while its card shows (claude/raku-prepare-tiles-plan.md, PT1 to PT4): tile records kept 5 minutes,
// and the two sizes of early download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/resolve.js';
import { describeTile, createFileStore, createPathLoader } from '../src/tiles.js';
import { createPrefetcher, planFiles, pageFile } from '../src/prefetch.js';
import { LIMITS, PREPARE } from '../src/config.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
const PDS = 'https://pds.fakepds.net';
const KB = 1024;
const MB = 1024 * KB;
const CID = (n) => `bafkrei${String(n).padStart(52, 'a')}`;
const file = (n, size) => ({ src: { $type: 'blob', ref: { $link: CID(n) }, size }, 'content-type': 'text/plain' });
const tick = () => new Promise((ok) => setTimeout(ok, 0));
async function settle(times = 20) { for (let i = 0; i < times; i++) await tick(); }

/** A stand-in for the network: the DID document, tile records by rkey (null: deleted), blobs by CID. */
function world({ records = {}, blobs = {}, hold = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'plc.directory') return Response.json({ id: DID, alsoKnownAs: ['at://thunderbird.cafe'], service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] });
    if (u.pathname.endsWith('getRecord')) {
      const r = records[u.searchParams.get('rkey')];
      if (!r) return Response.json({ error: 'RecordNotFound' }, { status: 400 });
      return Response.json(r);
    }
    if (u.pathname.endsWith('getBlob')) {
      if (hold) await hold;
      const n = blobs[u.searchParams.get('cid')];
      return n == null ? new Response('?', { status: 404 }) : new Response(new Uint8Array(n));
    }
    return new Response('?', { status: 404 });
  };
  return { fetchImpl, calls, blobCalls: () => calls.filter((c) => c.includes('getBlob')), recordCalls: () => calls.filter((c) => c.includes('getRecord')) };
}
const tileRec = (rkey, resources, cid = 'bafyreione') => ({ uri: `at://${DID}/ing.dasl.masl/${rkey}`, cid, value: { $type: 'ing.dasl.masl', tile: { name: rkey, resources } } });
const uriOf = (rkey) => `at://${DID}/ing.dasl.masl/${rkey}`;

// ---------- PT1: records kept ----------
test('a tile record read for its card is kept 5 minutes, for opening from', async () => {
  let t = 1000;
  const w = world({ records: { lantern: tileRec('lantern', { '/': file(1, 10) }) } });
  const r = createResolver({ fetchImpl: w.fetchImpl, now: () => t });
  assert.equal(r.keptTileRecord(DID, 'lantern'), null);
  const [a, b] = await Promise.all([r.tileRecord(DID, 'lantern'), r.tileRecord(DID, 'lantern')]);
  assert.equal(a, b);
  assert.equal(w.recordCalls().length, 1, 'two reads at once ask once');
  assert.equal(r.keptTileRecord(DID, 'lantern').cid, 'bafyreione');
  t += 5 * 60 * 1000 - 1;
  assert.ok(r.keptTileRecord(DID, 'lantern'), 'still kept just under 5 minutes');
  t += 1;
  assert.equal(r.keptTileRecord(DID, 'lantern'), null, 'gone at 5 minutes');
  await r.tileRecord(DID, 'lantern');
  assert.equal(w.recordCalls().length, 2, 'tileRecord itself always asks the server');
});

test('a tile found deleted is dropped from what is kept; a changed one replaces it', async () => {
  const records = { z: tileRec('z', { '/': file(1, 10) }) };
  const w = world({ records });
  const r = createResolver({ fetchImpl: w.fetchImpl });
  await r.tileRecord(DID, 'z');
  records.z = tileRec('z', { '/': file(2, 10) }, 'bafyretwo');
  await r.tileRecord(DID, 'z');
  assert.equal(r.keptTileRecord(DID, 'z').cid, 'bafyretwo');
  delete records.z;
  await assert.rejects(r.tileRecord(DID, 'z'), (e) => e.code === 'not-found');
  assert.equal(r.keptTileRecord(DID, 'z'), null);
});

test("a tile read for a renderer (the Places card) is kept too; other records aren't", async () => {
  const w = world({ records: { p: tileRec('p', { '/': file(1, 10) }) } });
  const r = createResolver({ fetchImpl: w.fetchImpl });
  await r.record(DID, 'ing.dasl.masl', 'p');
  assert.equal(r.keptTileRecord(DID, 'p').cid, 'bafyreione');
  await r.record(DID, 'cafe.thunderbird.way.place', 'p');
  assert.equal(r.keptTileRecord(DID, 'p').cid, 'bafyreione');
});

test("describeTile carries the version read (PT5's check)", () => {
  assert.equal(describeTile(tileRec('x', { '/': file(1, 10) }, 'bafyrex')).cid, 'bafyrex');
  assert.equal(describeTile({ value: { tile: { resources: { '/': file(1, 10) } } } }).cid, null);
});

// ---------- PT2, PT4: which files ----------
test('an interest download: the page first, then the rest smallest first, within 2 MB', () => {
  const m = { resources: {
    '/': file(1, 40 * KB), '/index.html': file(1, 40 * KB),           // the same file twice: once
    '/big.js': file(2, 1500 * KB), '/a.css': file(3, 2 * KB), '/b.js': file(4, 300 * KB),
    '/c.png': file(5, 600 * KB), '/nosize.bin': { src: { $link: CID(6) } },
  } };
  assert.deepEqual(pageFile(m), { path: '/', cid: CID(1), size: 40 * KB });
  const plan = planFiles(m, 2 * MB);
  assert.deepEqual(plan.map((f) => f.path), ['/', '/a.css', '/b.js', '/c.png']);   // big.js would pass 2 MB
  assert.ok(plan.reduce((n, f) => n + f.size, 0) <= 2 * MB);
  assert.deepEqual(planFiles({ resources: { '/': file(1, 3 * MB) } }, 2 * MB), [], 'a page over the limit: nothing');
  assert.deepEqual(planFiles({ resources: { '/index.html': file(7, 5) } }, 2 * MB).map((f) => f.path), ['/index.html']);
});

function setup({ records, blobs, saveData = () => false, hidden = new Set(), hold = null, prepare = PREPARE } = {}) {
  const w = world({ records, blobs, hold });
  const resolver = createResolver({ fetchImpl: w.fetchImpl });
  const files = createFileStore({ fetchImpl: w.fetchImpl });
  const moderation = { isHidden: async (did, rkey) => hidden.has(rkey) };
  const pf = createPrefetcher({ files, resolver, moderation, saveData, prepare });
  return { w, resolver, files, pf };
}
const lantern = () => tileRec('lantern', { '/': file(1, 3 * KB), '/lantern.js': file(2, 154 * KB), '/s.css': file(3, 1 * KB), '/shot.png': file(4, 1900 * KB) });
const lanternBlobs = { [CID(1)]: 3 * KB, [CID(2)]: 154 * KB, [CID(3)]: 1 * KB, [CID(4)]: 1900 * KB };

test('seen: only the page; interest: the rest within the limit; opening then fetches nothing again', async () => {
  const { w, resolver, files, pf } = setup({ records: { lantern: lantern() }, blobs: lanternBlobs });
  await resolver.tileRecord(DID, 'lantern');                  // (the card read it)
  pf.seen(uriOf('lantern'));
  await settle();
  assert.equal(w.recordCalls().length, 1, 'the kept record is used: no second getRecord');
  assert.deepEqual(w.blobCalls().map((u) => new URL(u).searchParams.get('cid')), [CID(1)], 'seen: the page only');
  pf.seen(uriOf('lantern'));
  await settle();
  assert.equal(w.blobCalls().length, 1, 'seen twice: nothing more');
  pf.interest(uriOf('lantern'));
  await settle();
  const got = w.blobCalls().map((u) => new URL(u).searchParams.get('cid'));
  assert.deepEqual(got.slice(1).sort(), [CID(2), CID(3)].sort(), 'interest: the small files; the 1.9 MB picture would pass 2 MB');
  assert.equal(pf.state(uriOf('lantern')).done, 2);
  // Opening the tile: its files come from the kept store, and its own budget is charged for them then.
  const before = w.blobCalls().length;
  const d = describeTile(resolver.keptTileRecord(DID, 'lantern'));
  const loader = createPathLoader({ files, pds: PDS, did: DID, manifest: d.manifest });
  for (const p of ['/', '/lantern.js', '/s.css']) assert.equal((await loader.resolvePath(p)).ok, true);
  assert.equal(w.blobCalls().length, before, 'nothing fetched again on opening');
  assert.equal(loader.budget.left, LIMITS.maxBytes - (3 + 154 + 1) * KB, "the tile's own limit charged on opening");
});

test('a touch before the card was seen fetches page and rest at once; the record is read if not kept', async () => {
  const { w, pf } = setup({ records: { lantern: lantern() }, blobs: lanternBlobs });
  pf.interest(uriOf('lantern'));
  await settle();
  assert.equal(w.recordCalls().length, 1);
  assert.equal(w.blobCalls().length, 3);
});

test('never: over the ask size, unknown sizes, a hidden tile, not a tile, data saver', async () => {
  const big = tileRec('big', { '/': file(1, 10), '/huge.bin': file(2, LIMITS.askBytes) });
  const unknown = tileRec('unk', { '/': file(1, 10), '/x': { src: { $link: CID(9) } } });
  const flat = { uri: uriOf('flat'), cid: 'bafyflat', value: { name: 'not a tile' } };
  const { w, pf } = setup({ records: { big, unk: unknown, hid: lantern(), flat }, blobs: lanternBlobs, hidden: new Set(['hid']) });
  for (const k of ['big', 'unk', 'hid', 'flat']) pf.interest(uriOf(k));
  await settle();
  assert.equal(w.blobCalls().length, 0);
  for (const k of ['big', 'unk', 'hid', 'flat']) assert.equal(pf.state(uriOf(k)).skip, true, k);
  const s = setup({ records: { lantern: lantern() }, blobs: lanternBlobs, saveData: () => true });
  s.pf.seen(uriOf('lantern'));
  s.pf.interest(uriOf('lantern'));
  await settle();
  assert.equal(s.w.calls.length, 0, 'data saver: nothing at all');
});

test('at most 2 tiles at once; a touch goes first; of the cards merely seen, the newest first and only a few wait', async () => {
  let release;
  const hold = new Promise((ok) => { release = ok; });
  const records = {};
  const blobs = {};
  for (let i = 1; i <= 9; i++) { records[`t${i}`] = tileRec(`t${i}`, { '/': file(i, 100 + i) }); blobs[CID(i)] = 100 + i; }
  const { w, pf } = setup({ records, blobs, hold });
  for (let i = 1; i <= 8; i++) pf.seen(uriOf(`t${i}`));
  pf.interest(uriOf('t9'));
  await settle();
  assert.equal(pf.running, 2, 'two at once');
  assert.equal(pf.waiting, 1 + PREPARE.waiting, 'the touched one and a few seen ones wait');
  assert.equal(w.blobCalls().length, 2);
  release();
  await settle(60);
  const order = w.blobCalls().map((u) => Number(new URL(u).searchParams.get('cid').slice(-1)));
  assert.deepEqual(order.slice(0, 2).sort(), [1, 2], 'the first two seen started at once');
  assert.equal(order[2], 9, 'then the touched one');
  assert.deepEqual(order.slice(3), [8, 7, 6, 5], 'then the newest seen; t3 and t4 were dropped');
  assert.equal(pf.state(uriOf('t3')).done, 0);
});
