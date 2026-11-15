// Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10): which records open in a tab, what a renderer is
// handed, and what it may ask for. The browser side is test/browser/check_renderer.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDERERS, rendererFor, pinnedRenderers, RENDER } from '../src/config.js';
import { parseTarget, opensHere } from '../src/address.js';
import { createTabs, current } from '../src/tabs.js';
import { READY, UP, DOWN, recordPayload, recordTitle, readOpenRequest, openDecision, createOpenGate, readGetRequest, getTarget, createGetBudget,
  readPictureRequest, pictureSource, PICTURE_TYPES, readAudioRequest, audioSource, sniffAudio, createAudioBudget, createProgress, AUDIO_TYPES } from '../src/renderers.js';

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

// ---- The signpost renderer and the read request (claude/raku-renderer-tiles-plan.md, "The signpost renderer", SR6) ----
const SIGNPOST = 'cafe.thunderbird.way.signpost';
const TC = 'did:plc:6vxjigxrqizmbo56gojxico3', PX = 'did:plc:rqbqpaaluty5v47jwciowpik';
const MAZE = `at://${PX}/cafe.thunderbird.way.place/maze`;
const slide = { did: TC, handle: 'thunderbird.cafe', value: { $type: SIGNPOST, to: [{ place: MAZE, entrance: 'obelisk' }], updatedAt: '2026-10-29T05:40:00Z' } };

test('the signpost renderer is on the list; until it is pinned, signposts keep opening the message', () => {
  assert.ok(RENDERERS[SIGNPOST], 'signposts have a renderer entry');
  assert.equal(RENDERERS[SIGNPOST].name, 'Signposts');
  if (RENDERERS[SIGNPOST].uri) {
    assert.match(RENDERERS[SIGNPOST].uri, /^at:\/\/did:plc:6vxjigxrqizmbo56gojxico3\/ing\.dasl\.masl\/[a-z2-7]{13}$/, 'published from thunderbird.cafe');
    assert.match(RENDERERS[SIGNPOST].cid, /^bafyrei[a-z2-7]{52}$/, 'pinned by its record CID');
    assert.equal(rendererFor(SIGNPOST), RENDERERS[SIGNPOST]);
  } else {
    assert.equal(rendererFor(SIGNPOST), null);
    assert.equal(openDecision(`at://${TC}/${SIGNPOST}/winter-forest.slide`).action, 'record', 'the link message, as before');
  }
});

test('a read request: an at:// address in { get }, nothing else', () => {
  assert.equal(readGetRequest({ get: MAZE }), MAZE);
  for (const p of [{ get: 'https://pdsls.dev/at://x' }, { get: 42 }, { open: MAZE }, { get: `at://${'x'.repeat(700)}` }, { get: 'at://has space/x/y' }, null, 'get']) {
    assert.equal(readGetRequest(p), null, JSON.stringify(p));
  }
});

test('what a renderer may have Raku read (SR6): addresses named in its record, or records in its record\'s account', () => {
  assert.equal(getTarget(MAZE, slide).rkey, 'maze', 'named in the signpost\'s to list');
  assert.equal(getTarget(`at://${TC}/cafe.thunderbird.way.place/winter-forest`, slide).rkey, 'winter-forest', 'the same account (the heading\'s place)');
  assert.equal(getTarget('at://thunderbird.cafe/cafe.thunderbird.way.place/winter-forest', slide).actor, 'thunderbird.cafe', 'the same account by its checked handle');
  assert.equal(getTarget(`at://${PX}/cafe.thunderbird.way.place/somewhere-else`, slide), null, 'another account\'s record the signpost doesn\'t name');
  assert.equal(getTarget('at://pyxorium.com/cafe.thunderbird.way.place/maze', slide), null, 'only as written in the record');
  assert.equal(getTarget(`at://${PX}/cafe.thunderbird.way.place`, slide), null, 'not a collection');
  assert.equal(getTarget(`at://${PX}`, slide), null, 'not an account');
  assert.equal(getTarget(MAZE, null), null);
  const tile = getTarget(`at://${PX}/ing.dasl.masl/3myyjuyr2ja2s`, { ...slide, value: { to: [{ tile: `at://${PX}/ing.dasl.masl/3myyjuyr2ja2s` }] } });
  assert.deepEqual([tile.collection, tile.rkey], ['ing.dasl.masl', '3myyjuyr2ja2s'], 'a tile named in the record');
  const deep = { ...slide, value: { a: { b: [{ c: MAZE }] } } };
  assert.ok(getTarget(MAZE, deep), 'anywhere in the record');
});

test('at most RENDER.getMax reads per load', () => {
  assert.equal(RENDER.getMax, 20);
  const b = createGetBudget({ max: 3 });
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
});

// ---------- pictures (claude/raku-places-card-plan.md, PC6) ----------

const TILE_URI = 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3myxm45elkp22';
const BANNER = 'bafkreiforestbannerstandinaaaaaaaaaaa';
const blobRef = (cid) => ({ $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 10 });

test('a picture request: a blob cid and the at:// record it comes from, nothing else', () => {
  assert.deepEqual(readPictureRequest({ picture: BANNER, from: TILE_URI }), { cid: BANNER, from: TILE_URI });
  for (const bad of [null, 'x', { picture: BANNER }, { from: TILE_URI }, { picture: 'Qm123', from: TILE_URI }, { picture: BANNER, from: 'https://example.com/' },
    { picture: BANNER, from: `at://${'a'.repeat(RENDER.openMaxChars)}` }, { picture: `${BANNER} `, from: TILE_URI }, { picture: BANNER, from: 'at://did:plc:x/c/k extra' }]) {
    assert.equal(readPictureRequest(bad), null, JSON.stringify(bad));
  }
  assert.equal(readGetRequest({ picture: BANNER, from: TILE_URI }), null, 'not a get');
  assert.equal(readOpenRequest({ picture: BANNER, from: TILE_URI }), null, 'not an open');
});

test('which pictures (PC6): one a record already handed over in this load lists as a blob, from that record only', () => {
  const tileValue = { $type: 'ing.dasl.masl', tile: { name: 'Winter Forest', screenshots: [{ src: '/banner.jpg' }], resources: { '/banner.jpg': { src: blobRef(BANNER) } } } };
  const seen = new Map([
    ['at://did:plc:6vxjigxrqizmbo56gojxico3/cafe.thunderbird.way.place/winter-forest', { did: 'did:plc:6vxjigxrqizmbo56gojxico3', value: { tile: TILE_URI, cid: 'bafyreiplace' } }],
    [TILE_URI, { did: 'did:plc:6vxjigxrqizmbo56gojxico3', value: tileValue }],
  ]);
  assert.deepEqual(pictureSource({ cid: BANNER, from: TILE_URI }, seen), { did: 'did:plc:6vxjigxrqizmbo56gojxico3' });
  assert.equal(pictureSource({ cid: 'bafkreinotlistedanywhereaaaaaaaaaaaaa', from: TILE_URI }, seen), null, 'a blob the record doesn\'t list');
  assert.equal(pictureSource({ cid: BANNER, from: 'at://did:plc:rqbqpaaluty5v47jwciowpik/ing.dasl.masl/3myyjuyr2ja2s' }, seen), null, 'a record not handed over');
  assert.equal(pictureSource({ cid: BANNER, from: 'at://thunderbird.cafe/ing.dasl.masl/3myxm45elkp22' }, seen), null, 'only by the address it was sent with');
  assert.equal(pictureSource({ cid: 'bafyreiplace', from: 'at://did:plc:6vxjigxrqizmbo56gojxico3/cafe.thunderbird.way.place/winter-forest' }, seen), null, 'a CID written as text isn\'t a blob');
  const notBlob = new Map([[TILE_URI, { did: 'did:plc:x', value: { ref: { $link: BANNER } } }]]);
  assert.equal(pictureSource({ cid: BANNER, from: TILE_URI }, notBlob), null, 'a link without $type blob');
  assert.equal(pictureSource({ cid: BANNER, from: TILE_URI }, null), null);
  assert.deepEqual([...PICTURE_TYPES], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], 'no SVG');
  assert.equal(RENDER.pictureMaxBytes, 1024 * 1024, 'at most 1 MB');
});

// ---------- songs (claude/mixtape-3c-track-renderer-notes.md, R3c-4) ----------

const SONG_URI = 'at://did:plc:rqbqpaaluty5v47jwciowpik/cafe.thunderbird.audio.track/3n2caaaaaaaag';
const SONG = 'bafkreisongaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const song = (over = {}) => ({ uri: SONG_URI, did: 'did:plc:rqbqpaaluty5v47jwciowpik', value: { title: 'Lord Only Knows (Pt. 1)', audioBlob: { $type: 'blob', ref: { $link: SONG }, mimeType: 'video/webm', size: 5_400_000 }, imageBlob: { $type: 'blob', ref: { $link: BANNER }, mimeType: 'image/png', size: 10 }, ...over } });

test('Tracks is on the list for both song kinds; until its address and CID are filled in, songs open the message', () => {
  for (const kind of ['cafe.thunderbird.audio.track', 'fm.plyr.track']) {
    assert.ok(RENDERERS[kind], `${kind} has a renderer entry`);
    assert.equal(RENDERERS[kind].name, 'Tracks');
    if (RENDERERS[kind].uri) {
      assert.match(RENDERERS[kind].uri, /^at:\/\/did:plc:6vxjigxrqizmbo56gojxico3\/ing\.dasl\.masl\/[a-z2-7]{13}$/, 'published from thunderbird.cafe');
      assert.match(RENDERERS[kind].cid, /^bafyrei[a-z2-7]{52}$/, 'pinned by its record CID');
      assert.equal(rendererFor(kind), RENDERERS[kind]);
    } else {
      assert.equal(rendererFor(kind), null);
    }
  }
  assert.deepEqual(RENDERERS['cafe.thunderbird.audio.track'], RENDERERS['fm.plyr.track'], 'the same tile for both');
});

test('an audio request: a blob cid and the at:// record it comes from, nothing else', () => {
  assert.deepEqual(readAudioRequest({ audio: SONG, from: SONG_URI }), { cid: SONG, from: SONG_URI });
  for (const bad of [null, 'x', { audio: SONG }, { from: SONG_URI }, { audio: 'Qm123', from: SONG_URI }, { audio: SONG, from: 'https://example.com/a.mp3' },
    { audio: SONG, from: `at://${'a'.repeat(RENDER.openMaxChars)}` }, { audio: `${SONG} `, from: SONG_URI }]) {
    assert.equal(readAudioRequest(bad), null, JSON.stringify(bad));
  }
  assert.equal(readPictureRequest({ audio: SONG, from: SONG_URI }), null, 'not a picture');
  assert.equal(readGetRequest({ audio: SONG, from: SONG_URI }), null, 'not a get');
  assert.equal(readOpenRequest({ audio: SONG, from: SONG_URI }), null, 'not an open');
});

test('which song (R3c-4): only the audioBlob of the record the renderer was handed, by the address it was sent with', () => {
  assert.deepEqual(audioSource({ cid: SONG, from: SONG_URI }, song()), { did: 'did:plc:rqbqpaaluty5v47jwciowpik', size: 5_400_000 });
  assert.equal(audioSource({ cid: BANNER, from: SONG_URI }, song()), null, 'another file in the record (its cover) isn\'t a song');
  assert.equal(audioSource({ cid: SONG, from: 'at://pyxorium.com/cafe.thunderbird.audio.track/3n2caaaaaaaag' }, song()), null, 'only by the address it was sent with');
  assert.equal(audioSource({ cid: SONG, from: 'at://did:plc:rqbqpaaluty5v47jwciowpik/cafe.thunderbird.audio.track/other' }, song()), null, 'another record');
  assert.equal(audioSource({ cid: SONG, from: SONG_URI }, song({ audioBlob: { ref: { $link: 'bafkreiother' } } })), null, 'a different file');
  assert.equal(audioSource({ cid: SONG, from: SONG_URI }, song({ audioBlob: undefined, audioUrl: 'https://x.r2.dev/a.mp3' })), null, 'audio kept elsewhere: nothing to fetch');
  assert.deepEqual(audioSource({ cid: SONG, from: SONG_URI }, song({ audioBlob: { ref: { $link: SONG } } })), { did: 'did:plc:rqbqpaaluty5v47jwciowpik', size: 0 }, 'no declared size');
  assert.equal(audioSource({ cid: SONG, from: SONG_URI }, null), null);
  assert.equal(RENDER.audioMaxBytes, 100 * 1024 * 1024, 'at most 100 MB');
  assert.equal(RENDER.audioMax, 3);
});

test('songs are recognised by their bytes, never by the server\'s label', () => {
  const head = (...bytes) => { const b = new Uint8Array(64); b.set(bytes); return b; };
  assert.equal(sniffAudio(head(0x49, 0x44, 0x33, 4)), 'audio/mpeg', 'MP3 with ID3');
  assert.equal(sniffAudio(head(0xff, 0xfb, 0x90)), 'audio/mpeg', 'an MP3 frame');
  assert.equal(sniffAudio(head(0x1a, 0x45, 0xdf, 0xa3)), 'audio/webm', 'WebM (the importer\'s Opus)');
  assert.equal(sniffAudio(head(0x4f, 0x67, 0x67, 0x53)), 'audio/ogg');
  assert.equal(sniffAudio(head(0x66, 0x4c, 0x61, 0x43)), 'audio/flac');
  assert.equal(sniffAudio(head(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)), 'audio/wav');
  assert.equal(sniffAudio(head(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20)), 'audio/mp4');
  assert.equal(sniffAudio(head(0x89, 0x50, 0x4e, 0x47)), null, 'a PNG');
  assert.equal(sniffAudio(new TextEncoder().encode('<html><script>alert(1)</script></html>')), null, 'a page');
  assert.equal(sniffAudio(head(0xff, 0xf9)), null, 'not an MP3 layer');
  assert.equal(sniffAudio(new Uint8Array(4)), null);
  assert.deepEqual([...AUDIO_TYPES], ['audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/wav', 'audio/mp4']);
});

test('at most RENDER.audioMax songs per load; progress at most every RENDER.progressMs, the end always told', () => {
  const b = createAudioBudget({ max: 2 });
  assert.equal(b.take(), true); assert.equal(b.take(), true); assert.equal(b.take(), false);
  let t = 0; const told = [];
  const p = createProgress((r, total) => told.push([r, total]), { gapMs: 250, now: () => t });
  p(10, 100); t = 100; p(20, 100); t = 260; p(30, 100); t = 270; p(100, 100);
  assert.deepEqual(told, [[10, 100], [30, 100], [100, 100]]);
});
