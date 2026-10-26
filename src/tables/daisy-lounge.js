// Daisy's lounge in Raku (step 5b, claude/raku-stage5b-plan.md): the same lounge as the Daisy page's, on
// Daisy's start screen. Adapted COPY of the site's src/daisy/lounge.js (Oct 21 2026: its states, the relay's
// messages, the wording), with Raku's own parts:
//   - "here" (Q51) = Daisy's start screen is the tab in front and Raku can be seen; otherwise this page
//     quietly leaves the lounge and comes back when it's in front again (setVisible);
//   - the account is Raku's current account (the top bar); switching accounts leaves the lounge (Q54);
//   - turning mingling on: the explanation first, then (when this browser hasn't approved it) one window for
//     the account, "Play Daisy" and "Daisy lounge" together (Q54);
//   - an invitation both said yes to: the tab goes to the table (raku:table/daisy/<id>) at the given seat;
//   - step 5b-2: while the tab isn't in front, the page stays connected as "away" (not listed, can't be
//     invited) and the relay may say "someone" arrived (never who): onSignal() puts the quiet mark on the tab.
// The record (cafe.thunderbird.daisy.lounge/self) and the permission set are the Daisy page's: minglers in
// Raku and on the Daisy page see each other; turning mingling off in either place deletes the one record.
import { h } from '../cards.js';
import { openDialog, signInForm } from '../signin-ui.js';
import { SignInNeeded } from '../auth.js';
import { BLUESKY_API, daisyLoungeUrl, loungeTimes, SIGNIN_PROMISE } from '../config.js';

const OFF_TEXT = 'Off. Turn it on to see other mingling Daisy players who are here now, and let them see you. Joining the lounge requires one additional authorization.';
const OFF_TEXT_READY = 'Off. Turn it on to see other mingling Daisy players who are here now, and let them see you.';
const WAIT_TEXT = 'Sign in to mingle. Joining the lounge requires one additional authorization.';
// Daisy's relay takes lounge passes from did:plc accounts only (Oct 26; daisy-relay's README says why), so a
// did:web account is told plainly here instead of being asked to approve again and again.
export const WEB_TEXT = 'Mingling in the lounge works with most accounts, but not this kind yet.';
export const canMingleAs = (did) => typeof did === 'string' && did.startsWith('did:plc:');
const ON_TEXT = "Mingling: other mingling players can see you while Daisy's start screen is the tab in front";

/** Public profiles for a few accounts (handles, names, avatars), from Bluesky's public API. */
export async function profilesOf(dids, fetchImpl = (...a) => fetch(...a)) {
  const out = new Map();
  for (let i = 0; i < dids.length; i += 25) {
    const q = new URLSearchParams();
    for (const d of dids.slice(i, i + 25)) q.append('actors', d);
    try {
      const res = await fetchImpl(`${BLUESKY_API}/xrpc/app.bsky.actor.getProfiles?${q}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) continue;
      const body = await res.json();
      for (const p of body.profiles || []) {
        if (!p || typeof p.did !== 'string') continue;
        const avatar = typeof p.avatar === 'string' && p.avatar.startsWith('https://cdn.bsky.app/') ? p.avatar : null;
        out.set(p.did, { handle: typeof p.handle === 'string' && p.handle !== 'handle.invalid' ? p.handle : null, name: typeof p.displayName === 'string' ? p.displayName.slice(0, 64) : '', avatar });
      }
    } catch { /* names are a nicety: the list still works with account ids */ }
  }
  return out;
}

export function mountDaisyLounge(host, { table, auth, resolver, onTable, onSignal = () => {}, log = () => {}, keepForReturn = () => {}, dialogHost,
  loc = globalThis.location, WebSocketImpl = globalThis.WebSocket, fetchImpl = (...a) => fetch(...a) }) {
  const url = daisyLoungeUrl(loc);
  const TIMES = loungeTimes(loc);
  const L = table.lounge;

  // ---------- what it draws ----------
  const sw = h('button', { type: 'button', class: 'lounge-switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Mingle', onclick: () => toggle() });
  const noteEl = h('p', { class: 'lounge-note', role: 'status', 'aria-live': 'polite' });
  const retryBtn = h('button', { type: 'button', class: 'lounge-retry', hidden: true, onclick: () => retry() }, 'Rejoin the lounge');
  const whoTime = h('span', { class: 'lounge-who-time' });
  const whoNote = h('p', { class: 'lounge-who-note', role: 'status', 'aria-live': 'polite' });
  const people = h('ul', { class: 'lounge-people' });
  const who = h('div', { class: 'lounge-who', hidden: true },
    h('div', { class: 'lounge-who-head' }, h('button', { type: 'button', class: 'lounge-who-ask', onclick: () => ask() }, 'Who else is mingling?'), whoTime),
    whoNote, people);
  const panel = h('section', { class: 'daisy-lounge', 'aria-label': 'Lounge' },
    h('div', { class: 'lounge-head' }, h('h2', {}, 'Lounge'), h('label', { class: 'lounge-switch-row' }, sw, h('span', {}, 'Mingle'))),
    noteEl, retryBtn, who);
  const knockText = h('p', { id: 'lounge-knock-text' });
  const knockBar = h('span', {});
  const knockCard = h('div', { class: 'lounge-knock', role: 'alertdialog', 'aria-labelledby': 'lounge-knock-text', hidden: true },
    knockText,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary lounge-knock-play', onclick: () => play() }, 'Play'),
      h('button', { type: 'button', class: 'lounge-knock-no', onclick: () => notNow() }, 'Not now')),
    h('div', { class: 'lounge-knock-bar' }, knockBar));
  host.append(panel, knockCard);

  // ---------- state ----------
  let account = null;          // { did, handle }: Raku's current account
  let mingling = false;        // the record exists (as far as this page knows)
  let state = 'off';           // off | joining | here | away (listening, 5b-2) | stopped (2 hours away) | idle | needs-signin | replaced | unavailable | unsupported (did:web)
  let visible = false;         // Daisy's start screen in front and Raku seen (Q51)
  let ws = null, tries = 0, retryTimer = null, lastHereSent = 0, leaving = false, setting = 0;
  let sentAway = false;        // what the relay was last told: away (true) or here
  let knock = null;
  const invited = new Map();   // did → { text, timer }
  let disposed = false;

  const note = (text) => { noteEl.textContent = text || ''; };
  function show() {
    sw.setAttribute('aria-checked', String(mingling));
    // A did:web account can't mingle: the switch is off and disabled (left alone otherwise: turnOff uses it).
    if (state === 'unsupported') { sw.disabled = true; sw.dataset.unsupported = ''; }
    else if ('unsupported' in sw.dataset) { sw.disabled = false; delete sw.dataset.unsupported; }
    panel.dataset.state = state;
    who.hidden = state !== 'here';
    retryBtn.hidden = !['needs-signin', 'idle', 'replaced'].includes(state);
    retryBtn.textContent = state === 'needs-signin' ? 'Approve “Daisy lounge”' : 'Rejoin the lounge';
    if (state === 'unsupported') note(WEB_TEXT);
    else if (state === 'off') note(!account ? WAIT_TEXT : auth.coversLounge(account.did, table.id) ? OFF_TEXT_READY : OFF_TEXT);
    else if (state === 'joining') note(`Joining the lounge as @${account.handle}…`);
    else if (state === 'here') note(`${ON_TEXT} (as @${account.handle}).`);
    else if (state === 'away' || state === 'stopped') note(`Mingling as @${account.handle}. You're in the lounge whenever this tab is in front.`);
  }
  const setState = (s, text) => { state = s; show(); if (text) note(text); };
  const logIn = (m) => log({ dir: 'page', from: 'lounge', to: 'Raku', kind: m.type, ...(m.why ? { note: m.why } : {}) });

  // ---------- the account: Raku's current one ----------
  async function setAccount(a) {
    const n = ++setting;
    if (account && (!a || a.did !== account.did)) { leave(); mingling = false; }
    account = a ? { did: a.did, handle: a.handle } : null;
    if (!account) { setState('off'); return; }
    if (!canMingleAs(account.did)) { mingling = false; setState('unsupported'); return; }
    if (!auth.known(account.did)) { await auth.whenReady(); await auth.restore(account.did); }
    if (n !== setting) return;
    if (!mingling) setState('off');
    let has = false;
    try { has = await hasLoungeRecord(account.did); } catch { return; }
    if (n !== setting || !has) return;
    mingling = true;
    if (!auth.coversLounge(account.did, table.id)) setState('needs-signin', `You mingle as @${account.handle}, but this browser hasn't approved “Daisy lounge” yet.`);
    else join();
  }
  async function hasLoungeRecord(did) {
    const { pds } = await resolver.account(did);
    const res = await fetchImpl(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(L.collection)}&rkey=self`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (res.ok) return true;
    if (res.status === 400 || res.status === 404) return false;
    throw new Error("Couldn't check the lounge record.");
  }

  // ---------- the switch ----------
  function toggle() {
    if (!account) return askSignInFirst();
    if (!canMingleAs(account.did)) return setState('unsupported');
    if (mingling) return turnOff();
    explain();
  }
  // The explanation each time mingling is turned on (as the Daisy page); the line about the extra approval
  // only while this browser hasn't given it. Continue opens the window straight from the click if needed.
  // The order (Q55, owner): the heading, one short line, the box (or Continue) and its button first; the
  // explanation, the permission and Raku's promise below it, smaller but always shown.
  function explain({ signIn = false } = {}) {
    const d = openDialog(dialogHost, { label: 'Turn on mingling?' });
    const status = h('p', { class: 'rk-status', role: 'status', 'aria-live': 'polite' });
    const approved = account && auth.coversLounge(account.did, table.id);
    const details = h('div', { class: 'rk-details' },
      h('p', {}, "While you mingle and Daisy's start screen is the tab in front, other mingling Daisy players who ask can see you and invite you to a game, and you can see and invite them (in Raku or on Daisy's own page). Players who have blocked you, or whom you've blocked, never see each other."),
      h('p', {}, "While Daisy's tab isn't in front, Raku shows a small mark when someone arrives in the lounge. It never says who. Your arrival can show the same mark to other minglers."),
      approved ? null : h('p', {}, 'Mingling needs ', h('b', {}, 'one additional authorization'), ' from your account, ', h('b', {}, '“Daisy lounge”'), " (only this first time): a lounge record in your account (it only says that you've chosen to mingle, not whether you're here or signed in) and a pass that proves to Daisy's relay who you are. Turning mingling off deletes the record."),
      signIn || !account ? h('p', { class: 'rk-promise' }, SIGNIN_PROMISE) : null);
    const head = [h('h2', {}, 'Turn on mingling?'), h('p', { class: 'rk-lede' }, 'Other mingling Daisy players can see you and invite you while this tab is in front.')];
    const notNow = h('button', { type: 'button', onclick: () => d.close() }, 'Not now');
    if (signIn || !account) {
      const form = signInForm({
        auth, button: 'Sign in and mingle',
        scope: (whoIs) => auth.loungeScopeFor(auth.didForHandle(whoIs), table.id),
        onDone: () => { d.close(); afterSignIn(); },
        goHere: (whoIs, scope) => { keepForReturn({ kind: 'lounge', table: table.id }); return auth.signInHere(whoIs, scope, 'lounge'); },
        hereNote: 'Other tabs will reload, and this screen comes back: turn mingling on again.',
      });
      d.body.replaceChildren(...head, form.el, status, h('div', { class: 'actions' }, notNow), details);
      form.focus();
      return;
    }
    const yes = h('button', { type: 'button', class: 'primary', onclick: () => turnOn(d, status, yes) }, 'Continue');
    d.body.replaceChildren(...head, h('div', { class: 'actions' }, yes, notNow), status, details);
    yes.focus();
  }
  function askSignInFirst() { explain({ signIn: true }); }
  // Just signed in from the explanation: the account is now the current one (setAccount runs from the
  // sign-in's own change notice); make sure it can mingle, then turn it on.
  async function afterSignIn() {
    const a = auth.current();
    if (!a) return;
    account = { did: a.did, handle: a.handle };
    if (!canMingleAs(a.did)) { mingling = false; setState('unsupported'); return; }
    if (!auth.coversLounge(a.did, table.id)) { setState('off', "“Daisy lounge” wasn't approved, so mingling stays off."); return; }
    await writeRecord();
  }
  // From the Continue press: a window first if this browser hasn't approved "Daisy lounge" for the account.
  async function turnOn(d, status, yes) {
    if (!auth.coversLounge(account.did, table.id)) {
      const ok = await approve((t) => { status.textContent = t; }, yes);
      if (!ok) return;
    }
    d.close();
    await writeRecord();
  }
  async function approve(say, btn = null) {
    const popup = auth.openWindow();
    if (!popup) { say('The sign-in window was blocked. Allow pop-ups for this page, then try again.'); return false; }
    const ac = new AbortController();
    say(`Approve “Daisy lounge” in the small window from @${account.handle}'s account server…`);
    if (btn) btn.disabled = true;
    try {
      const did = await auth.signIn(account.handle, auth.loungeScopeFor(account.did, table.id), { signal: ac.signal });
      if (did !== account.did) { say(`That was a different account. Approve “Daisy lounge” as @${account.handle}.`); return false; }
      if (!auth.coversLounge(did, table.id)) { say("“Daisy lounge” wasn't approved, so mingling stays off."); return false; }
      say('');
      return true;
    } catch (err) {
      say(err?.message || "Sign-in didn't finish. Try again.");
      return false;
    } finally { if (btn) btn.disabled = false; }
  }
  async function writeRecord() {
    if (!account || !canMingleAs(account.did)) { mingling = false; return setState('unsupported'); }   // never a record the relay would refuse
    try {
      await auth.putRecord(account.did, { collection: L.collection, rkey: 'self', record: { $type: L.collection, createdAt: new Date().toISOString() } });
    } catch (err) {
      console.warn('[raku] lounge record', err);
      return setState('off', err instanceof SignInNeeded ? 'The sign-in ran out. Try again.' : "Couldn't turn mingling on. Try again.");
    }
    mingling = true;
    log({ dir: 'page', from: 'Raku', to: 'your account', kind: 'lounge record', note: 'mingling on' });
    join();
  }
  async function turnOff() {
    sw.disabled = true;
    note('Turning mingling off…');
    leave();
    try {
      if (!auth.coversLounge(account.did, table.id)) throw new SignInNeeded('no lounge sign-in');
      await auth.call(account.did, 'com.atproto.repo.deleteRecord', { body: { repo: account.did, collection: L.collection, rkey: 'self' } });
      mingling = false;
      log({ dir: 'page', from: 'Raku', to: 'your account', kind: 'lounge record', note: 'deleted: mingling off' });
      setState('off');
    } catch (err) {
      console.warn('[raku] lounge off', err);
      setState('needs-signin', `Couldn't delete the lounge record: approve “Daisy lounge” as @${account.handle}, then turn mingling off again.`);
    } finally { sw.disabled = false; }
  }
  async function retry() {
    if (!account) return;
    if (state === 'needs-signin') {
      const ok = await approve(note, retryBtn);
      if (!ok) return;
      if (mingling) join(); else setState('off');
      return;
    }
    join();
  }

  // ---------- the relay's lounge ----------
  function join() {
    if (!account || !mingling || disposed) return;
    if (!url) { setState('unavailable', 'The lounge needs the relay, and this page has none.'); return; }
    clearTimeout(retryTimer);
    leaving = false;
    if (ws) { try { ws.close(); } catch { /* fine */ } }
    setState('joining');
    sentAway = !visible;
    let socket;
    try { socket = new WebSocketImpl(url); } catch { return later(); }
    ws = socket;
    socket.onopen = async () => {
      try {
        const pass = await auth.getPass(account.did, table.id);
        // (away: Daisy's tab is open but not in front: in as a listener, step 5b-2)
        if (ws === socket) { socket.send(JSON.stringify({ type: 'enter', pass, ...(visible ? {} : { away: true }) })); log({ dir: 'page', from: 'Raku', to: 'lounge', kind: visible ? 'enter' : 'enter (away)' }); }
      } catch (err) {
        console.warn('[raku] lounge pass', err);
        if (ws === socket) { leaving = true; socket.close(); }
        setState('needs-signin', `Couldn't get a lounge pass for @${account.handle}: approve “Daisy lounge” again.`);
      }
    };
    socket.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === socket && m && typeof m.type === 'string') onMessage(m); };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (leaving || !mingling || !['joining', 'here', 'away'].includes(state)) return;
      later();
    };
    socket.onerror = () => {};
  }
  function later() {
    const wait = TIMES.reconnect[Math.min(tries, TIMES.reconnect.length - 1)];
    tries++;
    setState('joining', tries > 2 ? "Can't reach the lounge right now. Trying again…" : null);
    retryTimer = setTimeout(join, wait);
  }
  function leave() {
    leaving = true;
    clearTimeout(retryTimer);
    if (ws) { try { ws.close(); } catch { /* fine */ } ws = null; }
    hideKnock();
  }
  const send = (m) => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); log({ dir: 'page', from: 'Raku', to: 'lounge', kind: m.type }); } };

  function onMessage(m) {
    logIn(m);
    switch (m.type) {
      case 'in':
        tries = 0; lastHereSent = Date.now();
        // the tab may have gone behind (or come back) while entering: tell the relay where we are now
        if (sentAway !== !visible) send({ type: visible ? 'back' : 'away' });
        sentAway = !visible;
        setState(visible ? 'here' : 'away');
        break;
      case 'someone': if (!visible) onSignal(true); break;     // step 5b-2: someone arrived (no name)
      case 'stopped': leaving = true; setState('stopped'); break;   // 2 hours away (or too many listening): quietly out
      case 'refused':
        leaving = true;
        if (m.why === 'AccountType') { mingling = false; setState('unsupported'); }
        else if (m.why === 'NoLoungeRecord') { mingling = false; setState('off', 'Your account has no lounge record any more, so mingling is off.'); }
        else if (m.why === 'NotReady') setState('unavailable', "The lounge isn't open right now. Try again later.");
        else setState('needs-signin', "The relay didn't accept this page's lounge pass: approve “Daisy lounge” again.");
        break;
      case 'idle': leaving = true; setState('idle', 'You left the lounge after 10 minutes untouched. Touch the page, or press Rejoin, to come back.'); break;
      case 'replaced': leaving = true; setState('replaced', `@${account.handle} is mingling in another window now.`); break;
      case 'people': showPeople(m); break;
      case 'invited': break;                       // the same answer whatever happens next
      case 'knock': showKnock(m); break;
      case 'knock-gone': if (knock && knock.id === m.id) { hideKnock(); note('That invitation has run out.'); } break;
      case 'table': goToTable(m); break;
      case 'error': if (m.why === 'too many' && m.did) markPerson(m.did, 'Wait a few minutes'); break;   // ("away": a late message; fine)
    }
  }

  // Touching the page keeps you here (the relay leaves you after 10 minutes otherwise); back after idle,
  // the lounge is joined again by itself.
  function touched() {
    if (!visible) return;
    if (state === 'idle' && mingling) { join(); return; }
    if (state === 'here' && Date.now() - lastHereSent > TIMES.hereEvery) { lastHereSent = Date.now(); send({ type: 'here' }); }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, touched, { passive: true });

  // ---------- who else is mingling ----------
  function ask() { whoNote.textContent = 'Looking…'; send({ type: 'who' }); }
  async function showPeople(m) {
    const when = new Date(m.at);
    whoTime.textContent = `As of ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · press again to refresh`;
    people.replaceChildren();
    if (m.problem) { whoNote.textContent = "Couldn't check right now; try again in a moment."; return; }
    if (!m.people.length) { whoNote.textContent = 'Nobody else is mingling here right now. Try again in a while, or open a table and send the link.'; return; }
    whoNote.textContent = '';
    const profiles = await profilesOf(m.people, fetchImpl);
    for (const did of m.people) {
      const p = profiles.get(did) || {};
      const pic = p.avatar ? h('img', { class: 'lounge-pic', src: p.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'lounge-pic' });
      const li = h('li', { class: 'lounge-person', 'data-did': did }, pic,
        h('span', { class: 'lounge-person-words' }, h('span', { class: 'lounge-person-handle' }, p.handle ? `@${p.handle}` : did), h('span', { class: 'lounge-person-name' }, p.name || '')),
        invited.has(did) ? stateTag(invited.get(did).text) : inviteButton(did));
      people.append(li);
    }
  }
  const stateTag = (text) => h('span', { class: 'lounge-person-state' }, text);
  function inviteButton(did) {
    return h('button', { type: 'button', class: 'lounge-invite', onclick: () => {
      send({ type: 'invite', did });
      const entry = { text: 'Invite sent' };
      entry.timer = setTimeout(() => { entry.text = 'No answer'; markPerson(did, 'No answer'); entry.timer = setTimeout(() => { invited.delete(did); markPerson(did, null); }, TIMES.noAnswer); }, TIMES.noAnswer);
      invited.set(did, entry);
      markPerson(did, 'Invite sent');
    } }, 'Invite');
  }
  function markPerson(did, text) {
    const li = [...people.children].find((x) => x.dataset.did === did);
    if (!li) return;
    li.lastElementChild.remove();
    li.append(text ? stateTag(text) : inviteButton(did));
  }

  // ---------- an invitation ----------
  async function showKnock(m) {
    hideKnock();
    const expires = Date.parse(m.expiresAt) || Date.now() + 60000;
    knock = { id: m.id, from: m.from, expires };
    const whoIs = (await profilesOf([m.from], fetchImpl)).get(m.from);
    if (!knock || knock.id !== m.id) return;
    knock.handle = whoIs && whoIs.handle;
    knockText.replaceChildren(h('b', {}, whoIs && whoIs.handle ? `@${whoIs.handle}` : 'Someone'), ' invites you to a game of Daisy.');
    knockCard.hidden = false;
    const left = Math.max(0, expires - Date.now());
    knockBar.style.transition = 'none'; knockBar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => { knockBar.style.transition = `transform ${left}ms linear`; knockBar.style.transform = 'scaleX(0)'; });
    knock.timer = setTimeout(hideKnock, left);
  }
  function hideKnock() { if (knock) clearTimeout(knock.timer); knock = null; knockCard.hidden = true; }
  function play() { if (knock) { send({ type: 'answer', id: knock.id, play: true }); note('Opening the table…'); } }
  // Not now: the relay drops the invitation (so another can arrive) and tells the inviter nothing.
  function notNow() { if (knock) send({ type: 'answer', id: knock.id, play: false }); hideKnock(); }

  // ---------- both said yes ----------
  async function goToTable(m) {
    const other = m.with;
    let handle = knock && knock.from === other ? knock.handle : null;
    if (!handle) { const p = (await profilesOf([other], fetchImpl)).get(other); handle = p && p.handle; }
    const said = m.seat === 1 ? `${handle ? `@${handle}` : 'They'} said yes! Opening the table…` : 'Opening the table…';
    note(said);
    leave();
    for (const e of invited.values()) clearTimeout(e.timer);
    invited.clear();
    onTable({ table: m.table, seat: m.seat, did: account.did, handle: account.handle, said });
  }

  const offAuth = auth.onChange(() => { const c = auth.current(); if ((c && c.did) !== (account && account.did)) setAccount(c); else show(); });
  setAccount(auth.current());

  return {
    // Q51: in the lounge only while Daisy's start screen is the tab in front and Raku can be seen.
    // Step 5b-2: out of sight, the page stays connected as "away" (a listener); in front again, "back".
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      if (on) onSignal(false);                                  // looking now: the mark clears
      if (!account || !mingling) return;
      if (state === 'here' || state === 'away') {
        if (!on) hideKnock();                                   // an invitation on its way lapses
        send({ type: on ? 'back' : 'away' });
        sentAway = !on;
        setState(on ? 'here' : 'away');
        if (on) lastHereSent = Date.now();
      } else if (on && ['stopped', 'idle'].includes(state)) join();
    },
    get state() { return state; }, get mingling() { return mingling; }, get account() { return account; },
    dispose() { disposed = true; leave(); offAuth(); for (const e of invited.values()) clearTimeout(e.timer); for (const ev of ['pointerdown', 'keydown']) removeEventListener(ev, touched); },
  };
}
