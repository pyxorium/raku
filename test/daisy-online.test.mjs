// Stage 5: Daisy across two computers (the addresses, the relay settings, what this browser keeps, the join
// message the relay hears). The browser side is checked by test/browser/check_daisy.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, SITE, pageCsp, tableRelays, daisyRelayUrl, daisyTimers, isTableId, newTableId, DAISY_KEEP } from '../src/config.js';
import { parseTarget, tableUri } from '../src/address.js';
import { createDaisyKeep } from '../src/tables/daisy-keep.js';
import { seatHandleOk } from '../src/tables/daisy-sit.js';

// daisy-online.js and daisy-start.js draw with the DOM; only their plain parts are imported here.
const { joinMessage, shareLink } = await import('../src/tables/daisy-online.js');

const here = (search = '') => ({ hostname: '127.0.0.1', search, href: `http://127.0.0.1:5180/${search}#t=x`, origin: 'http://127.0.0.1:5180' });
const live = (search = '') => ({ hostname: SITE.host, search, href: `${SITE.origin}/${search}`, origin: SITE.origin });

test("Daisy's addresses: the start screen, the bot, one table across two computers", () => {
  assert.deepEqual(parseTarget('raku:table/daisy'), { ok: true, kind: 'table', id: 'daisy', sub: null, uri: 'raku:table/daisy' });
  assert.deepEqual(parseTarget('raku:table/daisy/bot'), { ok: true, kind: 'table', id: 'daisy', sub: 'bot', uri: 'raku:table/daisy/bot' });
  assert.deepEqual(parseTarget('raku:table/daisy/7kq3abcdmn'), { ok: true, kind: 'table', id: 'daisy', sub: '7kq3abcdmn', uri: 'raku:table/daisy/7kq3abcdmn' });
  assert.equal(parseTarget('raku:table/daisy/short').ok, false, 'a table id is 8 to 32 letters and digits');
  assert.equal(parseTarget('raku:table/daisy/x/y').ok, false);
  assert.equal(tableUri('daisy', 'abcdefgh'), 'raku:table/daisy/abcdefgh');
  assert.equal(tableUri('daisy'), 'raku:table/daisy');
});

test("a Daisy page link opens the same table in Raku (Q44); a bot match's link opens the start screen", () => {
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/daisy/?table=7kq3abcdmn').uri, 'raku:table/daisy/7kq3abcdmn');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/daisy/?table=7kq3abcdmn&timers=short').uri, 'raku:table/daisy/7kq3abcdmn');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/daisy/?table=7kq3abcdmn&bot=1').uri, 'raku:table/daisy');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/daisy/').uri, 'raku:table/daisy');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/daisy/?table=<script>').uri, 'raku:table/daisy');
  assert.equal(parseTarget('http://thunderbird.cafe/webtiles/daisy/?table=7kq3abcdmn').ok, false, 'https only');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/sevenup/?table=7kq3abcdmn').ok, false);
});

test("a Raku link pasted into the address box opens the tab it had in front", () => {
  assert.equal(parseTarget(`${SITE.origin}/#t=raku:table/daisy/7kq3abcdmn&a=0`).uri, 'raku:table/daisy/7kq3abcdmn');
  assert.equal(parseTarget(`${SITE.origin}/#t=,raku%3Atable%2Fdaisy%2F7kq3abcdmn&a=1`).uri, 'raku:table/daisy/7kq3abcdmn');
  assert.equal(parseTarget(`${SITE.origin}/#t=at%3A%2F%2Fdid%3Aplc%3A6vxjigxrqizmbo56gojxico3%2Fing.dasl.masl%2F3mw763im3qw2t&a=0`).kind, 'tile');
  assert.equal(parseTarget(`${SITE.origin}/#t=${encodeURIComponent(`${SITE.origin}/#t=raku:shelf`)}&a=0`).ok, false, 'not a Raku link inside a Raku link');
  assert.equal(parseTarget(`${SITE.origin}/`).ok, false);
});

test("the link a player sends is Raku's own address with the table's tab (Q45); on this computer the testing switches go along", () => {
  assert.equal(shareLink('7kq3abcdmn', live()), `${SITE.origin}/#t=raku:table/daisy/7kq3abcdmn&a=0`);
  assert.equal(shareLink('7kq3abcdmn', live('?timers=short&relay=ws://127.0.0.1:8787/')), `${SITE.origin}/#t=raku:table/daisy/7kq3abcdmn&a=0`, 'no switches on the live page');
  assert.equal(shareLink('7kq3abcdmn', here('?timers=short&other=1')), 'http://127.0.0.1:5180/?timers=short#t=raku:table/daisy/7kq3abcdmn&a=0');
  const back = new URL(shareLink('7kq3abcdmn', live()));
  const p = new URLSearchParams(back.hash.slice(1));
  assert.equal(parseTarget(p.get('t')).uri, 'raku:table/daisy/7kq3abcdmn', 'the link reopens the table');
});

test("the relay: Daisy's own (the same as the Daisy page's); the stand-in or ?relay= on this computer only; the page policy names it", () => {
  assert.equal(TABLES.daisy.relay, 'wss://relay.daisy.thunderbird.cafe/');
  assert.equal(daisyRelayUrl(live()), TABLES.daisy.relay);
  assert.equal(daisyRelayUrl(live('?relay=wss://evil.example/')), TABLES.daisy.relay);
  assert.equal(daisyRelayUrl(here()), 'ws://127.0.0.1:8787/');
  assert.equal(daisyRelayUrl(here('?relay=wss://relay.daisy.thunderbird.cafe/')), 'wss://relay.daisy.thunderbird.cafe/');
  assert.equal(daisyRelayUrl(here('?relay=javascript:alert(1)')), 'ws://127.0.0.1:8787/');
  assert.deepEqual(tableRelays(), ['wss://relay.daisy.thunderbird.cafe']);
  // since rooms step 1 the rooms relay too, also by name
  assert.match(pageCsp(), /connect-src 'self' https: wss:\/\/relay\.daisy\.thunderbird\.cafe wss:\/\/relay\.rooms\.thunderbird\.cafe;/);
  assert.doesNotMatch(pageCsp(), /wss: |wss:;|ws:\/\/127/, 'only those relays, by name');
});

test('the timers: the real ones, or ?timers=short on this computer only', () => {
  assert.equal(daisyTimers(live('?timers=short')), 'real');
  assert.equal(daisyTimers(here('?timers=short')), 'short');
  assert.equal(daisyTimers(here()), 'real');
});

test('table ids: as the Daisy page makes them (the relay takes 8 to 32 of a-z and 0-9)', () => {
  for (let i = 0; i < 50; i++) { const t = newTableId(); assert.ok(isTableId(t), t); assert.equal(t.length, 10); }
  assert.equal(isTableId('ABCDEFGH'), false);
});

function fakeStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test("what this browser keeps: your seat and your house's state, a day, under Raku's own names", () => {
  const local = fakeStorage(), session = fakeStorage();
  const k = createDaisyKeep({ local, session });
  const me = { did: 'did:plc:aaaa', handle: 'a.test', seat: 1 };
  const other = { did: 'did:plc:bbbb', handle: 'b.test', seat: 2, here: true };
  k.keep('tableone1', { me, other, snapshot: { shared: { phase: 'playing' } } }, 1000);
  assert.ok(local._m.has(`${DAISY_KEEP.tablePrefix}tableone1:did:plc:aaaa`));
  assert.ok(![...local._m.keys()].some((x) => x.startsWith('daisy-table:')), "never the Daisy page's names");
  assert.equal(k.tabAccount('tableone1'), 'did:plc:aaaa');
  assert.equal(k.kept('tableone1', 2000).length, 1);
  assert.deepEqual(k.inProgress('did:plc:aaaa', 2000), [{ table: 'tableone1', with: 'b.test', savedAt: 1000 }]);
  k.keep('tabletwo2', { me, other, snapshot: { shared: { phase: 'over' } } }, 1500);
  k.keep('tablethree', { me, other: null, snapshot: null }, 1600);
  assert.deepEqual(k.inProgress('did:plc:aaaa', 2000).map((x) => x.table), ['tableone1'], 'finished matches and tables with nobody else are left out');
  assert.deepEqual(k.inProgress('did:plc:bbbb', 2000), []);
  const day = DAISY_KEEP.keepFor;
  assert.equal(k.kept('tableone1', 1000 + day + 1).length, 0, 'a day later it is gone');
  k.forgetOld(1600 + day + 1);
  assert.equal([...local._m.keys()].filter((x) => x.startsWith(DAISY_KEEP.tablePrefix)).length, 0);
  // Storage that throws (a private window): nothing breaks, nothing is kept.
  const broken = { get length() { throw new Error('no'); }, key() { throw new Error('no'); }, getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const kb = createDaisyKeep({ local: broken, session: broken });
  kb.keep('tableone1', { me, other, snapshot: null });
  assert.deepEqual(kb.kept('tableone1'), []);
  assert.equal(kb.tabAccount('tableone1'), null);
  assert.deepEqual(kb.inProgress('did:plc:aaaa'), []);
});

test("the join message is the Daisy page's: the table, the seat (or 'any'), the account, the pinned house, fresh", () => {
  const house = TABLES.daisy.house.cid;
  const me = { did: 'did:plc:aaaa', handle: 'a.test', seat: null, ask: 1 };
  assert.deepEqual(joinMessage({ tableId: 'tableone1', me, house, kept: false, joinedHere: false }),
    { type: 'join', table: 'tableone1', seat: 1, did: 'did:plc:aaaa', handle: 'a.test', house, fresh: true });
  assert.equal(joinMessage({ tableId: 't', me: { ...me, ask: 'any' }, house, kept: false, joinedHere: false }).seat, 'any');
  assert.deepEqual(joinMessage({ tableId: 't', me: { ...me, seat: 2 }, house, kept: true, joinedHere: false }).seat, 2);
  assert.equal(joinMessage({ tableId: 't', me, house, kept: true, joinedHere: false }).fresh, false, 'a kept seat is never fresh');
  assert.equal(joinMessage({ tableId: 't', me, house, kept: false, joinedHere: true }).fresh, false, 'nor a reconnect');
  assert.match(house, /^bafyrei[a-z2-7]{52}$/, 'the house version is the pinned record CID, as the Daisy page sends');
});

test("a seat's handle must be one the relay takes (and the other player can read)", () => {
  assert.ok(seatHandleOk('thunderbird.cafe'));
  assert.ok(seatHandleOk('thunderbirdwine.bsky.social'));
  assert.ok(!seatHandleOk('did:plc:6vxjigxrqizmbo56gojxico3'));
  assert.ok(!seatHandleOk('Upper.Case'));
  assert.ok(!seatHandleOk(''));
});
