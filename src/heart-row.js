// The row at a tile post's foot (claude/raku-hearts-plan.md, HT4, HT5, HT15; as the approved mockup,
// claude/raku-hearts-mockup.html): Bluesky-family slots, as wide as the tile card above. The left group takes 65% of
// the row (HEARTS.left): comment (empty until comments), a spare slot (empty), then the heart and its count, so the
// heart sits a little left of the middle with its count about centred under the tile; Share pinned to the right edge,
// its menu opening leftward. The slots never move with the counts.
//
// The heart (HT4, HT6, HT7, HT10, HT14): an outline heart with its count (no number at zero, none until the pass is
// back); yours filled in Raku's accent, with a small pop when you give it. Tapping shows the change at once and saves
// in the background (hearts.js); a failed save puts it back with "Couldn't save your heart. Try again." Signed out it
// opens "Sign in to heart"; a sign-in from before hearts, "Sign in again to heart"; either way the heart is then given.

import { h } from './cards.js';
import { icon } from './icons.js';
import { HEARTS } from './config.js';

/**
 * post: a readTilePost result ({ uri, cid, … }). share: the Share button (post-share.js). hearts: createHearts().
 * auth: { current(), known(did), coversHearts(did) }. heartSignIn: createHeartSignIn(). → the footer element
 */
export function heartRow({ post, share, hearts, auth, heartSignIn }) {
  const count = h('span', { class: 'ht-count' });
  const btn = h('button', { type: 'button', class: 'ht-btn', 'aria-pressed': 'false' }, icon('heart', 18), count);
  const note = h('p', { class: 'ht-note', role: 'status', hidden: true });
  const row = h('footer', { class: 'post-actions ha-row' },
    h('span', { class: 'ha-slot ha-comment', 'aria-hidden': 'true' }),
    h('span', { class: 'ha-slot ha-spare', 'aria-hidden': 'true' }),
    h('span', { class: 'ha-slot ha-heart' }, btn),
    h('span', { class: 'ha-share' }, share));
  row.style.setProperty('--ha-left', HEARTS.left);
  const wrap = h('div', { class: 'ha-wrap' }, row, note);
  const target = { uri: post.uri, cid: post.cid };
  const canHeart = !!post.cid;
  let noteTimers = [];

  const me = () => { const a = auth.current(); return a && a.did ? a : null; };
  function draw() {
    const a = me();
    const on = !!(a && hearts.hearted(a.did, post.uri));
    const n = hearts.count(post.uri, a ? a.did : null);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('waiting', n === null);
    count.textContent = n ? String(n) : '';
    const words = n ? ` (${n} ${n === 1 ? 'heart' : 'hearts'})` : '';
    btn.setAttribute('aria-label', (on ? 'Remove your heart' : 'Heart this post') + words);
    btn.title = canHeart ? (on ? 'Remove your heart' : 'Heart') : 'This post can’t be hearted';
    btn.disabled = !canHeart;
  }
  function say(words) {
    noteTimers.forEach(clearTimeout);
    note.textContent = words;
    note.hidden = false;
    note.classList.remove('gone');
    noteTimers = [setTimeout(() => note.classList.add('gone'), HEARTS.noteMs), setTimeout(() => { note.hidden = true; }, HEARTS.noteMs + 700)];
  }
  function pop() { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }

  function save(did, want) {
    if (want) pop();
    hearts.set(did, target, want).catch((err) => {
      if (err && err.code === 'scope') { const a = me(); if (a) heartSignIn.again(a, target, (d) => give(d)); return; }
      say(err && err.code === 'signin' ? 'This account is no longer signed in here. Sign in again, then heart.' : 'Couldn’t save your heart. Try again.');
    });
  }
  // After signing in (or in again): give the heart, if the sign-in allows hearts.
  function give(did) {
    if (!auth.coversHearts(did)) { say('“Raku” wasn’t approved, so Raku can’t save hearts.'); return; }
    hearts.readYours(did).catch(() => null).finally(() => { if (!hearts.hearted(did, post.uri)) save(did, true); });
  }
  btn.addEventListener('click', () => {
    if (!canHeart) return;
    const a = me();
    if (!a) { heartSignIn.signIn(target, (did) => give(did)); return; }
    if (auth.known(a.did) && !auth.coversHearts(a.did)) { heartSignIn.again(a, target, (did) => give(did)); return; }
    save(a.did, !hearts.hearted(a.did, post.uri));
  });

  // Redraw on every change while the card is on the page; stop listening once it has gone.
  let seen = false;
  const off = hearts.onChange(() => {
    if (wrap.isConnected) seen = true;
    else if (seen) { off(); return; }
    draw();
  });
  draw();
  return wrap;
}
