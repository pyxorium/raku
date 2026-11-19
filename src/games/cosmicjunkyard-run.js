// COPY (Nov 19 2026) of pyxorium/cosmic-junkyard-tile scripts/run-record.mjs, unchanged below this line: the exact check of a
// cafe.thunderbird.cosmicjunkyard.run record and how a host makes one from the game's write-record (game-saves.js). Edit it
// there (its tests: npm test in C:\thunderbird-cafe\cosmic-junkyard-tile), then copy it here too.
// A saved run's record (lexicons/cafe.thunderbird.cosmicjunkyard.run.json), for hosts: what the game sends in its
// write-record message, made into the record the host writes (hostRecord), and the exact check of that record
// (checkRunRecord). Raku keeps a copy of both (src/game-saves.js); another host can copy them too. No packages.

export const RUN_COLLECTION = 'cafe.thunderbird.cosmicjunkyard.run';
const GOES = ['left', 'right', 'stop'];
const TOP = ['$type', 'game', 'score', 'day', 'playedAt', 'tally', 'moves', 'createdAt'];
const FROM_GAME = ['score', 'day', 'playedAt', 'tally', 'moves'];
export const LIMITS = Object.freeze({ score: 10000, steps: 20000, changes: 4000, side: 4096, drops: 55,
  pastMs: 24 * 60 * 60 * 1000, aheadMs: 5 * 60 * 1000 });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const only = (o, keys) => Object.keys(o).find((k) => !keys.includes(k));
// An atproto datetime, as the game and hosts write them (toISOString): 2026-11-19T18:00:00.000Z
const isDatetime = (s) => typeof s === 'string' && s.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s));
function isDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** null when the record is exactly a run record (nothing unknown, everything in range), else what's wrong. */
export function checkRunRecord(r) {
  if (!isObj(r)) return 'not an object';
  const extra = only(r, TOP);
  if (extra) return `unknown field ${extra}`;
  if (r.$type !== undefined && r.$type !== RUN_COLLECTION) return '$type';
  if (!isObj(r.game) || only(r.game, ['uri', 'cid']) || typeof r.game.uri !== 'string' || !/^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/ing\.dasl\.masl\/[a-zA-Z0-9._~:-]{1,512}$/.test(r.game.uri)
    || typeof r.game.cid !== 'string' || !/^b[a-z2-7]{20,100}$/.test(r.game.cid)) return 'game';
  if (!isInt(r.score, -LIMITS.score, LIMITS.score)) return 'score';
  if (!isDay(r.day)) return 'day';
  if (!isDatetime(r.playedAt)) return 'playedAt';
  if (!isDatetime(r.createdAt)) return 'createdAt';
  if (r.tally !== undefined) {
    const t = r.tally;
    if (!isObj(t) || only(t, ['dodged', 'hit', 'saucers', 'aliens'])) return 'tally';
    for (const k of ['dodged', 'hit', 'saucers', 'aliens']) if (!isInt(t[k], 0, LIMITS.drops)) return `tally.${k}`;
    if (t.dodged + t.hit + t.saucers + t.aliens > LIMITS.drops) return 'tally';
  }
  if (r.moves !== undefined) {
    const m = r.moves;
    if (!isObj(m) || only(m, ['frame', 'steps', 'changes'])) return 'moves';
    if (!isObj(m.frame) || only(m.frame, ['width', 'height']) || !isInt(m.frame.width, 1, LIMITS.side) || !isInt(m.frame.height, 1, LIMITS.side)) return 'moves.frame';
    if (!isInt(m.steps, 1, LIMITS.steps)) return 'moves.steps';
    if (!Array.isArray(m.changes) || m.changes.length > LIMITS.changes) return 'moves.changes';
    let last = 0;
    for (const c of m.changes) {
      if (!isObj(c) || only(c, ['at', 'go'])) return 'moves.changes';
      if (!isInt(c.at, last + 1, m.steps)) return 'moves.changes at';
      if (!GOES.includes(c.go)) return 'moves.changes go';
      last = c.at;
    }
  }
  return null;
}

/**
 * The record a host writes for a game's write-record: the game's own fields (score, day, playedAt, tally, moves; nothing
 * else is taken), the game's address and version from the tile the host actually ran (game: { uri, cid }), and when it
 * was saved. → { record } or { problem }: the check above, and playedAt no more than a day before now nor five minutes
 * after it.
 */
export function hostRecord(sent, { game, now = new Date() }) {
  if (!isObj(sent)) return { problem: 'not an object' };
  const extra = only(sent, FROM_GAME);
  if (extra) return { problem: `unknown field ${extra}` };
  const record = { $type: RUN_COLLECTION, game: { uri: game.uri, cid: game.cid } };
  for (const k of FROM_GAME) if (sent[k] !== undefined) record[k] = structuredClone(sent[k]);
  record.createdAt = now.toISOString();
  const problem = checkRunRecord(record);
  if (problem) return { problem, record };
  const played = Date.parse(record.playedAt);
  if (played < now.getTime() - LIMITS.pastMs || played > now.getTime() + LIMITS.aheadMs) return { problem: 'playedAt', record };
  return { record };
}
