// The post box and "Write a post" (claude/raku-write-posts-plan.md, WP8 to WP13; the approved mockup
// claude/raku-write-posts-mockup.html). Raku's own dialog over the tab (signin-ui.js openDialog), outside every tile:
//   - openForTile(tile): the post box for a tile of one of your signed-in accounts (WP1), from its tab's Post button;
//   - openWrite(): from Tile posts' "Write a post": signed out, "Sign in to post" first; then your accounts' tiles,
//     newest first, by account (WP13); choosing one opens the same post box, with "Your tiles" to go back.
// The box (WP9): the tile, Your words (300, counted by graphemes), More (alt text, the tile's description as the grey
// hint; a language box), From (your signed-in accounts, starting on the tile's own, WP2), Post to Raku. After posting
// (WP10) it becomes a note and you stay where you are; the post is added to Tile posts straight away.
import { SIGNIN_PROMISE, RAKU_SCOPE, PERMISSION_LINE } from './config.js';
import { h, bannerCid } from './cards.js';
import { icon } from './icons.js';
import { openDialog, signInForm, blockedBox } from './signin-ui.js';
import { buildPostRecord, writePost, fromChoices, canPostTile, yourTiles, graphemeCount, POST_LIMITS } from './tile-post-write.js';
import { describeTile } from './tiles.js';

export const POST_HELP = 'Share it in Tile posts, where people can play it right in the post. A few words, or just the tile.';
export const READBACK_WARNING = 'Raku couldn’t check the post afterwards. It may still have been posted; look in Tile posts before trying again.';

const at = (handle) => (String(handle).startsWith('did:') ? handle : `@${handle}`);

/**
 * host(): the element the dialog covers (Raku's stage). kit: the card kit (pictures). tilePosts: Discover's Tile posts
 * (add). onSeePosts(): opens Tile posts. keepForReturn(info): "Sign in in this tab instead".
 */
export function createPostBox({ auth, resolver, moderation, kit, tilePosts, host, say = () => {}, keepForReturn = () => {}, onSeePosts = () => {}, onAfterPost = () => {} }) {
  let dialog = null;
  let postedHere = false;        // a post was written in this dialog: when it closes, Tile posts (if in front) is drawn again

  function show(label, parts) {
    if (!dialog || dialog.closed) {
      postedHere = false;
      // Escape closes the box wherever the focus is (a button that was busy may have let it go), as long as no small
      // sign-in window is being waited on (its Cancel is the way out then).
      const onKey = (e) => { if (e.key === 'Escape' && dialog && !dialog.closed && !dialog.body.querySelector('button.primary:disabled')) { e.stopPropagation(); dialog.close(); } };
      document.addEventListener('keydown', onKey);
      dialog = openDialog(host(), { label, onClose: () => { document.removeEventListener('keydown', onKey); if (postedHere) { postedHere = false; onAfterPost(); } } });
    }
    dialog.box.setAttribute('aria-label', label);
    dialog.body.replaceChildren(...parts.filter(Boolean));
    const first = dialog.body.querySelector('textarea, input, button.wp-row, button.primary');
    if (first) try { first.focus({ preventScroll: true }); } catch { /* fine */ }
    return dialog;
  }
  const btn = (label, onclick, cls = '') => h('button', { type: 'button', class: cls, onclick }, label);
  const actions = (...b) => h('div', { class: 'actions' }, ...b);

  /** A tile ready to post: { did, rkey, uri, cid, name, description, manifest, by } (by: a handle, when known). */
  async function tileFrom(did, rkey) {
    const rec = await resolver.tileRecord(did, rkey);
    const d = describeTile(rec);
    if (!d.ok) throw new Error(d.reason);
    const by = await resolver.checkedHandle(did).catch(() => null);
    return { did, rkey, uri: rec.uri, cid: rec.cid, name: d.name, description: d.description, manifest: d.manifest, by: by || did };
  }

  function tileLine(t) {
    const pic = h('div', { class: 'wp-tile-pic' });
    resolver.account(t.did).then((acct) => { const cid = bannerCid(t.manifest); if (cid) kit.picture(pic, { pds: acct.pds, did: t.did, cid }); }).catch(() => {});
    return h('div', { class: 'wp-tile' }, pic,
      h('div', { class: 'wp-tile-words' }, h('span', { class: 'wp-tile-name' }, t.name), h('span', { class: 'wp-tile-by' }, `by ${at(t.by)}`)));
  }

  // ---------- the post box (WP9) ----------
  function postForm(t, { back = null, words = {} } = {}) {
    const accounts = auth.list();
    if (!canPostTile(t.did, accounts)) {
      show('Post this tile', [h('h2', {}, 'Post this tile'), h('p', {}, "Only tiles from your accounts signed in on this browser can be posted from Raku."), actions(btn('Close', () => dialog.close(), 'primary'))]);
      return;
    }
    const choices = fromChoices(t.did, accounts);
    const count = h('span', { class: 'wp-count', 'aria-live': 'polite' });
    const text = h('textarea', { class: 'wp-words', id: 'wp-words', placeholder: 'Say something about it (optional)' });
    text.value = words.text || '';
    const alt = h('textarea', { class: 'wp-alt', id: 'wp-alt', placeholder: t.description || '' });
    alt.value = words.alt || '';
    const lang = h('input', { class: 'wp-lang', id: 'wp-lang', placeholder: 'e.g. en', spellcheck: 'false', autocapitalize: 'off' });
    lang.value = words.lang || '';
    const more = h('details', { class: 'wp-more' }, h('summary', {}, 'More'), h('div', { class: 'wp-more-body' },
      h('div', {}, h('label', { class: 'wp-label', for: 'wp-alt' }, h('span', {}, 'Alt text: what the tile is and does')), alt),
      h('div', {}, h('label', { class: 'wp-label', for: 'wp-lang' }, h('span', {}, 'Language')), lang)));
    if (words.alt || words.lang) more.open = true;
    const from = h('select', { id: 'wp-from' }, ...choices.map((a) => h('option', { value: a.did }, `${at(a.handle)}${a.did === t.did ? ' (the tile’s account)' : ''}`)));
    if (words.from && choices.some((a) => a.did === words.from)) from.value = words.from;
    const warn = h('div', {});
    const status = h('p', { class: 'rk-status', role: 'status', 'aria-live': 'polite' });
    const blocked = h('div', {});
    const post = btn('Post to Raku', () => go(), 'primary');
    const cancel = btn('Cancel', () => dialog.close());
    const fields = [text, alt, lang, from];
    const busy = (on) => { for (const f of fields) f.disabled = on; cancel.disabled = on; post.disabled = on || graphemeCount(text.value.trim()) > POST_LIMITS.text[0]; post.textContent = on ? 'Posting…' : 'Post to Raku'; };
    const recount = () => {
      const n = graphemeCount(text.value.trim());
      count.textContent = `${n} / ${POST_LIMITS.text[0]}`;
      count.classList.toggle('over', n > POST_LIMITS.text[0]);
      post.disabled = n > POST_LIMITS.text[0];
    };
    text.addEventListener('input', recount);
    recount();
    const kept = () => ({ text: text.value, alt: alt.value, lang: lang.value, from: from.value });

    async function go() {
      status.textContent = '';
      warn.replaceChildren();
      blocked.replaceChildren();
      const made = buildPostRecord({ tile: { uri: t.uri, cid: t.cid }, text: text.value, alt: alt.value, langs: lang.value });
      if (!made.ok) { status.textContent = made.why; return; }
      const who = choices.find((a) => a.did === from.value) || choices[0];
      // This sign-in doesn't (yet) allow posting (a refused or older grant): "Raku" again, from this click.
      if (auth.known(who.did) && !auth.coversPosts(who.did)) {
        const popup = auth.openWindow();
        if (!popup) {
          blocked.replaceChildren(blockedBox({
            onRetry: () => go(),
            onHere: () => { keepForReturn({ kind: 'signin' }); auth.signInHere(who.handle.includes('.') ? who.handle : who.did, RAKU_SCOPE, 'signin').catch((err) => { status.textContent = `Couldn't sign in: ${err.message}`; }); },
            hereNote: 'Other tabs will reload, and your words here are not kept.',
          }));
          return;
        }
        const waiting = new AbortController();
        status.replaceChildren(`Approve “Raku” in the small window from ${at(who.handle)}’s account server… `, h('button', { type: 'button', class: 'linkish', onclick: () => waiting.abort() }, 'Cancel'));
        busy(true);
        try {
          const did = await auth.signIn(who.handle.includes('.') ? who.handle : who.did, RAKU_SCOPE, { signal: waiting.signal });
          if (did !== who.did) { busy(false); status.textContent = `That was a different account. Approve “Raku” as ${at(who.handle)}.`; return; }
        } catch (err) { busy(false); status.textContent = err?.message || "Couldn't sign in."; return; }
        if (!auth.coversPosts(who.did)) { busy(false); status.textContent = '“Raku” wasn’t approved, so Raku can’t post.'; return; }
      }
      busy(true);
      try {
        const r = await writePost({ auth, resolver, did: who.did, record: made.record });
        if (r.post) tilePosts.add(r.post);
        postedHere = true;
        posted(r, who, back);
      } catch (err) {
        busy(false);
        if (err && err.code === 'verify') { warn.replaceChildren(h('p', { class: 'wp-warn' }, READBACK_WARNING)); return; }
        if (err && err.code === 'signin') { status.textContent = err.message; return; }
        status.textContent = err && err.message ? `${err.message}${err.code === 'write' ? ' Your words are kept; press Post to Raku to try again.' : ''}` : "Couldn't post.";
      }
    }

    show('Post this tile', [
      back ? h('button', { type: 'button', class: 'wp-back', onclick: () => back(kept()) }, icon('back', 16), 'Your tiles') : null,
      h('h2', {}, 'Post this tile'),
      h('p', { class: 'wp-help' }, POST_HELP),
      tileLine(t),
      h('label', { class: 'wp-label', for: 'wp-words' }, h('span', {}, 'Your words'), count),
      text, more,
      h('div', { class: 'wp-from' }, h('label', { for: 'wp-from' }, 'From'), from, h('span', { class: 'small' }, 'Your accounts signed in on this browser.')),
      warn, blocked, status,
      actions(post, cancel),
    ]);
  }

  function posted(r, who, back) {
    const addr = h('code', {}, r.uri);
    const copy = btn('Copy', async () => { try { await navigator.clipboard.writeText(r.uri); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; } });
    show('Posted', [
      h('h2', {}, 'Post this tile'),
      h('div', { class: 'wp-done' },
        h('p', {}, h('b', {}, 'Posted to Tile posts.'), ' It shows there now; other people see it within a few minutes.'),
        h('div', { class: 'wp-addr' }, addr, copy)),
      actions(btn('See it in Tile posts', () => { postedHere = false; dialog.close(); onSeePosts(); }, 'primary'), btn('Close', () => dialog.close())),
    ]);
    say(`Posted to Tile posts from ${at(who.handle)}.`);
  }

  // ---------- Write a post (WP8 C, WP13) ----------
  function signInFirst() {
    const form = signInForm({
      auth, button: 'Sign in',
      scope: () => RAKU_SCOPE,
      onDone: () => pick(),
      goHere: (who, scope) => { keepForReturn({ kind: 'signin' }); return auth.signInHere(who, scope, 'signin'); },
      hereNote: 'Other tabs will reload. Press Write a post again once you’re back.',
    });
    show('Sign in to post', [
      h('h2', {}, 'Sign in to post'),
      h('p', { class: 'rk-lede' }, 'Tile posts are saved in your own account. Sign in with the account your tiles are in; you can add more accounts later.'),
      form.el,
      h('div', { class: 'rk-details' },
        h('p', {}, 'Your account’s server asks you to approve one permission, ', h('b', {}, 'Raku'), `: ${PERMISSION_LINE}.`),
        h('p', { class: 'rk-promise' }, SIGNIN_PROMISE)),
    ]);
  }

  async function pick(words = null) {
    const accounts = auth.list();
    if (!accounts.length) { signInFirst(); return; }
    const list = h('div', { class: 'wp-pick' }, h('p', { class: 'rk-status' }, 'Finding your tiles…'));
    show('Write a post', [
      h('h2', {}, 'Write a post'),
      h('p', { class: 'wp-help' }, 'Choose one of your tiles. Tiles from your accounts signed in on this browser, newest first.'),
      list,
      h('p', { class: 'small wp-more-accounts' }, 'Another account’s tiles? Add it from the account menu.'),
    ]);
    const mine = dialog;
    const groups = await yourTiles({ accounts, resolver, moderation });
    if (mine.closed) return;
    const parts = [];
    for (const g of groups) {
      parts.push(h('h3', { class: 'wp-acct' }, at(g.handle)));
      if (g.error) { parts.push(h('p', { class: 'small' }, g.error)); continue; }
      if (!g.tiles.length) { parts.push(h('p', { class: 'small' }, 'No tiles yet.')); continue; }
      const ul = h('ul', { class: 'wp-list' });
      for (const tile of g.tiles) {
        const pic = h('span', { class: 'wp-row-pic' });
        const d = describeTile(tile.record);
        resolver.account(tile.did).then((acct) => { const cid = bannerCid(d.manifest); if (cid) kit.picture(pic, { pds: acct.pds, did: tile.did, cid }); }).catch(() => {});
        const when = tile.time ? new Date(tile.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        ul.append(h('li', {}, h('button', { type: 'button', class: 'wp-row', 'data-tile': tile.uri, onclick: () => {
          postForm({ did: tile.did, rkey: tile.rkey, uri: tile.uri, cid: tile.cid, name: tile.name, description: d.description, manifest: d.manifest, by: g.handle },
            { back: (kept) => pick(kept), words: words || {} });
        } }, pic, h('span', { class: 'wp-row-words' }, h('span', { class: 'wp-row-name' }, tile.name), h('span', { class: 'wp-row-when' }, when ? `Published ${when}` : '')))));
      }
      parts.push(ul);
    }
    list.replaceChildren(...parts);
  }

  return {
    /** From a tile's tab (WP8 A). tile: { did, rkey } (the rest is read again, so the version is the current one). */
    async openForTile({ did, rkey }) {
      try { postForm(await tileFrom(did, rkey)); } catch (err) { say(`Couldn't open the post box: ${err.message || err}`); }
    },
    /** From Tile posts (WP8 C). */
    openWrite() { if (auth.list().length) pick(); else signInFirst(); },
    get open() { return !!dialog && !dialog.closed; },
  };
}
