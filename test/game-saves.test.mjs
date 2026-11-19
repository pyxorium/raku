// Game saves (claude/cosmic-junkyard-v2-plan.md, CJ2-5 to CJ2-11): the plain rules in src/game-saves.js, and the copy
// of Cosmic Junkyard's record check (src/games/cosmicjunkyard-run.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSaveMessage, gamesForTile, canSaveMessage, statusMessage, resultMessage, decideWrite, decideOpen, createSaveBudget, describeRun,
} from '../src/game-saves.js';
import { UP, DOWN } from '../src/renderers.js';
import { GAME_SAVES, GAME_SAVE_LIMITS, rakuSet, savesName } from '../src/config.js';
import { createAccounts } from '../src/auth.js';
import { checkRunRecord } from '../src/games/cosmicjunkyard-run.js';

const CJ = GAME_SAVES.cosmicjunkyard;
const RUNNING = { did: 'did:plc:6vxjigxrqizmbo56gojxico3', rkey: '3mwvoqidyqd24', cid: 'bafyreiabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnop' };
const NOW = new Date('2026-11-19T18:00:10.000Z');
const SENT = { score: 187, day: '2026-11-19', playedAt: '2026-11-19T18:00:00.000Z', tally: { dodged: 30, hit: 5, saucers: 6, aliens: 4 } };
const MOVES = { frame: { width: 48, height: 48 }, steps: 2600, changes: [{ at: 3, go: 'left' }, { at: 40, go: 'stop' }, { at: 90, go: 'right' }] };
const up = (payload) => ({ action: UP, payload });
const write = (over = {}) => readSaveMessage(up({ kind: 'write-record', id: 'run-1', action: 'create', collection: CJ.collection, record: SENT, ...over }));

test('Cosmic Junkyard: its address, its collection, in the "Raku" set (CJ2-6, CJ2-7, CJ2-9)', () => {
  assert.equal(CJ.collection, 'cafe.thunderbird.cosmicjunkyard.run');
  assert.deepEqual({ ...CJ.tile }, { did: 'did:plc:6vxjigxrqizmbo56gojxico3', rkey: '3mwvoqidyqd24' });
  assert.ok(rakuSet().repo.includes(CJ.collection));
  assert.equal(savesName('cosmicjunkyard'), 'Cosmic Junkyard');
  assert.equal(savesName('sevenup'), 'Seven-Up');
  assert.ok(!Object.keys(GAME_SAVES).some((id) => ['sevenup', 'daisy'].includes(id)), 'a game id is not a table id (Always shares one list)');
});

test('reading the messages: write-record and open-record only, on the data channel', () => {
  assert.deepEqual(write(), { kind: 'write', id: 'run-1', action: 'create', collection: CJ.collection, record: SENT });
  assert.equal(write({ id: '' }).id, null);
  assert.equal(write({ id: 'x'.repeat(GAME_SAVE_LIMITS.idChars + 1) }).id, null);
  assert.equal(write({ id: 7 }).id, null);
  assert.deepEqual(readSaveMessage(up({ kind: 'open-record', uri: 'at://x' })), { kind: 'open', uri: 'at://x' });
  assert.equal(readSaveMessage(up({ kind: 'hello', v: 1 })), null);
  assert.equal(readSaveMessage({ action: DOWN, payload: { kind: 'write-record' } }), null);
  assert.equal(readSaveMessage(up([1])), null);
  assert.equal(readSaveMessage(null), null);
});

test('only the game\'s own tile is offered saving, any version (CJ2-9, CJ2-14)', () => {
  assert.deepEqual(gamesForTile(RUNNING.did, RUNNING.rkey), [CJ]);
  assert.deepEqual(gamesForTile(RUNNING.did, '3mwvoqidyqd25'), []);
  assert.deepEqual(gamesForTile('did:plc:someoneelseaaaaaaaaaaaaa', RUNNING.rkey), []);
  assert.deepEqual(canSaveMessage([CJ]), { action: DOWN, payload: { kind: 'can-save', collections: ['cafe.thunderbird.cosmicjunkyard.run'] } });
});

test('the answers, as the tile reads them', () => {
  assert.deepEqual(statusMessage('run-1', 'asking'), { action: DOWN, payload: { kind: 'write-record-status', id: 'run-1', state: 'asking' } });
  assert.throws(() => statusMessage('run-1', 'done'));
  assert.deepEqual(resultMessage('run-1', { ok: true, uri: 'at://a/b/c', handle: 'h.test' }).payload, { kind: 'write-record-result', id: 'run-1', ok: true, uri: 'at://a/b/c', handle: 'h.test' });
  assert.deepEqual(resultMessage('run-1', { ok: false, error: 'declined' }).payload, { kind: 'write-record-result', id: 'run-1', ok: false, error: 'declined' });
  assert.throws(() => resultMessage('run-1', { ok: false, error: 'nope' }));
});

test('a write, decided: Raku fills in the game and the version running; the game\'s own fields only', () => {
  const d = decideWrite(write(), RUNNING, { now: NOW });
  assert.equal(d.game, CJ);
  assert.deepEqual(d.record, { $type: CJ.collection, game: { uri: 'at://did:plc:6vxjigxrqizmbo56gojxico3/ing.dasl.masl/3mwvoqidyqd24', cid: RUNNING.cid }, ...SENT, createdAt: NOW.toISOString() });
  assert.equal(checkRunRecord(d.record), null);
  // a game naming another game, or its own version, doesn't get to: those aren't its fields
  assert.equal(decideWrite(write({ record: { ...SENT, game: { uri: 'at://x/ing.dasl.masl/y', cid: 'bafyreixx' } } }), RUNNING, { now: NOW }).error, 'invalid');
  assert.equal(decideWrite(write({ record: { ...SENT, $type: CJ.collection } }), RUNNING, { now: NOW }).error, 'invalid');
  // with moves
  const m = decideWrite(write({ record: { ...SENT, moves: MOVES } }), RUNNING, { now: NOW });
  assert.deepEqual(m.record.moves, MOVES);
  assert.match(describeRun(m.record), /3 changes of direction/);
  assert.doesNotMatch(describeRun(d.record), /moves/);
});

test('refused: another tile, another collection, not create, a bad record, a stale or future time', () => {
  assert.equal(decideWrite(write(), { ...RUNNING, rkey: 'other' }, { now: NOW }).error, 'not-allowed');
  assert.equal(decideWrite(write(), null, { now: NOW }).error, 'not-allowed');
  assert.equal(decideWrite(write(), { ...RUNNING, cid: undefined }, { now: NOW }).error, 'not-allowed');
  assert.equal(decideWrite(write({ collection: 'cafe.thunderbird.tile.post' }), RUNNING, { now: NOW }).error, 'not-allowed');
  assert.equal(decideWrite(write({ action: 'update' }), RUNNING, { now: NOW }).error, 'invalid');
  assert.equal(decideWrite(write({ id: '' }), RUNNING, { now: NOW }).error, 'invalid');
  for (const bad of [{ ...SENT, score: 1.5 }, { ...SENT, score: 99999 }, { ...SENT, day: '2026-13-01' }, { ...SENT, extra: true },
    { ...SENT, tally: { ...SENT.tally, hit: -1 } }, { ...SENT, moves: { ...MOVES, changes: [{ at: 5, go: 'jump' }] } },
    { ...SENT, moves: { ...MOVES, changes: [{ at: 9, go: 'left' }, { at: 4, go: 'right' }] } }, { ...SENT, moves: { ...MOVES, frame: { width: 0, height: 48 } } },
    { ...SENT, playedAt: '2026-11-17T18:00:00.000Z' }, { ...SENT, playedAt: '2026-11-19T19:00:00.000Z' }, 'a string', null]) {
    assert.equal(decideWrite(write({ record: bad }), RUNNING, { now: NOW }).error, 'invalid', JSON.stringify(bad));
  }
});

test('"See it" opens only an address Raku wrote for this tile (CJ2-11)', () => {
  const written = new Set(['at://did:plc:me/cafe.thunderbird.cosmicjunkyard.run/3m2a']);
  assert.equal(decideOpen({ kind: 'open', uri: 'at://did:plc:me/cafe.thunderbird.cosmicjunkyard.run/3m2a' }, written), 'at://did:plc:me/cafe.thunderbird.cosmicjunkyard.run/3m2a');
  assert.equal(decideOpen({ kind: 'open', uri: 'at://did:plc:me/app.bsky.feed.post/3m2a' }, written), null);
  assert.equal(decideOpen({ kind: 'open', uri: 'https://example.com' }, written), null);
});

test('one save at a time, at most perLoad a load', () => {
  const b = createSaveBudget(2);
  assert.ok(b.start('a'));
  assert.ok(!b.start('b'), 'one at a time');
  b.end();
  assert.ok(b.start('b'));
  b.end();
  assert.ok(!b.start('c'), 'the allowance is spent');
});

test('"Always" for a game is kept per account and game, and listed with the tables\'', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const a = createAccounts(storage);
  a.add('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'a.test');
  a.add('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', 'b.test');
  a.setAlways('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'cosmicjunkyard', true);
  a.setAlways('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'sevenup', true);
  assert.ok(a.hasAlways('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'cosmicjunkyard'));
  assert.ok(!a.hasAlways('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', 'cosmicjunkyard'));
  assert.deepEqual(a.alwaysList().map((e) => e.tableId).sort(), ['cosmicjunkyard', 'sevenup']);
  a.remove('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(a.alwaysList(), []);
});
