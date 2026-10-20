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

- **Seven-Up and Daisy** play in a tab (`raku:table/sevenup`, `raku:table/daisy`), from the first screen's
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
  Raku doesn't touch your posts, likes, follows or anything else."
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
| `src/icons.js` | Raku's own icons, drawn (back, forward, reload, new tab, close, shelf, star, person) |
| `src/shelf-store.js` | your shelf as data (this browser's storage, Export and Import) |
| `src/shelf-pages.js` | the Shelf's pages: your shelf and an account's tiles |
| `src/typeahead.js` | handle suggestions under the address box (adapted copy of Daisy's) |
| `src/tables/` | tables: the shared core, the two games' drivers, their routing rules (copies), saving (`saving.js`) and the games' record checks (copies) |
| `src/auth.js` | signing in: accounts on this browser, the current one, what each sign-in covers, Always, saving a record |
| `src/signin-ui.js` | the sign-in form, Raku's dialog, the blocked-window choices |
| `src/account-menu.js` | the account button and its menu |
| `src/cards.js` | tile cards and account chips, pictures loaded as they come near |
| `src/style.css` | the look: raku pottery, turquoise, always dark |
| `public/` | `CNAME`, `robots.txt`, the icon |
| `.github/workflows/deploy.yml` | test, build, check the policy is on the page and `oauth.json` names Raku's address, publish to GitHub Pages |

## Browser checks (in the chat sandbox)

`test/browser/` holds the checks run in the Claude chat sandbox (Playwright with Chromium): `servers.mjs`
(Raku's page and an "outside" server), `loader-replica.mjs` (the loading server's own files, run locally)
and `check_page.py` (121 checks: tabs, addresses, sizes, moderation, what a tile can reach, phone width,
framing, both tables played to the end against the bot), and `check_signin.py` (66 checks, stage 4:
signing in from the prompt, the bar and the menu; Allow once, Always and a save without asking; the sign-in
growing game by game; several accounts; signing out; a blocked window and "Sign in in this tab instead";
the saved records passing the games' own checks; the phone). They need a bundle of `src/main.js` and a copy of the loading server's `public/` folder; see the
top of each file. For the sign-in checks the bundle swaps in a stand-in for the sign-in library:
`esbuild src/main.js --bundle --format=esm --alias:@atproto/oauth-client-browser=./test/browser/oauth-standin.js`.
