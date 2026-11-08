// Tile posts (claude/tile-posts-plan.md, stage 3): reading and checking cafe.thunderbird.tile.post records, merging
// many accounts' posts, finding the accounts (the relay, and its fallback), the hide list. Plain data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTilePost, cutText, tileOf, postTime, mergePosts, accountsToRead, tileState, relayAccounts, createTilePosts, POST_COLLECTION } from '../src/tile-posts.js';
import { createResolver } from '../src/resolve.js';
import { parseTarget, discoverUri, DISCOVER_SOURCES } from '../src/address.js';
import { TILE_POSTS } from '../src/config.js';
import { ICON_NAMES } from '../src/icons.js';
import { tidTime } from '../src/following.js';

const A = 'did:plc:6vxjigxrqizmbo56gojxico3';      // thunderbird.cafe (always read)
const P = 'did:plc:rqbqpaaluty5v47jwciowpik';      // pyxorium.com (always read)
const S = 'did:plc:shelfaaaaaaaaaaaaaaaaaaa';      // on the shelf
const R = 'did:plc:relayaaaaaaaaaaaaaaaaaaa';      // found by the relay only
const H = 'did:plc:hiddenaaaaaaaaaaaaaaaaaa';      // hidden account
const TILE_CID = 'bafyreigawujq3a4qtir6mepbu3yk4owndjwkb7xd6xuwyoi53nkyknsloe';
const NOW = Date.UTC(2026, 10, 8, 12);
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const fakeDid = (i, fill = 'a') => `did:plc:${(B32[i >> 5 & 31] + B32[i & 31]).padStart(24, fill)}`;
const tileUri = (did, rkey) => `at://${did}/ing.dasl.masl/${rkey}`;
const rec = (did, rkey, value) => ({ uri: `at://${did}/${POST_COLLECTION}/${rkey}`, cid: 'bafyreipost' + 'a'.repeat(20), value });
const val = (extra = {}) => ({ $type: POST_COLLECTION, tile: { uri: tileUri(A, '3mzmaze'), cid: TILE_CID }, text: 'A maze', createdAt: '2026-11-08T10:00:00.000Z', ...extra });

test('the address raku:discover/posts and its icon', () => {
  assert.ok(DISCOVER_SOURCES.includes('posts'));
  assert.deepEqual(parseTarget('raku:discover/posts'), { ok: true, kind: 'discover', source: 'posts', uri: discoverUri('posts') });
  assert.ok(ICON_NAMES.includes('posts'));
});

test('a tile post is read and checked: the tile a strongRef to an ing.dasl.masl record, by DID', () => {
  const p = readTilePost(rec(A, '3mzpost1', val({ alt: 'A small 3D maze', langs: ['en', 'x'.repeat(40)] })), A, NOW);
  assert.equal(p.did, A);
  assert.equal(p.rkey, '3mzpost1');
  assert.deepEqual(p.tile, { did: A, rkey: '3mzmaze', uri: tileUri(A, '3mzmaze'), cid: TILE_CID });
  assert.equal(p.text, 'A maze');
  assert.equal(p.alt, 'A small 3D maze');
  assert.deepEqual(p.langs, ['en']);
  assert.equal(p.time, Date.parse('2026-11-08T10:00:00.000Z'));
  // text is optional: a post can be just the tile
  assert.equal(readTilePost(rec(A, 'k1', val({ text: undefined })), A, NOW).text, '');
  // left out: not a tile, a handle, no cid, a bad cid, another collection, another account's record, another $type
  const bad = [
    val({ tile: { uri: `at://${A}/app.bsky.feed.post/x`, cid: TILE_CID } }),
    val({ tile: { uri: 'at://thunderbird.cafe/ing.dasl.masl/3mzmaze', cid: TILE_CID } }),
    val({ tile: { uri: tileUri(A, '3mzmaze') } }),
    val({ tile: { uri: tileUri(A, '3mzmaze'), cid: 'not a cid' } }),
    val({ tile: tileUri(A, '3mzmaze') }),
    val({ $type: 'app.bsky.feed.post' }),
  ];
  for (const v of bad) assert.equal(readTilePost(rec(A, 'k1', v), A, NOW), null, JSON.stringify(v));
  assert.equal(readTilePost({ uri: `at://${A}/app.bsky.feed.post/k1`, value: val() }, A, NOW), null);
  assert.equal(readTilePost(rec(P, 'k1', val()), A, NOW), null, 'a record listed under another account');
  assert.equal(readTilePost(null, A, NOW), null);
  assert.equal(readTilePost(rec(A, 'k1', 'junk'), A, NOW), null);
  assert.equal(tileOf(tileUri('did:web:example.org', 'abc')).did, 'did:web:example.org');
  assert.equal(tileOf(`${tileUri(A, 'abc')}/more`), null);
});

test('over-long text is cut to 300 characters as a reader counts them; alt to 1000', () => {
  const long = 'é'.repeat(310);
  const p = readTilePost(rec(A, 'k1', val({ text: long, alt: 'a'.repeat(1200) })), A, NOW);
  assert.equal(p.text, `${'é'.repeat(300)}…`);
  assert.equal(p.alt.length, 1001);
  // a family emoji is one character to a reader (several code points): 300 of them aren't cut
  const fam = '👨‍👩‍👧'.repeat(300);
  assert.equal(cutText(fam), fam);
  assert.equal(cutText(`${fam}!`), `${fam}…`);
  assert.equal(cutText(42), '');
  assert.equal(cutText('x'.repeat(100000)).length, 301, 'a huge text is cut without reading all of it');
});

test("a post's time: its createdAt when sensible, else its key's time", () => {
  const tid = '3mzqerccutl2k';
  const t = tidTime(tid);
  assert.ok(t > Date.UTC(2026, 0, 1));
  assert.equal(postTime({ createdAt: '2026-11-08T10:00:00Z' }, tid, NOW), Date.parse('2026-11-08T10:00:00Z'));
  assert.equal(postTime({ createdAt: '2099-01-01T00:00:00Z' }, tid, NOW), t, 'far in the future');
  assert.equal(postTime({ createdAt: '1999-01-01T00:00:00Z' }, tid, NOW), t, 'before atproto');
  assert.equal(postTime({ createdAt: 'nonsense' }, tid, NOW), t);
  assert.equal(postTime({}, 'notatid', NOW), 0);
});

test('many accounts merge newest first, capped; ties keep a stable order', () => {
  const mk = (did, rkey, iso) => readTilePost(rec(did, rkey, val({ createdAt: iso })), did, NOW);
  const merged = mergePosts([
    [mk(A, 'a1', '2026-11-08T09:00:00Z'), mk(A, 'a2', '2026-11-06T09:00:00Z')],
    [mk(P, 'p1', '2026-11-07T09:00:00Z')],
    [mk(S, 's1', '2026-11-08T09:00:00Z')],
  ], 3);
  assert.deepEqual(merged.map((p) => p.rkey), ['a1', 's1', 'p1']);
});

test('the accounts to read: always, then the shelf, then the relay; no repeats; at most 500', () => {
  assert.deepEqual(accountsToRead({ always: [A, P], shelf: [S, A], relay: [R, P, 'junk', S] }), [A, P, S, R]);
  const many = Array.from({ length: 600 }, (_, i) => fakeDid(i, 'c'));
  const got = accountsToRead({ always: [A], shelf: [], relay: many });
  assert.equal(got.length, TILE_POSTS.maxAccounts);
  assert.equal(got[0], A);
  assert.deepEqual(TILE_POSTS.always, [A, P]);
  assert.equal(TILE_POSTS.relay, 'https://relay1.us-east.bsky.network');
});

test('the tile must still be the version the post names', () => {
  const p = readTilePost(rec(A, 'k1', val()), A, NOW);
  assert.equal(tileState(p, { cid: TILE_CID }), 'ok');
  assert.equal(tileState(p, { cid: 'bafyreisomethingelseaaaaaaaaaaaaaaa' }), 'changed');
  assert.equal(tileState(p, null), 'changed');
});

// ---- the whole load, against stand-in servers ----
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function world({ relay = 'ok', pages = null } = {}) {
  const calls = [];
  const posts = {
    [A]: [rec(A, '3mzaaaaaaaaa1', val({ createdAt: '2026-11-08T09:00:00Z', text: 'From thunderbird.cafe' }))],
    [P]: [],
    [S]: [rec(S, '3mzsssssssss1', val({ createdAt: '2026-11-07T09:00:00Z', text: 'From the shelf' })),
      rec(S, '3mzsssssssss2', val({ createdAt: '2026-11-07T08:00:00Z', text: 'A hidden tile', tile: { uri: tileUri(R, 'hiddentile'), cid: TILE_CID } }))],
    [R]: [rec(R, '3mzrrrrrrrrr1', val({ createdAt: '2026-11-08T11:00:00Z', text: 'Found by the relay' })), { uri: 'junk' }],
    [H]: [rec(H, '3mzhhhhhhhhh1', val({ text: 'Hidden account' }))],
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.host === 'plc.directory') {
      const did = decodeURIComponent(u.pathname.slice(1));
      return json({ id: did, alsoKnownAs: [], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: `https://pds.${did.slice(8, 14)}.net` }] });
    }
    if (u.host === 'relay1.us-east.bsky.network') {
      assert.equal(u.searchParams.get('collection'), POST_COLLECTION);
      if (relay === 'down') throw new TypeError('network');
      if (relay === '500') return json({ error: 'InternalError' }, 500);
      if (pages) { const i = Number(u.searchParams.get('cursor') || 0); return json({ repos: pages[i].map((did) => ({ did })), ...(i + 1 < pages.length ? { cursor: String(i + 1) } : {}) }); }
      return json({ repos: [{ did: A }, { did: R }, { did: H }, { did: 'nonsense' }] });
    }
    if (u.pathname.endsWith('com.atproto.repo.listRecords')) {
      assert.equal(u.searchParams.get('collection'), POST_COLLECTION);
      const did = u.searchParams.get('repo');
      if (did === S && relay === 'shelf-down') return json({ error: 'nope' }, 502);
      return json({ records: posts[did] || [] });
    }
    return json({ error: 'NotFound' }, 404);
  };
  const moderation = {
    profiles: async () => new Map(),
    isAccountHidden: async (did) => did === H,
    isHidden: async (did, rkey) => did === H || rkey === 'hiddentile',
  };
  const shelf = { accounts: () => [{ did: S, handle: 'shelf.example.org' }] };
  const resolver = createResolver({ fetchImpl });
  return { calls, fetchImpl, tp: createTilePosts({ resolver, moderation, shelf, fetchImpl, now: () => NOW }) };
}

test("everyone's posts: the relay's accounts, always the owner's and the shelf's, newest first, hidden ones left out", async () => {
  const w = world();
  const r = await w.tp.load();
  assert.deepEqual(r.items.map((p) => p.text), ['Found by the relay', 'From thunderbird.cafe', 'From the shelf']);
  assert.equal(r.relayOk, true);
  assert.equal(r.accounts, 5, 'A, P, the shelf, and the relay\'s R and H (the hidden one is asked nothing)');
  assert.equal(r.unreachable, 0);
  assert.ok(!w.calls.some((u) => u.searchParams.get('repo') === H), "a hidden account's posts aren't even read");
  // kept a few minutes: a second load asks nothing
  const n = w.calls.length;
  await w.tp.load();
  assert.equal(w.calls.length, n);
  await w.tp.load({ fresh: true });
  assert.ok(w.calls.length > n);
});

test('the relay failing: the accounts Raku knows, and relayOk false for the quiet note', async () => {
  for (const how of ['down', '500']) {
    const r = await world({ relay: how }).tp.load();
    assert.equal(r.relayOk, false, how);
    assert.deepEqual(r.items.map((p) => p.text), ['From thunderbird.cafe', 'From the shelf'], how);
    assert.equal(r.accounts, 3);
  }
});

test('an account whose server fails is counted, the rest still show', async () => {
  const r = await world({ relay: 'shelf-down' }).tp.load();
  assert.equal(r.unreachable, 1);
  assert.deepEqual(r.items.map((p) => p.text), ['Found by the relay', 'From thunderbird.cafe']);
});

test('the relay is read 100 at a time, following its cursor, up to 500 accounts', async () => {
  const dids = Array.from({ length: 650 }, (_, i) => fakeDid(i, 'b'));
  const pages = [];
  for (let i = 0; i < dids.length; i += 100) pages.push(dids.slice(i, i + 100));
  const w = world({ pages });
  const r = await relayAccounts({ fetchImpl: w.fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.dids.length, 500);
  assert.equal(w.calls.filter((u) => u.host === 'relay1.us-east.bsky.network').length, 5);
  assert.ok(w.calls.every((u) => u.searchParams.get('limit') === null || u.searchParams.get('limit') === '100' || u.pathname.endsWith('listRecords')));
});
