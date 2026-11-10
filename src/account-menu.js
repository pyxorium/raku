// The account menu (stage 4, Q42): a small round avatar (or "Sign in") in the top bar, at the right on a
// computer and between the Raku label and the address on a phone. It opens a menu (a sheet from the
// bottom on a phone): the accounts signed in on this browser with a tick on the current one (choosing one
// switches, no window: Q38), Add another account, the "Saves without asking" choices with Turn off (Q37),
// Raku's sign-in promise (Q43), and Sign out; then the Autoplay switch (claude/raku-expand-plan.md, AU5), "Install
// Raku" when the browser offers it (stage 9, S3); last, a link to the About page (going public, Q134). Above Autoplay,
// the Look row and the Light style row (claude/raku-light-mode-plan.md, LM7, LM14).
import { SIGNIN_PROMISE, TABLES, LIGHT_STYLES } from './config.js';
import { h } from './cards.js';
import { icon } from './icons.js';
import { signInForm, avatarEl } from './signin-ui.js';

export function createAccountMenu({ auth, moderation, keepForReturn, say, onAbout = null, install = null, autoplay = null, look = null }) {
  const button = h('button', { type: 'button', class: 'account-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => toggle() });
  const panel = h('div', { class: 'account-menu', hidden: true, role: 'dialog', 'aria-label': 'Your accounts' });
  const avatars = new Map();             // did → avatar address (Bluesky's picture server), once known
  let adding = false;

  const avatarOf = (a, cls) => avatarEl(a.handle, avatars.get(a.did), cls);
  function learnAvatar(did) {
    if (avatars.has(did)) return;
    avatars.set(did, null);
    moderation.profile(did).then((prof) => { if (prof.avatar) { avatars.set(did, prof.avatar); draw(); } }).catch(() => {});
  }

  function drawButton() {
    const cur = auth.current();
    if (cur) {
      learnAvatar(cur.did);
      button.replaceChildren(avatarOf(cur, 'acct-av'));
      button.title = `Signed in as @${cur.handle}`;
      button.setAttribute('aria-label', `Your accounts (signed in as @${cur.handle})`);
      button.classList.remove('signed-out');
    } else {
      button.replaceChildren(icon('person', 18), h('span', { class: 'account-signin' }, 'Sign in'));
      button.title = 'Sign in to save match results';
      button.setAttribute('aria-label', 'Sign in');
      button.classList.add('signed-out');
    }
  }

  function form({ label }) {
    return signInForm({
      auth, button: label,
      // A new account asks only for itself; signing in again keeps the games it already allows.
      scope: (who) => auth.scopeFor(auth.didForHandle(who), null),
      onDone: (did) => { adding = false; draw(); const a = auth.current(); if (a && a.did === did) say(`Signed in as @${a.handle}.`); },
      goHere: (who, scope) => { keepForReturn({ kind: 'signin' }); return auth.signInHere(who, scope, 'signin'); },
    });
  }

  // Stage 9 (S3): only while the browser offers installing (Chrome and Edge) and Raku isn't running installed.
  const installRow = () => (install && install.available() ? h('button', { type: 'button', class: 'acct-install', onclick: async () => {
    toggle(false);
    const outcome = await install.prompt();
    if (outcome === 'accepted') say('Raku is installed. You’ll find it with your other apps.');
  } }, icon('install', 16), 'Install Raku: its own window and icon') : null);
  // AU5: the same switch as in Tile posts' header (one choice for this browser; signed in or not).
  const autoplayRow = () => (autoplay ? h('div', { class: 'acct-autoplay' },
    h('span', { class: 'acct-autoplay-words' }, h('span', {}, 'Autoplay tile posts'),
      h('span', { class: 'small' }, 'A post\u2019s tile starts once it\u2019s been on screen a moment; silent and without the keys until you click it.')),
    switchButton(autoplay, 'Autoplay tile posts')) : null);
  // LM7: Match device · Light · Dark, the current one filled. LM14: the six light styles as round swatches (each its
  // style's strip with a dot of its turquoise), shown only when light can appear; with Match device on a device that's
  // dark now, a note says when it's used. A tap changes Raku at once.
  const LOOKS = [['device', 'Match device'], ['light', 'Light'], ['dark', 'Dark']];
  const lookRows = () => {
    if (!look) return null;
    const lookRow = h('div', { class: 'acct-look' }, h('span', { class: 'acct-look-label', id: 'acct-look-label' }, 'Look'),
      h('div', { class: 'rk-seg', role: 'group', 'aria-labelledby': 'acct-look-label' }, ...LOOKS.map(([v, words]) =>
        h('button', { type: 'button', class: 'rk-seg-btn', 'aria-pressed': look.look === v ? 'true' : 'false', 'data-focus-key': `look-${v}`,
          onclick: () => look.setLook(v) }, words))));
    if (look.look === 'dark') return h('div', { class: 'acct-looks' }, lookRow);
    const chosen = LIGHT_STYLES.find((st) => st.id === look.style);
    const swatches = LIGHT_STYLES.map((st) => {
      const b = h('button', { type: 'button', class: 'rk-swatch', 'aria-pressed': st.id === look.style ? 'true' : 'false', 'aria-label': st.name,
        title: st.name, 'data-focus-key': `style-${st.id}`, onclick: () => look.setStyle(st.id) });
      b.style.setProperty('--sw-strip', st.strip);   // the style's own colours, from config.js (not the page's)
      b.style.setProperty('--sw-dot', st.dot);
      return b;
    });
    const styleRow = h('div', { class: 'acct-style' },
      h('span', { class: 'acct-style-words', id: 'acct-style-label' }, 'Light style: ', h('b', {}, chosen ? chosen.name : '')),
      h('div', { class: 'rk-swatches', role: 'group', 'aria-labelledby': 'acct-style-label' }, ...swatches),
      look.look === 'device' && !look.deviceLight ? h('span', { class: 'small acct-style-note' }, 'Used when your device is light.') : null);
    return h('div', { class: 'acct-looks' }, lookRow, styleRow);
  };
  const aboutRow = () => (onAbout ? h('button', { type: 'button', class: 'acct-about', onclick: () => { toggle(false); onAbout(); } }, icon('info', 16), 'About Raku: privacy and safety') : null);
  function drawPanel() {
    const list = auth.list();
    const head = h('div', { class: 'acct-head' }, h('b', {}, list.length ? 'Signed in on this browser' : 'Sign in to Raku'),
      h('button', { type: 'button', class: 'acct-close', 'aria-label': 'Close', onclick: () => toggle(false) }, icon('close', 16)));
    const parts = [head];
    if (!list.length) {
      const f = form({ label: 'Sign in' });
      parts.push(h('p', { class: 'small' }, 'Browsing never needs a sign-in. Signing in is only for saving match results from the tables.'), f.el,
        h('p', { class: 'rk-promise' }, SIGNIN_PROMISE), installRow(), aboutRow());
      parts.splice(parts.length - 2, 0, lookRows(), autoplayRow());
      panel.replaceChildren(...parts.filter(Boolean));
      return f;
    }
    parts.push(h('ul', { class: 'acct-list' }, ...list.map((a) => {
      learnAvatar(a.did);
      return h('li', {}, h('button', { type: 'button', class: `acct-row${a.current ? ' on' : ''}`, 'aria-current': a.current ? 'true' : null,
        onclick: () => { if (!a.current) { auth.switchTo(a.did); say(`Now using @${a.handle}.`); } } },
      avatarOf(a, 'acct-av'), h('span', { class: 'acct-handle' }, `@${a.handle}`), a.current ? h('span', { class: 'tick', 'aria-label': 'current' }, '✓') : null));
    })));
    let f = null;
    if (adding) { f = form({ label: 'Sign in' }); parts.push(f.el); }
    else parts.push(h('button', { type: 'button', class: 'acct-add', onclick: () => { adding = true; draw(); panel.querySelector('.signin-handle')?.focus(); } }, icon('plus', 16), 'Add another account'));
    const always = auth.accounts.alwaysList();
    if (always.length) {
      parts.push(h('h3', {}, 'Saves without asking'), h('ul', { class: 'acct-always' }, ...always.map((e) => {
        const a = auth.accounts.get(e.did);
        return h('li', {}, h('span', {}, `${TABLES[e.tableId].name} · @${a?.handle || e.did}`),
          h('button', { type: 'button', class: 'linkish', onclick: () => { auth.accounts.setAlways(e.did, e.tableId, false); draw(); say(`${TABLES[e.tableId].name} asks again before saving.`); } }, 'Turn off'));
      })));
    }
    parts.push(h('p', { class: 'rk-promise' }, SIGNIN_PROMISE));
    const cur = auth.current();
    if (cur) parts.push(h('button', { type: 'button', class: 'acct-out', onclick: async () => { const hd = cur.handle; await auth.signOut(cur.did); draw(); say(`Signed out @${hd}.`); } }, `Sign out @${cur.handle}`));
    parts.push(lookRows(), autoplayRow(), installRow(), aboutRow());
    panel.replaceChildren(...parts.filter(Boolean));
    return f;
  }

  function draw() {
    drawButton();
    if (!panel.hidden) drawPanel();
  }
  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { adding = false; const f = drawPanel(); (f ? f.input : panel.querySelector('.acct-row'))?.focus(); }
  }
  // Close on a click outside, or Escape.
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); button.focus(); } });
  auth.onChange(() => draw());
  if (install) install.onChange(() => draw());
  if (autoplay) autoplay.onChange(() => draw());
  // A new look draws the menu again; the button just pressed keeps the focus (keyboard, screen readers).
  if (look) look.onChange(() => {
    const was = panel.contains(document.activeElement) ? document.activeElement.getAttribute('data-focus-key') : null;
    draw();
    if (was) panel.querySelector(`[data-focus-key="${was}"]`)?.focus();
  });
  draw();
  return { button, panel, toggle, draw };
}

/** An on/off switch for the Autoplay choice (AU5), drawn the same in the account menu and Tile posts' header. */
export function switchButton(autoplay, label) {
  const b = h('button', { type: 'button', class: 'rk-switch', role: 'switch', 'aria-label': label, 'aria-checked': autoplay.on ? 'true' : 'false',
    onclick: () => autoplay.set(!autoplay.on) });
  return b;
}
