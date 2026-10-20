// The tile frames of one table and their health. Adapted COPY of the site's src/sevenup/frames.js and
// src/daisy/frames.js (the same file with different roles): here the roles and the frames' titles are
// given by each table's driver, the frames get Raku's frame settings, and stop() removes everything.
//
// One shared tile loader ("mothership") for the page (Raku's): each one listens to every message on the
// page, so several would trip over each other's tiles. Each tile can be started afresh (a new frame, a new
// random name on the loading server, a new worker), which is what Try again does.
//
// Health, per tile:
//   loading  → "Loading…"; after 4 s "Still loading…"; after 8 s a Try again ("stuck")
//   ready    → the tile has said something (its hello)
//   stopped  → it missed two heartbeats in a row; it becomes ready again if it speaks up
//   failed   → the loader couldn't load it at all
// The page sends the heartbeat itself (ping); any message from a tile counts as an answer.

export const DOWN = 'tiles-protocol-down-data-payload';

export function createFrames({ roles, titles = {}, mothership, tileUrlFor, mounts, heights, times, onStatus = () => {}, ping = () => {} }) {
  const state = Object.fromEntries(roles.map((r) => [r, { frame: null, status: 'idle', attempt: 0, timers: [], lastSeen: 0 }]));
  let stopped = false;

  function set(role, status, extra = {}) {
    const s = state[role];
    if (s.status === status && !extra.force) return;
    s.status = status;
    onStatus(role, status, extra);
  }

  async function start(role) {
    if (stopped) return;
    const s = state[role];
    const mine = ++s.attempt;
    s.timers.forEach(clearTimeout);
    if (s.frame) { s.frame.remove(); s.frame = null; }
    set(role, 'loading', { force: true });
    s.timers = [
      setTimeout(() => { if (mine === s.attempt && s.status === 'loading') set(role, 'slow'); }, times.still),
      setTimeout(() => { if (mine === s.attempt && (s.status === 'loading' || s.status === 'slow')) set(role, 'stuck'); }, times.retry),
    ];
    let tile = null;
    let error = null;
    try { tile = await mothership.loadTile(tileUrlFor(role)); } catch (err) { error = err; console.error('[raku] table tile load failed', role, err); }
    if (mine !== s.attempt || stopped) return;
    if (!tile) { s.timers.forEach(clearTimeout); set(role, 'failed', { error }); return; }
    const frame = tile.renderContent(heights[role]);
    frame.title = titles[role] || role;
    frame.setAttribute('allow', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    s.frame = frame;
    mounts[role].appendChild(frame);
  }

  // Which role sent a message (by the frame it came from), or null.
  function roleOf(source) {
    for (const r of roles) if (state[r].frame && state[r].frame.contentWindow === source) return r;
    return null;
  }

  // Any message from a tile: it's alive.
  function heard(role) {
    const s = state[role];
    s.lastSeen = performance.now();
    if (s.status === 'loading' || s.status === 'slow' || s.status === 'stuck') {
      s.timers.forEach(clearTimeout);
      set(role, 'ready', { first: true });
    } else if (s.status === 'stopped') {
      set(role, 'ready', { recovered: true });
    }
  }

  function send(role, payload) {
    const w = state[role]?.frame?.contentWindow;
    if (w) w.postMessage({ action: DOWN, payload }, '*');
  }

  // The heartbeat. Skipped while the page (or this tab of Raku) is out of sight.
  let n = 0;
  const limit = () => times.heartbeat * times.misses + 1000;
  const beat = setInterval(() => {
    if (document.hidden) return;
    n++;
    const now = performance.now();
    for (const r of roles) {
      const s = state[r];
      if (s.status !== 'ready' && s.status !== 'stopped') continue;
      if (s.status === 'ready' && now - s.lastSeen > limit()) set(r, 'stopped');
      ping(r, n);
    }
  }, times.heartbeat);
  const onVisible = () => { if (!document.hidden) for (const r of roles) state[r].lastSeen = performance.now(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    start, roleOf, heard, send,
    status: (role) => state[role].status,
    stop() {
      stopped = true;
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisible);
      for (const r of roles) { state[r].timers.forEach(clearTimeout); state[r].frame?.remove(); state[r].frame = null; }
    },
  };
}
