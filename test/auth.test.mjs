import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, createAuth, clientIdFor, isSignInReturn, cleanHandle, SignInNeeded } from '../src/auth.js';
import { SIGNIN, fullScope, RAKU_SCOPE, coversTable, coversLounge, coversRooms, coversPosts, coversRaku, readGrant, rakuSet, TABLES, ROOMS } from '../src/config.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

// The grant Bluesky handed back in the probe (claude/raku-write-posts-plan.md, "Build", Nov 8 2026), on two servers.
const PROBE = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=* atproto';

test('the permission (WP3): one set, "Raku", for every sign-in', () => {
  assert.equal(fullScope(), 'atproto include:cafe.thunderbird.authRaku');
  assert.equal(RAKU_SCOPE, fullScope());
  assert.deepEqual(rakuSet(), {
    repo: ['cafe.thunderbird.sevenup.match', 'cafe.thunderbird.daisy.match', 'cafe.thunderbird.daisy.lounge', 'cafe.thunderbird.tile.post'],
    rpc: ['cafe.thunderbird.daisy.lounge.enter', 'cafe.thunderbird.rooms.join'],
  });
});

test("reading a grant: every form a server writes, the probe's grouped form too", () => {
  assert.ok(coversRaku(PROBE));
  assert.ok(coversTable(PROBE, TABLES.sevenup) && coversTable(PROBE, TABLES.daisy) && coversLounge(PROBE, TABLES.daisy) && coversRooms(PROBE) && coversPosts(PROBE));
  assert.ok(coversRaku(RAKU_SCOPE), 'the set by name, before a server expands it');
  assert.ok(coversRaku('atproto repo:cafe.thunderbird.sevenup.match repo:cafe.thunderbird.daisy.match repo:cafe.thunderbird.daisy.lounge?action=create&action=delete repo:cafe.thunderbird.tile.post rpc:cafe.thunderbird.daisy.lounge.enter?aud=did:web:relay.daisy.thunderbird.cafe%23daisy_relay rpc:cafe.thunderbird.rooms.join?aud=*'), 'the colon forms');
  assert.ok(coversRaku('atproto repo:* rpc:*?aud=*'), 'wildcards');
  assert.ok(coversRaku('atproto transition:generic'), 'an old-style wide grant');
  assert.ok(!coversRaku('atproto include:cafe.thunderbird.daisy.authPlay'), 'a sign-in from before WP5');
  assert.ok(!coversRaku(PROBE.replace('&collection=cafe.thunderbird.tile.post', '')), 'no tile posts');
  assert.ok(!coversPosts(PROBE.replace('&collection=cafe.thunderbird.tile.post', '')));
  assert.ok(!coversRaku(PROBE.replace('&lxm=cafe.thunderbird.rooms.join', '')), 'no rooms pass');
  assert.ok(!coversRaku(''), 'nothing');
  assert.ok(!coversRaku('atproto include:cafe.thunderbird.someoneElse'), 'a set Raku does not know counts for nothing');
  assert.ok(!coversTable('atproto repo?collection=cafe.thunderbird.sevenup.matches', TABLES.sevenup), 'exact names only');
  assert.ok(!coversRooms('atproto rpc?lxm=cafe.thunderbird.rooms.joined&aud=*'));
  assert.ok(!coversPosts('atproto repo:cafe.thunderbird.tile.posts'));
  // the older per-game forms still read correctly
  assert.ok(coversTable('atproto repo:cafe.thunderbird.sevenup.match', TABLES.sevenup));
  assert.ok(coversTable('atproto repo:cafe.thunderbird.sevenup.match?action=create&action=update', TABLES.sevenup));
  assert.ok(coversTable('atproto include:cafe.thunderbird.daisy.authPlay', TABLES.daisy));
  assert.ok(!coversTable('atproto repo:cafe.thunderbird.daisy.match', TABLES.sevenup));
  assert.ok(!coversTable('', TABLES.sevenup));
  assert.ok(coversLounge(`atproto ${TABLES.daisy.lounge.scope}`, TABLES.daisy));
  assert.ok(coversRooms(`atproto ${ROOMS.scope}`));
  const g = readGrant(PROBE);
  assert.deepEqual([...g.repo].sort(), [...rakuSet().repo].sort());
  assert.deepEqual([...g.rpc].sort(), [...rakuSet().rpc].sort());
});

test('on this computer a loopback sign-in back to 127.0.0.1; elsewhere the description file', () => {
  const local = clientIdFor({ hostname: '127.0.0.1', port: '5180' });
  assert.match(local, /^http:\/\/localhost\?redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A5180%2F&scope=/);
  assert.ok(decodeURIComponent(local).endsWith(`scope=${fullScope()}`));
  assert.equal(clientIdFor({ hostname: 'raku.lexicographer.space', port: '' }), SIGNIN.clientId);
});

test('a sign-in return is told apart from Raku\'s own tabs in the address', () => {
  assert.ok(isSignInReturn({ search: '', hash: '#state=abc&iss=https%3A%2F%2Fbsky.social&code=xyz' }));
  assert.ok(isSignInReturn({ search: '?state=abc&error=access_denied', hash: '' }));
  assert.ok(!isSignInReturn({ search: '', hash: '#t=raku%3Atable%2Fdaisy&a=0' }));
  assert.ok(!isSignInReturn({ search: '?loader=x', hash: '' }));
});

test('what someone types to sign in', () => {
  assert.equal(cleanHandle(' @Thunderbird.Cafe '), 'thunderbird.cafe');
  assert.equal(cleanHandle(A), A);
  assert.equal(cleanHandle('nodots'), null);
  assert.equal(cleanHandle('https://bsky.social'), null);
  assert.equal(cleanHandle(''), null);
});

test('accounts on this browser: several, one current; Always per account and game', () => {
  const s = memStore();
  const acc = createAccounts(s);
  assert.equal(acc.current(), null);
  acc.add(A, 'a.example'); acc.setCurrent(A);
  acc.add(B, 'b.example'); acc.setCurrent(B);
  assert.deepEqual(acc.list().map((a) => a.did), [B, A]);
  assert.equal(acc.current(), B);
  assert.ok(acc.setAlways(B, 'daisy', true));
  assert.ok(acc.hasAlways(B, 'daisy') && !acc.hasAlways(B, 'sevenup') && !acc.hasAlways(A, 'daisy'));
  assert.deepEqual(acc.alwaysList(), [{ did: B, tableId: 'daisy' }]);
  acc.remove(B);
  assert.equal(acc.current(), A, 'signing out the current account moves to the next');
  assert.ok(!acc.hasAlways(B, 'daisy'), "a signed-out account's Always choices go with it");
  s.setItem(SIGNIN.accountsKey, '{not json');
  assert.deepEqual(createAccounts(s).list(), [], 'a broken entry reads as none');
  assert.deepEqual(createAccounts(null).list(), [], 'no storage at all: nothing remembered, nothing breaks');
});

// A stand-in for the library: sessions with a token scope, popups, restore, revoke.
function fakeLib({ grant = (scope) => scope, callback = null, inWindow = false } = {}) {
  class LoginContinuedInParentWindowError extends Error {}
  const calls = [];
  const store = new Map();
  const session = (did, scope) => ({
    did, scope,
    getTokenInfo: async () => ({ scope: grant(scope) }),
    fetchHandler: async (path, init) => {
      if (path.startsWith('/xrpc/com.atproto.server.getServiceAuth')) {     // the lounge's pass (step 5b)
        calls.push({ did, path });
        return new Response(JSON.stringify({ token: `pass:${did}` }), { status: 200 });
      }
      calls.push({ did, path, body: JSON.parse(init.body) });
      if (store.get(did)?.expired) return new Response(JSON.stringify({ error: 'InvalidToken' }), { status: 401 });
      return new Response(JSON.stringify({ uri: `at://${did}/x/${JSON.parse(init.body).rkey}`, cid: 'bafy' }), { status: 200 });
    },
  });
  const client = {
    async init() { if (inWindow) throw new LoginContinuedInParentWindowError(); return callback ? { session: session(callback.did, callback.scope), state: callback.state } : undefined; },
    async signInPopup(input, opts) { calls.push({ popup: input, scope: opts.scope }); const did = input === 'b.example' ? B : A; const s = session(did, opts.scope); store.set(did, s); return s; },
    async signInRedirect(input, opts) { calls.push({ redirect: input, scope: opts.scope, state: opts.state }); },
    async restore(did) { if (!store.has(did) || store.get(did).gone) throw new Error('no session'); return store.get(did); },
    async revoke(did) { calls.push({ revoke: did }); store.delete(did); },
  };
  return { lib: { BrowserOAuthClient: { load: async (o) => { calls.push({ load: o }); return client; } }, LoginContinuedInParentWindowError }, calls, store };
}
const handleFor = async (did) => ({ [A]: 'a.example', [B]: 'b.example' })[did];

test('signing in, whatever for, asks for the one set; the probe-shaped grant covers every game, the lounge, rooms and posts', async () => {
  const f = fakeLib({ grant: (scope) => (scope === RAKU_SCOPE ? PROBE : scope) });
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  assert.deepEqual(await auth.start(), {});
  assert.equal(f.calls[0].load.clientId, SIGNIN.clientId);
  for (const scope of [auth.scopeFor(null, 'daisy'), auth.scopeFor(A, 'sevenup'), auth.scopeFor(null, null), auth.loungeScopeFor(null, 'daisy'), auth.roomsScopeFor(null)]) assert.equal(scope, RAKU_SCOPE);
  const did = await auth.signIn('a.example', auth.scopeFor(auth.didForHandle('a.example'), 'daisy'));
  assert.equal(did, A);
  assert.equal(auth.current().handle, 'a.example');
  assert.ok(auth.covers(A, 'daisy') && auth.covers(A, 'sevenup') && auth.coversLounge(A, 'daisy') && auth.coversRooms(A) && auth.coversPosts(A) && auth.coversAll(A));
  assert.ok(f.calls.filter((c) => c.popup).every((c) => c.scope === RAKU_SCOPE), 'every window asked for the one set');
  await auth.signIn('b.example', auth.scopeFor(null, null));
  assert.equal(auth.current().did, B, 'the newest sign-in is current');
  assert.deepEqual(auth.list().map((a) => [a.handle, a.current]), [['b.example', true], ['a.example', false]]);
  auth.switchTo(A);
  assert.equal(auth.current().did, A, 'switching needs no window');
});

test('a grant missing something (refused, or older) is told apart, so Raku asks for "Raku" again', async () => {
  const f = fakeLib({ grant: () => 'atproto include:cafe.thunderbird.daisy.authPlay' });
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  await auth.start();
  await auth.signIn('a.example', RAKU_SCOPE);
  assert.ok(auth.covers(A, 'daisy'));
  assert.ok(!auth.coversPosts(A) && !auth.coversAll(A) && !auth.coversRooms(A));
});

test('saving: the record goes to the account\'s own repo; a sign-in that ran out says so', async () => {
  const f = fakeLib();
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: '127.0.0.1', port: '5180' }, handleFor });
  await auth.start();
  await auth.signIn('a.example', auth.scopeFor(null, 'sevenup'));
  const r = await auth.putRecord(A, { collection: 'cafe.thunderbird.sevenup.match', rkey: '3my27cwible2m', record: { x: 1 } });
  assert.equal(r.uri, `at://${A}/x/3my27cwible2m`);
  const sent = f.calls.find((c) => c.path);
  assert.deepEqual(sent.body, { repo: A, collection: 'cafe.thunderbird.sevenup.match', rkey: '3my27cwible2m', record: { x: 1 } });
  f.store.get(A).expired = true;
  await assert.rejects(auth.putRecord(A, { collection: 'c', rkey: 'k', record: {} }), SignInNeeded);
  assert.equal(auth.current(), null, 'forgotten on this browser');
});

test('the end of a sign-in: in the small window, and back in this tab', async () => {
  const w = fakeLib({ inWindow: true });
  const inWindow = createAuth(async () => w.lib, { storage: memStore(), loc: { hostname: '127.0.0.1', port: '5180' } });
  assert.deepEqual(await inWindow.start(), { finishedInWindow: true });
  const back = fakeLib({ callback: { did: B, scope: RAKU_SCOPE, state: 'save' } });
  const auth = createAuth(async () => back.lib, { storage: memStore(), loc: { hostname: '127.0.0.1', port: '5180' }, handleFor });
  assert.deepEqual(await auth.start(), { returned: { did: B, state: 'save' } });
  assert.equal(auth.current().handle, 'b.example');
  assert.ok(auth.covers(B, 'daisy'));
});

test('signing out revokes the sign-in and forgets the account', async () => {
  const f = fakeLib();
  const storage = memStore();
  const auth = createAuth(async () => f.lib, { storage, loc: { hostname: '127.0.0.1', port: '5180' }, handleFor });
  await auth.start();
  await auth.signIn('a.example', 'atproto');
  auth.accounts.setAlways(A, 'daisy', true);
  await auth.signOut(A);
  assert.ok(f.calls.some((c) => c.revoke === A));
  assert.equal(auth.list().length, 0);
  assert.ok(!auth.accounts.hasAlways(A, 'daisy'));
});

test('a library that fails to load: browsing is untouched, signing in says so', async () => {
  const auth = createAuth(async () => { throw new Error('offline'); }, { storage: memStore(), loc: { hostname: '127.0.0.1', port: '5180' } });
  const orig = console.error; console.error = () => {};
  const r = await auth.start();
  console.error = orig;
  assert.ok(r.error);
  await assert.rejects(auth.signIn('a.example', 'atproto'), /still getting ready|isn't working/);
});

test("Daisy's lounge (step 5b): covered by the one set; the relay pass from the account's server", async () => {
  const f = fakeLib({ grant: () => PROBE });
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  await auth.start();
  const L = TABLES.daisy.lounge;
  assert.equal(auth.loungeScopeFor(null, 'daisy'), RAKU_SCOPE);
  await auth.signIn('a.example', auth.loungeScopeFor(null, 'daisy'));
  assert.ok(auth.coversLounge(A, 'daisy') && auth.covers(A, 'daisy') && auth.covers(A, 'sevenup'));
  const pass = await auth.getPass(A, 'daisy');
  assert.equal(pass, `pass:${A}`);
  const call = f.calls.find((c) => c.path && c.path.startsWith('/xrpc/com.atproto.server.getServiceAuth'));
  const q = new URLSearchParams(call.path.split('?')[1]);
  assert.equal(q.get('aud'), 'did:web:relay.daisy.thunderbird.cafe#daisy_relay', 'the pass is still addressed to the exact relay (WP4)');
  assert.equal(q.get('lxm'), 'cafe.thunderbird.daisy.lounge.enter');
  assert.ok(Number(q.get('exp')) - Date.now() / 1000 <= 61, 'good for a minute');
  assert.ok(coversLounge(`atproto repo:${L.collection} rpc:${L.enter}?aud=did:web:relay.daisy.thunderbird.cafe%23daisy_relay`, TABLES.daisy));
  assert.ok(!coversLounge(`atproto repo:${L.collection}`, TABLES.daisy), 'the record alone is not enough: the pass is needed too');
  assert.ok(!coversLounge(`atproto ${L.scope}`, TABLES.sevenup), 'Seven-Up has no lounge');
});

test('rooms (rooms step 1, RR4): covered by the one set; the pass is for the rooms relay', async () => {
  const f = fakeLib({ grant: () => PROBE });
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  await auth.start();
  assert.equal(auth.roomsScopeFor(null), RAKU_SCOPE);
  await auth.signIn('a.example', auth.roomsScopeFor(null));
  assert.ok(auth.coversRooms(A) && auth.covers(A, 'daisy'));
  assert.equal(await auth.getRoomPass(A), `pass:${A}`);
  const q = new URLSearchParams(f.calls.find((c) => c.path?.startsWith('/xrpc/com.atproto.server.getServiceAuth')).path.split('?')[1]);
  assert.equal(q.get('aud'), 'did:web:relay.rooms.thunderbird.cafe#rooms_relay');
  assert.equal(q.get('lxm'), 'cafe.thunderbird.rooms.join');
  assert.ok(Number(q.get('exp')) - Date.now() / 1000 <= 61, 'a minute at most');
});
