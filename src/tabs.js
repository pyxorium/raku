// The tabs, as data: which are open, which is in front, each one's history. No DOM here (tested in Node).
//
// A tab shows either a tile (its at:// address) or the first screen (address null). Back and forward
// move through the addresses that tab has shown. The open tabs are kept in the page's own address
// (the part after #), so a reload or a copied link reopens the same set:
//   #t=<at:// address, encoded>,<…>&a=<the tab in front, from 0>       (an empty slot = a first screen)

import { TABS } from './config.js';
import { parseAddress } from './address.js';

let nextId = 1;
const newTab = (uri = null) => ({ id: `t${nextId++}`, history: [uri], at: 0 });
export const current = (tab) => tab.history[tab.at];

export function createTabs({ max = TABS.max } = {}) {
  let tabs = [newTab()];
  let active = tabs[0].id;
  const listeners = new Set();
  const changed = (what) => listeners.forEach((f) => f(what));
  const find = (id) => tabs.find((t) => t.id === id);

  return {
    get list() { return tabs; },
    get active() { return find(active); },
    get full() { return tabs.length >= max; },
    max,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },

    /** Opens a new tab (a tile, or the first screen). → the tab, or null when the cap is reached. */
    open(uri = null, { front = true } = {}) {
      if (tabs.length >= max) return null;
      const t = newTab(uri);
      tabs.push(t);
      if (front) active = t.id;
      changed({ type: 'open', id: t.id });
      return t;
    },

    /** Shows another address in a tab (the address box, a pick); drops any forward history. */
    go(id, uri) {
      const t = find(id);
      if (!t) return;
      if (current(t) === uri) { changed({ type: 'reload', id }); return; }
      t.history = t.history.slice(0, t.at + 1);
      t.history.push(uri);
      t.at = t.history.length - 1;
      changed({ type: 'go', id });
    },

    canBack(id) { const t = find(id); return !!t && t.at > 0; },
    canForward(id) { const t = find(id); return !!t && t.at < t.history.length - 1; },
    back(id) { const t = find(id); if (t && t.at > 0) { t.at--; changed({ type: 'go', id }); } },
    forward(id) { const t = find(id); if (t && t.at < t.history.length - 1) { t.at++; changed({ type: 'go', id }); } },

    activate(id) { if (find(id) && active !== id) { active = id; changed({ type: 'activate', id }); } },

    /** Closes a tab; the last tab closing leaves a fresh first screen. */
    close(id) {
      const i = tabs.findIndex((t) => t.id === id);
      if (i < 0) return;
      tabs.splice(i, 1);
      if (!tabs.length) tabs.push(newTab());
      if (active === id) active = tabs[Math.min(i, tabs.length - 1)].id;
      changed({ type: 'close', id });
    },

    /** The hash that reopens these tabs. */
    toHash() {
      const t = tabs.map((x) => (current(x) ? encodeURIComponent(current(x)) : '')).join(',');
      const a = tabs.findIndex((x) => x.id === active);
      return `#t=${t}&a=${a}`;
    },

    /** Reopens tabs from a hash (unknown or invalid addresses become first screens). */
    fromHash(hash) {
      const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
      const t = p.get('t');
      if (t === null) return false;
      const uris = t.split(',').slice(0, max).map((s) => {
        if (!s) return null;
        let v;
        try { v = decodeURIComponent(s); } catch { return null; }
        const r = parseAddress(v);
        return r.ok ? r.uri : null;
      });
      tabs = (uris.length ? uris : [null]).map((u) => newTab(u));
      const a = Math.min(Math.max(0, Number(p.get('a')) || 0), tabs.length - 1);
      active = tabs[a].id;
      changed({ type: 'restore' });
      return true;
    },
  };
}
