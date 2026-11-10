// Raku's look before the first paint (claude/raku-light-mode-plan.md, LM1, LM16): index.html loads this first in <head>,
// as a file because the page's policy allows only Raku's own scripts. It puts the saved Look and Light style (or the
// device's setting and Clear) on <html> for src/style.css, and sets color-scheme and the two theme-color lines, so the
// page never shows the wrong look first. src/look.js does the same once Raku runs; test/look.test.mjs keeps the two alike.
(function () {
  var THEMES = { bisque: '#e4dccf', porcelain: '#dee1e6', celadon: '#dae2de', washi: '#efe6cf', smoke: '#26211d', clear: '#e7e6e4' };
  var DARK = '#26211d';
  var look = null, style = null;
  try { look = localStorage.getItem('raku-look'); style = localStorage.getItem('raku-light-style'); } catch (e) { /* the defaults */ }
  if (look !== 'light' && look !== 'dark') look = 'device';
  if (!Object.prototype.hasOwnProperty.call(THEMES, style)) style = 'clear';
  var deviceLight = false;
  try { deviceLight = matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { /* dark */ }
  var mode = look === 'light' || (look === 'device' && deviceLight) ? 'light' : 'dark';
  var shown = mode === 'light' ? THEMES[style] : DARK;
  var root = document.documentElement;
  root.setAttribute('data-look', mode);
  root.setAttribute('data-light', style);
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', mode);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    var isLight = /light/.test(metas[i].getAttribute('media') || '');
    metas[i].setAttribute('content', look === 'device' ? (isLight ? THEMES[style] : DARK) : shown);
  }
})();
