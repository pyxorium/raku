// A tile post's own page, Copy link and Share (claude/raku-post-links-plan.md, SL1 to SL8): the address, the one-tab
// link, and what the share sheet is handed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, opensHere, shareLink, tilePostUri, TILE_POST_COLLECTION } from '../src/address.js';
import { createTabs } from '../src/tabs.js';
import { shareData, hasShareSheet } from '../src/post-share.js';
import { POST_COLLECTION } from '../src/tile-posts.js';
import { TILE_POSTS, SITE } from '../src/config.js';
import { ICON_NAMES } from '../src/icons.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
const RKEY = '3mzw2hsdqlk2a';
const URI = `at://${DID}/cafe.thunderbird.tile.post/${RKEY}`;

test('one name for the collection everywhere', () => {
  assert.equal(TILE_POST_COLLECTION, POST_COLLECTION);
  assert.equal(TILE_POST_COLLECTION, TILE_POSTS.collection);
  assert.equal(tilePostUri(DID, RKEY), URI);
});

test("a tile post's AT URI is its own page, in a tab (SL1)", () => {
  assert.deepEqual(parseTarget(URI), { ok: true, kind: 'tile-post', actor: DID, rkey: RKEY, uri: URI });
  assert.ok(opensHere(parseTarget(URI)));
  assert.equal(parseTarget(`  ${URI}/  `).kind, 'tile-post');
  assert.equal(parseTarget(URI.replace('at://', 'AT://')).kind, 'tile-post');
  // by handle too (as typed): the links Raku hands out use the DID
  const byHandle = parseTarget(`at://Thunderbird.Cafe/cafe.thunderbird.tile.post/${RKEY}`);
  assert.equal(byHandle.kind, 'tile-post');
  assert.equal(byHandle.actor, 'thunderbird.cafe');
  assert.equal(byHandle.uri, `at://thunderbird.cafe/cafe.thunderbird.tile.post/${RKEY}`);
});

test('broken tile post addresses are refused; the whole collection still opens the link message', () => {
  assert.equal(parseTarget(`at://${DID}/cafe.thunderbird.tile.post/..`).ok, false);
  assert.equal(parseTarget(`at://did:plc:short/cafe.thunderbird.tile.post/${RKEY}`).ok, false);
  const all = parseTarget(`at://${DID}/cafe.thunderbird.tile.post`);
  assert.equal(all.kind, 'collection');
  assert.ok(!opensHere(all));
  // other records are as before
  assert.equal(parseTarget(`at://${DID}/cafe.thunderbird.tile.like/${RKEY}`).kind, 'record');
  assert.equal(parseTarget(`at://${DID}/app.bsky.feed.post/${RKEY}`).kind, 'post');
  assert.equal(parseTarget(`at://${DID}/ing.dasl.masl/${RKEY}`).kind, 'tile');
});

test("explorer links and Raku links to a post land on the post's page", () => {
  assert.equal(parseTarget(`https://pdsls.dev/${URI}`).kind, 'tile-post');
  assert.equal(parseTarget(`https://atproto.at/uri/${URI}`).kind, 'tile-post');
  const link = shareLink(URI);
  const r = parseTarget(link);
  assert.equal(r.kind, 'tile-post');
  assert.equal(r.uri, URI);
});

test('the shared link: Raku with that one post in front, never the other tabs (SL2)', () => {
  assert.equal(shareLink(URI), `${SITE.origin}/#t=${encodeURIComponent(URI)}&a=0`);
  assert.equal(shareLink(URI, 'https://example.test'), `https://example.test/#t=at%3A%2F%2Fdid%3Aplc%3A6vxjigxrqizmbo56gojxico3%2Fcafe.thunderbird.tile.post%2F${RKEY}&a=0`);
  // opened, it is one tab: the post's page
  const tabs = createTabs();
  assert.equal(tabs.fromHash(new URL(shareLink(URI)).hash), true);
  assert.equal(tabs.list.length, 1);
  assert.equal(tabs.list[0].history[0], URI);
  assert.equal(tabs.canBack(tabs.active.id), false);
  // with other tabs open, the page's own address carries them all; the shared link doesn't
  const mine = createTabs();
  mine.go(mine.active.id, 'raku:discover/posts');
  mine.open(`at://${DID}/ing.dasl.masl/3my6uchoghd2m`);
  mine.open(URI);
  assert.equal(mine.toHash().split('&')[0].split(',').length, 3);
  assert.ok(!shareLink(URI).includes('%2C') && !shareLink(URI).includes(','));
});

test('a reload keeps a post tab (fromHash), with other tabs beside it', () => {
  const tabs = createTabs();
  tabs.fromHash(`#t=${encodeURIComponent('raku:discover/posts')},${encodeURIComponent(URI)}&a=1`);
  assert.deepEqual(tabs.list.map((t) => t.history[0]), ['raku:discover/posts', URI]);
  assert.equal(tabs.active.history[0], URI);
});

test("what Share via… hands the share sheet: the post's words, the link, @handle's tile post (SL8)", () => {
  const post = { uri: URI, text: '  A maze that folds back on itself.  ' };
  assert.deepEqual(shareData(post, 'thunderbird.cafe', 'https://example.test'), {
    title: "@thunderbird.cafe's tile post", text: 'A maze that folds back on itself.', url: shareLink(URI, 'https://example.test'),
  });
  // no words: the title and link only; no handle yet: no @
  assert.deepEqual(shareData({ uri: URI, text: '' }, null), { title: 'A tile post', url: shareLink(URI) });
  assert.deepEqual(shareData({ uri: URI, text: '   ' }, 'a.b'), { title: "@a.b's tile post", url: shareLink(URI) });
});

test('Share via… only where the browser has a share sheet', () => {
  assert.equal(hasShareSheet({ share() {} }), true);
  assert.equal(hasShareSheet({}), false);
  assert.equal(hasShareSheet(undefined), false);
  assert.equal(hasShareSheet(null), false);
});

test('the icons', () => {
  for (const n of ['share', 'link', 'posts']) assert.ok(ICON_NAMES.includes(n), n);
});
