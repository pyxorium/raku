// A table inside a tab (stage 3, claude/raku-plan.md section 12): the table's bar (its name, how it's
// going, the Messages button), a note line (problems, and that saving isn't here yet), the game's own
// driver (sevenup.js, daisy.js) and the message panel.
//
// The message panel (decision 12, every tab): what passes between the house, the seats and Raku, newest
// at the bottom; ping, pong and other frequent messages are left out, as on the games' own pages. On a
// computer it's a strip along the right of the tab; on a phone a sheet from the bottom. Ordinary tiles
// get the same panel for what they ask of Raku (app.js).
import { TABLES } from '../config.js';
import { h } from '../cards.js';
import { icon } from '../icons.js';
import { mountSevenUp } from './sevenup.js';
import { mountDaisy } from './daisy.js';

const DRIVERS = { sevenup: mountSevenUp, daisy: mountDaisy };

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
  const { p, mothership, resolver, fetchImpl } = ctx;
  const table = TABLES[id];
  if (!table || !DRIVERS[id]) return null;
  const statusLine = h('span', { class: 'table-status' }, 'You and the bot');
  const noteText = h('p', {});
  const noteRetry = h('button', { type: 'button', hidden: true }, 'Try again');
  const note = h('div', { class: 'table-note', hidden: true, role: 'status' }, noteText, noteRetry);
  const panel = createPanel({ label: `What passes between ${table.name}'s tiles` });
  const root = h('div', { class: `table-root table-${id}` });
  const page = h('div', { class: 'table-page' },
    h('div', { class: 'table-bar' }, h('h1', {}, table.name), statusLine, h('span', { class: 'spacer' }), panel.button),
    note, root,
    h('p', { class: 'table-foot' }, `${table.blurb} You play the table's bot here; nothing is saved yet. `,
      h('a', { href: table.page, target: '_blank', rel: 'noopener noreferrer' }, `${table.name}'s own page ↗`)));
  p.el.append(h('div', { class: 'table-wrap' }, page, panel.el));
  let retryFn = null;
  noteRetry.addEventListener('click', () => retryFn && retryFn());
  const setNote = (text, retry = null) => {
    note.hidden = !text;
    noteText.textContent = text || '';
    retryFn = retry;
    noteRetry.hidden = !retry;
  };
  const saveNote = `Saving comes to Raku soon. To save a match now, play at ${table.page.replace(/^https:\/\//, '').replace(/\/$/, '')}.`;
  const driver = DRIVERS[id](root, {
    table, mothership, resolver, fetchImpl, saveNote, setNote,
    setStatus: (text) => { statusLine.textContent = text; },
    log: panel.log,
  });
  return { dispose: () => driver.dispose(), driver, panel };
}
