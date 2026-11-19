// Game saves (claude/cosmic-junkyard-v2-plan.md, CJ2-5 to CJ2-11): a game tile asks Raku to save a record of its own
// kind to the signed-in account, and Raku decides. The plain rules, no DOM (tested in Node, test/game-saves.test.mjs);
// app.js does the messages and src/game-save-ui.js the asking.
//
// The messages, on the tiles spec's data channel (the same envelopes as sprite games'; pyxorium/cosmic-junkyard-tile's
// README has them all):
//   Raku → tile   { kind: "can-save", collections: [...] }     answering its hello, only when it may save (CJ2-14)
//   tile → Raku   { kind: "write-record", id, action: "create", collection, record }   its "Save this run" (CJ2-5: shaped
//                 like sōm's writeRecord)
//   Raku → tile   { kind: "write-record-status", id, state: "asking" | "saving" }
//   Raku → tile   { kind: "write-record-result", id, ok: true, uri, handle } or { …, ok: false, error }, error one of
//                 declined | not-allowed | invalid | failed
//   tile → Raku   { kind: "open-record", uri }                 its "See it": only the record Raku just wrote for it (CJ2-11)
// Rules: only the tile at a game's own address (any version of it) may save, and only into its own collection (CJ2-9;
// GAME_SAVES in config.js); Raku takes only the game's own fields, fills in the game's address and the version actually
// running (CJ2-9), and checks the record exactly (the game's lexicon) before asking (CJ2-10).

import { UP, DOWN } from './renderers.js';
import { GAME_SAVES, GAME_SAVE_LIMITS } from './config.js';

export const SAVE_STATES = Object.freeze(['asking', 'saving']);
export const SAVE_ERRORS = Object.freeze(['declined', 'not-allowed', 'invalid', 'failed']);
const TILES = 'ing.dasl.masl';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A save message from a tile, read: { kind: 'write', id, action, collection, record } or { kind: 'open', uri }, else null. */
export function readSaveMessage(d) {
  if (!d || d.action !== UP || !isObj(d.payload)) return null;
  const p = d.payload;
  if (p.kind === 'write-record') {
    const id = typeof p.id === 'string' && p.id.length > 0 && p.id.length <= GAME_SAVE_LIMITS.idChars ? p.id : null;
    return { kind: 'write', id, action: p.action, collection: typeof p.collection === 'string' ? p.collection : '', record: p.record };
  }
  if (p.kind === 'open-record') return { kind: 'open', uri: typeof p.uri === 'string' ? p.uri : '' };
  return null;
}

/** The games the tile at this address may save for (its own address, any version): [] for every other tile. */
export const gamesForTile = (did, rkey) => Object.values(GAME_SAVES).filter((g) => g.tile.did === did && g.tile.rkey === rkey);

/**
 * The tile running in a pane, as saves name it: { did, rkey, cid } (cid: the version running), or null.
 *   - a tab: what it opened (pane.keep, a tile, with the record's CID it ran);
 *   - a tile post playing on Discover (Play here, claude/raku-play-here-games-plan.md, PG1): the place it is at now
 *     (pane.trail.here), the post's own tile or one reached by a way, with the version it plays (a post plays exactly the
 *     version it was posted with; a place reached by a way, the version read on arrival).
 */
export function runningTile(pane) {
  if (!pane) return null;
  if (pane.post) {
    const here = pane.trail && pane.trail.here;
    if (!here || typeof here.did !== 'string' || typeof here.uri !== 'string') return null;
    const parts = here.uri.split('/');                        // at://<did or handle>/ing.dasl.masl/<rkey>
    const cid = here.d && typeof here.d.cid === 'string' ? here.d.cid : null;
    if (parts.length !== 5 || parts[3] !== TILES || !parts[4] || !cid) return null;
    return { did: here.did, rkey: parts[4], cid };
  }
  const k = pane.keep;
  return k && k.kind === 'tile' && typeof k.cid === 'string' ? { did: k.did, rkey: k.rkey, cid: k.cid } : null;
}

export const canSaveMessage = (games) => ({ action: DOWN, payload: { kind: 'can-save', collections: games.map((g) => g.collection) } });
export function statusMessage(id, state) {
  if (!SAVE_STATES.includes(state)) throw new Error(`not a save status: ${state}`);
  return { action: DOWN, payload: { kind: 'write-record-status', id, state } };
}
export function resultMessage(id, result) {
  if (result.ok) return { action: DOWN, payload: { kind: 'write-record-result', id, ok: true, uri: result.uri, handle: result.handle } };
  if (!SAVE_ERRORS.includes(result.error)) throw new Error(`not a save error: ${result.error}`);
  return { action: DOWN, payload: { kind: 'write-record-result', id, ok: false, error: result.error } };
}

/**
 * A tile's write-record, decided: { game, record } (the record Raku would write) or { error } ('not-allowed' |
 * 'invalid'). running: the tile actually running in the tab, { did, rkey, cid } (cid: its record's version).
 */
export function decideWrite(msg, running, { now = new Date() } = {}) {
  if (!msg || !msg.id) return { error: 'invalid' };
  const game = running && gamesForTile(running.did, running.rkey).find((g) => g.collection === msg.collection);
  if (!game || typeof running.cid !== 'string') return { error: 'not-allowed' };
  if (msg.action !== 'create') return { error: 'invalid' };
  const made = game.recordFrom(msg.record, { game: { uri: `at://${running.did}/${TILES}/${running.rkey}`, cid: running.cid }, now });
  if (made.problem) return { error: 'invalid', problem: made.problem };
  return { game, record: made.record };
}

/** "See it" (CJ2-11): only an address Raku wrote for this tile in this load. → the address, or null. */
export function decideOpen(msg, written) {
  return msg && typeof msg.uri === 'string' && written.has(msg.uri) ? msg.uri : null;
}

/** At most GAME_SAVE_LIMITS.perLoad saves asked for per tile load, one at a time. */
export function createSaveBudget(max = GAME_SAVE_LIMITS.perLoad) {
  let left = max;
  let busy = null;
  return {
    start(id) { if (busy !== null || left <= 0) return false; left -= 1; busy = id; return true; },
    end() { busy = null; },
    get busy() { return busy; },
    get left() { return left; },
  };
}

/** What the dialog says a run's record holds (the words, CJ2-10). */
export function describeRun(record) {
  const moves = record.moves ? ` It includes your moves (${record.moves.changes.length} changes of direction), so anyone can replay the run to check its score.` : '';
  return `It shows your score (${record.score}), the day's course (${record.day}) and when you played.${moves}`;
}
