// Stage 6 (Discover): addresses, posts, Following, search. Plain data, no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, parsePost, searchUri, discoverUri } from '../src/address.js';
import { segments, readPost, moderatePost, tileRef, ago, threadKey, groupThreads } from '../src/posts.js';
import { tidTime, tileTime, createFollowing } from '../src/following.js';
import { addressesFrom, localMatches, searchAppmosphere, searchWords } from '../src/search.js';
import { createPublicReads } from '../src/bluesky.js';
import { FEED, SEARCH, POST_APPS, postApp, postLink, feedUri, MODERATION_SERVICES, appmosphereCopy } from '../src/config.js';
import { createTabs } from '../src/tabs.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
const MAKER = 'did:plc:makeraaaaaaaaaaaaaaaaaaa';
const PYX = 'did:plc:rqbqpaaluty5v47jwciowpik';
const LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac';

test('Discover and search addresses; words search; a word with a dot is a handle first', () => {
  assert.deepEqual(parseTarget('raku:discover'), { ok: true, kind: 'discover', source: null, uri: 'raku:discover' });
  assert.equal(parseTarget('raku:discover/following').source, 'following');
  assert.equal(parseTarget('raku:discover/news').uri, discoverUri('news'));
  assert.equal(parseTarget('raku:discover/nope').ok, false);
  const s = parseTarget('roller coaster');
  assert.deepEqual(s, { ok: true, kind: 'search', query: 'roller coaster', uri: 'raku:search/roller%20coaster' });
  assert.equal(parseTarget(s.uri).query, 'roller coaster');
  assert.equal(parseTarget(searchUri('3D CSS Saturn')).query, '3D CSS Saturn');
  assert.equal(parseTarget('thunderbird.cafe').kind, 'account');
  assert.equal(parseTarget('@someone').kind, 'search');
  assert.equal(parseTarget('https://example.com/').ok, false, 'other web pages are still refused, not searched');
  assert.equal(parseTarget('javascript:alert(1)').ok, false);
  assert.equal(parseTarget('x'.repeat(201)).ok, false, 'too long to be a search');
  assert.equal(parseTarget('raku:search/').ok, false);
});

test("posts: at:// and any app's /profile/…/post/… link; never kept in a tab", () => {
  const want = { ok: true, kind: 'post', actor: MAKER, rkey: '3post1', uri: `at://${MAKER}/app.bsky.feed.post/3post1` };
  assert.deepEqual(parsePost(`at://${MAKER}/app.bsky.feed.post/3post1`), want);
  assert.deepEqual(parseTarget(`https://bsky.app/profile/${MAKER}/post/3post1`), want);
  assert.equal(parseTarget('https://other.app.example/profile/maker.example.com/post/3post1').actor, 'maker.example.com');
  assert.equal(parseTarget('https://blacksky.community/profile/x.example/post/3abc').kind, 'post');
  assert.equal(parsePost('https://bsky.app/profile/x.example'), null);
  assert.equal(parsePost('http://bsky.app/profile/x.example/post/3abc'), null, 'https only');
  const tabs = createTabs();
  tabs.fromHash(`#t=${encodeURIComponent(`at://${MAKER}/app.bsky.feed.post/3abc`)},${encodeURIComponent('raku:search/coaster')}&a=1`);
  assert.deepEqual(tabs.list.map((t) => t.history[0]), [null, 'raku:search/coaster']);
});

test('config: the Web Tiles feed (step 6b), search and post apps over https, ?feed= on this computer only', () => {
  assert.equal(FEED, 'at://did:plc:6vxjigxrqizmbo56gojxico3/app.bsky.feed.generator/Web-Tiles');   // step 6b
  assert.match(SEARCH.url, /^https:\/\/appmosphe\.re\//);
  assert.ok(POST_APPS.every((a) => /^[a-z0-9.-]+\.[a-z]+$/.test(a.host)));
  assert.equal(postApp(null).id, 'bluesky');
  assert.equal(postApp({ getItem: () => 'mu' }).id, 'mu');
  assert.equal(postApp({ getItem: () => { throw new Error('blocked'); } }).id, 'bluesky');
  assert.equal(postLink(POST_APPS[0], 'thunderbird.cafe', '3abc'), 'https://bsky.app/profile/thunderbird.cafe/post/3abc');
  // Northsky (Oct 22): the owner's own post link, rebuilt
  assert.deepEqual(POST_APPS.map((a) => a.name), ['Bluesky', 'Blacksky', 'mu', 'Northsky']);
  assert.equal(postLink(postApp({ getItem: () => 'northsky' }), 'thunderbird.cafe', '3my75rtv2ml26'), 'https://northsky.app/profile/thunderbird.cafe/post/3my75rtv2ml26');
  // appmosphe.re's copy of a picture (Q129)
  assert.equal(appmosphereCopy(PYX, 'bafkreiabc'), `https://appmosphe.re/img/${PYX}/bafkreiabc`);
  assert.equal(appmosphereCopy(PYX, null), null);
  const f = `at://${DID}/app.bsky.feed.generator/web-tiles`;
  assert.equal(feedUri({ hostname: '127.0.0.1', search: `?feed=${encodeURIComponent(f)}` }), f);
  assert.equal(feedUri({ hostname: 'raku.lexicographer.space', search: `?feed=${encodeURIComponent(f)}` }), FEED, 'only on this computer');
  assert.equal(feedUri({ hostname: '127.0.0.1', search: '?feed=https://evil.example/' }), FEED);
  assert.deepEqual([...MODERATION_SERVICES], [LABELER]);
});

test('rich text: facets are UTF-8 byte ranges; bad ones stay plain', () => {
  const text = 'café ☕ see https://lexicographer.space and @thunderbird.cafe #webtiles';
  const enc = new TextEncoder();
  const at = (sub) => { const i = text.indexOf(sub); return { byteStart: enc.encode(text.slice(0, i)).length, byteEnd: enc.encode(text.slice(0, i + sub.length)).length }; };
  const segs = segments(text, [
    { index: at('#webtiles'), features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'webtiles' }] },
    { index: at('https://lexicographer.space'), features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lexicographer.space' }] },
    { index: at('@thunderbird.cafe'), features: [{ $type: 'app.bsky.richtext.facet#mention', did: DID }] },
    { index: { byteStart: 1, byteEnd: 4 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://overlap.example' }] },
  ]);
  assert.equal(segs.map((s) => s.text).join(''), text, 'nothing lost');
  assert.deepEqual(segs.find((s) => s.link), { text: 'https://lexicographer.space', link: 'https://lexicographer.space/' });
  assert.deepEqual(segs.find((s) => s.mention), { text: '@thunderbird.cafe', mention: DID });
  assert.deepEqual(segs.find((s) => s.tag), { text: '#webtiles', tag: 'webtiles' });
  const bad = segments('abc', [{ index: { byteStart: 0, byteEnd: 2 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] }]);
  assert.deepEqual(bad, [{ text: 'abc' }], 'only http(s) links');
  assert.deepEqual(segments('é', [{ index: { byteStart: 0, byteEnd: 1 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'x' }] }]), [{ text: 'é' }], 'half a character stays plain');
});

// A made-up post whose link card points at a tile (as Bluesky's public API returns a post with a link card).
const cardPost = {
  uri: `at://${MAKER}/app.bsky.feed.post/3post1`, cid: 'bafyreipostaaaaaaaaaaaaaaaaaaaaaa',
  author: { did: MAKER, handle: 'maker.example.com', displayName: 'A Maker', avatar: 'https://cdn.bsky.app/img/avatar/plain/x/y', labels: [] },
  record: {
    $type: 'app.bsky.feed.post', text: 'My new tile is up', createdAt: '2026-10-16T11:52:53.416Z',
    embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://lexicographer.space/@pyxorium.com/3mx6h2wjtgq2h', title: 'Roller Coaster', description: 'Take your sprite to the amusement park' } },
  },
  embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://lexicographer.space/@pyxorium.com/3mx6h2wjtgq2h', title: 'Roller Coaster', description: 'Take your sprite to the amusement park', thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/y' } },
  labels: [],
};

test("a post whose link card is a tile's address: the tile, and the card's picture from Bluesky's picture server", () => {
  const p = readPost(cardPost);
  assert.equal(p.author.handle, 'maker.example.com');
  assert.equal(p.rkey, '3post1');
  assert.deepEqual(p.tile, { actor: 'pyxorium.com', rkey: '3mx6h2wjtgq2h', uri: 'at://pyxorium.com/ing.dasl.masl/3mx6h2wjtgq2h', cid: null });
  assert.equal(p.external.thumb, 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/y');
  const plain = readPost({ ...cardPost, embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.org/blog', title: 'A blog' } } });
  assert.equal(plain.tile, null, 'an ordinary link card is no tile');
  assert.equal(plain.external.uri, 'https://example.org/blog');
});

test('posts: pictures only from cdn.bsky.app, a tile link in the text, quotes, video, broken posts', () => {
  const base = { uri: `at://${DID}/app.bsky.feed.post/3abc`, author: { did: DID, handle: 'thunderbird.cafe' }, record: { text: 'see lexicographer.space/@thunderbird.cafe/3mw763im3qw2t', createdAt: '2026-10-20T00:00:00Z',
    facets: [{ index: { byteStart: 4, byteEnd: 54 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lexicographer.space/@thunderbird.cafe/3mw763im3qw2t' }] }] } };
  const p = readPost({ ...base, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/a', fullsize: 'https://cdn.bsky.app/b', alt: 'a die' }, { thumb: 'https://evil.example/x' }] } });
  assert.deepEqual(p.images.map((i) => i.thumb), ['https://cdn.bsky.app/a']);
  assert.equal(p.tile.uri, 'at://thunderbird.cafe/ing.dasl.masl/3mw763im3qw2t');
  assert.equal(p.tile.cid, null);
  const q = readPost({ ...base, embed: { $type: 'app.bsky.embed.record#view', record: { uri: `at://${MAKER}/app.bsky.feed.post/3q`, author: { handle: 'maker.example.com' }, value: { text: 'hi' } } } });
  assert.equal(q.quote.handle, 'maker.example.com');
  assert.equal(readPost({ ...base, embed: { $type: 'app.bsky.embed.video#view' } }).video, true);
  assert.equal(readPost({ ...base, author: { did: 'not a did' } }), null);
  assert.equal(readPost({ ...base, uri: 'https://example.com' }), null);
  assert.equal(readPost({ ...base, author: { did: DID, handle: 'handle.invalid' } }).author.handle, null);
  assert.equal(tileRef('at://x/app.bsky.feed.post/y'), null);
});

test("labels: only the services Raku follows hide or warn; adult pictures blur, also from the author's own labels", () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  const v = (labels, extra = {}) => ({ author: { did: DID, labels: [] }, labels, record: {}, ...extra });
  assert.deepEqual(moderatePost(v([]), { now }), { hide: false, warn: false, blurMedia: false });
  assert.equal(moderatePost(v([{ src: LABELER, val: '!hide' }]), { now }).hide, true);
  assert.equal(moderatePost(v([{ src: 'did:plc:someoneelse', val: '!hide' }]), { now }).hide, false);
  assert.equal(moderatePost(v([{ src: LABELER, val: '!hide', neg: true }]), { now }).hide, false);
  assert.equal(moderatePost(v([{ src: LABELER, val: '!hide', exp: '2026-10-01T00:00:00Z' }]), { now }).hide, false);
  assert.equal(moderatePost(v([{ src: LABELER, val: '!warn' }]), { now }).warn, true);
  assert.equal(moderatePost(v([{ src: LABELER, val: 'porn' }]), { now }).blurMedia, true);
  assert.equal(moderatePost(v([{ src: DID, val: 'nudity' }]), { now }).blurMedia, true);
  assert.equal(moderatePost(v([], { record: { labels: { values: [{ val: 'graphic-media' }] } } }), { now }).blurMedia, true);
  assert.equal(moderatePost({ author: { did: DID, labels: [{ src: LABELER, val: '!takedown' }] }, labels: [] }, { now }).hide, true);
});

test('times', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(ago('2026-10-21T11:59:40Z', now), 'now');
  assert.equal(ago('2026-10-21T11:15:00Z', now), '45m');
  assert.equal(ago('2026-10-21T02:00:00Z', now), '10h');
  assert.equal(ago('2026-10-18T12:00:00Z', now), '3d');
  assert.equal(ago('2026-10-01T12:00:00Z', now), 'Oct 1');
  assert.equal(ago('2025-10-01T12:00:00Z', now), 'Oct 1 2025');
  assert.equal(ago('nonsense', now), '');
});

test('record keys tell the time; createdAt first unless it is in the future', () => {
  const t = tidTime('3myfnyphiuw2t');            // Daisy's house tile, published Oct 21
  assert.ok(t > Date.parse('2026-10-20T00:00:00Z') && t < Date.parse('2026-10-22T00:00:00Z'), new Date(t).toISOString());
  assert.equal(tidTime('self'), null);
  const now = Date.parse('2026-10-22T00:00:00Z');
  assert.equal(tileTime({ rkey: '3myfnyphiuw2t', value: { createdAt: '2026-10-20T00:00:00Z' } }, now), Date.parse('2026-10-20T00:00:00Z'));
  assert.equal(tileTime({ rkey: '3myfnyphiuw2t', value: { createdAt: '2030-01-01T00:00:00Z' } }, now), t);
});

const tileRec = (did, rkey, name, createdAt) => ({ uri: `at://${did}/ing.dasl.masl/${rkey}`, rkey, cid: 'bafy', value: { tile: { name, resources: { '/': { src: { $link: 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaa' } } } }, createdAt } });

test('Following: kept accounts, newest first, mixed, hidden left out, "New" since the last visit', async () => {
  const B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', C = 'did:plc:cccccccccccccccccccccccc', X = 'did:plc:xxxxxxxxxxxxxxxxxxxxxxxx';
  const lists = {
    [DID]: [tileRec(DID, 'a2', 'A two', '2026-10-20T00:00:00Z'), tileRec(DID, 'a1', 'A one', '2026-10-10T00:00:00Z'), tileRec(DID, 'hid', 'Hidden', '2026-10-21T00:00:00Z'),
      { uri: `at://${DID}/ing.dasl.masl/flat`, rkey: 'flat', value: { name: 'flat' } }],
    [B]: [tileRec(B, 'b1', 'B one', '2026-10-15T00:00:00Z')],
    [X]: [tileRec(X, 'x1', 'X one', '2026-10-21T00:00:00Z')],
  };
  const asked = [];
  const resolver = { listTiles: async (did, cursor, limit) => { asked.push([did, limit]); if (did === C) throw new Error('down'); return { records: lists[did] || [], cursor: null }; } };
  const moderation = { isAccountHidden: async (did) => did === X, onHideList: async (did, rkey) => rkey === 'hid' };
  let accounts = [{ did: DID }, { did: B }, { did: C }, { did: X }];
  const shelf = { accounts: () => accounts };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let clock = Date.parse('2026-10-21T06:00:00Z');
  const f = createFollowing({ resolver, moderation, shelf, storage, now: () => clock });
  const r = await f.load();
  assert.deepEqual(r.items.map((i) => i.rkey), ['a2', 'b1', 'a1']);
  assert.equal(r.unreachable, 1);
  assert.equal(r.accounts, 4);
  assert.ok(asked.every(([, limit]) => limit === 10), 'the newest few of each');
  assert.equal(f.lastSeen(), null);
  assert.ok(r.items.every((i) => !f.isNew(i)), 'a first visit marks nothing');
  f.markSeen();
  assert.equal(JSON.parse(store.get('raku-marks')).seen.following, new Date(clock).toISOString(), 'kept in the marks entry (marks.js)');
  await f.load();
  assert.equal(asked.length, 3, 'kept a few minutes');
  // next page load: a new tile since the last visit
  lists[B].unshift(tileRec(B, 'b2', 'B two', '2026-10-21T07:00:00Z'));
  clock += 10 * 60 * 1000;
  const g = createFollowing({ resolver, moderation, shelf, storage, now: () => clock });
  const r2 = await g.load();
  assert.deepEqual(r2.items.filter((i) => g.isNew(i)).map((i) => i.rkey), ['b2']);
  accounts = [{ did: B }];
  const r3 = await g.load();
  assert.deepEqual(r3.items.map((i) => i.rkey), ['b2', 'b1'], 'a changed shelf looks again');
});

test("search: only addresses are read from appmosphe.re's answer, whatever its shape", () => {
  const shapes = [
    { results: [{ uri: `at://${PYX}/ing.dasl.masl/3mx6h2wjtgq2h`, name: 'Roller Coaster' }, { uri: `at://${PYX}/app.bsky.feed.post/3x` }] },
    [{ did: PYX, rkey: '3mx6h2wjtgq2h', author: { did: PYX } }],
    { hits: [{ url: 'https://appmosphe.re/@pyxorium.com/3mx6h2wjtgq2h' }, { link: 'tile://3mx6h2wjtgq2h.did%3Aplc%3Arqbqpaaluty5v47jwciowpik/' }] },
    { data: { tiles: [{ record: { uri: `at://${PYX}/ing.dasl.masl/3mx6h2wjtgq2h` } }] } },
  ];
  assert.deepEqual(addressesFrom(shapes[0]).map((a) => a.uri), [`at://${PYX}/ing.dasl.masl/3mx6h2wjtgq2h`]);
  assert.deepEqual(addressesFrom(shapes[1]).map((a) => a.rkey), ['3mx6h2wjtgq2h']);
  assert.deepEqual(addressesFrom(shapes[2]).map((a) => a.uri), ['at://pyxorium.com/ing.dasl.masl/3mx6h2wjtgq2h', `at://${PYX}/ing.dasl.masl/3mx6h2wjtgq2h`]);
  assert.equal(addressesFrom(shapes[3]).length, 1);
  const many = { results: Array.from({ length: 50 }, (_, i) => ({ uri: `at://${PYX}/ing.dasl.masl/k${i}` })) };
  assert.equal(addressesFrom(many).length, SEARCH.max);
  assert.deepEqual(addressesFrom('junk'), []);
  assert.deepEqual(addressesFrom(null), []);
});

test('search: one request to appmosphe.re with only the words, no cookies; errors said plainly', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return Response.json({ results: [{ uri: `at://${PYX}/ing.dasl.masl/3mx6h2wjtgq2h` }] }); };
  const r = await searchAppmosphere('roller coaster', { fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://appmosphe.re/api/search?q=roller%20coaster');
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal(calls[0].opts.referrerPolicy, 'no-referrer');
  await assert.rejects(searchAppmosphere('x', { fetchImpl: async () => new Response('no', { status: 503 }) }), /answered 503/);
});

test('search: your own things, matched here in the browser', () => {
  const shelf = {
    tiles: () => [{ did: DID, rkey: 'a', name: 'Roller Coaster', by: 'pyxorium.com' }, { did: DID, rkey: 'b', name: 'Glass Lantern', by: 'thunderbird.cafe' }],
    accounts: () => [{ did: PYX, handle: 'pyxorium.com' }],
  };
  const r = localMatches('roller', { shelf, others: [{ did: PYX, rkey: 'c', name: 'Moab Red Hot', description: 'a roller of dice' }, { did: DID, rkey: 'a', name: 'Roller Coaster' }] });
  assert.deepEqual(r.tiles.map((t) => t.rkey), ['a', 'c']);
  assert.deepEqual(localMatches('@pyxorium', { shelf }).accounts.map((a) => a.handle), ['pyxorium.com']);
  assert.deepEqual(localMatches('glass thunderbird', { shelf }).tiles.map((t) => t.rkey), ['b'], 'every word');
  assert.deepEqual(searchWords('  #Web   Tiles '), ['web', 'tiles']);
});

test('public reads: a feed from the AppView named in config, kept two minutes, a bad address refused', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return Response.json({ feed: [{ post: cardPost }, { nothing: 1 }], cursor: 'next' }); };
  let clock = 0;
  const reads = createPublicReads({ fetchImpl, now: () => clock });
  const feed = `at://${DID}/app.bsky.feed.generator/web-tiles`;
  const one = await reads.getFeed(feed);
  assert.equal(one.posts.length, 1);
  assert.equal(one.cursor, 'next');
  assert.ok(calls[0].startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=at%3A%2F%2F'));
  await reads.getFeed(feed);
  assert.equal(calls.length, 1);
  clock += 3 * 60 * 1000;
  await reads.getFeed(feed);
  assert.equal(calls.length, 2);
  await assert.rejects(reads.getFeed('https://evil.example/'), /isn't a feed/);
  await assert.rejects(createPublicReads({ fetchImpl: async () => new Response('x', { status: 500 }) }).getFeed(feed), /answered 500/);
});

// ---------- Q97: a reply with its thread ----------
import { threadContext as ctxOf } from '../src/posts.js';
const pv = (did, rkey, text, replyTo = null, extra = {}) => ({
  $type: 'app.bsky.feed.defs#postView', uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: `bafyrei${rkey}`,
  author: { did, handle: 'maker.example.com', labels: [] }, labels: [],
  record: { $type: 'app.bsky.feed.post', text, createdAt: '2026-10-20T00:00:00Z', ...(replyTo ? { reply: { root: { uri: replyTo.root }, parent: { uri: replyTo.parent } } } : {}) },
  ...extra,
});
test('a reply in a feed: the first post, the post it answers, and whether posts were skipped (Q97)', () => {
  const R = `at://${MAKER}/app.bsky.feed.post/root1`;
  const P = `at://${MAKER}/app.bsky.feed.post/par1`;
  const root = pv(MAKER, 'root1', 'Anyone noticed?');
  const parent = pv(MAKER, 'par1', 'First reply', { root: R, parent: R });
  const reply = pv(MAKER, 'rep1', 'Second reply', { root: R, parent: P });
  // the owner's example: root → a reply to it → a reply to that; no gap
  const c = ctxOf({ post: reply, reply: { root, parent } });
  assert.equal(c.root.text, 'Anyone noticed?');
  assert.equal(c.parent.text, 'First reply');
  assert.equal(c.gap, false);
  assert.deepEqual(readPost(reply).replyTo, { root: R, parent: P });
  // a direct reply to the first post: only the first post above it
  const d = ctxOf({ post: parent, reply: { root, parent: root } });
  assert.equal(d.root.text, 'Anyone noticed?');
  assert.equal(d.parent, null);
  // posts in between not shown: the parent answers something else
  const deep = pv(MAKER, 'deep1', 'Deeper', { root: R, parent: `at://${MAKER}/app.bsky.feed.post/mid1` });
  assert.equal(ctxOf({ post: reply, reply: { root, parent: deep } }).gap, true);
  // deleted, blocked or hidden: "Post not available"
  const gone = ctxOf({ post: reply, reply: { root: { $type: 'app.bsky.feed.defs#notFoundPost', uri: R, notFound: true }, parent } });
  assert.deepEqual(gone.root, { unavailable: true, uri: R });
  const blocked = ctxOf({ post: reply, reply: { root: { $type: 'app.bsky.feed.defs#blockedPost', uri: R, blocked: true }, parent } });
  assert.equal(blocked.root.unavailable, true);
  const hid = ctxOf({ post: reply, reply: { root: { ...root, labels: [{ src: LABELER, val: '!hide' }] }, parent } });
  assert.equal(hid.root.unavailable, true);
  assert.equal(ctxOf({ post: reply }), null, 'no thread sent: none drawn');
});

test('public reads: a feed item keeps its thread context', async () => {
  const R = `at://${MAKER}/app.bsky.feed.post/root1`;
  const fetchImpl = async () => Response.json({ feed: [{ post: pv(MAKER, 'rep1', 'r', { root: R, parent: R }), reply: { root: pv(MAKER, 'root1', 'first'), parent: pv(MAKER, 'root1', 'first') } }, { post: pv(MAKER, 'solo1', 's') }] });
  const page = await createPublicReads({ fetchImpl }).getFeed(`at://${DID}/app.bsky.feed.generator/Web-Tiles`);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].reply.root.record.text, 'first');
  assert.equal(page.items[1].reply, null);
  assert.equal(page.posts.length, 2);
});

test('Tile news, one card per thread (Q123): later replies counted on the first card; posts already drawn left out', () => {
  const U = (k) => `at://${MAKER}/app.bsky.feed.post/${k}`;
  const post = (k, replyTo = null) => ({ uri: U(k), replyTo });
  const reply = (k, root, parent) => ({ post: post(k, { root: U(root), parent: U(parent) }), context: { root: { uri: U(root) }, parent: parent === root ? null : { uri: U(parent) } } });
  assert.equal(threadKey({ post: post('solo') }), U('solo'));
  assert.equal(threadKey(reply('r1', 'top', 'top')), U('top'));
  assert.equal(threadKey({ post: post('lone', { root: U('zz'), parent: U('zz') }) }), U('zz'), 'a reply without its thread: its root still counts');
  const seen = { threads: new Map(), posts: new Set() };
  const one = groupThreads([
    reply('r3', 'top', 'r2'),          // newest: kept, with top and r2 as context
    reply('r2', 'top', 'top'),         // drawn already (as r3's context): left out, not counted
    reply('r1', 'top', 'top'),         // same thread, not drawn yet: counted
    { post: post('solo') },
    { post: post('top') },             // the thread's first post on its own: drawn already
  ], seen);
  assert.deepEqual(one.added.map((g) => g.item.post.uri), [U('r3'), U('solo')]);
  assert.equal(one.added[0].more, 1);
  assert.equal(one.counted.size, 0, 'counted on a card drawn in this same batch');
  const two = groupThreads([reply('r0', 'top', 'top'), { post: post('next') }], seen);   // More: the next page
  assert.deepEqual(two.added.map((g) => g.item.post.uri), [U('next')]);
  assert.deepEqual([...two.counted].map((g) => [g.item.post.uri, g.more]), [[U('r3'), 2]], 'a reply on a later page counts on the same card');
});
