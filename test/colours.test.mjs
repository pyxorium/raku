// The light-mode groundwork (claude/raku-light-mode-plan.md, step 1): every colour of Raku's own is named on
// :root in src/style.css, so a later look (or any colour change) is a change to the names alone. Written-out
// colours are kept only where they belong to the tiles' side and stay the same in any look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = file('src/style.css');
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(|\b(?:white|black)\b(?![-\w])/g;
// The tiles' side: a tile frame's white, the tables' cream, Make a tile's type marks, the screen between places.
const FIXED = /^(\.tile-frame|\.tp-frame|\.seat-frame|\.seat-status( button)?|\.mk-(cream|turquoise|copper|smoke)|\.way-[\w-]+( button)?|button\.way-door:hover, button\.way-door:focus-visible)$/;

const rootEnd = css.indexOf('}', css.indexOf(':root {')) + 1;
const root = css.slice(css.indexOf(':root {'), rootEnd);
const rules = [...css.slice(rootEnd).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim().replace(/^@media[^{]*$/m, '').trim(), body }));

test('style.css: colours are named on :root, not written out in the rules', () => {
  const written = rules.filter((r) => !FIXED.test(r.sel) && (r.body.match(COLOUR) || []).length)
    .map((r) => `${r.sel}: ${r.body.match(COLOUR).join(' ')}`);
  assert.deepEqual(written, [], 'use a name from :root (add one there if needed)');
});

test('style.css: the written-out colours left are only the tiles\' side', () => {
  const fixed = rules.filter((r) => FIXED.test(r.sel)).map((r) => r.sel);
  for (const sel of ['.tile-frame', '.tp-frame', '.seat-frame', '.seat-status', '.mk-cream', '.way-screen']) assert.ok(fixed.includes(sel), sel);
});

test('style.css: every name used is defined, and every colour name is used', () => {
  const defined = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.slice(rootEnd).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  // round C's --wco-right is set from code (src/app-shell.js), not on :root
  const missing = [...used].filter((n) => !defined.has(n) && n !== '--wco-right');
  assert.deepEqual(missing, [], 'used but not on :root');
  const rgbUsed = new Set([...css.slice(rootEnd).matchAll(/rgba\(var\((--[\w-]+-rgb)\)/g)].map((m) => m[1]));
  // the --pot-… colours are read by src/icons.js, which draws the bowl beside the Raku label in them
  const icons = readFileSync(new URL('../src/icons.js', import.meta.url), 'utf8');
  assert.match(icons, /getPropertyValue\(`--pot-\$\{part\}`\)/);
  const unused = [...defined].filter((n) => !used.has(n) && !rgbUsed.has(n) && !/^--(bar-h|strip-h|pot-(edge|body|crackle|rim))$/.test(n));
  assert.deepEqual(unused, [], 'on :root but never used');
});

test('style.css: each see-through colour matches the named colour it copies', () => {
  const val = (n) => root.match(new RegExp(`${n}:\\s*([^;]+);`))[1].trim();
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  for (const n of ['--glaze', '--glaze-light', '--warn', '--stage', '--kiln']) assert.equal(val(`${n}-rgb`), hexRgb(val(n)), n);
});

test('offline.html: its colours use the same names, with the same values as style.css', () => {
  const html = file('public/offline.html');
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const own = style.slice(style.indexOf(':root {'), style.indexOf('}', style.indexOf(':root {')) + 1);
  const rest = style.replace(own, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(rest.match(COLOUR) || [], [], 'no written-out colours outside its :root');
  for (const [, name, value] of own.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    assert.match(root, new RegExp(`${name}:\\s*${value.trim()};`), `${name} is the same as in style.css`);
  }
});
