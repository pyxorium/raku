// Raku's colours (claude/raku-light-mode-plan.md). The groundwork (step 1): every colour of Raku's own is named on :root
// in src/style.css, so a look (or any colour change) is a change to the names alone. Written-out colours are kept only
// where they belong to the tiles' side and stay the same in any look. The second push: :root is the dark look, and the
// light look comes in six styles (LM12 to LM15), each naming every colour, with every word pair passing WCAG AA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = file('src/style.css');
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(|\b(?:white|black)\b(?![-\w])/g;
// The tiles' side: a tile frame's white, the tables' cream, Make a tile's type marks, the screen between places.
const FIXED = /^(\.tile-frame|\.tp-frame|\.seat-frame|\.seat-status( button)?|\.mk-(cream|turquoise|copper|smoke)|\.way-[\w-]+( button)?|button\.way-door:hover, button\.way-door:focus-visible)$/;
const LIGHT = ':root[data-look="light"]';

const rootEnd = css.indexOf('}', css.indexOf(':root {')) + 1;
const root = css.slice(css.indexOf(':root {'), rootEnd);
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const allRules = [...noComments(css.slice(rootEnd)).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim().replace(/^@media[^{]*$/m, '').trim(), body }));
const palette = allRules.filter((r) => r.sel.startsWith(LIGHT));
const rules = allRules.filter((r) => !r.sel.startsWith(LIGHT));
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, n, v]) => [n, v.trim()]));
const DARK = decls(noComments(root));
const NAMES = Object.keys(DARK).filter((n) => !/^--(bar-h|strip-h)$/.test(n));

// The light blocks, by style: Clear is the plain [data-look="light"] block (the default, LM13); Smoke and clay's
// pages-and-menus block starts with its bare selector; its top-bar block (the dark values, scoped) does not.
const STYLE_IDS = ['bisque', 'porcelain', 'celadon', 'washi', 'smoke', 'clear'];
const styleOf = (sel) => {
  const first = sel.split(',')[0].trim();
  if (first === LIGHT) return 'clear';
  const m = first.match(/^:root\[data-look="light"\]\[data-light="(\w+)"\]$/);
  if (m) return m[1];
  if (/^:root\[data-look="light"\]\[data-light="smoke"\] \.chrome$/.test(first)) return 'smoke-bar';
  return `? ${first}`;
};
const LIGHT_SETS = Object.fromEntries(palette.map((r) => [styleOf(r.sel), decls(r.body)]));

test('style.css: colours are named on :root, not written out in the rules', () => {
  const written = rules.filter((r) => !FIXED.test(r.sel) && (r.body.match(COLOUR) || []).length)
    .map((r) => `${r.sel}: ${r.body.match(COLOUR).join(' ')}`);
  assert.deepEqual(written, [], 'use a name from :root (add one there, and in each light style, if needed)');
});

test('style.css: the written-out colours left are only the tiles\' side', () => {
  const fixed = rules.filter((r) => FIXED.test(r.sel)).map((r) => r.sel);
  for (const sel of ['.tile-frame', '.tp-frame', '.seat-frame', '.seat-status', '.mk-cream', '.way-screen']) assert.ok(fixed.includes(sel), sel);
});

test('style.css: every name used is defined, and every colour name is used', () => {
  const defined = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const body = rules.map((r) => r.body).join('\n');
  const used = new Set([...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  // set from code, not on :root: round C's --wco-right (src/app-shell.js); a swatch's own colours and the palette bar's
  // (src/account-menu.js, from config.js)
  const missing = [...used].filter((n) => !defined.has(n) && !['--wco-right', '--sw-strip', '--sw-dot', '--band'].includes(n));
  assert.deepEqual(missing, [], 'used but not on :root');
  const rgbUsed = new Set([...body.matchAll(/rgba\(var\((--[\w-]+-rgb)\)/g)].map((m) => m[1]));
  // the --pot-… colours are read by src/icons.js, which draws the bowl beside the Raku label in them
  const icons = file('src/icons.js');
  assert.match(icons, /getPropertyValue\(`--pot-\$\{part\}`\)/);
  const unused = [...defined].filter((n) => !used.has(n) && !rgbUsed.has(n) && !/^--(bar-h|strip-h|pot-(edge|body|crackle|rim))$/.test(n));
  assert.deepEqual(unused, [], 'on :root but never used');
});

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
const FOLLOWERS = ['--glaze', '--glaze-light', '--warn', '--stage', '--kiln'];

test('style.css: each see-through colour matches the named colour it copies (dark, and each light style)', () => {
  for (const [look, set] of [['dark', DARK], ...Object.entries(LIGHT_SETS)]) {
    for (const n of FOLLOWERS) assert.equal(set[`${n}-rgb`], hexRgb(set[n]), `${look}: ${n}`);
  }
});

test('style.css: six light styles, each naming every colour of :root (no more, no fewer)', () => {
  assert.deepEqual(Object.keys(LIGHT_SETS).sort(), [...STYLE_IDS, 'smoke-bar'].sort());
  assert.equal(NAMES.length, 54, '45 colours and 9 see-through');
  for (const [id, set] of Object.entries(LIGHT_SETS)) {
    assert.deepEqual(Object.keys(set).sort(), [...NAMES].sort(), `${id}: the same names as :root`);
    if (id === 'smoke-bar') continue;   // the dark values, checked below
    for (const n of NAMES) assert.match(set[n], n.endsWith('-rgb') ? /^\d{1,3}, \d{1,3}, \d{1,3}$/ : /^#[0-9a-f]{6}$/, `${id} ${n}`);
  }
  for (const r of palette) assert.match(r.body, styleOf(r.sel) === 'smoke-bar' ? /color-scheme: dark;/ : /color-scheme: light;/, r.sel);
  assert.match(root, /color-scheme: dark;/, ':root is the dark look');
});

test('style.css: the styles as built (LM15: claude/raku-light-palette-tools/presets.py), Clear the default', () => {
  // strip / page / card / words / small print / turquoise words, as listed in the plan doc
  const MAIN = {
    bisque: ['#e4dccf', '#ece5d9', '#fbf8f2', '#2a231d', '#716455', '#1a6b62'],
    porcelain: ['#dee1e6', '#eceef1', '#fbfbfc', '#1e2329', '#5e6d82', '#106f65'],
    celadon: ['#dae2de', '#e8edeb', '#f8f9f9', '#1d2b27', '#4d6f69', '#17705f'],
    washi: ['#efe6cf', '#f5f0e2', '#fbf9f4', '#402e21', '#8c6548', '#217166'],
    smoke: ['#e4ded7', '#efebe7', '#faf9f7', '#2a231d', '#786653', '#196c61'],
    clear: ['#e7e6e4', '#f4f4f3', '#ffffff', '#161413', '#665e57', '#0d665b'],
  };
  for (const [id, want] of Object.entries(MAIN)) {
    const s = LIGHT_SETS[id];
    assert.deepEqual(['--kiln', '--stage', '--card', '--text', '--faint', '--glaze-light'].map((n) => s[n]), want, id);
  }
  assert.ok(palette.some((r) => r.sel === LIGHT), 'Clear is the plain light block, so an unknown style shows Clear');
});

test('style.css: Smoke and clay keeps today\'s dark top bar, with its menus and update line light', () => {
  const bar = palette.find((r) => styleOf(r.sel) === 'smoke-bar');
  const sels = bar.sel.split(',').map((s) => s.trim());
  assert.deepEqual(sels, ['.chrome', '.toolbar', '.tp-x-bar'].map((c) => `${LIGHT}[data-light="smoke"] ${c}`));
  for (const n of NAMES) assert.equal(LIGHT_SETS['smoke-bar'][n], DARK[n], `the bar's ${n} is the dark look's`);
  const pages = palette.find((r) => styleOf(r.sel) === 'smoke').sel.split(',').map((s) => s.trim());
  assert.deepEqual(pages, [`${LIGHT}[data-light="smoke"]`, ...['.account-menu', '.update-line', '.openin-menu', '.rk-ta-list']
    .map((c) => `${LIGHT}[data-light="smoke"] .chrome ${c}`)], 'what sits in the bar but belongs to the page stays light');
  assert.equal(palette.filter((r) => /\.chrome/.test(r.sel)).length, 2, 'only Smoke and clay scopes the bar');
});

// WCAG contrast (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio)
const lum = (h) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// The words on the surfaces they sit on in Raku (the tuning page's 35 pairs; AA 4.5, the focus ring 3).
const PAIRS = [
  ['text', 'card', 4.5], ['text', 'stage', 4.5], ['text', 'clay', 4.5], ['text', 'raised', 4.5], ['text', 'sunk', 4.5], ['text', 'shelf', 4.5], ['text', 'update-bg', 4.5],
  ['muted', 'card', 4.5], ['muted', 'stage', 4.5], ['muted', 'raised', 4.5], ['muted', 'sunk', 4.5], ['muted', 'kiln', 4.5],
  ['faint', 'card', 4.5], ['faint', 'stage', 4.5], ['faint', 'raised', 4.5], ['faint', 'sunk', 4.5], ['faint', 'well', 4.5],
  ['ink-soft', 'clay', 4.5], ['ink-soft', 'well', 4.5], ['ink-tab-on', 'clay', 4.5], ['ink-tool', 'clay', 4.5], ['ink-count', 'clay', 4.5],
  ['ink-mono', 'sunk', 4.5], ['ink-quiet', 'raised', 4.5], ['ink-table', 'card', 4.5], ['ink-table', 'stage', 4.5],
  ['glaze-light', 'kiln', 4.5], ['glaze-light', 'stage', 4.5], ['glaze-light', 'card', 4.5], ['glaze-light', 'raised', 4.5],
  ['glaze-ink', 'glaze-btn', 4.5], ['warn', 'shelf', 4.5], ['warn', 'card', 4.5], ['warn', 'stage', 4.5], ['glaze', 'stage', 3],
];

test('style.css: every word pair passes WCAG AA in every light style', () => {
  assert.equal(PAIRS.length, 35);
  for (const id of STYLE_IDS) {
    const s = LIGHT_SETS[id];
    const low = PAIRS.filter(([fg, bg, need]) => ratio(s[`--${fg}`], s[`--${bg}`]) < need)
      .map(([fg, bg]) => `${fg} on ${bg} ${ratio(s[`--${fg}`], s[`--${bg}`]).toFixed(2)}`);
    assert.deepEqual(low, [], id);
  }
});

test('offline.html: its colours use the same names, with the same values as style.css, dark and each light style', () => {
  const html = file('public/offline.html');
  const style = noComments(html.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const blocks = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
  const own = blocks.find((b) => b.sel === ':root');
  for (const [n, v] of Object.entries(decls(own.body))) assert.equal(v, DARK[n], `${n} is the same as in style.css`);
  const light = blocks.filter((b) => b.sel.startsWith(LIGHT));
  assert.deepEqual(light.map((b) => styleOf(b.sel)).sort(), [...STYLE_IDS].sort());
  for (const b of light) {
    const id = styleOf(b.sel);
    const set = decls(b.body);
    assert.deepEqual(Object.keys(set).sort(), Object.keys(decls(own.body)).sort(), id);
    for (const [n, v] of Object.entries(set)) assert.equal(v, LIGHT_SETS[id][n], `${id} ${n}`);
  }
  const rest = blocks.filter((b) => b.sel !== ':root' && !b.sel.startsWith(LIGHT));
  assert.deepEqual(rest.flatMap((b) => b.body.match(COLOUR) || []), [], 'no written-out colours outside its colour blocks');
});
