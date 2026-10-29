// Stage 9: Raku as an installable web app (claude/raku-stage9-plan.md). The manifest and icons, the page
// policy, the service worker's ground rule, the offline page, the update rule and the install offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { SITE, pageCsp } from '../src/config.js';
import { RAKU_ICON, RAKU_ICON_URL } from '../src/icons.js';
import { watchTitleBar, isInstalled, registerWorker, fetchBuild, createUpdateCheck, createInstallOffer, CHECK_EVERY_MS, START_WINDOW_MS, RELOAD_KEY, VERSION_URL, WORKER_URL } from '../src/app-shell.js';
import { INSTALL_STEPS, INSTALL_INTRO, INSTALL_KEEPS } from '../src/about-page.js';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bytes = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const pngSize = (p) => { const b = bytes(p); assert.equal(b.toString('latin1', 1, 4), 'PNG', p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const pngHasAlpha = (p) => bytes(p)[25] === 6;          // colour type 6: RGBA

// ---------- the manifest and the icons ----------

test('the manifest: Raku in its own window, on its own address, linked from the page', () => {
  const m = JSON.parse(file('public/manifest.webmanifest'));
  assert.equal(m.name, SITE.name);
  assert.equal(m.short_name, SITE.name);
  assert.equal(m.id, '/');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.display_override, ['window-controls-overlay'], 'S7: the tabs in the title bar where the browser allows it');
  const theme = file('index.html').match(/<meta name="theme-color" content="([^"]+)">/)[1];
  assert.equal(m.theme_color, theme, "the page's own theme colour");
  assert.equal(m.background_color, '#171411', "Raku's stage colour (style.css --stage)");
  assert.match(file('src/style.css'), /--stage: #171411;/);
  assert.match(file('index.html'), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.ok(!file('public/manifest.webmanifest').includes('http'), 'no outside addresses: an installed app is tied to this one');
});

test('the app icons (S5: T2): 192 and 512, plain and maskable, at their stated sizes', () => {
  const { icons } = JSON.parse(file('public/manifest.webmanifest'));
  const seen = icons.map((i) => `${i.purpose} ${i.sizes}`).sort();
  assert.deepEqual(seen, ['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512']);
  for (const i of icons) {
    assert.equal(i.type, 'image/png');
    const [w, h] = pngSize(`public${i.src}`);
    assert.equal(`${w}x${h}`, i.sizes, i.src);
    // the plain icon is the rounded tile (its corners see-through); the maskable one fills its square (Android crops it)
    assert.equal(pngHasAlpha(`public${i.src}`), i.purpose === 'any', `${i.src}: ${i.purpose === 'any' ? 'corners see-through' : 'opaque, full-bleed'}`);
  }
  assert.deepEqual(pngSize('public/apple-touch-icon.png'), [180, 180]);
  assert.equal(pngHasAlpha('public/apple-touch-icon.png'), false, 'iPhones fill see-through parts with black: opaque');
});

test("the favicon (S5: B): the pot alone, and the signal pip's copy is the same drawing", () => {
  const svg = file('public/icon.svg');
  assert.ok(!svg.includes('<rect'), 'no tile behind the pot');
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/<\/svg>\s*$/, '');
  assert.equal(inner, RAKU_ICON, 'src/icons.js RAKU_ICON matches public/icon.svg');
  assert.match(RAKU_ICON, /scale\(1\.6\)/, 'enlarged');
  assert.match(RAKU_ICON, /stroke="#26211d" stroke-width="2\.2"/, 'the thin charcoal outline');
  assert.match(RAKU_ICON, /M22 30l6 6-3 7M38 27l-4 8 7 5/, 'both cracks (owner: one crack loses the crackle)');
  assert.equal(pngHasAlpha('public/favicon-32.png'), true, 'see-through around the pot');
  assert.ok(decodeURIComponent(RAKU_ICON_URL).includes(RAKU_ICON), 'S8: the pot beside the Raku label is the same drawing');
});

test('S7: the title-bar mode keeps a grip free and keeps clear of the window buttons', () => {
  const css = file('src/style.css');
  assert.match(css, /:root\.wco \.strip-row \{[^}]*env\(titlebar-area-x[^}]*env\(titlebar-area-width[^}]*env\(titlebar-area-height[^}]*-webkit-app-region: drag/);
  assert.match(css, /:root\.wco \.strip-row \.tab, :root\.wco \.strip-row \.tab-x, :root\.wco \.strip-row \.newtab \{[^}]*-webkit-app-region: no-drag/);
  assert.match(css, /:root\.wco \.wco-grip \{[^}]*min-width: 40px/);
  assert.match(file('src/app.js'), /class: 'wco-grip'/);
});

test('S7: the class follows the browser: on while the title bar is folded away, off when it comes back', () => {
  const classes = new Set();
  let listener = null;
  const overlay = { visible: true, addEventListener: (t, f) => { if (t === 'geometrychange') listener = f; } };
  const win = { navigator: { windowControlsOverlay: overlay }, document: { documentElement: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } } };
  assert.equal(watchTitleBar(win), true);
  assert.ok(classes.has('wco'));
  overlay.visible = false; listener();
  assert.ok(!classes.has('wco'));
  assert.equal(watchTitleBar({ navigator: {}, document: { documentElement: {} } }), false, 'other browsers: nothing');
});

// ---------- the page policy ----------

test("the page policy allows Raku's own worker and manifest, nothing else", () => {
  const p = pageCsp();
  assert.match(p, /worker-src 'self';/);
  assert.match(p, /manifest-src 'self';/);
  assert.doesNotMatch(p, /worker-src[^;]*(https?:|\*|blob:)/);
});

// ---------- the service worker ----------

function loadWorker() {
  const handlers = {};
  const cache = new Map();
  const caches = new Map([['raku-offline-v0', new Map()], ['someone-else', new Map()]]);
  const fetched = [];
  let online = true;
  const sandbox = {
    self: { location: { origin: 'https://raku.lexicographer.space' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async (name) => { if (!caches.has(name)) caches.set(name, cache); return { add: async (req) => { cache.set(new URL(req.url, 'https://raku.lexicographer.space').pathname, { offline: true, cache: req.cache }); } }; },
      keys: async () => [...caches.keys()],
      delete: async (k) => caches.delete(k),
      match: async (url) => cache.get(url),
    },
    fetch: async (req, init) => { fetched.push({ url: req.url, init }); if (!online) throw new TypeError('offline'); return { network: true }; },
    Request: class { constructor(url, init) { this.url = url; this.cache = init && init.cache; } },
    Response: { error: () => ({ error: true }) },
    URL,
  };
  vm.runInNewContext(file('public/sw.js'), sandbox);
  const run = async (type, ev) => { let p = null; let answered = null; const e = { ...ev, waitUntil: (x) => { p = x; }, respondWith: (x) => { answered = x; } }; handlers[type](e); if (p) await p; return answered ? await answered : undefined; };
  return { run, cache, caches, fetched, goOffline: () => { online = false; } };
}
const nav = (url, extra = {}) => ({ request: { url, mode: 'navigate', method: 'GET', ...extra } });

test('the worker keeps only the offline page, and clears only older pages of its own', async () => {
  const w = loadWorker();
  await w.run('install', {});
  assert.deepEqual([...w.cache.keys()], ['/offline.html']);
  assert.equal(w.cache.get('/offline.html').cache, 'reload', 'a fresh copy from the network');
  await w.run('activate', {});
  assert.deepEqual([...w.caches.keys()].sort(), ['raku-offline-v1', 'someone-else']);
});

test("the ground rule: only navigations to Raku's own address, network first; everything else untouched", async () => {
  const w = loadWorker();
  await w.run('install', {});
  // opening Raku (a reload, a sign-in's return): the network, asking for a fresh copy
  assert.deepEqual(await w.run('fetch', nav('https://raku.lexicographer.space/#t=raku%3Ashelf&a=0')), { network: true });
  assert.equal(w.fetched.at(-1).init.cache, 'no-cache');
  assert.deepEqual(await w.run('fetch', nav('https://raku.lexicographer.space/?code=x&state=y')), { network: true });
  // not answered at all, so the browser fetches them as if there were no worker
  for (const req of [
    { url: 'https://raku.lexicographer.space/assets/main-abc.js', mode: 'cors', method: 'GET' },
    { url: 'https://raku.lexicographer.space/version.json', mode: 'cors', method: 'GET' },
    { url: 'https://raku.lexicographer.space/oauth.json', mode: 'cors', method: 'GET' },
    { url: 'https://load.tiles.lexicographer.space/.well-known/web-tiles/', mode: 'navigate', method: 'GET' },
    { url: 'https://abcdefgh.tiles.lexicographer.space/', mode: 'navigate', method: 'GET' },
    { url: 'https://plc.directory/did:plc:x', mode: 'cors', method: 'GET' },
    { url: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile', mode: 'cors', method: 'GET' },
    { url: 'https://appmosphe.re/api/tiles?page=1', mode: 'cors', method: 'GET' },
    { url: 'https://lexicographer.space/hidden-tiles.json', mode: 'cors', method: 'GET' },
    { url: 'https://raku.lexicographer.space/', mode: 'navigate', method: 'POST' },
  ]) assert.equal(await w.run('fetch', { request: req }), undefined, req.url);
  assert.equal(w.fetched.length, 2, 'only the two navigations were fetched by the worker');
});

test('offline: opening Raku shows its own "needs the internet" page', async () => {
  const w = loadWorker();
  await w.run('install', {});
  w.goOffline();
  assert.deepEqual(await w.run('fetch', nav('https://raku.lexicographer.space/#t=x')), { offline: true, cache: 'reload' });
});

// ---------- the offline page ----------

test('the offline page: the agreed words, self-contained, its own style and script allowed by hash only', () => {
  const html = file('public/offline.html');
  assert.match(html, /<h1>Raku needs the internet<\/h1>/);
  assert.match(html, /Tiles and Raku’s pages come from the network, so there’s nothing to show right now\. Raku will carry on by itself when you’re back online\./);
  assert.match(html, /<button type="button" id="again">Try now<\/button>/);
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  const hash = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(csp.includes(`style-src ${hash(style)}`), 'the style hash is current');
  assert.ok(csp.includes(`script-src ${hash(script)}`), 'the script hash is current');
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe/);
  assert.doesNotMatch(html, /(src|href)="https?:/, 'nothing from outside');
  assert.ok(html.includes(RAKU_ICON), 'the same pot as the favicon');
  assert.match(script, /addEventListener\('online', again\)/);
  assert.match(script, /location\.reload\(\)/, 'a reload keeps the address, and so the tabs');
});

// ---------- the update rule ----------

const answer = (build) => async (url, init) => { assert.equal(url, VERSION_URL); assert.equal(init.cache, 'no-store'); return { ok: true, json: async () => ({ build }) }; };
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('the build id comes from the build; version.json is written by it', async () => {
  assert.match(file('vite.config.js'), /__RAKU_BUILD__/);
  assert.match(file('vite.config.js'), /fileName: 'version\.json'/);
  assert.equal(await fetchBuild(answer('abc123')), 'abc123');
  assert.equal(await fetchBuild(async () => ({ ok: false })), null);
  assert.equal(await fetchBuild(async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchBuild(async () => ({ ok: true, json: async () => ({}) })), null);
});

test('on start: a newer version reloads once; the same version does nothing', async () => {
  let t = 1000; let reloads = 0; const notes = [];
  const session = memory();
  const u = createUpdateCheck({ buildId: 'old', fetchFn: answer('new'), session, now: () => t, startedAt: t, reload: () => reloads++, onNewer: (b) => notes.push(b) });
  assert.equal(await u.check(), 'reload');
  assert.equal(reloads, 1);
  assert.equal(session.getItem(RELOAD_KEY), 'new');
  // the reloaded page still says "old" (a stale copy somewhere): no second reload, the note instead
  const again = createUpdateCheck({ buildId: 'old', fetchFn: answer('new'), session, now: () => t, startedAt: t, reload: () => reloads++, onNewer: (b) => notes.push(b) });
  assert.equal(await again.check(), 'newer');
  assert.equal(reloads, 1, 'never a reload loop');
  assert.deepEqual(notes, ['new']);
  const same = createUpdateCheck({ buildId: 'new', fetchFn: answer('new'), session, now: () => t, startedAt: t, reload: () => reloads++, onNewer: (b) => notes.push(b) });
  assert.equal(await same.check(), 'same');
  assert.equal(session.getItem(RELOAD_KEY), null, 'up to date: forgotten');
});

test('while open: only a note, never a reload (S2); looks again at most every ten minutes', async () => {
  let t = 0; let reloads = 0; const notes = []; let asked = 0;
  const fetchFn = async (url, init) => { asked++; return answer('new')(url, init); };
  const u = createUpdateCheck({ buildId: 'old', fetchFn, session: memory(), now: () => t, startedAt: 0, reload: () => reloads++, onNewer: (b) => notes.push(b) });
  t = START_WINDOW_MS + 1;
  assert.equal(await u.check(), 'newer');
  assert.equal(reloads, 0);
  assert.equal(await u.maybe(), 'skipped');
  t += CHECK_EVERY_MS - 1;
  assert.equal(await u.maybe(), 'skipped');
  t += 2;
  assert.equal(await u.maybe(), 'newer');
  assert.equal(asked, 2);
  assert.deepEqual(notes, ['new', 'new']);
  assert.equal(u.found, 'new');
});

test('without browser storage, or just back from a sign-in: the note, not a reload', async () => {
  let reloads = 0; const notes = [];
  const a = createUpdateCheck({ buildId: 'old', fetchFn: answer('new'), session: null, now: () => 0, startedAt: 0, reload: () => reloads++, onNewer: (b) => notes.push(b) });
  assert.equal(await a.check(), 'newer');
  const b = createUpdateCheck({ buildId: 'old', fetchFn: answer('new'), session: memory(), now: () => 0, startedAt: -Infinity, reload: () => reloads++, onNewer: (x) => notes.push(x) });
  assert.equal(await b.check(), 'newer');
  assert.equal(reloads, 0);
  assert.equal(notes.length, 2);
});

test('under npm run dev nothing is checked or registered', async () => {
  const u = createUpdateCheck({ buildId: 'dev', fetchFn: () => { throw new Error('should not ask'); } });
  assert.equal(await u.check(), 'unknown');
  const win = { matchMedia: () => ({ matches: true }), navigator: { serviceWorker: { register: () => { throw new Error('should not register'); } } } };
  assert.equal(await registerWorker({ win, buildId: 'dev' }), false);
});

// ---------- installed or not, the worker, the install offer ----------

const fakeWin = ({ standalone = false, iphone = false, sw = true } = {}) => {
  const listeners = {};
  const registered = [];
  return {
    listeners, registered,
    matchMedia: (q) => ({ matches: standalone && q === '(display-mode: standalone)' }),
    navigator: { standalone: iphone ? true : undefined, serviceWorker: sw ? { register: async (url, opts) => { registered.push({ url, opts }); } } : undefined },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    fire: (t, ev = {}) => { for (const f of listeners[t] || []) f(ev); },
  };
};

test('the worker is registered only when Raku runs installed, for its own address only', async () => {
  const tab = fakeWin();
  assert.equal(isInstalled(tab), false);
  assert.equal(await registerWorker({ win: tab, buildId: 'b1' }), false);
  assert.deepEqual(tab.registered, []);
  const app = fakeWin({ standalone: true });
  assert.equal(isInstalled(app), true);
  assert.equal(await registerWorker({ win: app, buildId: 'b1' }), true);
  assert.deepEqual(app.registered, [{ url: WORKER_URL, opts: { scope: '/', updateViaCache: 'none' } }]);
  assert.equal(isInstalled(fakeWin({ iphone: true })), true, "an iPhone's home screen");
  assert.equal(await registerWorker({ win: fakeWin({ standalone: true, sw: false }), buildId: 'b1' }), false, 'no service workers: fine');
});

test('the install offer: shown while the browser offers it, used once, gone once installed', async () => {
  const win = fakeWin();
  const offer = createInstallOffer(win);
  let changes = 0;
  offer.onChange(() => changes++);
  assert.equal(offer.available(), false);
  let prevented = false; let prompted = 0;
  const ev = { preventDefault: () => { prevented = true; }, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  win.fire('beforeinstallprompt', ev);
  assert.equal(prevented, true);
  assert.equal(offer.available(), true);
  assert.equal(await offer.prompt(), 'accepted');
  assert.equal(prompted, 1);
  assert.equal(offer.available(), false, 'each offer is used once');
  assert.equal(await offer.prompt(), 'unavailable');
  win.fire('beforeinstallprompt', { ...ev, preventDefault: () => {} });
  assert.equal(offer.available(), true);
  win.fire('appinstalled');
  assert.equal(offer.available(), false);
  assert.ok(changes >= 3);
  // running installed: never offered
  const inApp = fakeWin({ standalone: true });
  const o2 = createInstallOffer(inApp);
  inApp.fire('beforeinstallprompt', ev);
  assert.equal(o2.available(), false);
});

// ---------- the About page ----------

test("the About page's Install section: the agreed steps for each browser", () => {
  assert.equal(INSTALL_INTRO, 'Raku can have its own window and icon, like an app. It’s the same Raku, with the same privacy.');
  assert.deepEqual(INSTALL_STEPS.map(([w]) => w), ['Chrome or Edge', 'iPhone or iPad', 'Safari on a Mac', 'Firefox']);
  assert.match(INSTALL_STEPS[0][1], /“Install Raku” in the account menu, or the install icon at the right of the address bar/);
  assert.match(INSTALL_STEPS[1][1], /Share → Add to Home Screen.*its own shelf and sign-ins, separate from Safari’s; use Export and Import/);
  assert.match(INSTALL_STEPS[2][1], /File → Add to Dock/);
  assert.match(INSTALL_KEEPS, /never tiles or anything you open/);
});
