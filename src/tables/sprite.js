// The bot's rpg.actor sprite (public), for Seven-Up's player tiles. Adapted COPY of fetchSprite in the
// site's src/sevenup/identity.js, with Raku's careful fetching and account lookups.
import { fetchJson, fetchLimited } from '../net.js';
import { LIMITS } from '../config.js';

const MAX_SPRITE_BYTES = 1024 * 1024;   // real rpg.actor sheets are around 12 KB

/** → { blob, frameWidth, frameHeight, sheetWidth, sheetHeight }, or null when there's none. */
export async function fetchSprite(did, { resolver, fetchImpl = globalThis.fetch }) {
  const { pds } = await resolver.account(did);
  const rec = await fetchJson(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=actor.rpg.sprite&rkey=self`,
    { timeoutMs: LIMITS.lookupMs, maxBytes: 64 * 1024, fetchImpl });
  if (!rec.ok) return null;
  const v = rec.json?.value || {};
  const cid = v.spriteSheet?.ref?.$link;
  if (typeof cid !== 'string' || !/^[a-z0-9]{20,120}$/.test(cid)) return null;
  const r = await fetchLimited(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
    { timeoutMs: LIMITS.lookupMs, maxBytes: MAX_SPRITE_BYTES, fetchImpl });
  if (!r.ok) return null;
  const type = typeof v.spriteSheet?.mimeType === 'string' && v.spriteSheet.mimeType.startsWith('image/') ? v.spriteSheet.mimeType : 'image/png';
  return { blob: new Blob([r.bytes], { type }), frameWidth: v.frameWidth || 48, frameHeight: v.frameHeight || 48, sheetWidth: v.width || 144, sheetHeight: v.height || 192 };
}
