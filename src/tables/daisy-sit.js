// Signing in to sit at a Daisy table with someone else (stage 5, Q46): the other player should see a real,
// checked handle, the relay keeps each seat for an account, and the match record names both players, as
// on the Daisy page. Playing the bot needs no sign-in.
//
// The account that sits is the current account (the account menu switches it), with Daisy's permission
// set ("Play Daisy", the same one saving asks for). sitAs(...) is called straight from a button press:
//   - the current account's sign-in already covers Daisy → straight on, no window;
//   - signed in, but without "Play Daisy" → one short Authorize in a small window (from the press);
//   - Raku still checking the sign-in it remembers → wait for it, then decide (a window then needs a press
//     in the dialog, as browsers only open windows from a press);
//   - signed out → Raku's dialog with the sign-in form (your account plus "Play Daisy").
import { h } from '../cards.js';
import { openDialog, signInForm, blockedBox } from '../signin-ui.js';
import { SIGNIN_PROMISE } from '../config.js';

// The relay takes a handle of plain letters, digits, dots and dashes (it's what the other player sees).
export const seatHandleOk = (handle) => typeof handle === 'string' && handle.length <= 253 && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(handle);

/**
 * Finds the account to sit as, then onReady({ did, handle }).
 *   host: where Raku's dialog goes (the table's area); say(text): a short line for problems;
 *   keepForReturn(info): before "Sign in in this tab instead" (the tab comes back to this screen).
 */
export function sitAs({ auth, table, host, say = () => {}, keepForReturn = () => {}, onReady, purpose = 'sit' }) {
  const id = table.id;
  const done = (acct) => {
    if (!acct) return;
    if (!seatHandleOk(acct.handle)) { say(`Raku couldn't check @${acct.handle}'s handle just now, so it can't seat you. Try again in a moment.`); return; }
    onReady({ did: acct.did, handle: acct.handle });
  };
  const cur = auth.current();
  if (cur && auth.covers(cur.did, id)) {
    // Covered (known): make sure the sign-in itself is still good (no window needed for that).
    auth.restore(cur.did).then((ok) => (ok ? done(auth.current()) : ask()));
    return;
  }
  if (cur && auth.known(cur.did)) return authorize(cur, { fromPress: true });
  if (cur) {
    say(`Checking @${cur.handle}'s sign-in…`);
    Promise.resolve(auth.whenReady()).then(() => auth.restore(cur.did)).then(() => {
      say('');
      const now = auth.current();
      if (now && auth.covers(now.did, id)) return done(now);
      ask();
    });
    return;
  }
  ask();

  // One short Authorize for "Play Daisy" for an account already signed in. Only straight from a press.
  function authorize(acct, { fromPress, d = null, status = null } = {}) {
    if (!fromPress) return ask();
    const popup = auth.openWindow();
    if (!popup) {
      const dlg = d || dialog();
      dlg.body.replaceChildren(heading(), h('p', {}, intro()), blockedBox({
        onRetry: () => authorize(acct, { fromPress: true, d: dlg }),
        onHere: () => { keepForReturn({ kind: 'sit', table: id }); auth.signInHere(acct.handle, auth.scopeFor(acct.did, id), 'sit').catch((err) => say(`Couldn't sign in: ${err.message}`)); },
        hereNote: 'Other tabs will reload, and this screen comes back: press the button again to sit.',
      }));
      return;
    }
    const ac = new AbortController();
    const line = status || ((t) => say(t));
    line(`Approve "Play ${table.name}" in the small window from @${acct.handle}'s account server…`);
    auth.signIn(acct.handle, auth.scopeFor(acct.did, id), { signal: ac.signal })
      .then((did) => {
        line('');
        const now = auth.current();
        if (!now || now.did !== did || !auth.covers(did, id)) { line(`"Play ${table.name}" wasn't approved, so Raku can't seat you.`); return; }
        d?.close();
        done(now);
      })
      .catch((err) => line(err?.message || "Couldn't sign in."));
  }

  function dialog() { return openDialog(host, { label: purpose === 'sit' ? 'Sign in to sit at the table' : 'Sign in to open a table' }); }
  function heading() { return h('h2', {}, purpose === 'open' ? 'Sign in to open a table' : 'Sign in to take a seat'); }
  function intro() {
    return `Playing someone else needs a sign-in, so they see your real, checked handle (playing the bot doesn't). The first time, your account server asks you to approve "Play ${table.name}": saving the ${table.name} matches you finish, and nothing else.`;
  }

  // The dialog: "Continue as @x" for the current account (when it needs Daisy's permission), or the form.
  function ask() {
    const d = dialog();
    const status = h('p', { class: 'rk-status', role: 'status', 'aria-live': 'polite' });
    const now = auth.current();
    const form = signInForm({
      auth, button: 'Sign in',
      scope: (who) => auth.scopeFor(auth.didForHandle(who), id),
      onDone: () => {
        const a = auth.current();
        if (!a || !auth.covers(a.did, id)) { status.textContent = `"Play ${table.name}" wasn't approved, so Raku can't seat you.`; return; }
        d.close();
        done(a);
      },
      goHere: (who, scope) => { keepForReturn({ kind: 'sit', table: id }); return auth.signInHere(who, scope, 'sit'); },
      hereNote: 'Other tabs will reload, and this screen comes back: press the button again to sit.',
    });
    const parts = [heading(), h('p', {}, intro()), h('p', { class: 'rk-promise' }, SIGNIN_PROMISE)];
    if (now) {
      const go = h('button', { type: 'button', class: 'primary', onclick: () => authorize(auth.current() || now, { fromPress: true, d, status: (t) => { status.textContent = t; } }) }, `Continue as @${now.handle}`);
      parts.push(h('div', { class: 'actions' }, go), status, h('p', { class: 'small' }, 'Or sign in with another account:'), form.el);
    } else {
      parts.push(form.el, status);
    }
    parts.push(h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => d.close() }, 'Not now')));
    d.body.replaceChildren(...parts);
    (now ? d.body.querySelector('button.primary') : form.input)?.focus();
  }
}
