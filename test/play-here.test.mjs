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
