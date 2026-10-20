import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTile, sizeVerdict, createFileStore, createPathLoader } from '../src/tiles.js';
import { LIMITS } from '../src/config.js';

const CID = (n) => `bafkrei${String(n).padStart(52, 'a')}`;
const rec = (resources, extra = {}) => ({ value: { tile: { name: 'Zine', resources, ...extra } } });
const MB = 1024 * 1024;

test("a tile's declared size and name come from its record", () => {
  const d = describeTile(rec({
    '/': { src: { $type: 'blob', ref: { $link: CID(1) }, size: 2 * MB }, 'content-type': 'text/html' },
    '/a.png': { src: { $type: 'blob', ref: { $link: CID(2) }, size: 3 * MB } },
    '/b.mp3': { src: { $link: CID(3) } },
  }, { sizing: { width: 640, height: 480 } }));
  assert.equal(d.ok, true);
  assert.equal(d.name, 'Zine');
  assert.equal(d.declaredBytes, 5 * MB);
  assert.equal(d.unknownSizes, 1);
  assert.deepEqual(d.sizing, { width: 640, height: 480 });
  assert.equal(describeTile({ value: { name: 'flat' } }).ok, false);
  assert.equal(describeTile(rec({ '/x.png': { src: { $link: CID(1) } } })).ok, false);   // no page
});

test('open, ask or refuse by size', () => {
  assert.equal(sizeVerdict(1 * MB), 'open');
  assert.equal(sizeVerdict(LIMITS.askBytes), 'open');
  assert.equal(sizeVerdict(60 * MB), 'ask');
  assert.equal(sizeVerdict(LIMITS.maxBytes + 1), 'refuse');
});

function fakePds(files) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const cid = new URL(url).searchParams.get('cid');
    return files[cid] ? new Response(files[cid]) : new Response('nope', { status: 404 });
  };
  return { fetchImpl, calls };
}

test("files are served by path, shared and kept; each tile has a download allowance", async () => {
  const { fetchImpl, calls } = fakePds({ [CID(1)]: '<p>hi</p>', [CID(2)]: 'x'.repeat(4000) });
  const files = createFileStore({ fetchImpl });
  const manifest = { resources: {
    '/': { src: { $link: CID(1) }, 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" },
    '/big.bin': { src: { $link: CID(2) } },
    '/gone.png': { src: { $link: CID(9) } },
  } };
  const seen = [];
  const loader = createPathLoader({ files, pds: 'https://pds.example.com', did: 'did:plc:x', manifest,
    limits: { ...LIMITS, maxBytes: 3000 }, onFile: (p, ok) => seen.push([p, ok]) });
  const a = await loader.resolvePath('/');
  assert.equal(a.ok, true);
  assert.equal(new TextDecoder().decode(a.body), '<p>hi</p>');
  assert.equal(a.headers['content-type'], 'text/html');
  assert.equal(a.headers['content-security-policy'], "default-src 'self'");
  await loader.resolvePath('/');
  assert.equal(calls.length, 1, 'the second request uses the kept copy');
  assert.equal((await loader.resolvePath('/big.bin')).ok, false, 'over the allowance');
  assert.equal((await loader.resolvePath('/gone.png')).ok, false);
  assert.equal((await loader.resolvePath('/missing')).ok, false);
  assert.deepEqual(seen.map((s) => s.join(':')), ['/:true', '/:true', '/big.bin:false', '/gone.png:false', '/missing:false']);
});

test('requests to private account servers are refused', async () => {
  const { fetchImpl, calls } = fakePds({ [CID(1)]: 'x' });
  const files = createFileStore({ fetchImpl });
  const loader = createPathLoader({ files, pds: 'https://192.168.1.10', did: 'did:plc:x', manifest: { resources: { '/': { src: { $link: CID(1) } } } } });
  assert.equal((await loader.resolvePath('/')).ok, false);
  assert.equal(calls.length, 0);
});
