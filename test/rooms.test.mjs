// Rooms in Raku, step 1 (claude/raku-rooms-plan.md, RR1 to RR10): Raku's names for rooms agree with rooms-lab's
// (the package Raku pins), the addresses (raku:room; the code never in Raku's address), invites, the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ROOMS, roomsRelayUrl, coversRooms, isRoomHouse, pageCsp, pageRelays, fullScope } from '../src/config.js';
import { parseTarget, ROOM_URI, roomInHash } from '../src/address.js';
import { createTabs } from '../src/tabs.js';
import { canShowHandle, namesList, leaveQuestion, readInvite, roomLink } from '../src/room-words.js';
import { TALKS_TO } from '../src/about-page.js';
import * as LAB from 'rooms-lab/config.js';

const require = createRequire(import.meta.url);
const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CODE = 'abcdefghjkmn', KEY = 'K'.repeat(40);

test('rooms-lab is a package pinned to a GitHub tag (RR1), and Raku names what rooms-lab uses', () => {
  const pkg = JSON.parse(file('package.json'));
  assert.match(pkg.dependencies['rooms-lab'], /^github:pyxorium\/rooms-lab#v\d+\.\d+\.\d+$/, 'a tag, never a branch');
  const lab = require('rooms-lab/package.json');
  assert.equal(`v${lab.version}`, pkg.dependencies['rooms-lab'].split('#')[1], 'the installed copy is the pinned tag (npm install after changing it)');
  // Raku's own names for the room's servers are rooms-lab's
  assert.equal(ROOMS.relay, LAB.RELAY_URL);
  assert.equal(ROOMS.audience, LAB.RELAY_AUDIENCE);
  assert.equal(ROOMS.join, LAB.JOIN_LXM);
  assert.equal(`atproto ${ROOMS.scope}`, LAB.SCOPE, 'the same "Rooms" permission set, for the same relay');
  const stun = LAB.ICE_SERVERS.flatMap((s) => s.urls).map((u) => u.replace(/^stun:/, '').replace(/:\d+$/, ''));
  assert.deepEqual([...ROOMS.stun].sort(), [...stun].sort(), 'the connection helpers the About page names');
  // the house is pinned as rooms-lab published it
  const pub = require('rooms-lab/published.json');
  assert.deepEqual({ ...ROOMS.house }, { uri: pub.house.uri, cid: pub.house.cid });
  assert.equal(ROOMS.labPage, `https://thunderbird.cafe${LAB.PAGE_PATH}`);
});

test('the rooms relay: the live one; ?roomsRelay= on this computer only; the page policy names it; the sign-in asks for Rooms', () => {
  const live = (q = '') => ({ hostname: 'raku.lexicographer.space', search: q });
  const here = (q = '') => ({ hostname: '127.0.0.1', search: q });
  assert.equal(roomsRelayUrl(live()), ROOMS.relay);
  assert.equal(roomsRelayUrl(live('?roomsRelay=wss://evil.example/')), ROOMS.relay);
  assert.equal(roomsRelayUrl(here()), ROOMS.relay, 'Raku on this computer uses the real relay (it allows 127.0.0.1:5180 and :5181)');
  assert.equal(roomsRelayUrl(here('?roomsRelay=ws://127.0.0.1:8899/')), 'ws://127.0.0.1:8899/');
  assert.equal(roomsRelayUrl(here('?roomsRelay=javascript:alert(1)')), ROOMS.relay);
  assert.ok(pageRelays().includes('wss://relay.rooms.thunderbird.cafe'));
  assert.match(pageCsp(), /connect-src [^;]*wss:\/\/relay\.rooms\.thunderbird\.cafe[;\s]/);
  assert.ok(fullScope().split(' ').includes(ROOMS.scope));
  // the server expands the set into the pass for this relay
  assert.ok(coversRooms(`atproto ${ROOMS.scope}`));
  assert.ok(coversRooms('atproto rpc:cafe.thunderbird.rooms.join?aud=did:web:relay.rooms.thunderbird.cafe%23rooms_relay'));
  assert.ok(!coversRooms('atproto rpc:cafe.thunderbird.rooms.joined?aud=x'));
  assert.ok(!coversRooms('atproto include:cafe.thunderbird.daisy.authPlay'));
  assert.ok(!coversRooms(''));
});

test('addresses: a room tab is raku:room; an invite opens it, and the code never goes into a tab (RR2)', () => {
  assert.deepEqual(parseTarget('raku:room'), { ok: true, kind: 'room', uri: ROOM_URI });
  assert.deepEqual(parseTarget(`https://raku.lexicographer.space/#r=${CODE}`), { ok: true, kind: 'room-invite', room: CODE, hostKey: null, uri: ROOM_URI });
  assert.deepEqual(parseTarget(`https://raku.lexicographer.space/#r=${CODE}&k=${KEY}`), { ok: true, kind: 'room-invite', room: CODE, hostKey: KEY, uri: ROOM_URI });
  assert.deepEqual(parseTarget(`https://thunderbird.cafe/webtiles/rooms-lab/#r=${CODE}`), { ok: true, kind: 'room-invite', room: CODE, hostKey: null, uri: ROOM_URI }, 'the lab page’s invites too (RR3)');
  assert.equal(parseTarget('https://thunderbird.cafe/webtiles/rooms-lab/').kind, 'room');
  assert.equal(parseTarget(`http://127.0.0.1:5180/?roomsRelay=ws%3A%2F%2F127.0.0.1%3A8899%2F#r=${CODE}`).room, CODE, 'an invite on this computer');
  assert.equal(parseTarget(`http://evil.example/#r=${CODE}`).kind === 'room-invite', false);
  assert.equal(parseTarget(`https://raku.lexicographer.space/#r=short`).kind === 'room-invite', false, 'not a code the relay takes');
  assert.equal(roomInHash(`#r=${CODE}&k=bad`).hostKey, null);
  // a tab list never holds a room code, even from a link that had one
  const tabs = createTabs();
  tabs.fromHash(`#t=${encodeURIComponent('raku:room')},${encodeURIComponent(`https://raku.lexicographer.space/#r=${CODE}&k=${KEY}`)}&a=0`);
  assert.deepEqual(tabs.list.map((t) => t.history[0]), [ROOM_URI, ROOM_URI]);
  assert.ok(!tabs.toHash().includes(CODE) && !tabs.toHash().includes(KEY));
});

test('invites: Raku makes its own (the host link adds the key); pasted links and bare codes are read; others aren’t', () => {
  assert.equal(roomLink(new URL('https://raku.lexicographer.space/#t=raku%3Aroom&a=0'), CODE), `https://raku.lexicographer.space/#r=${CODE}`);
  assert.equal(roomLink(new URL('https://raku.lexicographer.space/'), CODE, KEY), `https://raku.lexicographer.space/#r=${CODE}&k=${KEY}`);
  assert.equal(roomLink(new URL('https://raku.lexicographer.space/?roomsRelay=ws://x/'), CODE), `https://raku.lexicographer.space/#r=${CODE}`, 'the test switch stays on this computer');
  assert.equal(roomLink(new URL('http://127.0.0.1:5180/?roomsRelay=ws%3A%2F%2F127.0.0.1%3A8899%2F&x=1#t='), CODE), `http://127.0.0.1:5180/?roomsRelay=ws%3A%2F%2F127.0.0.1%3A8899%2F#r=${CODE}`);
  assert.deepEqual(readInvite(`https://raku.lexicographer.space/#r=${CODE}`), { room: CODE, hostKey: null });
  assert.deepEqual(readInvite(`  https://thunderbird.cafe/webtiles/rooms-lab/#r=${CODE}&k=${KEY} `), { room: CODE, hostKey: KEY });
  assert.deepEqual(readInvite(CODE), { room: CODE, hostKey: null });
  assert.deepEqual(readInvite(`http://127.0.0.1:5190/#r=${CODE}`), { room: CODE, hostKey: null }, 'the lab’s dev page');
  assert.equal(readInvite(`https://evil.example/#r=${CODE}`), null);
  assert.equal(readInvite(`http://raku.lexicographer.space/#r=${CODE}`), null);
  assert.equal(readInvite('not an invite'), null);
});

test('the words: RR6’s question, and who can show a checked handle (did:plc only)', () => {
  assert.equal(leaveQuestion([{ name: 'You', me: true }, { name: 'Nick' }, { name: '@robin.test' }]), "You're in a room with Nick and @robin.test. Leave it and join this one?");
  assert.equal(leaveQuestion([{ name: 'You', me: true }]), "You're in a room on your own. Leave it and join this one?");
  assert.equal(namesList(['A', 'B', 'C']), 'A, B and C');
  assert.ok(canShowHandle('did:plc:6vxjigxrqizmbo56gojxico3'));
  assert.ok(!canShowHandle('did:web:example.com'));
  assert.ok(isRoomHouse('did:plc:6vxjigxrqizmbo56gojxico3', '3mymwzw63gp2g'), 'the shelf keeps Rooms as the house tile');
});

test('the first screen’s words (FS1, RR5, owner’s) and the Rooms card', () => {
  const app = file('src/app.js');
  assert.ok(app.includes("'A browser for web tiles. Paste a tile\\'s address or someone\\'s handle above, or start with one of these.'"), 'FS1');
  assert.ok(app.includes("h('h2', {}, 'Tables and rooms'), h('p', { class: 'small-lede' }, 'Groups of tiles that play together, and rooms for meeting up.')"), 'RR5');
  assert.ok(!app.includes('small pages people publish to their own atproto accounts. Paste'));
  assert.equal(`${ROOMS.name}: ${ROOMS.blurb}`, 'Rooms: Voice, one shared screen, and tiles opened for everyone. For small meetups among friends.');
});

test('the About page names rooms (RR9)', () => {
  const page = file('src/about-page.js');
  assert.ok(page.includes('Browsing, searching, joining a room with a typed name, and playing the tables against the bot need no sign-in. Signing in is only for saving your match results, showing your handle in a room, and (if you choose) being seen in Daisy\'s lounge.'));
  assert.ok(page.includes("h('b', {}, 'A room you’re in'), ', for that tab only, so a reload brings you back in (for the host, also the host key).'"));
  assert.ok(page.includes("h('b', {}, 'The name you typed'), ' for rooms, for next time.'"));
  assert.ok(page.includes('Raku asks for your microphone only when you unmute in a room, and for your screen only when you choose to share it.'));
  const who = new Map(TALKS_TO);
  assert.equal(who.get('The rooms relay (relay.rooms.thunderbird.cafe)'), 'Only while you’re in a room. It introduces the people in the room to each other and passes the room’s messages; it stores nothing.');
  assert.equal(who.get('The people in your room'), 'Voice, a shared screen and live tiles go straight between your computers, encrypted.');
  assert.match(who.get('Google’s and Cloudflare’s connection helpers'), /^Only while you’re in a room, to help computers find a way to reach each other .*On networks that block direct connections, Cloudflare passes the encrypted call along without being able to read it\.$/);
});

test('the room tab keeps the room out of Raku’s address and in this tab only (RR2, RR10)', () => {
  const tab = file('src/room-tab.js');
  assert.match(tab, /links: \{ invite: \(code\) => roomLink\(loc, code\)/, 'Raku builds the invite links');
  assert.match(tab, /joinScreen: \(/, 'Raku draws the join screen');
  assert.match(tab, /chrome: false/);
  assert.ok(!/history|replaceState|location\.hash/.test(tab), 'the room tab never touches the page’s address');
  assert.match(tab, /keep\(null\)/, 'leaving forgets the room');
  assert.equal(ROOMS.keepKey, 'raku-room');
  assert.match(tab, /get\(session, ROOMS\.keepKey\)/, 'tab storage (sessionStorage), not localStorage');
  assert.ok(!/localStorage/.test(tab));
});
