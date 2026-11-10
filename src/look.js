// The look (claude/raku-light-mode-plan.md, LM1, LM2, LM7, LM12 to LM17): Raku follows the device's light or dark
// setting, or the choice made in the account menu's Look row (Match device / Light / Dark), and the light look comes
// in six styles (the Light style row; Clear by default). Both choices are remembered in this browser, as Autoplay is.
// public/look.js applies the same before the first paint (it runs first in <head>); this takes over once Raku runs,
// follows the device live while the choice is Match device, and applies a new choice at once.
// Applying means: data-look ("light" or "dark") and data-light (the style) on <html>, which src/style.css keys on;
// the color-scheme line; the two theme-color lines (the browser bar, the installed app's window); and the bowl beside
// the Raku label redrawn in the new colours (refreshBrandPots).
import { LOOK, LIGHT_STYLES } from './config.js';
import { refreshBrandPots } from './icons.js';

/** A light style by id, or the default (Clear) for an unknown one. */
export function lightStyle(id) {
  return LIGHT_STYLES.find((s) => s.id === id) || LIGHT_STYLES.find((s) => s.id === LOOK.defaultStyle);
}

/** The saved choices, or the defaults (Match device, Clear) when nothing usable is saved or storage refuses. */
export function readLook(storage) {
  let look = null; let style = null;
  try { look = storage?.getItem(LOOK.key) ?? null; style = storage?.getItem(LOOK.styleKey) ?? null; } catch { /* the defaults */ }
  return { look: LOOK.looks.includes(look) ? look : LOOK.defaultLook, style: lightStyle(style).id };
}

/** What shows: light or dark, the style, and the two theme-color lines' colours (light line, dark line). */
export function resolveLook({ look, style }, deviceLight) {
  const s = lightStyle(style);
  const mode = look === 'light' || (look === 'device' && deviceLight) ? 'light' : 'dark';
  const shown = mode === 'light' ? s.theme : LOOK.dark;
  // With Match device the two lines keep their own media and the browser picks; a choice holds both to what shows.
  const theme = look === 'device' ? { light: s.theme, dark: LOOK.dark } : { light: shown, dark: shown };
  return { mode, style: s.id, theme };
}

/** Puts a resolved look on the page. */
export function applyLook(doc, { mode, style, theme }) {
  const root = doc.documentElement;
  root.setAttribute('data-look', mode);
  root.setAttribute('data-light', style);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') || '';
    meta.setAttribute('content', /light/.test(media) ? theme.light : theme.dark);
  }
}

/**
 * The Look and Light style choices (LM7, LM14), shared by the account menu. look: "device", "light" or "dark";
 * style: a LIGHT_STYLES id; mode: what shows now; deviceLight: whether the device is set to light.
 */
export function createLookSetting({ storage = null, doc = globalThis.document, media = globalThis.matchMedia?.('(prefers-color-scheme: light)') ?? null,
  redraw = (d) => refreshBrandPots(d) } = {}) {
  let { look, style } = readLook(storage);
  let deviceLight = !!media?.matches;
  const listeners = new Set();
  const state = () => resolveLook({ look, style }, deviceLight);
  function apply() {
    if (doc) { applyLook(doc, state()); redraw(doc); }
    for (const fn of listeners) fn();
  }
  const save = (key, value) => { try { storage?.setItem(key, value); } catch { /* fine: this visit only */ } };
  const onDevice = (ev) => { deviceLight = !!ev.matches; if (look === 'device') apply(); else for (const fn of listeners) fn(); };
  media?.addEventListener?.('change', onDevice);
  apply();
  return {
    get look() { return look; },
    get style() { return style; },
    get mode() { return state().mode; },
    get deviceLight() { return deviceLight; },
    setLook(v) { if (!LOOK.looks.includes(v) || v === look) return; look = v; save(LOOK.key, v); apply(); },
    setStyle(id) { const s = lightStyle(id).id; if (s !== id || s === style) return; style = s; save(LOOK.styleKey, s); apply(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
