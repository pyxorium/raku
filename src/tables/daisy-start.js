// Daisy's start screen in Raku (stage 5, Q47): what raku:table/daisy shows, like the Daisy page's own start.
//   - Play the bot: no sign-in (raku:table/daisy/bot; signed in, you can save the match);
//   - Open a table: sign in with "Play Daisy" if needed, then a new table with you at seat 1 and its link to
//     send (raku:table/daisy/<table id>);
//   - "You have a match in progress with @x. Back to the table", for the account you'd sit as;
//   - the Lounge (step 5b, daisy-lounge.js): mingling players find each other, as on the Daisy page; you're in
//     the lounge only while this tab is in front and Raku can be seen (Q51).
import { h } from '../cards.js';
import { BOT, newTableId } from '../config.js';
import { tableUri } from '../address.js';
import { sitAs } from './daisy-sit.js';
import { intents } from './daisy-online.js';
import { createDaisyKeep } from './daisy-keep.js';
import { mountDaisyLounge } from './daisy-lounge.js';

export function mountDaisyStart(root, { table, auth, resolver, go, setStatus, log = () => {}, keepForReturn = () => {}, keepStore = createDaisyKeep(), loc, WebSocketImpl }) {
  keepStore.forgetOld();
  const note = h('p', { class: 'daisy-start-note', role: 'status', 'aria-live': 'polite' });
  const who = h('p', { class: 'small daisy-who' });
  const going = h('ul', { class: 'daisy-going', hidden: true });
  const host = () => root.closest('.table-wrap') || root;

  const botBtn = h('button', { type: 'button', class: 'primary daisy-bot', onclick: () => go(tableUri('daisy', 'bot')) }, 'Play the bot');
  const openBtn = h('button', { type: 'button', class: 'primary daisy-open', onclick: () => openTable() }, 'Open a table');
  root.append(h('div', { class: 'daisy-start' },
    going,
    h('div', { class: 'daisy-choices' },
      h('section', { class: 'daisy-choice' }, h('h2', {}, 'Play the bot'),
        h('p', {}, `@${BOT.handle}, the table's bot, plays the other seat right here. No sign-in needed and no timers; signed in, you can save the match.`), botBtn),
      h('section', { class: 'daisy-choice' }, h('h2', {}, 'Play a friend'),
        h('p', {}, 'Open a table and send its link to a friend on another computer. They can play in Raku or on Daisy\'s own page. Playing someone needs a sign-in ("Play Daisy"), so each of you sees the other\'s real, checked handle.'),
        openBtn, who)),
    note));
  // The Lounge (step 5b), under the two cards (Q54).
  const loungeHost = h('div', { class: 'daisy-lounge-host' });
  root.querySelector('.daisy-start').append(loungeHost);
  const lounge = table.lounge ? mountDaisyLounge(loungeHost, {
    table, auth, resolver, log, keepForReturn, dialogHost: host(),
    ...(loc ? { loc } : {}), ...(WebSocketImpl ? { WebSocketImpl } : {}),
    // An invitation both said yes to: this tab goes to the table, at the seat the relay gave.
    onTable: ({ table: id, seat, did, handle, said }) => { intents.set(id, { kind: 'open', did, handle, seat, fromLounge: true, said }); go(tableUri('daisy', id)); },
  }) : null;
  // "Here" (Q51): this tab in front, and Raku itself seen (not another browser tab, not minimized).
  const pane = () => root.closest('.pane');
  const seen = () => !!pane() && pane().classList.contains('front') && document.visibilityState === 'visible';
  const update = () => lounge && lounge.setVisible(seen());
  const onFront = () => update();
  let paneEl = null;
  document.addEventListener('visibilitychange', update);
  queueMicrotask(() => { paneEl = pane(); paneEl?.addEventListener('raku:front', onFront); update(); });
  setStatus('Choose how to play');

  function openTable() {
    note.textContent = '';
    sitAs({ auth, table, host: host(), purpose: 'open', say: (t) => { note.textContent = t; }, keepForReturn, onReady: (acct) => {
      const id = newTableId();
      intents.set(id, { kind: 'open', did: acct.did, handle: acct.handle });
      go(tableUri('daisy', id));
    } });
  }

  // The account you'd sit as, and its unfinished matches kept in this browser.
  function draw() {
    const cur = auth.current();
    who.textContent = cur ? `You'd sit as @${cur.handle} (the account in the top bar).` : '';
    who.hidden = !cur;
    const list = cur ? keepStore.inProgress(cur.did) : [];
    going.hidden = !list.length;
    going.replaceChildren(...list.map((g) => h('li', {}, `You have a match in progress with @${g.with}. `,
      h('button', { type: 'button', class: 'linkish', onclick: () => { intents.set(g.table, { kind: 'resume', did: cur.did }); go(tableUri('daisy', g.table)); } }, 'Back to the table'))));
  }
  const off = auth.onChange(draw);
  draw();
  return {
    lounge,
    dispose() { off(); document.removeEventListener('visibilitychange', update); paneEl?.removeEventListener('raku:front', onFront); lounge && lounge.dispose(); },
  };
}
