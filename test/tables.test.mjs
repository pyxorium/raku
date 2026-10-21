import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, tableForTile, BOT } from '../src/config.js';
import { parseTarget, tableUri } from '../src/address.js';
import { createPinnedLoader, rawCid, TileChanged } from '../src/tables/pinned.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';

test('the approved tables: Seven-Up and Daisy, each a house and a player tile, pinned by record CID', () => {
  assert.deepEqual(Object.keys(TABLES), ['sevenup', 'daisy']);
  for (const t of Object.values(TABLES)) {
    for (const role of ['house', 'player']) {
      assert.match(t[role].uri, /^at:\/\/did:plc:[a-z2-7]{24}\/ing\.dasl\.masl\/[a-z0-9]{13}$/);
      assert.match(t[role].cid, /^bafyrei[a-z2-7]{52}$/);
    }
    assert.match(t.page, /^https:\/\/thunderbird\.cafe\/webtiles\/[a-z]+\/$/);
  }
  assert.equal(BOT.handle, 'dicesprite.thunderbird.cafe');
});

test("a table's own tiles are recognised, and tables have addresses", () => {
  assert.equal(tableForTile(DID, '3my6uchoghd2m').id, 'daisy');
  assert.equal(tableForTile(DID, '3my27cwible2m').id, 'sevenup');
  assert.equal(tableForTile(DID, 'something-else'), null);
  assert.deepEqual(parseTarget('raku:table/daisy'), { ok: true, kind: 'table', id: 'daisy', sub: null, uri: tableUri('daisy') });
  assert.equal(parseTarget('raku:table/Not Valid').ok, false);
});

function fakeNet({ recordCid, files }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('getRecord')) {
      const resources = Object.fromEntries(Object.entries(files).map(([p, f]) => [p, { src: { $type: 'blob', ref: { $link: f.cid }, size: f.bytes.length }, 'content-type': 'text/html' }]));
      return Response.json({ uri: 'x', cid: recordCid, value: { tile: { name: 'Daisy', resources } } });
    }
    if (u.pathname.endsWith('getBlob')) {
      const f = Object.values(files).find((x) => x.cid === u.searchParams.get('cid'));
      return f ? new Response(f.served || f.bytes) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  };
  return { fetchImpl, calls };
}
const resolver = { account: async () => ({ pds: 'https://pds.example.com' }) };
class FakeTile { constructor(ship, url, manifest, loader) { Object.assign(this, { url, manifest, loader }); } }

test('the pinned loader: only pinned tiles, only the pinned record, only the pinned bytes', async () => {
  const page = new TextEncoder().encode('<p>daisy</p>');
  const other = new TextEncoder().encode('console.log(1)');
  const pin = TABLES.daisy.player;
  const files = { '/': { bytes: page, cid: await rawCid(page) }, '/x.js': { bytes: other, cid: await rawCid(other), served: new TextEncoder().encode('tampered') } };
  const { fetchImpl, calls } = fakeNet({ recordCid: pin.cid, files });
  const loader = createPinnedLoader({ Tile: FakeTile, pins: [pin], resolver, fetchImpl });
  assert.equal(await loader.load('at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/ing.dasl.masl/x', {}), false, 'not on the list');
  assert.equal(calls.length, 0);
  const tile = await loader.load(pin.uri, {});
  assert.equal(tile.manifest.name, 'Daisy');
  const ok = await tile.loader.resolvePath('/');
  assert.equal(ok.ok, true);
  assert.equal(new TextDecoder().decode(ok.body), '<p>daisy</p>');
  assert.equal((await tile.loader.resolvePath('/x.js')).ok, false, 'bytes that are not the pinned ones are refused');
  assert.equal((await tile.loader.resolvePath('/missing')).ok, false);
  const changed = createPinnedLoader({ Tile: FakeTile, pins: [pin], resolver, fetchImpl: fakeNet({ recordCid: 'bafyreichanged', files }).fetchImpl });
  await assert.rejects(changed.load(pin.uri, {}), TileChanged, 'a republished (changed) record is refused');
  assert.match(await rawCid(page), /^bafkrei[a-z2-7]{52}$/);
});
