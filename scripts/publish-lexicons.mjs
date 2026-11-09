// Publishes Raku's permission set (lexicons\cafe.thunderbird.authRaku.json: "Raku", the one permission a Raku sign-in
// asks for; claude/raku-write-posts-plan.md, WP3 to WP7) from thunderbird.cafe. Copied from tile-posts'
// scripts/publish-lexicons.mjs (Nov 8 2026). Run from C:\thunderbird-cafe\raku (Node 22, no packages needed):
//
//   node scripts/publish-lexicons.mjs              publish each lexicon that is new or changed
//   node scripts/publish-lexicons.mjs --dry-run    show what would be published; ask nothing, write nothing
//
// Each lexicon is written as a com.atproto.lexicon.schema record in thunderbird.cafe's repo, its record key the NSID,
// only when it is new or its text has changed since the last publish (lexicons-published.json keeps what was
// published: commit it). It shows what it will publish, takes the app password from $env:BSKY_APP_PASSWORD (or asks
// for it, hidden as you type), asks once more before writing, then reads each record back to check it.
// The set's name is thunderbird.cafe's own (cafe.thunderbird.authRaku): the Wix TXT record _lexicon at the domain's
// top (value did=did:plc:6vxjigxrqizmbo56gojxico3) tells the network so.
import readline from 'node:readline';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const ACCOUNT = 'did:plc:6vxjigxrqizmbo56gojxico3';     // thunderbird.cafe: the names' home
export const PUBLISHED_FILE = join(ROOT, 'lexicons-published.json');
export const SCHEMA = 'com.atproto.lexicon.schema';
export const TXT = '_lexicon';
// Only Raku's own permission sets, named directly under cafe.thunderbird (so they may cover cafe.thunderbird.*).
const NAME = /^cafe\.thunderbird\.auth[A-Za-z]+$/;

/** The lexicons in lexicons\, checked: each a lexicon 1 permission set named cafe.thunderbird.auth…, its file named by its id. */
export function readLexicons(dir = join(ROOT, 'lexicons')) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (l.lexicon !== 1 || typeof l.id !== 'string' || `${l.id}.json` !== f) throw new Error(`lexicons\\${f}: not a lexicon named by its file.`);
    if (!NAME.test(l.id)) throw new Error(`lexicons\\${f}: ${l.id} isn't a Raku permission set (cafe.thunderbird.auth…).`);
    if (!l.defs || !l.defs.main || l.defs.main.type !== 'permission-set') throw new Error(`lexicons\\${f}: no permission-set main definition.`);
    return l;
  });
}

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status; err.error = body && body.error;
    throw err;
  }
  return body;
}

// The same object, whatever the order of its keys (a server may hand a record back with its keys reordered).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export async function runPublish({ fetchImpl = fetch, ask, askHidden, log = console.log, dryRun = false, env = process.env,
  lexicons = readLexicons(),
  readPublished = () => (existsSync(PUBLISHED_FILE) ? JSON.parse(readFileSync(PUBLISHED_FILE, 'utf8')) : {}),
  writePublished = (o) => writeFileSync(PUBLISHED_FILE, JSON.stringify(o, null, 2) + '\n'),
  now = () => new Date().toISOString() } = {}) {
  const doc = await getJson(fetchImpl, `https://plc.directory/${ACCOUNT}`);
  const svc = (doc.service || []).find((s) => s.type === 'AtprotoPersonalDataServer' || String(s.id).endsWith('#atproto_pds'));
  if (!svc) throw new Error("Could not find thunderbird.cafe's server.");
  const pds = String(svc.serviceEndpoint).replace(/\/+$/, '');
  const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith('at://'));
  const handle = aka ? aka.slice(5) : ACCOUNT;

  const published = readPublished() || {};
  const had = published.lexicons || {};
  const due = lexicons.filter((l) => !had[l.id] || had[l.id].text !== JSON.stringify(l));

  log(`\nAccount: @${handle} (${ACCOUNT}), server ${pds}`);
  if (!due.length) { log('\nThe lexicons are already published as they are (see lexicons-published.json). Nothing to do.'); return { changed: false, due: [] }; }
  log('\nThis will publish:');
  for (const l of due) log(`  - the permission set ${l.id} ("${l.defs.main.title}"), as ${SCHEMA}/${l.id}${had[l.id] ? ' (changed)' : ' (new)'}`);
  log('It is public. Nothing else in the account is touched.');
  if (dryRun) { log('\nDry run: nothing was written.'); return { changed: false, due: due.map((l) => l.id) }; }

  let password = (env.BSKY_APP_PASSWORD || '').trim();
  if (password) log(`\nUsing the app password in $env:BSKY_APP_PASSWORD (${password.length} characters).`);
  else password = await askHidden(`\nApp password for @${handle} (hidden): `);
  if (!password) throw new Error('No app password given; nothing was published.');
  const session = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: ACCOUNT, password }),
  });
  if (session.did !== ACCOUNT) throw new Error('That app password belongs to a different account; nothing was published.');
  const ok = (await ask('Publish now? [y/N] ')).trim().toLowerCase();
  if (ok !== 'y' && ok !== 'yes') { log('Stopped; nothing was published.'); return { changed: false, due: due.map((l) => l.id) }; }

  const out = { ...published, account: { handle, did: ACCOUNT }, lexicons: { ...had } };
  for (const l of due) {
    log(`\nPublishing ${l.id}…`);
    const record = { $type: SCHEMA, ...l };
    const put = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.putRecord`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({ repo: ACCOUNT, collection: SCHEMA, rkey: l.id, record }),
    });
    const back = await getJson(fetchImpl, `${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(ACCOUNT)}&collection=${SCHEMA}&rkey=${encodeURIComponent(l.id)}`);
    if (!back || !same(back.value, record)) throw new Error(`${l.id} didn't read back as written.`);
    out.lexicons[l.id] = { uri: put.uri, cid: put.cid, text: JSON.stringify(l), publishedAt: now() };
    writePublished(out);
    log(`  done: ${put.uri}`);
    log(`  look: https://pdsls.dev/${put.uri}`);
  }
  log('\nPublished, and read back to check.');
  log(`The Wix TXT record ${TXT} (at thunderbird.cafe's top; value did=${ACCOUNT}) must be in place: add it if you haven't.`);
  log('Commit lexicons-published.json. Delete this app password once you are done with it (Bluesky: Settings > Privacy and security > App passwords).');
  return { changed: true, published: out };
}

function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) write(muted ? '\n' : s); };
  const ask = (q) => new Promise((r) => rl.question(q, r));
  const askHidden = (q) => new Promise((r) => { process.stdout.write(q); muted = true; rl.question('', (a) => { muted = false; r(a.trim()); }); });
  return { ask, askHidden, close: () => rl.close() };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const io = makeAsk();
  runPublish({ ask: io.ask, askHidden: io.askHidden, dryRun: args.includes('--dry-run') })
    .catch((err) => { console.error(`\n${err.message}`); process.exitCode = 1; })
    .finally(() => io.close());
}
