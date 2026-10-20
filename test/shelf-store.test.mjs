import test from 'node:test';
import assert from 'node:assert/strict';
import { createShelf, STORAGE_KEY, SHELF_LIMITS, exportFileName } from '../src/shelf-store.js';

const A = 'did:plc:6vxjigxrqizmbo56gojxico3';
const C = 'did:plc:joer5rzmwgec3dkr4srfmq45';
const memory = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const clock = () => { let t = Date.parse('2026-10-20T10:00:00Z'); return () => (t += 1000); };

test('keeps tiles and accounts, newest first, and remembers them in the browser', () => {
  const storage = memory();
  const now = clock();
  const s = createShelf({ storage, now });
  s.keepTile({ did: A, rkey: 'one', name: 'Live, 2026', by: 'thunderbird.cafe' });
  s.keepTile({ did: C, rkey: 'two', name: 'Lantern' });
  s.keepAccount({ did: C, handle: 'thunderbirdwine.bsky.social' });
  assert.deepEqual(s.tiles().map((t) => t.rkey), ['two', 'one']);
  assert.equal(s.hasTile(A, 'one'), true);
  assert.equal(s.hasAccount(C), true);
  assert.equal(s.saved, true);
  const again = createShelf({ storage, now });
  assert.deepEqual(again.tiles().map((t) => t.name), ['Lantern', 'Live, 2026']);
  assert.deepEqual(again.accounts().map((a) => a.handle), ['thunderbirdwine.bsky.social']);
  again.removeTile(A, 'one');
  again.removeAccount(C);
  assert.equal(createShelf({ storage, now }).tiles().length, 1);
  assert.equal(createShelf({ storage, now }).accounts().length, 0);
});

test('broken or blocked storage never breaks the shelf; it says it is not saving', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const s = createShelf({ storage: throwing });
  assert.equal(s.keepTile({ did: A, rkey: 'one', name: 'x' }), true);
  assert.equal(s.hasTile(A, 'one'), true);
  assert.equal(s.saved, false);
  const none = createShelf({ storage: null });
  none.keepAccount({ did: A });
  assert.equal(none.saved, false);
  const garbage = memory();
  garbage.setItem(STORAGE_KEY, '{not json');
  assert.equal(createShelf({ storage: garbage }).tiles().length, 0);
});

test('bad entries are dropped: wrong DIDs, record keys, handles; long names are cut', () => {
  const s = createShelf({ storage: memory() });
  assert.equal(s.keepTile({ did: 'did:key:z6Mk', rkey: 'one' }), false);
  assert.equal(s.keepTile({ did: A, rkey: '..' }), false);
  assert.equal(s.keepAccount({ did: 'nope' }), false);
  s.keepTile({ did: A, rkey: 'one', name: 'x'.repeat(500), by: 'not a handle!' });
  assert.equal(s.tiles()[0].name.length, SHELF_LIMITS.text);
  assert.equal(s.tiles()[0].by, '');
});

test('Export and Import: a small file; Import only adds, skips what is broken or already there', () => {
  const now = clock();
  const s = createShelf({ storage: memory(), now });
  s.keepTile({ did: A, rkey: 'one', name: 'Live, 2026', by: 'thunderbird.cafe' });
  s.keepAccount({ did: C, handle: 'thunderbirdwine.bsky.social' });
  const file = s.exportData();
  assert.equal(file.format, 'raku-shelf');
  assert.equal(file.tiles[0].uri, `at://${A}/ing.dasl.masl/one`);
  const t = createShelf({ storage: memory(), now });
  t.keepTile({ did: A, rkey: 'mine', name: 'Mine' });
  const r = t.importData(JSON.parse(JSON.stringify({ ...file, tiles: [...file.tiles, { did: 'bad', rkey: 'x' }] })));
  assert.deepEqual(r, { tiles: 1, accounts: 1, skipped: 1 });
  assert.deepEqual(t.tiles().map((x) => x.rkey).sort(), ['mine', 'one']);
  assert.deepEqual(t.importData(file), { tiles: 0, accounts: 0, skipped: 0 }, 'safe to import twice');
  assert.equal(t.importData({ tiles: [] }), null, 'not a shelf file');
  assert.equal(exportFileName(new Date('2026-10-20T12:00:00Z')), 'raku-shelf-2026-10-20.json');
});

test('the limits: a file cannot flood the browser', () => {
  const s = createShelf({ storage: memory() });
  const tiles = Array.from({ length: SHELF_LIMITS.tiles + 50 }, (_, i) => ({ did: A, rkey: `t${i}` }));
  const r = s.importData({ format: 'raku-shelf', version: 1, tiles, accounts: [] });
  assert.equal(r.tiles, SHELF_LIMITS.tiles);
  assert.equal(r.skipped, 50);
  assert.equal(s.keepTile({ did: A, rkey: 'one-more' }), false);
});

test('changes are announced, with where they came from', () => {
  const s = createShelf({ storage: memory() });
  const seen = [];
  s.onChange((c) => seen.push(c.source));
  s.keepTile({ did: A, rkey: 'one' });
  s.removeTile(A, 'one', 'card');
  s.reload();
  assert.deepEqual(seen, ['star', 'card', 'elsewhere']);
});
