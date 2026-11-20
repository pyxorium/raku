// Saving a published tile as a file (claude/tile-files-plan.md, part 2a): src/tile-save.js packs a tile's record and
// files the Foundry's way, records where it came from, carries the signed proof unchecked, and the file opens again with
// Raku's own reader (src/tile-file.js), every byte the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { buildSavedTile, fileManifestFromRecord, encodeDagCbor, readCarBlocks, carRoot, savedNotes, saveFileName, rawCid, varint } from '../src/tile-save.js';
import { readTileFile, base32Lower } from '../src/tile-file.js';

const te = new TextEncoder();
const sha = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const cbCid = (bytes) => new Uint8Array([0x01, 0x71, 0x12, 0x20, ...sha(bytes)]);
const str = (cid) => 'b' + base32Lower(cid);
const PAGE = te.encode('<!doctype html><title>t</title><h1>A saved tile</h1>');
const PIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';

async function tileRecord() {
  const blob = async (bytes, mimeType) => ({ $type: 'blob', ref: { $link: await rawCid(bytes) }, mimeType, size: bytes.length });
  return {
    name: 'Cosmic Junkyard!', description: 'A game.', icons: [{ src: '/icon.png' }], sizing: { width: 720, height: 540.5 },
    resources: {
      '/': { src: await blob(PAGE, 'text/html'), 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" },
      '/icon.png': { src: await blob(PIC, 'image/png'), 'content-type': 'image/png' },
      '/banner.png': { src: await blob(PIC, 'image/png'), 'content-type': 'image/png' },
    },
  };
}
const byCid = async () => new Map([[await rawCid(PAGE), PAGE], [await rawCid(PIC), PIC]]);

// A stand-in for com.atproto.sync.getRecord's answer: a CAR rooted at a "commit" block, holding the record's block.
function proofCar(recordBytes, { withRecord = true } = {}) {
  const commit = encodeDagCbor({ did: DID, version: 3, data: { $link: str(cbCid(te.encode('mst'))) }, sig: new Uint8Array([1, 2, 3]) });
  const blocks = [[cbCid(commit), commit], ...(withRecord ? [[cbCid(recordBytes), recordBytes]] : [])];
  const header = encodeDagCbor({ roots: [{ $link: str(cbCid(commit)) }], version: 1 });
  const parts = [...varint(header.length), ...header];
  for (const [c, d] of blocks) parts.push(...varint(c.length + d.length), ...c, ...d);
  return { car: new Uint8Array(parts).buffer, commitCid: str(cbCid(commit)) };
}

test('DAG-CBOR as the Foundry writes it: canonical key order, whole numbers, floats, links', () => {
  const hex = (u) => Buffer.from(u).toString('hex');
  assert.equal(hex(encodeDagCbor({ bb: 1, a: 2, c: 3 })), 'a3616102616303626262' + '01');
  assert.equal(hex(encodeDagCbor(540.5)), 'fb4080e40000000000');
  const l = encodeDagCbor({ $link: 'bafkreidtr5uxobcoz6uxnjjmvtdmnwdt462624wbzxne6tvqxzdquv7xsy' });
  assert.equal(hex(l.slice(0, 5)), 'd82a582500');
});

test('the manifest from a record: each src becomes its file\'s plain address; everything else kept', async () => {
  const m = fileManifestFromRecord(await tileRecord());
  assert.deepEqual(m.resources['/'].src, { $link: await rawCid(PAGE) });
  assert.equal(m.resources['/']['content-security-policy'], "default-src 'self'");
  assert.deepEqual(m.sizing, { width: 720, height: 540.5 });
  assert.throws(() => fileManifestFromRecord({ resources: { '/': { src: {} } } }), /doesn't say where/);
});

test('a saved tile opens again in Raku: the same files, its source recorded, the proof carried', async () => {
  const tile = await tileRecord();
  const recordBytes = te.encode('the record as the PDS holds it');
  const recordCid = str(cbCid(recordBytes));
  const { car, commitCid } = proofCar(recordBytes);
  const files = await byCid();
  const asked = [];
  const r = await buildSavedTile({
    source: { did: DID, rkey: '3mwvoqidyqd24', tile, recordCid, name: 'Cosmic Junkyard!' },
    getFile: async (cid) => { asked.push(cid); return files.get(cid).slice().buffer; },
    fetchProof: async () => car,
    now: () => new Date('2026-11-20T12:00:00Z'),
  });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.fileName, 'cosmic-junkyard.tile');
  assert.equal(r.proof, true);
  assert.equal(asked.length, 2, 'the icon and the banner share one file');
  const back = await readTileFile(r.bytes);
  assert.equal(back.ok, true, back.reason);
  assert.deepEqual(back.files.get('/'), PAGE);
  assert.deepEqual(back.files.get('/banner.png'), PIC);
  assert.equal(back.manifest.name, 'Cosmic Junkyard!');
  assert.deepEqual(back.manifest.savedFrom, {
    uri: `at://${DID}/ing.dasl.masl/3mwvoqidyqd24`, did: DID, record: { $link: recordCid }, proof: { $link: commitCid },
    savedAt: '2026-11-20T12:00:00.000Z', savedBy: 'Raku',
  });
  assert.deepEqual(back.savedFrom, { uri: `at://${DID}/ing.dasl.masl/3mwvoqidyqd24`, proof: true });
});

test('the proof goes in only when it holds this very record; no proof, or a failing server, still saves', async () => {
  const tile = await tileRecord();
  const recordBytes = te.encode('this record');
  const files = await byCid();
  const getFile = async (cid) => files.get(cid).slice().buffer;
  const base = { source: { did: DID, rkey: 'r', tile, recordCid: str(cbCid(recordBytes)), name: 'x' }, getFile };
  for (const fetchProof of [async () => proofCar(recordBytes, { withRecord: false }).car, async () => null, async () => { throw new Error('down'); }, async () => te.encode('not a car').buffer]) {
    const r = await buildSavedTile({ ...base, fetchProof });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.proof, false);
    const back = await readTileFile(r.bytes);
    assert.equal(back.ok, true);
    assert.equal('proof' in back.manifest.savedFrom, false);
  }
});

test('a file that doesn\'t match its address, a file that can\'t be fetched, or a tile too large: not saved', async () => {
  const tile = await tileRecord();
  const files = await byCid();
  const source = { did: DID, rkey: 'r', tile, recordCid: 'bafyreix', name: 'x' };
  let r = await buildSavedTile({ source, getFile: async () => te.encode('something else').buffer });
  assert.equal(r.ok, false); assert.match(r.reason, /didn't match its address/);
  r = await buildSavedTile({ source, getFile: async () => null });
  assert.equal(r.ok, false); assert.match(r.reason, /couldn't be fetched/);
  let fetched = 0;
  const big = structuredClone(tile); big.resources['/'].src.size = 200 * 1024 * 1024;
  r = await buildSavedTile({ source: { ...source, tile: big }, getFile: async (cid) => { fetched++; return files.get(cid).slice().buffer; } });
  assert.equal(r.ok, false); assert.match(r.reason, /too large/);
  assert.equal(fetched, 0, 'refused before anything is fetched');
});

test('the proof CAR: blocks read and checked; its root from the header', async () => {
  const { car, commitCid } = proofCar(te.encode('rec'));
  const blocks = await readCarBlocks(car);
  assert.equal(blocks.length, 2);
  assert.equal(carRoot(car), commitCid);
  const bad = new Uint8Array(car); bad[bad.length - 1] ^= 1;
  await assert.rejects(readCarBlocks(bad), /doesn't match/);
  assert.equal(carRoot(te.encode('nope')), null);
});

test('notes (D3): ways, and a game Raku knows; names for files', () => {
  assert.deepEqual(savedNotes({ resources: { '/': {}, '/ways.json': {} } }), ["Its ways to other places won't work from the file."]);
  assert.deepEqual(savedNotes({ resources: { '/': {} } }, { did: 'd', rkey: 'r', games: () => [{ name: 'Cosmic Junkyard' }] }), ["Saving runs won't work from the file."]);
  assert.deepEqual(savedNotes({ resources: { '/': {} } }), []);
  assert.equal(saveFileName('Cosmic Junkyard!'), 'cosmic-junkyard.tile');
  assert.equal(saveFileName('@pyxorium.com\'s glass lantern'), 'pyxorium-com-s-glass-lantern.tile');
  assert.equal(saveFileName(''), 'tile.tile');
});
