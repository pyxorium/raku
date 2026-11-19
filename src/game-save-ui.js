// Saving a game's record (claude/cosmic-junkyard-v2-plan.md, CJ2-10, CJ2-11): Raku's own prompt, drawn outside the tile,
// so a game can't fake it or skip it. Adapted from the tables' prompt (src/tables/saving.js), with the game's own:
//   - the record is the one game-saves.js decided (the game's fields, checked; the game's address and the version that
//     ran, filled in by Raku), shown under "What will be saved";
//   - Allow once / Always / No, Always per account and game in this browser (the account menu's "Saves without asking"
//     turns it off); every save says "Saved to @x" with a link to the record;
//   - signed out: the prompt signs you in first; signed in with a sign-in from before this game's runs joined "Raku":
//     Allow once and Always open one short Authorize first;
//   - "Use another account";
//   - a blocked sign-in window offers Try again only in effect: signing in in this tab reloads it, and the run would go
//     with the tile (it lives in the tile until it is saved), so the box says so.
// tell(state, extra) answers the tile: 'asking', 'saving', then 'saved' ({ uri, handle }) or one of 'declined', 'failed'.
// host: where the prompt goes (a tab's pane); wide: over Raku's whole window instead (a game in a tile post, PG2:
// claude/raku-play-here-games-plan.md), the post dimmed behind with the rest of the page; onClosed(): after it closes.
import { SIGNIN_PROMISE, recordLink } from './config.js';
import { SignInNeeded } from './auth.js';
import { h } from './cards.js';
import { openDialog, signInForm, blockedBox } from './signin-ui.js';
import { newTid } from './tables/daisy-shared/tid.js';
import { describeRun } from './game-saves.js';

const at = (hd) => `@${hd}`;

export function createGameSaver({ auth, host, wide = false, onClosed = () => {}, say = () => {}, newKey = () => newTid() }) {
  let dialog = null;
  let job = null;                       // { game, record, tell, done }

  const details = (record) => h('details', { class: 'rk-record' }, h('summary', {}, 'What will be saved'), h('pre', {}, JSON.stringify(record, null, 2)));
  const actions = (...b) => h('div', { class: 'actions' }, ...b);
  const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: cls, onclick }, label);

  function show(build) {
    if (!dialog || dialog.closed) {
      dialog = openDialog(host, { label: `Save this ${job.game.name} ${job.game.what}`, cls: wide ? 'rk-wide' : '',
        onClose: () => { const j = job; job = null; if (j && !j.done) { j.done = true; j.tell('declined'); } onClosed(); } });
    }
    dialog.body.replaceChildren(...build().filter(Boolean));
    dialog.body.querySelector('button.primary, input:not([readonly])')?.focus();
  }
  const finish = (state, extra) => { if (job && !job.done) { job.done = true; job.tell(state, extra); } };

  /** A game asked to save this record (already decided by game-saves.js). */
  async function request({ game, record, tell }) {
    if (job && !job.done) { tell('failed'); return; }          // (one at a time: game-saves' budget already sees to it)
    job = { game, record, tell, done: false };
    let cur = auth.current();
    // Just after Raku opened, the current account's sign-in may still be coming back: wait for it, so the prompt knows
    // whether this game is already allowed.
    if (cur && !auth.known(cur.did)) {
      tell('asking');
      await auth.whenReady();
      await auth.restore(cur.did);
      cur = auth.current();
    }
    if (cur && auth.accounts.hasAlways(cur.did, game.id) && auth.coversGame(cur.did, game.id)) { save(cur, { auto: true }); return; }
    tell('asking');
    if (!cur) askSignIn(); else ask(cur);
  }

  function askSignIn({ reason = '', notice = '' } = {}) {
    const { game } = job;
    const form = signInForm({
      auth, button: 'Sign in',
      scope: (who) => auth.scopeFor(auth.didForHandle(who), game.id),
      onDone: () => ask(auth.current(), { notice: `Signed in as ${at(auth.current().handle)}.` }),
      goHere: (who, scope) => auth.signInHere(who, scope, 'game-save'),
      hereNote: `Other tabs will reload, and this ${game.what} won't be kept: it lives in the game until it's saved.`,
    });
    show(() => [
      h('h2', {}, `Save this ${game.name} ${game.what}?`),
      notice ? h('p', { class: 'rk-notice' }, notice) : null,
      h('p', { class: 'rk-lede' }, reason || 'Sign in to save it to your account.'),
      form.el,
      actions(btn('Not now', () => dialog.close())),
      h('div', { class: 'rk-details' }, h('p', { class: 'rk-promise' }, SIGNIN_PROMISE), details({ ...job.record })),
    ]);
  }

  function ask(account, { notice = '' } = {}) {
    const { game, record } = job;
    const covered = auth.coversGame(account.did, game.id);
    const status = h('p', { class: 'rk-status', role: 'status', 'aria-live': 'polite' });
    const blockedHolder = h('div', {});
    const others = auth.list().filter((a) => a.did !== account.did);
    const go = async (always) => {
      blockedHolder.replaceChildren();
      let who = account;
      if (!auth.coversGame(account.did, game.id)) {
        // One short Authorize for the "Raku" set, from this click (the window opens first).
        const popup = auth.openWindow();
        if (!popup) {
          blockedHolder.replaceChildren(blockedBox({
            onRetry: () => go(always),
            onHere: () => { auth.signInHere(account.handle.includes('.') ? account.handle : account.did, auth.scopeFor(account.did, game.id), 'game-save').catch((err) => { status.textContent = `Couldn't sign in: ${err.message}`; }); },
            hereNote: `Other tabs will reload, and this ${game.what} won't be kept: allow pop-ups and try again to save it.`,
          }));
          return;
        }
        const waiting = new AbortController();
        status.replaceChildren('Approve “Raku” in the small window… ', h('button', { type: 'button', class: 'linkish', onclick: () => waiting.abort() }, 'Cancel'));
        setBusy(true);
        try {
          const did = await auth.signIn(account.handle.includes('.') ? account.handle : account.did, auth.scopeFor(account.did, game.id), { signal: waiting.signal });
          if (did !== account.did) { setBusy(false); ask(auth.current(), { notice: `Signed in as ${at(auth.current().handle)}.` }); return; }
          who = auth.current();
        } catch (err) {
          setBusy(false);
          status.textContent = err?.message || "Couldn't sign in.";
          return;
        }
        if (!auth.coversGame(account.did, game.id)) { setBusy(false); status.textContent = `“Raku” wasn't approved, so Raku can't save this ${game.what}.`; return; }
      }
      if (always) auth.accounts.setAlways(who.did, game.id, true);
      save(who, { status, setBusy });
    };
    const yes = btn('Allow once', () => go(false), 'primary');
    const all = btn('Always', () => go(true));
    all.title = `Save ${at(account.handle)}'s ${game.name} ${game.what}s without asking, in this browser`;
    const no = btn('No', () => dialog.close());
    const setBusy = (on) => { yes.disabled = all.disabled = on; };
    show(() => [
      h('h2', {}, `Save this ${game.what} to ${at(account.handle)}?`),
      notice ? h('p', { class: 'rk-notice' }, notice) : null,
      h('p', {}, `This adds a public record to ${at(account.handle)}'s account (a ${game.name} ${game.what} record and nothing else). ${describeRun(record)}`),
      covered ? null : h('p', { class: 'rk-ask' }, 'This sign-in needs “Raku” approved again: a small window from your account server opens when you save.'),
      details(record),
      h('p', { class: 'rk-other' }, h('button', { type: 'button', class: 'linkish', onclick: () => choose(account) }, others.length ? 'Use another account' : 'Use another account (sign in)')),
      blockedHolder, status,
      actions(yes, all, no),
      h('p', { class: 'small' }, `"Always" saves ${game.name} ${game.what}s for this account without asking, in this browser only. Turn it off in the account menu.`),
    ]);
  }

  function choose(account) {
    const rows = auth.list().map((a) => h('li', {},
      h('button', { type: 'button', class: `acct-row${a.did === account.did ? ' on' : ''}`, onclick: () => { auth.switchTo(a.did); ask(auth.current()); } },
        h('span', {}, at(a.handle)), a.did === account.did ? h('span', { class: 'tick', 'aria-label': 'current' }, '✓') : null)));
    show(() => [
      h('h2', {}, 'Save to which account?'),
      h('ul', { class: 'acct-list' }, ...rows),
      actions(btn('Add another account', () => askSignIn()), btn('Back', () => ask(auth.current() || account))),
    ]);
  }

  async function save(account, { auto = false, status = null, setBusy = () => {} } = {}) {
    const j = job;
    const { game, record } = j;
    j.tell('saving');
    if (status) status.textContent = 'Saving…';
    setBusy(true);
    try {
      const { uri } = await auth.putRecord(account.did, { collection: game.collection, rkey: newKey(), record });
      if (job !== j) return;
      finish('saved', { uri, handle: account.handle });
      const link = uri ? h('a', { href: recordLink(uri), target: '_blank', rel: 'noopener noreferrer' }, 'See the record ↗') : null;
      if (auto) say(`Saved to ${at(account.handle)} without asking (you chose Always for ${game.name}; turn it off in the account menu).`);
      else if (dialog && !dialog.closed) {
        show(() => [h('h2', {}, `${game.name} ${game.what} saved`), h('p', { class: 'rk-saved' }, `Saved to ${at(account.handle)}. `, link), actions(btn('Close', () => dialog.close(), 'primary'))]);
      }
    } catch (err) {
      setBusy(false);
      if (job !== j) return;
      if (err instanceof SignInNeeded) {
        j.tell('asking');
        askSignIn({ reason: `${at(account.handle)}'s sign-in has run out. Sign in again to save; the ${game.what} is kept until the game closes.` });
      } else if (err?.code === 'scope') {
        j.tell('asking');
        ask(account, { notice: err.message });
      } else {
        console.error(`[raku] ${game.id} save failed`, err);
        if (auto || !dialog || dialog.closed) { finish('failed'); if (auto) say(`Couldn't save the ${game.name} ${game.what}. Try again.`); }
        else { j.tell('asking'); status.textContent = "Couldn't save. Try again."; }
      }
    }
  }

  return {
    request,
    /** The tile went (closed, reloaded): its question goes too, without answering it. */
    dispose() { if (job) job.done = true; job = null; if (dialog && !dialog.closed) dialog.close(); },
    get busy() { return !!job && !job.done; },
  };
}
