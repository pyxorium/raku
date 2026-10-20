import { defineConfig } from 'vite';
import { pageCsp } from './src/config.js';

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

export default defineConfig({
  plugins: [policy()],
  // 127.0.0.1, not localhost: the sign-in (stage 4) needs it. 5180, so the Foundry (5173) can run alongside.
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: { target: 'es2022', sourcemap: true, modulePreload: { polyfill: false } },
});
