import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE, pageCsp, loadSourceOverride, TILE_LOAD_DOMAIN } from '../src/config.js';

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
