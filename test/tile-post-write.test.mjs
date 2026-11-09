// Writing tile posts from Raku (claude/raku-write-posts-plan.md, WP1 to WP13): the record and its limits, writing and
// reading back, who can post which tile, the From choice, your tiles for "Write a post", and the new post in Tile posts
// straight away. Plain data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPostRecord, writePost, deletePost, canPostTile, fromChoices, yourTiles, readLangs, graphemeCount, PostError, POST_LIMITS } from '../src/tile-post-write.js';
import { createTilePosts, POST_COLLECTION } from '../src/tile-posts.js';
import { SignInNeeded } from '../src/auth.js';
import { TILE_POSTS } from '../src/config.js';
import { isTid, tidTime } from '../src/tables/daisy-shared/tid.js';

const T = 'did:plc:6vxjigxrqizmbo56gojxico3';     // thunderbird.cafe
const P = 'did:plc:rqbqpaaluty5v47jwciowpik';     // pyxorium.com
const X = 'did:plc:someoneelseaaaaaaaaaaaaa';
const CID = 'bafyreigawujq3a4qtir6mepbu3yk4owndjwkb7xd6xuwyoi53nkyknsloe';
const TILE = { uri: `at://${P}/ing.dasl.masl/3mzk2fq7tlc2a`, cid: CID };
const WHEN = '2026-11-08T12:00:00.000Z';

test('the record: the tile by its exact version, the words, blanks left out (as the Foundry and tile_post.py)', () => {
  assert.equal(TILE_POSTS.collection, POST_COLLECTION);
  const r = buildPostRecord({ tile: TILE, text: '  Walk the maze.  ', alt: ' A small 3D maze. ', langs: 'en, fr', createdAt: WHEN });
  assert.equal(r.ok, true);
  assert.deepEqual(r.record, { $type: POST_COLLECTION, tile: TILE, text: 'Walk the maze.', alt: 'A small 3D maze.', langs: ['en', 'fr'], createdAt: WHEN });
  assert.deepEqual(buildPostRecord({ tile: TILE, createdAt: WHEN }).record, { $type: POST_COLLECTION, tile: TILE, createdAt: WHEN }, 'just the tile');
  assert.deepEqual(buildPostRecord({ tile: TILE, text: '   ', alt: '', langs: ' ', createdAt: WHEN }).record, { $type: POST_COLLECTION, tile: TILE, createdAt: WHEN });
  assert.ok(Date.parse(buildPostRecord({ tile: TILE }).record.createdAt), 'createdAt now by default');
});

test('the limits: 300 graphemes and 3000 bytes of text, 1000 and 10000 of alt, three languages, real tags only', () => {
  assert.deepEqual(POST_LIMITS, { text: [300, 3000], alt: [1000, 10000], langs: 3 });
  assert.equal(buildPostRecord({ tile: TILE, text: 'a'.repeat(300) }).ok, true);
  assert.match(buildPostRecord({ tile: TILE, text: 'a'.repeat(301) }).why, /over 300 characters/);
  const flag = '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}';      // one grapheme, 14 bytes
  assert.equal(graphemeCount(flag.repeat(200)), 200);
  assert.equal(buildPostRecord({ tile: TILE, text: flag.repeat(200) }).ok, true, '200 graphemes, 2800 bytes');
  assert.match(buildPostRecord({ tile: TILE, text: flag.repeat(215) }).why, /too long/, '215 graphemes, but over 3000 bytes');
  assert.match(buildPostRecord({ tile: TILE, alt: 'b'.repeat(1001) }).why, /alt text is over 1000/);
  assert.match(buildPostRecord({ tile: TILE, langs: 'en fr de es' }).why, /At most 3/);
  assert.match(buildPostRecord({ tile: TILE, langs: 'english!' }).why, /isn't a language tag/);
  assert.deepEqual(readLangs('pt-BR en en'), { langs: ['pt-BR', 'en'] });
});

test("the tile must be a tile record named by DID, with its version", () => {
  assert.equal(buildPostRecord({ tile: { uri: 'at://pyxorium.com/ing.dasl.masl/3mzk', cid: CID } }).ok, false, 'a handle, not a DID');
  assert.equal(buildPostRecord({ tile: { uri: `at://${P}/app.bsky.feed.post/3mzk`, cid: CID } }).ok, false, 'not a tile');
  assert.equal(buildPostRecord({ tile: { uri: TILE.uri, cid: 'nope' } }).ok, false, 'no version');
  assert.equal(buildPostRecord({}).ok, false);
});

test('who can post which tile (WP1): only a tile of one of your accounts signed in here; From lists them, the tile’s own first (WP2, WP9)', () => {
  const accounts = [{ did: T, handle: 'thunderbird.cafe' }, { did: P, handle: 'pyxorium.com' }];
  assert.equal(canPostTile(P, accounts), true);
  assert.equal(canPostTile(X, accounts), false, 'someone else’s tile: no Post');
  assert.equal(canPostTile(P, []), false, 'signed out: no Post');
  assert.deepEqual(fromChoices(P, accounts).map((a) => a.handle), ['pyxorium.com', 'thunderbird.cafe']);
  assert.deepEqual(fromChoices(T, accounts).map((a) => a.handle), ['thunderbird.cafe', 'pyxorium.com']);
});

// Stand-ins: an account server that keeps records, and Raku's auth and resolver over it.
function world({ mangle = false, refuse = null, failRead = false } = {}) {
  const repos = new Map();
  const calls = [];
  const auth = {
    async putRecord(did, { collection, rkey, record, validate }) {
      calls.push({ put: { did, collection, rkey, record, validate } });
      if (refuse === 'scope') throw Object.assign(new Error('This sign-in no longer allows this.'), { code: 'scope' });
      if (refuse === 'signin') throw new SignInNeeded('ran out');
      if (refuse === 'net') throw new Error("The server answered 502");
      repos.set(`${did}/${collection}/${rkey}`, mangle ? { ...record, text: 'changed' } : record);
      return { uri: `at://${did}/${collection}/${rkey}`, cid: 'bafyreipost' + 'a'.repeat(30) };
    },
    async call(did, nsid, { body }) { calls.push({ call: nsid, body }); repos.delete(`${did}/${body.collection}/${body.rkey}`); return {}; },
  };
  const resolver = {
    async record(did, collection, rkey) {
      if (failRead) throw new Error('timeout');
      const v = repos.get(`${did}/${collection}/${rkey}`);
      if (!v) throw Object.assign(new Error('not found'), { code: 'not-found' });
      return { uri: `at://${did}/${collection}/${rkey}`, cid: 'bafyreipost' + 'a'.repeat(30), value: Object.fromEntries(Object.entries(v).reverse()) };
    },
  };
  return { auth, resolver, repos, calls };
}

test('writing: to the account chosen, a TID key, validate false, read back from the account’s server; the post as Tile posts reads it', async () => {
  const w = world();
  const { record } = buildPostRecord({ tile: TILE, text: 'Walk the maze.', createdAt: WHEN });
  const r = await writePost({ auth: w.auth, resolver: w.resolver, did: T, record, now: () => Date.parse(WHEN) + 1000 });
  const put = w.calls[0].put;
  assert.equal(put.did, T, 'From: thunderbird.cafe posting a pyxorium.com tile (WP2)');
  assert.equal(put.collection, POST_COLLECTION);
  assert.equal(put.validate, false);
  assert.ok(isTid(put.rkey) && Math.abs(tidTime(put.rkey) - Date.now()) < 60000, 'a fresh TID');
  assert.equal(r.uri, `at://${T}/${POST_COLLECTION}/${put.rkey}`);
  assert.equal(r.post.did, T);
  assert.equal(r.post.text, 'Walk the maze.');
  assert.deepEqual(r.post.tile, { did: P, rkey: '3mzk2fq7tlc2a', uri: TILE.uri, cid: CID });
  await deletePost({ auth: w.auth, did: T, rkey: put.rkey });
  assert.equal(w.repos.size, 0);
});

test('failures by step: nothing written, the sign-in, the permission, and written-but-not-confirmed', async () => {
  const { record } = buildPostRecord({ tile: TILE, createdAt: WHEN });
  const go = (opts) => { const w = world(opts); return writePost({ auth: w.auth, resolver: w.resolver, did: P, record }); };
  await assert.rejects(go({ refuse: 'net' }), (e) => e instanceof PostError && e.code === 'write' && /502/.test(e.message));
  await assert.rejects(go({ refuse: 'signin' }), (e) => e.code === 'signin');
  await assert.rejects(go({ refuse: 'scope' }), (e) => e.code === 'scope' && /approve “Raku”/.test(e.message));
  await assert.rejects(go({ mangle: true }), (e) => e.code === 'verify', 'read back differently');
  await assert.rejects(go({ failRead: true }), (e) => e.code === 'verify', 'not read back at all');
});

test('your tiles (WP13): each signed-in account’s, newest first, hidden ones and non-tiles left out; an account that fails says so', async () => {
  const tile = (did, rkey, name, createdAt) => ({ uri: `at://${did}/ing.dasl.masl/${rkey}`, rkey, cid: CID, value: { tile: { name, resources: { '/': { src: { $link: CID } } } }, createdAt } });
  const resolver = {
    async listTiles(did) {
      if (did === X) throw new Error('down');
      if (did === P) return { records: [tile(P, '3mzaaaaaaaaa2', 'Dusk at the café', '2026-10-12T00:00:00Z'), tile(P, '3mzbbbbbbbbb2', 'Escher maze', '2026-11-06T00:00:00Z'), tile(P, '3mzhiddenhid2', 'Hidden', '2026-11-07T00:00:00Z'), { uri: `at://${P}/ing.dasl.masl/3mzflat`, rkey: '3mzflat', cid: CID, value: { name: 'flat' } }], cursor: null };
      return { records: [tile(T, '3mzccccccccc2', 'Winter Forest', '2026-10-28T00:00:00Z')], cursor: null };
    },
  };
  const moderation = { onHideList: async (did, rkey) => rkey === '3mzhiddenhid2' };
  const out = await yourTiles({ accounts: [{ did: P, handle: 'pyxorium.com' }, { did: T, handle: 'thunderbird.cafe' }, { did: X, handle: 'x.example' }], resolver, moderation });
  assert.deepEqual(out.map((a) => a.handle), ['pyxorium.com', 'thunderbird.cafe', 'x.example']);
  assert.deepEqual(out[0].tiles.map((t) => t.name), ['Escher maze', 'Dusk at the café']);
  assert.deepEqual(out[0].tiles[0], { did: P, rkey: '3mzbbbbbbbbb2', uri: `at://${P}/ing.dasl.masl/3mzbbbbbbbbb2`, cid: CID, name: 'Escher maze', time: Date.parse('2026-11-06T00:00:00Z'), record: out[0].tiles[0].record });
  assert.deepEqual(out[1].tiles.map((t) => t.name), ['Winter Forest']);
  assert.match(out[2].error, /Couldn't list/);
});

test('Tile posts: a post written here shows at once, newest first, without Refresh, until a load finds it (WP10)', async () => {
  const now = Date.parse(WHEN);
  const tp = createTilePosts({
    resolver: { account: async () => ({ pds: 'https://pds.example.com' }) },
    moderation: { profiles: async () => null, isAccountHidden: async () => false, isHidden: async () => false },
    shelf: { accounts: () => [] },
    now: () => now,
    limits: { ...TILE_POSTS, always: [], maxAccounts: 0, relayMs: 50 },
    fetchImpl: async () => new Response(JSON.stringify({ repos: [] }), { status: 200 }),
  });
  assert.deepEqual((await tp.load()).items, []);
  const w = world();
  const { record } = buildPostRecord({ tile: TILE, text: 'New!', createdAt: WHEN });
  const r = await writePost({ auth: w.auth, resolver: w.resolver, did: T, record, now: () => now });
  tp.add(r.post);
  const after = await tp.load();
  assert.deepEqual(after.items.map((x) => x.text), ['New!'], 'kept list: the new post is in it');
  assert.deepEqual(tp.cached.items.map((x) => x.text), ['New!']);
  assert.deepEqual((await tp.load({ fresh: true })).items.map((x) => x.text), ['New!'], 'a fresh load that doesn’t find it yet still shows it');
});
