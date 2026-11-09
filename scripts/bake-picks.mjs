#!/usr/bin/env node
// Bakes the first screen's picks into Raku (claude/raku-baked-picks-plan.md, BP1 to BP3).
//
// Run it on your computer, directly in C:\thunderbird-cafe\raku, whenever PICKS in src/config.js changes:
//   npm run bake-picks
// For each pick it reads the tile's record from its author's server (the same careful lookups as Raku), checks the
// handle both ways, downloads the banner and saves a 640 px wide WebP copy as public/picks/<record key>.webp. Then it
// writes src/picks.baked.js. If any pick can't be read, nothing is written. Copies of picks no longer in PICKS are
// removed. Needs the `sharp` package (a development tool only: npm install --save-dev sharp).
import { readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICKS, LIMITS } from '../src/config.js';
import { parseAddress } from '../src/address.js';
import { createResolver } from '../src/resolve.js';
import { describeTile } from '../src/tiles.js';
import { bannerCid } from '../src/cards.js';
import { sniffPicture } from '../src/moderation.js';
import { fetchLimited } from '../src/net.js';

export const WIDTH = 640;
const BANNER_MAX = 10 * 1024 * 1024;

/** A banner's bytes from its author's server, or null when it isn't a picture. */
export async function getBanner(pds, did, cid, { fetchImpl = globalThis.fetch } = {}) {
  const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
  const r = await fetchLimited(url, { timeoutMs: LIMITS.lookupMs * 3, maxBytes: BANNER_MAX, fetchImpl });
  if (!r.ok) throw new Error(`the banner ${cid} didn't download (${r.status})`);
  const type = sniffPicture(r.bytes);
  return type && type !== 'image/svg+xml' ? r.bytes : null;
}

/**
 * Reads every pick. → { entries, pictures: [{ file, bytes }] }. Throws (naming the pick) when one can't be read.
 * resize(bytes) → { data, width, height }: a WebP at most WIDTH wide.
 */
export async function bakePicks({ picks = PICKS, resolver, getBlob, resize }) {
  const entries = [];
  const pictures = [];
  for (const uri of picks) {
    try {
      const a = parseAddress(uri);
      if (!a.ok || !a.actor.startsWith('did:')) throw new Error('not a tile address with a DID');
      const did = a.actor;
      const [rec, acct] = await Promise.all([resolver.tileRecord(did, a.rkey), resolver.account(did)]);
      const d = describeTile(rec);
      if (!d.ok) throw new Error(d.reason);
      const handle = (await resolver.checkedHandle(did)) || '';
      const cid = bannerCid(d.manifest);
      let banner = null;
      if (cid) {
        const bytes = await getBlob(acct.pds, did, cid);
        if (bytes) {
          const out = await resize(bytes);
          const file = `picks/${a.rkey}.webp`;
          pictures.push({ file, bytes: out.data });
          banner = { cid, file, width: out.width, height: out.height };
        }
      }
      entries.push({ uri, did, rkey: a.rkey, cid: rec.cid || null, name: d.name, description: d.description, handle, banner });
    } catch (err) {
      throw new Error(`Couldn't bake ${uri}: ${err.message}`);
    }
  }
  return { entries, pictures };
}

/** The text of src/picks.baked.js. */
export function bakedFileText(entries, bakedAt) {
  const data = JSON.stringify({ bakedAt, picks: entries }, null, 2);
  return `// Written by \`npm run bake-picks\` (scripts/bake-picks.mjs). Don't edit by hand: change PICKS in src/config.js and bake
// again. Baked ${bakedAt}.
export const BAKED_PICKS = Object.freeze(${data});
`;
}

async function loadSharp() {
  try { return (await import('sharp')).default; } catch {
    console.error('The sharp package is missing: run npm install --save-dev sharp directly in C:\\thunderbird-cafe\\raku, then bake again.');
    process.exit(1);
  }
}

async function sharpResize(sharp, bytes) {
  const { data, info } = await sharp(Buffer.from(bytes)).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sharp = await loadSharp();
  const resolver = createResolver();
  console.log(`Baking ${PICKS.length} picks…`);
  let result;
  try {
    result = await bakePicks({ resolver, getBlob: (pds, did, cid) => getBanner(pds, did, cid), resize: (bytes) => sharpResize(sharp, bytes) });
  } catch (err) {
    console.error(`${err.message}\nNothing was written.`);
    process.exit(1);
  }
  const dir = join(root, 'public', 'picks');
  await mkdir(dir, { recursive: true });
  const keep = new Set(result.pictures.map((p) => p.file.slice('picks/'.length)));
  for (const f of await readdir(dir)) if (f.endsWith('.webp') && !keep.has(f)) { await rm(join(dir, f)); console.log(`removed public/picks/${f}`); }
  for (const p of result.pictures) await writeFile(join(root, 'public', p.file), p.bytes);
  await writeFile(join(root, 'src', 'picks.baked.js'), bakedFileText(result.entries, new Date().toISOString()));
  for (const e of result.entries) {
    const size = result.pictures.find((p) => p.file === e.banner?.file)?.bytes.length;
    console.log(`  ${e.name} (${e.handle ? `@${e.handle}` : e.did})${e.banner ? `: ${e.banner.file}, ${e.banner.width}x${e.banner.height}, ${Math.round(size / 1024)} KB` : ': no banner'}`);
  }
  console.log('Wrote src/picks.baked.js. Commit it with the files in public/picks/.');
}

// Run as a script (not when the tests import it). Paths compared without case: Windows may spell the drive either way.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) main();
