import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, tileUri, atUri } from '../src/address.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
const RKEY = '3my6uchoghd2m';
const URI = `at://${DID}/ing.dasl.masl/${RKEY}`;

test('at:// addresses, with a DID or a handle', () => {
  assert.deepEqual(parseAddress(URI), { ok: true, actor: DID, rkey: RKEY, uri: URI });
  const r = parseAddress(`at://Thunderbird.Cafe/ing.dasl.masl/${RKEY}`);
  assert.equal(r.ok, true);
  assert.equal(r.actor, 'thunderbird.cafe');
  assert.equal(r.uri, `at://thunderbird.cafe/ing.dasl.masl/${RKEY}`);
  assert.equal(parseAddress(`  ${URI}/  `).ok, true);
});

test('other collections and broken at:// addresses are refused with a reason', () => {
  const r = parseAddress(`at://${DID}/app.bsky.feed.post/${RKEY}`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /isn't a web tile/);
  assert.equal(parseAddress(`at://${DID}/ing.dasl.masl`).ok, false);
  assert.equal(parseAddress(`at://did:plc:short/ing.dasl.masl/${RKEY}`).ok, false);
  assert.equal(parseAddress(`at://${DID}/ing.dasl.masl/..`).ok, false);
  assert.equal(parseAddress('').ok, false);
});

test('lexicographer.space, appmosphe.re and webtil.es links', () => {
  for (const s of [
    `https://lexicographer.space/@thunderbird.cafe/${RKEY}`,
    `https://www.lexicographer.space/@thunderbird.cafe/${RKEY}`,
    `https://appmosphe.re/@thunderbird.cafe/${RKEY}`,
    `https://webtil.es/browser/#url=at://thunderbird.cafe/ing.dasl.masl/${RKEY}`,
    `https://webtil.es/browser/#url=${encodeURIComponent(`at://thunderbird.cafe/ing.dasl.masl/${RKEY}`)}`,
    `@thunderbird.cafe/${RKEY}`,
    `thunderbird.cafe/${RKEY}`,
  ]) {
    const r = parseAddress(s);
    assert.equal(r.ok, true, s);
    assert.equal(r.uri, `at://thunderbird.cafe/ing.dasl.masl/${RKEY}`, s);
  }
  assert.equal(parseAddress(`https://lexicographer.space/@${DID}/${RKEY}`).uri, URI);
  assert.equal(parseAddress('https://lexicographer.space/takedowns').ok, false);
  assert.match(parseAddress('https://example.com/page').reason, /not other web pages/);
});

test("Beaver's tile:// addresses, both ways", () => {
  const t = tileUri(DID, RKEY);
  assert.equal(t, `tile://${RKEY}.did%3Aplc%3A6vxjigxrqizmbo56gojxico3/`);
  assert.equal(parseAddress(t).uri, URI);
  assert.equal(parseAddress(`tile://${RKEY}.${DID}/`).uri, URI);
  assert.equal(parseAddress(`TILE://${RKEY}.did%3Aweb%3Aexample.com`).uri, `at://did:web:example.com/ing.dasl.masl/${RKEY}`);
  assert.equal(parseAddress('tile://nonsense/').ok, false);
  assert.equal(atUri(DID, RKEY), URI);
});

test('did:web accounts are lower-cased; other DID methods are refused', () => {
  assert.equal(parseAddress(`at://did:web:Example.COM/ing.dasl.masl/${RKEY}`).actor, 'did:web:example.com');
  assert.match(parseAddress(`at://did:key:z6Mk/ing.dasl.masl/${RKEY}`).reason, /did:plc and did:web only/);
});

import { parseTarget, SHELF_URI, accountPageUri } from '../src/address.js';

test('the address box also takes an account (its tiles) and your shelf', () => {
  for (const s of ['@thunderbird.cafe', 'thunderbird.cafe', 'Thunderbird.Cafe', 'at://thunderbird.cafe', 'at://thunderbird.cafe/ing.dasl.masl', 'https://lexicographer.space/@thunderbird.cafe', 'raku:tiles/thunderbird.cafe']) {
    const r = parseTarget(s);
    assert.equal(r.ok, true, s);
    assert.equal(r.kind, 'account', s);
    assert.equal(r.uri, accountPageUri('thunderbird.cafe'), s);
  }
  assert.equal(parseTarget(DID).uri, `raku:tiles/${DID}`);
  assert.equal(parseTarget(SHELF_URI).kind, 'shelf');
  assert.equal(parseTarget(URI).kind, 'tile');
  assert.equal(parseTarget(`thunderbird.cafe/${RKEY}`).kind, 'tile');
  assert.match(parseTarget('mixtape').reason, /isn't a tile's address or an account's handle/);
  assert.equal(parseTarget('https://example.com/').ok, false);
  assert.equal(parseTarget('raku:tiles/not a handle').ok, false);
});
