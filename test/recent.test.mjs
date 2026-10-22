// Stage 6c: Recent tiles (appmosphe.re's list) and the "last visit" marks. Plain data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecentPage, recentPicture, createRecent } from '../src/recent.js';
import { createMarks } from '../src/marks.js';
import { createModeration, blurringLabels } from '../src/moderation.js';
import { parseTarget, discoverUri } from '../src/address.js';
import { RECENT } from '../src/config.js';
import { whenText } from '../src/posts.js';

const A = 'did:plc:makeraaaaaaaaaaaaaaaaaaa';
const B = 'did:plc:makerbbbbbbbbbbbbbbbbbbb';
const C = 'did:plc:makercccccccccccccccccccc'.slice(0, 32);
const LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac';
const IMG = (did, cid) => `https://appmosphe.re/img/${did}/${cid}`;

const memStore = () => {
  const m = new Map();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const entry = (did, rkey, name, createdAt, extra = {}) => ({
  uri: `at://${did}/ing.dasl.masl/${rkey}`, did, rkey, handle: 'whatever.example', name, description: null,
  icon: IMG(did, 'bafkreiicon'), screenshots: [], createdAt, author: { did, handle: 'whatever.example' }, ...extra,
});

test('Recent tiles address', () => {
  assert.equal(parseTarget('raku:discover/recent').source, 'recent');
  assert.equal(parseTarget(discoverUri('recent')).uri, 'raku:discover/recent');
});

test("appmosphe.re's list is read carefully: addresses Raku can open, pictures only from its /img/ copies", () => {
  const page = readRecentPage({
    total: 183, page: 1, pages: 7,
    tiles: [
      entry(A, '3myh3kq4f6227', '  Atproto   Web Names ', '2026-10-22T06:57:43.630Z', { screenshots: [{ url: IMG(A, 'bafkreishot') }] }),
      entry(A, '3myh2c76z7s2b', '', '2026-10-22T06:35:03.714Z'),                                  // icon only, no name
      entry(B, '3mybbbbbbbbbb', 'Elsewhere picture', 'not a date', { icon: 'https://evil.example/x.png', screenshots: [{ url: 'http://appmosphe.re/img/x' }] }),
      entry('did:example:nope', '3mx', 'Bad DID', '2026-10-22T00:00:00Z'),
      entry(B, '../x', 'Bad key', '2026-10-22T00:00:00Z'),
      entry(A, '3myh3kq4f6227', 'Repeat', '2026-10-22T06:57:43.630Z'),
      { did: B, rkey: '3mycccccccccc', name: 'x'.repeat(500), description: 'y '.repeat(400), icon: { url: '/img/did/cid' } },
      null, 'junk',
    ],
  });
  assert.deepEqual([page.page, page.pages, page.total], [1, 7, 183]);
  assert.deepEqual(page.tiles.map((t) => t.rkey), ['3myh3kq4f6227', '3myh2c76z7s2b', '3mybbbbbbbbbb', '3mycccccccccc']);
  const [one, two, three, four] = page.tiles;
  assert.equal(one.name, 'Atproto Web Names');
  assert.equal(one.picture, IMG(A, 'bafkreishot'));
  assert.equal(one.pictureIsIcon, false);
  assert.equal(one.uri, `at://${A}/ing.dasl.masl/3myh3kq4f6227`);
  assert.equal(two.name, 'Untitled tile');
  assert.equal(two.pictureIsIcon, true, 'no screenshot: the icon, drawn whole');
  assert.equal(three.picture, null, 'pictures from anywhere else are left out');
  assert.equal(three.createdAt, '');
  assert.equal(four.name.length, 120);
  assert.ok(four.description.length <= 300);
  assert.equal(four.picture, 'https://appmosphe.re/img/did/cid', 'a relative /img/ address is read against appmosphe.re');
  assert.equal(recentPicture('https://appmosphe.re/imgx/a'), null);
  assert.equal(recentPicture('https://user:pw@appmosphe.re/img/a'), null);
  assert.deepEqual(readRecentPage(null), { page: 0, pages: 0, total: 0, tiles: [] });
});

/** A stand-in network: appmosphe.re's pages, Bluesky's getProfiles / getProfile, the hide list. */
function fakeNet({ pages, profiles = {}, missing = new Set(), hideList = null, failTiles = false }) {
  const calls = [];
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'appmosphe.re' && u.pathname === '/api/tiles') {
      if (failTiles) return res(503, {});
      const n = Number(u.searchParams.get('page'));
      return res(200, pages[n] || { page: n, pages: Object.keys(pages).length, total: 0, tiles: [] });
    }
    if (u.pathname === '/xrpc/app.bsky.actor.getProfiles') {
      const actors = u.searchParams.getAll('actors');
      return res(200, { profiles: actors.filter((d) => !missing.has(d)).map((d) => ({ did: d, handle: 'handle.invalid', labels: [], ...(profiles[d] || {}) })) });
    }
    if (u.pathname === '/xrpc/app.bsky.actor.getProfile') {
      const d = u.searchParams.get('actor');
      return missing.has(d) ? res(400, { error: 'AccountTakedown' }) : res(200, { did: d, handle: 'x.example', labels: [] });
    }
    if (u.pathname === '/hidden-tiles.json') return hideList ? res(200, hideList) : res(404, {});
    return res(404, {});
  };
  return { fetchImpl, calls };
}

test('Recent tiles: hidden accounts and tiles left out, checked handles, blurred pictures, More, one Bluesky request per 25 authors', async () => {
  const { sha256Hex, accountKey, tileKey } = await import('../src/moderation.js');
  const salt = 'test salt';
  const hideList = { version: 1, salt, accounts: [await sha256Hex(accountKey(salt, C))], tiles: [await sha256Hex(tileKey(salt, A, '3myahidden22'))] };
  const many = Array.from({ length: 30 }, (_, i) => `did:plc:${String(i).padStart(2, 'a').replace(/\d/g, (d) => 'abcdefghij'[d])}${'q'.repeat(22)}`);
  const pages = {
    1: { page: 1, pages: 2, total: 34, tiles: [
      entry(A, '3myafirst2222', 'First', '2026-10-22T06:00:00Z'),
      entry(A, '3myahidden22', 'Hidden tile', '2026-10-22T05:00:00Z'),
      entry(B, '3mybadult2222', 'Labelled account', '2026-10-22T04:00:00Z'),
      entry(C, '3mycgone22222', 'Hidden account', '2026-10-22T03:00:00Z'),
      ...many.map((d, i) => entry(d, `3mymany${'abcdefghijklmnopqrstuvwxyz234'[i]}22222`.slice(0, 13), `Many ${i}`, '2026-10-21T00:00:00Z')),
    ] },
    2: { page: 2, pages: 2, total: 34, tiles: [entry(A, '3myalast22222', 'Last', '2026-10-01T00:00:00Z')] },
  };
  const net = fakeNet({
    pages, hideList,
    profiles: {
      [A]: { handle: 'maker-a.example', labels: [] },
      [B]: { handle: 'maker-b.example', labels: [{ src: LABELER, val: 'porn', uri: `at://${B}`, cts: '2026-01-01T00:00:00Z' }] },
    },
    missing: new Set([many[3]]),
  });
  const moderation = createModeration({ fetchImpl: net.fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json' });
  const storage = memStore();
  let clock = Date.parse('2026-10-22T07:00:00Z');
  const recent = createRecent({ moderation, storage, fetchImpl: net.fetchImpl, now: () => clock });
  const p1 = await recent.load(1);
  const names = p1.tiles.map((t) => t.name);
  assert.ok(!names.includes('Hidden tile') && !names.includes('Hidden account'), 'the hide list: a tile, and a whole account');
  assert.ok(!names.includes('Many 3'), 'an account taken down by Bluesky');
  assert.deepEqual(names.slice(0, 2), ['First', 'Labelled account'], "appmosphe.re's order, as it is");
  assert.equal(p1.tiles[0].handle, 'maker-a.example', 'the handle Bluesky checked');
  assert.equal(p1.tiles[2].handle, '', 'handle.invalid: no handle (the card shows the DID)');
  assert.equal(p1.tiles[1].blur, true, 'an adult-labelled account: pictures blurred');
  assert.equal(p1.tiles[0].blur, false);
  assert.equal(p1.more, true);
  const batches = net.calls.filter((c) => c.includes('getProfiles'));
  assert.equal(batches.length, 2, '33 authors: two requests');
  assert.ok(batches.every((c) => new URL(c).searchParams.getAll('actors').length <= 25));
  assert.equal(net.calls.filter((c) => c.includes('getProfile?')).length, 1, 'only the missing account asked alone');
  await recent.load(1);
  assert.equal(net.calls.filter((c) => c.includes('/api/tiles')).length, 1, 'kept a few minutes');
  const p2 = await recent.load(2);
  assert.deepEqual(p2.tiles.map((t) => t.name), ['Last']);
  assert.equal(p2.more, false, "the last page: That's every tile");
  assert.deepEqual(net.calls.filter((c) => c.includes('/api/tiles')), [`${RECENT.url}?page=1`, `${RECENT.url}?page=2`]);
  assert.ok(recent.loaded().some((t) => t.name === 'Last'), 'loaded tiles count for search');

  // "New" since the last visit (this device only)
  assert.ok(p1.tiles.every((t) => !recent.isNew(t)), 'a first visit marks nothing');
  recent.markSeen();
  pages[1].tiles.unshift(entry(A, '3myanew222222', 'Newer', '2026-10-22T08:00:00Z'));
  clock += 2 * 3600 * 1000;
  const again = createRecent({ moderation, storage, fetchImpl: net.fetchImpl, now: () => clock });
  const r = await again.load(1);
  assert.deepEqual(r.tiles.filter((t) => again.isNew(t)).map((t) => t.name), ['Newer']);

  const down = createRecent({ moderation, storage, fetchImpl: fakeNet({ pages, failTiles: true }).fetchImpl });
  await assert.rejects(down.load(1), /appmosphe\.re answered 503/);
});

test('marks: one record-shaped entry, kept on this device; Following\'s older entry moves in', async () => {
  const storage = memStore();
  storage.setItem('raku-following-seen', String(Date.parse('2026-10-20T00:00:00Z')));
  const marks = createMarks({ storage, now: () => Date.parse('2026-10-22T00:00:00Z') });
  assert.equal(await marks.lastSeen('following'), Date.parse('2026-10-20T00:00:00Z'));
  assert.equal(storage.getItem('raku-following-seen'), null, 'the older entry is gone');
  assert.equal(await marks.lastSeen('recent'), null);
  await marks.markSeen('recent');
  await marks.markSeen('following');
  const rec = JSON.parse(storage.getItem('raku-marks'));
  assert.deepEqual(rec, { format: 'raku-marks', version: 1, seen: { following: '2026-10-22T00:00:00.000Z', recent: '2026-10-22T00:00:00.000Z' } });
  assert.equal(await marks.lastSeen('following'), Date.parse('2026-10-20T00:00:00Z'), 'this page load still compares against the visit before');
  const broken = createMarks({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(await broken.lastSeen('recent'), null, 'blocked storage: no marks, nothing breaks');
  await broken.markSeen('recent');
  storage.setItem('raku-marks', '{"format":"other"}');
  assert.equal(await createMarks({ storage }).lastSeen('recent'), null);
});

test('account labels that blur pictures: Bluesky\'s service or the account itself; not negated or expired', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  assert.equal(blurringLabels([{ src: LABELER, val: 'nudity' }], A, now), true);
  assert.equal(blurringLabels([{ src: A, val: 'porn' }], A, now), true, 'a self-label');
  assert.equal(blurringLabels([{ src: 'did:plc:someoneelse', val: 'porn' }], A, now), false);
  assert.equal(blurringLabels([{ src: LABELER, val: 'porn', neg: true }], A, now), false);
  assert.equal(blurringLabels([{ src: LABELER, val: 'gore', exp: '2026-01-01T00:00:00Z' }], A, now), false);
  assert.equal(blurringLabels([{ src: LABELER, val: '!hide' }], A, now), false);
});

test('card times read "3h ago", "just now", or a date', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.deepEqual([at(10e3), at(5 * 60e3), at(3 * 3600e3), at(2 * 86400e3), '2026-10-01T00:00:00Z', 'nope'].map((x) => whenText(x, now)),
    ['just now', '5m ago', '3h ago', '2d ago', 'Oct 1', '']);
});
