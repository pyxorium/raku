# Raku (lab)

A browser for the web tile layer: one static page that works like a small browser whose pages are web
tiles. Tabs of running tiles, an address box, back and forward. Lives at **raku.lexicographer.space**
(GitHub Pages), beside the open tile viewer at lexicographer.space.

Hidden lab for now: `noindex`, `robots.txt`, no links to it. **Hidden is not secret: once pushed, anyone
with the address can open it.**

Plans and decisions: `claude/raku-plan.md` in the Web Tile Foundry project.

## Stage 1 (Oct 19 2026): skeleton, plain tabs, basic safety

- **Tabs**: a row of tabs on a computer; on a phone one tile at a time, the address across the top, and a
  bottom toolbar (back, forward, reload, and a tab count that opens the list), each a full thumb-size
  button. Up to 10 open. Background tabs keep running. The open tabs live in the page's own address (after
  `#`), so a reload or a copied link reopens them.
- **The address box** takes `at://…/ing.dasl.masl/…`, lexicographer.space and appmosphe.re tile links
  (`/@handle/rkey`), webtil.es links (`#url=at://…`), Beaver's `tile://<rkey>.<did>/`, and `@handle/rkey`.
- **The first screen**: the address box and a few picks (`PICKS` in `src/config.js`).
- **Safety** (Raku's address box opens anyone's tile):
  - every request for a tile goes over https to a host that isn't obviously private, with time and size
    limits, no cookies and no referrer (`src/net.js`);
  - a tile's size is read from its record first: above 25 MB Raku asks "Open anyway?", above 500 MB it
    refuses, and no tile may download more than 500 MB in all (`LIMITS`);
  - moderation, as the viewer: a coded copy of lexicographer.space's hide list (hashes only), checked in
    the browser, and Bluesky's own moderation labels (`src/moderation.js`). The list is published by the
    viewer at https://lexicographer.space/hidden-tiles.json (step 1b);
  - the page's security policy (a `<meta>` tag on the built page): scripts and styles only from Raku, frames
    only from the tile loading server;
  - inside another site's frame Raku shows only "Open Raku in its own tab" (`src/frame-guard.js`).
- Tiles run through the shared loading server (`load.tiles.lexicographer.space`, a fresh random name per
  tile), whose worker keeps every tile off the network.

## Stage 2 (Oct 20 2026): the Shelf

- **Your shelf** (the Shelf button, or `raku:shelf`): Raku's bookmarks. Kept accounts in a row (avatar,
  handle, how many tiles), then kept tiles as cards, most recently kept first. Kept only in this browser;
  **Export** saves it as a small file and **Import** adds one (nothing is removed).
- **An account's tiles**: type a handle (`@thunderbird.cafe`, `thunderbird.cafe`) or a DID in the address
  box; suggestions with avatars appear as you type a handle (from typeahead.waow.tech; pasted tile
  addresses are never sent there). Cards, read live from the account's own server, 100 at a time with More; tiles Raku can't run are
  greyed with the reason; hidden tiles aren't listed.
- **The star** at the end of the address box keeps the tile (or, on an account's page, the account) on your
  shelf. Cards open in the same tab (Back returns), or in a new tab from a card's corner.
- The first screen shows the latest few kept tiles under the picks.

## Stage 3 (Oct 20 2026): tables against the bot

- **Seven-Up and Daisy** play in a tab (`raku:table/sevenup`, `raku:table/daisy`; Daisy's bot since stage 5 at `raku:table/daisy/bot`), from the first screen's
  **Tables** row: you at seat 1, the bot (@dicesprite.thunderbird.cafe) at seat 2, no sign-in to play
  (saving: stage 4).
- Each table loads only the pinned versions on Raku's approved list (`TABLES` in `src/config.js`, the same
  pins as the site's): a republished game is refused until the list is updated.
- A small driver per game (`src/tables/sevenup.js`, `daisy.js`) on a shared core (`frames.js`, `pinned.js`,
  `table-page.js`), with each game's own routing rules (`sevenup-relay.js`, `daisy-router.js`, copies).
- **The message panel**: what passes between a table's tiles (and what an ordinary tile asks of Raku).
- A table's own tile opened on its own says so and offers **Play Daisy**; the star keeps a table on your shelf.

## Stage 4 (Oct 20 2026): signing in and saving

Decisions: `claude/raku-stage4-plan.md` (Q35 to Q43).

- **Browsing and playing never need a sign-in.** Signing in is only for saving match results from the
  tables. Raku's promise, shown beside every sign-in: "Signing in lets raku.lexicographer.space save your
  match results from the tables you play. Each game asks for its own permission the first time you save.
  Raku doesn't touch your posts, likes, follows or anything else." (Widened in step 5b for the lounge.)
- **Where:** "Sign in to save matches" in a table's bar, or Save in a seat while signed out (Raku's prompt
  signs you in first, then asks), or the account button in the top bar (at the right on a computer, beside
  the Raku label on a phone; its menu is a sheet from the bottom there).
- **Permissions per game:** the first sign-in at a table asks for your account plus that game's permission
  set ("Play Seven-Up", "Play Daisy"); the first save at another game adds its set with one short
  Authorize. A sign-in from the account menu asks for the account only. `oauth.json` (written by the build
  from `src/config.js`) lists the most Raku may ask for: `atproto` plus each approved table's set.
- **The save prompt** is Raku's own, drawn over the table, outside the tiles: "Save this match to @x?",
  what will be saved (the record), **Allow once / Always / No**, "Use another account". Only the house's
  result is saved, as the game's own record (`src/tables/sevenup-record.js`, `daisy-record.js`, copies of
  the games' `recordFor` / `checkRecord`), stamped with the pinned house tile, checked first, to your own
  repo with the match id as its key. Your seat in the record is the account you save to.
- **Always** = this game and this account, in this browser. Every save still says "Saved to @x" with a link
  to the record; the account menu lists "Saves without asking" with Turn off.
- **Several accounts**, one current (ticked in the menu); switching to one already signed in needs no
  window. Sign out revokes the sign-in.
- **The sign-in window** opens straight from the click, so running tiles and the match stay as they are.
  When it's blocked: "Try again" or "Sign in in this tab instead" (the tab goes to the account server and
  back; the open tabs come back, other tiles restart, and a match waiting to be saved is kept for the trip
  and the prompt comes back).
- Uses `@atproto/oauth-client-browser` 0.5.8 (as the site and the Foundry), loaded only when needed. On
  this computer (127.0.0.1) the sign-in is a loopback one that needs no `oauth.json`.

## Stage 5 (Oct 21 2026): Daisy across two computers

Decisions: `claude/raku-plan.md` section 15 (Q44 to Q50).

- **One pool of tables with the Daisy page (Q44).** Raku plays the same pinned house through the same relay
  (`wss://relay.daisy.thunderbird.cafe/`, the Fly app `thunderbird-daisy-relay`) with the Daisy page's own
  join message, so a table opened in Raku can be joined from thunderbird.cafe/webtiles/daisy/ and the other
  way round. A Daisy page table link pasted into the address box opens that table in Raku.
- **Daisy's three screens:** `raku:table/daisy` is a small start screen (Q47): **Play the bot** (no
  sign-in, `raku:table/daisy/bot`, as stage 3) and **Open a table**; a table across two computers is
  `raku:table/daisy/<table id>`.
- **Open a table** seats you at seat 1 and gives the link to send: Raku's own address with that table's tab
  (`https://raku.lexicographer.space/#t=raku:table/daisy/<id>&a=0`, Q45). The friend opens it (or pastes it
  into Raku's address box), signs in and takes the other seat.
- **Sitting with someone needs a sign-in (Q46)**, with "Play Daisy" (the set saving already uses): the other
  player sees a real, checked handle, and the relay keeps each seat for an account. Playing the bot still
  needs none. You sit as the current account (the account menu switches it); already signed in with
  "Play Daisy", no window opens.
- **Your seat is kept in this browser for a day** (`raku-daisy-table:<table>:<did>`, with your house's
  secret seed; it never leaves the browser): a reload, a closed tab or **Back to the start** can come back
  to the match. The start screen says "You have a match in progress with @x. **Back to the table**".
  Mid-match, Back to the start asks first ("If you don't come back within 2 minutes, it ends by forfeit").
- The Daisy page's rules, unchanged: the real timers (nudge 1 min, turn 3 min, away 2 min); "full" for a
  third player; "already sits at this table in another browser" (held) for a seated account without the
  seat's game; the house version check (a page running another house: the table doesn't start); the
  reconnecting status and the away countdown.
- **Until the relay seats you**, "Joining the table…" stands where the seats go (the tiles load out of
  sight, so they never show their card pictures); after 5 seconds it says what's likely wrong (on this
  computer: start the stand-in relay; elsewhere: the relay can't be reached) and keeps trying.
- **Saving** at a two-computer table goes to the account sitting there (no "Use another account"), and
  the prompt says anyone can re-check the dice.
- **The lounge** stays on the Daisy page for now (Q48: it comes to Raku next, step 5b). Daisy's coin is
  its own small step after this one (Q49).
- **On this computer:** the stand-in relay (`node scripts/relay-standin.mjs` in
  `C:\thunderbird-cafe\daisy-tiles`, `ws://127.0.0.1:8787/`) is the default; `?relay=wss://relay.daisy.thunderbird.cafe/`
  tries the live relay from `npm run dev` (its origin `http://127.0.0.1:5180` is allowed there), and
  `?timers=short` the short timers. Both only on 127.0.0.1, and the table link carries them to the second
  window. The page policy (`npm run preview`) names only the live relay, so play two computers on `npm run dev`.

## Step 5b (Oct 21 2026): Daisy's lounge in Raku

Decisions: `claude/raku-stage5b-plan.md` (Q51 to Q54).

- **A Lounge on Daisy's start screen**, under the two cards: the same lounge as the Daisy page's (the same
  record, `cafe.thunderbird.daisy.lounge/self`, and the same permission set, "Daisy lounge"), so minglers in
  Raku and on the Daisy page see and invite each other. Turning mingling off in either place deletes the one
  record. Adapted from the site's `src/daisy/lounge.js` (`src/tables/daisy-lounge.js`).
- **"Here" (Q51):** you're in the lounge only while Daisy's start screen is the tab in front and Raku can be
  seen. Another Raku tab, another browser tab or a minimized browser: you quietly leave ("away") and come
  back when the start screen is in front again. (Since 5b-2 you stay connected while away, listening for the
  quiet signal below.)
- **Turning mingling on** shows the explanation first; when this browser hasn't approved "Daisy lounge" it
  opens one window (signed out: your account, "Play Daisy" and "Daisy lounge" together). Then Raku writes the
  lounge record, gets a pass from your account's server (`getServiceAuth`, for the relay's lounge only) and
  enters. "Who else is mingling?", Invite ("Invite sent", "No answer" after a minute), the knock card at
  the bottom of the tab (Play / Not now, a one-minute bar). Play: both tabs go to the new table at their
  seats (no link to send). The same account mingling in two places: the newest wins ("mingling in another
  window", Rejoin).
- **Raku's promise (Q53)** now reads: "Signing in lets raku.lexicographer.space save your match results from
  the tables you play and, if you choose to mingle, let other players see you're in a game's lounge. Each game
  asks for its own permission the first time. Raku doesn't touch your posts, likes, follows or anything else."
  `oauth.json`'s scope adds the lounge set (`include:cafe.thunderbird.daisy.authLounge?aud=…%23daisy_relay`);
  it's only ever asked when you turn mingling on. A later sign-in for a game keeps the lounge permission.
- **The quiet signal (step 5b-2, Q56 to Q59):** while Daisy's tab isn't in front (another Raku tab, another
  browser tab, the browser minimized), Raku tells the relay "away" and stays connected as a listener: not
  listed, can't be invited. When another mingler arrives (or comes back from away), the relay may say
  "someone" (never who; blocks respected; at most once every 5 minutes; nobody already there counts):
  the Daisy tab glows turquoise with ● ("Someone arrived in the Daisy lounge") and Raku's browser icon gets a
  turquoise pip. Both clear when the Daisy tab is in front again. Listening lasts up to 2 hours away. Needs
  the relay with "away" (daisy-relay, Oct 21); the explanation says so on Raku and on the Daisy page.
- **The sign-in dialogs (Q55)**, mingling, sitting at a table and saving: the heading, one short line, the
  handle box (or "Continue as @x") and its button first; the explanation, the permission and Raku's promise
  below it, smaller but always shown.

## Step 5c (Oct 21 2026): Daisy's coin, and new picks

- **Daisy's coin toss** lives in Daisy's own tiles (`C:\thunderbird-cafe\daisy-tiles`, `player/coin3d.js`
  and `shared/coin.js`): a silver coin with enamelled faces in the players' glazes, tossed on one clock
  on every screen, with a keepsake by the first player's score. Raku needs no code for it, only the new
  pins in `TABLES.daisy` once the new tiles are published (the house version check keeps old and new
  apart).
- **The first screen's picks** (`PICKS` in `src/config.js`): six tiles chosen by the owner, in order, kept
  by DID: gabriellanonino.com's sprite, jackvalinsky.com's glass lantern, justinerickson.me's Moab Red
  Hot, center.for.cybernetic.beauty's Four On The Floor, lowpoly.gg's 3D CSS Saturn, pyxorium.com's
  Roller Coaster. Two rows of three on a computer, one column on a phone. `check_page.py` serves
  stand-ins under the same addresses.

## Stage 6, step 6a (Oct 21 2026): Discover

Plan and decisions: `claude/raku-stage6-plan.md` (Q84 to Q96).

- **Discover** (`raku:discover`), a page inside a tab, opened by the compass button beside the Shelf's (a
  sixth button on the phone toolbar). Three columns on a wide window: the sources on the left, the chosen
  one in the centre with the search box above it, previews of the others on the right (click one to bring
  it to the centre). Narrower: the sources as icons, then no right column; a phone: one column with the
  sources as chips. Nothing on the page runs a tile.
- **Following** (`raku:discover/following`): the newest tiles of the accounts kept on your shelf, all mixed,
  newest first, "New" on tiles since your last visit (remembered in this browser). Asked of each account's
  own server, four at a time, kept five minutes; hidden accounts and tiles left out.
- **Search** (`raku:search/<words>`): Enter on words in the address box (a word with a dot is tried as a
  handle first; when there's no such account, a button offers the search), or the box on Discover. First
  "Already in Raku" (your shelf, Following, the picks), matched here in the browser; then appmosphe.re,
  asked only for the words, only on Enter. Raku reads just the tile addresses from appmosphe.re's answer
  and looks each tile up itself, through the usual moderation.
- **Tile news** (`raku:discover/news`): drawn and checked, but off until step 6b fills in `FEED` in
  `src/config.js` (on this computer `?feed=at://…/app.bsky.feed.generator/…` shows any feed). Posts are drawn
  by Raku as plain text and pictures (`src/posts.js`, `src/post-card.js`): links go through the link
  message, a link to a tile opens it in Raku, mentions open that account's tiles, pictures only from
  Bluesky's picture server, Bluesky's labels followed (hidden, a content warning, blurred pictures). A post
  that links to a tile (its link card, or a link in its text) shows a tile card that opens the tile in Raku.
  A reply is drawn like the Bluesky app does in a feed (Q97): the thread's first post, the post it answers
  ("More replies in between" when posts were skipped), then the reply, joined by a line, with "Open thread in
  <app>"; every post in it is checked like any other ("Post not available" when deleted, blocked or hidden),
  and a post already drawn isn't drawn again further down. The thread comes with the feed's own answer
  (`reply: { root, parent }`), so nothing more is fetched.
- **The link message** (`src/link-message.js`): before anything opens outside Raku, Raku shows the site,
  the full address, what's asking and "Only continue if you trust this site"; Open makes a new window with
  no opener and no referrer. A post's address typed in the box opens it this way (posts open outside Raku
  for now), in the app chosen for posts (`POST_APPS`; Bluesky by default, the setting comes in step 6b).
- **Raku's link card** (Q93): `public/card.png` (1200 × 630) is the picture when someone shares Raku's address;
  the Open Graph and Twitter-card tags are written into the page's head by `vite.config.js` from `CARD` /
  `cardTags()` in `src/config.js` (so the address stays named in one place). `public/banner.png` (1280 × 720)
  is a tile-style banner for places that list apps beside tiles. Check the card in Bluesky's composer after
  the push (paste the address into a new post).

## Stage 6, step 6b (Oct 21 2026): Tile news on, "Open in"

- **Tile news is on** for everyone: `FEED` in `src/config.js` is the "Web Tiles" feed
  (`at://did:plc:6vxjigxrqizmbo56gojxico3/app.bsky.feed.generator/Web-Tiles`, made with Graze), so it's
  Discover's first source.
- **The first screen** shows a Tile news row after the picks: the latest three posts (a "reply" mark on
  replies); each, and More, opens Tile news on Discover. Hidden when the feed can't be read.
- **"Open in" (Q98):** a post's link message carries "Open in [Bluesky ▾]" (Bluesky, Blacksky, mu); switching
  updates the address shown and every "Open post in …" on the page, and is remembered in this browser
  (`raku-post-app`). Ordinary links have no choice.
- **An emptied search box leaves search (Q99):** clearing Discover's search box (its × or Enter on an empty
  box), or Enter on an empty address box while on a search page, goes back to Discover and drops "Search
  results" from the sources. Searches you ran still come back with Back.

## Stage 6c, step 1 (Oct 22 2026): Recent tiles

Plan and decisions: `claude/raku-stage6c-plan.md` (Q106 to Q111).

- **Recent tiles** (`raku:discover/recent`, a clock in the sources, between Tile news and Following): the newest
  tiles on the network, as appmosphe.re lists them (`GET https://appmosphe.re/api/tiles?page=N`, 30 a page,
  newest first by each tile's `createdAt`), in appmosphe.re's own order, with More for the next page and
  "That's every tile appmosphe.re lists." after the last. Cards only: a card opens the tile's latest version
  from its author's own server, as everywhere else.
- **What a card shows:** the tile's first screenshot (else its icon, drawn whole), name, description, "by
  @handle" and how long ago it was made. Pictures come only from appmosphe.re's own copies (`/img/`), drawn as
  ordinary pictures straight from appmosphe.re, with no referrer (its `/img/` answers carry no CORS header, so a
  page can't download them to check them like the other card pictures; a picture drawn this way can't run
  anything). The page policy allows pictures from `https://appmosphe.re` for this.
- **Moderation:** tiles on the coded hide list (or whole accounts on it) are left out; each author's Bluesky
  account is checked in one request per 25 authors (`getProfiles`): a hiding label leaves out all their tiles,
  an adult or graphic label blurs their pictures. The handle shown is the one Bluesky checked (else the
  account's DID).
- **"New"** on tiles made since your last visit to Recent tiles, as in Following. The last visits (Following's
  and Recent tiles') now live in one entry on this device, `raku-marks` (`src/marks.js`, the one door to them;
  Following's older `raku-following-seen` moves in by itself). They stay on this device even when your shelf
  moves to your account later (Q111).
- Tiles already loaded in Recent tiles count in search's "Already in Raku".

## Stage 6c, Tile news fix (Oct 22 2026): one card per thread

- When the feed holds several replies from one thread, Tile news showed the thread's first post again for each
  (Q123). Now the newest card of a thread stays; later replies in the same thread aren't drawn again but counted
  on that card: "+1 more reply in this thread", which opens the thread's first post through the link message.
  A reply that arrives after More counts on the same card. The first screen's Tile news row and Discover's
  preview show one item per thread too. (`groupThreads` in `src/posts.js`.)

## Stage 6c, step 2 (Oct 22 2026): Make a tile

- **Make a tile** (`raku:discover/make`, a brush): set apart at the bottom of Discover's sources (an icon when
  narrow, the last chip on a phone), a page in Discover's centre listing tile makers in two groups (Q113):
  "No code needed" (ATMOSYNTH, Treeline, Web Tile Foundry) and "From your own files" (appmosphe.re publish),
  alphabetical inside each. Each card: a drawn mark (a letter in a glaze colour; no logos, Q118), the name,
  the site, one line on what it makes and how, and Open (the site in a new tab, no opener; Raku's own list, so
  no link message). A sentence on what a tile is and "New to tiles?" (dasl.ing) at the top. The list is
  `MAKE` in `src/config.js`.

## Faster picks, Northsky (Oct 22 2026)

Plan and decisions: `claude/raku-launch-plan.md` (Q128 to Q130).

- **The first screen's picks** draw their banners from appmosphe.re's copies (`https://appmosphe.re/img/<DID>/<CID>`,
  an ordinary picture, no referrer) instead of downloading them in full from six authors' servers; when
  appmosphe.re has no copy, the picture comes from the author's server as before. Search results that
  appmosphe.re itself gave do the same. **Your shelf, an account's tiles, Following, posts' tile cards and
  "Already in Raku" still load from the authors' servers**, so appmosphe.re never learns what you keep (Q129).
- **Northsky** joins "Open in" for posts (`northsky.app`).

## The About page (Oct 22 2026)

Plan and decisions: `claude/raku-launch-plan.md` (Q133, Q134).

- **About Raku** (`raku:about`, `src/about-page.js`): what Raku is, that browsing needs no sign-in, what stays in
  this browser, who Raku talks to and why, how tiles are kept in their box, and how to report a tile. Linked from
  the first screen's last line, the account menu's last row and Discover's right column. **Keep it true:** when
  Raku starts talking to another server or keeps something new in the browser, change the page in the same
  commit (`test/about.test.mjs` checks the servers named in `config.js` appear on it).
- **New windows from tiles:** a tile can open a link in a new tab when you click it, and that link could carry
  information about what you did in the tile; Raku allows this, as every other tile host does (`TILE_POPUPS` in
  `src/config.js`, decided Oct 22), and says so on the About page.

## szzt on Make a tile (Oct 22 2026)

- **szzt** (burrito.space's drag-and-drop publisher, a testbed for the web tile specs; burrito.space agreed Oct 22)
  joins "From your own files" after appmosphe.re publish: "Drag and drop a page, a folder or a .zip, see it run in
  the preview panel, then publish. A testbed for the web tile specs." A lowercase "s" on turquoise; glazes are now
  reused as makers are added, as long as neighbours in a group differ.

## Icons for other sites (Oct 22 2026)

- Besides `public/icon.svg` (browsers' tabs), Raku now has `public/favicon.ico` (16, 32 and 48 px),
  `public/favicon-32.png` and `public/apple-touch-icon.png` (180 px, on the bar's charcoal), all drawn from the same
  pot and linked from `index.html`. Sites that show other sites' icons (Bluesky's profile links, link previews,
  search results) usually want a PNG or `/favicon.ico` and skip SVG. They're also the start for stage 9's app icons.

## Try it

```
npm install
npm test
npm run dev
```

Then open http://127.0.0.1:5180/ (127.0.0.1, not localhost). `npm run dev` runs without the page's
security policy (Vite's dev server injects its own scripts); to see the page exactly as published:

```
npm run build
npm run preview
```

and open http://127.0.0.1:5181/.

## Files

| | |
|---|---|
| `src/config.js` | every setting: Raku's address, the loading server, limits, picks, the page policy |
| `src/address.js` | the address forms the box accepts |
| `src/net.js` | careful fetching (https, public hosts, time and size limits) |
| `src/resolve.js` | handle → account → server → a tile's record |
| `src/tiles.js` | a tile's files (adapted copy of the site's `src/lib/at-tile-loader.js`), its declared size |
| `src/moderation.js` | the coded hide list and Bluesky's moderation |
| `src/tabs.js` | the tabs as data (history, the cap, the page address) |
| `src/app.js` | the page: tab strip, address bar, panes, the first screen |
| `src/frame-guard.js` | refusing to run inside another site's frame |
| `src/icons.js` | Raku's own icons, drawn (back, forward, reload, new tab, close, shelf, star, person; stage 6: compass, search, news, people; stage 6c: clock, brush) |
| `src/shelf-store.js` | your shelf as data (this browser's storage, Export and Import) |
| `src/shelf-pages.js` | the Shelf's pages: your shelf and an account's tiles |
| `src/typeahead.js` | handle suggestions under the address box (adapted copy of Daisy's) |
| `src/tables/` | tables: the shared core, the two games' drivers, their routing rules (copies), saving (`saving.js`) and the games' record checks (copies); stage 5: Daisy's start screen (`daisy-start.js`), a table across two computers (`daisy-online.js`), signing in to sit (`daisy-sit.js`), what this browser keeps (`daisy-keep.js`) and the relay connection (`relay-connection.js`, a copy of the Daisy page's) |
| `src/auth.js` | signing in: accounts on this browser, the current one, what each sign-in covers, Always, saving a record |
| `src/signin-ui.js` | the sign-in form, Raku's dialog, the blocked-window choices |
| `src/account-menu.js` | the account button and its menu |
| `src/cards.js` | tile cards and account chips, pictures loaded as they come near |
| `src/discover.js` | stage 6: the Discover page (sources, Tile news, Recent tiles, Following, search results, previews; Make a tile) |
| `src/following.js` | the newest tiles of the accounts on your shelf, and "New since your last visit" |
| `src/recent.js` | stage 6c: Recent tiles, appmosphe.re's list read carefully and moderated |
| `src/marks.js` | stage 6c: when you last visited Following and Recent tiles (this device only) |
| `src/search.js` | search: matches here in the browser, then appmosphe.re (only the tile addresses are read) |
| `src/posts.js` | a post as data: text and facets, pictures, link cards, a linked tile, labels |
| `src/post-card.js` | a post drawn as a card |
| `src/bluesky.js` | public reads of feeds and posts (one server, `APPVIEW` in config) |
| `src/link-message.js` | the link message: where a link goes, Open / Cancel |
| `src/about-page.js` | the About page: what Raku keeps, who it talks to, how tiles are kept in their box |
| `src/style.css` | the look: raku pottery, turquoise, always dark |
| `public/` | `CNAME`, `robots.txt`, the icon (`icon.svg`, and `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png` for other sites); stage 6: `card.png` (the link card) and `banner.png` |
| `.github/workflows/deploy.yml` | test, build, check the policy is on the page and `oauth.json` names Raku's address, publish to GitHub Pages |

## Browser checks (in the chat sandbox)

`test/browser/` holds the checks run in the Claude chat sandbox (Playwright with Chromium): `servers.mjs`
(Raku's page and an "outside" server), `loader-replica.mjs` (the loading server's own files, run locally)
and `check_page.py` (126 checks: tabs, addresses, sizes, moderation, what a tile can reach, phone width,
framing, both tables played to the end against the bot), and `check_signin.py` (66 checks, stage 4:
signing in from the prompt, the bar and the menu; Allow once, Always and a save without asking; the sign-in
growing game by game; several accounts; signing out; a blocked window and "Sign in in this tab instead";
the saved records passing the games' own checks; the phone). They need a bundle of `src/main.js` and a copy of the loading server's `public/` folder; see the
top of each file. For the sign-in checks the bundle swaps in a stand-in for the sign-in library:
`esbuild src/main.js --bundle --format=esm --alias:@atproto/oauth-client-browser=./test/browser/oauth-standin.js`.

`check_discover.py` (149 checks, stage 6, 6c and the About page) runs the same way as `check_page.py`: Discover's columns at four widths,
Recent tiles (appmosphe.re's order, hidden ones, checked handles, blurred and icon pictures, More, "New"), Make a tile
(the groups, the cards, Open in a new tab, the phone), the About page (its three links, what it says, the phone),
Following (order, hidden ones, "New"), search from the box and from Discover (nothing sent while typing, one request
with only the words), a word with a dot as a handle first, Tile news from a stand-in feed with a post linking a tile,
labels, replies with their thread, the link message (Cancel, Escape, Open with no opener), a post's address in the box, the phone.

`check_daisy.py` (63 checks, stage 5) bundles and starts everything itself (Raku's page with the stand-in
sign-in, the loader replica, daisy-tiles' stand-in relay, and the site's Daisy page bundled with a stand-in
sign-in) and plays Daisy on two and three "computers" (separate browser contexts): the start screen, opening
a table and the link, no relay to reach (the Joining box and its hint), the hover on Back to the start, signing in to sit, the join message, a reload and a relay restart mid-match, the phone
width, whole matches that re-check (`verifyMatch`), saving, full, held, leaving and coming back, a match
between Raku and the Daisy page (both ways), and the house version check. Usage at the top of the file.

`check_lounge.py` (48 checks, steps 5b and 5b-2) is set up the same way, with daisy-relay's lounge stand-in
(`test/lounge-standin.mjs`, the real server.js and lounge.js with stand-in lookups) as the relay: mingling
from signed out (one window) and from signed in (Continue, one short window), the record and the pass, who
else is mingling, Invite / Not now / No answer, Play to one table at the right seats, "here" only while the
start screen is the tab in front and Raku is seen, one lounge with the Daisy page, the same account in two
places, mingling off (the record deleted), a reload while mingling, the phone width.
