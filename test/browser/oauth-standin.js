// A stand-in for @atproto/oauth-client-browser, for the browser checks only (check_signin.py bundles it in
// the library's place with esbuild's --alias). It behaves like the library from Raku's side:
//   - signInPopup(handle, { popupName, scope, signal }) sends the window Raku already opened (by name) to
//     Raku's own address with #state=…&iss=…&code=…, as an account server's redirect does. Raku in that
//     window calls init(), which hands the result back (through localStorage) and throws
//     LoginContinuedInParentWindowError, as the library does; the main tab then has the session.
//   - signInRedirect(handle, { scope, state }) does the same in this tab; init() picks it up on the way
//     back and returns { session, state }.
//   - a session's getTokenInfo() gives the permissions as the account server expands them (a permission
//     set becomes repo:<collection>); its fetchHandler sends requests to the account's server (the
//     checks' stand-in PDS), naming the account and its permissions in the address.
// Accounts known: those in ACCOUNTS. localStorage keys start with "standin-".
const ACCOUNTS = {
  'thunderbird.cafe': 'did:plc:6vxjigxrqizmbo56gojxico3',
  'thunderbirdwine.bsky.social': 'did:plc:joer5rzmwgec3dkr4srfmq45',
};
const PDS = 'https://pds.fakepds.net';
const SETS = {
  'include:cafe.thunderbird.sevenup.authPlay': 'repo:cafe.thunderbird.sevenup.match',
  'include:cafe.thunderbird.daisy.authPlay': 'repo:cafe.thunderbird.daisy.match',
};
const expand = (scope) => String(scope || '').split(' ').filter(Boolean).map((s) => SETS[s] || s).join(' ');

export class LoginContinuedInParentWindowError extends Error {
  constructor() { super('Login continued in parent window'); this.code = 'LOGIN_CONTINUED_IN_PARENT_WINDOW'; }
}

const read = (k, f = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const log = (entry) => write('standin-calls', [...read('standin-calls', []), { ...entry, at: Date.now() }]);
// Raku's address (keeping ?loader=… for the checks; the real redirect address is just SIGNIN.redirectUri).
const here = () => `${location.origin}${location.pathname}${location.search}`;
const didOf = (input) => (String(input).startsWith('did:') ? input : ACCOUNTS[String(input).toLowerCase()]);

function session(did) {
  return {
    did, sub: did,
    async getTokenInfo() { const s = read('standin-sessions', {})[did]; return { sub: did, scope: s ? s.scope : '' }; },
    async fetchHandler(path, init = {}) {
      const s = read('standin-sessions', {})[did];
      const sep = path.includes('?') ? '&' : '?';
      // A plain text body: a "simple" request, so the checks' routes see it without a preflight.
      return fetch(`${PDS}${path}${sep}standin_did=${encodeURIComponent(did)}&standin_scope=${encodeURIComponent(s ? s.scope : '')}`,
        { method: init.method || 'GET', body: init.body, headers: { 'content-type': 'text/plain' }, credentials: 'omit' });
    },
  };
}
function grant(did, scope) {
  const all = read('standin-sessions', {});
  all[did] = { scope: expand(scope) };
  write('standin-sessions', all);
}

let started = false;
const client = {
  addEventListener() {},
  async init() {
    started = true;
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    const state = q.get('state');
    if (!state || !q.get('code')) return undefined;
    const pending = read(`standin-pending:${state}`);
    if (!pending) throw new Error('standin: unknown state');
    localStorage.removeItem(`standin-pending:${state}`);
    if (q.get('error')) throw new Error('standin: the person said no');
    grant(pending.did, pending.scope);
    history.replaceState(null, '', location.pathname + location.search);
    if (pending.popup) {
      write(`standin-done:${state}`, { did: pending.did });
      throw new LoginContinuedInParentWindowError();
    }
    return { session: session(pending.did), state: pending.appState ?? null };
  },
  async signInPopup(input, { popupName, scope, signal } = {}) {
    const did = didOf(input);
    log({ kind: 'popup', input, scope });
    if (!did) throw new Error(`Failed to resolve identity: ${input}`);
    // localStorage standin-hold: the person never finishes (the checks press Cancel).
    if (localStorage.getItem('standin-hold')) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) reject(new Error('Aborted'));
        signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    }
    const state = Math.random().toString(36).slice(2);
    write(`standin-pending:${state}`, { did, scope, popup: true });
    const w = window.open(`${here()}#state=${state}&iss=standin&code=c${state}`, popupName);
    if (!w) throw new Error('standin: the popup was blocked');
    return new Promise((resolve, reject) => {
      const t = setInterval(() => {
        if (signal?.aborted) { clearInterval(t); reject(new Error('aborted')); return; }
        const done = read(`standin-done:${state}`);
        if (!done) return;
        clearInterval(t);
        localStorage.removeItem(`standin-done:${state}`);
        try { w.close(); } catch { /* fine */ }
        resolve(session(done.did));
      }, 100);
    });
  },
  async signInRedirect(input, { scope, state: appState } = {}) {
    const did = didOf(input);
    log({ kind: 'redirect', input, scope, appState });
    if (!did) throw new Error(`Failed to resolve identity: ${input}`);
    const state = Math.random().toString(36).slice(2);
    write(`standin-pending:${state}`, { did, scope, appState });
    // A full page load, as coming back from an account server is (a hash change alone wouldn't reload).
    setTimeout(() => { history.replaceState(null, '', `${here()}#state=${state}&iss=standin&code=c${state}`); location.reload(); }, 50);
    return new Promise(() => {});
  },
  async restore(did) {
    if (!read('standin-sessions', {})[did]) throw new Error('standin: no session');
    return session(did);
  },
  async revoke(did) {
    log({ kind: 'revoke', did });
    const all = read('standin-sessions', {}); delete all[did]; write('standin-sessions', all);
  },
};

export const BrowserOAuthClient = {
  async load(opts) { log({ kind: 'load', clientId: opts.clientId, handleResolver: opts.handleResolver }); return client; },
};
export const standinStarted = () => started;
