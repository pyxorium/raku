import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, createAuth, clientIdFor, isSignInReturn, cleanHandle, SignInNeeded } from '../src/auth.js';
import { SIGNIN, scopeFor, fullScope, coversTable, tablesCovered, TABLES } from '../src/config.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';

test('the permissions: your account plus the sets of the tables a sign-in is for', () => {
  assert.equal(scopeFor([]), 'atproto');
  assert.equal(scopeFor(['sevenup']), 'atproto include:cafe.thunderbird.sevenup.authPlay');
  assert.equal(scopeFor(['sevenup', 'daisy', 'sevenup']), 'atproto include:cafe.thunderbird.sevenup.authPlay include:cafe.thunderbird.daisy.authPlay');
  assert.equal(fullScope(), `${scopeFor(Object.keys(TABLES))} ${TABLES.daisy.lounge.scope}`, "oauth.json: the tables' sets and Daisy's lounge (step 5b)");
  // the server expands a set into plain permissions; either form counts
  assert.ok(coversTable('atproto repo:cafe.thunderbird.sevenup.match', TABLES.sevenup));
  assert.ok(coversTable('atproto repo:cafe.thunderbird.sevenup.match?action=create&action=update', TABLES.sevenup));
  assert.ok(coversTable('atproto include:cafe.thunderbird.daisy.authPlay', TABLES.daisy));
  assert.ok(!coversTable('atproto repo:cafe.thunderbird.daisy.match', TABLES.sevenup));
  assert.ok(!coversTable('atproto repo:cafe.thunderbird.sevenup.matches', TABLES.sevenup));
  assert.ok(!coversTable('', TABLES.sevenup));
  assert.deepEqual(tablesCovered('atproto repo:cafe.thunderbird.daisy.match repo:cafe.thunderbird.sevenup.match'), ['sevenup', 'daisy']);
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

test('signing in for a table asks for that game only; another game grows the same sign-in', async () => {
  const f = fakeLib();
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  assert.deepEqual(await auth.start(), {});
  assert.equal(f.calls[0].load.clientId, SIGNIN.clientId);
  const scope = auth.scopeFor(auth.didForHandle('a.example'), 'daisy');
  assert.equal(scope, 'atproto include:cafe.thunderbird.daisy.authPlay');
  const did = await auth.signIn('a.example', scope);
  assert.equal(did, A);
  assert.equal(auth.current().handle, 'a.example');
  assert.ok(auth.covers(A, 'daisy') && !auth.covers(A, 'sevenup'));
  assert.equal(auth.scopeFor(A, 'sevenup'), 'atproto include:cafe.thunderbird.daisy.authPlay include:cafe.thunderbird.sevenup.authPlay', 'keeps what it had');
  await auth.signIn('a.example', auth.scopeFor(A, 'sevenup'));
  assert.ok(auth.covers(A, 'daisy') && auth.covers(A, 'sevenup'));
  await auth.signIn('b.example', auth.scopeFor(null, null));
  assert.equal(auth.current().did, B, 'the newest sign-in is current');
  assert.deepEqual(auth.list().map((a) => [a.handle, a.current]), [['b.example', true], ['a.example', false]]);
  auth.switchTo(A);
  assert.equal(auth.current().did, A, 'switching needs no window');
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
  const back = fakeLib({ callback: { did: B, scope: 'atproto include:cafe.thunderbird.daisy.authPlay', state: 'save' } });
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

test("Daisy's lounge (step 5b): its own permission, kept by later sign-ins; the relay pass from the account's server", async () => {
  const f = fakeLib();
  const auth = createAuth(async () => f.lib, { storage: memStore(), loc: { hostname: 'raku.lexicographer.space', port: '' }, handleFor });
  await auth.start();
  const L = TABLES.daisy.lounge;
  // signed out: one window asks for the account, "Play Daisy" and "Daisy lounge" together (Q54)
  assert.equal(auth.loungeScopeFor(null, 'daisy'), `atproto include:cafe.thunderbird.daisy.authPlay ${L.scope}`);
  await auth.signIn('a.example', auth.scopeFor(null, 'sevenup'));
  assert.ok(!auth.coversLounge(A, 'daisy'));
  assert.equal(auth.loungeScopeFor(A, 'daisy'), `atproto include:cafe.thunderbird.sevenup.authPlay include:cafe.thunderbird.daisy.authPlay ${L.scope}`, 'keeps Seven-Up');
  await auth.signIn('a.example', auth.loungeScopeFor(A, 'daisy'));
  assert.ok(auth.coversLounge(A, 'daisy') && auth.covers(A, 'daisy') && auth.covers(A, 'sevenup'));
  assert.ok(auth.scopeFor(A, 'sevenup').split(' ').includes(L.scope), 'a later sign-in for a table never drops the lounge');
  const pass = await auth.getPass(A, 'daisy');
  assert.equal(pass, `pass:${A}`);
  const call = f.calls.find((c) => c.path && c.path.startsWith('/xrpc/com.atproto.server.getServiceAuth'));
  const q = new URLSearchParams(call.path.split('?')[1]);
  assert.equal(q.get('aud'), 'did:web:relay.daisy.thunderbird.cafe#daisy_relay');
  assert.equal(q.get('lxm'), 'cafe.thunderbird.daisy.lounge.enter');
  assert.ok(Number(q.get('exp')) - Date.now() / 1000 <= 61, 'good for a minute');
  // the server's expanded form counts too
  const { coversLounge } = await import('../src/config.js');
  assert.ok(coversLounge(`atproto repo:${L.collection} rpc:${L.enter}?aud=did:web:relay.daisy.thunderbird.cafe%23daisy_relay`, TABLES.daisy));
  assert.ok(!coversLounge(`atproto repo:${L.collection}`, TABLES.daisy), 'the record alone is not enough: the pass is needed too');
  assert.ok(!coversLounge(`atproto ${L.scope}`, TABLES.sevenup), 'Seven-Up has no lounge');
});
