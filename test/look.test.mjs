// The look (claude/raku-light-mode-plan.md, LM1, LM2, LM7, LM8, LM9, LM12 to LM17): Match device / Light / Dark and the
// six light styles, remembered in this browser; public/look.js before the first paint, src/look.js once Raku runs, the
// offline page's own script; the two theme-color lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LOOK, LIGHT_STYLES } from '../src/config.js';
import { lightStyle, readLook, resolveLook, applyLook, createLookSetting } from '../src/look.js';

const file = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const refusing = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
// A page with Raku's <head> lines (index.html's): color-scheme and the two theme-color lines with their media.
function fakeDoc() {
  const attrs = {};
  const meta = (name, content, media) => { const a = { name, content, media }; return { getAttribute: (k) => a[k] ?? null, setAttribute: (k, v) => { a[k] = v; }, a }; };
  const scheme = meta('color-scheme', 'light dark');
  const themes = [meta('theme-color', '#e7e6e4', '(prefers-color-scheme: light)'), meta('theme-color', '#26211d', '(prefers-color-scheme: dark)')];
  return {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null },
    querySelector: (s) => (s === 'meta[name="color-scheme"]' ? scheme : null),
    querySelectorAll: (s) => (s === 'meta[name="theme-color"]' ? themes : []),
    attrs, scheme, themes,
    seen: () => ({ look: attrs['data-look'], light: attrs['data-light'], scheme: scheme.a.content, themeLight: themes[0].a.content, themeDark: themes[1].a.content }),
  };
}
const fakeMedia = (matches) => { const fns = new Set(); return { matches, addEventListener: (t, f) => fns.add(f), flip(v) { this.matches = v; for (const f of fns) f({ matches: v }); } }; };

test('the saved choices: Match device and Clear to start; anything unknown, or a refusing storage, gives those', () => {
  assert.deepEqual(readLook(null), { look: 'device', style: 'clear' });
  assert.deepEqual(readLook(memory()), { look: 'device', style: 'clear' });
  assert.deepEqual(readLook(memory({ 'raku-look': 'light', 'raku-light-style': 'washi' })), { look: 'light', style: 'washi' });
  assert.deepEqual(readLook(memory({ 'raku-look': 'sepia', 'raku-light-style': 'neon' })), { look: 'device', style: 'clear' });
  assert.deepEqual(readLook(refusing), { look: 'device', style: 'clear' });
  assert.equal(lightStyle('nope').id, 'clear');
  assert.equal(LOOK.key, 'raku-look'); assert.equal(LOOK.styleKey, 'raku-light-style');
});

test('what shows: light or dark, the style, and the theme-color lines (LM1, LM13, LM17)', () => {
  assert.deepEqual(resolveLook({ look: 'device', style: 'clear' }, true), { mode: 'light', style: 'clear', theme: { light: '#e7e6e4', dark: '#26211d' } });
  assert.deepEqual(resolveLook({ look: 'device', style: 'washi' }, false), { mode: 'dark', style: 'washi', theme: { light: '#efe6cf', dark: '#26211d' } });
  assert.deepEqual(resolveLook({ look: 'light', style: 'porcelain' }, false), { mode: 'light', style: 'porcelain', theme: { light: '#dee1e6', dark: '#dee1e6' } }, 'a choice holds both lines');
  assert.deepEqual(resolveLook({ look: 'dark', style: 'porcelain' }, true), { mode: 'dark', style: 'porcelain', theme: { light: '#26211d', dark: '#26211d' } });
  assert.deepEqual(resolveLook({ look: 'light', style: 'smoke' }, true).theme, { light: '#26211d', dark: '#26211d' }, 'Smoke and clay: the dark bar\'s colour (LM17)');
});

test('the setting: applies at once, remembers, follows the device only while Match device, redraws the bowl', () => {
  const doc = fakeDoc(); const storage = memory(); const media = fakeMedia(false);
  let redraws = 0; let changes = 0;
  const look = createLookSetting({ storage, doc, media, redraw: () => { redraws++; } });
  look.onChange(() => { changes++; });
  assert.deepEqual(doc.seen(), { look: 'dark', light: 'clear', scheme: 'dark', themeLight: '#e7e6e4', themeDark: '#26211d' }, 'a dark device, Match device');
  assert.equal(redraws, 1);
  media.flip(true);
  assert.equal(look.mode, 'light'); assert.equal(doc.seen().look, 'light'); assert.equal(doc.seen().scheme, 'light');
  look.setStyle('bisque');
  assert.equal(storage.m.get('raku-light-style'), 'bisque');
  assert.deepEqual(doc.seen(), { look: 'light', light: 'bisque', scheme: 'light', themeLight: '#e4dccf', themeDark: '#26211d' });
  look.setLook('dark');
  assert.equal(storage.m.get('raku-look'), 'dark');
  assert.deepEqual(doc.seen(), { look: 'dark', light: 'bisque', scheme: 'dark', themeLight: '#26211d', themeDark: '#26211d' });
  const before = redraws;
  media.flip(false); media.flip(true);
  assert.equal(doc.seen().look, 'dark', 'a choice isn\'t moved by the device');
  assert.equal(redraws, before, 'nothing redrawn');
  assert.equal(look.deviceLight, true, 'but the menu knows (its note)');
  look.setLook('light');
  assert.equal(doc.seen().look, 'light');
  look.setLook('sepia'); look.setStyle('neon');
  assert.equal(look.look, 'light'); assert.equal(look.style, 'bisque', 'unknown values are ignored');
  assert.ok(changes >= 5);
  const again = createLookSetting({ storage, doc: fakeDoc(), media: fakeMedia(false), redraw: () => {} });
  assert.equal(again.look, 'light'); assert.equal(again.style, 'bisque', 'remembered in this browser');
  const lost = createLookSetting({ storage: refusing, doc: fakeDoc(), media: null, redraw: () => {} });
  lost.setLook('light');
  assert.equal(lost.mode, 'light', 'a refusing storage: this visit only');
});

// Runs a classic script (public/look.js, or the offline page's look script) in a stand-in page.
function runScript(code, { saved = {}, deviceLight = false, throws = false } = {}) {
  const doc = fakeDoc();
  const localStorage = throws ? refusing : memory(saved);
  vm.runInNewContext(code, { document: doc, localStorage, matchMedia: () => ({ matches: deviceLight, addEventListener() {} }) });
  return doc.seen();
}
const CASES = [];
for (const look of [undefined, 'device', 'light', 'dark', 'sepia']) {
  for (const style of [undefined, ...LIGHT_STYLES.map((s) => s.id), 'neon']) {
    for (const deviceLight of [false, true]) CASES.push({ look, style, deviceLight });
  }
}
const expected = ({ look, style, deviceLight }) => {
  const doc = fakeDoc();
  const saved = {}; if (look) saved['raku-look'] = look; if (style) saved['raku-light-style'] = style;
  applyLook(doc, resolveLook(readLook(memory(saved)), deviceLight));
  return [saved, doc.seen()];
};

test('public/look.js (before the first paint) puts the same look on the page as src/look.js, in every case', () => {
  const code = file('public/look.js');
  for (const c of CASES) {
    const [saved, want] = expected(c);
    assert.deepEqual(runScript(code, { saved, deviceLight: c.deviceLight }), want, JSON.stringify(c));
  }
  assert.deepEqual(runScript(code, { throws: true, deviceLight: true }), expected({ deviceLight: true })[1], 'a refusing storage');
  assert.doesNotMatch(code, /\bimport\b|\bexport\b/, 'a plain script, not a module (it runs before Raku)');
});

test('the offline page\'s look script does the same (LM9)', () => {
  const html = file('public/offline.html');
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const c of CASES) {
    const [saved, want] = expected(c);
    assert.deepEqual(runScript(code, { saved, deviceLight: c.deviceLight }), want, JSON.stringify(c));
  }
  assert.ok(html.indexOf('<script>') < html.indexOf('<title>'), 'in <head>, before the first paint');
});

test('the styles\' colours in config.js, public/look.js and the offline page are style.css\'s', () => {
  const css = file('src/style.css');
  const block = (sel) => { const i = css.search(new RegExp(`${sel.replace(/[[\]"]/g, '\\$&')}( \\{|,\\n)`)); return css.slice(i, css.indexOf('}', i)); };
  const val = (body, n) => body.match(new RegExp(`\\n\\s*${n}:\\s*([^;]+);`))[1].trim();
  const darkKiln = val(css.slice(css.indexOf(':root {')), '--kiln');
  assert.equal(LOOK.dark, darkKiln);
  assert.deepEqual(LIGHT_STYLES.map((s) => s.id), ['bisque', 'porcelain', 'celadon', 'washi', 'smoke', 'clear'], 'in the order of the plan (LM11)');
  for (const s of LIGHT_STYLES) {
    const body = block(s.id === 'clear' ? ':root[data-look="light"]' : `:root[data-look="light"][data-light="${s.id}"]`);
    const strip = s.id === 'smoke' ? darkKiln : val(body, '--kiln');
    assert.equal(s.strip, strip, `${s.name}: its swatch is its strip`);
    assert.equal(s.theme, strip, `${s.name}: its theme-color is its strip`);
    assert.equal(s.dot, val(body, '--glaze-btn'), `${s.name}: its swatch's dot is its turquoise`);
    // LM18: the palette bar beside its name: strip, page, card, words, turquoise words
    for (const [k, n] of [['page', '--stage'], ['card', '--card'], ['words', '--text'], ['turq', '--glaze-light']]) {
      assert.equal(s[k], val(body, n), `${s.name}: its palette bar's ${k} is its ${n}`);
    }
  }
  const themes = Object.fromEntries(LIGHT_STYLES.map((s) => [s.id, s.theme]));
  for (const [where, code] of [['public/look.js', file('public/look.js')], ['offline.html', file('public/offline.html')]]) {
    const copy = Object.fromEntries([...code.match(/THEMES = \{([^}]*)\}/)[1].matchAll(/(\w+): '(#[0-9a-f]{6})'/g)].map(([, k, v]) => [k, v]));
    assert.deepEqual(copy, themes, where);
  }
});

test('index.html: color-scheme, the two theme-color lines, and public/look.js before anything is drawn', () => {
  const html = file('index.html');
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<meta name="theme-color" content="#e7e6e4" media="\(prefers-color-scheme: light\)">/, 'Clear\'s strip (LM13)');
  assert.match(html, /<meta name="theme-color" content="#26211d" media="\(prefers-color-scheme: dark\)">/);
  assert.equal((html.match(/name="theme-color"/g) || []).length, 2);
  const tag = html.indexOf('<script src="/look.js"></script>');
  assert.ok(tag > html.lastIndexOf('name="theme-color"') && tag < html.indexOf('<title>'), 'after the lines it sets, first of everything else');
  assert.ok(tag < html.indexOf('<body>') && tag < html.indexOf('type="module"'));
  assert.doesNotMatch(html, /<script>/, 'no inline script: the page policy allows only Raku\'s own files (LM16)');
});
