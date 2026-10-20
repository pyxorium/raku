// Daisy in Raku: you at seat 1, the table's bot at seat 2 (stage 3); saving a finished match to your own
// account since stage 4 (saving.js: Raku's own prompt, from your house's result only).
//
// Adapted from the bot part of the site's src/daisy/table.js (step 7 there): four pinned tiles on one page
// (your house, your player tile, a copy watching the bot's seat, and a second copy of the house playing
// seat 2 as the bot), with no relay: the page passes the two houses' messages straight to each other.
// The routing rules are the game's own (daisy-router.js, a copy). No timers against the bot, as on the
// site. The match lives in memory only: reloading starts a new one.
import { createRouter, QUIET_KINDS } from './daisy-router.js';
import { createFrames } from './frames.js';
import { BOT, TABLE_TIMES } from '../config.js';
import { h } from '../cards.js';

const UP = 'tiles-protocol-up-data-payload';
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};
export const READER = Object.freeze({ handle: 'you', did: 'reader:you' });

export function mountDaisy(root, { table, mothership, log, setNote, setStatus, reader = READER, save }) {
  const seatBox = (role, label, who) => {
    const status = h('div', { class: 'seat-status' }, h('p', {}, 'Loading the tile…'), h('button', { type: 'button', class: 'seat-retry', hidden: true, onclick: () => frames.start(role) }, 'Try again'));
    const mount = h('div', { class: 'seat-mount' });
    const el = h('section', { class: `table-seat seat-${role}`, 'data-role': role, 'aria-label': label },
      h('div', { class: 'seat-line' }, h('b', {}, label), h('span', {}, who)),
      h('div', { class: 'seat-frame' }, mount, status));
    return { el, mount, status };
  };
  const mine = seatBox('mine', 'Seat 1', reader === READER ? 'You' : `You · @${reader.handle}`);
  const theirs = seatBox('theirs', 'Seat 2', `@${BOT.handle} · the bot`);
  const houseMount = h('div', { class: 'hidden-mount' });
  const botMount = h('div', { class: 'hidden-mount' });
  root.append(h('div', { class: 'table-seats daisy-seats' }, mine.el, theirs.el), houseMount, botMount);

  const me = { handle: reader.handle, did: reader.did, seat: 1 };
  const other = { did: BOT.did, handle: BOT.handle, seat: 2, here: true, bot: true };
  const hello = { mine: false, theirs: false };
  let houseSaid = false, houseReady = false, botSaid = false, botReady = false;
  let snapshot = null, botSnapshot = null, lastView = null, phase = null, result = null;

  const frames = createFrames({
    roles: ['house', 'mine', 'theirs', 'bot'],
    titles: { house: 'The house (referee)', mine: 'Your seat', theirs: "The bot's seat (watching)", bot: "The bot's house" },
    mothership,
    tileUrlFor: (role) => (role === 'house' || role === 'bot' ? table.house.uri : table.player.uri),
    mounts: { house: houseMount, mine: mine.mount, theirs: theirs.mount, bot: botMount },
    heights: { house: 200, mine: 560, theirs: 560, bot: 200 },
    times: TABLE_TIMES,
    onStatus,
    ping: (role, n) => router.fromPage(role, 'ping', { n }),
  });

  const router = createRouter({
    deliver(target, payload) {
      if (payload.kind === 'view' && target === 'mine') { lastView = payload; if (payload.view) onView(payload.view); }
      frames.send(target, payload);
    },
    // Against the bot, your house's messages for the other house go to the bot's house on this page. (The
    // shared view of your die has nobody to go to: the bot's own die isn't shown anywhere.)
    toRelay: (data) => (data && data.kind === 'die-view' ? null : router.toBot(data)),
    onPage,
    onLog: (e) => { if (!QUIET_KINDS.includes(e.kind)) log(e); },
  });

  const onMessage = (e) => {
    const d = e.data;
    if (!d || typeof d.action !== 'string' || !d.action.startsWith('tiles-protocol-up-')) return;
    const role = frames.roleOf(e.source);
    if (!role) return;
    frames.heard(role);
    if (d.action === UP) router.fromTile(role, d.payload);
  };
  addEventListener('message', onMessage);

  function onStatus(role, status, extra) {
    if (role === 'house' || role === 'bot') {
      const changed = /changed since/.test(extra?.error?.message || '');
      const text = { slow: 'Still opening the table…', stuck: 'Still opening the table…',
        failed: changed ? "This table's tiles have changed since Raku's list was set up, so Raku won't use them." : role === 'bot' ? "The bot couldn't start." : "The table couldn't open.",
        stopped: role === 'bot' ? 'The bot stopped answering.' : 'The table stopped answering.' }[status] || null;
      setNote(text, ['stuck', 'failed', 'stopped'].includes(status) ? () => frames.start(role) : null);
      if (role === 'house' && (status === 'loading' || status === 'stopped')) { houseSaid = false; houseReady = false; tellPlayersHouse('gone'); }
      if (role === 'bot' && (status === 'loading' || status === 'stopped')) { botSaid = false; botReady = false; }
      return;
    }
    const box = role === 'mine' ? mine.status : theirs.status;
    const text = STATUS_TEXT[status];
    box.hidden = !text;
    if (text) box.querySelector('p').textContent = text;
    box.querySelector('.seat-retry').hidden = !['stuck', 'failed', 'stopped'].includes(status);
    if (status === 'loading') hello[role] = false;
    if (status === 'ready' && extra.recovered) introduce(role);
  }
  const tellPlayersHouse = (state) => { for (const r of ['mine', 'theirs']) if (hello[r]) router.fromPage(r, 'presence', { who: 'house', state }); };

  function onPage(from, p) {
    if (from === 'bot') return onBot(p);
    switch (p.kind) {
      case 'hello':
        if (from === 'house') { houseSaid = true; setupHouse(); } else { hello[from] = true; introduce(from); }
        break;
      case 'state': snapshot = p.snapshot; break;
      case 'result':
        result = p.result;
        root.dataset.result = p.result.matchId;
        break;
      // Save in your seat: Raku's own prompt (saving.js), from your house's result.
      case 'save-request':
        if (from === 'mine') save({ result, seat: me.seat, tell: tellMine });
        break;
      case 'ignored':
        if (!['already had it'].includes(p.why)) log({ dir: 'drop', from: 'house', kind: p.about, why: p.why });
        break;
    }
  }

  const tellMine = (state, extra = {}) => { if (hello.mine) router.fromPage('mine', 'save-status', { state, ...extra }); };

  // The player tiles: yours, and the copy watching the bot's seat.
  function introduce(role) {
    if (!hello[role]) return;
    const done = role === 'mine' && result && save.savedFor?.(result.matchId);
    if (role === 'mine') router.fromPage('mine', 'seat', { seat: 1, handle: me.handle, watching: false });
    else router.fromPage('theirs', 'seat', { seat: 2, handle: other.handle, watching: true });
    if (lastView) frames.send(role, lastView);
    if (houseReady && houseSaid) router.fromPage(role, 'presence', { who: 'house', state: 'back' });
    if (role === 'mine') router.fromPage('mine', 'presence', { who: 'other', state: 'back' });
    if (done) tellMine('saved', { handle: done.handle });
  }

  function setupHouse() {
    if (!houseSaid || houseReady) return;
    houseReady = true;
    router.fromPage('house', 'setup', { seat: 1, timers: 'bot', snapshot: snapshot || undefined });
    router.fromPage('house', 'seated', { seat: 1, did: me.did, handle: me.handle });
    router.fromPage('house', 'seated', { seat: 2, did: other.did, handle: other.handle, bot: true });
    router.fromPage('house', 'reconnected');
    tellPlayersHouse('back');
  }
  const tick = setInterval(() => { if (houseReady) router.fromPage('house', 'tick'); }, TABLE_TIMES.tick);

  // The bot's house: a second copy of the house, playing seat 2 by itself.
  function onBot(p) {
    switch (p.kind) {
      case 'hello': botSaid = true; setupBot(); break;
      case 'state': botSnapshot = p.snapshot; break;
      case 'ignored': if (!['already had it'].includes(p.why)) log({ dir: 'drop', from: 'bot', kind: p.about, why: p.why }); break;
    }
  }
  function setupBot() {
    if (!botSaid || botReady) return;
    botReady = true;
    router.fromPage('bot', 'setup', { seat: 2, timers: 'bot', bot: true, snapshot: botSnapshot || undefined });
    router.fromPage('bot', 'seated', { seat: 1, did: me.did, handle: me.handle });
    router.fromPage('bot', 'seated', { seat: 2, did: BOT.did, handle: BOT.handle, bot: true });
    router.fromPage('bot', 'reconnected');           // ask your house for anything it sent before the bot was ready
  }

  function onView(v) {
    phase = v.phase;
    setStatus(phase === 'over' ? `Match over · playing @${BOT.handle}, the table's bot` : `Playing @${BOT.handle}, the table's bot`);
  }
  setStatus(`Playing @${BOT.handle}, the table's bot`);

  frames.start('house'); frames.start('mine'); frames.start('theirs'); frames.start('bot');

  return {
    frames, router, hello,
    get phase() { return phase; }, get result() { return result; },
    dispose() { frames.stop(); clearInterval(tick); removeEventListener('message', onMessage); },
  };
}
