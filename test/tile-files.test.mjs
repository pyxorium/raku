// Opening .tile files (claude/tile-files-plan.md, part 1): the reader (src/tile-file.js) takes a good file apart, and
// refuses the ways a bad one could come: changed bytes, a missing page or file, the loading server's own paths, other
// kinds of address, a file too large, a header built to trip the reader. Files are made here by a small writer of the
// test's own (so the reader isn't checked against itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { readTileFile, filePathLoader, createOpenedFiles, draggingFiles, readTileFileInWorker, base32Lower, TILE_FILE_LIMITS } from '../src/tile-file.js';
import { parseTarget, fileUri, opensHere } from '../src/address.js';

// ---- a small CAR writer (DAG-CBOR subset: maps with canonical key order, strings, ints, arrays, tag-42 links) ----
const te = new TextEncoder();
const sha = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const rawCidBytes = (data, codec = 0x55) => new Uint8Array([0x01, codec, 0x12, 0x20, ...sha(data)]);
const cidStr = (bytes) => 'b' + base32Lower(bytes);
const LINK = Symbol('link');
const link = (cidBytes) => ({ [LINK]: cidBytes });
function head(major, n, out) {
  if (n < 24) out.push((major << 5) | n);
  else if (n < 0x100) out.push((major << 5) | 24, n);
  else if (n < 0x10000) out.push((major << 5) | 25, n >> 8, n & 0xff);
  else out.push((major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
function enc(v, out = []) {
  if (v === null) out.push(0xf6);
  else if (v === true) out.push(0xf5);
  else if (v === false) out.push(0xf4);
  else if (typeof v === 'number') head(0, v, out);
  else if (typeof v === 'string') { const b = te.encode(v); head(3, b.length, out); out.push(...b); }
  else if (v instanceof Uint8Array) { head(2, v.length, out); out.push(...v); }
  else if (Array.isArray(v)) { head(4, v.length, out); v.forEach((x) => enc(x, out)); }
  else if (v[LINK]) { head(6, 42, out); const b = new Uint8Array([0, ...v[LINK]]); head(2, b.length, out); out.push(...b); }
  else {
    const ks = Object.keys(v).map((k) => [te.encode(k), k]).sort((a, b) => a[0].length - b[0].length || Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
    head(5, ks.length, out);
    for (const [kb, k] of ks) { head(3, kb.length, out); out.push(...kb); enc(v[k], out); }
  }
  return out;
}
function varint(n) { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; }
function car(header, blocks) {
  const h = enc(header);
  const out = [...varint(h.length), ...h];
  for (const [cid, data] of blocks) out.push(...varint(cid.length + data.length), ...cid, ...data);
  return new Uint8Array(out);
}
const PAGE = te.encode('<!doctype html><title>t</title><h1>Hello from a file</h1>');
const PIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
function goodFile({ edit = (h) => h, blocks = null } = {}) {
  const page = rawCidBytes(PAGE), pic = rawCidBytes(PIC);
  const header = edit({
    version: 1, roots: [], name: 'A file tile', description: 'For the tests.',
    icons: [{ src: '/icon.png' }],
    resources: {
      '/': { src: link(page), 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" },
      '/icon.png': { src: link(pic), 'content-type': 'image/png' },
    },
  });
  return car(header, blocks || [[page, PAGE], [pic, PIC]]);
}

// ---- reading ----
test('a good file: its name, manifest and files, every file found by its address', async () => {
  const r = await readTileFile(goodFile());
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.name, 'A file tile');
  assert.deepEqual(Object.keys(r.manifest.resources).sort(), ['/', '/icon.png']);
  assert.equal('version' in r.manifest || 'roots' in r.manifest, false, "CAR's own fields are left out");
  assert.equal(r.manifest.resources['/'].src.$link, cidStr(rawCidBytes(PAGE)));
  assert.deepEqual(r.files.get('/'), PAGE);
  assert.deepEqual(r.files.get('/icon.png'), PIC);
  assert.equal(r.totalBytes, PAGE.length + PIC.length);
});

test('a file whose bytes were changed is refused', async () => {
  const bytes = goodFile();
  bytes[bytes.length - 2] ^= 0xff;                       // inside the picture
  const r = await readTileFile(bytes);
  assert.equal(r.ok, false);
  assert.match(r.reason, /doesn't match its address/);
});

test('a file listed in the manifest but missing from inside is refused', async () => {
  const page = rawCidBytes(PAGE);
  const r = await readTileFile(goodFile({ blocks: [[page, PAGE]] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /\/icon\.png, but the file isn't inside/);
});

test('no "/" page, no name, no files, or a CAR version other than 1: refused', async () => {
  const cases = [
    [(h) => { delete h.resources['/']; return h; }, /no page to show/],
    [(h) => ({ ...h, name: '  ' }), /no name/],
    [(h) => ({ ...h, resources: undefined }), /lists no files/],
    [(h) => ({ ...h, version: 2 }), /version isn't 1/],
  ];
  for (const [edit, why] of cases) {
    const r = await readTileFile(goodFile({ edit: (x) => { const y = edit({ ...x, resources: { ...x.resources } }); if (y.resources === undefined) delete y.resources; return y; } }));
    assert.equal(r.ok, false, String(why));
    assert.match(r.reason, why);
  }
});

test("paths must start with / and stay out of the loading server's /.well-known/web-tiles/", async () => {
  const add = (path) => (h) => ({ ...h, resources: { ...h.resources, [path]: h.resources['/icon.png'] } });
  let r = await readTileFile(goodFile({ edit: add('/.well-known/web-tiles/worker.js') }));
  assert.equal(r.ok, false); assert.match(r.reason, /belongs to the loading server/);
  r = await readTileFile(goodFile({ edit: add('icon.png') }));
  assert.equal(r.ok, false); assert.match(r.reason, /path Raku won't use/);
});

test('only plain sha-256 file addresses: a dag-cbor block is refused', async () => {
  const page = rawCidBytes(PAGE, 0x71);
  const header = { version: 1, roots: [], name: 'x', resources: { '/': { src: link(page), 'content-type': 'text/html' } } };
  const r = await readTileFile(car(header, [[page, PAGE]]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /only plain sha-256/);
});

test('too large, empty, not a tile file, cut short: refused with a sentence, never thrown', async () => {
  let r = await readTileFile(goodFile(), { ...TILE_FILE_LIMITS, maxBytes: 20 });
  assert.equal(r.ok, false); assert.match(r.reason, /too large/);
  r = await readTileFile(new Uint8Array(0));
  assert.equal(r.ok, false);
  r = await readTileFile(te.encode('PK\u0003\u0004 this is a zip, or a text file, not a tile'));
  assert.equal(r.ok, false);
  const good = goodFile();
  for (const n of [3, 10, Math.floor(good.length / 2), good.length - 1]) {
    r = await readTileFile(good.slice(0, n));
    assert.equal(r.ok, false, `cut at ${n}`);
    assert.equal(typeof r.reason, 'string');
  }
});

test('a header built to trip the reader: too deep, too long, a name twice, strange values', async () => {
  // nested 100 deep
  let deep = []; for (let i = 0; i < 100; i++) deep = [deep];
  let r = await readTileFile(car({ version: 1, roots: [], name: 'x', resources: {}, junk: deep }, []));
  assert.equal(r.ok, false); assert.match(r.reason, /nests too deep/);
  // a map claiming a billion entries
  const huge = new Uint8Array([...varint(6), 0xba, 0x3b, 0x9a, 0xca, 0x00, 0x00]);
  r = await readTileFile(huge);
  assert.equal(r.ok, false);
  // a header longer than the limit
  r = await readTileFile(new Uint8Array([...varint(5 * 1024 * 1024), 0xa0]));
  assert.equal(r.ok, false); assert.match(r.reason, /header is too large/);
  // the same name twice (a map with "name" twice)
  const h = [0xa2, 0x64, ...te.encode('name'), 0x61, 0x61, 0x64, ...te.encode('name'), 0x61, 0x62];
  r = await readTileFile(new Uint8Array([...varint(h.length), ...h]));
  assert.equal(r.ok, false); assert.match(r.reason, /names something twice/);
  // an unknown tag
  const t = [0xa1, 0x61, 0x78, 0xd8, 0x2b, 0x40];
  r = await readTileFile(new Uint8Array([...varint(t.length), ...t]));
  assert.equal(r.ok, false); assert.match(r.reason, /kind of value Raku doesn't read/);
});

test('"__proto__" in a manifest is just a name, and changes nothing else', async () => {
  const r = await readTileFile(goodFile({ edit: (h) => ({ ...h, ['__proto__']: { polluted: true } }) }));
  assert.equal(r.ok, true, r.reason);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(r.manifest), Object.prototype);
});

// ---- for the page ----
test('the path loader serves each file with its headers, and 404 for anything else', async () => {
  const r = await readTileFile(goodFile());
  const seen = [];
  const loader = filePathLoader(r, (path, ok) => seen.push([path, ok]));
  const root = await loader.resolvePath('/');
  assert.equal(root.ok, true);
  assert.equal(root.headers['content-type'], 'text/html');
  assert.equal(root.headers['content-security-policy'], "default-src 'self'");
  assert.deepEqual(new Uint8Array(root.body), PAGE);
  assert.equal((await loader.resolvePath('/nope')).status, 404);
  assert.deepEqual(seen, [['/', true], ['/nope', false]]);
});

test('a tab for a file: raku:file/<id>, kept across a reload (it opens in a tab), odd ids refused', () => {
  const t = parseTarget(fileUri('abcdef0123456789'));
  assert.equal(t.ok, true);
  assert.equal(t.kind, 'file');
  assert.equal(t.id, 'abcdef0123456789');
  assert.equal(opensHere(t), true);
  assert.equal(parseTarget('raku:file/../x').ok, false);
  assert.equal(parseTarget('raku:file/').ok, false);
});

test('opened files: each gets an id; only the latest dozen are kept', () => {
  let n = 0;
  const o = createOpenedFiles({ max: 3, newId: () => `id${String(++n).padStart(8, '0')}` });
  const ids = [1, 2, 3, 4].map((i) => o.add({ name: `t${i}` }));
  assert.equal(o.size, 3);
  assert.equal(o.get(ids[0]), null);
  assert.equal(o.get(ids[3]).name, 't4');
});

test('dragging: only files count', () => {
  assert.equal(draggingFiles({ types: ['Files'] }), true);
  assert.equal(draggingFiles({ types: ['text/plain'] }), false);
  assert.equal(draggingFiles(null), false);
});

test('reading in a worker: the file is handed over, read there, and the worker ended; a big file never reaches it', async () => {
  const bytes = goodFile();
  let ended = 0, made = 0;
  const makeWorker = () => {
    made++;
    const w = {
      onmessage: null, onerror: null,
      postMessage: async ({ id, bytes: b }) => {
        const r = await readTileFile(b);
        w.onmessage({ data: r.ok ? { id, ok: true, name: r.name, manifest: r.manifest, files: [...r.files].map(([p, d]) => [p, d.slice().buffer]), totalBytes: r.totalBytes } : { id, ok: false, reason: r.reason } });
      },
      terminate: () => { ended++; },
    };
    return w;
  };
  const file = { size: bytes.length, name: 'x.tile', arrayBuffer: async () => bytes.slice().buffer };
  const r = await readTileFileInWorker(file, { makeWorker });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.files.get('/'), PAGE);
  assert.equal(ended, 1);
  const big = await readTileFileInWorker({ size: TILE_FILE_LIMITS.maxBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) }, { makeWorker });
  assert.equal(big.ok, false); assert.match(big.reason, /too large/);
  assert.equal(made, 1, 'no worker for a file refused by its size');
});
