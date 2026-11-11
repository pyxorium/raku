// The two panels a heart can open (claude/raku-hearts-plan.md, HT6, HT14; drawn as the approved mockup,
// claude/raku-hearts-mockup.html):
//   "Sign in to heart"        signed out: the sign-in form, the line on Raku's one permission, the promise
//   "Sign in again to heart"  a sign-in from before hearts: approve "Raku" once more, as that account
// Either way, once the sign-in is done the heart is given (onDone(did)), with no second tap. Signing in in this tab
// instead (the small window was blocked) keeps the post to heart for when Raku comes back (keepForReturn, kind 'heart').

import { h } from './cards.js';
import { openDialog, signInForm } from './signin-ui.js';
import { RAKU_SCOPE, SIGNIN_PROMISE, PERMISSION_LINE } from './config.js';

const details = () => h('div', { class: 'rk-details' },
  h('p', {}, 'Your account’s server asks you to approve one permission, ', h('b', {}, 'Raku'), `: ${PERMISSION_LINE}.`),
  h('p', { class: 'rk-promise' }, SIGNIN_PROMISE));

/** host(): where panels go. keepForReturn(info): before signing in in this tab. */
export function createHeartSignIn({ auth, host, keepForReturn = () => {} }) {
  let dialog = null;
  function show(label, parts) {
    if (dialog && !dialog.closed) dialog.close();
    dialog = openDialog(host(), { label });
    dialog.body.replaceChildren(...parts);
    const first = dialog.body.querySelector('input:not([readonly]), button.primary');
    if (first) try { first.focus({ preventScroll: true }); } catch { /* fine */ }
    return dialog;
  }
  const here = (post) => (who, scope) => { keepForReturn({ kind: 'heart', uri: post.uri, cid: post.cid }); return auth.signInHere(who, scope, 'signin'); };

  /** Signed out (HT6). post: { uri, cid }. onDone(did): signed in, give the heart. */
  function signIn(post, onDone) {
    const form = signInForm({
      auth, button: 'Sign in', scope: () => RAKU_SCOPE,
      onDone: (did) => { dialog.close(); onDone(did); },
      goHere: here(post),
      hereNote: 'Other tabs will reload. Raku comes back to this post and gives your heart.',
    });
    show('Sign in to heart', [
      h('h2', {}, 'Sign in to heart'),
      h('p', { class: 'rk-lede' }, 'Hearts are saved in your own account. Sign in with your atproto account; your Bluesky account works.'),
      form.el, details(),
    ]);
  }

  /** A sign-in from before hearts (HT14). account: { did, handle }. onDone(did): approved, give the heart. */
  function again(account, post, onDone) {
    const form = signInForm({
      auth, button: 'Sign in again', scope: () => RAKU_SCOPE, handle: account.handle || account.did, lockHandle: true,
      onDone: (did) => { dialog.close(); onDone(did); },
      goHere: here(post),
      hereNote: 'Other tabs will reload. Raku comes back to this post and gives your heart.',
    });
    show('Sign in again to heart', [
      h('h2', {}, 'Sign in again to heart'),
      h('p', { class: 'rk-lede' }, 'Raku’s permission now includes hearts. Your account’s server asks you to approve it once more; it takes a moment and brings you back here, and your heart is given.'),
      form.el,
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => dialog.close() }, 'Not now')),
      details(),
    ]);
  }

  return { signIn, again, get open() { return !!(dialog && !dialog.closed); } };
}
