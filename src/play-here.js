// "Play here" (claude/raku-play-here-plan.md, PH1 to PH8): a tile post's tile running inside its post on Discover.
// The rules, with no DOM (tested in Node); app.js runs the frame (createPostPlayer) and discover.js draws the slot.
//
//   PH1  a tile starts only on a press, and one runs at a time: starting another stops the one running
//   PH2  it stops on its ×, when another starts, when you leave Discover, or after PLAY_HERE.awayMs fully out of view
//   PH3  over LIMITS.askBytes, Play asks first ("Play anyway?"); over LIMITS.maxBytes, it can't be played
//   PH5  a tile with ways: stepping through a portal opens the way in a new tab (and the post's tile stops); a way that
//        leads nowhere keeps you at that portal, "The way is blocked." (Round C replaced the new tab: below.)
//
// Round C (claude/raku-expand-plan.md, EX1 to EX8), the rules here too:
//   EX4  expanding opens the playing tile from its post to Raku's window (PLAY_HERE.expand: 'window', 400 ms, linear)
//   EX8  when the system asks for reduced motion, a plain fade instead
//   D    travel inside the post (EX6, EX7): a portal's signpost read as a tab reads it (wayPlan); the places passed
//        through in this post kept in a small trail, so "Back to …" arrives at the portal left by (createTrail)
// Autoplay ("After C", AU1 to AU6): the remembered choice (createAutoplaySetting) and when a tile starts by itself
//   (createAutoplayWatch, autoplaySize)

import { LIMITS, PLAY_HERE, AUTOPLAY } from './config.js';
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

// ---------- round C: expanding (EX4, EX8) ----------
/**
 * How expanding and closing move: { technique: 'window' | 'fade', ms, ease }. EX4 (owner, Nov 8, after trying grow,
 * window and banner with the real maze): window, 400 ms, linear: the live tile pinned at the stage, shown through a clip
 * opening from the post's box. Reduced motion (EX8): a plain fade.
 */
export function expandMotion({ reduce = false, defaults = PLAY_HERE } = {}) {
  return { technique: reduce ? 'fade' : defaults.expand, ms: defaults.expandMs, ease: defaults.expandEase };
}

/** A clip that shows only `r` of a box pinned at `box` (both { top, left, right, bottom }), as CSS clip-path. */
export function clipInset(r, box, round = 0) {
  const px = (n) => `${Math.max(0, Math.round(n))}px`;
  return `inset(${px(r.top - box.top)} ${px(box.right - r.right)} ${px(box.bottom - r.bottom)} ${px(r.left - box.left)}${round ? ` round ${round}px` : ''})`;
}

// ---------- round C: travel inside the post (D, EX6, EX7) ----------
/** Where stepping through a portal goes, from the signpost's view (ways.js lookUp), as a tab does (app.js leaveBy):
 *  { kind: 'blocked' } (dormant, unreadable, every door broken), { kind: 'go', door } (one place), { kind: 'pick' }. */
export function wayPlan(view) {
  const usable = view && view.state === 'open' && Array.isArray(view.doors) ? view.doors.filter((d) => d && !d.broken) : [];
  if (!usable.length) return { kind: 'blocked' };
  if (view.doors.length === 1) return { kind: 'go', door: usable[0] };
  return { kind: 'pick' };
}

/**
 * The places passed through in one post (EX7): the post's own tile first. go(place, { exit, way }) records the exit
 * left by on the place being left, and the way taken to the new one; back() returns to the place before, with the
 * entrance to arrive at (the portal left by, as Back in a tab). here: the place now; before: the one "Back to" goes to.
 */
export function createTrail(home) {
  const list = [{ ...home, leftBy: null, way: null }];
  return {
    get here() { return list[list.length - 1]; },
    get before() { return list.length > 1 ? list[list.length - 2] : null; },
    get travelled() { return list.length > 1; },
    get length() { return list.length; },
    go(place, { exit = null, way = null } = {}) {
      list[list.length - 1].leftBy = exit;
      list.push({ ...place, leftBy: null, way });
      return list[list.length - 1];
    },
    back() {
      if (list.length < 2) return null;
      list.pop();
      const place = list[list.length - 1];
      const entrance = place.leftBy;
      place.leftBy = null;
      return { place, entrance };
    },
  };
}

/** What a new tab opens for the place now (EX7): the way taken to it ({ uri: raku:way/…, state: { door } }), or the
 *  post's own tile. `wayUri` is address.js's. */
export function tabFor(trail, wayUri) {
  const at = trail.here;
  if (at.way && at.way.did && at.way.rkey) return { uri: wayUri(at.way.did, at.way.rkey), state: at.way.door ? { door: at.way.door } : null };
  return { uri: at.uri, state: null };
}

// ---------- Autoplay (claude/raku-expand-plan.md, "After C", AU1 to AU6) ----------
/**
 * The "Autoplay tiles" choice (AU1: off by default; remembered in this browser, as the post-app choice is; AU5: the
 * switch is in Tile posts' header and the account menu, both reading and writing this). { on, set(on), onChange(fn) }.
 */
export function createAutoplaySetting({ storage = null, key = AUTOPLAY.key } = {}) {
  let on = false;
  try { on = storage?.getItem(key) === 'on'; } catch { on = false; }
  const listeners = new Set();
  return {
    get on() { return on; },
    set(value) {
      const next = !!value;
      if (next === on) return;
      on = next;
      try { storage?.setItem(key, on ? 'on' : 'off'); } catch { /* fine: this visit only */ }
      for (const fn of [...listeners]) fn(on);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/**
 * When a tile post's tile starts by itself (AU2): once about two-thirds of its box is on screen (share) and has stayed
 * so for settleMs (scrolling quickly past starts nothing). update(id, ratio) as the page sees each tile; start(id) is
 * called when one qualifies and canStart(id) agrees (the switch on, the tile ready and small enough, AU4, …); the newest
 * to qualify takes over, as one at a time already does. recheck() after the switch is turned on: tiles already showing
 * qualify after settling. Timers come in for the tests.
 * (Nov 9 2026: a tile leaving the two-thirds also re-arms the others still showing, so one that was held back while
 * another played well in view gets its turn: see autoplayMayStart.)
 */
export function createAutoplayWatch({ share = AUTOPLAY.share, settleMs = AUTOPLAY.settleMs, canStart, start,
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) }) {
  const ratios = new Map();
  const pending = new Map();
  const cancel = (id) => { if (pending.has(id)) { clearTimer(pending.get(id)); pending.delete(id); } };
  const arm = (id) => {
    if (pending.has(id)) return;
    pending.set(id, setTimer(() => {
      pending.delete(id);
      if ((ratios.get(id) || 0) >= share && canStart(id)) start(id);
    }, settleMs));
  };
  return {
    update(id, ratio) {
      const was = ratios.get(id) || 0;
      ratios.set(id, ratio);
      if (ratio < share) {
        cancel(id);
        if (was >= share) for (const [other, r] of ratios) if (other !== id && r >= share) arm(other);   // its turn may come now
      } else if (was < share) arm(id);
    },
    recheck() { for (const [id, r] of ratios) if (r >= share) arm(id); },
    /** How much of this tile was last seen on screen (0 to 1). */
    ratio(id) { return ratios.get(id) || 0; },
    forget(id) { cancel(id); ratios.delete(id); },
    stop() { for (const id of [...pending.keys()]) cancel(id); ratios.clear(); },
    get pending() { return pending.size; },
  };
}

/**
 * May a tile post's tile start by itself now, with another one perhaps running? (Fix, Nov 9 2026: with two posts well on
 * screen at once, each start stopped the other and the stopped one started again: "Starting the tile…", the banner,
 * again, over and over.) Never over itself, never over a tile you started or clicked (byHand), and never over another
 * that is still about two-thirds on screen (currentRatio ≥ share): it takes over only once that one is scrolling away.
 */
export function autoplayMayStart({ slot, current = null, byHand = false, currentRatio = 0, share = AUTOPLAY.share }) {
  if (!current) return true;
  if (current === slot || byHand) return false;
  return currentRatio < share;
}

/** AU4: a tile over the size Raku asks about (25 MB) never starts by itself; it keeps Play here and its question. */
export const autoplaySize = (bytes) => !(Number.isFinite(bytes) && bytes > LIMITS.askBytes);
