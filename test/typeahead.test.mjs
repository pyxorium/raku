import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeHandle, searchActors } from '../src/typeahead.js';

test('suggestions only for what looks like the start of a handle', () => {
  for (const t of ['th', 'thunderbird', '@thunder', 'thunderbird.ca', 'bsky.social']) assert.equal(looksLikeHandle(t), true, t);
  for (const t of ['', 't', 'at://did:plc:x/ing.dasl.masl/abc', 'tile://abc.did%3Aplc%3Ax/', 'https://lexicographer.space/@x/y',
    'did:plc:6vxjigxrqizmbo56gojxico3', 'raku:shelf', 'thunderbird.cafe/3abc', 'two words']) assert.equal(looksLikeHandle(t), false, t);
});

test('asks typeahead.waow.tech, keeps only real handles, never sends cookies', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return Response.json({ actors: [{ handle: 'thunderbird.cafe', avatar: 'https://cdn.bsky.app/x' }, { handle: 'handle.invalid' }, { nope: 1 }] }); };
  const found = await searchActors('@thunder', fetchImpl);
  assert.deepEqual(found.map((a) => a.handle), ['thunderbird.cafe']);
  assert.match(seen.url, /^https:\/\/typeahead\.waow\.tech\/xrpc\/tech\.waow\.typeahead\.searchActors\?q=thunder&limit=6$/);
  assert.equal(seen.opts.credentials, 'omit');
  assert.deepEqual(await searchActors('x', fetchImpl), [], 'too short');
  assert.deepEqual(await searchActors('thunder', async () => { throw new Error('down'); }), [], 'service down: no suggestions');
});
