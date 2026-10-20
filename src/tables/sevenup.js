// Seven-Up in Raku: you at seat 1, the table's bot at seat 2, no sign-in and no saving (stage 3).
//
// Adapted from the site's src/sevenup/embed.js (the table in the Seven-Up blog post), which does the same
// on the blog: the same three pinned tiles (the house and a player tile per seat), the same sender stamps
// and allowed kinds (sevenup-relay.js, a copy of the game's own), the same seating, resume and bot sprite.
// Here Raku's shared mothership and pinned loader load the tiles, the house's whole-table view opens as a
// layer over the tab, and the messages go to Raku's message panel for the tab.
import { createRelay, QUIET_KINDS } from './sevenup-relay.js';
import { createFrames } from './frames.js';
import { fetchSprite } from './sprite.js';
import { BOT, TABLE_TIMES } from '../config.js';
import { h } from '../cards.js';
import { icon } from '../icons.js';

const UP = 'tiles-protocol-up-data-payload';
// The reader's seat. The player tile puts an @ before any name, so this shows as "@you". Not an account:
// nothing is saved, and the house only needs some text for each seat.
export const READER = Object.freeze({ handle: 'you', did: 'reader:you' });
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};

export function mountSevenUp(root, { table, mothership, resolver, fetchImpl, log, setNote, saveNote }) {
  const seatBox = (n) => {
    const status = h('div', { class: 'seat-status' }, h('p', {}, 'Loading the tile…'), h('button', { type: 'button', class: 'seat-retry', hidden: true, onclick: () => frames.start(`seat${n}`) }, 'Try again'));
    const mount = h('div', { class: 'seat-mount' });
    const el = h('section', { class: 'table-seat', 'data-seat': String(n), 'aria-label': `Seat ${n}` },
      h('div', { class: 'seat-line' }, h('b', {}, `Seat ${n}`), h('span', {}, n === 1 ? 'You' : `@${BOT.handle} · the bot`)),
      h('div', { class: 'seat-frame' }, mount, status));
    return { el, mount, status };
  };
  const s1 = seatBox(1), s2 = seatBox(2);
  const houseMount = h('div', { class: 'house-mount' });
  const house = h('div', { class: 'table-house', hidden: true, onclick: (e) => { if (e.target === house) showHouse(false); } },
    h('div', { class: 'table-house-box', role: 'dialog', 'aria-label': 'The whole table' },
      h('button', { type: 'button', class: 'table-house-close', 'aria-label': 'Close the whole table', onclick: () => showHouse(false) }, icon('close', 18)),
      houseMount));
  root.append(h('div', { class: 'table-seats' }, s1.el, s2.el), house);

  const seats = { 1: { ...READER }, 2: { handle: BOT.handle, did: BOT.did, bot: true } };
  const hello = { house: false, seat1: false, seat2: false };
  let seated = false;
  let snapshot = null;
  let botSprite = null;

  const frames = createFrames({
    roles: ['house', 'seat1', 'seat2'],
    titles: { house: 'The table (house)', seat1: 'Seat 1 (you)', seat2: 'Seat 2 (the bot)' },
    mothership,
    tileUrlFor: (role) => (role === 'house' ? table.house.uri : table.player.uri),
    mounts: { house: houseMount, seat1: s1.mount, seat2: s2.mount },
    heights: { house: 500, seat1: 620, seat2: 620 },
    times: TABLE_TIMES,
    onStatus,
    ping: (role, n) => relay.fromPage(role, 'ping', { n }),
  });

  const relay = createRelay({
    deliver: (target, payload) => frames.send(target, payload),
    onPage,
    onLog: (e) => { if (!QUIET_KINDS.includes(e.kind)) log(e); },
  });

  const onMessage = (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    const role = frames.roleOf(e.source);
    if (!role) return;                          // not one of this table's tiles
    frames.heard(role);
    if (d.action === UP) relay.fromTile(role, d.payload);
  };
  addEventListener('message', onMessage);

  function onStatus(role, status, extra) {
    if (role === 'house') {
      const text = { loading: null, slow: 'Still opening the table…', stuck: 'Still opening the table…',
        failed: extra?.error?.name === 'TileChanged' || /changed since/.test(extra?.error?.message || '') ? "This table's tiles have changed since Raku's list was set up, so Raku won't use them." : "The table couldn't open.",
        stopped: 'The table stopped answering.' }[status];
      setNote(text, ['stuck', 'failed', 'stopped'].includes(status) ? () => frames.start('house') : null);
      if (status === 'loading') hello.house = false;
      if (seated && (status === 'stopped' || status === 'loading')) for (const n of [1, 2]) if (hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'presence', { who: 'house', state: 'gone' });
      return;
    }
    const n = Number(role.slice(4));
    const box = n === 1 ? s1.status : s2.status;
    const text = STATUS_TEXT[status];
    box.hidden = !text;
    if (text) box.querySelector('p').textContent = text;
    box.querySelector('.seat-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'stopped' || status === 'loading') {
      hello[role] = false;
      if (seated && hello.house) relay.fromPage('house', 'presence', { seat: n, state: 'gone' });
    }
    if (status === 'ready' && extra.recovered) tileBack(n);
  }

  const seatPayload = (n) => ({ seat: n, handle: seats[n].handle, ...(seats[n].bot ? { bot: true } : {}) });
  const seatedPayload = (n) => ({ seat: n, handle: seats[n].handle, did: seats[n].did, ...(seats[n].bot ? { bot: true } : {}) });

  function onPage(from, p) {
    const n = from === 'house' ? 0 : Number(from.slice(4));
    switch (p.kind) {
      case 'hello':
        hello[from] = true;
        if (from === 'house') houseHello(); else tileBack(n);
        sitWhenReady();
        break;
      case 'sprite-request': sendSprite(n); break;
      case 'show-table': showHouse(true); break;
      case 'state': snapshot = p.snapshot; break;
      // The match is over, or Save was pressed: say straight away that it isn't saved here.
      case 'result':
        root.dataset.result = p.result.matchId;
        if (hello.seat1) relay.fromPage('seat1', 'save-status', { state: 'preview', note: saveNote });
        break;
      case 'save-request':
        relay.fromPage(`seat${n}`, 'save-status', { state: 'preview', note: saveNote });
        setNote(saveNote);
        break;
    }
  }

  // Both seats are taken as soon as all three tiles have said hello.
  function sitWhenReady() {
    if (seated || !hello.house || !hello.seat1 || !hello.seat2) return;
    seated = true;
    for (const n of [1, 2]) {
      relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
      relay.fromPage('house', 'seated', seatedPayload(n));
    }
  }

  // A restarted house gets the match back (from the latest snapshot, kept in memory only).
  function houseHello() {
    if (!seated) return;
    for (const n of [1, 2]) if (hello[`seat${n}`]) relay.fromPage(`seat${n}`, 'presence', { who: 'house', state: 'back' });
    if (snapshot && snapshot.phase !== 'seating') relay.fromPage('house', 'resume', { snapshot });
    else for (const n of [1, 2]) relay.fromPage('house', 'seated', seatedPayload(n));
  }

  // A restarted or recovered player tile: tell it its seat, and have the house resend the table.
  function tileBack(n) {
    if (!seated) return;
    relay.fromPage(`seat${n}`, 'seat', seatPayload(n));
    if (!hello.house) return;
    if (snapshot && snapshot.waitingFor === n - 1) relay.fromPage('house', 'presence', { seat: n, state: 'back' });
    else relay.fromPage('house', 'sync', {});
  }

  // The bot's rpg.actor sprite (public). The reader has none.
  async function sendSprite(n) {
    if (!seats[n].bot) return relay.fromPage(`seat${n}`, 'sprite-status', { state: 'no-sprite' });
    botSprite ||= fetchSprite(BOT.did, { resolver, fetchImpl }).catch(() => null);
    const sprite = await botSprite;
    if (!sprite) return relay.fromPage(`seat${n}`, 'sprite-status', { state: 'no-sprite' });
    relay.fromPage(`seat${n}`, 'sprite', {
      handle: BOT.handle, image: sprite.blob,
      frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight, sheetWidth: sprite.sheetWidth, sheetHeight: sprite.sheetHeight,
    });
  }

  // The house's whole-table view (tap the corner picture in either seat).
  function showHouse(show) {
    house.hidden = !show;
    if (show) house.querySelector('.table-house-close').focus();
  }
  const onKey = (e) => { if (e.key === 'Escape' && !house.hidden) showHouse(false); };
  addEventListener('keydown', onKey);

  frames.start('house');
  frames.start('seat1');
  frames.start('seat2');

  return {
    frames, relay, hello, snapshot: () => snapshot,
    dispose() { frames.stop(); removeEventListener('message', onMessage); removeEventListener('keydown', onKey); },
  };
}
