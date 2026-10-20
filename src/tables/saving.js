// Saving a match (stage 4, claude/raku-stage4-plan.md): Raku's own prompt, drawn outside the tiles, so a
// tile can't fake it or skip it. Adapted from the save prompts of the site's Seven-Up and Daisy pages
// (src/sevenup/table.js, src/daisy/table.js: COPY of their wording and steps, Oct 20 2026), with Raku's:
//   - only the house's result is saved (the referee's, never what a player tile says), made into the
//     game's own record (sevenup-record.js / daisy-record.js, copies of the games' recordFor and
//     checkRecord), stamped with the pinned house tile's { uri, cid }, and checked before saving;
//   - your seat in the record is the account you save to: Raku seats you as "you" or as the account
//     current when the table opened, and the record names the account the prompt names;
//   - Allow once / Always / No (Q37: Always = this game and this account, in this browser); every save
//     says "Saved to @x" with a link to the record, Always or not;
//   - signed out: the prompt signs you in first (Q35), asking for your account and this game's set (Q36);
//     signed in without this game's set: Allow once and Always open one short Authorize first;
//   - "Use another account" (Q38); the blocked window's "Sign in in this tab instead" (Q41) keeps the
//     match for the trip (keepForReturn) and the prompt comes back after it (reopen).
import { SIGNIN_PROMISE, BOT, recordLink } from '../config.js';
import { SignInNeeded } from '../auth.js';
import { h } from '../cards.js';
import { openDialog, signInForm, blockedBox } from '../signin-ui.js';

/** The house's result with your seat as the given account. */
export function withSeat(result, seat, account) {
  const r = structuredClone(result);
  r.players = r.players.map((p, i) => (i === seat - 1 ? { ...p, did: account.did, handle: account.handle } : p));
  return r;
}

/** The record for this account, or { problem }. */
export function makeRecord(kit, table, result, seat, account) {
  const record = kit.recordFor(withSeat(result, seat, account), seat, table.house);
  const problem = kit.checkRecord(record);
  return problem ? { problem, record } : { record };
}

export function createSaver({ table, kit, auth, host, notify, keepForReturn, onSaved = () => {} }) {
  const saved = new Map();              // matchId → { uri, handle }
  let dialog = null;

  const at = (hd) => `@${hd}`;
  const otherIs = (result, seat) => result.players[seat === 1 ? 1 : 0];
  const text = (account, result, seat) => {
    const other = otherIs(result, seat);
    const first = `This adds a public record to ${at(account.handle)}'s account (a ${table.name} match record and nothing else). `;
    const mention = other.bot || other.did === BOT.did ? `It names ${at(other.handle)}, the table's bot, which played the other seat from this page.` : `It mentions ${at(other.handle)}, who played the other seat.`;
    const dice = table.id === 'daisy' ? " Both players' dice came from this page, so the record shows how the match went, but nobody else can check the dice." : '';
    return first + mention + dice;
  };
  const details = (record) => h('details', { class: 'rk-record' }, h('summary', {}, 'What will be saved'), h('pre', {}, JSON.stringify(record, null, 2)));
  const actions = (...b) => h('div', { class: 'actions' }, ...b);
  const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: cls, onclick }, label);

  function show(build) {
    if (!dialog || dialog.closed) dialog = openDialog(host, { label: `Save this ${table.name} match`, onClose: () => { if (current) current.onClose?.(); current = null; } });
    dialog.body.replaceChildren(...build().filter(Boolean));
    const f = dialog.body.querySelector('button.primary, input:not([readonly])');
    f?.focus();
  }
  let current = null;                   // { result, seat, tell, onClose }

  /** A seat asked to save (the tile's Save). tell(state, extra) answers the tile. */
  async function request({ result, seat, tell = () => {} }) {
    if (!result) return tell('failed');
    const done = saved.get(result.matchId);
    if (done) return tell('saved', { handle: done.handle });
    let cur = auth.current();
    // Just after Raku opened, the current account's sign-in may still be coming back: wait for it, so the
    // prompt knows whether this game is already allowed (and an expired one is noticed now).
    if (cur && !auth.known(cur.did)) {
      tell('asking');
      await auth.whenReady();
      await auth.restore(cur.did);
      cur = auth.current();
    }
    if (cur && auth.accounts.hasAlways(cur.did, table.id) && auth.covers(cur.did, table.id)) {
      const made = makeRecord(kit, table, result, seat, cur);
      if (!made.problem) return save(cur, made.record, { result, seat, tell }, { auto: true });
    }
    open({ result, seat, tell });
  }

  /** After "Sign in in this tab instead": the prompt again, for the match kept for the trip. */
  function reopen({ result, seat }) {
    open({ result, seat, tell: () => {} }, { notice: auth.current() ? `Signed in as ${at(auth.current().handle)}.` : '' });
  }

  // The job the dialog is about; closing the dialog without saving tells the tile "declined".
  function ensureJob(job) {
    if (dialog && !dialog.closed && current) return;
    current = { ...job, onClose: () => { if (!saved.has(job.result.matchId)) job.tell('declined'); } };
  }
  function open(job, { notice = '' } = {}) {
    ensureJob(job);
    job.tell('asking');
    const cur = auth.current();
    if (!cur) askSignIn(job, { notice });
    else ask(cur, job, { notice });
  }

  // Signed out (or the sign-in ran out): sign in first, then the prompt for that account.
  function askSignIn(job, { handle = '', reason = '', notice = '' } = {}) {
    const preview = kit.recordFor(withSeat(job.result, job.seat, { did: 'did:…:your-account', handle: 'your.handle' }), job.seat, table.house);
    const form = signInForm({
      auth, handle, button: 'Sign in',
      scope: (who) => auth.scopeFor(auth.didForHandle(who), table.id),
      onDone: () => ask(auth.current(), job, { notice: `Signed in as ${at(auth.current().handle)}.` }),
      goHere: (who, scope) => { keepForReturn({ kind: 'save', table: table.id, result: job.result, seat: job.seat }); return auth.signInHere(who, scope, 'save'); },
      hereNote: 'Other tabs will reload. This match is kept, and this question comes back after you sign in.',
    });
    show(() => [
      h('h2', {}, `Save this ${table.name} match?`),
      notice ? h('p', { class: 'rk-notice' }, notice) : null,
      h('p', {}, reason || 'Sign in to save it to your account.'),
      h('p', { class: 'rk-promise' }, SIGNIN_PROMISE),
      form.el,
      details(preview),
      actions(btn('Not now', () => dialog.close())),
    ]);
  }

  function ask(account, job, { notice = '' } = {}) {
    const made = makeRecord(kit, table, job.result, job.seat, account);
    if (made.problem) {
      console.error(`[raku] ${table.id} record problem`, made.problem, made.record);
      job.tell('failed');
      show(() => [h('h2', {}, "This match can't be saved"),
        h('p', {}, `Raku couldn't make a proper ${table.name} record of this match (${made.problem}), so it won't save it.`),
        actions(btn('Close', () => dialog.close()))]);
      return;
    }
    const covered = auth.covers(account.did, table.id);
    const status = h('p', { class: 'rk-status', role: 'status', 'aria-live': 'polite' });
    const blockedHolder = h('div', {});
    const others = auth.list().filter((a) => a.did !== account.did);
    const go = async (always) => {
      blockedHolder.replaceChildren();
      let who = account;
      if (!auth.covers(account.did, table.id)) {
        // One short Authorize for this game's set, from this click (the window opens first).
        const popup = auth.openWindow();
        if (!popup) {
          blockedHolder.replaceChildren(blockedBox({
            onRetry: () => go(always),
            onHere: () => { keepForReturn({ kind: 'save', table: table.id, result: job.result, seat: job.seat }); auth.signInHere(account.handle.includes('.') ? account.handle : account.did, auth.scopeFor(account.did, table.id), 'save').catch((err) => { status.textContent = `Couldn't sign in: ${err.message}`; }); },
            hereNote: 'Other tabs will reload. This match is kept, and this question comes back after you sign in.',
          }));
          return;
        }
        const waiting = new AbortController();
        status.replaceChildren(`Approve ${table.name}'s permission in the small window… `,
          h('button', { type: 'button', class: 'linkish', onclick: () => waiting.abort() }, 'Cancel'));
        setBusy(true);
        try {
          const did = await auth.signIn(account.handle.includes('.') ? account.handle : account.did, auth.scopeFor(account.did, table.id), { signal: waiting.signal });
          if (did !== account.did) { setBusy(false); ask(auth.current(), job, { notice: `Signed in as ${at(auth.current().handle)}.` }); return; }
          who = auth.current();
        } catch (err) {
          setBusy(false);
          status.textContent = err?.message || "Couldn't sign in.";
          return;
        }
        if (!auth.covers(account.did, table.id)) { setBusy(false); status.textContent = `${table.name}'s permission wasn't given, so Raku can't save this match.`; return; }
      }
      if (always) auth.accounts.setAlways(who.did, table.id, true);
      save(who, made.record, job, { status, setBusy });
    };
    const yes = btn('Allow once', () => go(false), 'primary');
    const all = btn('Always', () => go(true));
    all.title = `Save ${at(account.handle)}'s ${table.name} matches without asking, in this browser`;
    const no = btn('No', () => dialog.close());
    const setBusy = (on) => { yes.disabled = all.disabled = on; };
    show(() => [
      h('h2', {}, `Save this match to ${at(account.handle)}?`),
      notice ? h('p', { class: 'rk-notice' }, notice) : null,
      h('p', {}, text(account, job.result, job.seat)),
      covered ? null : h('p', { class: 'rk-ask' }, `${table.name} asks for its own permission the first time you save: a small window from your account server opens to approve it.`),
      details(made.record),
      h('p', { class: 'rk-other' }, h('button', { type: 'button', class: 'linkish', onclick: () => choose(account, job) }, others.length ? 'Use another account' : 'Use another account (sign in)')),
      blockedHolder, status,
      actions(yes, all, no),
      h('p', { class: 'small' }, '"Always" saves this game\'s matches for this account without asking, in this browser only. Turn it off in the account menu.'),
    ]);
  }

  function choose(account, job) {
    const rows = auth.list().map((a) => h('li', {},
      h('button', { type: 'button', class: `acct-row${a.did === account.did ? ' on' : ''}`, onclick: () => { auth.switchTo(a.did); ask(auth.current(), job); } },
        h('span', {}, at(a.handle)), a.did === account.did ? h('span', { class: 'tick', 'aria-label': 'current' }, '✓') : null)));
    show(() => [
      h('h2', {}, 'Save to which account?'),
      h('ul', { class: 'acct-list' }, ...rows),
      actions(btn('Add another account', () => askSignIn(job)), btn('Back', () => ask(auth.current() || account, job))),
    ]);
  }

  async function save(account, record, job, { auto = false, status = null, setBusy = () => {} } = {}) {
    job.tell('saving');
    if (status) status.textContent = 'Saving…';
    setBusy(true);
    try {
      const { uri } = await auth.putRecord(account.did, { collection: table.collection, rkey: record.matchId, record });
      saved.set(record.matchId, { uri, handle: account.handle });
      job.tell('saved', { handle: account.handle });
      const link = uri ? h('a', { href: recordLink(uri), target: '_blank', rel: 'noopener noreferrer' }, 'See the record ↗') : null;
      if (auto) {
        notify([`Saved to ${at(account.handle)} without asking (you chose Always for ${table.name}). `, link, ' ',
          h('button', { type: 'button', class: 'linkish', onclick: (e) => { auth.accounts.setAlways(account.did, table.id, false); e.target.replaceWith('Always is off: the next save asks.'); } }, 'Turn off Always')]);
      } else if (dialog && !dialog.closed) {
        show(() => [h('h2', {}, 'Match saved'), h('p', { class: 'rk-saved' }, `Saved to ${at(account.handle)}. `, link), actions(btn('Close', () => dialog.close(), 'primary'))]);
        notify([`Saved to ${at(account.handle)}. `, link ? link.cloneNode(true) : null]);
      }
      onSaved(account);
    } catch (err) {
      setBusy(false);
      const fresh = !dialog || dialog.closed;
      ensureJob(job);
      if (err instanceof SignInNeeded) {
        job.tell('signin');
        askSignIn(job, { handle: account.handle, reason: `${at(account.handle)}'s sign-in has run out. Sign in again to save; the match is kept until this page closes.` });
      } else if (err?.code === 'scope') {
        job.tell('asking');
        ask(account, job, { notice: err.message });
      } else {
        console.error(`[raku] ${table.id} save failed`, err);
        job.tell('failed');
        if (fresh || !status) ask(account, job, { notice: "Couldn't save. Try again." });
        else status.textContent = "Couldn't save. Try again.";
      }
    }
  }

  return {
    request, reopen,
    isSaved: (matchId) => saved.has(matchId),
    savedFor: (matchId) => saved.get(matchId) || null,
    dispose() { if (dialog && !dialog.closed) { current = null; dialog.close(); } },
  };
}
