// Rooms step 1's browser check (check_room.py): the rooms lab's own dev page and its real relay
// (C:\thunderbird-cafe\rooms-lab dev/serve.mjs and relay/server.js, the code Fly runs), with Raku's page
// (http://127.0.0.1:5180) let in as well, so a Raku page and the lab page share one room (the mixed room, RR3).
//
// The relay's sign-in check is rooms-lab's own (relay/signin.js: createPassChecker, then the handle both ways),
// with a stand-in for Bluesky's verifyJwt: the check's stand-in account server hands out unsigned passes
// (header.payload.standin), and this verifier still refuses any other audience or method, an expired pass, or a
// did:web account, as the real one does. (Bluesky's real verifyJwt is covered by rooms-lab's own check_signin.)
//
// Usage: node test/browser/room-servers.mjs <rooms-lab folder> [lab page port, 5190] [relay port, 8899]
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const LAB = process.argv[2];
const PAGE_PORT = Number(process.argv[3]) || 5190;
const RELAY_PORT = Number(process.argv[4]) || 8899;
if (!LAB) { console.error('Usage: node test/browser/room-servers.mjs <rooms-lab folder> [port] [relay port]'); process.exit(1); }
const { startDev } = await import(pathToFileURL(join(LAB, 'dev/serve.mjs')).href);
const { createPassChecker, createSignInCheck } = await import(pathToFileURL(join(LAB, 'relay/signin.js')).href);

// The accounts the check knows (as Raku's oauth-standin.js and the check's stand-in PLC directory).
const HANDLES = {
  'did:plc:6vxjigxrqizmbo56gojxico3': 'thunderbird.cafe',
  'did:plc:joer5rzmwgec3dkr4srfmq45': 'thunderbirdwine.bsky.social',
  'did:plc:ro563p5faldqu44apudq44k4': 'colorado.atprotocol.space',
  'did:plc:rrrrrrrrrrrrrrrrrrrrrrrr': 'robin.test',
};
const DIDS = Object.fromEntries(Object.entries(HANDLES).map(([d, h]) => [h, d]));
const checks = [];
const verifyJwt = async (token, audience, lxm, lookUp) => {
  const [head, body, sig] = String(token).split('.');
  if (!head || !body || sig !== 'standin') throw Object.assign(new Error('not a stand-in pass'), { error: 'BadJwt' });
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  await lookUp(p.iss, false);                                   // the did:plc-only rule, as the real one
  if (p.aud !== audience) throw Object.assign(new Error(`wrong audience ${p.aud}`), { error: 'BadJwtAudience' });
  if (p.lxm !== lxm) throw Object.assign(new Error(`wrong method ${p.lxm}`), { error: 'BadJwtLexiconMethod' });
  if (p.exp * 1000 < Date.now()) throw Object.assign(new Error('expired'), { error: 'JwtExpired' });
  checks.push({ iss: p.iss, aud: p.aud, lxm: p.lxm });
  return p;
};
const check = createSignInCheck({
  checkPass: createPassChecker({ verifyJwt, getSigningKey: async () => 'did:key:standin' }),
  handleOf: async (did) => HANDLES[did] || null,
  didOfHandle: async (h) => DIDS[h] || null,
});

const dev = await startDev({ port: PAGE_PORT, relayPort: RELAY_PORT, quiet: true, tileHost: null, signInLib: null, signIn: check,
  origins: ['http://127.0.0.1:5180'] });
console.log(`lab page ${dev.url}  relay ${dev.relayUrl}`);
process.on('SIGTERM', async () => { await dev.close(); process.exit(0); });
