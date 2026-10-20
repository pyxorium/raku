// Raku starts here.
import './style.css';
import { TileMothership } from '@dasl/tile-loader';
import { TILE_LOAD_DOMAIN, SITE, loadSourceOverride } from './config.js';
import { isFramed, showOpenInOwnTab } from './frame-guard.js';
import { createResolver } from './resolve.js';
import { createModeration } from './moderation.js';
import { createFileStore } from './tiles.js';
import { createShelf, STORAGE_KEY } from './shelf-store.js';
import { mountRaku } from './app.js';

const root = document.getElementById('raku');

if (isFramed()) {
  showOpenInOwnTab(root, SITE.origin + '/');
} else {
  // One shared tile loader ("mothership") for the whole page: each one listens to every message on
  // the page, so several would trip over each other's tiles.
  const mothership = new TileMothership({ loadDomain: TILE_LOAD_DOMAIN });
  const override = loadSourceOverride();
  if (override) mothership.getLoadSource = () => override;
  mothership.init();

  let storage = null;
  try { storage = globalThis.localStorage; } catch { storage = null; }
  const moderation = createModeration({ storage });
  moderation.refresh();
  const shelf = createShelf({ storage });
  // Another Raku tab changed your shelf: read it again.
  globalThis.addEventListener('storage', (ev) => { if (ev.key === STORAGE_KEY) shelf.reload(); });
  mountRaku(root, { mothership, resolver: createResolver(), moderation, files: createFileStore(), shelf });
}
