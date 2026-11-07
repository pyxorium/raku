# Ways in a browser (claude/raku-ways-plan.md, RW1 to RW8): Raku as the host for tiles with ways. Stand-in tiles that
# speak the way messages (as the maze's and Winter Forest's src/ways.js do) run through a replica of the tile loading
# server: Raku answers their hello with which exits lead somewhere, carries the traveller on in the same tab when they
# step through (the tab's address becomes the way taken), shows the screen between places with the destination's
# banner, "Pick a door" with "Stay here", "The way is blocked." back at the portal, Back along the trail landing at the
# portal you left by, a reload replaying the last leg, ways-only places opened directly (no arrival), a dormant way,
# test signposts (?sign=, this computer only), and no answers for a tile without ways.
#
# Usage: python3 test/browser/check_ways.py <work folder> <tiles-loading-server folder> <maze-tiles folder>
#   (needs Playwright with Chromium, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader and
#   rooms-lab, and port 80 free for the loader replica; the maze-tiles folder only for the forest's banner and icon)
import base64, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
MAZE = Path(sys.argv[3]).resolve()
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_HANDLE = 'pyxorium.com'
B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'; B_HANDLE = 'bad.fakepds.net'
LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
PLACE = 'cafe.thunderbird.way.place'
SIGNPOST = 'cafe.thunderbird.way.signpost'
TILE = 'ing.dasl.masl'

def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs = {}
def res(data, ctype):
    c = raw_cid(data); blobs[c] = data
    return {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}, 'content-type': ctype}

# ---- stand-in tiles that speak the way messages (M23), and one that doesn't ----
WAY_JS = b'''
const UP = 'tiles-protocol-up-way-payload', DOWN = 'tiles-protocol-down-way-payload';
const st = document.getElementById('st'), arr = document.getElementById('arr');
const arrivals = []; let host = false;
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const d = e.data; if (!d || d.action !== DOWN || !d.payload || d.payload.v !== 1) return;
  const p = d.payload;
  if (p.kind === 'status') { host = true; st.textContent = JSON.stringify(p.exits); }
  if (p.kind === 'arrive') { host = true; arrivals.push(p.entrance); arr.textContent = arrivals.join(','); }
});
const hello = () => parent.postMessage({ action: UP, payload: { v: 1, kind: 'hello', tile: document.body.dataset.tile, ways: '/ways.json' } }, '*');
hello(); setTimeout(() => { if (!host) hello(); }, 500);
window.leave = (exit) => parent.postMessage({ action: UP, payload: { v: 1, kind: 'leave', exit, facing: 'n' } }, '*');
'''
def way_page(name, tid):
    return (f'<!doctype html><meta charset=utf-8><body data-tile="{tid}" style="font:20px sans-serif;background:#eef4ff;padding:24px">'
            f'<h1 id=h>{name}</h1><p>status <span id=st>none</span></p><p>arrived <span id=arr>none</span></p><script src="/way.js"></script>').encode()
PLAIN = lambda title: f'<!doctype html><meta charset=utf-8><body style="font:20px sans-serif;background:#fffdf7;padding:24px"><h1 id=h>{title}</h1>'.encode()
def ways_json(tid, place, exits, entrances, entry=None):
    j = {'v': 1, 'tile': tid, 'place': place, 'exits': [{'id': e, 'signpost': s, 'fallback': f'https://thunderbird.cafe/way/{tid}/{e}'} for e, s in exits],
         'entrances': [{'id': e} for e in entrances]}
    if entry: j['entry'] = entry
    return json.dumps(j, indent=2).encode()

MAZE_TILE = f'at://{P}/{TILE}/3mazewaystest'
FOREST_TILE = f'at://{A}/{TILE}/3forestwaytest'
PLAIN_TILE = f'at://{A}/{TILE}/3plainwaytest'
QUIET_TILE = f'at://{A}/{TILE}/3quietwaytest'      # speaks the way messages but has no /ways.json: Raku doesn't answer
sp = lambda did, key: f'at://{did}/{SIGNPOST}/{key}'
pl = lambda did, key: f'at://{did}/{PLACE}/{key}'
maze_res = {'/': res(way_page('Escher maze (ways)', 'maze'), 'text/html'), '/way.js': res(WAY_JS, 'text/javascript'),
            '/ways.json': res(ways_json('maze', pl(P, 'maze'), [('obelisk', sp(P, 'maze.obelisk')), ('second-door', sp(P, 'maze.second-door'))], ['obelisk', 'second-door']), 'application/json')}
forest_res = {'/': res(way_page('Winter Forest (ways)', 'winter-forest'), 'text/html'), '/way.js': res(WAY_JS, 'text/javascript'),
              '/ways.json': res(ways_json('winter-forest', pl(A, 'winter-forest'),
                  [(e, sp(A, f'winter-forest.{e}')) for e in ['wardrobe', 'tree-door', 'arch', 'slide']], ['lamppost', 'wardrobe', 'tree-door', 'arch'], 'ways-only'), 'application/json'),
              '/banner.jpg': res((MAZE / 'forest' / 'tile' / 'banner.jpg').read_bytes(), 'image/jpeg'),
              '/icon.png': res((MAZE / 'forest' / 'tile' / 'icon.png').read_bytes(), 'image/png')}
records = {   # (repo, collection, rkey) -> (cid, value)
    (P, TILE, '3mazewaystest'): ('bafyreimazeways', {'$type': TILE, 'tile': {'name': 'Escher maze', 'resources': maze_res}}),
    (A, TILE, '3forestwaytest'): ('bafyreiforestways', {'$type': TILE, 'tile': {'name': 'Winter Forest', 'resources': forest_res,
        'screenshots': [{'src': '/banner.jpg'}], 'icons': [{'src': '/icon.png'}]}}),
    (A, TILE, '3plainwaytest'): ('bafyreiplainways', {'$type': TILE, 'tile': {'name': 'A plain tile', 'resources': {'/': res(PLAIN('A plain tile'), 'text/html')}}}),
    (A, TILE, '3quietwaytest'): ('bafyreiquietways', {'$type': TILE, 'tile': {'name': 'A quiet tile', 'resources': {'/': res(way_page('A quiet tile', 'quiet'), 'text/html'), '/way.js': res(WAY_JS, 'text/javascript')}}}),
    (P, PLACE, 'maze'): ('bafyreiplacemaze', {'$type': PLACE, 'tile': MAZE_TILE, 'cid': 'bafyreimazeways', 'name': 'Escher maze', 'updatedAt': '2026-10-29T05:29:18.784Z'}),
    (A, PLACE, 'winter-forest'): ('bafyreiplaceforest', {'$type': PLACE, 'tile': FOREST_TILE, 'cid': 'bafyreiforestways', 'name': 'Winter Forest', 'updatedAt': '2026-10-28T20:36:27.450Z'}),
    (A, PLACE, 'moved-on'): ('bafyreiplacemoved', {'$type': PLACE, 'tile': PLAIN_TILE, 'cid': 'bafyreisomeolderversion', 'name': 'Moved on', 'updatedAt': '2026-11-01T00:00:00Z'}),
    (B, PLACE, 'hidden'): ('bafyreiplacehidden', {'$type': PLACE, 'tile': PLAIN_TILE, 'cid': 'bafyreiplainways', 'name': 'Should not show', 'updatedAt': '2026-10-28T00:00:00Z'}),
    (P, SIGNPOST, 'maze.obelisk'): ('bafyreisign1', {'$type': SIGNPOST, 'to': [{'place': pl(A, 'winter-forest'), 'entrance': 'lamppost'}], 'updatedAt': '2026-10-28T00:00:00Z'}),
    (P, SIGNPOST, 'maze.second-door'): ('bafyreisign2', {'$type': SIGNPOST, 'to': [{'place': pl(A, 'moved-on')}], 'updatedAt': '2026-10-28T00:00:00Z'}),
    (A, SIGNPOST, 'winter-forest.slide'): ('bafyreisign3', {'$type': SIGNPOST, 'to': [{'place': pl(P, 'maze'), 'entrance': 'obelisk'}], 'updatedAt': '2026-10-29T05:40:00.000Z'}),
    (A, SIGNPOST, 'winter-forest.arch'): ('bafyreisign4', {'$type': SIGNPOST, 'to': [], 'updatedAt': '2026-10-28T00:00:00Z'}),
    (A, SIGNPOST, 'winter-forest.tree-door'): ('bafyreisign5', {'$type': SIGNPOST, 'to': [{'place': pl(B, 'hidden')}], 'updatedAt': '2026-10-28T00:00:00Z'}),
    (A, SIGNPOST, 'winter-forest.wardrobe'): ('bafyreisign6', {'$type': SIGNPOST, 'to': [{'place': pl(P, 'maze'), 'entrance': 'obelisk', 'label': 'Back to the maze'},
        {'tile': PLAIN_TILE, 'label': 'Somewhere plain'}], 'note': 'Two doors in the coats.', 'updatedAt': '2026-10-28T00:00:00Z'}),
}
calls = []

# ---- a copy of Raku, bundled ----
COPY = W / 'raku'
if COPY.exists(): shutil.rmtree(COPY)
shutil.copytree(RAKU_SRC, COPY, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'shots'), symlinks=True)
os.symlink(RAKU_SRC / 'node_modules', COPY / 'node_modules')
site = W / 'site' / 'assets'; site.mkdir(parents=True, exist_ok=True)
esbuild = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'
env = {**os.environ, 'NODE_PATH': f"{RAKU_SRC / 'node_modules'}:/opt/npm-tools/node_modules"}
subprocess.run([esbuild, str(COPY / 'src' / 'main.js'), '--bundle', '--format=esm', f'--outdir={site}', '--log-level=error',
                f'--alias:@atproto/oauth-client-browser={COPY / "test" / "browser" / "oauth-standin.js"}', "--define:__RAKU_BUILD__=\"test-1\""],
               check=True, env=env, cwd=str(COPY))
servers = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'servers.mjs'), str(W), str(COPY)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
replica = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'loader-replica.mjs'), str(LOADING_SERVER)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)

def route(r):
    url = r.request.url
    calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        handle = {A: A_HANDLE, P: P_HANDLE, B: B_HANDLE}.get(did)
        if not handle: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{handle}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {A_HANDLE: A, P_HANDLE: P, B_HANDLE: B}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile') or u.path.endswith('getProfiles'):
            actor = q.get('actor') or q.get('actors')
            labels = [{'src': LABELER, 'uri': f'at://{B}', 'val': '!hide', 'cts': '2026-10-01T00:00:00Z'}] if actor == B else []
            return js({'did': actor, 'labels': labels})
        return js({})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=json.dumps({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []}))
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('getRecord'):
            key = (q.get('repo'), q.get('collection'), q.get('rkey'))
            got = records.get(key)
            if not got: return js({'error': 'RecordNotFound'}, 400)
            cid, value = got
            return js({'uri': f"at://{key[0]}/{key[1]}/{key[2]}", 'cid': cid, 'value': value})
        if u.path.endswith('getBlob'):
            bb = blobs.get(q.get('cid'))
            if bb is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=bb)
        if u.path.endswith('listRecords'): return js({'records': []})
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
POKE = {'page': None}     # Playwright takes in new frames only while it's being called: poke a page while waiting
def wait_for(fn, timeout=10.0, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        try:
            if POKE['page']: POKE['page'].evaluate('1')
        except Exception: pass
        time.sleep(step)
    return None

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        HOSTS = ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']
        for host in HOSTS: ctx.route(host, route)
        page = ctx.new_page()
        console = []
        page.on('console', lambda m: console.append((m.type, m.text, (m.location or {}).get('url', ''))) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console.append(('pageerror', str(e))))
        POKE['page'] = page

        def inner():
            for f in page.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url:
                    if f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def t(sel):
            f = inner()
            return f.locator(sel).first.inner_text() if f else None
        def status(): s = t('#st'); return json.loads(s) if s and s != 'none' else None
        def arrived(): return t('#arr')
        def leave(exit): inner().evaluate(f'() => leave({json.dumps(exit)})')
        addr = lambda: page.input_value('.addr')
        title = lambda: page.inner_text('.tab.on .tab-title')
        screen = lambda: page.query_selector('.pane.front .way-screen')
        frames_in_front = lambda: page.eval_on_selector_all('.pane.front iframe.tile-frame', 'fs => fs.length')

        page.goto(RAKU + '?loader=' + LOADER)
        page.wait_for_selector('.addr')
        check('no "test signposts" mark without ?sign= (it is there, hidden)', page.evaluate("() => { const m = document.querySelector('.testmark'); return !!m && m.hidden; }"))

        # 1. the maze opened by its own address: Raku answers its hello (the obelisk glows), no arrival (RW5)
        page.fill('.addr', f'at://{P_HANDLE}/{TILE}/3mazewaystest'); page.press('.addr', 'Enter')
        check('a tile with ways opened directly: Raku answers its hello with which exits lead somewhere', wait_for(lambda: status() == {'obelisk': 'open', 'second-door': 'open'}, 20), str(status()))
        check('...and sends no arrival (it starts at its usual start)', arrived() == 'none', str(arrived()))
        check('...the address is the tile\'s own, the title its name', addr() == f'at://{P_HANDLE}/{TILE}/3mazewaystest' and title() == 'Escher maze', f'{addr()} {title()}')
        check('...its way messages are answered, not logged on the Messages panel', not page.is_visible('.pane.front .panel-pill'))
        maze_reads = [c for c in calls if 'getRecord' in c and 'maze.obelisk' in c and P.replace(':', '%3A') in c]
        check('...the exit\'s signpost read from its author\'s own server', maze_reads, str(maze_reads[:1]))

        # 2. through the obelisk: the screen with the destination's banner, the same tab, the way's address (RW1, RW2, RW4)
        tab_id = page.eval_on_selector('.pane.front', 'p => p.dataset.tab')
        n_tabs = page.eval_on_selector_all('.tab', 'ts => ts.length')
        # (the stand-in tiles say hello at once, so the screen may go before a check could look at it: watch for its picture)
        page.evaluate('''() => { window.__pics = []; new MutationObserver(() => { for (const i of document.querySelectorAll('.way-pic')) if (!i.dataset.seen && i.src.startsWith('blob:')) {
          i.dataset.seen = '1'; const done = () => window.__pics.push({ w: i.naturalWidth, hidden: i.hidden }); i.complete ? done() : i.addEventListener('load', done, { once: true }); } })
          .observe(document.querySelector('.stage'), { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'hidden'] }); }''')
        # (when the screen first shows, and how long until it's taken away, timed in the page itself)
        page.evaluate('''() => { window.__screenMs = null; let t0 = null; new MutationObserver(() => { const s = document.querySelector('.pane.front .way-screen');
          if (s && t0 === null) t0 = performance.now(); if (!s && t0 !== null && window.__screenMs === null) window.__screenMs = Math.round(performance.now() - t0); })
          .observe(document.querySelector('.stage'), { subtree: true, childList: true }); }''')
        leave('obelisk')
        check('stepping through: the screen between places shows the next place\'s name and author', wait_for(lambda: screen() and page.inner_text('.pane.front .way-name') == 'Winter Forest'
              and page.inner_text('.pane.front .way-by') == f'by @{A_HANDLE}', 10), page.inner_text('.pane.front .way-screen') if screen() else 'no screen')
        check('...with its banner, dimmed (the bytes Raku fetched, 1280 px)', wait_for(lambda: page.evaluate('() => window.__pics.some((p) => p.w === 1280 && !p.hidden)'), 10), str(page.evaluate('() => window.__pics')))
        banner_cid = forest_res['/banner.jpg']['src']['ref']['$link']
        check('...fetched from the author\'s own server', any('getBlob' in c and banner_cid in c and A.replace(':', '%3A') in c for c in calls))
        page.screenshot(path=str(OUT / 'ways-screen.png'))
        check('...in the same tab (no new tab)', page.eval_on_selector('.pane.front', 'p => p.dataset.tab') == tab_id and page.eval_on_selector_all('.tab', 'ts => ts.length') == n_tabs)
        check('the forest arrives at the signpost\'s entrance (the lamp post)', wait_for(lambda: arrived() == 'lamppost', 20), str(arrived()))
        check('...told which of its exits lead somewhere (arch dormant)', status() == {'wardrobe': 'open', 'tree-door': 'open', 'arch': 'dormant', 'slide': 'open'}, str(status()))
        check('...the tab\'s address is the way taken, with the checked handle', wait_for(lambda: addr() == f'raku:way/{P_HANDLE}/maze.obelisk', 5), addr())
        check('...titled with the place\'s name', title() == 'Winter Forest')
        # RW9: however fast the place loads, the screen stays at least about 1.5 s from stepping through (measured in the
        # page: from the moment the screen first showed to the moment it was taken away, the fade included)
        gone = wait_for(lambda: page.evaluate('() => window.__screenMs'), 6)
        print(f'  (the screen was up {gone} ms; the place said hello and arrived meanwhile)', flush=True)
        check('...the screen stays at least about 1.5 s from stepping through (RW9), though the place loads at once', gone and gone >= 1450, str(gone))
        check('...then goes, within about 2.5 s', gone and gone < 2600 and not screen(), str(gone))
        check('...one tile running in the tab', frames_in_front() == 1)
        check('...Back is enabled', not page.eval_on_selector('.nav-btn[title="Back"]', 'b => b.disabled'))
        check('...the page address keeps the way (#t=raku:way/…)', 'raku%3Away%2F' in page.url, page.url)
        check('...the place got the keys (its window has focus)', wait_for(lambda: inner().evaluate('() => document.hasFocus()'), 5))
        page.screenshot(path=str(OUT / 'ways-forest.png'))

        # 3. a dormant exit, a hidden destination: "The way is blocked.", back at that portal, the address unchanged
        leave('arch')
        check('a dormant way: back at that portal (the arch)', wait_for(lambda: arrived() == 'lamppost,arch', 10), str(arrived()))
        check('...with "The way is blocked."', wait_for(lambda: page.is_visible('.note') and page.inner_text('.note') == 'The way is blocked.', 3))
        check('...the address and the tab unchanged, no screen left', addr() == f'raku:way/{P_HANDLE}/maze.obelisk' and not screen())
        leave('tree-door')
        check('a way into a hidden account: blocked, back at the tree-door', wait_for(lambda: arrived() == 'lamppost,arch,tree-door', 10), str(arrived()))
        check('...nothing read from the hidden account\'s server', not any('getRecord' in c and B.replace(':', '%3A') in c for c in calls))

        # 4. several doors: "Pick a door", "Stay here"
        leave('wardrobe')
        check('a way to several places: "Pick a door" over the place', wait_for(lambda: screen() and page.inner_text('.pane.front .way-name') == 'Pick a door', 10))
        doors = page.eval_on_selector_all('.pane.front .way-door', 'ds => ds.map(d => d.innerText.replace(/\\s+/g, " ").trim())')
        check('...each door with its label, name and author', doors == [f'Back to the maze Escher maze by @{P_HANDLE}', f'Somewhere plain A plain tile by @{A_HANDLE}'], str(doors))
        check('...the signpost\'s note', page.inner_text('.pane.front .way-msg') == 'Two doors in the coats.')
        page.screenshot(path=str(OUT / 'ways-pick.png'))
        page.evaluate("() => { document.querySelector('.note').hidden = true; }")     # (the last step's note, cleared)
        page.click('.pane.front .way-actions button:has-text("Stay here")')
        check('"Stay here": back at the wardrobe, the screen gone', wait_for(lambda: arrived() == 'lamppost,arch,tree-door,wardrobe' and not screen(), 5), str(arrived()))
        check('...without "The way is blocked."', not page.is_visible('.note'))
        leave('wardrobe')
        wait_for(lambda: screen() and page.query_selector('.pane.front .way-door'), 10)
        page.click('.pane.front .way-door:has-text("Somewhere plain")')
        check('picking a door: a tile without ways opens there', wait_for(lambda: t('#h') == 'A plain tile', 15), str(t('#h')))
        check('...the address the way taken (the wardrobe)', wait_for(lambda: addr() == f'raku:way/{A_HANDLE}/winter-forest.wardrobe', 5), addr())
        check('...titled with the tile\'s name, the screen gone after a moment', wait_for(lambda: title() == 'A plain tile' and not screen(), 5))

        # 5. Back along the trail lands at the portal you left by; Forward arrives as you did
        page.click('.nav-btn[title="Back"]')
        check('Back: the forest again, at the wardrobe (the portal left by)', wait_for(lambda: t('#h') == 'Winter Forest (ways)' and arrived() == 'wardrobe', 20), f'{t("#h")} {arrived()}')
        check('...its address the way into it', addr() == f'raku:way/{P_HANDLE}/maze.obelisk', addr())
        page.click('.nav-btn[title="Back"]')
        check('Back again: the maze opened by its address, at the obelisk', wait_for(lambda: t('#h') == 'Escher maze (ways)' and arrived() == 'obelisk', 20), f'{t("#h")} {arrived()}')
        check('...and it has the keys without a click (RW10: Back)', wait_for(lambda: inner().evaluate('() => document.hasFocus()'), 5))
        page.click('.nav-btn[title="Forward"]')
        check('Forward: the forest, at the lamp post (as you arrived)', wait_for(lambda: t('#h') == 'Winter Forest (ways)' and arrived() == 'lamppost', 20), f'{t("#h")} {arrived()}')

        # 6. down the slide: the maze at its obelisk; a reload replays that leg (RW2)
        leave('slide')
        check('down the slide: the maze at the obelisk', wait_for(lambda: t('#h') == 'Escher maze (ways)' and arrived() == 'obelisk', 20), f'{t("#h")} {arrived()}')
        check('...the forward history dropped (a new way taken)', page.eval_on_selector('.nav-btn[title="Forward"]', 'b => b.disabled'))
        check('...address the slide', wait_for(lambda: addr() == f'raku:way/{A_HANDLE}/winter-forest.slide', 5), addr())
        page.reload(); page.wait_for_selector('.addr')
        check('a reload replays the last leg: the maze, at the obelisk', wait_for(lambda: t('#h') == 'Escher maze (ways)' and arrived() == 'obelisk', 20), f'{t("#h")} {arrived()}')
        check('...the address and title kept', wait_for(lambda: addr() == f'raku:way/{A_HANDLE}/winter-forest.slide' and title() == 'Escher maze', 5), f'{addr()} {title()}')

        # 7. a way whose place has moved on since it was pointed at: blocked, back at the second door
        leave('second-door')
        check('a place whose tile changed since it was pointed at it: blocked, back at that portal', wait_for(lambda: arrived() == 'obelisk,second-door' and page.inner_text('.note') == 'The way is blocked.', 10), str(arrived()))

        # 8. ways-only Winter Forest opened directly: a host, but no arrival (it keeps its postcard)
        page.click('.newtab')
        page.fill('.addr', f'at://{A_HANDLE}/{TILE}/3forestwaytest'); page.press('.addr', 'Enter')
        check('a ways-only place opened by its address: told its exits, no arrival', wait_for(lambda: status() is not None, 20) and arrived() == 'none', f'{status()} {arrived()}')

        # 9. a way typed: dormant; several doors with no choice yet (Pick a door, then in)
        page.fill('.addr', f'raku:way/{A_HANDLE}/winter-forest.arch'); page.press('.addr', 'Enter')
        check('a dormant way typed: "This doesn\'t lead anywhere yet."', wait_for(lambda: "This doesn't lead anywhere yet." in page.inner_text('.pane.front .tile-status'), 10))
        check('...with Back', page.is_visible('.pane.front .tile-status button:has-text("Back")'))
        page.fill('.addr', f'raku:way/{A_HANDLE}/winter-forest.wardrobe'); page.press('.addr', 'Enter')
        check('a way to several places typed: "Pick a door", with Back', wait_for(lambda: screen() and page.inner_text('.pane.front .way-name') == 'Pick a door' and page.is_visible('.pane.front .way-actions button:has-text("Back")'), 10))
        page.click('.pane.front .way-door:has-text("Escher maze")')
        check('...a door chosen: there, at its entrance', wait_for(lambda: t('#h') == 'Escher maze (ways)' and arrived() == 'obelisk', 20), f'{t("#h")} {arrived()}')
        page.fill('.addr', 'raku:way/thunderbird.cafe/nothing.here'); page.press('.addr', 'Enter')
        check('a signpost that doesn\'t exist: dormant', wait_for(lambda: "This doesn't lead anywhere yet." in page.inner_text('.pane.front .tile-status'), 10))

        # 10. a tile without a /ways.json that speaks the messages anyway: not answered (a plain viewer for it)
        page.fill('.addr', f'at://{A_HANDLE}/{TILE}/3quietwaytest'); page.press('.addr', 'Enter')
        wait_for(lambda: t('#h') == 'A quiet tile', 15)
        check('a tile opened from the address box has the keys without a click (RW10)', wait_for(lambda: inner().evaluate('() => document.hasFocus()'), 5))
        time.sleep(1.5)
        check('a tile without /ways.json: its hello isn\'t answered', status() is None and arrived() == 'none', f'{status()} {arrived()}')
        check('...and is logged on the Messages panel as before', wait_for(lambda: page.is_visible('.pane.front .panel-pill'), 3))

        # 10b. RW10's guard: someone typing in the address box while a tile loads keeps the keys
        page.fill('.addr', f'at://{A_HANDLE}/{TILE}/3plainwaytest'); page.press('.addr', 'Enter')
        page.click('.addr'); page.keyboard.type('still typing')
        wait_for(lambda: t('#h') == 'A plain tile', 15); time.sleep(1.6)
        check('...but not from someone typing in the address box meanwhile', page.evaluate("() => document.activeElement === document.querySelector('.addr')") and 'still typing' in page.input_value('.addr'), page.input_value('.addr'))
        page.keyboard.press('Escape'); page.evaluate("() => document.activeElement.blur()")

        # 11. test signposts (RW8): ?sign= fills the arch, here only; the mark shows
        page.goto(RAKU + '?loader=' + LOADER + '&sign=winter-forest.arch:maze@pyxorium.com/second-door#t=' + 'raku%3Away%2Fthunderbird.cafe%2Fwinter-forest.arch&a=0')
        page.wait_for_selector('.addr')
        check('test signposts: the mark shows', wait_for(lambda: page.is_visible('.testmark'), 5))
        check('...the dormant arch now leads to the maze\'s second door', wait_for(lambda: t('#h') == 'Escher maze (ways)' and arrived() == 'second-door', 20), f'{t("#h")} {arrived()}')
        page.screenshot(path=str(OUT / 'ways-test-signposts.png'))

        # 12. a phone: the screen and Pick a door fit
        phone = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
        for host in HOSTS: phone.route(host, route)
        pp = phone.new_page()
        POKE['page'] = pp
        pp.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Away%2Fthunderbird.cafe%2Fwinter-forest.wardrobe&a=0')
        check('phone: "Pick a door" fits the screen', wait_for(lambda: pp.query_selector('.pane.front .way-door') and pp.evaluate("() => [...document.querySelectorAll('.pane.front .way-door')].every(d => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth"), 15))
        pp.screenshot(path=str(OUT / 'ways-phone-pick.png'))
        phone.close()
        POKE['page'] = page

        STANDINS = ('https://pds.fakepds.net/', 'https://plc.directory/')
        errors = [c for c in console if not (c[1].startswith('Failed to load resource') and str(c[2] if len(c) > 2 else '').startswith(STANDINS))
                  and "directive 'form-src'" not in c[1]]
        check('no errors on Raku\'s page (besides the stand-in servers\' "no such record")', not errors, str(errors[:3]))
        b.close()
finally:
    servers.terminate(); replica.terminate()

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed} passed, {len(results) - passed} failed')
sys.exit(0 if passed == len(results) else 1)
