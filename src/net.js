// Fetching from strangers' servers, carefully.
//
// Raku's address box can open anyone's tile, and a tile's account names its own servers (a did:web
// host, the PDS address in its DID document). So every request Raku makes for a tile:
//   - goes over https, to a host that isn't obviously private (localhost, a private, loopback or
//     link-local address, .local / .internal and the like);
//   - sends no cookies and no referrer;
//   - has a time limit and a size limit (the download stops once it's over).
// A browser page can't see what a name resolves to, so only names and written-out addresses are
// checked; a public name pointing at a private address is the browser's own business (Chrome's
// private network checks).

export class NetError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'home.arpa', 'test', 'invalid', 'example'];

function ipv4Private(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((x) => Number(x) > 255)) return true;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)          // shared address space
    || (a === 169 && b === 254)                    // link-local
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

/** True when a host name is fine to fetch from. */
export function isPublicHost(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[') || host.includes(':')) {
    host = host.replace(/^\[|\]$/g, '');
    // IPv6: refuse loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10), mapped IPv4,
    // and Fly's internal network (fdaa::/16 is inside fc00::/7 anyway).
    if (host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')) return false;
    return true;
  }
  const v4 = ipv4Private(host);
  if (v4 !== null) return !v4;
  if (!host.includes('.')) return false;                   // single-label names
  if (PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return false;
  return true;
}

/** Checks an address before Raku fetches it: https, a public host. Returns a URL or throws NetError. */
export function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new NetError('bad-url', `Not a web address: ${url}`); }
  if (u.protocol !== 'https:') throw new NetError('not-https', `Raku only fetches over https (${u.origin}).`);
  if (u.username || u.password) throw new NetError('bad-url', 'Addresses with a user name are refused.');
  if (!isPublicHost(u.hostname)) throw new NetError('private', `${u.hostname} looks like a private address, so Raku won't fetch from it.`);
  return u;
}

/**
 * Fetches with a time limit and a size limit. Returns { status, ok, bytes (Uint8Array), type }.
 * Stops reading (and throws 'too-large') once more than maxBytes have arrived.
 */
export async function fetchLimited(url, { timeoutMs, maxBytes, fetchImpl = globalThis.fetch, check = checkUrl } = {}) {
  const u = check(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(u.toString(), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' });
    } catch (err) {
      if (controller.signal.aborted) throw new NetError('timeout', `No answer from ${u.hostname} in time.`);
      throw new NetError('network', `Couldn't reach ${u.hostname}.`);
    }
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared && declared > maxBytes) {
      controller.abort();
      throw new NetError('too-large', `The answer from ${u.hostname} is too large.`);
    }
    const bytes = await readCapped(res, maxBytes, controller, u.hostname);
    return { status: res.status, ok: res.ok, bytes, type: res.headers?.get?.('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res, maxBytes, controller, host) {
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new NetError('too-large', `The answer from ${host} is too large.`);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new NetError('too-large', `The answer from ${host} is too large.`);
      }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof NetError) throw err;
    if (controller.signal.aborted) throw new NetError('timeout', `${host} took too long.`);
    throw new NetError('network', `The download from ${host} broke off.`);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** fetchLimited, then JSON. */
export async function fetchJson(url, opts) {
  const r = await fetchLimited(url, opts);
  let json = null;
  try { json = JSON.parse(new TextDecoder().decode(r.bytes)); } catch { /* not JSON */ }
  return { status: r.status, ok: r.ok, json };
}

/** "60 MB", "820 KB" */
export function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}
