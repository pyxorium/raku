// "Play here" (claude/raku-play-here-plan.md, PH1 to PH8): the rules, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playVerdict, leaveVerdict, createOneAtATime } from '../src/play-here.js';
import { PLAY_HERE, LIMITS } from '../src/config.js';
import { ICON_NAMES } from '../src/icons.js';
import { PLAY_LINE } from '../src/about-page.js';

const MB = 1024 * 1024;

test('PH3: the size rule is the same as for tabs: start, ask over 25 MB, refuse over 500 MB', () => {
  assert.equal(LIMITS.askBytes, 25 * MB);
  assert.equal(LIMITS.maxBytes, 500 * MB);
  assert.equal(playVerdict(2 * MB, 'k'), 'start');
  assert.equal(playVerdict(25 * MB, 'k'), 'start');
  assert.equal(playVerdict(60 * MB, 'k'), 'ask');
  assert.equal(playVerdict(60 * MB, 'k', new Set(['k'])), 'start', '"Play anyway" once is enough this visit');
  assert.equal(playVerdict(60 * MB, 'other', new Set(['k'])), 'ask');
  assert.equal(playVerdict(620 * MB, 'k', new Set(['k'])), 'refuse', 'never over the limit, even after Play anyway');
  assert.equal(playVerdict(undefined, 'k'), 'start');
});

test('PH5: a portal stepped through in a post: go when a door can be used, else blocked', () => {
  assert.equal(leaveVerdict({ state: 'open', doors: [{ tile: 'x' }] }), 'go');
  assert.equal(leaveVerdict({ state: 'open', doors: [{ broken: 'hidden' }, { tile: 'y' }] }), 'go', 'several doors: the new tab offers Pick a door');
  assert.equal(leaveVerdict({ state: 'open', doors: [{ broken: 'hidden' }] }), 'blocked');
  assert.equal(leaveVerdict({ state: 'dormant', doors: [] }), 'blocked');
  assert.equal(leaveVerdict({ state: 'error', doors: [] }), 'blocked');
  assert.equal(leaveVerdict(null), 'blocked');
});

function clock() {
  let t = 0, n = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++n; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    tick(ms) { t += ms; for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); } },
  };
}

test('PH1, PH2: one at a time; × stops only its own; the out-of-view timer and a brief scroll', () => {
  const c = clock();
  const stopped = [];
  const one = createOneAtATime({ awayMs: PLAY_HERE.awayMs, setTimer: c.setTimer, clearTimer: c.clearTimer });
  one.start('a', () => stopped.push('a'));
  assert.equal(one.current, 'a');
  one.start('b', () => stopped.push('b'));
  assert.deepEqual(stopped, ['a'], 'starting another stops the one playing');
  assert.equal(one.stop('a'), false, "a slot that isn't playing stops nothing");
  assert.deepEqual(stopped, ['a']);
  // a brief scroll away doesn't stop it
  one.seen('b', false);
  c.tick(PLAY_HERE.awayMs - 500);
  one.seen('b', true);
  c.tick(5000);
  assert.equal(one.current, 'b');
  // fully out of view for awayMs does
  one.seen('b', false);
  c.tick(PLAY_HERE.awayMs);
  assert.deepEqual(stopped, ['a', 'b']);
  assert.equal(one.current, null);
  // seen() for a slot that isn't playing does nothing; stop() with nothing playing is fine
  one.seen('b', false);
  c.tick(10000);
  assert.equal(one.stop(), false);
  // stop with no slot: whichever is playing (leaving Discover)
  one.start('c', () => stopped.push('c'));
  assert.equal(one.stop(), true);
  assert.deepEqual(stopped, ['a', 'b', 'c']);
});

test('the play icon, the timings and the About page line', () => {
  assert.ok(ICON_NAMES.includes('play'));
  assert.ok(PLAY_HERE.awayMs >= 1000 && PLAY_HERE.awayMs <= 10000);
  assert.ok(PLAY_HERE.hintMs >= 1000 && PLAY_HERE.hintMs <= 6000);
  assert.match(PLAY_LINE, /Play here/);
});

// ---------- round C (claude/raku-expand-plan.md): expanding, and travel inside the post ----------
import { expandMotion, clipInset, wayPlan, createTrail, tabFor } from '../src/play-here.js';
import { wayUri } from '../src/address.js';

test('EX4, EX8: expanding opens as a window, 400 ms, linear (chosen with the real maze); with reduced motion, a plain fade', () => {
  assert.equal(PLAY_HERE.expand, 'window');
  assert.deepEqual(expandMotion(), { technique: 'window', ms: 400, ease: 'linear' });
  assert.deepEqual(expandMotion({ reduce: true }), { technique: 'fade', ms: 400, ease: 'linear' });
});

test('EX4: the test switch is gone (the choice is made): an address asking for another way is ignored', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/play-here.js', import.meta.url), 'utf8');
  assert.ok(!/searchParams|URLSearchParams|[?&]expand=/.test(src), 'no reading of the address for expanding');
});

test('EX4 (window): the clip that shows only the post\'s box of the tile pinned at the stage', () => {
  const stage = { top: 66, left: 14, right: 1386, bottom: 886 };
  assert.equal(clipInset({ top: 300, left: 400, right: 800, bottom: 525 }, stage, 10), 'inset(234px 586px 361px 386px round 10px)');
  assert.equal(clipInset(stage, stage), 'inset(0px 0px 0px 0px)');
});

test('D: where a portal leads, read as a tab reads it: blocked, one place, or Pick a door', () => {
  const door = (name, broken = null) => (broken ? { label: '', broken } : { name, tile: `at://x/ing.dasl.masl/${name}` });
  assert.deepEqual(wayPlan({ state: 'dormant', doors: [] }), { kind: 'blocked' });
  assert.deepEqual(wayPlan({ state: 'error', doors: [] }), { kind: 'blocked' });
  assert.deepEqual(wayPlan({ state: 'open', doors: [door('a', 'gone')] }), { kind: 'blocked' });
  assert.deepEqual(wayPlan({ state: 'open', doors: [door('a')] }), { kind: 'go', door: door('a') });
  assert.deepEqual(wayPlan({ state: 'open', doors: [door('a'), door('b')] }), { kind: 'pick' });
  assert.deepEqual(wayPlan({ state: 'open', doors: [door('a'), door('b', 'gone')] }), { kind: 'pick' }, 'several listed: the broken one shows on Pick a door');
  assert.deepEqual(wayPlan(null), { kind: 'blocked' });
});

test('D, EX7: the trail: places passed through in a post, "Back to" arriving at the portal left by', () => {
  const t = createTrail({ uri: 'at://maze', name: 'Escher maze' });
  assert.equal(t.travelled, false);
  assert.equal(t.before, null);
  assert.equal(t.back(), null, 'nowhere to go back to from the post\'s own tile');
  t.go({ uri: 'at://forest', name: 'Winter Forest' }, { exit: 'slide', way: { did: 'did:plc:a', rkey: 'maze.slide' } });
  assert.equal(t.here.name, 'Winter Forest');
  assert.equal(t.before.name, 'Escher maze');
  assert.equal(t.travelled, true);
  t.go({ uri: 'at://lamp', name: 'Lamp post' }, { exit: 'wardrobe', way: { did: 'did:plc:a', rkey: 'forest.wardrobe' } });
  assert.equal(t.length, 3);
  let b = t.back();
  assert.deepEqual([b.place.name, b.entrance], ['Winter Forest', 'wardrobe']);
  b = t.back();
  assert.deepEqual([b.place.name, b.entrance], ['Escher maze', 'slide']);
  assert.equal(t.travelled, false);
  assert.equal(t.here.leftBy, null, 'the exit is forgotten once used to come back');
});

test('EX7: a new tab opens the way taken to the place now, or the post\'s own tile', () => {
  const door = { tile: 'at://did:plc:a/ing.dasl.masl/forest', name: 'Winter Forest' };
  const t = createTrail({ uri: 'at://did:plc:b/ing.dasl.masl/maze', name: 'Escher maze' });
  assert.deepEqual(tabFor(t, wayUri), { uri: 'at://did:plc:b/ing.dasl.masl/maze', state: null });
  t.go({ uri: door.tile, name: door.name }, { exit: 'slide', way: { did: 'did:plc:a', rkey: 'maze.slide', door } });
  assert.deepEqual(tabFor(t, wayUri), { uri: wayUri('did:plc:a', 'maze.slide'), state: { door } });
  assert.ok(tabFor(t, wayUri).uri.startsWith('raku:way/'));
});

test('round C: the expand and full-screen icons, the timings', () => {
  for (const n of ['expand', 'fullscreen', 'newtab', 'close', 'back']) assert.ok(ICON_NAMES.includes(n), n);
  assert.equal(PLAY_HERE.expandMs, 400);
  assert.equal(PLAY_HERE.expandEase, 'linear');
  assert.ok(PLAY_HERE.noteMs >= 3000);
});
