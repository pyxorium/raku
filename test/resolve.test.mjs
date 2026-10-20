import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from '../src/resolve.js';

const DID = 'did:plc:6vxjigxrqizmbo56gojxico3';
function fake(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'plc.directory') return Response.json({ id: DID, alsoKnownAs: ['at://thunderbird.cafe'], service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' }] });
    if (u.pathname.endsWith('listRecords')) {
      const i = Number(u.searchParams.get('cursor') || 0);
      return Response.json({ records: pages[i], cursor: pages[i + 1] ? String(i + 1) : undefined });
    }
    return new Response('?', { status: 404 });
  };
  return { fetchImpl, calls };
}
const rec = (rkey) => ({ uri: `at://${DID}/ing.dasl.masl/${rkey}`, cid: 'bafy', value: { tile: { name: rkey } } });

test("an account's tiles, a page at a time, from its own server", async () => {
  const full = Array.from({ length: 100 }, (_, i) => rec(`a${i}`));
  const { fetchImpl, calls } = fake([full, [rec('b0'), rec('b1')]]);
  const r = createResolver({ fetchImpl });
  const one = await r.listTiles(DID);
  assert.equal(one.records.length, 100);
  assert.equal(one.records[0].rkey, 'a0');
  assert.ok(one.cursor);
  const two = await r.listTiles(DID, one.cursor);
  assert.deepEqual(two.records.map((x) => x.rkey), ['b0', 'b1']);
  assert.equal(two.cursor, null);
  assert.ok(calls.some((c) => c.startsWith('https://pds.example.com/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc')));
  assert.deepEqual(await r.countTiles(DID), { count: 102, more: false });
  assert.deepEqual(await createResolver({ fetchImpl }).countTiles(DID, 50), { count: 50, more: true });
});
