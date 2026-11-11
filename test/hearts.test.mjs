// Hearts on tile posts (claude/raku-hearts-plan.md, HT1 to HT15): reading hearts, counting, and saving yours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHearts, readHeart, buildHeartRecord, heartAccounts, isPostUri, HeartError, HEART_COLLECTION } from '../src/hearts.js';
import { HEARTS, coversHearts, coversPosts, coversRaku, rakuSet, SIGNIN_PROMISE, PERMISSION_LINE } from '../src/config.js';
import { SignInNeeded } from '../src/auth.js';

const A = 'did:plc:6vxjigxrqizmbo56gojxico3';
const B = 'did:plc:rqbqpaaluty5v47jwciowpik';
const C = 'did:plc:ro563p5faldqu44apudq44k4';
const H = 'did:plc:hiddenaaaaaaaaaaaaaaaaaa';
const ME = 'did:plc:joer5rzmwgec3dkr4srfmq45';
const P1 = `at://${A}/cafe.thunderbird.tile.post/3mza1`;
const P2 = `at://${B}/cafe.thunderbird.tile.post/3mzb1`;
const CID = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const heart = (did, rkey, subject, extra = {}) => ({ uri: `at://${did}/${HEART_COLLECTION}/${rkey}`, cid: CID, value: { $type: HEART_COLLECTION, subject: { uri: subject, cid: CID }, createdAt: '2026-11-11T10:00:00.000Z', ...extra } });

function world({ relay = [A, B, C, H, ME], hearts = {}, relayDown = false, down = [], pageSize = 100 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('listReposByCollection')) {
      if (relayDown) return json({ error: 'down' }, 502);
      assert.equal(u.searchParams.get('collection'), HEART_COLLECTION);
      return json({ repos: relay.map((did) => ({ did })) });
    }
    if (u.pathname.endsWith('listRecords')) {
      const did = u.searchParams.get('repo');
      if (down.includes(did)) return json({ error: 'InternalServerError' }, 500);
      assert.equal(u.searchParams.get('collection'), HEART_COLLECTION);
      const all = hearts[did] || [];
      const start = +(u.searchParams.get('cursor') || 0);
      const page = all.slice(start, start + pageSize);
      return json({ records: page, ...(start + pageSize < all.length ? { cursor: String(start + pageSize) } : {}) });
    }
    return json({ error: 'NotFound' }, 404);
  };
  const resolver = { account: async (did) => ({ pds: 'https://pds.fakepds.net' }) };
  const moderation = { profiles: async () => {}, isAccountHidden: async (did) => did === H };
  return { fetchImpl, calls, resolver, moderation };
}
const fakeAuth = ({ fail = null, slow = 0 } = {}) => {
  const log = [];
  return {
    log,
    async putRecord(did, x) { log.push(['put', did, x]); if (slow) await new Promise((r) => setTimeout(r, slow)); if (fail) throw fail; return { uri: `at://${did}/${x.collection}/${x.rkey}`, cid: CID }; },
    async call(did, nsid, { body }) { log.push(['del', did, body]); if (slow) await new Promise((r) => setTimeout(r, slow)); if (fail) throw fail; return {}; },
  };
};

test('the permission set includes hearts; old sign-ins do not cover them (HT14)', () => {
  assert.ok(rakuSet().repo.includes('cafe.thunderbird.tile.like'));
  const old = 'atproto repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*';
  assert.ok(coversPosts(old) && !coversHearts(old));
  const now = old.replace('&collection=cafe.thunderbird.tile.post', '&collection=cafe.thunderbird.tile.post&collection=cafe.thunderbird.tile.like');
  assert.ok(coversHearts(now) && coversRaku(now));
  assert.ok(coversHearts('atproto repo:cafe.thunderbird.tile.like'));
  assert.ok(!coversHearts('atproto repo:cafe.thunderbird.tile.likes'));
  assert.ok(coversHearts('atproto include:cafe.thunderbird.authRaku'));
});

test("the promise names hearts as Raku's own, not Bluesky likes (HT15)", () => {
  assert.match(SIGNIN_PROMISE, /heart tile posts/);
  assert.match(SIGNIN_PROMISE, /Hearts are Raku’s own|Hearts are Raku's own/);
  assert.match(SIGNIN_PROMISE, /doesn't touch your Bluesky posts, likes, follows/);
  assert.match(PERMISSION_LINE, /hearting tile posts/);
  assert.equal(HEARTS.left, '65%');
});

test('a heart record: Bluesky\'s like shape, on a tile post (HT2, HT3)', () => {
  assert.deepEqual(buildHeartRecord({ uri: P1, cid: CID }, '2026-11-11T10:00:00.000Z'),
    { $type: 'cafe.thunderbird.tile.like', subject: { uri: P1, cid: CID }, createdAt: '2026-11-11T10:00:00.000Z' });
  assert.equal(buildHeartRecord({ uri: P1, cid: 'nope' }), null);
  assert.equal(buildHeartRecord({ uri: `at://${A}/ing.dasl.masl/3mza1`, cid: CID }), null, 'tiles later, not this round');
  assert.equal(buildHeartRecord({ uri: 'at://thunderbird.cafe/cafe.thunderbird.tile.post/3mza1', cid: CID }), null, 'by DID only');
  assert.ok(isPostUri(P1) && !isPostUri(`at://${A}/app.bsky.feed.post/3mza1`));
});

test('reading a heart: only tile posts, only the account\'s own, well formed', () => {
  assert.deepEqual(readHeart(heart(B, '3h1', P1), B), { did: B, rkey: '3h1', subject: P1 });
  assert.equal(readHeart(heart(B, '3h1', P1), C), null, "someone else's record");
  assert.equal(readHeart(heart(B, '3h1', `at://${A}/ing.dasl.masl/3x`), B), null, 'a heart on a tile: not shown this round');
  assert.equal(readHeart(heart(B, '3h1', P1, { $type: 'app.bsky.feed.like' }), B), null);
  assert.equal(readHeart({ ...heart(B, '3h1', P1), value: { subject: { uri: P1 } } }, B), null, 'no cid');
  assert.equal(readHeart(null, B), null);
});

test('one pass counts every post: distinct accounts, hidden accounts left out (HT1, HT8, HT9)', async () => {
  const w = world({ hearts: {
    A: [], [A]: [heart(A, '3a1', P2)],
    [B]: [heart(B, '3b1', P1), heart(B, '3b2', P1)],                       // a duplicate: one account
    [C]: [heart(C, '3c1', P1), heart(C, '3c2', P2), heart(C, '3c3', `at://${A}/ing.dasl.masl/3x`)],
    [H]: [heart(H, '3h1', P1), heart(H, '3h2', P2)],                       // hidden: not counted
  } });
  const hearts = createHearts({ ...w });
  assert.equal(hearts.count(P1), null, 'nothing counted before the pass');
  const v = await hearts.pass();
  assert.equal(v.ok, true);
  assert.equal(hearts.count(P1), 2);
  assert.equal(hearts.count(P2), 2);
  assert.equal(hearts.count(`at://${C}/cafe.thunderbird.tile.post/none`), 0);
  assert.ok(!w.calls.some((c) => c.includes(encodeURIComponent(H)) && c.includes('listRecords')), "a hidden account's hearts aren't even read");
});

test('the pass is kept a few minutes; Refresh reads again; one at a time', async () => {
  let t = 0;
  const w = world({ hearts: { [B]: [heart(B, '3b1', P1)] } });
  const hearts = createHearts({ ...w, now: () => t });
  await Promise.all([hearts.pass(), hearts.pass()]);
  const relayCalls = () => w.calls.filter((c) => c.includes('listReposByCollection')).length;
  assert.equal(relayCalls(), 1);
  t += HEARTS.keepMs - 1; await hearts.pass(); assert.equal(relayCalls(), 1);
  await hearts.pass({ fresh: true }); assert.equal(relayCalls(), 2);
  t += HEARTS.keepMs + 1; await hearts.pass(); assert.equal(relayCalls(), 3);
});

test('hearts are read a page at a time', async () => {
  const many = Array.from({ length: 250 }, (_, i) => heart(B, `3b${i}`, `at://${A}/cafe.thunderbird.tile.post/3p${i}`));
  const w = world({ hearts: { [B]: many } });
  const hearts = createHearts({ ...w });
  await hearts.pass();
  assert.equal(hearts.count(`at://${A}/cafe.thunderbird.tile.post/3p249`), 1);
  assert.equal(w.calls.filter((c) => c.includes(`repo=${encodeURIComponent(B)}`)).length, 3);
});

test('a failed relay or account server: counts from what answered, the rest quietly', async () => {
  const w = world({ relayDown: true });
  const hearts = createHearts({ ...w });
  const v = await hearts.pass();
  assert.equal(v.ok, false);
  assert.equal(hearts.count(P1), 0);
  const w2 = world({ down: [B], hearts: { [B]: [heart(B, '3b1', P1)], [C]: [heart(C, '3c1', P1)] } });
  const h2 = createHearts({ ...w2 });
  const v2 = await h2.pass();
  assert.equal(v2.unreachable, 1);
  assert.equal(h2.count(P1), 1);
});

test("yours: read from your own server, never counted twice, right at once (HT7, HT9)", async () => {
  const w = world({ hearts: { [B]: [heart(B, '3b1', P1)], [ME]: [heart(ME, '3m1', P1)] } });
  const hearts = createHearts({ ...w });
  await hearts.pass();
  await hearts.readYours(ME);
  assert.equal(hearts.hearted(ME, P1), true);
  assert.equal(hearts.count(P1, ME), 2, 'B and you, once');
  assert.equal(hearts.count(P1, B), 2, 'another account current: the same two');
  assert.equal(hearts.hearted(B, P2), false);
});

test('tapping: shown at once, saved in the background, the record as the lexicon has it (HT10)', async () => {
  const w = world({ hearts: { [B]: [heart(B, '3b1', P1)] } });
  const auth = fakeAuth({ slow: 5 });
  const hearts = createHearts({ ...w, auth });
  await hearts.pass();
  let changes = 0;
  hearts.onChange(() => changes++);
  const p = hearts.set(ME, { uri: P1, cid: CID }, true);
  assert.equal(hearts.hearted(ME, P1), true, 'at once');
  assert.equal(hearts.count(P1, ME), 2, 'at once');
  assert.equal(await p, true);
  assert.ok(changes >= 2);
  const [kind, did, x] = auth.log.find((l) => l[0] === 'put');
  assert.equal(kind, 'put'); assert.equal(did, ME);
  assert.equal(x.collection, 'cafe.thunderbird.tile.like');
  assert.deepEqual(x.record.subject, { uri: P1, cid: CID });
  assert.equal(x.record.$type, 'cafe.thunderbird.tile.like');
  // un-heart deletes it
  await hearts.set(ME, { uri: P1, cid: CID }, false);
  const del = auth.log.find((l) => l[0] === 'del');
  assert.deepEqual(del[2], { repo: ME, collection: 'cafe.thunderbird.tile.like', rkey: x.rkey });
  assert.equal(hearts.hearted(ME, P1), false);
  assert.equal(hearts.count(P1, ME), 1);
});

test('quick taps save only the last choice: heart, un-heart, heart → one heart', async () => {
  const w = world();
  const auth = fakeAuth({ slow: 20 });
  const hearts = createHearts({ ...w, auth });
  const post = { uri: P2, cid: CID };
  const p = hearts.set(ME, post, true);
  hearts.set(ME, post, false);
  hearts.set(ME, post, true);
  await p;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(auth.log.filter((l) => l[0] === 'put').length, 1);
  assert.equal(auth.log.filter((l) => l[0] === 'del').length, 0);
  assert.equal(hearts.hearted(ME, P2), true);
});

test('a failed save puts the heart back and says why: scope, signed out, or not saved', async () => {
  for (const [err, code] of [[Object.assign(new Error('x'), { code: 'scope' }), 'scope'], [Object.assign(new Error('x'), { status: 403 }), 'scope'],
    [new SignInNeeded('gone'), 'signin'], [new Error('server down'), 'write']]) {
    const hearts = createHearts({ ...world(), auth: fakeAuth({ fail: err }) });
    await hearts.pass();
    const p = hearts.set(ME, { uri: P1, cid: CID }, true);
    assert.equal(hearts.hearted(ME, P1), true);
    await assert.rejects(p, (e) => e instanceof HeartError && e.code === code);
    assert.equal(hearts.hearted(ME, P1), false, 'back as the server has it');
    assert.equal(hearts.count(P1, ME), 0);
  }
});

test('the relay asked for hearts, by their own collection', async () => {
  const w = world({ relay: [A, A, 'not-a-did', B] });
  const r = await heartAccounts({ fetchImpl: w.fetchImpl });
  assert.deepEqual(r, { dids: [A, B], ok: true });
});
