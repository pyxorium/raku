// The words and links of Raku's rooms (rooms step 1), apart from the page so they're tested in Node
// (test/rooms.test.mjs): who can show a checked handle, RR6's question, reading a pasted invite, Raku's invite link.
import { isRoomCode } from 'rooms-lab/formats.js';
import { ROOMS, SITE, isLocal } from './config.js';
import { roomInHash } from './address.js';

// Only did:plc accounts can show a checked handle in a room (the relay refuses did:web: claude/rooms-lab-step8.md).
export const canShowHandle = (did) => /^did:plc:[a-z2-7]{24}$/.test(String(did || ''));

/** "Nick", "Nick and Robin", "Nick, Robin and Ted". */
export function namesList(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
/** RR6's question (owner's words). people: [{ name, me, away }]. */
export function leaveQuestion(people = []) {
  const others = people.filter((p) => !p.me).map((p) => p.name);
  return others.length ? `You're in a room with ${namesList(others)}. Leave it and join this one?` : "You're in a room on your own. Leave it and join this one?";
}

/** A pasted invite (a Raku or lab invite link, or a bare room code) → { room, hostKey } or null. */
export function readInvite(text) {
  const s = String(text || '').trim();
  if (isRoomCode(s)) return { room: s, hostKey: null };
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const lab = new URL(ROOMS.labPage);
  const ours = (u.protocol === 'https:' && host === SITE.host && u.pathname === '/')
    || (u.protocol === 'https:' && (host === lab.hostname || host === `www.${lab.hostname}`) && u.pathname === lab.pathname)
    || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(host));
  if (!ours) return null;
  return roomInHash(u.hash);
}

/** Raku's invite link for a room (and the host's, with its key): Raku's own address, the room after #r=. On this
 *  computer the checks' switches go along (?roomsRelay=, ?loader=), so every window uses the same ones. */
export function roomLink(loc, code, key = null) {
  const u = new URL(loc.href);
  const keep = new URLSearchParams();
  if (isLocal(loc)) for (const k of ['roomsRelay', 'loader']) { const v = u.searchParams.get(k); if (v) keep.set(k, v); }
  const q = keep.toString();
  return `${u.origin}/${q ? `?${q}` : ''}#r=${code}${key ? `&k=${key}` : ''}`;
}

