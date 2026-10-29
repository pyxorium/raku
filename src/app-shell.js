// Raku as an installable web app (stage 9, claude/raku-stage9-plan.md): the parts that aren't the page itself.
//
// - The service worker (public/sw.js) is registered only when Raku runs installed (its own window, or an
//   iPhone's home screen). Its one job: with no connection, answer with Raku's own "Raku needs the internet"
//   page (S1, B). It touches nothing but navigations to Raku's own address; tiles, account servers, Bluesky,
//   appmosphe.re, relays and everything else go straight to the network, never cached.
// - The update rule (S2, A): the build writes its id into the page (__RAKU_BUILD__) and into /version.json.
//   On start, a newer version is taken at once (one reload, before anything has run for long); while Raku is
//   open, it looks again now and then and only shows a note: the person chooses when to reload.
// - The install offer (S3, A): Chrome and Edge say when Raku can be installed (beforeinstallprompt); the
//   account menu then offers "Install Raku", unless Raku already runs installed.
//
// Plain functions with their surroundings passed in, so the rules run in Node tests too.

/* global __RAKU_BUILD__ */
/** This build's id (set by `npm run build`; "dev" under `npm run dev`, which never registers the worker). */
export const BUILD_ID = typeof __RAKU_BUILD__ === 'string' ? __RAKU_BUILD__ : 'dev';
export const VERSION_URL = '/version.json';
export const WORKER_URL = '/sw.js';
/** Looking again while open: at most this often (when the window comes back into view, or on a timer). */
export const CHECK_EVERY_MS = 10 * 60 * 1000;
export const TIMER_EVERY_MS = 60 * 60 * 1000;
/** On start, a newer version found within this long reloads at once; later, it's a note like any other. */
export const START_WINDOW_MS = 5000;
/** Remembers, per tab, which build a start-up reload was for, so a stale copy can never reload in a loop. */
export const RELOAD_KEY = 'raku-reloaded-for';

/** Is Raku running installed (its own window, or added to an iPhone's home screen)? */
export function isInstalled(win = globalThis) {
  try {
    if (win.navigator && win.navigator.standalone === true) return true;      // Safari on iPhone and iPad
    const mm = (q) => (typeof win.matchMedia === 'function' ? win.matchMedia(q).matches : false);
    return mm('(display-mode: standalone)') || mm('(display-mode: window-controls-overlay)') || mm('(display-mode: minimal-ui)');
  } catch { return false; }
}

/** Registers the worker when installed (not under `npm run dev`). Resolves to true when registered. */
export async function registerWorker({ win = globalThis, buildId = BUILD_ID } = {}) {
  if (buildId === 'dev' || !isInstalled(win)) return false;
  const sw = win.navigator && win.navigator.serviceWorker;
  if (!sw || typeof sw.register !== 'function') return false;
  try {
    // updateViaCache 'none': the browser always asks the network for sw.js itself, so a changed worker is
    // picked up on the next start.
    await sw.register(WORKER_URL, { scope: '/', updateViaCache: 'none' });
    return true;
  } catch { return false; }
}

/** Reads /version.json from the network (never a cached copy). Resolves to the build id, or null. */
export async function fetchBuild(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(VERSION_URL, { cache: 'no-store', credentials: 'omit' });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && typeof j.build === 'string' && j.build.length <= 100 ? j.build : null;
  } catch { return null; }
}

/**
 * The update rule. onNewer(build) shows the note; reload() reloads the page. check() looks now (it says what it
 * found: 'same', 'newer', 'reload' or 'unknown'); maybe() looks unless it looked within CHECK_EVERY_MS.
 */
export function createUpdateCheck({ buildId = BUILD_ID, fetchFn = globalThis.fetch, onNewer = () => {}, reload = () => {}, session = null, now = () => Date.now(), startedAt = now() } = {}) {
  let last = 0;
  let found = null;
  const reloadedFor = () => { try { return session ? session.getItem(RELOAD_KEY) : null; } catch { return null; } };
  async function check() {
    if (buildId === 'dev') return 'unknown';
    last = now();
    const build = await fetchBuild(fetchFn);
    if (!build) return 'unknown';
    if (build === buildId) { try { if (session) session.removeItem(RELOAD_KEY); } catch { /* fine */ } return 'same'; }
    // Starting up, nothing has run for long: take the new version now, once.
    if (now() - startedAt <= START_WINDOW_MS && reloadedFor() !== build && session) {
      try { session.setItem(RELOAD_KEY, build); } catch { /* without storage: no start-up reload, the note instead */ }
      if (reloadedFor() === build) { reload(); return 'reload'; }
    }
    found = build;
    onNewer(build);
    return 'newer';
  }
  function maybe() {
    if (now() - last < CHECK_EVERY_MS) return Promise.resolve('skipped');
    return check();
  }
  return { check, maybe, get found() { return found; } };
}

/** Starts the update rule on a page: on start, when Raku comes back into view, and once an hour. */
export function watchForUpdates(win, check) {
  check.check();
  const onView = () => { if (win.document.visibilityState !== 'hidden') check.maybe(); };
  win.document.addEventListener('visibilitychange', onView);
  win.addEventListener('focus', onView);
  win.addEventListener('online', onView);
  const timer = win.setInterval(() => { if (win.document.visibilityState !== 'hidden') check.maybe(); }, TIMER_EVERY_MS);
  return () => { win.document.removeEventListener('visibilitychange', onView); win.removeEventListener('focus', onView); win.removeEventListener('online', onView); win.clearInterval(timer); };
}

/**
 * The tabs in the title bar (S7, "window controls overlay", Chrome and Edge on a computer). While the installed
 * window's title bar is folded away, <html> carries the class "wco" and style.css lays the tab row out as the title
 * bar. The browser says when that changes (the person's own button in the title bar).
 */
export function watchTitleBar(win = globalThis) {
  const wco = win.navigator && win.navigator.windowControlsOverlay;
  const root = win.document && win.document.documentElement;
  if (!wco || !root) return false;
  const apply = () => { root.classList.toggle('wco', !!wco.visible); };
  apply();
  if (typeof wco.addEventListener === 'function') wco.addEventListener('geometrychange', apply);
  return true;
}

/**
 * The install offer. Listens from the first moment (main.js), because the browser may say so before Raku has
 * drawn anything. available() is true while the browser offers installing and Raku isn't running installed.
 */
export function createInstallOffer(win = globalThis) {
  let offer = null;
  const fns = new Set();
  const tell = () => { for (const f of fns) { try { f(); } catch { /* fine */ } } };
  win.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();                 // no mini-bar of the browser's own on Android: the menu row offers it
    offer = ev;
    tell();
  });
  win.addEventListener('appinstalled', () => { offer = null; tell(); });
  return {
    available: () => !!offer && typeof offer.prompt === 'function' && !isInstalled(win),
    onChange: (f) => { fns.add(f); return () => fns.delete(f); },
    /** Opens the browser's own install box. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
    async prompt() {
      const ev = offer;
      if (!ev || typeof ev.prompt !== 'function') return 'unavailable';
      offer = null;                      // the browser lets each offer be used once
      tell();
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch { return 'dismissed'; }
    },
  };
}
