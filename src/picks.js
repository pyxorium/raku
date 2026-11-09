// The first screen's picks, baked in (claude/raku-baked-picks-plan.md, BP1 to BP3).
//
// `npm run bake-picks` (scripts/bake-picks.mjs, run on the owner's computer) reads each pick in PICKS from its author's
// server and writes src/picks.baked.js (names, descriptions, checked handles, banners) and a small copy of each banner
// in public/picks/. The first screen draws a baked pick's card at once from those, then checks quietly (moderation, the
// record) and swaps in anything that changed (app.js pickCard). A pick with no baked copy loads as before.
// No DOM here.

import { PICKS } from './config.js';
import { BAKED_PICKS } from './picks.baked.js';

const CID = /^[a-z0-9]{20,120}$/;
const FILE = /^picks\/[a-z0-9]{1,64}\.webp$/;

/** A baked entry as it should look, or null (a hand-edited or broken entry is ignored: the pick loads as before). */
function cleanEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.uri !== 'string' || typeof e.did !== 'string' || typeof e.name !== 'string') return null;
  const banner = e.banner && CID.test(e.banner.cid || '') && FILE.test(e.banner.file || '') ? e.banner : null;
  return { uri: e.uri, did: e.did, name: e.name, description: typeof e.description === 'string' ? e.description : '',
    handle: typeof e.handle === 'string' ? e.handle : '', banner };
}

/** The baked copy of a pick, or null when it has none. */
export function bakedPick(uri, baked = BAKED_PICKS) {
  const e = (baked?.picks || []).find((p) => p && p.uri === uri);
  return e ? cleanEntry(e) : null;
}

/** Where a baked banner is served from (Raku's own site). */
export const bakedPictureUrl = (entry) => (entry?.banner ? `/${entry.banner.file}` : null);

/** What's out of step between PICKS and the bake (BP3): [] when they agree. */
export function bakeProblems(picks = PICKS, baked = BAKED_PICKS) {
  const got = (baked?.picks || []).map((p) => p?.uri);
  const problems = [];
  for (const uri of picks) if (!got.includes(uri)) problems.push(`not baked: ${uri}`);
  for (const uri of got) if (!picks.includes(uri)) problems.push(`baked but no longer a pick: ${uri}`);
  if (!problems.length && got.join('\n') !== picks.join('\n')) problems.push('the picks are in a different order than when they were baked');
  for (const p of baked?.picks || []) if (picks.includes(p?.uri) && !cleanEntry(p)) problems.push(`a baked entry isn't usable: ${p?.uri}`);
  return problems;
}
