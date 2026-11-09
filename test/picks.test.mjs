// The first screen's picks, baked in (claude/raku-baked-picks-plan.md): src/picks.js, src/picks.baked.js and
// scripts/bake-picks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { PICKS } from '../src/config.js';
import { BAKED_PICKS } from '../src/picks.baked.js';
import { bakedPick, bakedPictureUrl, bakeProblems } from '../src/picks.js';
import { bakePicks, bakedFileText } from '../scripts/bake-picks.mjs';
import { createResolver } from '../src/resolve.js';

// BP3: the deploy runs these tests, so a stale bake stops it before going live.
test('the baked picks match PICKS (if not: run npm run bake-picks directly in C:\\thunderbird-cafe\\raku)', async () => {
  const problems = bakeProblems();
  assert.deepEqual(problems, [], `PICKS changed since the last bake: run npm run bake-picks, then commit src/picks.baked.js and public/picks/.\n  ${problems.join('\n  ')}`);
  for (const p of BAKED_PICKS.picks) {
    if (!p.banner) continue;
    const s = await stat(new URL(`../public/${p.banner.file}`, import.meta.url)).catch(() => null);
    assert.ok(s && s.size > 0 && s.size < 300 * 1024, `public/${p.banner.file} is missing or over 300 KB: bake again`);
  }
});

const D = (n) => `did:plc:aaaaaaaaaaaaaaaaaaaaaaa${'bcdefg'[n - 1]}`;   // did:plc is base32: no 0, 1, 8 or 9
const U = (n) => `at://${D(n)}/ing.dasl.masl/3mxpick${n}aaaa`;
const ENTRY = (n, extra = {}) => ({ uri: U(n), did: D(n), rkey: `3mxpick${n}aaaa`, cid: 'bafyrec', name: `Pick ${n}`, description: `The ${n}`,
  handle: `p${n}.example.com`, banner: { cid: `bafkreibanner${n}aaaaaaaaaaaaaaaaaaaaaaa`, file: `picks/3mxpick${n}aaaa.webp`, width: 640, height: 360 }, ...extra });

test('bakeProblems: agreeing, missing, extra, reordered, broken', () => {
  const baked = { picks: [ENTRY(1), ENTRY(2)] };
  assert.deepEqual(bakeProblems([U(1), U(2)], baked), []);
  assert.deepEqual(bakeProblems([U(1), U(2), U(3)], baked), [`not baked: ${U(3)}`]);
  assert.deepEqual(bakeProblems([U(1)], baked), [`baked but no longer a pick: ${U(2)}`]);
  assert.deepEqual(bakeProblems([U(2), U(1)], baked), ['the picks are in a different order than when they were baked']);
  assert.deepEqual(bakeProblems([U(1)], { picks: [{ uri: U(1) }] }), [`a baked entry isn't usable: ${U(1)}`]);
  assert.deepEqual(bakeProblems([U(1)], { picks: [] }), [`not baked: ${U(1)}`]);
});

test('bakedPick: the entry, its picture on Raku\'s own site; nothing for a pick not baked', () => {
  const baked = { picks: [ENTRY(1), ENTRY(2, { banner: null }), ENTRY(3, { banner: { cid: 'x', file: '../../evil.webp' } })] };
  const e = bakedPick(U(1), baked);
  assert.equal(e.name, 'Pick 1');
  assert.equal(e.handle, 'p1.example.com');
  assert.equal(bakedPictureUrl(e), '/picks/3mxpick1aaaa.webp');
  assert.equal(bakedPictureUrl(bakedPick(U(2), baked)), null);
  assert.equal(bakedPick(U(3), baked).banner, null, 'a banner that isn\'t a plain file under picks/ is ignored');
  assert.equal(bakedPick(U(4), baked), null);
});

// A stand-in network for the bake: PLC, the handle resolver, the PDS's getRecord and getBlob.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
function standIn({ handleBack = true, record = true, banner = true } = {}) {
  const did = D(1);
  const calls = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'plc.directory') return json({ id: did, alsoKnownAs: ['at://p1.example.com'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.net' }] });
    if (u.pathname.endsWith('resolveHandle')) return json({ did: handleBack ? did : 'did:plc:someoneelseentirelyaaaaa' });
    if (u.pathname.endsWith('getRecord')) {
      if (!record) return json({ error: 'RecordNotFound' }, 400);
      const tile = { name: 'Moab Red Hot', description: 'A hike.', resources: { '/': { src: { $type: 'blob', ref: { $link: 'bafkreipageaaaaaaaaaaaaaaaaaaaaaa' }, mimeType: 'text/html', size: 10 } } } };
      if (banner) { tile.resources['/banner.png'] = { src: { $type: 'blob', ref: { $link: 'bafkreibanneraaaaaaaaaaaaaaaaaaaa' }, mimeType: 'image/png', size: 11 } }; tile.screenshots = [{ src: '/banner.png' }]; }
      return json({ uri: U(1), cid: 'bafyreirecord', value: { $type: 'ing.dasl.masl', tile } });
    }
    if (u.pathname.endsWith('getBlob')) return new Response(PNG, { status: 200 });
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

test('bakePicks reads each pick through Raku\'s own lookups: name, description, checked handle, a resized banner', async () => {
  const { fetchImpl, calls } = standIn();
  const resolver = createResolver({ fetchImpl });
  const { getBanner } = await import('../scripts/bake-picks.mjs');
  const sizes = [];
  const out = await bakePicks({ picks: [U(1)], resolver, getBlob: (pds, did, cid) => getBanner(pds, did, cid, { fetchImpl }),
    resize: async (bytes) => { sizes.push(bytes.length); return { data: new Uint8Array([1, 2]), width: 640, height: 360 }; } });
  assert.deepEqual(out.entries, [{ uri: U(1), did: D(1), rkey: '3mxpick1aaaa', cid: 'bafyreirecord', name: 'Moab Red Hot', description: 'A hike.',
    handle: 'p1.example.com', banner: { cid: 'bafkreibanneraaaaaaaaaaaaaaaaaaaa', file: 'picks/3mxpick1aaaa.webp', width: 640, height: 360 } }]);
  assert.deepEqual(out.pictures.map((p) => p.file), ['picks/3mxpick1aaaa.webp']);
  assert.deepEqual(sizes, [PNG.length], 'the banner\'s own bytes were resized');
  assert.ok(calls.some((c) => c.startsWith('https://pds.example.net/xrpc/com.atproto.sync.getBlob')), 'the banner came from the author\'s server');
});

test('bakePicks: a handle that doesn\'t point back is left out; no banner, no picture', async () => {
  const { fetchImpl } = standIn({ handleBack: false, banner: false });
  const out = await bakePicks({ picks: [U(1)], resolver: createResolver({ fetchImpl }), getBlob: async () => null, resize: async () => assert.fail('nothing to resize') });
  assert.equal(out.entries[0].handle, '');
  assert.equal(out.entries[0].banner, null);
  assert.deepEqual(out.pictures, []);
});

test('bakePicks: a pick that can\'t be read stops the bake, naming it', async () => {
  const { fetchImpl } = standIn({ record: false });
  await assert.rejects(bakePicks({ picks: [U(1)], resolver: createResolver({ fetchImpl }), getBlob: async () => null, resize: async () => null }),
    (err) => err.message.startsWith(`Couldn't bake ${U(1)}:`));
});

test('the baked file reads back as the same picks', async () => {
  const text = bakedFileText([ENTRY(1), ENTRY(2, { banner: null })], '2026-11-09T12:00:00.000Z');
  const mod = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.equal(mod.BAKED_PICKS.bakedAt, '2026-11-09T12:00:00.000Z');
  assert.deepEqual(bakeProblems([U(1), U(2)], mod.BAKED_PICKS), []);
  assert.ok(Object.isFrozen(mod.BAKED_PICKS));
});

test('npm run bake-picks is wired up', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['bake-picks'], 'node scripts/bake-picks.mjs');
  assert.ok(PICKS.length >= 1);
});
