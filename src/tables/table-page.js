// A table inside a tab (stage 3, claude/raku-plan.md section 12): the table's bar (its name, how it's
// going, who you're signed in as, the Messages button), a note line (problems, what was saved), the
// game's own driver (sevenup.js, daisy.js) and the message panel. Since stage 4 also saving (saving.js):
// "Sign in to save matches" in the bar (Q35), the seat line "@x ✓ · 3 matches saved", Raku's own prompt.
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
import { createSaver } from './saving.js';
import * as sevenupRecord from './sevenup-record.js';
import * as daisyRecord from './daisy-record.js';
import { openDialog, signInForm } from '../signin-ui.js';

const DRIVERS = { sevenup: mountSevenUp, daisy: mountDaisy };
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

/** Draws a table in a pane. → { dispose } or null for an unknown table. */
export function drawTable(ctx, id) {
  const { p, mothership, resolver, fetchImpl, auth, keepForReturn, pending } = ctx;
  const table = TABLES[id];
  if (!table || !DRIVERS[id]) return null;
  const statusLine = h('span', { class: 'table-status' }, 'You and the bot');
  const noteText = h('p', {});
  const noteRetry = h('button', { type: 'button', hidden: true }, 'Try again');
  const note = h('div', { class: 'table-note', hidden: true, role: 'status' }, noteText, noteRetry);
  const panel = createPanel({ label: `What passes between ${table.name}'s tiles` });
  const root = h('div', { class: `table-root table-${id}` });
  const accountLine = h('span', { class: 'table-account' });
  const savedLine = h('div', { class: 'table-saved', hidden: true, role: 'status', 'aria-live': 'polite' });
  const page = h('div', { class: 'table-page' },
    h('div', { class: 'table-bar' }, h('h1', {}, table.name), statusLine, accountLine, h('span', { class: 'spacer' }), panel.button),
    note, savedLine, root,
    h('p', { class: 'table-foot' }, `${table.blurb} You play the table's bot here. Signed in, you can save your matches to your own account. `,
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
      accountLine.replaceChildren(h('button', { type: 'button', class: 'signin-btn', onclick: () => signInHere() }, 'Sign in to save matches'));
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
  const driver = DRIVERS[id](root, {
    table, mothership, resolver, fetchImpl, setNote, save,
    reader: cur ? { handle: cur.handle, did: cur.did } : undefined,
    setStatus: (text) => { statusLine.textContent = text; },
    log: panel.log,
  });
  // Back from "Sign in in this tab instead": the save prompt again, for the match kept for the trip.
  if (pending && pending.kind === 'save' && pending.result) saver.reopen({ result: pending.result, seat: pending.seat });
  return { dispose: () => { offAuth(); saver.dispose(); driver.dispose(); }, driver, panel, saver };
}
