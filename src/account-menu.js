// The account menu (stage 4, Q42): a small round avatar (or "Sign in") in the top bar, at the right on a
// computer and between the Raku label and the address on a phone. It opens a menu (a sheet from the
// bottom on a phone): the accounts signed in on this browser with a tick on the current one (choosing one
// switches, no window: Q38), Add another account, the "Saves without asking" choices with Turn off (Q37),
// Raku's sign-in promise (Q43), and Sign out.
import { SIGNIN_PROMISE, TABLES } from './config.js';
import { h } from './cards.js';
import { icon } from './icons.js';
import { signInForm, avatarEl } from './signin-ui.js';

export function createAccountMenu({ auth, moderation, keepForReturn, say }) {
  const button = h('button', { type: 'button', class: 'account-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggle() });
  const panel = h('div', { class: 'account-menu', hidden: true, role: 'dialog', 'aria-label': 'Your accounts' });
  const avatars = new Map();             // did → avatar address (Bluesky's picture server), once known
  let adding = false;

  const avatarOf = (a, cls) => avatarEl(a.handle, avatars.get(a.did), cls);
  function learnAvatar(did) {
    if (avatars.has(did)) return;
    avatars.set(did, null);
    moderation.profile(did).then((prof) => { if (prof.avatar) { avatars.set(did, prof.avatar); draw(); } }).catch(() => {});
  }

  function drawButton() {
    const cur = auth.current();
    if (cur) {
      learnAvatar(cur.did);
      button.replaceChildren(avatarOf(cur, 'acct-av'));
      button.title = `Signed in as @${cur.handle}`;
      button.setAttribute('aria-label', `Your accounts (signed in as @${cur.handle})`);
      button.classList.remove('signed-out');
    } else {
      button.replaceChildren(icon('person', 18), h('span', { class: 'account-signin' }, 'Sign in'));
      button.title = 'Sign in to save match results';
      button.setAttribute('aria-label', 'Sign in');
      button.classList.add('signed-out');
    }
  }

  function form({ label }) {
    return signInForm({
      auth, button: label,
      // A new account asks only for itself; signing in again keeps the games it already allows.
      scope: (who) => auth.scopeFor(auth.didForHandle(who), null),
      onDone: (did) => { adding = false; draw(); const a = auth.current(); if (a && a.did === did) say(`Signed in as @${a.handle}.`); },
      goHere: (who, scope) => { keepForReturn({ kind: 'signin' }); return auth.signInHere(who, scope, 'signin'); },
    });
  }

  function drawPanel() {
    const list = auth.list();
    const head = h('div', { class: 'acct-head' }, h('b', {}, list.length ? 'Signed in on this browser' : 'Sign in to Raku'),
      h('button', { type: 'button', class: 'acct-close', 'aria-label': 'Close', onclick: () => toggle(false) }, icon('close', 16)));
    const parts = [head];
    if (!list.length) {
      const f = form({ label: 'Sign in' });
      parts.push(h('p', { class: 'small' }, 'Browsing never needs a sign-in. Signing in is only for saving match results from the tables.'), f.el,
        h('p', { class: 'rk-promise' }, SIGNIN_PROMISE));
      panel.replaceChildren(...parts);
      return f;
    }
    parts.push(h('ul', { class: 'acct-list' }, ...list.map((a) => {
      learnAvatar(a.did);
      return h('li', {}, h('button', { type: 'button', class: `acct-row${a.current ? ' on' : ''}`, 'aria-current': a.current ? 'true' : null,
        onclick: () => { if (!a.current) { auth.switchTo(a.did); say(`Now using @${a.handle}.`); } } },
      avatarOf(a, 'acct-av'), h('span', { class: 'acct-handle' }, `@${a.handle}`), a.current ? h('span', { class: 'tick', 'aria-label': 'current' }, '✓') : null));
    })));
    let f = null;
    if (adding) { f = form({ label: 'Sign in' }); parts.push(f.el); }
    else parts.push(h('button', { type: 'button', class: 'acct-add', onclick: () => { adding = true; draw(); panel.querySelector('.signin-handle')?.focus(); } }, icon('plus', 16), 'Add another account'));
    const always = auth.accounts.alwaysList();
    if (always.length) {
      parts.push(h('h3', {}, 'Saves without asking'), h('ul', { class: 'acct-always' }, ...always.map((e) => {
        const a = auth.accounts.get(e.did);
        return h('li', {}, h('span', {}, `${TABLES[e.tableId].name} · @${a?.handle || e.did}`),
          h('button', { type: 'button', class: 'linkish', onclick: () => { auth.accounts.setAlways(e.did, e.tableId, false); draw(); say(`${TABLES[e.tableId].name} asks again before saving.`); } }, 'Turn off'));
      })));
    }
    parts.push(h('p', { class: 'rk-promise' }, SIGNIN_PROMISE));
    const cur = auth.current();
    if (cur) parts.push(h('button', { type: 'button', class: 'acct-out', onclick: async () => { const hd = cur.handle; await auth.signOut(cur.did); draw(); say(`Signed out @${hd}.`); } }, `Sign out @${cur.handle}`));
    panel.replaceChildren(...parts);
    return f;
  }

  function draw() {
    drawButton();
    if (!panel.hidden) drawPanel();
  }
  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { adding = false; const f = drawPanel(); (f ? f.input : panel.querySelector('.acct-row'))?.focus(); }
  }
  // Close on a click outside, or Escape.
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); button.focus(); } });
  auth.onChange(() => draw());
  draw();
  return { button, panel, toggle, draw };
}
