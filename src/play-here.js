// "Play here" (claude/raku-play-here-plan.md, PH1 to PH8): a tile post's tile running inside its post on Discover.
// The rules, with no DOM (tested in Node); app.js runs the frame (createPostPlayer) and discover.js draws the slot.
//
//   PH1  a tile starts only on a press, and one runs at a time: starting another stops the one running
//   PH2  it stops on its ×, when another starts, when you leave Discover, or after PLAY_HERE.awayMs fully out of view
//   PH3  over LIMITS.askBytes, Play asks first ("Play anyway?"); over LIMITS.maxBytes, it can't be played
//   PH5  a tile with ways: stepping through a portal opens the way in a new tab (and the post's tile stops); a way that
//        leads nowhere keeps you at that portal, "The way is blocked."

import { LIMITS } from './config.js';
import { sizeVerdict } from './tiles.js';

/** What pressing Play does for a tile of this size: 'start' | 'ask' | 'refuse'. `ok`: tiles already let through. */
export function playVerdict(declaredBytes, key, ok = new Set(), limits = LIMITS) {
  const v = sizeVerdict(declaredBytes || 0, limits);
  if (v === 'refuse') return 'refuse';
  if (v === 'ask' && !ok.has(key)) return 'ask';
  return 'start';
}

/** Where a portal stepped through leads, from the signpost's view (ways.js lookUp): 'go' (open the way in a new tab)
 *  or 'blocked' (dormant, unreadable, every door broken). */
export function leaveVerdict(view) {
  if (!view || view.state !== 'open' || !Array.isArray(view.doors)) return 'blocked';
  return view.doors.some((d) => d && !d.broken) ? 'go' : 'blocked';
}

/**
 * One tile at a time, and the timer that stops a tile once it has been out of view a while.
 * start(slot) stops the one running (calling its stop) and makes `slot` the one; stop(slot) only stops that one.
 * seen(slot, inView): out of view starts the timer, back in view cancels it.
 */
export function createOneAtATime({ awayMs, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let current = null;       // { slot, stop }
  let away = null;
  const cancelAway = () => { if (away) { clearTimer(away); away = null; } };
  function stop(slot = current && current.slot) {
    if (!current || current.slot !== slot) return false;
    const c = current;
    current = null;
    cancelAway();
    c.stop();
    return true;
  }
  function start(slot, onStop) {
    if (current) stop(current.slot);
    current = { slot, stop: onStop };
  }
  function seen(slot, inView) {
    if (!current || current.slot !== slot) return;
    if (inView) { cancelAway(); return; }
    if (!away) away = setTimer(() => { away = null; stop(slot); }, awayMs);
  }
  return { start, stop, seen, get current() { return current ? current.slot : null; } };
}
