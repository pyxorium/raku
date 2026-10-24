// Hand-picked posts in Tile news (Oct 24, claude/raku-tile-news-pins-plan.md): read once with the feed, mixed
// in by date (P1 A), checked like feed posts, never twice. Plain data, no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscover } from '../src/discover.js';
import { FEED, NEWS_PINS } from '../src/config.js';
import { groupThreads } from '../src/posts.js';

const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const R = 'did:plc:izttpdp3l6vss5crelt5kcux';
const HIDDEN = 'did:plc:hhhhhhhhhhhhhhhhhhhhhhhh';
const view = (did, rkey, createdAt, extra = {}) => ({
  uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: `bafy${rkey}`, author: { did, handle: 'x.example' },
  record: { $type: 'app.bsky.feed.post', text: rkey, createdAt }, indexedAt: createdAt, labels: [], ...extra,
});

// A stand-in AppView: the feed in pages of `size`, and getPosts for whatever it holds.
function appview({ feed, posts, size = 2, failPosts = 0, cursorAtEnd = false }) {
  const calls = { feed: 0, posts: 0, uris: [] };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('getFeed')) {
      calls.feed++;
      const from = Number(u.searchParams.get('cursor') || 0);
      const slice = feed.slice(from, from + size);
      const more = from + size < feed.length;
      return json({ feed: slice.map((post) => ({ post })), cursor: more ? String(from + size) : (cursorAtEnd ? 'end' : undefined) });
    }
    if (u.pathname.endsWith('getPosts')) {
      calls.posts++;
      const want = u.searchParams.getAll('uris');
      calls.uris.push(want.length);
      if (failPosts > 0) { failPosts--; return new Response('no', { status: 502 }); }
      return json({ posts: posts.filter((p) => want.includes(p.uri)) });
    }
    return new Response('?', { status: 404 });
  };
  return { fetchImpl, calls };
}
const moderation = { isAccountHidden: async (did) => did === HIDDEN };
const make = (av, pins) => createDiscover({ moderation, resolver: null, shelf: { accounts: () => [] }, storage: null,
  loc: { hostname: 'raku.lexicographer.space', search: '' }, fetchImpl: av.fetchImpl, pins });
async function all(d) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const r = await d.news({ cursor });
    out.push(r.items.map((x) => `${x.post.text}${x.pinned ? '*' : ''}`));
    cursor = r.cursor;
    if (!cursor) break;
  }
  return out;
}

test('config: hand-picked posts are post addresses by DID, oldest first, no repeats; the real feed gets them', () => {
  assert.ok(NEWS_PINS.length >= 10);
  for (const u of NEWS_PINS) assert.match(u, /^at:\/\/did:plc:[a-z2-7]{24}\/app\.bsky\.feed\.post\/[a-z2-7]{13}$/);
  assert.equal(new Set(NEWS_PINS).size, NEWS_PINS.length, 'no post twice');
  const keys = NEWS_PINS.map((u) => u.split('/').pop());
  assert.deepEqual([...keys].sort(), keys, 'oldest first (record keys are times)');
  const av = appview({ feed: [], posts: [] });
  createDiscover({ moderation, shelf: { accounts: () => [] }, loc: { hostname: 'raku.lexicographer.space', search: '' }, fetchImpl: av.fetchImpl });
  assert.equal(FEED.endsWith('/Web-Tiles'), true);
});

test('mixed in by date: each page gets the ones between its oldest post and the last page\'s; the rest after the feed', async () => {
  const feed = [view(A, 'f1', '2026-10-20T00:00:00Z'), view(A, 'f2', '2026-10-10T00:00:00Z'),
    view(A, 'f3', '2026-10-05T00:00:00Z'), view(A, 'f4', '2026-09-28T00:00:00Z')];
  const posts = [view(R, 'pnew', '2026-10-22T00:00:00Z'), view(R, 'pmid', '2026-10-07T00:00:00Z'),
    view(R, 'pold', '2026-04-13T00:00:00Z'), view(R, 'poldest', '2023-04-28T00:00:00Z')];
  const av = appview({ feed, posts });
  const d = make(av, posts.map((p) => p.uri));
  assert.deepEqual(await all(d), [
    ['pnew*', 'f1', 'f2'],                           // newer than the whole feed: first, before f1
    ['pmid*', 'f3', 'f4', 'pold*', 'poldest*'],      // pmid (Oct 7) on the page its date falls in, before f3 (Oct 5); the last page takes the older ones
  ]);
  assert.equal(av.calls.posts, 1, 'read once, not per page');
});

test('a feed that hands out a cursor to an empty page: the old ones show on that page, then no More', async () => {
  const feed = [view(A, 'f1', '2026-10-20T00:00:00Z'), view(A, 'f2', '2026-10-10T00:00:00Z')];
  const posts = [view(R, 'pold', '2026-04-13T00:00:00Z')];
  const d = make(appview({ feed, posts, cursorAtEnd: true }), posts.map((p) => p.uri));
  assert.deepEqual(await all(d), [['f1', 'f2'], ['pold*']]);
});

test('checked like feed posts: hidden accounts and hidden labels left out; a post also in the feed shows once', async () => {
  const feed = [view(A, 'f1', '2026-10-20T00:00:00Z'), view(R, 'both', '2026-10-15T00:00:00Z')];
  const posts = [view(R, 'both', '2026-10-15T00:00:00Z'), view(HIDDEN, 'hid', '2025-01-01T00:00:00Z'),
    view(R, 'hidlab', '2025-02-01T00:00:00Z', { labels: [{ src: 'did:plc:ar7c4by46qjdydhdevvrndac', uri: `at://${R}/app.bsky.feed.post/hidlab`, val: '!hide', cts: '2025-02-01T00:00:00Z' }] }),
    view(R, 'ok', '2025-03-01T00:00:00Z')];
  const d = make(appview({ feed, posts, size: 5 }), posts.map((p) => p.uri).concat([`at://${R}/app.bsky.feed.post/gone`]));
  const pages = await all(d);
  assert.deepEqual(pages, [['f1', 'both', 'ok*']], 'deleted ("gone") and hidden ones simply drop out');
  const r = await d.news();
  assert.equal(groupThreads(r.items).added.length, 3, 'one card each');
});

test('a failed read: the feed still shows, and the hand-picked posts are tried again next time', async () => {
  const feed = [view(A, 'f1', '2026-10-20T00:00:00Z')];
  const posts = [view(R, 'pold', '2026-04-13T00:00:00Z')];
  const av = appview({ feed, posts, failPosts: 1 });
  const d = make(av, posts.map((p) => p.uri));
  assert.deepEqual((await d.news()).items.map((x) => x.post.text), ['f1']);
  assert.deepEqual((await d.news({ fresh: true })).items.map((x) => x.post.text), ['f1', 'pold']);
});

test('more than 25: read 25 to a request', async () => {
  const posts = Array.from({ length: 30 }, (_, i) => view(R, `p${String(i).padStart(2, '0')}`, `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`.replace('-31T', '-30T')));
  const av = appview({ feed: [], posts });
  const d = make(av, posts.map((p) => p.uri));
  const r = await d.news();
  assert.deepEqual(av.calls.uris, [25, 5]);
  assert.equal(r.items.length, 30);
  assert.equal(r.cursor, null);
});

test('no hand-picked posts for a stand-in feed (?feed= on this computer)', async () => {
  const f = `at://${A}/app.bsky.feed.generator/other`;
  const av = appview({ feed: [view(A, 'f1', '2026-10-20T00:00:00Z')], posts: [] });
  const d = createDiscover({ moderation, shelf: { accounts: () => [] }, loc: { hostname: '127.0.0.1', search: `?feed=${encodeURIComponent(f)}` }, fetchImpl: av.fetchImpl });
  await d.news();
  assert.equal(av.calls.posts, 0);
});
