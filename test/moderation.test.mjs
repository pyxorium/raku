import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeration, sha256Hex, accountKey, tileKey, parseCodedList, hidingLabel, sniffPicture } from '../src/moderation.js';
import { BLUESKY_MODERATION } from '../src/config.js';

const SALT = 'lexicographer.space hide list v1';
const D1 = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const D2 = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

async function list() {
  return { version: 1, salt: SALT, accounts: [await sha256Hex(accountKey(SALT, D1))], tiles: [await sha256Hex(tileKey(SALT, D2, 'hidden1'))] };
}

function fakeNet({ hideList, profiles = {}, failList = false }) {
  const calls = { list: 0, profile: 0 };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('hidden-tiles.json')) { calls.list++; return failList ? new Response('x', { status: 500 }) : Response.json(hideList); }
    if (u.pathname.endsWith('getProfile')) {
      calls.profile++;
      const p = profiles[u.searchParams.get('actor')];
      if (p === 'down') return new Response('x', { status: 503 });
      if (p === 'takedown') return Response.json({ error: 'AccountTakedown' }, { status: 400 });
      return Response.json({ labels: p || [] });
    }
    return new Response('?', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('the coded list hides whole accounts and single tiles, by hash only', async () => {
  const { fetchImpl } = fakeNet({ hideList: await list() });
  const m = createModeration({ fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json' });
  assert.equal(await m.isHidden(D1, 'anything'), true);
  assert.equal(await m.isHidden(D2, 'hidden1'), true);
  assert.equal(await m.isHidden(D2, 'shown'), false);
});

test('Bluesky moderation: takedowns and its own !hide / !takedown labels, still in force', async () => {
  const now = Date.now();
  const lab = (val, extra = {}) => ({ src: BLUESKY_MODERATION, val, ...extra });
  assert.equal(hidingLabel(lab('!hide'), now), true);
  assert.equal(hidingLabel(lab('!takedown'), now), true);
  assert.equal(hidingLabel(lab('!hide', { neg: true }), now), false);
  assert.equal(hidingLabel(lab('!hide', { exp: new Date(now - 1000).toISOString() }), now), false);
  assert.equal(hidingLabel(lab('porn'), now), false);
  assert.equal(hidingLabel({ src: 'did:plc:someoneelse', val: '!hide' }, now), false);

  const { fetchImpl, calls } = fakeNet({ hideList: await list(), profiles: { [D2]: [lab('!hide')], 'did:plc:cccccccccccccccccccccccc': 'takedown', 'did:plc:dddddddddddddddddddddddd': 'down' } });
  const m = createModeration({ fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json' });
  assert.equal(await m.isHidden(D2, 'shown'), true);
  assert.equal(await m.isHidden('did:plc:cccccccccccccccccccccccc', 'x'), true);
  assert.equal(await m.isHidden('did:plc:dddddddddddddddddddddddd', 'x'), false, 'Bluesky down: shown');
  const before = calls.profile;
  await m.isHidden(D2, 'shown');
  assert.equal(calls.profile, before, 'answers are kept');
});

test('a failed download keeps the last copy; a malformed list is ignored', async () => {
  let t = 0;
  const net = fakeNet({ hideList: await list() });
  const m = createModeration({ fetchImpl: net.fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json', now: () => t });
  assert.equal(await m.isHidden(D1, 'x'), true);
  net.fetchImpl = undefined;
  const broken = createModeration({ fetchImpl: fakeNet({ failList: true }).fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json' });
  assert.equal(await broken.isHidden(D1, 'x'), false);
  assert.equal(parseCodedList({ version: 1, salt: 's', accounts: ['nothex'], tiles: [] }), null);
  assert.equal(parseCodedList({ version: 2, salt: 's', accounts: [], tiles: [] }), null);
  // stored copy from an earlier visit
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  await createModeration({ fetchImpl: fakeNet({ hideList: await list() }).fetchImpl, listUrl: 'https://l.example.com/hidden-tiles.json', storage }).refresh();
  const offline = createModeration({ fetchImpl: fakeNet({ failList: true }).fetchImpl, listUrl: 'https://l.example.com/hidden-tiles.json', storage });
  assert.equal(await offline.isHidden(D1, 'x'), true);
});

test('the list is checked again after an hour', async () => {
  let t = 0;
  const { fetchImpl, calls } = fakeNet({ hideList: await list() });
  const m = createModeration({ fetchImpl, listUrl: 'https://lexicographer.space/hidden-tiles.json', now: () => t });
  await m.isHidden(D2, 'x');
  await m.isHidden(D2, 'y');
  assert.equal(calls.list, 1);
  t += 61 * 60 * 1000;
  await m.isHidden(D2, 'z');
  assert.equal(calls.list, 2);
});

test('card pictures: only plain picture types', () => {
  assert.equal(sniffPicture(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), 'image/png');
  assert.equal(sniffPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffPicture(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml');
  assert.equal(sniffPicture(new TextEncoder().encode('<html><script>')), null);
});
