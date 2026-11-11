// Raku's one permission set and its publish script (claude/raku-write-posts-plan.md, WP3 to WP7), against a stand-in
// account server. Adapted from tile-posts' test/publish-lexicons.test.mjs (Nov 8 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPublish, readLexicons, ACCOUNT, SCHEMA, PUBLISHED_FILE } from '../scripts/publish-lexicons.mjs';
import { TABLES, ROOMS, rakuSet } from '../src/config.js';
import { POST_COLLECTION } from '../src/tile-posts.js';
import { HEART_COLLECTION } from '../src/hearts.js';

const PDS = 'https://fibercap.us-west.host.bsky.network';
const ID = 'cafe.thunderbird.authRaku';

test('the set: "Raku", the wording agreed (WP6; hearts added HT15), only repo and rpc, no wildcards', () => {
  const [l, ...more] = readLexicons();
  assert.equal(more.length, 0);
  assert.equal(l.id, ID);
  const m = l.defs.main;
  assert.equal(m.type, 'permission-set');
  assert.equal(m.title, 'Raku');
  assert.equal(m.detail, 'Lets Raku save your match results, show you in rooms and game lounges, post tiles from your account, and heart tile posts. Nothing else in your account is changed.');
  assert.deepEqual(m.permissions.map((p) => p.resource).sort(), ['repo', 'rpc']);
  for (const p of m.permissions) {
    assert.equal(p.type, 'permission');
    for (const v of [...(p.collection || []), ...(p.lxm || [])]) {
      assert.ok(!v.includes('*'), `${v}: no wildcards in a set`);
      assert.ok(v.startsWith('cafe.thunderbird.'), `${v}: inside the set's own namespace`);
    }
  }
});

test("the set covers exactly what Raku writes and asks passes for (config.js), and nothing more", () => {
  const m = readLexicons()[0].defs.main;
  const repo = m.permissions.find((p) => p.resource === 'repo');
  const rpc = m.permissions.find((p) => p.resource === 'rpc');
  const lounges = Object.values(TABLES).filter((t) => t.lounge);
  assert.deepEqual([...repo.collection].sort(), [...Object.values(TABLES).map((t) => t.collection), ...lounges.map((t) => t.lounge.collection), POST_COLLECTION, HEART_COLLECTION].sort());
  assert.deepEqual([...rpc.lxm].sort(), [...lounges.map((t) => t.lounge.enter), ROOMS.join].sort());
  // and the same lists config.js reads a grant against
  assert.deepEqual([...repo.collection].sort(), [...rakuSet().repo].sort());
  assert.deepEqual([...rpc.lxm].sort(), [...rakuSet().rpc].sort());
  // WP4: one include for two relays, so any audience (the passes are still asked for each exact relay)
  assert.equal(rpc.aud, '*');
  assert.equal(rpc.inheritAud, undefined);
});

function server({ password = 'abcd-efgh-ijkl-mnop', sessionDid = ACCOUNT, mangle = false } = {}) {
  const repo = new Map();
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (u.host === 'plc.directory') return json({ id: ACCOUNT, alsoKnownAs: ['at://thunderbird.cafe'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    if (u.pathname.endsWith('createSession')) {
      const b = JSON.parse(init.body);
      if (b.password !== password) return json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401);
      return json({ did: sessionDid, accessJwt: 'jwt' });
    }
    if (u.pathname.endsWith('putRecord')) {
      const b = JSON.parse(init.body);
      repo.set(`${b.collection}/${b.rkey}`, mangle ? { ...b.record, defs: {} } : b.record);
      return json({ uri: `at://${b.repo}/${b.collection}/${b.rkey}`, cid: 'bafyreilexicon' });
    }
    if (u.pathname.endsWith('getRecord')) {
      const v = repo.get(`${u.searchParams.get('collection')}/${u.searchParams.get('rkey')}`);
      if (!v) return json({ error: 'RecordNotFound' }, 400);
      return json({ uri: 'x', cid: 'bafyreilexicon', value: Object.fromEntries(Object.entries(v).reverse()) });
    }
    return json({ error: 'NotFound' }, 404);
  };
  return { fetchImpl, calls, repo };
}
const quiet = () => {};

test('a dry run shows what would be published and writes nothing', async () => {
  const s = server();
  let wrote = false;
  const r = await runPublish({ fetchImpl: s.fetchImpl, log: quiet, dryRun: true, env: {}, readPublished: () => ({}), writePublished: () => { wrote = true; },
    ask: () => assert.fail('no questions in a dry run'), askHidden: () => assert.fail('no password in a dry run') });
  assert.deepEqual(r.due, [ID]);
  assert.equal(wrote, false);
  assert.ok(!s.calls.some((c) => c.method === 'POST'));
});

test('publishing: one record keyed by the NSID, read back, lexicons-published.json written, the TXT reminder', async () => {
  const s = server();
  let saved = null;
  const lines = [];
  const r = await runPublish({ fetchImpl: s.fetchImpl, log: (l) => lines.push(l), env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' }, readPublished: () => ({}),
    writePublished: (o) => { saved = o; }, ask: async () => 'y', askHidden: () => assert.fail('the password came from the environment'), now: () => '2026-11-08T12:00:00.000Z' });
  assert.equal(r.changed, true);
  const put = s.calls.find((c) => c.path.endsWith('putRecord'));
  assert.deepEqual([put.body.collection, put.body.rkey, put.body.repo, put.body.record.$type, put.auth], [SCHEMA, ID, ACCOUNT, SCHEMA, 'Bearer jwt']);
  const entry = saved.lexicons[ID];
  assert.equal(entry.uri, `at://${ACCOUNT}/${SCHEMA}/${ID}`);
  assert.equal(entry.text, JSON.stringify(readLexicons()[0]));
  assert.ok(lines.some((l) => l.includes('TXT record _lexicon ')), 'it reminds about the TXT record');

  const r2 = await runPublish({ fetchImpl: server().fetchImpl, log: quiet, env: {}, readPublished: () => saved, writePublished: () => assert.fail('nothing to write'),
    ask: () => assert.fail('nothing to ask'), askHidden: () => assert.fail('nothing to ask') });
  assert.equal(r2.changed, false);
  const old = { lexicons: { [ID]: { ...entry, text: '{"old":1}' } } };
  const r3 = await runPublish({ fetchImpl: server().fetchImpl, log: quiet, dryRun: true, env: {}, readPublished: () => old, ask: quiet, askHidden: quiet });
  assert.deepEqual(r3.due, [ID]);
});

test('the password asked for (hidden) when the environment has none; "no" stops before writing', async () => {
  const s = server();
  let asked = 0;
  const r = await runPublish({ fetchImpl: s.fetchImpl, log: quiet, env: {}, readPublished: () => ({}), writePublished: () => assert.fail('stopped'),
    askHidden: async () => { asked++; return 'abcd-efgh-ijkl-mnop'; }, ask: async () => 'n' });
  assert.equal(asked, 1);
  assert.equal(r.changed, false);
  assert.ok(!s.calls.some((c) => c.path.endsWith('putRecord')));
});

test("another account's app password, or a record that doesn't read back, stops it", async () => {
  await assert.rejects(runPublish({ fetchImpl: server({ sessionDid: 'did:plc:someoneelseaaaaaaaaaaaaa' }).fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' },
    readPublished: () => ({}), writePublished: () => {}, ask: async () => 'y', askHidden: quiet }), /different account/);
  await assert.rejects(runPublish({ fetchImpl: server({ mangle: true }).fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' },
    readPublished: () => ({}), writePublished: () => {}, ask: async () => 'y', askHidden: quiet }), /didn't read back/);
  await assert.rejects(runPublish({ fetchImpl: server().fetchImpl, log: quiet, env: { BSKY_APP_PASSWORD: 'wrong' },
    readPublished: () => ({}), writePublished: () => {}, ask: async () => 'y', askHidden: quiet }), /Invalid identifier or password/);
});

test("hearts (HT2): the set changed since today's lexicons-published.json, so it is published again", async () => {
  const today = JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8'));
  const r = await runPublish({ fetchImpl: server().fetchImpl, log: () => {}, dryRun: true, env: {}, readPublished: () => today, ask: () => {}, askHidden: () => {} });
  assert.deepEqual(r.due, [ID]);
  assert.ok(!today.lexicons[ID].text.includes('cafe.thunderbird.tile.like'), 'the published set has no hearts yet');
});
