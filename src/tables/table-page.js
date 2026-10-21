// A table inside a tab (stage 3, claude/raku-plan.md section 12): the table's bar (its name, how it's
// going, who you're signed in as, the Messages button), a note line (problems, what was saved), the
// game's own driver (sevenup.js, daisy.js) and the message panel. Since stage 4 also saving (saving.js):
// "Sign in to save matches" in the bar (Q35), the seat line "@x ✓ · 3 matches saved", Raku's own prompt.
// Since stage 5 Daisy has three screens (Q47): its start screen (raku:table/daisy, daisy-start.js), the bot
// (raku:table/daisy/bot, daisy.js) and a table across two computers (raku:table/daisy/<id>, daisy-online.js).
//
// The message panel (decision 12, every tab): what passes between the house, the seats and Raku, newest
// at the bottom; ping, pong and other frequent messages are left out, as on the games' own pages. On a
// computer it's a strip along the right of the tab; on a phone a sheet from the bottom. Ordinary tiles
// get the same panel for what they ask of Raku (app.js).
import { TABLES, SIGNIN_PROMISE } from '../config.js';
import { h } from '../cards.js';
import { icon } from '../icons.js';
import { mountSevenUp } from './sevenup.js';
import { mountDaisy } from './daisy.js';
import { mountDaisyOnline } from './daisy-online.js';
import { mountDaisyStart } from './daisy-start.js';
import { createSaver } from './saving.js';
import * as sevenupRecord from './sevenup-record.js';
import * as daisyRecord from './daisy-record.js';
import { openDialog, signInForm } from '../signin-ui.js';

const DRIVERS = { sevenup: mountSevenUp, daisy: mountDaisy };
// Which screen a table address shows: the driver, the bar's first status and the footer's words.
function screenFor(id, sub) {
  if (id !== 'daisy') return sub ? null : { mount: DRIVERS[id], mode: 'bot', status: 'You and the bot', foot: "You play the table's bot here. Signed in, you can save your matches to your own account." };
  if (!sub) return { mount: mountDaisyStart, mode: 'start', status: 'Choose how to play', foot: 'Play the bot here with no sign-in, or open a table for a friend on another computer.' };
  if (sub === 'bot') return { mount: mountDaisy, mode: 'bot', status: 'You and the bot', foot: "You play the table's bot here. Signed in, you can save your matches to your own account." };
  return { mount: mountDaisyOnline, mode: 'online', status: 'A table for two computers', foot: 'Two computers, one table: your house and the other player\'s each run on their own page and talk through Daisy\'s relay, which passes messages and stores nothing. Anyone can re-check the dice from a saved match.' };
}
const RECORDS = { sevenup: sevenupRecord, daisy: daisyRecord };

/** A message panel for one tab. → { el, button, log(entry), count } */
export function createPanel({ label = 'Messages' } = {}) {
  const list = h('ol', { class: 'panel-list' });
  const empty = h('p', { class: 'panel-empty' }, 'Nothing yet.');
  const countEl = h('span', { class: 'panel-count' }, '0');
  const panel = h('aside', { class: 'panel', hidden: true, 'aria-label': label },
    h('div', { class: 'panel-head' }, h('b', {}, label),
      h('button', { type: 'button', class: 'panel-close', 'aria-label': 'Close the messages', onclick: () => toggle(false) }, icon('close', 16))),
    empty, list);
  const button = h('button', { type: 'button', class: 'panel-btn', 'aria-expanded': 'false', onclick: () => toggle(panel.hidden) }, 'Messages ', countEl);
  const t0 = performance.now();
  let n = 0;
  function toggle(open) { panel.hidden = !open; button.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) list.scrollTop = list.scrollHeight; }
  function log(e) {
    const time = ((performance.now() - t0) / 1000).toFixed(1).padStart(6, ' ');
    const text = e.dir === 'drop'
      ? `${time}  ✕ ${e.from || '?'} ${e.kind ?? '?'} refused: ${e.why}`
      : `${time}  ${e.from || '?'} → ${e.to || 'Raku'}  ${e.kind || ''}${e.note ? `: ${e.note}` : ''}${e.bytes > 1000 ? `  (${(e.bytes / 1024).toFixed(1)} KB)` : ''}`;
    const li = h('li', { class: e.dir === 'drop' ? 'drop' : '' }, text);
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    list.append(li);
    while (list.children.length > 500) list.firstChild.remove();
    empty.hidden = true;
    countEl.textContent = String(++n);
    if (atEnd && !panel.hidden) list.scrollTop = list.scrollHeight;   // (not scrollIntoView: that would scroll the tab too)
  }
  return { el: panel, button, log, toggle, get count() { return n; } };
}

/** Draws a table in a pane. → { dispose } or null for an unknown table (or screen). */
export function drawTable(ctx, id, sub = null) {
  const { p, mothership, resolver, fetchImpl, auth, keepForReturn, pending, go = () => {}, say = () => {}, loc, WebSocketImpl, keepStore } = ctx;
  const table = TABLES[id];
  const screen = table && DRIVERS[id] ? screenFor(id, sub) : null;
  if (!screen) return null;
  const statusLine = h('span', { class: 'table-status' }, screen.status);
  const noteText = h('p', {});
  const noteRetry = h('button', { type: 'button', hidden: true }, 'Try again');
  const note = h('div', { class: 'table-note', hidden: true, role: 'status' }, noteText, noteRetry);
  const panel = createPanel({ label: `What passes between ${table.name}'s tiles` });
  const root = h('div', { class: `table-root table-${id}`, 'data-mode': screen.mode });
  const accountLine = h('span', { class: 'table-account' });
  const savedLine = h('div', { class: 'table-saved', hidden: true, role: 'status', 'aria-live': 'polite' });
  const page = h('div', { class: 'table-page' },
    h('div', { class: 'table-bar' }, h('h1', {}, table.name), statusLine, accountLine, h('span', { class: 'spacer' }), panel.button),
    note, savedLine, root,
    h('p', { class: 'table-foot' }, `${table.blurb} ${screen.foot} `,
      h('a', { href: table.page, target: '_blank', rel: 'noopener noreferrer' }, `${table.name}'s own page ↗`)));
  const wrap = h('div', { class: 'table-wrap' }, page, panel.el);
  p.el.append(wrap);
  let retryFn = null;
  noteRetry.addEventListener('click', () => retryFn && retryFn());
  const setNote = (text, retry = null) => {
    note.hidden = !text;
    noteText.textContent = text || '';
    retryFn = retry;
    noteRetry.hidden = !retry;
  };

  // ---------- saving (stage 4) ----------
  const notify = (nodes) => { savedLine.replaceChildren(...nodes.filter(Boolean)); savedLine.hidden = false; };
  let counted = null;
  const saver = createSaver({ table, kit: RECORDS[id], auth, host: wrap, notify, keepForReturn, onSaved: () => { counted = null; drawAccount(); } });
  const save = (job) => saver.request(job);
  save.savedFor = saver.savedFor;

  // The seat line: "Sign in to save matches", or "@x ✓ · 3 matches saved".
  function drawAccount() {
    const cur = auth.current();
    if (!cur) {
      // (at a table across two computers, sitting signs you in: one sign-in button is enough)
      accountLine.replaceChildren(...(screen.mode === 'online' ? [] : [h('button', { type: 'button', class: 'signin-btn', onclick: () => signInHere() }, 'Sign in to save matches')]));
      return;
    }
    const count = h('span', { class: 'table-count' });
    accountLine.replaceChildren(...[h('span', { class: 'table-who' }, `@${cur.handle} ✓`), count,
      auth.covers(cur.did, id) || !auth.known(cur.did) ? null : h('span', { class: 'table-asks' }, ` · ${table.name} asks for its permission at your first save`)].filter(Boolean));
    const key = `${cur.did} ${id}`;
    if (counted && counted.key === key) { count.textContent = counted.text; return; }
    resolver.countRecords(cur.did, table.collection).then(({ count: n, more }) => {
      const text = ` · ${more ? `${n}+` : n} ${n === 1 && !more ? 'match' : 'matches'} saved`;
      counted = { key, text };
      if (auth.current()?.did === cur.did) count.textContent = text;
    }).catch(() => {});
  }
  // The bar's button: sign in for this table (your account plus this game's set, Q36).
  function signInHere() {
    const d = openDialog(wrap, { label: 'Sign in to save matches' });
    const form = signInForm({
      auth,
      scope: (who) => auth.scopeFor(auth.didForHandle(who), id),
      onDone: () => { d.close(); drawAccount(); },
      goHere: (who, scope) => { keepForReturn({ kind: 'signin', table: id }); return auth.signInHere(who, scope, 'signin'); },
    });
    d.body.append(h('h2', {}, 'Sign in to save matches'), h('p', { class: 'rk-promise' }, SIGNIN_PROMISE), form.el,
      h('p', { class: 'small' }, `The first time, your account server asks you to approve "${table.name}": saving its match records, nothing else.`));
    form.focus();
  }
  const offAuth = auth.onChange(() => drawAccount());
  drawAccount();

  const cur = auth.current();
  const driver = screen.mount(root, {
    table, mothership, resolver, fetchImpl, setNote, save, auth, go, say, keepForReturn,
    reader: cur ? { handle: cur.handle, did: cur.did } : undefined,
    setStatus: (text) => { statusLine.textContent = text; },
    log: panel.log,
    tableId: screen.mode === 'online' ? sub : null,
    ...(loc ? { loc } : {}), ...(WebSocketImpl ? { WebSocketImpl } : {}), ...(keepStore ? { keepStore } : {}),
  });
  // Back from "Sign in in this tab instead": the save prompt again, for the match kept for the trip.
  if (pending && pending.kind === 'save' && pending.result) saver.reopen({ result: pending.result, seat: pending.seat, account: pending.account || null });
  return { dispose: () => { offAuth(); saver.dispose(); driver.dispose(); }, driver, panel, saver };
}
