// Your shelf, as data: the tiles and accounts you keep (claude/raku-plan.md, stage 2).
//
// Kept only in this browser (localStorage, key "raku-shelf"), with Export and Import as a small file.
// Every storage call is guarded: a private window or blocked storage never breaks Raku; the shelf then
// works for this visit only (`saved` says so).
//
// A kept tile holds where to find it (the account's DID and the record key) plus its name and author
// as last seen, so cards can be drawn before the record is fetched again. The tile itself stays in its
// maker's account; the shelf only points to it. A kept account always shows that account's current tiles.
//
// Order: most recently kept first (arranging by hand may come later, step 2b).

import { isDid, isRkey, isHandle, atUri } from './address.js';

export const STORAGE_KEY = 'raku-shelf';
export const SHELF_LIMITS = Object.freeze({ tiles: 2000, accounts: 500, text: 200 });
const FORMAT = 'raku-shelf';

const clip = (s, n = SHELF_LIMITS.text) => (typeof s === 'string' ? s.slice(0, n) : '');
const validDid = (d) => typeof d === 'string' && isDid(d);

function cleanTile(t, now) {
  if (!t || !validDid(t.did) || typeof t.rkey !== 'string' || !isRkey(t.rkey)) return null;
  const keptAt = Number.isFinite(Date.parse(t.keptAt)) ? new Date(t.keptAt).toISOString() : new Date(now).toISOString();
  const by = typeof t.by === 'string' && isHandle(t.by) ? t.by.toLowerCase() : '';
  return { did: t.did, rkey: t.rkey, name: clip(t.name), by, keptAt };
}
function cleanAccount(a, now) {
  if (!a || !validDid(a.did)) return null;
  const keptAt = Number.isFinite(Date.parse(a.keptAt)) ? new Date(a.keptAt).toISOString() : new Date(now).toISOString();
  const handle = typeof a.handle === 'string' && isHandle(a.handle) ? a.handle.toLowerCase() : '';
  return { did: a.did, handle, keptAt };
}
const byNewest = (x, y) => (x.keptAt < y.keptAt ? 1 : x.keptAt > y.keptAt ? -1 : 0);
const tileKey = (did, rkey) => `${did} ${rkey}`;

export function createShelf({ storage = null, now = () => Date.now() } = {}) {
  let tiles = new Map();      // "did rkey" -> tile
  let accounts = new Map();   // did -> account
  let saved = true;
  const listeners = new Set();

  function read() {
    tiles = new Map();
    accounts = new Map();
    let data = null;
    try {
      const s = storage?.getItem(STORAGE_KEY);
      data = s ? JSON.parse(s) : null;
    } catch { data = null; }
    for (const t of Array.isArray(data?.tiles) ? data.tiles.slice(0, SHELF_LIMITS.tiles) : []) {
      const c = cleanTile(t, now());
      if (c) tiles.set(tileKey(c.did, c.rkey), c);
    }
    for (const a of Array.isArray(data?.accounts) ? data.accounts.slice(0, SHELF_LIMITS.accounts) : []) {
      const c = cleanAccount(a, now());
      if (c) accounts.set(c.did, c);
    }
  }
  function write(source) {
    try {
      if (!storage) throw new Error('no storage');
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tiles: [...tiles.values()], accounts: [...accounts.values()] }));
      saved = true;
    } catch {
      saved = false;
    }
    listeners.forEach((f) => f({ source }));
  }
  read();

  return {
    get saved() { return saved && !!storage; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** Another Raku tab changed the shelf (the browser's storage event): read it again. */
    reload() { read(); listeners.forEach((f) => f({ source: 'elsewhere' })); },

    tiles: () => [...tiles.values()].sort(byNewest),
    accounts: () => [...accounts.values()].sort(byNewest),
    hasTile: (did, rkey) => tiles.has(tileKey(did, rkey)),
    hasAccount: (did) => accounts.has(did),

    keepTile({ did, rkey, name = '', by = '' }, source = 'star') {
      if (tiles.size >= SHELF_LIMITS.tiles && !tiles.has(tileKey(did, rkey))) return false;
      const c = cleanTile({ did, rkey, name, by, keptAt: new Date(now()).toISOString() }, now());
      if (!c) return false;
      tiles.set(tileKey(did, rkey), c);
      write(source);
      return true;
    },
    removeTile(did, rkey, source = 'star') {
      if (tiles.delete(tileKey(did, rkey))) write(source);
    },
    /** Refreshes a kept tile's name and author (as last seen), without moving it. */
    noteTile(did, rkey, { name, by }) {
      const t = tiles.get(tileKey(did, rkey));
      if (!t) return;
      const n = clip(name);
      const b = typeof by === 'string' && isHandle(by) ? by.toLowerCase() : t.by;
      if (n === t.name && b === t.by) return;
      t.name = n || t.name;
      t.by = b;
      try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tiles: [...tiles.values()], accounts: [...accounts.values()] })); } catch { /* fine */ }
    },
    keepAccount({ did, handle = '' }, source = 'star') {
      if (accounts.size >= SHELF_LIMITS.accounts && !accounts.has(did)) return false;
      const c = cleanAccount({ did, handle, keptAt: new Date(now()).toISOString() }, now());
      if (!c) return false;
      accounts.set(did, c);
      write(source);
      return true;
    },
    removeAccount(did, source = 'star') {
      if (accounts.delete(did)) write(source);
    },

    /** The Export file's contents. */
    exportData() {
      return {
        format: FORMAT, version: 1, exportedAt: new Date(now()).toISOString(),
        accounts: this.accounts().map(({ did, handle, keptAt }) => ({ did, handle, keptAt })),
        tiles: this.tiles().map(({ did, rkey, name, by, keptAt }) => ({ uri: atUri(did, rkey), did, rkey, name, by, keptAt })),
      };
    },
    /** Adds an Export file's contents to the shelf (never removes). → { tiles, accounts, skipped } or null if it isn't a shelf file. */
    importData(data) {
      if (!data || data.format !== FORMAT || data.version !== 1) return null;
      let added = { tiles: 0, accounts: 0 };
      let skipped = 0;
      for (const t of Array.isArray(data.tiles) ? data.tiles : []) {
        const c = cleanTile(t, now());
        if (!c) { skipped++; continue; }
        const k = tileKey(c.did, c.rkey);
        if (tiles.has(k)) continue;
        if (tiles.size >= SHELF_LIMITS.tiles) { skipped++; continue; }
        tiles.set(k, c);
        added.tiles++;
      }
      for (const a of Array.isArray(data.accounts) ? data.accounts : []) {
        const c = cleanAccount(a, now());
        if (!c) { skipped++; continue; }
        if (accounts.has(c.did)) continue;
        if (accounts.size >= SHELF_LIMITS.accounts) { skipped++; continue; }
        accounts.set(c.did, c);
        added.accounts++;
      }
      if (added.tiles || added.accounts) write('import');
      return { ...added, skipped };
    },
  };
}

/** The Export file's name: raku-shelf-2026-10-20.json */
export const exportFileName = (date = new Date()) => `raku-shelf-${date.toISOString().slice(0, 10)}.json`;
