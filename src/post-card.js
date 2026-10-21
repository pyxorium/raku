// A post drawn as a card (stage 6, Tile news): plain text and pictures only, drawn by Raku from the post's
// data (posts.js); nothing from a post ever runs. A post page or thread may reuse this later.
//
//   - the author: avatar (Bluesky's picture server only), name, @handle, how long ago;
//   - the text: links open through the link message (a link to a tile opens the tile in Raku), mentions
//     open that account's tiles in Raku, hashtags are plain;
//   - pictures: thumbnails, blurred behind "Show pictures" when labelled adult or graphic;
//   - a tile (a link to a tile, as the link card or in the text): a tile card that opens the tile in Raku, its latest
//     version (Q92), with "Changed since the post" when the post named an older version;
//   - another link card: opens through the link message; a quoted post or a video: a line saying so;
//   - "Open post" (in the app chosen for posts, Bluesky by default) through the link message.
//   - a reply (Q97): drawn like the Bluesky app does in a feed (threadCard): the thread's first post, the post it
//     answers ("…" between when posts were skipped), then the reply, joined by a line; "Open thread in <app>".

import { h, bannerCid } from './cards.js';
import { icon } from './icons.js';
import { ago } from './posts.js';
import { parseAddress, parsePost } from './address.js';
import { describeTile } from './tiles.js';

/**
 * ctx: { kit, resolver, moderation, linkMessage, app (the post app), openTile(uri), openAccount(did), from (a short
 * line for the link message) } → the card element
 */
export function postCard(post, ctx, { context = false, thread = false } = {}) {
  // context: drawn above a reply as its thread (no footer); thread: the reply at the bottom of a thread
  const { linkMessage, app } = ctx;
  const who = post.author.handle || post.author.did;
  const from = (what) => `${what} by ${post.author.handle ? `@${post.author.handle}` : 'an account'}${ctx.from ? ` in ${ctx.from}` : ''}.`;
  const goLink = (url) => {
    const tile = parseAddress(url);
    if (tile.ok) { ctx.openTile(tile.uri); return; }
    const p = parsePost(url);
    if (p && p.ok) { linkMessage.show({ post: { actor: p.actor, rkey: p.rkey }, from: from('A link in a post') }); return; }
    linkMessage.show({ url, from: from('A link in a post') });
  };

  const av = h('span', { class: 'post-av' }, post.author.avatar ? h('img', { src: post.author.avatar, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null);
  const head = h('header', { class: 'post-head' },
    h('button', { type: 'button', class: 'post-who', title: `@${who}'s tiles in Raku`, onclick: () => ctx.openAccount(post.author.did) },
      av,
      h('span', { class: 'post-names' },
        post.author.displayName ? h('span', { class: 'post-name' }, post.author.displayName) : null,
        h('span', { class: 'post-handle' }, post.author.handle ? `@${post.author.handle}` : post.author.did))),
    h('span', { class: 'post-time', title: post.createdAt || '' }, ago(post.createdAt)));

  const text = h('p', { class: 'post-text' });
  for (const s of post.segments) {
    if (s.link) text.append(h('button', { type: 'button', class: 'post-link', title: s.link, onclick: () => goLink(s.link) }, s.text));
    else if (s.mention) text.append(h('button', { type: 'button', class: 'post-link', title: 'Their tiles in Raku', onclick: () => ctx.openAccount(s.mention) }, s.text));
    else if (s.tag) text.append(h('span', { class: 'post-tag' }, s.text));
    else text.append(document.createTextNode(s.text));
  }

  const body = h('div', { class: 'post-body' }, text.childNodes.length ? text : null);

  if (post.images.length) {
    const grid = h('div', { class: `post-pics n${post.images.length}${post.moderation.blurMedia ? ' blurred' : ''}` },
      post.images.map((i) => h('img', { src: i.thumb, alt: i.alt || '', title: i.alt || '', referrerpolicy: 'no-referrer', loading: 'lazy' })));
    body.append(grid);
    if (post.moderation.blurMedia) {
      const show = h('button', { type: 'button', class: 'post-show', onclick: () => { grid.classList.remove('blurred'); show.remove(); } }, 'Show pictures');
      grid.append(show);
    }
  }

  if (post.tile) body.append(tileInPost(post, ctx));
  else if (post.external) {
    const e = post.external;
    let host = '';
    try { host = new URL(e.uri).hostname.replace(/^www\./, ''); } catch { /* fine */ }
    body.append(h('button', { type: 'button', class: 'post-ext', onclick: () => goLink(e.uri) },
      e.thumb && !post.moderation.blurMedia ? h('img', { src: e.thumb, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null,
      h('span', { class: 'post-ext-words' },
        h('span', { class: 'post-ext-host' }, host),
        e.title ? h('span', { class: 'post-ext-title' }, e.title) : null,
        e.description ? h('span', { class: 'post-ext-desc' }, e.description) : null)));
  }
  if (post.quote) {
    body.append(h('button', { type: 'button', class: 'post-quote', onclick: () => linkMessage.show({ post: { actor: post.quote.handle || post.quote.actor, rkey: post.quote.rkey }, from: from('A post quoted') }) },
      h('span', { class: 'post-quote-who' }, `Quoting ${post.quote.handle ? `@${post.quote.handle}` : 'a post'}`),
      post.quote.text ? h('span', { class: 'post-quote-text' }, post.quote.text) : null));
  }
  if (post.video) body.append(h('p', { class: 'post-note' }, 'This post has a video. Open the post to watch it.'));

  const foot = context ? null : h('footer', { class: 'post-foot' },
    h('button', { type: 'button', class: 'post-open', onclick: () => linkMessage.show({ post: { actor: who, rkey: post.rkey }, from: from(thread ? 'A thread' : 'A post') }) },
      `Open ${thread ? 'thread' : 'post'} in `, h('span', { class: 'post-app-name' }, app.name), icon('newtab', 14)));
  // A reply drawn on its own (its thread wasn't sent with it): say so.
  if (!context && !thread && post.replyTo) body.prepend(h('p', { class: 'post-note' }, 'A reply. Open the thread to see the conversation.'));

  const card = h('article', { class: `post${context ? ' ctx' : ''}`, 'data-uri': post.uri }, head);
  if (post.moderation.warn) {
    const veil = h('div', { class: 'post-warn' }, h('p', {}, 'This post has a content warning.'),
      h('button', { type: 'button', onclick: () => { veil.replaceWith(body); } }, 'Show post'));
    card.append(veil);
  } else card.append(body);
  if (foot) card.append(foot);
  return card;
}

/** A post that can't be shown (deleted, blocked, or hidden by moderation), in a reply's thread. */
function unavailable(uri) {
  return h('article', { class: 'post ctx gone', 'data-uri': uri || '' }, h('p', {}, 'Post not available.'));
}

/**
 * A reply with its thread (Q97), as the Bluesky app shows it in a feed: the first post, the post it answers
 * (with "…" when posts in between are skipped), then the reply. context: posts.js threadContext().
 */
export function threadCard(post, context, ctx) {
  const box = h('div', { class: 'post-thread', 'data-uri': post.uri });
  const add = (p) => box.append(p.unavailable ? unavailable(p.uri) : postCard(p, ctx, { context: true }));
  if (context.root) add(context.root);
  if (context.gap) box.append(h('div', { class: 'post-gap', title: 'Some replies in between are not shown' }, h('span', { class: 'post-gap-dots' }, '⋮'), 'More replies in between'));
  if (context.parent) add(context.parent);
  box.append(postCard(post, ctx, { thread: true }));
  return box;
}

/** The tile a post names, as a tile card (looked up from its author's own server; nothing runs). */
function tileInPost(post, ctx) {
  const { kit, resolver, moderation } = ctx;
  const t = post.tile;
  const ext = post.external;
  const card = kit.tileCard({
    name: ext?.title || 'A web tile', description: ext?.description || '',
    onOpen: () => ctx.openTile(t.uri), onOpenNew: ctx.openTileNew ? () => ctx.openTileNew(t.uri) : null,
  });
  card.el.classList.add('post-tile');
  (async () => {
    const did = await resolver.didFor(t.actor);
    if (await moderation.isHidden(did, t.rkey)) { card.set({ name: 'A tile', description: '', note: "This tile isn't shown in Raku.", greyed: true }); return; }
    const [rec, acct] = await Promise.all([resolver.tileRecord(did, t.rkey), resolver.account(did)]);
    const d = describeTile(rec);
    if (!d.ok) { card.set({ note: d.reason, greyed: true }); return; }
    const changed = t.cid && rec.cid && t.cid !== rec.cid;
    card.set({ name: d.name, description: d.description, note: changed ? 'Changed since the post (Raku opens the latest).' : '' });
    card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
    resolver.checkedHandle(did).then((hd) => card.set({ by: hd || '' }));
  })().catch((err) => {
    if (err && err.code === 'not-found') card.set({ note: 'This tile was deleted by its author.', greyed: true });
    else card.set({ note: "Couldn't reach the tile's server just now." });
  });
  return card.el;
}

