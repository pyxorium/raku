// The pieces Raku draws for signing in (stage 4): a dialog over a table, the sign-in form, and what shows
// when the sign-in window is blocked (Q41). All of it is Raku's own page, outside every tile, so no tile
// can draw a fake one.
import { h } from './cards.js';
import { icon } from './icons.js';
import { cleanHandle, SignInStopped } from './auth.js';
import { attachTypeahead } from './typeahead.js';

/** A dialog over `host` (a table's area). → { box, body, close() } */
export function openDialog(host, { label, onClose } = {}) {
  const body = h('div', { class: 'rk-dialog-body' });
  const closeBtn = h('button', { type: 'button', class: 'rk-dialog-x', 'aria-label': 'Close', onclick: () => close() }, icon('close', 18));
  const box = h('div', { class: 'rk-dialog-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || 'Raku' }, closeBtn, body);
  const el = h('div', { class: 'rk-dialog', onclick: (e) => { if (e.target === el) close(); } }, box);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  el.addEventListener('keydown', onKey);
  host.append(el);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    onClose?.();
  }
  return { el, box, body, close, get closed() { return closed; } };
}

/** "The sign-in window was blocked." with Try again and Sign in in this tab instead. */
export function blockedBox({ onRetry, onHere, hereNote = 'Other tabs will reload.' }) {
  return h('div', { class: 'signin-blocked', role: 'alert' },
    h('p', {}, h('b', {}, 'The sign-in window was blocked.'), ' Allow pop-ups for this page and try again, or sign in in this tab.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'primary', onclick: onRetry }, 'Try again'),
      h('button', { type: 'button', onclick: onHere }, 'Sign in in this tab instead')),
    h('p', { class: 'small' }, hereNote));
}

let formCount = 0;
/**
 * The sign-in form: a handle box (with suggestions), a button, and the blocked-window choices.
 *   scope(who): the permissions to ask for, decided at the click (who = the cleaned handle or DID);
 *   onDone(did): signed in;
 *   goHere(who, scope): "Sign in in this tab instead" (the caller keeps what it needs first).
 */
export function signInForm({ auth, scope, button = 'Sign in', handle = '', lockHandle = false, onDone, goHere, hereNote }) {
  const id = `rk-signin-${++formCount}`;
  const input = h('input', {
    class: 'signin-handle', type: 'text', id, name: 'handle', spellcheck: 'false', autocomplete: 'username',
    autocapitalize: 'off', placeholder: 'yourname.bsky.social', 'aria-label': 'Your handle',
  });
  input.value = handle;
  if (lockHandle) input.readOnly = true;
  const go = h('button', { type: 'submit', class: 'primary' }, button);
  // While the small window is open: Cancel ends the wait (Raku can't tell whether that window is still open).
  let waiting = null;
  const cancel = h('button', { type: 'button', class: 'signin-cancel', hidden: true, onclick: () => waiting?.abort() }, 'Cancel');
  const row = h('div', { class: 'signin-row' }, input, go, cancel);
  const status = h('p', { class: 'signin-status', role: 'status', 'aria-live': 'polite' });
  const blockedHolder = h('div', {});
  const form = h('form', { class: 'signin-form', onsubmit: (e) => { e.preventDefault(); start(); } },
    h('label', { for: id }, 'Your handle'), row, status, blockedHolder);
  if (!lockHandle) attachTypeahead(input, row, { id: `${id}-ta`, onChoose: (hd) => { input.value = hd; } });

  const who = () => cleanHandle(input.value);
  function busy(on) { go.disabled = on; input.disabled = on && !lockHandle; cancel.hidden = !on; }

  // From the click: the window opens first, before anything that waits.
  async function start() {
    const w = who();
    if (!w) { status.textContent = 'Type your handle, for example alice.bsky.social.'; input.focus(); return; }
    blockedHolder.replaceChildren();
    const popup = auth.openWindow();
    if (!popup) {
      status.textContent = '';
      blockedHolder.replaceChildren(blockedBox({ onRetry: () => start(), onHere: () => here(), hereNote }));
      return;
    }
    waiting = new AbortController();
    busy(true);
    status.textContent = 'Finish signing in in the small window…';
    try {
      const did = await auth.signIn(w, scope(w), { signal: waiting.signal });
      status.textContent = '';
      onDone?.(did);
    } catch (err) {
      status.textContent = err instanceof SignInStopped ? err.message : `Couldn't sign in: ${err?.message || err}`;
      try { popup.close(); } catch { /* fine */ }
    } finally {
      waiting = null;
      busy(false);
    }
  }

  async function here() {
    const w = who();
    if (!w) return;
    status.textContent = 'Going to your account server…';
    try { await goHere(w, scope(w)); } catch (err) { status.textContent = `Couldn't sign in: ${err?.message || err}`; }
  }

  return { el: form, input, focus: () => input.focus(), start };
}

/** A round avatar (from Bluesky's picture server) or the account's first letter. */
export function avatarEl(handle, avatar, cls = 'acct-av') {
  if (avatar && avatar.startsWith('https://cdn.bsky.app/')) return h('img', { class: cls, src: avatar, alt: '', referrerpolicy: 'no-referrer' });
  return h('span', { class: `${cls} acct-letter`, 'aria-hidden': 'true' }, (String(handle || '?').replace(/^did:[a-z]+:/, '')[0] || '?').toUpperCase());
}
