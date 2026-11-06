// Renderer tiles (claude/raku-renderer-tiles-plan.md, RT1 to RT10): the plain rules for talking to a renderer, no DOM
// (tested in Node, test/renderers.test.mjs). app.js does the drawing and the messages.
//
// The talk is the tiles spec's data protocol (tp-data, https://dasl.ing/tp-data.html):
//   tile → Raku   tiles-protocol-up-data-ready                 (its listen(): ready for the record)
//   Raku → tile   tiles-protocol-down-data-payload  { uri, cid, did, handle, collection, rkey, value }   (RT4)
//   tile → Raku   tiles-protocol-up-data-payload    { open: "at://…" }                                  (RT5)
// Raku answers every "ready" (a reloaded tile asks again) and never sends anything else. Nothing a renderer sends can
// write to any account: the one request is to open an address, as if it had been typed.

import { parseTarget } from './address.js';
import { RENDERERS, rendererFor, RENDER } from './config.js';

export const READY = 'tiles-protocol-up-data-ready';
export const UP = 'tiles-protocol-up-data-payload';
export const DOWN = 'tiles-protocol-down-data-payload';

/** What Raku hands a renderer: the record as stored, and where it came from (RT4). The same shape for every kind. */
export function recordPayload({ did, handle = null, collection, rkey, cid, value }) {
  return { uri: `at://${did}/${collection}/${rkey}`, cid: typeof cid === 'string' ? cid : null, did, handle: handle || null, collection, rkey, value };
}

/** A tab's title for a record: its own `name` when it has one (a common field; Raku reads nothing else), else its key. */
export function recordTitle(value, rkey) {
  const n = value && typeof value === 'object' && typeof value.name === 'string' ? value.name.replace(/\s+/g, ' ').trim() : '';
  return (n || rkey || 'Record').slice(0, 120);
}

/** The address a renderer asks Raku to open, or null when the request isn't one Raku takes (RT5: at:// only). */
export function readOpenRequest(payload, limits = RENDER) {
  const open = payload && typeof payload === 'object' ? payload.open : null;
  if (typeof open !== 'string' || open.length > limits.openMaxChars || !/^at:\/\/[^\s]+$/i.test(open)) return null;
  return open;
}

/**
 * What to do with an address a renderer asked for, as if it had been typed (RT5):
 *   { action: 'tab', uri }           a tile, an account, or a record with a renderer: a new Raku tab
 *   { action: 'record', target }     a record or collection with no renderer: the link message with the explorers
 *   { action: 'post', target }       a post: the link message, in the app chosen for posts
 *   { action: 'refuse', reason }     anything else
 */
export function openDecision(address, renderers = RENDERERS) {
  const r = parseTarget(address);
  if (!r.ok) return { action: 'refuse', reason: r.reason || "Raku can't read that address." };
  if (r.kind === 'tile' || r.kind === 'account') return { action: 'tab', uri: r.uri };
  if (r.kind === 'record' && rendererFor(r.collection, renderers)) return { action: 'tab', uri: r.uri };
  if (r.kind === 'record' || r.kind === 'collection') return { action: 'record', target: r };
  if (r.kind === 'post') return { action: 'post', target: r };
  return { action: 'refuse', reason: "Raku doesn't open that kind of address for a tile." };
}

/** A small gate per tab: one request at a time, none within `gapMs` of the last (RT5). */
export function createOpenGate({ gapMs = RENDER.gapMs, now = () => Date.now() } = {}) {
  let last = -Infinity;
  return { take() { const t = now(); if (t - last < gapMs) return false; last = t; return true; } };
}
