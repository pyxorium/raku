// Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10): which records open in a tab, what a renderer is
// handed, and what it may ask for. The browser side is test/browser/check_renderer.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDERERS, rendererFor, pinnedRenderers, RENDER } from '../src/config.js';
import { parseTarget, opensHere } from '../src/address.js';
import { createTabs, current } from '../src/tabs.js';
import { READY, UP, DOWN, recordPayload, recordTitle, readOpenRequest, openDecision, createOpenGate } from '../src/renderers.js';

const PLACE = 'cafe.thunderbird.way.place';
const PINNED = { [PLACE]: { name: 'Places', uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mzplacesxxxx', cid: 'bafyreiplaces' } };
const FOREST_PLACE = 'at://thunderbird.cafe/cafe.thunderbird.way.place/winter-forest';

test('the place renderer is on the list; until its address and CID are filled in, places keep opening the message', () => {
  assert.ok(RENDERERS[PLACE], 'places have a renderer entry');
  const pinned = rendererFor(PLACE);
  if (RENDERERS[PLACE].uri) {
    assert.match(RENDERERS[PLACE].uri, /^at:\/\/did:plc:6vxjigxrqizmbo56gojxico3\/ing\.dasl\.masl\/[a-z2-7]{13}$/, 'published from thunderbird.cafe');
    assert.match(RENDERERS[PLACE].cid, /^bafyrei[a-z2-7]{52}$/, 'pinned by its record CID');
    assert.equal(pinned, RENDERERS[PLACE]);
  } else {
    assert.equal(pinned, null, 'not pinned yet: no renderer');
    assert.deepEqual(pinnedRenderers(), []);
  }
});

test('rendererFor: only a pinned entry counts; other kinds, and names on Object.prototype, have none', () => {
  assert.equal(rendererFor(PLACE, PINNED), PINNED[PLACE]);
  assert.equal(rendererFor('app.bsky.feed.like', PINNED), null);
  assert.equal(rendererFor('constructor', PINNED), null);
  assert.equal(rendererFor(PLACE, { [PLACE]: { uri: 'at://x/ing.dasl.masl/y', cid: '' } }), null, 'no CID: not pinned');
  assert.deepEqual(pinnedRenderers(PINNED), [PINNED[PLACE]]);
});

test('which targets open in a tab (RT2): a record with a renderer does; a whole collection, posts and other records don\'t', () => {
  const t = (s) => parseTarget(s);
  assert.equal(opensHere(t(FOREST_PLACE), PINNED), true);
  assert.equal(opensHere(t(FOREST_PLACE), {}), false, 'no renderer: the message, as before');
  assert.equal(opensHere(t('at://thunderbird.cafe/cafe.thunderbird.way.place'), PINNED), false, 'records only, not collections');
  assert.equal(opensHere(t('at://thunderbird.cafe/app.bsky.feed.post/3myzcs47f6m2y'), PINNED), false);
  assert.equal(opensHere(t('at://thunderbird.cafe/app.bsky.feed.like/3abc'), PINNED), false);
  assert.equal(opensHere(t('at://thunderbird.cafe/ing.dasl.masl/3myxm45elkp22'), PINNED), true, 'tiles, as always');
  assert.equal(opensHere(t('raku:shelf'), PINNED), true);
  assert.equal(opensHere({ ok: false }, PINNED), false);
});

test('a #t= link with a place reopens it as a tab when it has a renderer; a first screen when it doesn\'t (RT2)', () => {
  const hash = `#t=${encodeURIComponent(FOREST_PLACE)},${encodeURIComponent('at://thunderbird.cafe/cafe.thunderbird.way.place')}&a=0`;
  const withR = createTabs({ renderers: PINNED });
  withR.fromHash(hash);
  assert.deepEqual(withR.list.map(current), [FOREST_PLACE, null]);
  const without = createTabs({ renderers: {} });
  without.fromHash(hash);
  assert.deepEqual(without.list.map(current), [null, null]);
});

test('what a renderer is handed (RT4): the record as stored and where it came from, the same shape for every kind', () => {
  const value = { $type: PLACE, tile: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22', cid: 'bafy-tile', name: 'Winter Forest', updatedAt: '2026-10-28T20:36:27.450Z' };
  const p = recordPayload({ did: 'did:plc:6vxjigxrqizmbo56gojxico3', handle: 'thunderbird.cafe', collection: PLACE, rkey: 'winter-forest', cid: 'bafy-place', value });
  assert.deepEqual(p, { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/cafe.thunderbird.way.place/winter-forest', cid: 'bafy-place',
    did: 'did:plc:6vxjigxrqizmbo56gojxico3', handle: 'thunderbird.cafe', collection: PLACE, rkey: 'winter-forest', value });
  assert.equal(p.value, value, 'the value untouched');
  assert.equal(recordPayload({ did: 'did:plc:x', collection: PLACE, rkey: 'k', value: {} }).handle, null, 'no checked handle: null');
  assert.deepEqual(structuredClone(p), p, 'it survives the trip to the tile (structured clone)');
});

test('a record tab\'s title: its own name when it has one, else its key', () => {
  assert.equal(recordTitle({ name: '  Winter   Forest ' }, 'winter-forest'), 'Winter Forest');
  assert.equal(recordTitle({}, 'winter-forest'), 'winter-forest');
  assert.equal(recordTitle({ name: 42 }, 'k'), 'k');
  assert.equal(recordTitle({ name: 'x'.repeat(300) }, 'k').length, 120);
});

test('the one request a renderer may make (RT5): open an at:// address, nothing else', () => {
  assert.equal(readOpenRequest({ open: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22' }), 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22');
  for (const bad of [{ open: 'https://example.com/' }, { open: 'javascript:alert(1)' }, { open: 'at://x y' }, { open: `at://${'a'.repeat(RENDER.openMaxChars)}` },
    { open: 42 }, { write: 'at://x/y/z' }, null, 'at://x/ing.dasl.masl/y']) {
    assert.equal(readOpenRequest(bad), null, JSON.stringify(bad));
  }
});

test('what an open request does, as if typed (RT5)', () => {
  assert.deepEqual(openDecision('at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22', PINNED),
    { action: 'tab', uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22' }, 'a tile: a new tab');
  assert.equal(openDecision('at://thunderbird.cafe', PINNED).action, 'tab', 'an account: a new tab');
  assert.deepEqual(openDecision(FOREST_PLACE, PINNED), { action: 'tab', uri: FOREST_PLACE }, 'another place: a new tab, shown by its renderer');
  assert.equal(openDecision(FOREST_PLACE, {}).action, 'record', 'a record with no renderer: the message');
  assert.equal(openDecision('at://thunderbird.cafe/cafe.thunderbird.way.place', PINNED).action, 'record', 'a collection: the message');
  assert.equal(openDecision('at://thunderbird.cafe/app.bsky.feed.post/3myzcs47f6m2y', PINNED).action, 'post');
  assert.equal(openDecision('at://', PINNED).action, 'refuse');
});

test('one request at a time: none within a second of the last', () => {
  let t = 0;
  const gate = createOpenGate({ gapMs: 1000, now: () => t });
  assert.equal(gate.take(), true);
  t = 500; assert.equal(gate.take(), false);
  t = 999; assert.equal(gate.take(), false);
  t = 1500; assert.equal(gate.take(), true);
  assert.equal(RENDER.gapMs, 1000);
});

test('the wire names are the tiles spec\'s data protocol (tp-data)', () => {
  assert.deepEqual([READY, UP, DOWN], ['tiles-protocol-up-data-ready', 'tiles-protocol-up-data-payload', 'tiles-protocol-down-data-payload']);
});
