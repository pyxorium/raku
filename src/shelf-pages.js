// The Shelf's pages (stage 2, claude/raku-plan.md decisions Q28 to Q30): "Your shelf" (raku:shelf) and an
// account's tiles (raku:tiles/<actor>). Both are pages inside a tab, like the first screen; tiles open
// from their cards in the same tab (Back returns) or, from a card's corner, in a new tab.
//
// Your shelf is this browser's own collection (shelf-store.js): kept accounts in a row, then kept tiles,
// most recently kept first. Each kept tile is looked up again when shown, so its card has the current
// name and picture, or says the tile was deleted by its author, or that it isn't shown in Raku.
// An account's tiles are read live from the account's own server, newest first, 100 at a time.

import { TAKEDOWNS_PAGE, tableForTile } from './config.js';
import { atUri, accountPageUri, SHELF_URI, tableUri } from './address.js';
import { describeTile } from './tiles.js';
import { NetError } from './net.js';
import { h, bannerCid } from './cards.js';
import { exportFileName } from './shelf-store.js';

// A few lookups at a time, so a big shelf doesn't fire hundreds of requests at once.
function limiter(max = 4) {
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < max && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  };
  return (job) => { queue.push(job); pump(); };
}

/** Fills in a kept tile's card from its current record. */
function refreshKeptTile(ctx, card, t, alive) {
  const { resolver, moderation, shelf } = ctx;
  return async () => {
    try {
      if (await moderation.isHidden(t.did, t.rkey)) {
        if (alive()) card.set({ note: "This tile isn't shown in Raku.", greyed: true, description: '' });
        return;
      }
      const [rec, acct] = await Promise.all([resolver.tileRecord(t.did, t.rkey), resolver.account(t.did)]);
      if (!alive()) return;
      const d = describeTile(rec);
      if (!d.ok) { card.set({ note: d.reason, greyed: true }); return; }
      card.set({ name: d.name, description: d.description });
      card.picture({ pds: acct.pds, did: t.did, cid: bannerCid(d.manifest) });
      const handle = await resolver.checkedHandle(t.did);
      if (!alive()) return;
      if (handle) card.set({ by: handle });
      shelf.noteTile(t.did, t.rkey, { name: d.name, by: handle || '' });
    } catch (err) {
      if (!alive()) return;
      if (err instanceof NetError && err.code === 'not-found') card.set({ note: 'This tile was deleted by its author.', greyed: true, description: '' });
      else card.set({ note: "Couldn't reach its server just now." });
    }
  };
}

function keptTileCard(ctx, t, { removable, alive, queue }) {
  const { kit, tabs, tab, openNew, shelf } = ctx;
  // A kept table (its player tile, kept with the star on the table's page) opens the table.
  const table = tableForTile(t.did, t.rkey);
  const uri = table ? tableUri(table.id) : atUri(t.did, t.rkey);
  const card = kit.tileCard({
    name: t.name, by: t.by,
    onOpen: () => tabs.go(tab.id, uri),
    onOpenNew: () => openNew(uri),
    onRemove: removable ? () => { shelf.removeTile(t.did, t.rkey, 'card'); card.el.remove(); ctx.afterRemove?.(); } : null,
  });
  queue(refreshKeptTile(ctx, card, t, alive));
  return card;
}

export function drawYourShelf(ctx) {
  const { p, kit, shelf, tabs, tab, resolver, moderation, say, alive } = ctx;
  p.title = 'Your shelf';
  p.shownAddress = '';
  p.keep = null;
  p.state = 'ready';
  const queue = limiter(4);
  const accounts = shelf.accounts();
  const tiles = shelf.tiles();
  const summary = h('p', { class: 'sub' });
  const countLine = () => {
    const a = shelf.accounts().length;
    const t = shelf.tiles().length;
    summary.textContent = `Kept in this browser only. ${a} account${a === 1 ? '' : 's'}, ${t} tile${t === 1 ? '' : 's'}.`;
  };
  ctx.afterRemove = countLine;
  countLine();

  const page = h('div', { class: 'shelf-page' }, h('h1', {}, 'Your shelf'), summary);
  if (!shelf.saved) {
    page.append(h('p', { class: 'warn' }, "This browser isn't keeping your shelf (a private window, or storage turned off): it lasts for this visit only. Export it to keep a copy."));
  }
  if (!accounts.length && !tiles.length) {
    page.append(h('p', { class: 'empty' }, "Nothing kept yet. Open a tile, or type someone's handle in the address box, and press the star at the end of the address box."));
  }
  if (accounts.length) {
    const row = h('div', { class: 'chips' });
    page.append(h('h2', {}, 'Accounts'), row);
    for (const a of accounts) {
      const chip = kit.accountChip({
        handle: a.handle, did: a.did,
        onOpen: () => tabs.go(tab.id, accountPageUri(a.handle || a.did)),
        onRemove: () => { shelf.removeAccount(a.did, 'card'); chip.el.remove(); countLine(); },
      });
      row.append(chip.el);
      queue(async () => {
        const [prof, handle] = await Promise.all([moderation.profile(a.did), resolver.checkedHandle(a.did)]);
        if (!alive()) return;
        chip.set({ handle, avatar: prof.avatar });
        try { const n = await resolver.countTiles(a.did); if (alive()) chip.set({ count: n }); } catch { /* no count */ }
      });
    }
  }
  if (tiles.length) {
    const grid = h('div', { class: 'cards' });
    page.append(h('h2', {}, 'Tiles'), grid);
    for (const t of tiles) grid.append(keptTileCard(ctx, t, { removable: true, alive, queue }).el);
  }

  // Export and Import: a small file, so your shelf can move to another browser or device.
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { say("That file is too large to be a Raku shelf."); return; }
    let data = null;
    try { data = JSON.parse(await f.text()); } catch { data = null; }
    const r = data && shelf.importData(data);
    if (!r) { say("That file isn't a Raku shelf (made with Export)."); return; }
    const parts = [];
    if (r.accounts) parts.push(`${r.accounts} account${r.accounts === 1 ? '' : 's'}`);
    if (r.tiles) parts.push(`${r.tiles} tile${r.tiles === 1 ? '' : 's'}`);
    say(parts.length ? `Added ${parts.join(' and ')} to your shelf${r.skipped ? ` (${r.skipped} skipped)` : ''}.` : `Nothing new: everything in that file is already on your shelf${r.skipped ? ` (${r.skipped} skipped)` : ''}.`);
  });
  const exportIt = () => {
    const blob = new Blob([JSON.stringify(shelf.exportData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: exportFileName() });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  page.append(h('div', { class: 'shelf-tools' },
    h('button', { type: 'button', onclick: exportIt }, 'Export'),
    h('button', { type: 'button', onclick: () => file.click() }, 'Import'),
    file,
    h('span', { class: 'small' }, 'Export saves your shelf as a small file; Import adds one to your shelf (nothing is removed).')));
  p.el.append(page);
}

export async function drawAccountTiles(ctx, actor) {
  const { p, kit, tabs, tab, resolver, moderation, openNew, status, alive, drawChrome } = ctx;
  p.title = `@${actor.replace(/^did:[a-z]+:/, 'did:…')}'s tiles`;
  p.shownAddress = actor.startsWith('did:') ? actor : `@${actor}`;
  p.keep = null;
  p.state = 'finding';
  drawChrome();
  status('loading', 'Finding this account…');
  let did;
  try {
    did = await resolver.didFor(actor);
    if (!alive()) return;
    if (await moderation.isAccountHidden(did)) {
      if (!alive()) return;
      p.state = 'hidden';
      p.title = 'Not shown';
      drawChrome();
      status('hidden', "These tiles aren't shown in Raku.",
        h('a', { href: TAKEDOWNS_PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Reporting and takedowns ↗'));
      return;
    }
    await resolver.account(did);
  } catch (err) {
    if (!alive()) return;
    p.state = 'error';
    status('error', err instanceof NetError ? err.message : "Couldn't find this account.");
    return;
  }
  const [handle, prof] = await Promise.all([resolver.checkedHandle(did), moderation.profile(did)]);
  if (!alive()) return;
  const who = handle ? `@${handle}` : did;
  p.title = `${who}'s tiles`;
  p.shownAddress = handle ? `@${handle}` : did;
  p.keep = { kind: 'account', did, handle: handle || '' };
  p.state = 'ready';
  drawChrome();
  ctx.hideStatus();

  const grid = h('div', { class: 'cards' });
  const more = h('button', { type: 'button', class: 'more', hidden: true }, 'More');
  const sub = h('p', { class: 'sub' }, prof.displayName || '');
  const head = h('div', { class: 'account-head' },
    prof.avatar ? h('img', { class: 'account-av', src: prof.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'account-av' }),
    h('div', {}, h('h1', {}, `${who}'s tiles`), sub));
  const empty = h('p', { class: 'empty', hidden: true }, 'No tiles yet.');
  p.el.append(h('div', { class: 'shelf-page' }, head, grid, empty, more));

  let cursor = null;
  let shown = 0;
  async function page() {
    more.disabled = true;
    more.textContent = 'Loading…';
    try {
      const res = await resolver.listTiles(did, cursor);
      if (!alive()) return;
      const acct = await resolver.account(did);
      for (const rec of res.records) {
        if (await moderation.onHideList(did, rec.rkey)) continue;
        if (!alive()) return;
        const d = describeTile(rec);
        const uri = atUri(did, rec.rkey);
        const name = d.ok ? d.name : (typeof rec.value?.name === 'string' ? rec.value.name.slice(0, 120) : rec.rkey);
        const card = kit.tileCard({
          name, description: d.ok ? d.description : '',
          note: d.ok ? '' : d.reason,
          greyed: !d.ok,
          onOpen: () => tabs.go(tab.id, uri),
          onOpenNew: () => openNew(uri),
        });
        if (d.ok) card.picture({ pds: acct.pds, did, cid: bannerCid(d.manifest) });
        grid.append(card.el);
        shown++;
      }
      cursor = res.cursor;
      empty.hidden = shown > 0 || !!cursor;
    } catch (err) {
      if (!alive()) return;
      ctx.say(err instanceof NetError ? err.message : "Couldn't list this account's tiles.");
    }
    more.hidden = !cursor;
    more.disabled = false;
    more.textContent = 'More';
  }
  more.addEventListener('click', page);
  await page();
}

/** The first screen's "From your shelf": the latest few kept tiles, and a way to the whole shelf. */
export function drawShelfTeaser(ctx, into, count = 6) {
  const { shelf, tabs, tab, alive } = ctx;
  const tiles = shelf.tiles().slice(0, count);
  if (!tiles.length) return;
  const queue = limiter(3);
  const grid = h('div', { class: 'cards kept' });
  for (const t of tiles) grid.append(keptTileCard(ctx, t, { removable: false, alive, queue }).el);
  into.append(h('h2', {}, 'From your shelf'), grid,
    h('button', { type: 'button', class: 'more', onclick: () => tabs.go(tab.id, SHELF_URI) }, 'See all on your shelf'));
}
