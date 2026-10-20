// Test servers for test/browser/check_page.py: Raku's page (127.0.0.1:5180, with its policy, from a bundle
// in <work>/site/assets), and an "outside" server (outside.localhost:9999) that logs every request a tile
// manages to make. Usage: node test/browser/servers.mjs <work folder> [raku folder]
import { createServer } from 'node:http';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const W = process.argv[2];
const RAKU = process.argv[3] || new URL('../..', import.meta.url).pathname;
const { pageCsp } = await import(join(RAKU, 'src/config.js'));
const csp = pageCsp('load.tiles.lex.localhost', 'http');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
let html = await readFile(join(RAKU, 'index.html'), 'utf8');
html = html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer"`)
  .replace('<script type="module" src="/src/main.js"></script>', '<link rel="stylesheet" href="/assets/main.css"><script type="module" src="/assets/main.js"></script>');
await writeFile(join(W, 'outside.log'), '');
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/' || path === '/index.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(html); }
  for (const f of [join(W, 'site', path), join(W, 'override', path), join(RAKU, 'public', path)]) {
    try { const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); return res.end(b); } catch {}
  }
  res.writeHead(404); res.end();
}).listen(5180, '127.0.0.1');
createServer(async (req, res) => {
  await appendFile(join(W, 'outside.log'), `${req.method} ${req.url}\n`);
  if (req.url.startsWith('/framer')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>framer</title><iframe id=f src="http://127.0.0.1:5180/" style="width:800px;height:400px"></iframe>');
  }
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('outside');
}).on('upgrade', async (req, sock) => { await appendFile(join(W, 'outside.log'), `UPGRADE ${req.url}\n`); sock.destroy(); })
  .listen(9999, '127.0.0.1');
console.log('servers up');
