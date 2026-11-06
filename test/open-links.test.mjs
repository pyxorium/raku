// Open links (claude/raku-open-links-plan.md, OL1 to OL6): pasted links that carry an AT URI, profile links, and
// records or collections that aren't tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, opensOutside, isNsid, accountPageUri } from '../src/address.js';
import { RECORD_APPS, RECORD_APP_KEY, recordApp, explorerLink, POST_APP_KEY, postApp } from '../src/config.js';
import { createTabs } from '../src/tabs.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
const PLACE = `at://${DID}/cafe.thunderbird.way.place/winter-forest`;
const FOREST = `at://${DID}/ing.dasl.masl/3myxm45elkp22`;

test("the plan's three addresses: an account, a post, and a record that isn't a tile", () => {
  assert.equal(parseTarget('at://thunderbird.cafe').uri, accountPageUri('thunderbird.cafe'));
  assert.equal(parseTarget('at://thunderbird.cafe/app.bsky.feed.post/3myzcs47f6m2y').kind, 'post');
  assert.deepEqual(parseTarget('at://thunderbird.cafe/cafe.thunderbird.way.place/winter-forest'), {
    ok: true, kind: 'record', actor: 'thunderbird.cafe', collection: 'cafe.thunderbird.way.place', rkey: 'winter-forest',
    uri: 'at://thunderbird.cafe/cafe.thunderbird.way.place/winter-forest',
  });
});

test('a collection that isn\'t tiles opens outside Raku (OL5); the tiles collection is still the account', () => {
  assert.deepEqual(parseTarget('at://Thunderbird.Cafe/app.bsky.feed.post'), {
    ok: true, kind: 'collection', actor: 'thunderbird.cafe', collection: 'app.bsky.feed.post', uri: 'at://thunderbird.cafe/app.bsky.feed.post',
  });
  assert.equal(parseTarget('at://thunderbird.cafe/ing.dasl.masl').kind, 'account');
  assert.equal(parseTarget(`at://${DID}/app.bsky.actor.profile/self`).kind, 'record');
});

test('PDSls links on both domains, and Taproot links, read back to their AT URI (OL3, OL4)', () => {
  for (const s of [`https://pdsls.dev/${PLACE}`, `https://pds.ls/${PLACE}`, `https://atproto.at/uri/${PLACE}`, `https://www.pdsls.dev/${PLACE}?x=1#raw`]) {
    const r = parseTarget(s);
    assert.equal(r.kind, 'record', s);
    assert.equal(r.uri, PLACE, s);
  }
  for (const s of [`https://pds.ls/at://${DID}/ing.dasl.masl`, `https://atproto.at/uri/at://${DID}/ing.dasl.masl`, `https://pdsls.dev/at://${DID}`]) {
    assert.equal(parseTarget(s).uri, accountPageUri(DID), s);
  }
  // A link to a tile opens the tile in Raku; a link to a post, the post's message.
  assert.deepEqual([parseTarget(`https://atproto.at/uri/${FOREST}`).kind, parseTarget(`https://atproto.at/uri/${FOREST}`).uri], ['tile', FOREST]);
  assert.equal(parseTarget(`https://pdsls.dev/at://${DID}/app.bsky.feed.post/3abc`).kind, 'post');
  assert.equal(parseTarget(`https://pdsls.dev/at://${DID}/app.bsky.feed.post`).kind, 'collection');
  // Their own pages that carry no AT URI are still other web pages.
  for (const s of ['https://pdsls.dev/', 'https://pds.ls/settings', 'https://atproto.at/', 'https://atproto.at/uri/nothing']) {
    assert.equal(parseTarget(s).ok, false, s);
  }
});

test('webtil.es links to records that aren\'t tiles, as well as tiles', () => {
  assert.equal(parseTarget(`https://webtil.es/browser/#url=${PLACE}`).kind, 'record');
  assert.equal(parseTarget(`https://webtil.es/browser/#url=${encodeURIComponent(PLACE)}`).uri, PLACE);
  assert.equal(parseTarget(`https://webtil.es/browser/#url=${FOREST}`).kind, 'tile');
  assert.equal(parseTarget('https://webtil.es/browser/').ok, false);
});

test('a profile link on its own opens the account\'s tiles (OL2); post links stay posts', () => {
  for (const s of ['https://bsky.app/profile/thunderbird.cafe', 'https://bsky.app/profile/Thunderbird.Cafe/', 'https://blacksky.community/profile/thunderbird.cafe']) {
    assert.deepEqual([parseTarget(s).kind, parseTarget(s).uri], ['account', accountPageUri('thunderbird.cafe')], s);
  }
  assert.equal(parseTarget(`https://bsky.app/profile/${DID}`).uri, accountPageUri(DID));
  assert.equal(parseTarget('https://bsky.app/profile/thunderbird.cafe/post/3myzcs47f6m2y').kind, 'post');
  assert.equal(parseTarget('https://blacksky.community/profile/thunderbird.cafe/post/3myzcs47f6m2y').uri, 'at://thunderbird.cafe/app.bsky.feed.post/3myzcs47f6m2y');
  assert.equal(parseTarget('https://bsky.app/profile/thunderbird.cafe/lists').ok, false);
  assert.equal(parseTarget('http://bsky.app/profile/thunderbird.cafe').ok, false, 'https only, as for posts');
});

test('unknown links and broken addresses still fall through with a reason', () => {
  assert.match(parseTarget('https://example.com/page').reason, /not other web pages/);
  assert.equal(parseTarget('at://thunderbird.cafe/notnsid/x').ok, false);
  assert.equal(parseTarget('at://not a handle/app.bsky.feed.post').ok, false);
  assert.match(parseTarget(`at://${DID}/cafe.thunderbird.way.place/..`).reason, /key isn't valid/);
  assert.equal(isNsid('cafe.thunderbird.way.place'), true);
  assert.equal(isNsid('two.parts'), false);
  assert.equal(isNsid('a.b.9c'), false);
});

test('records with no renderer, collections and posts never become a tab\'s address', () => {
  assert.deepEqual(['post', 'record', 'collection', 'tile', 'account'].map(opensOutside), [true, true, true, false, false]);
  const hash = `#t=${encodeURIComponent(PLACE)},${encodeURIComponent(`at://${DID}/app.bsky.feed.post`)},${encodeURIComponent(FOREST)}&a=0`;
  const tabs = createTabs({ max: 10, renderers: {} });          // as before renderer tiles: no renderers
  tabs.fromHash(hash);
  assert.deepEqual(tabs.list.map((t) => t.history?.[t.at] ?? null), [null, null, FOREST]);
  // Since renderer tiles (claude/raku-renderer-tiles-plan.md, RT2) a place, whose kind has a pinned renderer, does.
  const now = createTabs({ max: 10 });
  now.fromHash(hash);
  assert.deepEqual(now.list.map((t) => t.history?.[t.at] ?? null), [PLACE, null, FOREST]);
});

test('the explorers menu (OL4): PDSls first, Taproot, links built from the AT URI, its own remembered choice', () => {
  assert.deepEqual(RECORD_APPS.map((a) => a.name), ['PDSls', 'Taproot']);
  assert.equal(explorerLink(RECORD_APPS[0], PLACE), `https://pdsls.dev/${PLACE}`);
  assert.equal(explorerLink(RECORD_APPS[1], PLACE), `https://atproto.at/uri/${PLACE}`);
  // Each link reads back to the same record.
  for (const a of RECORD_APPS) assert.equal(parseTarget(explorerLink(a, PLACE)).uri, PLACE);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  assert.equal(recordApp(storage).id, 'pdsls');
  storage.setItem(RECORD_APP_KEY, 'taproot');
  assert.equal(recordApp(storage).id, 'taproot');
  assert.equal(postApp(storage).id, 'bluesky', 'the posts menu keeps its own choice');
  assert.notEqual(RECORD_APP_KEY, POST_APP_KEY);
  storage.setItem(RECORD_APP_KEY, 'gone');
  assert.equal(recordApp(storage).id, 'pdsls');
  assert.equal(recordApp({ getItem: () => { throw new Error('blocked'); } }).id, 'pdsls');
});
