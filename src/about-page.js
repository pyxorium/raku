// About Raku (raku:about; going-public plan, Q134, claude/raku-launch-plan.md): what Raku is, what it keeps in
// this browser, who it talks to and why, how tiles are kept in their box (with the one exception: a tile's
// links in a new tab, Q133), and how to report a tile. A page inside a tab, like Your shelf; linked from the
// first screen's last line, the account menu and Discover's right column.
//
// Keep it true: when Raku starts talking to another server, or keeps something new in the browser, this page
// changes in the same commit.

import { SITE, TAKEDOWNS_PAGE, SOURCE_CODE, MADE_BY, BLOG_POST } from './config.js';
import { accountPageUri } from './address.js';
import { h } from './cards.js';

const outLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, text);

/** Who Raku talks to, and why: [who, what]. */
export const TALKS_TO = Object.freeze([
  ["Each tile's own account", "The tile itself, its pictures, and the newest tiles of accounts on your shelf. Fetched from the author's own server."],
  ["Bluesky's public servers", 'Moderation labels on accounts, Tile news posts, profile pictures, finding accounts by handle.'],
  ['plc.directory', "Finding which server holds an account's data."],
  ['appmosphe.re', 'Only when you search (just the words you typed), the Recent tiles list, and pictures for the picks, Recent tiles and search results.'],
  ['lexicographer.space', 'A coded copy of its hide list, checked here in your browser, so nobody learns which tiles you open.'],
  ['typeahead.waow.tech', 'Handle suggestions while you type a handle in the address box.'],
  ['The tile loading server', 'Gives each tile its own address to run on (load.tiles.lexicographer.space).'],
  ["Daisy's relay", 'Only while you play Daisy with someone on another computer.'],
]);

/** What a tile says to Raku, and where it shows (Oct 23: the button appears only once a tile sends something). */
export const MESSAGES_LINE = 'A tile can only talk to Raku. If it sends anything, a Messages button appears on its tab and shows what it sent. At a table, the Messages button in the table’s bar shows everything passing between its tiles.';

export const EXCEPTION = 'a tile can open a link in a new tab when you click it, and that link could carry information about what you did in the tile. It’s the same as clicking a link on any web page, so use the same care.';

/** Installing Raku (stage 9, S3): the steps for each kind of browser, [where, how]. */
export const INSTALL_STEPS = Object.freeze([
  ['Chrome or Edge', ' (computer or Android): “Install Raku” in the account menu, or the install icon at the right of the address bar.'],
  ['iPhone or iPad', ': in Safari, Share → Add to Home Screen. The home-screen Raku keeps its own shelf and sign-ins, separate from Safari’s; use Export and Import on Your shelf to bring your shelf across.'],
  ['Safari on a Mac', ': File → Add to Dock.'],
  ['Firefox', ': Raku works fine in a tab; Firefox doesn’t install web apps on computers.'],
]);
export const INSTALL_INTRO = 'Raku can have its own window and icon, like an app. It’s the same Raku, with the same privacy.';
export const INSTALL_KEEPS = 'Installed Raku keeps one small page of its own (the “Raku needs the internet” screen), never tiles or anything you open, and checks for a new version each time it starts.';

export function drawAbout(ctx) {
  const { p, tabs, tab, drawChrome } = ctx;
  p.title = `About ${SITE.name}`;
  p.shownAddress = '';
  p.keep = null;
  p.state = 'ready';
  drawChrome();
  const sect = (title, ...kids) => h('section', { class: 'ab-part' }, h('h2', {}, title), ...kids);
  const madeBy = h('button', { type: 'button', class: 'linkish', onclick: () => tabs.go(tab.id, accountPageUri(MADE_BY)) }, `@${MADE_BY}`);
  p.el.append(h('article', { class: 'about' },
    h('h1', {}, `About ${SITE.name}`),
    h('p', { class: 'lede' }, `${SITE.name} is a browser for web tiles: small pages and apps that people publish to their own atproto accounts. It opens them, keeps the ones you like on your shelf, and finds new ones.`),
    sect("You don't need an account",
      h('p', {}, "Browsing, searching and playing the tables against the bot need no sign-in. Signing in is only for saving your match results from the tables (and, if you choose, being seen in Daisy's lounge). Raku never touches your posts, likes, follows or anything else.")),
    sect('What stays in this browser',
      h('p', {}, "Raku has no server of its own and no accounts of its own. These are kept in this browser only, and you can clear them by clearing this site's data:"),
      h('ul', {},
        h('li', {}, h('b', {}, 'Your shelf'), ': the tiles and accounts you keep (Export and Import move it to another browser).'),
        h('li', {}, h('b', {}, 'Your last visits'), ' to Following and Recent tiles, for the "New" marks.'),
        h('li', {}, h('b', {}, 'The app you chose'), ' for opening posts, and the accounts you’ve signed in with.'),
        h('li', {}, 'A seat at a Daisy table you’ve joined, for a day.'),
        h('li', {}, 'If you install Raku: its “Raku needs the internet” screen, for when there’s no connection.'))),
    sect('Who Raku talks to, and why',
      h('dl', { class: 'ab-who' }, ...TALKS_TO.flatMap(([who, what]) => [h('dt', {}, who), h('dd', {}, what)]))),
    sect('How tiles are kept in their box',
      h('ul', {},
        h('li', {}, 'Every tile runs on its own address, apart from Raku and from other tiles. It can’t read your shelf, your sign-in, or another tile.'),
        h('li', {}, 'A tile can’t reach the internet on its own: no fetching, no pictures from elsewhere, no tracking pixels. What it shows comes from its author’s account.'),
        h('li', {}, MESSAGES_LINE),
        h('li', {}, 'Large tiles ask before they load.')),
      h('div', { class: 'ab-exception' }, h('b', {}, 'One exception:'), ` ${EXCEPTION}`)),
    sect('Install Raku',
      h('p', {}, INSTALL_INTRO),
      h('ul', {}, ...INSTALL_STEPS.map(([where, how]) => h('li', {}, h('b', {}, where), how))),
      h('p', {}, INSTALL_KEEPS)),
    sect('Hidden tiles and reporting',
      h('p', {}, 'Raku hides tiles and accounts on lexicographer.space’s hide list, and accounts that Bluesky’s moderation hides. To report a tile, see ', outLink(TAKEDOWNS_PAGE, 'Reporting and takedowns ↗'), '.')),
    h('p', { class: 'ab-foot' }, `${SITE.name} is made by `, madeBy, '. Its code is public at ', outLink(SOURCE_CODE, SOURCE_CODE.replace(/^https:\/\//, '')), '. ', outLink(BLOG_POST, 'How Raku works, on the blog\u00a0→'))));
}
