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
  box. Cards, read live from the account's own server, 100 at a time with More; tiles Raku can't run are
  greyed with the reason; hidden tiles aren't listed.
- **The star** at the end of the address box keeps the tile (or, on an account's page, the account) on your
  shelf. Cards open in the same tab (Back returns), or in a new tab from a card's corner.
- The first screen shows the latest few kept tiles under the picks.

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
| `src/icons.js` | Raku's own icons, drawn (back, forward, reload, new tab, close, shelf, star) |
| `src/shelf-store.js` | your shelf as data (this browser's storage, Export and Import) |
| `src/shelf-pages.js` | the Shelf's pages: your shelf and an account's tiles |
| `src/cards.js` | tile cards and account chips, pictures loaded as they come near |
| `src/style.css` | the look: raku pottery, turquoise, always dark |
| `public/` | `CNAME`, `robots.txt`, the icon |
| `.github/workflows/deploy.yml` | test, build, check the policy is on the page, publish to GitHub Pages |

## Browser checks (in the chat sandbox)

`test/browser/` holds the checks run in the Claude chat sandbox (Playwright with Chromium): `servers.mjs`
(Raku's page and an "outside" server), `loader-replica.mjs` (the loading server's own files, run locally)
and `check_page.py` (95 checks: tabs, addresses, sizes, moderation, what a tile can reach, phone width,
framing). They need a bundle of `src/main.js` and a copy of the loading server's `public/` folder; see the
top of each file.
