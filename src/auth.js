// Signing in and saving (stage 4, claude/raku-stage4-plan.md).
//
// Browsing never needs a sign-in; signing in is only for saving match results from Raku's tables. Adapted
// from the site's src/sevenup/auth.js and src/daisy/auth.js (COPY, Oct 20 2026), with Raku's own choices:
//   - several accounts signed in on this browser, one of them current (Q38): createAccounts() below;
//   - the permissions grow game by game (Q36): a sign-in asks for your account plus the sets of the
//     tables it's for (config.js scopeFor); Raku remembers what each account's sign-in covers (its
//     token's scope) so it knows, before a click, whether a window is needed (browsers only allow a new
//     window straight from a click, before anything that waits);
//   - the sign-in opens in a small window (popup), so running tiles and the match stay as they are; when
//     the window is blocked, "Sign in in this tab instead" goes to the account server in this tab and
//     comes back (Q41; app.js keeps what's needed in sessionStorage);
//   - "Always" choices per account and game, in this browser (Q37).
// Uses @atproto/oauth-client-browser 0.5.8 (as the site and the Foundry). createAuth takes the library's
// exports (loaded when needed), so the browser checks can hand in a stand-in (test/browser/oauth-standin.js).
import { SIGNIN, fullScope, scopeFor, coversTable, coversLounge, tablesCovered, TABLES } from './config.js';

export class SignInNeeded extends Error {}
export class SignInStopped extends Error {}

export const isLocal = (loc) => ['127.0.0.1', 'localhost', '[::1]'].includes(loc.hostname);

// On this computer: a loopback sign-in (no description file needed; the account server builds one from
// this address). Raku must be opened at 127.0.0.1, not localhost (the library moves it).
export function clientIdFor(loc = globalThis.location) {
  if (!isLocal(loc)) return SIGNIN.clientId;
  const port = loc.port ? `:${loc.port}` : '';
  return `http://localhost?redirect_uri=${encodeURIComponent(`http://127.0.0.1${port}/`)}&scope=${encodeURIComponent(fullScope())}`;
}

/** Is this page load the end of a sign-in (the account server sent the browser back here)? */
export function isSignInReturn(loc = globalThis.location) {
  const q = `${loc.search || ''}&${String(loc.hash || '').replace(/^#/, '')}`;
  return /(^|[?&])state=/.test(q) && /(^|[?&])(code|error)=/.test(q);
}

/** What someone typed to sign in: a handle (with or without @) or a DID. → text, or null */
export function cleanHandle(text) {
  const t = String(text || '').trim().replace(/^@/, '').toLowerCase();
  if (/^did:[a-z]+:[a-z0-9._:%-]+$/i.test(t)) return t;
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(t) && t.length <= 253) return t;
  return null;
}

const guarded = (f, fallback = null) => { try { return f(); } catch { return fallback; } };

/**
 * What this browser remembers about the accounts signed in here (no secrets: the library keeps the
 * sign-ins themselves in IndexedDB). DIDs count; handles are for showing.
 *   localStorage raku-accounts  [{ did, handle }]   (newest first, at most 10)
 *   localStorage raku-account   the current account's DID
 *   localStorage raku-always    { "<did> <table id>": true }  ("Always" for that game, Q37)
 */
export function createAccounts(storage) {
  const read = (key, fallback) => guarded(() => JSON.parse(storage.getItem(key)) ?? fallback, fallback);
  const write = (key, value) => guarded(() => { storage.setItem(key, JSON.stringify(value)); return true; }, false);
  const ok = (a) => a && typeof a.did === 'string' && /^did:[a-z]+:/.test(a.did) && typeof a.handle === 'string';
  const list = () => (Array.isArray(read(SIGNIN.accountsKey, [])) ? read(SIGNIN.accountsKey, []) : []).filter(ok).slice(0, 10);
  const always = () => { const v = read(SIGNIN.alwaysKey, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  return {
    list,
    get(did) { return list().find((a) => a.did === did) || null; },
    add(did, handle) {
      const was = list().find((a) => a.did === did);
      write(SIGNIN.accountsKey, [{ did, handle: handle || was?.handle || did }, ...list().filter((a) => a.did !== did)].slice(0, 10));
    },
    remove(did) {
      const wasCurrent = read(SIGNIN.currentKey, null) === did;
      write(SIGNIN.accountsKey, list().filter((a) => a.did !== did));
      const a = always();
      for (const k of Object.keys(a)) if (k.startsWith(`${did} `)) delete a[k];
      write(SIGNIN.alwaysKey, a);
      if (wasCurrent || this.current() === null) write(SIGNIN.currentKey, list()[0]?.did ?? null);
    },
    /** The current account's DID (one of the list), or null. */
    current() {
      const did = read(SIGNIN.currentKey, null);
      const l = list();
      return l.some((a) => a.did === did) ? did : null;
    },
    setCurrent(did) { write(SIGNIN.currentKey, did); },
    hasAlways(did, tableId) { return always()[`${did} ${tableId}`] === true; },
    setAlways(did, tableId, on) {
      const a = always();
      if (on) a[`${did} ${tableId}`] = true; else delete a[`${did} ${tableId}`];
      return write(SIGNIN.alwaysKey, a);
    },
    /** [{ did, tableId }] for the accounts still signed in here, games still on Raku's list. */
    alwaysList() {
      const dids = new Set(list().map((a) => a.did));
      return Object.keys(always()).map((k) => { const [did, tableId] = k.split(' '); return { did, tableId }; })
        .filter((e) => dids.has(e.did) && TABLES[e.tableId]);
    },
  };
}

/**
 * The sign-in itself. getLib() → { BrowserOAuthClient, LoginContinuedInParentWindowError } (the
 * library's exports, or the browser checks' stand-in). handleFor(did) → a checked handle or null.
 */
export function createAuth(getLib, { storage, loc = globalThis.location, win = globalThis, handleFor = async () => null } = {}) {
  const accounts = createAccounts(storage);
  let client = null;
  let problem = null;
  const sessions = new Map();          // did → the library's session
  const scopes = new Map();            // did → what its sign-in covers (the token's scope)
  const restoring = new Map();
  const listeners = new Set();
  let readyNow;
  const readyP = new Promise((r) => { readyNow = r; });
  const emit = (what = {}) => listeners.forEach((fn) => { try { fn(what); } catch (err) { console.error('[raku] sign-in listener', err); } });

  async function tokenScope(session) {
    try { const info = await session.getTokenInfo(false); return typeof info?.scope === 'string' ? info.scope : ''; } catch { return ''; }
  }
  async function adopt(session, { makeCurrent = true } = {}) {
    sessions.set(session.did, session);
    scopes.set(session.did, await tokenScope(session));
    const handle = (await handleFor(session.did).catch(() => null)) || accounts.get(session.did)?.handle || session.did;
    accounts.add(session.did, handle);
    if (makeCurrent) accounts.setCurrent(session.did);
    emit({ type: 'signed-in', did: session.did });
    return session.did;
  }
  function forget(did, why = 'signed-out') {
    sessions.delete(did);
    scopes.delete(did);
    accounts.remove(did);
    emit({ type: why, did });
  }

  /** An account signed in on this browser earlier: no window needed. False when it's no longer valid. */
  async function restore(did) {
    if (sessions.has(did)) return true;
    if (!client) return false;
    if (restoring.has(did)) return restoring.get(did);
    const p = (async () => {
      try {
        const session = await client.restore(did);
        sessions.set(did, session);
        scopes.set(did, await tokenScope(session));
        emit({ type: 'restored', did });
        return true;
      } catch {
        forget(did, 'ran-out');
        return false;
      }
    })().finally(() => restoring.delete(did));
    restoring.set(did, p);
    return p;
  }

  return {
    accounts,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Once per page load. In the small sign-in window this finishes the sign-in and returns
    // { finishedInWindow: true } (the main tab has the result). After "Sign in in this tab instead" it
    // returns { returned: { did, state } }.
    async start() {
      let lib = {};
      try {
        lib = await getLib();
        client = await lib.BrowserOAuthClient.load({ clientId: clientIdFor(loc), handleResolver: SIGNIN.handleResolver });
        const r = await client.init();
        client.addEventListener?.('deleted', (e) => { const did = e?.detail?.sub; if (did) forget(did, 'ran-out'); });
        let returned = null;
        if (r && r.session && typeof r.state === 'string') returned = { did: await adopt(r.session), state: r.state };
        else if (r && r.session && accounts.get(r.session.did)) { sessions.set(r.session.did, r.session); scopes.set(r.session.did, await tokenScope(r.session)); }
        // The current account's sign-in, ready for its first save (the others when they're chosen).
        const cur = accounts.current();
        if (cur && !sessions.has(cur)) restore(cur);
        emit({ type: 'ready' });
        readyNow();
        return returned ? { returned } : {};
      } catch (err) {
        if ((lib.LoginContinuedInParentWindowError && err instanceof lib.LoginContinuedInParentWindowError) || err?.code === 'LOGIN_CONTINUED_IN_PARENT_WINDOW') {
          readyNow();
          return { finishedInWindow: true };
        }
        if (/Redirecting to loopback/.test(String(err?.message))) return { moving: true };
        console.error('[raku] sign-in could not start', err);
        problem = err;
        readyNow();
        emit({ type: 'problem' });
        return { error: err };
      }
    },
    get ready() { return !!client; },
    /** Resolves once start() has finished (well or not). */
    whenReady: () => readyP,
    get problem() { return problem; },

    /** [{ did, handle, current }] */
    list() {
      const cur = accounts.current();
      return accounts.list().map((a) => ({ ...a, current: a.did === cur }));
    },
    current() { const did = accounts.current(); return did ? accounts.get(did) : null; },
    /** An account signed in here, by what someone typed (handle or DID). → its DID, or null */
    didForHandle(who) { return accounts.list().find((a) => a.did === who || a.handle === who)?.did || null; },
    switchTo(did) { if (!accounts.get(did)) return; accounts.setCurrent(did); emit({ type: 'switched', did }); restore(did); },

    /** Does this account's sign-in cover saving at the table? (Known without waiting.) */
    covers(did, tableId) { return coversTable(scopes.get(did), TABLES[tableId]); },
    known(did) { return scopes.has(did); },
    /** The permissions to ask for when this account (or a new one: did null) signs in for a table. The
     *  games (and lounges, step 5b) its sign-in already allows are kept, so a new sign-in never loses them. */
    scopeFor(did, tableId) {
      const had = did ? tablesCovered(scopes.get(did)) : [];
      const lounges = did ? Object.keys(TABLES).filter((id) => coversLounge(scopes.get(did), TABLES[id])).map((id) => TABLES[id].lounge.scope) : [];
      return [scopeFor(tableId ? [...had, tableId] : had), ...lounges].join(' ');
    },
    /** Does this account's sign-in cover a table's lounge (step 5b)? (Known without waiting.) */
    coversLounge(did, tableId) { return coversLounge(scopes.get(did), TABLES[tableId]); },
    /** The permissions for turning mingling on at a table's lounge: the table's own set too (Q54: one window). */
    loungeScopeFor(did, tableId) {
      const base = this.scopeFor(did, tableId);
      const L = TABLES[tableId] && TABLES[tableId].lounge;
      return L && !base.split(' ').includes(L.scope) ? `${base} ${L.scope}` : base;
    },

    // Call straight from a click, before anything that waits: browsers only allow a new window then.
    // Returns the window, or null when it was blocked.
    openWindow() {
      try { return win.open('about:blank', SIGNIN.windowName, SIGNIN.windowFeatures) || null; } catch { return null; }
    },

    // The sign-in in the small window (opened by openWindow first). → the account's DID.
    // Raku doesn't watch whether the window is still open: Bluesky's sign-in pages cut the link between
    // the window and Raku (their cross-origin opener policy), after which the browser reports the window
    // as closed while it's still in use (found in the owner's test, Oct 20). The result comes back through
    // the library's own channel; Cancel (signal) or the library's 5 minutes end the wait.
    async signIn(input, scope, { signal } = {}) {
      if (!client) throw new Error(problem ? "Signing in isn't working here right now." : 'Raku is still getting ready. Try again in a moment.');
      try {
        const session = await client.signInPopup(input, { popupName: SIGNIN.windowName, popupFeatures: SIGNIN.windowFeatures, signal, scope });
        return await adopt(session);
      } catch (err) {
        if (signal?.aborted) throw new SignInStopped('Sign-in cancelled.');
        if (/^Timeout$/.test(String(err?.message))) throw new SignInStopped("Sign-in didn't finish in time. Try again.");
        throw err;
      }
    },

    // "Sign in in this tab instead": the account server in this tab, then back to Raku (start() picks it up).
    async signInHere(input, scope, state) {
      if (!client) throw new Error('Raku is still getting ready. Try again in a moment.');
      if (typeof client.signInRedirect === 'function') return client.signInRedirect(input, { scope, state });
      return client.signIn(input, { scope, state });
    },

    restore,
    async signOut(did) {
      const had = client;
      forget(did);
      try { await had?.revoke(did); } catch { /* already gone */ }
    },

    // One call to the account's own server with its sign-in (step 5b: the lounge record, the relay pass).
    // SignInNeeded when the sign-in has run out; an error with .status otherwise.
    async call(did, nsidAndQuery, { method = 'POST', body } = {}) {
      if (!sessions.has(did) && !(await restore(did))) throw new SignInNeeded('signed out');
      let res;
      try {
        res = await sessions.get(did).fetchHandler(`/xrpc/${nsidAndQuery}`, {
          method,
          ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (/token|session|refresh|revoked|auth/i.test(String(err && (err.name + ' ' + err.message)))) { forget(did, 'ran-out'); throw new SignInNeeded(String(err.message)); }
        throw err;
      }
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { forget(did, 'ran-out'); throw new SignInNeeded(out.message || 'unauthorized'); }
      if (!res.ok) throw Object.assign(new Error(out.message || out.error || `The server answered ${res.status}`), { status: res.status, error: out.error });
      return out;
    },

    // A pass for a game's relay lounge (step 5b): a short token from the account's own server
    // (com.atproto.server.getServiceAuth), addressed to the relay and to entering the lounge only. Good for a
    // minute; the relay takes each one once.
    async getPass(did, tableId) {
      const L = TABLES[tableId].lounge;
      const q = new URLSearchParams({ aud: L.audience, lxm: L.enter, exp: String(Math.floor(Date.now() / 1000) + 60) });
      const body = await this.call(did, `com.atproto.server.getServiceAuth?${q}`, { method: 'GET' });
      if (!body || typeof body.token !== 'string') throw new Error('no pass');
      return body.token;
    },

    // Writes one record (com.atproto.repo.putRecord): saving again with the same key replaces it.
    async putRecord(did, { collection, rkey, record }) {
      if (!sessions.has(did) && !(await restore(did))) throw new SignInNeeded('signed out');
      const session = sessions.get(did);
      let res;
      try {
        res = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repo: did, collection, rkey, record }),
        });
      } catch (err) {
        if (/token|session|refresh|revoked|auth/i.test(String(err && (err.name + ' ' + err.message)))) { forget(did, 'ran-out'); throw new SignInNeeded(String(err.message)); }
        throw err;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { forget(did, 'ran-out'); throw new SignInNeeded(body.message || 'unauthorized'); }
      if (res.status === 403 || body.error === 'ScopeMissingError' || /scope/i.test(String(body.error || ''))) {
        scopes.set(did, '');                    // the server says this sign-in doesn't cover it: ask again
        throw Object.assign(new Error('This sign-in no longer allows saving this game.'), { code: 'scope' });
      }
      if (!res.ok) throw new Error(body.message || body.error || `The server answered ${res.status}`);
      return { uri: body.uri, cid: body.cid };
    },
  };
}
