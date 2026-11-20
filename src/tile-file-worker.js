// Reads a .tile file off Raku's page (claude/tile-files-plan.md, part 1): the page hands over the file's bytes, this
// worker checks and unpacks them (tile-file.js), and hands back the manifest and the files, or the reason it refused.
// A worker has no access to Raku's page, its sign-in or its storage, so a file built to trip the reader can't reach them.
import { readTileFile } from './tile-file.js';

self.onmessage = async (ev) => {
  const { id, bytes } = ev.data || {};
  const r = await readTileFile(bytes);
  if (!r.ok) { self.postMessage({ id, ok: false, reason: r.reason }); return; }
  const files = [];
  const transfer = [];
  for (const [path, data] of r.files) {
    const own = data.slice();           // its own buffer, so it can be handed over without a copy
    files.push([path, own]);
    transfer.push(own.buffer);
  }
  self.postMessage({ id, ok: true, name: r.name, manifest: r.manifest, files, totalBytes: r.totalBytes, savedFrom: r.savedFrom }, transfer);
};
