// Sprite games (claude/raku-sprite-games-plan.md, SG1 to SG8): the plain rules in src/sprite-games.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSpriteGameMessage, statusMessage, spriteMessage, pngSize, spriteSizes, catalogEntry, isCatalog,
  createCompendium, ownSprite, createCharacters, createCharacterSwitch, createAnswerBudget, answerHello, answerRequest,
} from '../src/sprite-games.js';
import { UP, DOWN } from '../src/renderers.js';
import { SPRITE_GAMES, SIGNIN_PROMISE } from '../src/config.js';
import { rawCid } from '../src/tables/pinned.js';

const COMP = SPRITE_GAMES.compendium.did;
const RPG = 'https://rpg.actor';
const PLAYER = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const PLAYER_PDS = 'https://pds.fakepds.net';

/** A PNG's first bytes with the given size (enough for pngSize; not a picture a browser would draw). */
function png(width, height, salt = 0) {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  const put = (i, n) => { b[i] = (n >>> 24) & 255; b[i + 1] = (n >>> 16) & 255; b[i + 2] = (n >>> 8) & 255; b[i + 3] = n & 255; };
  put(16, width); put(20, height);
  b[39] = salt;
  return b;
}
const blob = (cid, size = 10) => ({ $type: 'blob', ref: { $link: cid }, mimeType: 'application/octet-stream', size });

/** A stand-in rpg.actor and a player's server, counting what's asked. */
async function world({ inCatalog = true, playerRecord = true } = {}) {
  const sheet = png(144, 192, 1);
  const own = png(144, 192, 2);
  const sheetCid = await rawCid(sheet);
  const ownCid = await rawCid(own);
  const catalog = {
    schema: 'rpg.actor.sprite-compendium/4',
    records: inCatalog ? [{ did: PLAYER, handle: 'player.test', stale: false,
      sprite: { cid: sheetCid, geometry: { columns: 3, rows: 4, frameWidth: 48, frameHeight: 48, width: 144, height: 192 },
        asset: { cid: sheetCid, path: 'sprites/abc.png', bytes: sheet.length } } }] : [],
  };
  const state = { rev: 'rev1', catalogBytes: new TextEncoder().encode(JSON.stringify(catalog)), sheet, own, sheetCid, ownCid, asked: [] };
  state.catalogCid = await rawCid(state.catalogBytes);
  const record = () => ({ uri: `at://${COMP}/ing.dasl.masl/${SPRITE_GAMES.compendium.rkey}`, cid: `bafyrec${state.rev}`,
    value: { tile: { name: 'rpg.actor Compendium', resources: { '/catalog.json': { src: blob(state.catalogCid) }, '/sprites/abc.png': { src: blob(sheetCid) } } } } });
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  state.fetchImpl = async (url) => {
    const u = new URL(url);
    state.asked.push(`${u.host}${u.pathname}`);
    const q = u.searchParams;
    if (u.origin === RPG && u.pathname.endsWith('getLatestCommit')) return json({ cid: 'bafycommit', rev: state.rev });
    if (u.origin === RPG && u.pathname.endsWith('repo.getRecord')) return json(record());
    if (u.origin === RPG && u.pathname.endsWith('getBlob')) {
      if (q.get('cid') === state.catalogCid) return new Response(state.catalogBytes);
      if (q.get('cid') === sheetCid) return new Response(sheet);
      return new Response('nope', { status: 404 });
    }
    if (u.origin === PLAYER_PDS && u.pathname.endsWith('repo.getRecord')) {
      if (!playerRecord) return json({ error: 'RecordNotFound' }, 400);
      return json({ uri: `at://${PLAYER}/actor.rpg.sprite/self`, cid: 'bafyown',
        value: { spriteSheet: blob(ownCid), width: 144, height: 192, frameWidth: 48, frameHeight: 48, columns: 3, rows: 4 } });
    }
    if (u.origin === PLAYER_PDS && u.pathname.endsWith('getBlob')) return new Response(own);
    return new Response('nope', { status: 404 });
  };
  state.resolver = { async account(did) { return { did, pds: did === COMP ? RPG : PLAYER_PDS }; } };
  return state;
}

test('a game’s messages: the hello (v 1) and the button; anything else is not one (SG7)', () => {
  assert.deepEqual(readSpriteGameMessage({ action: UP, payload: { kind: 'hello', v: 1 } }), { kind: 'hello' });
  assert.deepEqual(readSpriteGameMessage({ action: UP, payload: { kind: 'sprite-request' } }), { kind: 'request' });
  assert.equal(readSpriteGameMessage({ action: UP, payload: { kind: 'hello', v: 2 } }), null);
  assert.equal(readSpriteGameMessage({ action: UP, payload: { kind: 'hello' } }), null);
  assert.equal(readSpriteGameMessage({ action: DOWN, payload: { kind: 'hello', v: 1 } }), null);
  assert.equal(readSpriteGameMessage({ action: UP, payload: { get: 'at://x' } }), null);
  assert.equal(readSpriteGameMessage({ action: UP, payload: null }), null);
  assert.equal(readSpriteGameMessage(null), null);
});

test('what Raku sends: the statuses Cosmic Junkyard knows, and the character with its handle (SG8)', () => {
  assert.deepEqual(statusMessage('ready'), { action: DOWN, payload: { kind: 'sprite-status', state: 'ready' } });
  for (const s of ['loading', 'no-sprite', 'error', 'cancelled']) assert.equal(statusMessage(s).payload.state, s);
  assert.throws(() => statusMessage('searching'));          // its text asks for a search box Raku doesn't have
  const m = spriteMessage({ image: 'data:image/png;base64,AA', frameWidth: 48, frameHeight: 48, sheetWidth: 144, sheetHeight: 192, handle: 'player.test' });
  assert.deepEqual(m, { action: DOWN, payload: { kind: 'sprite', v: 1, image: 'data:image/png;base64,AA', frameWidth: 48, frameHeight: 48, sheetWidth: 144, sheetHeight: 192, handle: 'player.test' } });
  assert.equal('handle' in spriteMessage({ image: 'x', frameWidth: 1, frameHeight: 1, sheetWidth: 1, sheetHeight: 1 }).payload, false);
});

test('a PNG’s size from its header; anything else is not a PNG', () => {
  assert.deepEqual(pngSize(png(144, 192)), { width: 144, height: 192 });
  assert.equal(pngSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(pngSize(new Uint8Array(10)), null);
  assert.equal(pngSize(null), null);
});

test('the sizes a game gets: the listed layout, the picture’s own size, and nothing that doesn’t fit', () => {
  const p = { width: 144, height: 192 };
  assert.deepEqual(spriteSizes({ columns: 3, rows: 4, frameWidth: 48, frameHeight: 48 }, p), { frameWidth: 48, frameHeight: 48, sheetWidth: 144, sheetHeight: 192 });
  assert.deepEqual(spriteSizes(null, p), { frameWidth: 48, frameHeight: 48, sheetWidth: 144, sheetHeight: 192 });   // 3 x 4 when none is named
  // extra pixels per frame (rpg.actor's help): the listed frame, the picture's sheet
  assert.deepEqual(spriteSizes({ columns: 3, rows: 4, frameWidth: 46, frameHeight: 46 }, p), { frameWidth: 46, frameHeight: 46, sheetWidth: 144, sheetHeight: 192 });
  assert.equal(spriteSizes({ columns: 3, rows: 4, frameWidth: 64, frameHeight: 48 }, p), null);     // frames wider than the sheet
  assert.equal(spriteSizes({ columns: 0, rows: 4 }, p), null);
  assert.equal(spriteSizes(null, { width: 145, height: 192 }), null);                                // doesn't split into 3 columns
  assert.equal(spriteSizes(null, { width: 5000, height: 192 }), null);
});

test('an account in the catalog: its picture’s path and layout; not there, or no picture: none', () => {
  const cat = { schema: 'rpg.actor.sprite-compendium/4', records: [
    { did: PLAYER, stale: true, sprite: { geometry: { columns: 3, rows: 4 }, asset: { cid: 'bafkreia', path: 'sprites/a.png' } } },
    { did: OTHER, sprite: { asset: null } },
  ] };
  assert.equal(isCatalog(cat), true);
  assert.equal(isCatalog({ schema: 'something/1', records: [] }), false);
  assert.deepEqual(catalogEntry(cat, PLAYER), { cid: 'bafkreia', path: '/sprites/a.png', layout: { columns: 3, rows: 4 }, stale: true });
  assert.equal(catalogEntry(cat, OTHER), null);
  assert.equal(catalogEntry(cat, 'did:plc:cccccccccccccccccccccccc'), null);
  assert.equal(catalogEntry(null, PLAYER), null);
});

test('the Compendium is read once, then again only when rpg.actor’s account has changed, and its catalog only when it has changed (SG6)', async () => {
  const w = await world();
  let t = 0;
  const comp = createCompendium({ resolver: w.resolver, fetchImpl: w.fetchImpl, now: () => t });
  const a = await comp.catalog();
  assert.equal(a.catalog.records.length, 1);
  assert.deepEqual(w.asked, ['rpg.actor/xrpc/com.atproto.sync.getLatestCommit', 'rpg.actor/xrpc/com.atproto.repo.getRecord', 'rpg.actor/xrpc/com.atproto.sync.getBlob']);
  // within checkGapMs: nothing asked at all
  w.asked.length = 0; t += 1000;
  await comp.catalog();
  assert.deepEqual(w.asked, []);
  // later, nothing changed: only the tiny check
  t += SPRITE_GAMES.checkGapMs;
  await comp.catalog();
  assert.deepEqual(w.asked, ['rpg.actor/xrpc/com.atproto.sync.getLatestCommit']);
  // the account changed but not the catalog (another record): the record, not the catalog
  w.asked.length = 0; t += SPRITE_GAMES.checkGapMs; w.rev = 'rev2';
  await comp.catalog();
  assert.deepEqual(w.asked, ['rpg.actor/xrpc/com.atproto.sync.getLatestCommit', 'rpg.actor/xrpc/com.atproto.repo.getRecord']);
  // a new build: the catalog again
  w.asked.length = 0; t += SPRITE_GAMES.checkGapMs; w.rev = 'rev3';
  w.catalogBytes = new TextEncoder().encode(JSON.stringify({ schema: 'rpg.actor.sprite-compendium/4', records: [] }));
  w.catalogCid = await rawCid(w.catalogBytes);
  const b = await comp.catalog();
  assert.equal(b.catalog.records.length, 0);
  assert.equal(w.asked.length, 3);
});

test('two games saying hello at once share one read of the Compendium', async () => {
  const w = await world();
  const comp = createCompendium({ resolver: w.resolver, fetchImpl: w.fetchImpl });
  await Promise.all([comp.catalog(), comp.catalog(), comp.catalog()]);
  assert.equal(w.asked.filter((x) => x.endsWith('getBlob')).length, 1);
});

test('a catalog that doesn’t match its record, or isn’t rpg.actor’s kind, is refused', async () => {
  const w = await world();
  const real = w.fetchImpl;
  w.fetchImpl = async (url) => (url.includes(w.catalogCid) ? new Response(new TextEncoder().encode('{"schema":"x"}')) : real(url));
  await assert.rejects(createCompendium({ resolver: w.resolver, fetchImpl: w.fetchImpl }).catalog(), /didn't match/);
  const w2 = await world();
  w2.catalogBytes = new TextEncoder().encode(JSON.stringify({ schema: 'other/1', records: [] }));
  w2.catalogCid = await rawCid(w2.catalogBytes);
  await assert.rejects(createCompendium({ resolver: w2.resolver, fetchImpl: w2.fetchImpl }).catalog(), /isn't one Raku can read/);
});

test('the character comes from the Compendium first (SG1), checked against its CID', async () => {
  const w = await world();
  const chars = createCharacters({ resolver: w.resolver, fetchImpl: w.fetchImpl });
  const c = await chars.forAccount(PLAYER);
  assert.equal(c.from, 'compendium');
  assert.deepEqual(c.sizes, { frameWidth: 48, frameHeight: 48, sheetWidth: 144, sheetHeight: 192 });
  assert.deepEqual([...c.bytes], [...w.sheet]);
  assert.equal(w.asked.some((x) => x.startsWith('pds.fakepds.net')), false);
});

test('not in the Compendium: the account’s own actor.rpg.sprite record (SG1); no record either: none', async () => {
  const w = await world({ inCatalog: false });
  const c = await createCharacters({ resolver: w.resolver, fetchImpl: w.fetchImpl }).forAccount(PLAYER);
  assert.equal(c.from, 'record');
  assert.deepEqual([...c.bytes], [...w.own]);
  const w2 = await world({ inCatalog: false, playerRecord: false });
  assert.equal(await createCharacters({ resolver: w2.resolver, fetchImpl: w2.fetchImpl }).forAccount(PLAYER), null);
  assert.equal(await ownSprite({ resolver: w2.resolver, did: PLAYER, fetchImpl: w2.fetchImpl }), null);
});

test('the Compendium out of reach: the account’s own record instead', async () => {
  const w = await world();
  const real = w.fetchImpl;
  const fetchImpl = async (url) => (url.startsWith(RPG) ? new Response('down', { status: 503 }) : real(url));
  const c = await createCharacters({ resolver: w.resolver, fetchImpl }).forAccount(PLAYER);
  assert.equal(c.from, 'record');
});

test('a picture that doesn’t match its record is refused', async () => {
  const w = await world({ inCatalog: false });
  const real = w.fetchImpl;
  const fetchImpl = async (url) => (url.includes('getBlob') && url.startsWith(PLAYER_PDS) ? new Response(png(144, 192, 9)) : real(url));
  await assert.rejects(createCharacters({ resolver: w.resolver, fetchImpl }).forAccount(PLAYER), /didn't match/);
});

test('"Show my character in games": on unless turned off, per account, kept in the browser (SG4)', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const sw = createCharacterSwitch({ storage });
  const heard = [];
  sw.onChange((did, on) => heard.push([did, on]));
  assert.equal(sw.isOn(PLAYER), true);
  sw.set(PLAYER, false);
  assert.equal(sw.isOn(PLAYER), false);
  assert.equal(sw.isOn(OTHER), true);
  assert.equal(createCharacterSwitch({ storage }).isOn(PLAYER), false);    // kept
  sw.set(PLAYER, true);
  assert.equal(sw.isOn(PLAYER), true);
  assert.deepEqual(heard, [[PLAYER, false], [PLAYER, true]]);
  assert.equal(sw.isOn(null), false);
  const broken = createCharacterSwitch({ storage: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } } });
  assert.equal(broken.isOn(PLAYER), true);
  broken.set(PLAYER, false);                                                // no throw
});

test('a few characters per tile load (SG7)', () => {
  const b = createAnswerBudget({ max: 2 });
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
});

test('what a hello and the button lead to (SG2 to SG4)', () => {
  const a = { did: PLAYER, handle: 'player.test' };
  assert.equal(answerHello(a, true), 'feed');
  assert.equal(answerHello(a, false), 'ready');
  assert.equal(answerHello(null, true), 'ready');
  assert.equal(answerRequest(null, true), 'signin');
  assert.equal(answerRequest(a, false), 'switch');
  assert.equal(answerRequest(a, true), 'accounts');
});

test('the sign-in promise says only what Raku does, the character included (SG5)', () => {
  assert.equal(SIGNIN_PROMISE, 'Signing in lets Raku save your match results and game runs, show you in rooms and game lounges, bring your rpg.actor character into games, post tiles from your accounts, and heart tile posts.');
});
