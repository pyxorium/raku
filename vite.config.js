import { defineConfig } from 'vite';
import { pageCsp, oauthMetadata, cardTags } from './src/config.js';

// The page's security policy goes into the built page only (GitHub Pages can't send headers). Vite's
// dev server injects its own scripts, which the policy would block, so `npm run dev` runs without it;
// `npm run build` then `npm run preview` shows the page with it.
const policy = () => ({
  name: 'raku-page-policy',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${pageCsp()}">\n  <meta name="referrer"`);
  },
});

// Raku's link card (stage 6): the Open Graph and Twitter-card tags, written from config.js (dev and build).
const card = () => ({
  name: 'raku-link-card',
  transformIndexHtml(html) {
    return html.replace('  <title>', `  ${cardTags()}\n  <title>`);
  },
});

// The sign-in description file (stage 4), written from config.js on build so Raku's address is named in
// one place. On this computer (127.0.0.1) the sign-in is a "loopback" one that needs no file (auth.js).
const signInFile = () => ({
  name: 'raku-oauth-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'oauth.json', source: `${JSON.stringify(oauthMetadata(), null, 2)}\n` });
  },
});

// Stage 9's update rule (src/app-shell.js): each build has an id, written into the page (__RAKU_BUILD__) and
// into /version.json, which an open Raku reads now and then to see whether a newer version is out. On GitHub
// the id is the commit; on this computer, the time of the build.
const BUILD = (process.env.GITHUB_SHA || '').slice(0, 12) || `local-${Date.now().toString(36)}`;
const versionFile = () => ({
  name: 'raku-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD })}\n` });
  },
});

export default defineConfig(({ command }) => ({
  plugins: [policy(), signInFile(), card(), versionFile()],
  // Only in the built page: under `npm run dev` the id stays "dev" and the service worker is never registered.
  define: command === 'build' ? { __RAKU_BUILD__: JSON.stringify(BUILD) } : {},
  // 127.0.0.1, not localhost: the sign-in needs it (the loopback sign-in comes back to 127.0.0.1). 5180, so the Foundry (5173) can run alongside.
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: { target: 'es2022', sourcemap: true, modulePreload: { polyfill: false } },
}));
