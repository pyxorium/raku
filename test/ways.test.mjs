// Ways with Raku as the host (claude/raku-ways-plan.md, RW1 to RW8): the rules in src/ways.js, the raku:way/ address,
// and the tabs' history keeping a door beside each place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readWays, entranceFor, readWayMessage, statusMessage, arriveMessage, testSignposts, overrideFor, createWayReader,
  chosenDoor, keepDoor, signpostGoTo, parseAtUri, WAY_UP, WAY_DOWN, PLACE, SIGNPOST, TILE } from '../src/ways.js';
import { parseTarget, wayUri, opensHere } from '../src/address.js';
import { createTabs, current, stateAt } from '../src/tabs.js';
import { NetError } from '../src/net.js';

const A = 'did:plc:6vxjigxrqizmbo56gojxico3';          // thunderbird.cafe
const P = 'did:plc:rqbqpaaluty5v47jwciowpik';          // pyxorium.com
const H = 'did:plc:hhhhhhhhhhhhhhhhhhhhhhhh';          // a hidden account
const FOREST_WAYS = {
  v: 1, tile: 'winter-forest', place: `at://${A}/${PLACE}/winter-forest`, entry: 'ways-only',
  exits: ['wardrobe', 'tree-door', 'arch', 'slide'].map((id) => ({ id, signpost: `at://${A}/${SIGNPOST}/winter-forest.${id}`, fallback: `https://thunderbird.cafe/way/winter-forest/${id}` })),
  entrances: [{ id: 'lamppost' }, { id: 'wardrobe' }, { id: 'tree-door' }, { id: 'arch' }],
};

test('a /ways.json is read as the travel page reads it (v 1): exits with signposts, entrances, ways-only', () => {
  const w = readWays(FOREST_WAYS);
  assert.equal(w.tile, 'winter-forest');
  assert.equal(w.entry, 'ways-only');
  assert.deepEqual(w.exits.map((x) => x.id), ['wardrobe', 'tree-door', 'arch', 'slide']);
  assert.deepEqual(w.entrances, ['lamppost', 'wardrobe', 'tree-door', 'arch']);
  assert.equal(readWays({ ...FOREST_WAYS, entry: undefined }).entry, 'open');
  assert.equal(readWays({ ...FOREST_WAYS, v: 2 }), null);
  assert.equal(readWays({ ...FOREST_WAYS, tile: 'Bad Name' }), null);
  // an exit whose signpost isn't a signpost record is left out
  assert.deepEqual(readWays({ ...FOREST_WAYS, exits: [{ id: 'x', signpost: `at://${A}/${PLACE}/maze` }] }).exits, []);
  assert.equal(entranceFor(w, 'arch'), 'arch');
  assert.equal(entranceFor(w, 'slide'), 'lamppost', 'an exit that is not an entrance: the first entrance');
  assert.equal(entranceFor(null, 'arch'), null);
});

test('the messages: only hello and a leave naming an exit are read; status and arrive are the M23 envelope', () => {
  assert.deepEqual(readWayMessage({ action: WAY_UP, payload: { v: 1, kind: 'hello', tile: 'maze' } }), { kind: 'hello' });
  assert.deepEqual(readWayMessage({ action: WAY_UP, payload: { v: 1, kind: 'leave', exit: 'obelisk', facing: 'se' } }), { kind: 'leave', exit: 'obelisk' });
  assert.equal(readWayMessage({ action: WAY_UP, payload: { v: 2, kind: 'hello' } }), null);
  assert.equal(readWayMessage({ action: WAY_UP, payload: { v: 1, kind: 'leave', exit: '../x' } }), null);
  assert.equal(readWayMessage({ action: WAY_DOWN, payload: { v: 1, kind: 'hello' } }), null);
  assert.deepEqual(statusMessage({ slide: 'open' }), { action: WAY_DOWN, payload: { v: 1, kind: 'status', exits: { slide: 'open' } } });
  assert.deepEqual(arriveMessage('obelisk'), { action: WAY_DOWN, payload: { v: 1, kind: 'arrive', entrance: 'obelisk' } });
});

test('a way taken has its own address, raku:way/<account>/<signpost>, which opens in a tab and survives a reload (RW2)', () => {
  const r = parseTarget('raku:way/thunderbird.cafe/winter-forest.slide');
  assert.deepEqual(r, { ok: true, kind: 'way', actor: 'thunderbird.cafe', rkey: 'winter-forest.slide', uri: 'raku:way/thunderbird.cafe/winter-forest.slide' });
  assert.equal(parseTarget(`raku:way/${A}/maze.obelisk`).actor, A);
  assert.equal(wayUri(P, 'maze.obelisk'), `raku:way/${P}/maze.obelisk`);
  assert.equal(opensHere(r), true);
  assert.equal(parseTarget('raku:way/not a handle/x').ok, false);
  assert.equal(parseTarget('raku:way/thunderbird.cafe').ok, false);
  const tabs = createTabs();
  tabs.fromHash(`#t=${encodeURIComponent('raku:way/thunderbird.cafe/winter-forest.slide')}&a=0`);
  assert.equal(current(tabs.active), 'raku:way/thunderbird.cafe/winter-forest.slide');
  // a Raku link carrying a way (the travel page's "Open in Raku", RW7) opens that way
  const link = parseTarget(`https://raku.lexicographer.space/#t=${encodeURIComponent('raku:way/thunderbird.cafe/winter-forest.slide')}&a=0`);
  assert.equal(link.kind, 'way');
});

test("a tab's history keeps a state beside each place: Back knows which exit was left by (the defaults)", () => {
  const tabs = createTabs();
  const id = tabs.active.id;
  tabs.go(id, `at://${P}/${TILE}/maze`);
  tabs.go(id, 'raku:way/x.test/maze.obelisk', { door: { name: 'Winter Forest' }, from: { exit: 'obelisk' } });
  tabs.go(id, 'raku:way/x.test/winter-forest.slide', { door: { name: 'Escher maze' }, from: { exit: 'slide' } });
  assert.equal(tabs.active.moved, 'go');
  assert.equal(stateAt(tabs.active).from.exit, 'slide');
  tabs.back(id);
  assert.equal(tabs.active.moved, 'back');
  assert.equal(stateAt(tabs.active).door.name, 'Winter Forest');
  assert.equal(stateAt(tabs.active, tabs.active.at + 1).from.exit, 'slide', 'going back to the forest: you left it by the slide');
  tabs.back(id);
  assert.equal(stateAt(tabs.active, tabs.active.at + 1).from.exit, 'obelisk');
  tabs.forward(id);
  assert.equal(tabs.active.moved, 'forward');
  // a new address drops the states ahead, as it drops the addresses
  tabs.go(id, 'raku:discover');
  assert.equal(tabs.active.states.length, tabs.active.history.length);
  assert.equal(stateAt(tabs.active), null);
  // the same address again is a reload, with the new state
  tabs.go(id, 'raku:discover', { x: 1 });
  assert.deepEqual(stateAt(tabs.active), { x: 1 });
  const t2 = tabs.open('raku:way/x.test/a', { state: { pick: 'p' } });
  assert.deepEqual(stateAt(t2), { pick: 'p' });
});

test('test signposts on this computer only, in the travel page\'s form (RW8)', () => {
  const here = { hostname: '127.0.0.1', search: '?sign=winter-forest.wardrobe:maze@pyxorium.com/obelisk&sign=maze.obelisk:winter-forest@thunderbird.cafe/lamppost,maze@pyxorium.com&sign=winter-forest.slide:' };
  const o = testSignposts(here);
  assert.deepEqual(o.get('winter-forest.wardrobe'), [{ placeKey: 'maze', did: P, entrance: 'obelisk' }]);
  assert.equal(o.get('maze.obelisk').length, 2);
  assert.deepEqual(o.get('winter-forest.slide'), []);
  assert.deepEqual(overrideFor(A, 'winter-forest.wardrobe', o), [{ place: `at://${P}/${PLACE}/maze`, entrance: 'obelisk' }]);
  assert.equal(overrideFor(A, 'other', o), null);
  assert.equal(testSignposts({ hostname: 'raku.lexicographer.space', search: here.search }).size, 0, 'the live Raku ignores it');
  assert.equal(testSignposts({ hostname: '127.0.0.1', search: '?sign=x:maze@nobody.example/obelisk' }).get('x').length, 0, 'an unknown account handle is dropped');
});

// A stand-in resolver and moderation over a few records.
function standIns(records, { hidden = [] } = {}) {
  const calls = [];
  const resolver = {
    async record(did, collection, rkey) {
      calls.push(`${did}/${collection}/${rkey}`);
      const r = records[`${did}/${collection}/${rkey}`];
      if (!r) throw new NetError('not-found', 'none');
      if (r === 'down') throw new NetError('upstream', 'down');
      return { uri: `at://${did}/${collection}/${rkey}`, cid: r.cid || 'bafyrec', value: r.value };
    },
    async tileRecord(did, rkey) { return this.record(did, TILE, rkey); },
    async checkedHandle(did) { return { [A]: 'thunderbird.cafe', [P]: 'pyxorium.com' }[did] || null; },
  };
  const moderation = { async isAccountHidden(did) { return hidden.includes(did); }, async isHidden(did, rkey) { return hidden.includes(`${did}/${rkey}`); } };
  return { resolver, moderation, calls };
}
const RECORDS = {
  [`${A}/${SIGNPOST}/winter-forest.slide`]: { value: { to: [{ place: `at://${P}/${PLACE}/maze`, entrance: 'obelisk' }] } },
  [`${A}/${SIGNPOST}/winter-forest.arch`]: { value: { to: [], note: 'Soon.' } },
  [`${A}/${SIGNPOST}/winter-forest.wardrobe`]: { value: { to: [
    { place: `at://${P}/${PLACE}/maze`, entrance: 'obelisk', label: 'Back to the maze' },
    { tile: `at://${A}/${TILE}/forest`, entrance: 'arch', label: 'Round again' },
    { place: `at://${H}/${PLACE}/hidden` },
  ] } },
  [`${A}/${SIGNPOST}/broken.down`]: 'down',
  [`${P}/${PLACE}/maze`]: { value: { tile: `at://${P}/${TILE}/maze04`, cid: 'bafymaze', name: 'Escher maze' } },
  [`${P}/${TILE}/maze04`]: { cid: 'bafymaze', value: { tile: { name: 'Escher maze 0.4.0', resources: {} } } },
  [`${A}/${TILE}/forest`]: { cid: 'bafyforest', value: { tile: { name: 'Winter Forest', resources: {} } } },
  [`${A}/${SIGNPOST}/x.changed`]: { value: { to: [{ place: `at://${A}/${PLACE}/changed` }] } },
  [`${A}/${PLACE}/changed`]: { value: { tile: `at://${A}/${TILE}/forest`, cid: 'bafyolder', name: 'Moved on' } },
};

test('the reader: a filled signpost, a dormant one, a missing one (dormant), an unreadable one (error)', async () => {
  const { resolver, moderation } = standIns(RECORDS);
  const w = createWayReader({ resolver, moderation });
  const one = await w.lookUp(A, 'winter-forest.slide');
  assert.equal(one.state, 'open');
  assert.equal(one.doors.length, 1);
  assert.deepEqual(keepDoor(one.doors[0]), { tile: `at://${P}/${TILE}/maze04`, did: P, rkey: 'maze04', pinned: 'bafymaze', place: `at://${P}/${PLACE}/maze`,
    entrance: 'obelisk', label: '', name: 'Escher maze', by: 'pyxorium.com' });
  const arch = await w.lookUp(A, 'winter-forest.arch');
  assert.equal(arch.state, 'dormant');
  assert.equal(arch.note, 'Soon.');
  assert.equal((await w.lookUp(A, 'nothing.here')).state, 'dormant');
  assert.equal((await w.lookUp(A, 'broken.down')).state, 'error');
  assert.equal(await w.state(`at://${A}/${SIGNPOST}/winter-forest.slide`), 'open');
  assert.equal(await w.state(`at://${A}/${SIGNPOST}/winter-forest.arch`), 'dormant');
  assert.equal(await w.state(`at://${A}/${SIGNPOST}/broken.down`), 'dormant', 'unreadable counts as dormant for the status');
  assert.equal(await w.state(`at://${A}/${PLACE}/maze`), 'dormant', 'not a signpost');
});

test("several doors: a place, a tile and a hidden account's place (broken, never read); a Go to picks one", async () => {
  const { resolver, moderation, calls } = standIns(RECORDS, { hidden: [H] });
  const w = createWayReader({ resolver, moderation });
  const v = await w.lookUp(A, 'winter-forest.wardrobe');
  assert.equal(v.doors.length, 3);
  assert.equal(v.doors[0].name, 'Escher maze');
  assert.equal(v.doors[1].name, 'Winter Forest');
  assert.equal(v.doors[1].pinned, null, 'a tile named directly has no pinned version');
  assert.equal(v.doors[1].entrance, 'arch');
  assert.ok(v.doors[2].broken && v.doors[2].hidden);
  assert.ok(!calls.some((c) => c.startsWith(H)), 'nothing is read from a hidden account');
  assert.equal(chosenDoor(v, `at://${A}/${TILE}/forest`).name, 'Winter Forest');
  assert.equal(chosenDoor(v, `at://${H}/${PLACE}/hidden`), null, 'a broken door is never chosen');
  assert.equal(chosenDoor(v, 'at://nowhere'), null);
});

test("a place whose tile changed since it was pointed at it is a broken door (as the travel page: blocked)", async () => {
  const { resolver, moderation } = standIns(RECORDS);
  const v = await createWayReader({ resolver, moderation }).lookUp(A, 'x.changed');
  assert.equal(v.state, 'open');
  assert.match(v.doors[0].broken, /changed since its place was pointed at it/);
});

test('a hidden tile behind a place is a broken door; test signposts replace the real one without reading it', async () => {
  const { resolver, moderation, calls } = standIns(RECORDS, { hidden: [`${P}/maze04`] });
  const w = createWayReader({ resolver, moderation, overrides: new Map([['winter-forest.arch', [{ placeKey: 'maze', did: P, entrance: 'obelisk' }]]]) });
  const v = await w.lookUp(A, 'winter-forest.slide');
  assert.ok(v.doors[0].broken);
  const t = await w.lookUp(A, 'winter-forest.arch');
  assert.equal(t.state, 'open');
  assert.equal(t.test, true);
  assert.ok(!calls.includes(`${A}/${SIGNPOST}/winter-forest.arch`), 'the real signpost is not read');
});

test("a signpost renderer's Go to: a destination named in the signpost it was given becomes that way (RW5)", () => {
  const given = { uri: `at://${A}/${SIGNPOST}/winter-forest.slide`, value: { to: [{ place: `at://${P}/${PLACE}/maze`, entrance: 'obelisk' }] } };
  assert.deepEqual(signpostGoTo(given, `at://${P}/${PLACE}/maze`), { did: A, rkey: 'winter-forest.slide', pick: `at://${P}/${PLACE}/maze` });
  assert.equal(signpostGoTo(given, `at://${P}/${TILE}/maze04`), null, 'not one of its destinations');
  assert.equal(signpostGoTo({ ...given, uri: `at://${A}/${PLACE}/winter-forest` }, `at://${P}/${PLACE}/maze`), null, 'only from a signpost');
  assert.deepEqual(parseAtUri(`at://${A}/${SIGNPOST}/winter-forest.slide`), { did: A, collection: SIGNPOST, rkey: 'winter-forest.slide' });
});
