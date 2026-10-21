// Daisy across two computers in Raku (stage 5, claude/raku-plan.md section 15): one seat at a table, the
// other player on another computer, in Raku or on the Daisy page (Q44: one shared pool of tables).
//
// Adapted from the two-computer part of the site's src/daisy/table.js (steps 2 to 7 there; COPY of its
// relay, seat and status logic, Oct 21 2026). Three pinned tiles in this tab: your hidden house, your
// player tile and a copy watching the other seat. The houses talk through Daisy's own relay (the same one,
// with the same join message, as the Daisy page), and both houses must be the same pinned version or the
// table doesn't start. Your seat and your house's state (with its secret seed) are kept in this browser
// for a day (daisy-keep.js), so a reload, a closed tab or "Back to the start" can come back to the match.
//
// A seat belongs to an account (Q46): you sit as a signed-in account with "Play Daisy" (daisy-sit.js), and
// that account is the one the other player sees and the one a saved record names.
import { createRouter } from './daisy-router.js';
import { createFrames } from './frames.js';
import { connectRelay } from './relay-connection.js';
import { createDaisyKeep } from './daisy-keep.js';
import { sitAs } from './daisy-sit.js';
import { TABLE_TIMES, DAISY_AWAY_MS, DAISY_LOCAL_RELAY, daisyRelayUrl, daisyTimers, SITE, isLocal } from '../config.js';
import { tableUri } from '../address.js';
import { h } from '../cards.js';

const UP = 'tiles-protocol-up-data-payload';
const STATUS_TEXT = {
  loading: 'Loading the tile…', slow: 'Still loading…', stuck: 'Still loading…',
  failed: "This tile couldn't be loaded.", stopped: 'This tile stopped answering.',
};
const MISMATCH_TEXT = "The other page has a different version of Daisy, so the table can't start. Reload to get the latest (the other player may need to as well).";
const at = (hd) => (hd ? `@${hd}` : 'the other player');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// How long "Joining the table…" waits before saying what's likely wrong.
export const JOIN_HINT_MS = 5000;

// "Open a table" on the start screen hands the new table's first seat over here (by table id), so the
// table opens straight to seat 1 without asking again.
export const intents = new Map();

/** The link a player sends: Raku's own address with this table's tab (Q45). On this computer the testing
 *  switches (?loader=, ?relay=, ?timers=) go along, so both windows use the same ones. */
export function shareLink(tableId, loc = globalThis.location) {
  const hash = `#t=${tableUri('daisy', tableId)}&a=0`;
  if (!loc || !isLocal(loc)) return `${SITE.origin}/${hash}`;
  const u = new URL(loc.href);
  const keepOnly = new URLSearchParams();
  for (const k of ['loader', 'relay', 'timers']) { const v = u.searchParams.get(k); if (v) keepOnly.set(k, v); }
  const q = keepOnly.toString();
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}${hash}`;
}

/** What a page says to the relay to sit at a table: the Daisy page's own join message (relay tables.js), so
 *  Raku and the Daisy page share tables. fresh: this browser has none of the seat's kept state (and hasn't sat
 *  down this load), so it mustn't take over a seat in play (the relay answers "held"). */
export function joinMessage({ tableId, me, house, kept, joinedHere }) {
  return { type: 'join', table: tableId, seat: me.seat || me.ask || 'any', did: me.did, handle: me.handle, house, fresh: !kept && !joinedHere };
}

export function mountDaisyOnline(root, ctx) {
  const { table, tableId, mothership, log, setNote, setStatus, save, auth, go, say = () => {}, keepForReturn = () => {},
    loc = globalThis.location, WebSocketImpl = globalThis.WebSocket, keepStore = createDaisyKeep() } = ctx;
  const relayAt = daisyRelayUrl(loc);
  const timers = daisyTimers(loc);
  const myHouse = table.house.cid;                // the house version check: the pinned record CID, as the Daisy page sends
  keepStore.forgetOld();

  // ---------- what this tab shows ----------
  const seatBox = (role, label) => {
    const status = h('div', { class: 'seat-status' }, h('p', {}, 'Loading the tile…'), h('button', { type: 'button', class: 'seat-retry', hidden: true, onclick: () => frames.start(role) }, 'Try again'));
    const mount = h('div', { class: 'seat-mount' });
    const who = h('span', {});
    const el = h('section', { class: `table-seat seat-${role}`, 'data-role': role, 'aria-label': label },
      h('div', { class: 'seat-line' }, h('b', {}, label), who), h('div', { class: 'seat-frame' }, mount, status));
    return { el, mount, status, who, label: el.querySelector('b') };
  };
  const mine = seatBox('mine', 'Your seat');
  const theirs = seatBox('theirs', 'The other seat');
  const houseMount = h('div', { class: 'hidden-mount' });
  const seats = h('div', { class: 'table-seats daisy-seats', hidden: true }, mine.el, theirs.el);
  // Until the relay gives you a seat (the first time this load), "Joining the table…" stands where the seats
  // go: the tiles load out of sight meanwhile (they'd show their card pictures, not knowing their seat).
  const joiningText = h('p', {}, 'Joining the table…');
  const joiningHint = h('p', { class: 'small daisy-joining-hint', hidden: true });
  const joining = h('div', { class: 'daisy-joining', hidden: true, role: 'status', 'aria-live': 'polite' }, joiningText, joiningHint);

  const linkBox = h('input', { class: 'dz-link', type: 'text', readonly: true, 'aria-label': 'The link to this table' });
  const copyBtn = h('button', { type: 'button', class: 'primary', onclick: () => copyLink() }, 'Copy');
  const invite = h('div', { class: 'daisy-invite', hidden: true },
    h('p', {}, h('b', {}, 'Send this link to a friend.'), ' They open it in Raku (or paste it into Raku\'s address box), sign in and take the other seat.'),
    h('div', { class: 'daisy-link-row' }, linkBox, copyBtn));

  const lobbyText = h('p', {});
  const lobbyActions = h('div', { class: 'actions' });
  const lobby = h('div', { class: 'daisy-lobby', hidden: true }, h('h2', {}, 'A table of Daisy'), lobbyText, lobbyActions);

  const homeBtn = h('button', { type: 'button', class: 'linkish daisy-home', onclick: () => backToStart() }, 'Back to the start');
  const afterBtn = h('button', { type: 'button', class: 'daisy-after', hidden: true, onclick: () => goHome() }, 'Back to the start');
  const leaveNo = h('button', { type: 'button', class: 'primary', onclick: () => { leave.hidden = true; } }, 'Stay');
  const leave = h('div', { class: 'daisy-leave', hidden: true, role: 'alertdialog', 'aria-label': 'Leave this match?' },
    h('p', {}, 'Leave this match? If you don\'t come back within 2 minutes, it ends by forfeit.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => goHome() }, 'Leave'), leaveNo));
  root.append(h('div', { class: 'daisy-top' }, homeBtn), leave, lobby, invite, joining, seats, afterBtn, houseMount);

  // ---------- the match ----------
  let me = null;               // { did, handle, seat, ask }
  let other = null;            // { did, handle, seat, here, house }
  let snapshot = null;
  let houseReady = false, houseSaid = false;
  let relay = null, lastView = null, phase = null, result = null, problem = null;
  let myView = null, theirView = null, joinedHere = false, mismatch = false;
  let goneAt = 0, goneTimer = null, disposed = false, slowTimer = null;
  const hello = { mine: false, theirs: false };
  const remember = () => { if (me && me.seat) keepStore.keep(tableId, { me: { did: me.did, handle: me.handle, seat: me.seat }, other, snapshot }); };

  const frames = createFrames({
    roles: ['house', 'mine', 'theirs'],
    titles: { house: 'The house (referee)', mine: 'Your seat', theirs: "The other player's seat (watching)" },
    mothership,
    tileUrlFor: (role) => (role === 'house' ? table.house.uri : table.player.uri),
    mounts: { house: houseMount, mine: mine.mount, theirs: theirs.mount },
    heights: { house: 200, mine: 560, theirs: 560 },
    times: TABLE_TIMES,
    onStatus,
    ping: (role, n) => router.fromPage(role, 'ping', { n }),
  });

  const router = createRouter({
    deliver(target, payload) {
      if (payload.kind === 'view' && target === 'mine') { lastView = payload; if (payload.view) onView(payload.view); }
      frames.send(target, payload);
    },
    toRelay: (data) => relay && !mismatch && relay.send(data),
    onPage,
    // The panel says "the other page" for what goes through the relay.
    onLog: (e) => log(e.dir === 'out' ? { ...e, to: 'the other page' } : e.dir === 'in' ? { ...e, from: 'the other page' } : e),
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
    if (role === 'house') {
      const changed = /changed since/.test(extra?.error?.message || '');
      const text = { slow: 'Still opening the table…', stuck: 'Still opening the table…',
        failed: changed ? "This table's tiles have changed since Raku's list was set up, so Raku won't use them." : "The table couldn't open.",
        stopped: 'The table stopped answering.' }[status] || null;
      setNote(text, ['stuck', 'failed', 'stopped'].includes(status) ? () => frames.start('house') : null);
      if (status === 'loading' || status === 'stopped') { houseSaid = false; houseReady = false; tellPlayersHouse('gone'); }
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
    switch (p.kind) {
      case 'hello':
        if (from === 'house') { houseSaid = true; setupHouse(); } else { hello[from] = true; introduce(from); }
        break;
      case 'die-view': {
        const { game, v, from: f, kind, ...view } = p;
        if (from === 'mine') myView = view; else theirView = view;
        break;
      }
      case 'state': snapshot = p.snapshot; remember(); break;
      case 'resumed': log({ dir: 'page', from: 'house', kind: 'resumed', note: 'picked up from this browser' }); break;
      case 'result':
        result = p.result;
        root.dataset.result = p.result.matchId;
        log({ dir: 'page', from: 'house', kind: 'result', note: `match over: seat ${p.result.winner} won${p.result.ending === 'forfeit' ? ' by forfeit' : ''}` });
        break;
      // Save in your seat: Raku's own prompt (saving.js), from your house's result, to the account sitting here.
      case 'save-request':
        if (from === 'mine' && me) save({ result, seat: me.seat, tell: tellMine, account: { did: me.did, handle: me.handle } });
        break;
      case 'ignored':
        if (p.why === 'different timers') { problem = "The other page uses different timers, so the table can't start. Both pages need ?timers=short, or neither."; updateStatus(); }
        if (p.why === 'the other page started over') { problem = `${at(other && other.handle)}'s page started over without its saved game, so this game can't go on. It ends by forfeit when the timer runs out.`; updateStatus(); }
        if (!['already had it'].includes(p.why)) log({ dir: 'drop', from: 'house', kind: p.about, why: p.why });
        break;
    }
  }
  const tellMine = (state, extra = {}) => { if (hello.mine) router.fromPage('mine', 'save-status', { state, ...extra }); };

  // The player tiles: yours, and the copy watching the other seat.
  function introduce(role) {
    if (!hello[role] || !me || !me.seat) return;
    if (role === 'mine') router.fromPage('mine', 'seat', { seat: me.seat, handle: me.handle, watching: false });
    else router.fromPage('theirs', 'seat', { seat: me.seat === 1 ? 2 : 1, handle: other ? other.handle : null, watching: true });
    if (lastView) frames.send(role, lastView);
    if (role === 'theirs' && theirView) frames.send('theirs', { ...theirView, game: 'daisy', v: 1, kind: 'die-view', from: 'peer' });
    if (houseReady && houseSaid) router.fromPage(role, 'presence', { who: 'house', state: 'back' });
    if (role === 'mine' && result && save.savedFor?.(result.matchId)) tellMine('saved', { handle: save.savedFor(result.matchId).handle });
    if (role === 'mine') tellOther();
  }
  // Your tile hears whether the other page is still at the table (its end screen says so).
  function tellOther() { if (hello.mine && other) router.fromPage('mine', 'presence', { who: 'other', state: other.here ? 'back' : 'gone' }); }

  function setupHouse() {
    if (!houseSaid || houseReady || !me || !me.seat) return;
    houseReady = true;
    router.fromPage('house', 'setup', { seat: me.seat, timers, snapshot: snapshot || undefined });
    router.fromPage('house', 'seated', { seat: me.seat, did: me.did, handle: me.handle });
    if (other) router.fromPage('house', 'seated', { seat: other.seat, did: other.did, handle: other.handle });
    if (other && !other.here) router.fromPage('house', 'presence', { seat: other.seat, state: 'gone' });
    router.fromPage('house', 'reconnected');
    tellPlayersHouse('back');
  }
  const tick = setInterval(() => { if (houseReady) router.fromPage('house', 'tick'); }, TABLE_TIMES.tick);

  // ---------- the relay (the same messages as the Daisy page, relay tables.js) ----------
  function connect() {
    if (!relayAt) { setStatus("There's no relay to play through, so this table can't open."); return; }
    relay = connectRelay({
      url: relayAt, WebSocketImpl,
      joinMessage: () => joinMessage({ tableId, me, house: myHouse, kept: !!snapshot, joinedHere }),
      onState(state) {
        if (disposed) return;
        // (before the first seat this load, the "Joining the table…" box says what's going on)
        if (state === 'down') setStatus(joinedHere ? 'Lost the connection to the table. Reconnecting…' : "Can't reach the relay yet. Trying again…");
        if (state === 'connecting' && !me.seat) setStatus('Joining the table…');
      },
      onMessage(m) {
        if (disposed) return;
        switch (m.type) {
          case 'joined':
            joinedHere = true;
            clearTimeout(slowTimer);
            me.seat = m.seat;
            if (m.other) other = { ...m.other, seat: m.seat === 1 ? 2 : 1 };
            remember();
            log({ dir: 'page', from: 'relay', kind: 'joined', note: `seat ${m.seat}${m.other ? `, with ${at(m.other.handle)}` : ''}` });
            tellOther();
            if (m.other) checkHouse(m.other.house);
            showTable();
            introduce('mine'); introduce('theirs');
            if (houseReady) {
              if (other) router.fromPage('house', 'seated', { seat: other.seat, did: other.did, handle: other.handle });
              router.fromPage('house', 'presence', { seat: me.seat === 1 ? 2 : 1, state: other && other.here ? 'back' : 'gone' });
              router.fromPage('house', 'reconnected');
            } else setupHouse();
            if (myView && other && other.here && !mismatch) relay.send({ kind: 'die-view', ...myView });
            updateStatus();
            break;
          case 'presence':
            other = { did: m.did, handle: m.handle, seat: m.seat, here: m.state === 'here', house: m.house };
            remember();
            log({ dir: 'page', from: 'relay', kind: 'presence', note: `${at(m.handle)} ${m.state === 'here' ? 'is here' : 'is gone'}` });
            tellOther();
            if (m.state === 'here') checkHouse(m.house);
            if (houseReady) {
              router.fromPage('house', 'seated', { seat: m.seat, did: m.did, handle: m.handle });
              router.fromPage('house', 'presence', { seat: m.seat, state: m.state === 'here' ? 'back' : 'gone' });
              if (m.state === 'here') router.fromPage('house', 'reconnected');
            }
            introduce('theirs');
            if (m.state === 'here' && myView && !mismatch) relay.send({ kind: 'die-view', ...myView });
            goneAt = m.state === 'here' ? 0 : Date.now();
            showTable();
            updateStatus();
            break;
          case 'peer': if (!mismatch) router.fromRelay(m.data); break;
          case 'full':
            log({ dir: 'drop', from: 'relay', kind: 'join', why: 'the table is full' });
            stopTable('This table is full: two players are already sitting at it.');
            break;
          case 'replaced':
            stopTable('You opened this seat in another window or tab, so this one has stepped away.');
            break;
          case 'held':
            stopTable(`@${me.handle} already sits at this table in another browser. Its game, and the secret it needs for the dice, live there: open the table in that browser to keep playing.`);
            break;
          case 'error': log({ dir: 'drop', from: 'relay', kind: 'error', why: m.why }); break;
        }
      },
    });
  }

  // Both pages must run the same referee (the pinned house), or nothing passes between them.
  function checkHouse(theirsV) {
    if (mismatch || theirsV === myHouse) return;
    mismatch = true;
    root.dataset.mismatch = '1';
    log({ dir: 'drop', from: 'relay', kind: 'house', why: `the other page runs house ${theirsV || '(unnamed)'}, this one ${myHouse}` });
    problem = MISMATCH_TEXT;
    hideTable();
    updateStatus();
  }

  function stopTable(text) {
    problem = text;
    frames.stop();
    hideTable();
    lobby.hidden = true;
    setStatus(text);
    root.dataset.stopped = '1';
  }

  // ---------- the status line ----------
  function onView(v) { phase = v.phase; updateStatus(); afterBtn.hidden = !(phase === 'over' || phase === 'abandoned'); }
  function updateStatus() {
    clearInterval(goneTimer);
    if (!me || !me.seat) return;
    if (problem) { setStatus(problem); return; }
    if (other && !other.here && goneAt && phase !== 'over' && phase !== 'abandoned') {
      const awayFor = DAISY_AWAY_MS[timers];
      const show = () => setStatus(`${at(other.handle)} lost connection. Waiting… ${mmss(awayFor - (Date.now() - goneAt))}`);
      show();
      goneTimer = setInterval(show, 1000);
      return;
    }
    if (!other) { setStatus('Waiting for the other player. Send them the link.'); return; }
    if (mismatch) return;
    invite.hidden = true;
    setStatus(phase === 'over' ? `Match over · playing with ${at(other.handle)}` : `Playing with ${at(other.handle)}${timers === 'short' ? ' · short timers' : ''}`);
  }
  function showTable() {
    lobby.hidden = true;
    if (mismatch || problem && root.dataset.stopped) return;
    seats.hidden = false;
    // not seated yet this load: the seats stay out of sight (still loading), "Joining the table…" instead
    seats.classList.toggle('daisy-seats-waiting', !joinedHere);
    joining.hidden = joinedHere;
    mine.who.textContent = `You · @${me.handle}${me.seat ? ` · seat ${me.seat}` : ''}`;
    theirs.who.textContent = other ? `@${other.handle} · seat ${other.seat}${other.here ? '' : ' · away'}` : 'Waiting for the other player';
    invite.hidden = !(me.seat === 1 && !other);
    if (!invite.hidden) linkBox.value = shareLink(tableId, loc);
  }
  function hideTable() { seats.hidden = true; invite.hidden = true; joining.hidden = true; clearTimeout(slowTimer); }
  // No seat after a few seconds: say what's likely wrong (Raku keeps trying meanwhile).
  function slowHint() {
    if (joinedHere || disposed || root.dataset.stopped) return;
    joiningText.textContent = 'Still joining the table…';
    joiningHint.hidden = false;
    if (!isLocal(loc)) joiningHint.textContent = "Can't reach Daisy's relay right now. Raku keeps trying.";
    else if (relayAt === DAISY_LOCAL_RELAY) joiningHint.textContent = `Can't reach the relay at ${relayAt}. On this computer Raku plays through the stand-in relay: in C:\\thunderbird-cafe\\daisy-tiles, run node scripts/relay-standin.mjs in its own terminal. Raku keeps trying.`;
    else joiningHint.textContent = `Can't reach the relay at ${relayAt}. If it's the live relay, its allowed pages must include ${loc.origin} (fly.toml, then fly deploy). Raku keeps trying.`;
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(linkBox.value); copyBtn.textContent = 'Copied'; }
    catch { linkBox.select(); }
  }

  // ---------- back to the start (as the Daisy page) ----------
  const underWay = () => ['flipping', 'playing'].includes(phase) && !result;
  function goHome() { go(tableUri('daisy')); }
  function backToStart() {
    if (!underWay()) return goHome();
    leave.hidden = false;           // during a match, ask first (the away rule, said plainly)
    leaveNo.focus();
  }

  // ---------- sitting ----------
  function start(account, seatWish) {
    me = { did: account.did, handle: account.handle, seat: account.seat || null, ask: seatWish };
    lobby.hidden = true;
    showTable();
    setStatus('Joining the table…');
    clearTimeout(slowTimer);
    slowTimer = setTimeout(slowHint, JOIN_HINT_MS);
    frames.start('house'); frames.start('mine'); frames.start('theirs');
    connect();
  }
  function backAt(k) {
    me = { ...k.me }; other = k.other ? { ...k.other, here: false } : null; snapshot = k.snapshot || null;
    setStatus('Back at your seat…');
    start(me, me.seat);
  }
  function takeSeat() {
    sitAs({ auth, table, host: root.closest('.table-wrap') || root, say: (t) => { lobbyNote.textContent = t; }, keepForReturn, onReady: (acct) => {
      const k = keepStore.kept(tableId).find((x) => x.me.did === acct.did);
      if (k) return backAt(k);
      start(acct, 'any');
    } });
  }
  const lobbyNote = h('p', { class: 'small daisy-lobby-note', role: 'status', 'aria-live': 'polite' });
  function showLobby() {
    setStatus('');
    lobby.hidden = false;
    const kept = keepStore.kept(tableId);
    const cur = auth.current();
    lobbyText.textContent = kept.length ? 'This browser has a seat at this table.' : "You've been invited to a table of Daisy.";
    const buttons = kept.map((k) => h('button', { type: 'button', class: 'primary', onclick: () => backAt(k) }, `Back to your seat as @${k.me.handle}`));
    if (!kept.length || !cur || !kept.some((k) => k.me.did === cur.did)) {
      const label = cur ? `Take a seat as @${cur.handle}` : 'Sign in to take a seat';
      buttons.push(h('button', { type: 'button', class: kept.length ? '' : 'primary', onclick: () => takeSeat() }, label));
    }
    lobbyActions.replaceChildren(...buttons);
    lobby.append(lobbyNote);
    lobbyNote.textContent = cur ? 'You sit as the account shown in the top bar (switch it there). Playing someone needs "Play Daisy", the permission saving uses.' : 'Playing someone needs a sign-in, so the other player sees your real, checked handle.';
  }
  const offAuth = auth.onChange(() => { if (!me && !lobby.hidden) showLobby(); });

  // How this tab arrived: from "Open a table" (straight to seat 1), back at a kept seat (this browser tab
  // sat here before: a reload, Back to the table), or by a link (the lobby: take a seat).
  //   intents: { kind: 'open', did, handle } from Open a table; { kind: 'resume', did } from the start
  //   screen's "Back to the table".
  const intent = intents.get(tableId);
  intents.delete(tableId);
  if (intent && intent.kind === 'open') start(intent, 1);
  else {
    const kept = keepStore.kept(tableId);
    const tab = keepStore.tabAccount(tableId);
    const resume = (intent && intent.kind === 'resume' && kept.find((k) => k.me.did === intent.did)) || kept.find((k) => k.me.did === tab);
    if (resume) backAt(resume);
    else showLobby();
  }

  return {
    frames, router, hello,
    get me() { return me; }, get other() { return other; }, get phase() { return phase; }, get result() { return result; },
    get mismatch() { return mismatch; }, get snapshot() { return snapshot; },
    blip: () => relay && relay.blip(),
    dispose() {
      disposed = true;
      clearInterval(tick); clearInterval(goneTimer); clearTimeout(slowTimer);
      removeEventListener('message', onMessage);
      offAuth();
      try { relay && relay.stop(); } catch { /* fine */ }
      frames.stop();
    },
  };
}
