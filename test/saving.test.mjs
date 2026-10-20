import test from 'node:test';
import assert from 'node:assert/strict';
import { withSeat, makeRecord } from '../src/tables/saving.js';
import * as sevenup from '../src/tables/sevenup-record.js';
import * as daisy from '../src/tables/daisy-record.js';
import { TABLES, BOT } from '../src/config.js';

const ME = { did: 'did:plc:6vxjigxrqizmbo56gojxico3', handle: 'thunderbird.cafe' };
const result = () => ({
  matchId: '3my27cwible2m',
  players: [{ did: 'reader:you', handle: 'you', diceStyle: 'bone' }, { did: BOT.did, handle: BOT.handle, diceStyle: 'jade', bot: true }],
  firstPlayer: 1,
  rounds: [1, 2, 1, 2, 1, 2].map((player) => ({ player, rolls: [[2, 3], [3, 4]] })),
  handoffs: ['granted', 'granted', 'auto', 'granted', 'granted'],
  summary: [{ longest: 2, quickest: 2, specials: 0 }, { longest: 2, quickest: 2, specials: 1 }],
});

test("your seat in the record is the account you save to; the house's result is left as it was", () => {
  const r = result();
  const w = withSeat(r, 1, ME);
  assert.deepEqual(w.players[0], { did: ME.did, handle: ME.handle, diceStyle: 'bone' });
  assert.deepEqual(w.players[1], r.players[1]);
  assert.equal(r.players[0].did, 'reader:you');
});

test("a Seven-Up record from Raku: the game's own shape and check, stamped with the pinned house", () => {
  const { record, problem } = makeRecord(sevenup, TABLES.sevenup, result(), 1, ME);
  assert.equal(problem, undefined);
  assert.equal(record.$type, 'cafe.thunderbird.sevenup.match');
  assert.equal(record.$type, TABLES.sevenup.collection);
  assert.deepEqual(record.house, { uri: TABLES.sevenup.house.uri, cid: TABLES.sevenup.house.cid });
  assert.equal(record.players[0].did, ME.did);
  assert.ok(record.players[1].bot);
});

test("a record for the bot's seat, or with you unsigned, is refused", () => {
  const r = result(); r.players[0] = { did: 'did:plc:someoneelseeeeeeeeeeeeee', handle: 'someone.example', diceStyle: 'bone' };
  assert.equal(makeRecord(sevenup, TABLES.sevenup, r, 2, ME).problem, 'a bot seat does not save');
  assert.equal(makeRecord(sevenup, TABLES.sevenup, result(), 1, { did: 'reader:you', handle: 'you' }).problem, 'player did');
});

test("Daisy's check re-checks the dice: a made-up match is refused", () => {
  const fake = { matchId: '3my27cwible2m', target: 25, players: [{ did: 'reader:you', handle: 'you', glaze: 'bone' }, { did: BOT.did, handle: BOT.handle, glaze: 'jade', bot: true }],
    firstPlayer: 1, commitments: ['a'.repeat(64), 'b'.repeat(64)], lastReveals: ['c'.repeat(64), 'd'.repeat(64)], turns: [{ player: 1, rolls: [6, 6], end: 'bank' }], winner: 1, ending: 'won' };
  const { problem } = makeRecord(daisy, TABLES.daisy, fake, 1, ME);
  assert.match(problem, /^dice: /);
  assert.equal(daisy.COLLECTION, TABLES.daisy.collection);
});
