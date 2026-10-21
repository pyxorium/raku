// Raku starts here.
import './style.css';
import { TileMothership } from '@dasl/tile-loader';
import { TILE_LOAD_DOMAIN, SITE, SIGNIN, loadSourceOverride } from './config.js';
import { isFramed, showOpenInOwnTab } from './frame-guard.js';
import { createResolver } from './resolve.js';
import { createModeration } from './moderation.js';
import { createFileStore } from './tiles.js';
import { createShelf, STORAGE_KEY } from './shelf-store.js';
import { createAuth, isSignInReturn } from './auth.js';
import { mountRaku } from './app.js';

const root = document.getElementById('raku');
const guarded = (f) => { try { return f(); } catch { return null; } };

// The sign-in library loads on its own (only saving needs it): browsing starts without waiting for it.
const signInLib = () => import('@atproto/oauth-client-browser');

async function start() {
  if (isFramed()) { showOpenInOwnTab(root, SITE.origin + '/'); return; }
  const storage = guarded(() => globalThis.localStorage);
  const session = guarded(() => globalThis.sessionStorage);
  const resolver = createResolver();
  const auth = createAuth(signInLib, { storage, handleFor: (did) => resolver.checkedHandle(did) });

  let returned = null;
  if (isSignInReturn(globalThis.location)) {
    // The end of a sign-in. In the small window: say so and stop (the main tab has the result). In this
    // tab, after "Sign in in this tab instead": put the tabs back, then start Raku.
    root.replaceChildren(Object.assign(document.createElement('p'), { className: 'signin-wait', textContent: 'Finishing signing in…' }));
    const r = await auth.start();
    if (r.finishedInWindow) {
      root.replaceChildren(Object.assign(document.createElement('p'), { className: 'signin-done', textContent: 'Signed in. You can close this window.' }));
      return;
    }
    if (r.moving) return;
    const pending = guarded(() => JSON.parse(session.getItem(SIGNIN.returnKey)));
    guarded(() => session.removeItem(SIGNIN.returnKey));
    guarded(() => history.replaceState(null, '', location.pathname + location.search.replace(/[?&](state|code|iss|error|error_description)=[^&]*/g, '').replace(/^&/, '?') + (pending && typeof pending.hash === 'string' ? pending.hash : '')));
    returned = { did: r.returned ? r.returned.did : null, pending: r.returned ? pending : null };
  }

  // One shared tile loader ("mothership") for the whole page: each one listens to every message on
  // the page, so several would trip over each other's tiles.
  const mothership = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
  const override = loadSourceOverride();
  if (override) mothership.getLoadSource = () => override;
  mothership.init();

  const moderation = createModeration({ storage });
  moderation.refresh();
  const shelf = createShelf({ storage });
  // Another Raku tab changed your shelf: read it again.
  globalThis.addEventListener('storage', (ev) => { if (ev.key === STORAGE_KEY) shelf.reload(); });
  const keepForReturn = (info) => guarded(() => session.setItem(SIGNIN.returnKey, JSON.stringify(info)));
  globalThis.__raku = mountRaku(root, { mothership, resolver, moderation, files: createFileStore(), shelf, auth, storage, returned, keepForReturn });
  if (!returned) auth.start();
}
start();
