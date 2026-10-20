// Moderation: the same commitments as lexicographer.space (claude/viewer-plan.md).
//
// 1. The hide list, coded. The viewer keeps hide-list.json (DIDs, DID + record key, private notes) on
//    its server. Raku runs in each visitor's browser, so it downloads a coded copy instead: only
//    SHA-256 hashes, no notes, no dates (claude/raku-plan.md decision 5). Raku checks each tile
//    against it here in the browser, so nobody learns what a visitor opens.
//      { "version": 1, "salt": "<text>", "accounts": ["<hex>", …], "tiles": ["<hex>", …] }
//      account hash = sha256(salt + "\n" + did)
//      tile hash    = sha256(salt + "\n" + did + "\n" + rkey)
//    Published by the viewer at https://lexicographer.space/hidden-tiles.json (its src/hide-list.js makes
//    the same hashes; both repos' tests check the same values). Downloaded at start and about every hour;
//    if a download fails, the last copy (also kept in this browser) stays in use.
// 2. Bluesky's moderation, asked straight from the browser: an account taken down (400
//    AccountTakedown) or labelled !takedown / !hide by Bluesky's own moderation service (not negated,
//    not expired). Answers kept 10 minutes. If Bluesky can't be reached, the tile is shown (as the viewer).

import { fetchJson, fetchLimited } from './net.js';
import { HIDE_LIST_URL, HIDE_LIST_RECHECK_MS, BLUESKY_API, BLUESKY_MODERATION, MODERATION_KEEP_MS, LIMITS } from './config.js';

const enc = new TextEncoder();
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const accountKey = (salt, did) => `${salt}\n${did}`;
export const tileKey = (salt, did, rkey) => `${salt}\n${did}\n${rkey}`;

const HEX64 = /^[0-9a-f]{64}$/;
/** Checks a downloaded coded list. → { salt, accounts: Set, tiles: Set } or null */
export function parseCodedList(json) {
  if (!json || json.version !== 1 || typeof json.salt !== 'string' || !json.salt) return null;
  if (!Array.isArray(json.accounts) || !Array.isArray(json.tiles)) return null;
  if (![...json.accounts, ...json.tiles].every((h) => typeof h === 'string' && HEX64.test(h))) return null;
  return { salt: json.salt, accounts: new Set(json.accounts), tiles: new Set(json.tiles) };
}

/** Is this label one of Bluesky's "hide this account" labels, still in force? */
export function hidingLabel(label, now = Date.now()) {
  if (!label || label.src !== BLUESKY_MODERATION || label.neg) return false;
  if (label.val !== '!takedown' && label.val !== '!hide') return false;
  if (label.exp && Date.parse(label.exp) <= now) return false;
  return true;
}

export function createModeration({ fetchImpl = globalThis.fetch, listUrl = HIDE_LIST_URL, now = () => Date.now(), storage = null } = {}) {
  let list = null;
  let listAt = 0;
  let loading = null;
  const bsky = new Map();   // did -> { at, hidden }

  // A copy kept in this browser, so a returning visitor has the list even if the first download fails.
  function readStored() {
    try { const s = storage?.getItem('raku-hide-list'); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  function store(json) { try { storage?.setItem('raku-hide-list', JSON.stringify(json)); } catch { /* fine */ } }

  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const url = new URL(listUrl, globalThis.location?.href || 'https://example.invalid/');
        const r = await fetchJson(url.toString(), {
          timeoutMs: LIMITS.lookupMs, maxBytes: 5 * 1024 * 1024, fetchImpl,
          check: (u) => new URL(u),          // our own file (or lexicographer.space's), not a stranger's
        });
        const parsed = r.ok ? parseCodedList(r.json) : null;
        if (parsed) { list = parsed; listAt = now(); store(r.json); return true; }
      } catch { /* keep the last copy */ }
      if (!list) {
        const s = readStored();
        if (s) list = parseCodedList(s);
      }
      listAt = now();     // try again in an hour either way
      return false;
    })().finally(() => { loading = null; });
    return loading;
  }

  async function onHideList(did, rkey) {
    if (!list || now() - listAt > HIDE_LIST_RECHECK_MS) await refresh();
    if (!list) return false;
    if (list.accounts.has(await sha256Hex(accountKey(list.salt, did)))) return true;
    return rkey ? list.tiles.has(await sha256Hex(tileKey(list.salt, did, rkey))) : false;
  }

  // Bluesky's public profile for an account: whether its moderation hides the account, and (stage 2)
  // the avatar and display name for an account's page and kept-account chips. Avatars are only taken
  // from Bluesky's own picture server.
  async function profile(did) {
    const k = bsky.get(did);
    if (k && now() - k.at < MODERATION_KEEP_MS) return k.profile;
    const shown = { hidden: false, avatar: null, displayName: '' };
    let answer = shown;
    try {
      const r = await fetchJson(`${BLUESKY_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, {
        timeoutMs: 5000, maxBytes: 256 * 1024, fetchImpl,
      });
      if (r.status === 400 && /AccountTakedown/.test(r.json?.error || '')) answer = { ...shown, hidden: true };
      else if (r.ok) {
        const avatar = typeof r.json?.avatar === 'string' && r.json.avatar.startsWith('https://cdn.bsky.app/') ? r.json.avatar : null;
        const displayName = typeof r.json?.displayName === 'string' ? r.json.displayName.slice(0, 80) : '';
        answer = { hidden: (r.json?.labels || []).some((l) => hidingLabel(l, now())), avatar, displayName };
      } else if (r.status >= 500) return shown;     // not kept: ask again next time
    } catch {
      return shown;                                  // can't reach Bluesky: show the tile, don't keep the answer
    }
    bsky.set(did, { at: now(), profile: answer });
    return answer;
  }
  const hiddenByBluesky = async (did) => (await profile(did)).hidden;

  /** Is this tile (or its whole account) hidden? Never says which list or why. */
  async function isHidden(did, rkey) {
    const [a, b] = await Promise.all([onHideList(did, rkey), hiddenByBluesky(did)]);
    return a || b;
  }

  /** The whole account hidden (the hide list's accounts, or Bluesky's moderation)? */
  async function isAccountHidden(did) {
    const [a, b] = await Promise.all([onHideList(did, null), hiddenByBluesky(did)]);
    return a || b;
  }

  return { refresh, isHidden, isAccountHidden, onHideList, hiddenByBluesky, profile, get loaded() { return !!list; } };
}

// For the first screen's card pictures (not tiles): plain picture types only, checked by their first bytes.
export function sniffPicture(bytes) {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  const head = new TextDecoder().decode(b.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}
export { fetchLimited };
