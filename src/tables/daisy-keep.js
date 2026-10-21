// What this browser keeps for a Daisy table played across two computers (stage 5), so a reload, a closed
// tab or "Back to the start" can pick the match up again. Adapted COPY of the site's src/daisy/storage.js
// (Oct 21 2026), under Raku's own names, and with the storage passed in (so it's tested in Node):
//   localStorage   raku-daisy-table:<table>:<did>  { me, other, snapshot, savedAt }   (a day)
//   sessionStorage raku-daisy-tab:<table>          the account this browser tab sits as
// The snapshot is your seat's house state, with its secret seed: it never leaves this browser. Every read
// and write is guarded (a private window or blocked storage just means no picking up again).
import { DAISY_KEEP } from '../config.js';

const safe = (f, fallback = null) => { try { return f(); } catch { return fallback; } };

export function createDaisyKeep({ local = safe(() => globalThis.localStorage), session = safe(() => globalThis.sessionStorage), keepFor = DAISY_KEEP.keepFor } = {}) {
  const P = DAISY_KEEP.tablePrefix;
  const T = DAISY_KEEP.tabPrefix;
  const entries = () => {
    const out = [];
    safe(() => {
      for (let i = 0; i < local.length; i++) {
        const k = local.key(i);
        if (k && k.startsWith(P)) out.push(k);
      }
    });
    return out;
  };
  const read = (k) => safe(() => JSON.parse(local.getItem(k)));
  const fresh = (v, now) => v && v.me && typeof v.me.did === 'string' && now - v.savedAt < keepFor;

  return {
    /** Keeps your seat at a table (and says this browser tab sits as that account). */
    keep(table, entry, now = Date.now()) {
      safe(() => local.setItem(`${P}${table}:${entry.me.did}`, JSON.stringify({ ...entry, savedAt: now })));
      safe(() => session.setItem(`${T}${table}`, entry.me.did));
    },
    /** The seats this browser keeps at a table (one per account), still within a day. */
    kept(table, now = Date.now()) {
      return entries().filter((k) => k.startsWith(`${P}${table}:`)).map(read).filter((v) => fresh(v, now));
    },
    /** The account this browser tab sits as at a table, or null. */
    tabAccount: (table) => safe(() => session.getItem(`${T}${table}`)),
    /** Forgets tables older than a day. */
    forgetOld(now = Date.now()) {
      for (const k of entries()) { const v = read(k); if (!fresh(v, now)) safe(() => local.removeItem(k)); }
    },
    /** The unfinished matches kept for an account, newest first: [{ table, with, savedAt }]. A match counts
     *  as unfinished while it has another player and isn't over or abandoned, as far as this browser knows. */
    inProgress(did, now = Date.now()) {
      const out = [];
      for (const k of entries()) {
        if (!k.endsWith(`:${did}`)) continue;
        const v = read(k);
        if (!fresh(v, now) || v.me.did !== did || !v.other || !v.other.handle) continue;
        const phase = v.snapshot && v.snapshot.shared && v.snapshot.shared.phase;
        if (phase === 'over' || phase === 'abandoned') continue;
        out.push({ table: k.slice(P.length, k.length - did.length - 1), with: v.other.handle, savedAt: v.savedAt });
      }
      return out.sort((a, b) => b.savedAt - a.savedAt);
    },
  };
}
