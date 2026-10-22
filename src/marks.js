// Marks: when you last visited a Discover source (Following, Recent tiles), for the quiet "New" on its cards.
//
// One door to this browser's storage for these marks (stage 6c, Q111). The marks stay on this device (owner,
// Oct 22: B): "New" means new on this screen, even after your shelf moves to your account's private records
// (permissioned spaces, later). The answer may come later (a Promise), so another store could go behind this
// door without changing the pages.
//
// Kept in one record-shaped entry (MARKS.key):
//   { "format": "raku-marks", "version": 1, "seen": { "following": "<ISO date>", "recent": "<ISO date>" } }
// Following's older entry (raku-following-seen, a number) is moved into it the first time it's read.
// A page load compares against the visit before it: the first answer for a name is kept until Raku reloads.

import { MARKS } from './config.js';

const FORMAT = 'raku-marks';

export function createMarks({ storage = null, now = () => Date.now(), limits = MARKS } = {}) {
  const session = new Map();     // name -> ms or null, fixed for this page load

  function read() {
    let rec = null;
    try { rec = JSON.parse(storage?.getItem(limits.key) || 'null'); } catch { rec = null; }
    if (!rec || rec.format !== FORMAT || rec.version !== 1 || typeof rec.seen !== 'object' || !rec.seen) rec = { format: FORMAT, version: 1, seen: {} };
    // Following's older entry, moved in once.
    for (const [name, oldKey] of Object.entries(limits.legacy || {})) {
      let old = null;
      try { old = storage?.getItem(oldKey); } catch { old = null; }
      if (old == null) continue;
      const ms = Number(old);
      if (!rec.seen[name] && Number.isFinite(ms) && ms > 0) rec.seen[name] = new Date(ms).toISOString();
      write(rec);
      try { storage?.removeItem?.(oldKey); } catch { /* fine */ }
    }
    return rec;
  }
  function write(rec) {
    try { storage?.setItem(limits.key, JSON.stringify(rec)); } catch { /* fine: no marks next time */ }
  }

  /** The visit before this page load, for one source (ms, or null on a first visit). */
  async function lastSeen(name) {
    if (!session.has(name)) {
      const t = Date.parse(read().seen[name]);
      session.set(name, Number.isFinite(t) ? t : null);
    }
    return session.get(name);
  }

  /** Remembers this visit for next time (this page load keeps comparing against the earlier one). */
  async function markSeen(name) {
    if (!session.has(name)) {
      const t = Date.parse(read().seen[name]);
      session.set(name, Number.isFinite(t) ? t : null);
    }
    const rec = read();
    rec.seen[name] = new Date(now()).toISOString();
    write(rec);
  }

  return { lastSeen, markSeen };
}
