import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE, pageCsp, loadSourceOverride, TILE_LOAD_DOMAIN, HIDE_LIST_URL, PICKS, SIGNIN, SIGNIN_PROMISE, oauthMetadata, fullScope, TABLES } from '../src/config.js';
import { parseAddress } from '../src/address.js';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test("Raku's address is named in one place: public/CNAME agrees with config.js", () => {
  assert.equal(file('public/CNAME').trim(), SITE.host);
  assert.equal(new URL(SITE.origin).host, SITE.host);
});

test('while a lab: noindex and robots.txt', () => {
  if (!SITE.lab) return;
  assert.match(file('index.html'), /<meta name="robots" content="noindex, nofollow">/);
  assert.match(file('public/robots.txt'), /Disallow: \//);
});

test('the page policy: frames only from the loading server, no outside scripts', () => {
  const p = pageCsp();
  assert.match(p, new RegExp(`frame-src https://${TILE_LOAD_DOMAIN} https://\\*\\.tiles\\.lexicographer\\.space`));
  assert.match(p, /script-src 'self';/);
  assert.match(p, /object-src 'none'/);
  assert.doesNotMatch(p, /unsafe/);
});

test('?loader= only on this computer', () => {
  const v = 'http://load.tiles.lex.localhost/.well-known/web-tiles/';
  assert.equal(loadSourceOverride({ hostname: '127.0.0.1', search: `?loader=${v}` }), v);
  assert.equal(loadSourceOverride({ hostname: SITE.host, search: `?loader=${v}` }), null);
  assert.equal(loadSourceOverride({ hostname: '127.0.0.1', search: '?loader=javascript:alert(1)' }), null);
});

test('the hide list comes from lexicographer.space; the picks are tile addresses', () => {
  assert.equal(HIDE_LIST_URL, 'https://lexicographer.space/hidden-tiles.json');
  assert.ok(PICKS.length >= 1);
  for (const p of PICKS) assert.equal(parseAddress(p).ok, true, p);
});

test("avatars only from Bluesky's picture server", () => {
  assert.match(pageCsp(), /img-src 'self' blob: data: https:\/\/cdn\.bsky\.app;/);
});

test("the sign-in description file names Raku's own address, and asks for no more than the tables' sets", () => {
  const m = oauthMetadata();
  assert.equal(m.client_id, `${SITE.origin}/oauth.json`);
  assert.equal(m.client_id, SIGNIN.clientId);
  assert.deepEqual(m.redirect_uris, [`${SITE.origin}/`]);
  assert.equal(m.client_uri, `${SITE.origin}/`);
  assert.equal(m.scope, fullScope());
  // the tables' sets, then (step 5b) their lounges' sets
  assert.deepEqual(m.scope.split(' '), ['atproto', ...Object.values(TABLES).map((t) => t.scope), ...Object.values(TABLES).filter((t) => t.lounge).map((t) => t.lounge.scope)]);
  for (const t of Object.values(TABLES)) if (t.lounge) assert.match(t.lounge.scope, /^include:cafe\.thunderbird\.[a-z]+\.authLounge\?aud=did:web:[a-z.]+%23[a-z_]+$/);
  for (const t of Object.values(TABLES)) assert.match(t.scope, /^include:cafe\.thunderbird\.[a-z]+\.authPlay$/, 'a permission set, never a plain wide scope');
  assert.equal(m.dpop_bound_access_tokens, true);
  assert.equal(m.token_endpoint_auth_method, 'none');
  assert.ok(!file('vite.config.js').includes('raku.lexicographer.space'), 'the build writes it from config.js');
});

test('the sign-in promise names the address and the per-game permission (Q43)', () => {
  // widened in step 5b (Q53) for the lounge
  assert.equal(SIGNIN_PROMISE, `Signing in lets ${SITE.host} save your match results from the tables you play and, if you choose to mingle, let other players see you're in a game's lounge. Each game asks for its own permission the first time. Raku doesn't touch your posts, likes, follows or anything else.`);
});
