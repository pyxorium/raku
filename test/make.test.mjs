// Stage 6c: Make a tile (raku:discover/make), Raku's own list of tile makers. Plain data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAKE, siteLabel } from '../src/config.js';
import { parseTarget, discoverUri } from '../src/address.js';
import { ICON_NAMES } from '../src/icons.js';

test('Make a tile address and icon', () => {
  assert.deepEqual(parseTarget('raku:discover/make'), { ok: true, kind: 'discover', source: 'make', uri: discoverUri('make') });
  assert.ok(ICON_NAMES.includes('brush') && ICON_NAMES.includes('clock'));
});

test('the makers: two groups (no code first), alphabetical inside each, https sites, a mark and a line each', () => {
  assert.deepEqual(MAKE.groups.map((g) => g.title), ['No code needed', 'From your own files']);
  assert.deepEqual(MAKE.groups.map((g) => g.makers.map((m) => m.name)), [['ATMOSYNTH', 'Treeline', 'Web Tile Foundry'], ['appmosphe.re publish']]);
  for (const g of MAKE.groups) {
    const names = g.makers.map((m) => m.name.toLowerCase());
    assert.deepEqual(names, [...names].sort(), `${g.title}: alphabetical`);
  }
  const all = MAKE.groups.flatMap((g) => g.makers);
  assert.deepEqual(all.map((m) => m.url), ['https://atmosynth.at/', 'https://treeline.world/', 'https://foundry.thunderbird.cafe/', 'https://appmosphe.re/publish']);
  for (const m of all) {
    assert.equal(new URL(m.url).protocol, 'https:');
    assert.equal(m.mark.length, 1);
    assert.ok(['cream', 'turquoise', 'copper', 'smoke'].includes(m.glaze));
    assert.ok(m.line.length > 40 && m.line.length < 200);
  }
  assert.equal(new Set(all.map((m) => m.glaze)).size, all.length, 'a different glaze for each');
  assert.deepEqual(all.map((m) => siteLabel(m.url)), ['atmosynth.at', 'treeline.world', 'foundry.thunderbird.cafe', 'appmosphe.re/publish']);
  assert.equal(MAKE.intro, 'A web tile is a small page or app stored in your own atproto account. Anyone can open it in a tile browser like Raku.');
  assert.equal(MAKE.learn.url, 'https://dasl.ing/');
});
