// A room as a Raku tab (rooms in Raku, step 1: claude/raku-rooms-plan.md, RR1 to RR10).
//
// The room itself is rooms-lab's code (package.json "rooms-lab", pinned to a GitHub tag, RR1): mountRoomPage
// draws the room, Raku hands it what's Raku's own:
//   - the join screen (RR4): "Join as @handle ✓" with Raku's own account, "or type a name instead"; signed out,
//     "Sign in to show your handle" (Raku's sign-in) or a typed name. The first time an account joins a room,
//     Raku asks once for the "Rooms" permission in a small window, as a game's first save asks for its set;
//   - the address (RR2): a room tab is just raku:room. The room code (and, for the host, the host key) stay in this
//     browser tab's own storage, so a reload brings you back with one click (RR10: browsers won't play other
//     people's voices without a click), and a copied Raku link never lets anyone in. Closing Raku's window, or this
//     browser tab, forgets the room (RR10). Invite links are Raku's own, https://raku.lexicographer.space/#r=…
//     (the host link adds &k=…); the lab page's links are taken too while it's still up (RR3);
//   - Raku's tile loader for the house tile (pinned, config.js ROOMS.house) and for tiles opened for everyone
//     (Raku's one mothership, its frames: no camera, microphone or location for tiles);
//   - one room at a time (RR6): opening another room while in one asks "Leave it and join this one?";
//   - Expand (rooms step 3, claude/raku-rooms-step3.md, RR15 to RR21): the room's expanded stage fills Raku's tab
//     area (`expandArea`), and Raku hides its own rows meanwhile (`onExpand`, app.js): the address row in the
//     installed window (the tabs stay in the title bar), the top bar and the toolbar on a phone; a browser tab on a
//     computer keeps Raku's top bar (its tabs live there).
// The room keeps the lab's look (room.css: Raku's palette), without the lab's heading and footer (the About page
// says what the footer said).
// (Its look, rooms-lab's room.css, is imported by main.js with Raku's own style.css.)
import { mountRoomPage, NAME_KEY, keepHostKey, keptHostKey, whoLabel } from 'rooms-lab/room-page.js';
import { cleanName, newRoomCode, isRoomCode } from 'rooms-lab/formats.js';
import { createTileRecords } from 'rooms-lab/tile-records.js';
import { Tile } from '@dasl/tile-loader';
import { ROOMS, SIGNIN_PROMISE, roomsRelayUrl } from './config.js';
import { ROOM_URI } from './address.js';
import { h } from './cards.js';
import { openDialog, signInForm } from './signin-ui.js';
import { canShowHandle, leaveQuestion, readInvite, roomLink } from './room-words.js';

const HOUSE_HEIGHT = 240;
const get = (s, k) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const put = (s, k, v) => { try { if (v == null) s?.removeItem(k); else s?.setItem(k, v); } catch { /* private window */ } };

/**
 * The rooms of this Raku window: at most one live (RR6). deps: { auth, mothership, resolver, session, storage, loc,
 * tabs, stage, say, keepForReturn, openRoomTab(), closeTab(id), onExpand(tabId, on) }.
 */
export function createRooms(deps) {
  const { auth, mothership, session, storage, loc, tabs, stage, say } = deps;
  const records = createTileRecords();
  const entries = new Map();          // tab id → { api, code, joined, people, rejoin }
  let pendingInvite = null;           // an invite waiting for its room tab to draw

  const kept = () => { try { const v = JSON.parse(get(session, ROOMS.keepKey) || 'null'); return v && isRoomCode(v.code) ? v : null; } catch { return null; } };
  const keep = (v) => put(session, ROOMS.keepKey, v ? JSON.stringify(v) : null);
  const liveEntry = () => [...entries.entries()].find(([, e]) => e.joined) || null;

  // The house tile for the host's page: the pinned version only, every file checked (rooms-lab tile-records.js);
  // otherwise the host approves each request and the room says so.
  async function loadHouse() {
    const rec = await records.read(ROOMS.house.uri);
    if (!rec.ok) { console.warn('[raku] the rooms house tile couldn’t be read:', rec.why); return null; }
    if (rec.cid !== ROOMS.house.cid) { console.warn(`[raku] the rooms house tile has changed (record ${rec.cid}, pinned ${ROOMS.house.cid}): not used`); return null; }
    const loader = records.pathLoader({ pds: rec.pds, did: rec.did, manifest: rec.manifest });
    const frame = new Tile(mothership, rec.uri, rec.manifest, loader).renderContent(HOUSE_HEIGHT);
    frame.title = 'The house (the room’s rules)';
    return frame;
  }
  // Tiles opened for everyone (and previews): Raku's loader, with the room's own pinned file loader.
  const tileHost = {
    render({ uri, manifest, loader, height }) {
      const frame = new Tile(mothership, uri, manifest, loader).renderContent(height);
      frame.removeAttribute('style');
      frame.setAttribute('allow', '');                    // no camera, microphone, location… for tiles (stage 1)
      frame.setAttribute('referrerpolicy', 'no-referrer');
      return frame;
    },
  };

  // ---- the join screen (RR4, RR10), drawn into the room's own view ----
  function joinScreen(tabId, p, { view, note, enter }) {
    const e = entries.get(tabId);
    // What this screen is for, kept across redraws (signing in or out in the account menu redraws it):
    if (e.invite || e.rejoin) { e.screen = { invite: e.invite, back: e.rejoin }; e.invite = null; e.rejoin = null; }
    const invite = e.screen.invite || null;            // { room, hostKey } from an invite, or null
    const back = e.screen.back || null;                // the room this tab was in before a reload (RR10), or null
    const code = invite?.room || back?.code || null;
    if (invite?.hostKey) keepHostKey(session, invite.room, invite.hostKey);
    const hostKey = code ? keptHostKey(session, code) : null;
    const problem = h('p', { class: 'rl-problem', role: 'alert' }, note || '');
    const status = h('p', { class: 'rl-status', role: 'status', 'aria-live': 'polite' });

    // Who joins: Raku's current account (did:plc), or a typed name.
    const acct = auth.current();
    e.shownDid = acct ? acct.did : null;
    e.shownCovers = acct ? auth.coversRooms(acct.did) : false;
    let typed = !acct || !canShowHandle(acct.did) || !!e.typedName;
    const nameBox = h('input', { class: 'rl-name', type: 'text', maxlength: 40, autocomplete: 'nickname', value: get(storage, NAME_KEY) || '', 'aria-describedby': 'rk-room-appear' });
    const appear = h('p', { class: 'rl-appear-as', id: 'rk-room-appear' });
    const typedProblem = (raw) => (String(raw || '').trim().startsWith('@') ? 'A typed name can’t start with “@”. Sign in to show a handle.' : null);
    const buttons = [];
    function showAppear() {
      if (!typed) { appear.replaceChildren(h('span', { class: 'rl-appear-label' }, 'Join as'), h('span', { class: 'rl-appear-who' }, ...whoLabel(acct.handle, true))); for (const b of buttons) b.disabled = false; return; }
      const bad = typedProblem(nameBox.value);
      const name = cleanName(nameBox.value);
      appear.classList.toggle('rl-appear-bad', !!bad);
      if (bad) appear.replaceChildren(h('span', { class: 'rl-problem' }, bad));
      else appear.replaceChildren(h('span', { class: 'rl-appear-label' }, 'You’ll appear in the room as'),
        name ? h('span', { class: 'rl-appear-who' }, ...whoLabel(name, false)) : h('span', { class: 'rl-unv' }, acct ? 'Type a name.' : 'Type a name or sign in.'));
      for (const b of buttons) b.disabled = !!bad;
    }
    nameBox.addEventListener('input', showAppear);

    // The way in once the person is known: a pass (signed in), or the typed name.
    async function go(how, btn) {
      problem.textContent = '';
      const fresh = how === 'new' ? newRoomCode() : code;
      let args;
      if (!typed) {
        // Just after a reload, Raku may still be reading what this account's sign-in allows (no window needed).
        if (!auth.known(acct.did)) await auth.restore(acct.did);
        if (!auth.coversRooms(acct.did)) {
          // The first time: "Rooms" from this account, in a small window opened straight from the click. Then one more
          // press: the room's sound starts from a click (some browsers won't play it after the wait).
          if (await approve(acct, btn)) { status.textContent = '“Rooms” approved. Press the button again to go in.'; redrawHelp(); }
          return;
        }
        const did = acct.did;
        args = { name: acct.handle, getPass: () => auth.getRoomPass(did), did };
        e.who = { did, handle: acct.handle };
      } else {
        if (typedProblem(nameBox.value)) { nameBox.focus(); return; }
        const name = cleanName(nameBox.value);
        if (!name) { problem.textContent = acct ? 'Type a name first (up to 40 characters).' : 'Type a name first (up to 40 characters), or sign in.'; nameBox.focus(); return; }
        put(storage, NAME_KEY, name);
        args = { name };
        e.who = { name };
      }
      const start = () => {
        e.code = fresh;
        enter({ code: fresh, create: how === 'new', hostKey: how === 'host' ? hostKey : null, ...args });
      };
      // One room at a time (RR6): another tab is in a room.
      const live = liveEntry();
      if (live && live[0] !== tabId) return askLeave(live, () => { tabs.activate(tabId); start(); });
      start();
    }

    async function approve(a, btn) {
      const popup = auth.openWindow();
      if (!popup) { status.textContent = 'The sign-in window was blocked. Allow pop-ups for this page, then try again, or type a name instead.'; return false; }
      const ac = new AbortController();
      status.textContent = `Approve “Rooms” in the small window from @${a.handle}’s account server…`;
      for (const b of buttons) b.disabled = true;
      e.busy = true;
      try {
        const did = await auth.signIn(a.handle, auth.roomsScopeFor(a.did), { signal: ac.signal });
        if (did !== a.did) { status.textContent = `That was a different account. Approve “Rooms” as @${a.handle}.`; return false; }
        if (!auth.coversRooms(did)) { status.textContent = '“Rooms” wasn’t approved, so the room can’t show your handle. Try again, or type a name instead.'; return false; }
        status.textContent = '';
        return true;
      } catch (err) {
        status.textContent = err?.message || 'Sign-in didn’t finish. Try again.';
        return false;
      } finally { e.busy = false; for (const b of buttons) b.disabled = false; showAppear(); }
    }
    const redrawHelp = () => view.querySelector('.rk-rooms-help')?.remove();

    // RR10: back after a reload: one click (the room's sound starts from it), the same way in as before. If the account
    // it joined with isn't signed in here any more, the ordinary join screen for this room, with a note.
    if (back) {
      const sameAccount = !!back.did && !!acct && acct.did === back.did && canShowHandle(back.did);
      if (sameAccount || back.name) {
        typed = !sameAccount;
        if (!sameAccount) nameBox.value = back.name;
        const rejoin = h('button', { class: 'rl-primary rk-rejoin', type: 'button', onclick: () => go(hostKey ? 'host' : 'join', rejoin) }, 'Rejoin');
        const leave = h('button', { type: 'button', class: 'rk-room-leave', onclick: () => {
          keep(null); keepHostKey(session, back.code, null);
          e.screen = {};
          joinScreen(tabId, p, { view, note: '', enter });
        } }, 'Leave');
        buttons.push(rejoin);
        view.replaceChildren(h('section', { class: 'rl-lobby rk-room-join rk-room-back' },
          h('h2', { class: 'rk-room-h' }, 'Room'),
          h('p', {}, 'You were in room ', h('code', {}, back.code), hostKey ? ' as its host.' : '.', ' Rejoin?'),
          h('p', { class: 'rl-appear-as' }, h('span', { class: 'rl-appear-label' }, sameAccount ? 'Join as' : 'You’ll appear in the room as'),
            h('span', { class: 'rl-appear-who' }, ...whoLabel(sameAccount ? acct.handle : back.name, sameAccount))),
          h('div', { class: 'rl-actions' }, rejoin, leave), status, problem));
        return;
      }
      if (!note) problem.textContent = `You joined as @${back.handle || 'your handle'}, which isn’t signed in here now. Sign in again, or type a name.`;
    }

    // The ways to show who you are (RR4).
    let who;
    if (acct && canShowHandle(acct.did) && !typed) {
      who = h('div', { class: 'rl-way rl-way-signed', 'data-signed-in': '' }, appear,
        h('button', { type: 'button', class: 'rl-link rk-type-instead', onclick: () => { e.typedName = true; typed = true; joinScreen(tabId, p, { view, note: '', enter }); } }, 'or type a name instead'),
        auth.coversRooms(acct.did) ? null : h('p', { class: 'rl-help rk-rooms-help' }, 'The first time, Raku asks your account for one more permission, “Rooms”: a pass that shows the room your handle is really yours. Nothing in your account is read or changed.'));
    } else {
      const parts = [];
      if (acct && canShowHandle(acct.did)) {
        parts.push(h('button', { type: 'button', class: 'rl-link rk-use-handle', onclick: () => { e.typedName = false; joinScreen(tabId, p, { view, note: '', enter }); } }, h('span', {}, 'or join as '), ...whoLabel(acct.handle, true)));
      } else if (acct) {
        parts.push(h('p', { class: 'rl-help rk-room-didweb' }, `Rooms show a checked handle for most accounts, but not for @${acct.handle}’s kind yet. Type a name to join.`));
      } else {
        // Signed out: Raku's own sign-in, asking for "Rooms" in the same window.
        const holder = h('div', { class: 'rk-room-signin' });
        const open = h('button', { type: 'button', class: 'rl-signin', onclick: () => {
          const form = signInForm({
            auth, button: 'Sign in',
            scope: (whoIs) => auth.roomsScopeFor(auth.didForHandle(whoIs)),
            onDone: () => joinScreen(tabId, p, { view, note: '', enter }),
            goHere: (whoIs, scope) => { deps.keepForReturn({ kind: 'room', code }); return auth.signInHere(whoIs, scope, 'room'); },
            hereNote: 'Other tabs will reload, and this screen comes back.',
          });
          holder.replaceChildren(form.el, h('p', { class: 'rl-help rk-promise' }, SIGNIN_PROMISE));
          form.focus();
        } }, 'Sign in to show your handle');
        holder.append(open, h('p', { class: 'rl-help' }, 'Your handle will appear in the room as checked. Optional.'));
        parts.push(h('div', { class: 'rl-way rl-way-signin' }, holder));
      }
      who = h('div', {}, ...parts, h('div', { class: 'rl-way rl-way-name' },
        h('h3', {}, acct && canShowHandle(acct.did) ? 'Type a name' : 'Or type a name'),
        h('label', { class: 'rl-field' }, h('span', {}, 'Your name'), nameBox), appear));
    }

    // What to do: join this room (as host if this tab holds its key), or start one; paste an invite.
    const acts = [];
    if (code && hostKey) acts.push(h('button', { class: 'rl-primary', type: 'button', onclick: (ev) => go('host', ev.currentTarget) }, 'Rejoin as host'));
    if (code) acts.push(h('button', { class: hostKey ? '' : 'rl-primary', type: 'button', onclick: (ev) => go('join', ev.currentTarget) }, hostKey ? 'Join as a guest' : 'Join room'));
    acts.push(h('button', { class: code ? '' : 'rl-primary', type: 'button', onclick: (ev) => go('new', ev.currentTarget) }, code ? 'Start a new room instead' : 'New room'));
    buttons.push(...acts);
    nameBox.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(code ? (hostKey ? 'host' : 'join') : 'new', null); });

    const pasteBox = h('input', { class: 'rk-invite-box', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'https://raku.lexicographer.space/#r=…', 'aria-label': 'An invite link' });
    const pasted = () => {
      const inv = readInvite(pasteBox.value);
      if (!inv) { problem.textContent = 'That isn’t an invite link. It looks like https://raku.lexicographer.space/#r=…'; pasteBox.focus(); return; }
      takeInvite(inv, { tabId });
    };
    pasteBox.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') pasted(); });
    const paste = code ? null : h('div', { class: 'rk-paste' },
      h('label', { class: 'rl-field' }, h('span', {}, 'Have an invite? Paste it here'),
        h('span', { class: 'rl-row' }, pasteBox, h('button', { type: 'button', onclick: pasted }, 'Join'))));

    const intro = code
      ? h('p', {}, hostKey ? 'You made this room (or opened its host link) in this tab. ' : 'You’re invited to a room. ', 'Room ', h('code', {}, code), '.')
      : h('p', {}, 'Start a room, then send its invite link to the people you want to join. Voice, one shared screen, and tiles opened for everyone, for 2 to 6 people.');
    view.replaceChildren(h('section', { class: 'rl-lobby rk-room-join' },
      h('h2', { class: 'rk-room-h' }, 'Room'), intro, who, h('div', { class: 'rl-actions' }, ...acts), status, problem, paste));
    showAppear();
    if (typed && !nameBox.value && stage.contains(view) && tabs.active.id === tabId) setTimeout(() => nameBox.focus(), 0);
  }

  // RR6: "You're in a room with Nick and Robin. Leave it and join this one?" over the current room's tab, which comes
  // to the front either way. Leave and join: hang up, close that tab, then go on.
  function askLeave([liveId, live], then) {
    tabs.activate(liveId);
    const d = openDialog(stage, { label: 'Leave this room?' });
    const leave = h('button', { type: 'button', class: 'primary rk-leave-join', onclick: () => {
      d.close();
      try { live.api.leave(); } catch { /* fine */ }
      deps.closeTab(liveId);
      then();
    } }, 'Leave and join');
    const stay = h('button', { type: 'button', class: 'rk-stay', onclick: () => d.close() }, 'Stay');
    d.body.replaceChildren(h('h2', {}, 'Leave this room?'), h('p', { class: 'rk-leave-q' }, leaveQuestion(live.people)), h('div', { class: 'actions' }, leave, stay));
    leave.focus();
  }

  // An invite (from Raku's start, the address box, a pasted link, the page's address changing): RR6.
  function takeInvite(inv, { tabId = null } = {}) {
    if (!inv || !isRoomCode(inv.room)) return;
    if (inv.hostKey) keepHostKey(session, inv.room, inv.hostKey);
    const live = liveEntry();
    if (live && live[1].code === inv.room) { tabs.activate(live[0]); say('You’re already in this room.'); return; }
    const open = () => {
      // A room tab showing its join screen takes it; else a new room tab.
      const idle = tabId && entries.has(tabId) ? tabId : [...entries.entries()].find(([, e]) => !e.joined)?.[0];
      pendingInvite = inv;
      if (idle) { tabs.activate(idle); redraw(idle); } else deps.openRoomTab();
    };
    if (live) return askLeave(live, open);
    open();
  }
  function redraw(tabId) {
    const e = entries.get(tabId);
    if (!e || e.joined) return;
    e.invite = pendingInvite; pendingInvite = null;
    e.screen = {};
    e.redraw?.();
  }

  // ---- one room tab ----
  function draw(p, tab) {
    p.title = 'Room';
    p.shownAddress = ROOM_URI;
    p.state = 'ready';
    const [did, , rkey] = ROOMS.house.uri.replace(/^at:\/\//, '').split('/');
    p.keep = { kind: 'tile', did, rkey, name: ROOMS.name, by: '' };
    const e = { api: null, code: null, joined: false, people: [], invite: pendingInvite, rejoin: null, screen: {}, wasBack: false, who: null, typedName: false, shownDid: null };
    pendingInvite = null;
    // RR10: the room this browser tab was in before a reload (for the first room tab only).
    const was = kept();
    if (!e.invite && was && ![...entries.values()].some((x) => x.code === was.code || x.wasBack)) { e.rejoin = was; e.wasBack = true; }
    entries.set(tab.id, e);
    const root = h('div', { class: 'room-pane' });
    p.el.append(root);
    e.api = mountRoomPage(root, {
      chrome: false,
      relayUrl: roomsRelayUrl(loc),
      loc, storage, session,
      loadHouse, tileHost, records,
      links: { invite: (code) => roomLink(loc, code), host: (code, key) => roomLink(loc, code, key) },
      joinScreen: ({ view, note, again, enter }) => {
        e.redraw = () => joinScreen(tab.id, p, { view, note: '', enter });
        // "Try again" / "Join here instead" after a refusal: back to this room's join screen; "Back to the start":
        // the start (New room, or paste an invite).
        if (e.code && e.screen.left) e.screen = again ? { invite: { room: e.code, hostKey: null } } : {};
        joinScreen(tab.id, p, { view, note, enter });
      },
      onJoined: ({ code, host }) => {
        e.joined = true; e.code = code;
        keep({ code, host, ...(e.who || {}) });
      },
      onPeople: (list) => { e.people = list; },
      // Expand (step 3): the room's stage fills Raku's tab area; Raku hides its own rows while this tab is in front.
      expandArea: () => stage,
      onExpand: (on) => { e.expanded = !!on; deps.onExpand?.(tab.id, !!on); },
      onOver: ({ code, again }) => {
        e.joined = false; e.people = [];
        e.screen = { left: true };
        if (!again) keep(null);
        e.code = code;
      },
    });
    // Closing the tab (or anything else that clears it) leaves the room, without asking (as the room's Leave).
    p.dispose = () => {
      if (e.joined) { try { e.api.leave(); } catch { /* fine */ } }
      else if (e.wasBack && kept()?.code === was?.code) keep(null);    // closed without rejoining: forgotten too
      entries.delete(tab.id);
    };
    p.room = e;
  }

  // Signing in or out in the account menu (or switching accounts) redraws the join screens showing (RR4: one place
  // for accounts). Not while a room is on, and not for the same account (the "Rooms" window's own sign-in).
  auth.onChange?.(() => {
    const did = auth.current()?.did || null;
    const covers = did ? auth.coversRooms(did) : false;
    for (const e of entries.values()) {
      if (e.joined || e.api?.room || !e.redraw || e.busy) continue;
      if (e.shownDid !== did || e.shownCovers !== covers) e.redraw();
    }
  });

  return {
    draw, takeInvite,
    /** The room this window is in: { tabId, code, people } or null. */
    get live() { const l = liveEntry(); return l ? { tabId: l[0], code: l[1].code, people: l[1].people } : null; },
    isLive: (tabId) => !!entries.get(tabId)?.joined,
    isRoomTab: (tabId) => entries.has(tabId),
    /** Is this room tab's stage expanded (step 3)? */
    isExpanded: (tabId) => !!entries.get(tabId)?.expanded,
    /** The Rooms card: a room tab comes to the front if there is one; else the given tab or a new one shows rooms. */
    openRooms(tabId = null) {
      const any = liveEntry() || [...entries.entries()][0];
      if (any) { tabs.activate(any[0]); return any[0]; }
      return null;
    },
    // For the checks.
    get entries() { return entries; },
  };
}
