# Renderer tiles in a browser (claude/raku-renderer-tiles-plan.md, RT1 to RT10): a place address opens in a tab, shown
# by the real place renderer tile (C:\thunderbird-cafe\maze-tiles\place\tile\, pinned by its record CID) through a
# replica of the tile loading server; Raku hands it the record over the tiles spec's data protocol; "Step into" opens
# the place's tile in a new tab; "Open in" shows the record in an explorer; the refusals and the limits. Places' tile
# card (claude/raku-places-card-plan.md, PC1 to PC6): the tile record Raku reads for it, and the banner's bytes Raku
# fetches for it ({ picture, from }) only when a record it was handed lists that file, of the four picture kinds, at most
# 1 MB, within the same 20 per load.
#
# It sets everything up itself: a copy of this Raku folder with a test pin in RENDERERS (the real pin is filled in
# after publishing), bundled with esbuild and the stand-in sign-in, then servers.mjs and loader-replica.mjs.
# Usage: python3 test/browser/check_renderer.py <work folder> <tiles-loading-server folder> <maze-tiles folder>
#   (needs Playwright with Chromium, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader and
#   rooms-lab, and port 80 free for the loader replica)
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
TILE = 'ing.dasl.masl'

def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs = {}
def res(data, ctype):
    c = raw_cid(data); blobs[c] = data
    return {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}, 'content-type': ctype}
TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png'}

# ---- the renderer tile, from maze-tiles, under a test record pinned by a test CID ----
RENDERER_RKEY = '3mzplacestest'
RENDERER_CID = 'bafyreiplacesrenderertestpinaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
place_dir = MAZE / 'place' / 'tile'
resources = {}
for f in ['index.html', 'place.css', 'place.js', 'view.js', 'icon.png', 'banner.png']:
    resources['/' if f == 'index.html' else f'/{f}'] = res((place_dir / f).read_bytes(), TYPES[Path(f).suffix])
renderer_record = {'$type': TILE, 'cid': 'bafyreimanifest', 'tile': {'name': 'Places', 'description': 'Shows a place.', 'resources': resources,
    'icons': [{'src': '/icon.png'}], 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-05T12:00:00Z'}
PLAIN = lambda title: f'<!doctype html><meta charset=utf-8><body style="font:20px sans-serif;background:#fffdf7;padding:24px"><h1 id=h>{title}</h1>'.encode()

FOREST_TILE = f'at://{A}/{TILE}/3myxm45elkp22'
MAZE_TILE = f'at://{P}/{TILE}/3myyjuyr2ja2s'
records = {   # (repo, collection, rkey) -> (cid, value)
    (A, TILE, RENDERER_RKEY): (RENDERER_CID, renderer_record),
    (A, TILE, '3myxm45elkp22'): ('bafyreiforest', {'$type': TILE, 'cid': 'bafy', 'createdAt': '2026-10-28T20:30:00.000Z', 'tile': {'name': 'Winter Forest',
        'description': 'A snowy night forest. A lamp post glows in a clearing.', 'screenshots': [{'src': '/banner.jpg'}], 'icons': [{'src': '/icon.png'}],
        'resources': {'/': res(PLAIN('Winter Forest tile'), 'text/html'), '/banner.jpg': res((MAZE / 'forest' / 'tile' / 'banner.jpg').read_bytes(), 'image/jpeg'),
          '/icon.png': res((MAZE / 'forest' / 'tile' / 'icon.png').read_bytes(), 'image/png'),
          '/big.png': res(b'\x89PNG\r\n\x1a\n' + bytes(1024 * 1024 + 10), 'image/png'),          # over the 1 MB limit
          '/note.svg': res(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml')}}}),
    (P, TILE, '3myyjuyr2ja2s'): ('bafyreimaze', {'$type': TILE, 'cid': 'bafy', 'tile': {'name': 'Escher maze', 'resources': {'/': res(PLAIN('Escher maze tile'), 'text/html')}}}),
    (A, PLACE, 'winter-forest'): ('bafyreiplaceforest', {'$type': PLACE, 'tile': FOREST_TILE, 'cid': 'bafyreiforest', 'name': 'Winter Forest', 'updatedAt': '2026-10-28T20:36:27.450Z'}),
    (P, PLACE, 'maze'): ('bafyreiplacemaze', {'$type': PLACE, 'tile': MAZE_TILE, 'cid': 'bafyreimaze', 'name': 'Escher maze', 'updatedAt': '2026-10-29T05:29:18.784Z'}),
    (A, PLACE, 'gone'): ('bafyreiplacegone', {'$type': PLACE, 'tile': f'at://{A}/{TILE}/3mzgonegonegon', 'cid': 'x', 'name': 'A cleared lot', 'updatedAt': '2026-11-01T00:00:00Z'}),
    (B, PLACE, 'hidden'): ('bafyreiplacehidden', {'$type': PLACE, 'tile': FOREST_TILE, 'cid': 'x', 'name': 'Should not show', 'updatedAt': '2026-10-28T00:00:00Z'}),
    (A, 'app.bsky.feed.like', '3mzlike'): ('bafyreilike', {'$type': 'app.bsky.feed.like', 'subject': {}}),
}
# ---- the signpost renderer (claude/raku-renderer-tiles-plan.md, "The signpost renderer"), from maze-tiles, test-pinned ----
SIGNPOST = 'cafe.thunderbird.way.signpost'
SIGN_RKEY = '3mzsignstest'
SIGN_CID = 'bafyreisignpostsrenderertestpinaaaaaaaaaaaaaaaaaaaaaaaaaaa'
sign_dir = MAZE / 'signpost' / 'tile'
sign_res = {}
for f in ['index.html', 'signpost.css', 'signpost.js', 'view.js', 'icon.png', 'banner.png']:
    sign_res['/' if f == 'index.html' else f'/{f}'] = res((sign_dir / f).read_bytes(), TYPES[Path(f).suffix])
records[(A, TILE, SIGN_RKEY)] = (SIGN_CID, {'$type': TILE, 'cid': 'bafyreimanifest2', 'tile': {'name': 'Signposts', 'description': 'Shows a signpost.', 'resources': sign_res,
    'icons': [{'src': '/icon.png'}], 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-06T12:00:00Z'})
MAZE_PLACE = f'at://{P}/{PLACE}/maze'
records[(A, SIGNPOST, 'winter-forest.slide')] = ('bafyreisignslide', {'$type': SIGNPOST, 'to': [{'place': MAZE_PLACE, 'entrance': 'obelisk'}], 'updatedAt': '2026-10-29T05:40:00.000Z'})
state = {'renderer_cid': RENDERER_CID}
calls = []

# ---- a copy of Raku with the test pin, bundled ----
COPY = W / 'raku'
if COPY.exists(): shutil.rmtree(COPY)
shutil.copytree(RAKU_SRC, COPY, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'shots'), symlinks=True)
os.symlink(RAKU_SRC / 'node_modules', COPY / 'node_modules')
cfg = (COPY / 'src' / 'config.js').read_text()
pin = f"'{PLACE}': Object.freeze({{ name: 'Places', uri: 'at://{A}/{TILE}/{RENDERER_RKEY}', cid: '{RENDERER_CID}' }}),"
cfg2 = re.sub(r"'cafe\.thunderbird\.way\.place': Object\.freeze\(\{[^}]*\}\),", pin, cfg, count=1)
assert cfg2 != cfg or "uri: 'at://" in cfg, 'the RENDERERS entry was not found'
sign_pin = f"'{SIGNPOST}': Object.freeze({{ name: 'Signposts', uri: 'at://{A}/{TILE}/{SIGN_RKEY}', cid: '{SIGN_CID}' }}),"
cfg3 = re.sub(r"'cafe\.thunderbird\.way\.signpost': Object\.freeze\(\{[^}]*\}\),", sign_pin, cfg2, count=1)
assert cfg3 != cfg2 or SIGN_CID in cfg2, 'the signpost RENDERERS entry was not found'
(COPY / 'src' / 'config.js').write_text(cfg3)
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
            if key == (A, TILE, RENDERER_RKEY): cid = state['renderer_cid']
            return js({'uri': f"at://{key[0]}/{key[1]}/{key[2]}", 'cid': cid, 'value': value})
        if u.path.endswith('getBlob'):
            bb = blobs.get(q.get('cid'))
            if bb is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=bb)
        if u.path.endswith('listRecords'): return js({'records': []})
    if u.hostname in ('pdsls.dev', 'atproto.at'):          # the explorers: stand-ins (the sandbox can't reach them)
        return r.fulfill(status=200, headers={'content-type': 'text/html'}, body=f'<!doctype html><title>{u.hostname}</title>explorer')
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
POKE = {'page': None}     # Playwright takes in new frames and windows only while it's being called: poke a page while waiting
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
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://pdsls.dev/**', 'https://atproto.at/**']:
            ctx.route(host, route)
        popups = []
        ctx.on('page', lambda pg: popups.append(pg))
        page = ctx.new_page()
        console = []
        page.on('console', lambda m: console.append((m.type, m.text, (m.location or {}).get('url', ''))) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console.append(('pageerror', str(e))))
        POKE['page'] = page
        page.goto(RAKU + '?loader=' + LOADER)
        page.wait_for_selector('.addr')

        def inner():
            for f in page.frames:
                if re.match(r'http://[a-z]{20}\.tiles\.lex\.localhost/$', f.url) or (f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url):
                    if f.parent_frame and f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def tile_text(sel):
            f = inner()
            return f.locator(sel).first.inner_text() if f else None
        def tab_count(): return page.eval_on_selector_all('.tab', 'ts => ts.length')
        # RT12: the front tab's icon, as [width, height, its pixels' fingerprint] once drawn, else None
        def tab_icon():
            return page.evaluate('''() => { const i = document.querySelector('.tab.on img.tab-icon'); if (!i || !i.complete || !i.naturalWidth) return null;
              const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d'); g.drawImage(i, 0, 0, 32, 32);
              const d = g.getImageData(0, 0, 32, 32).data; let h = 0; for (let k = 0; k < d.length; k += 7) h = (h * 31 + d[k]) >>> 0; return [i.naturalWidth, i.naturalHeight, h]; }''')

        # 1. a place typed in the box opens in this tab, shown by the renderer
        page.fill('.addr', f'at://{A_HANDLE}/{PLACE}/winter-forest'); page.press('.addr', 'Enter')
        check('a place address opens in this tab, not the link message', wait_for(lambda: page.query_selector('.pane.front iframe.tile-frame'), 10) and not page.query_selector('.link-msg'))
        check('the renderer runs on its own random name under the loading server', wait_for(lambda: inner(), 15))
        check('Raku hands it the record: the place\'s name', wait_for(lambda: tile_text('h1') == 'Winter Forest', 15), str(tile_text('h1')))
        check('...who made it (the checked handle) and when', wait_for(lambda: tile_text('.by') == 'A place by @thunderbird.cafe. Updated Oct 28, 2026.', 5), str(tile_text('.by')))
        check('...the tile behind it', tile_text('.card code') == FOREST_TILE)
        check('the status box is gone once the renderer has the record', wait_for(lambda: page.eval_on_selector('.pane.front .tile-status', 'b => b.hidden'), 5))
        check('the tab is titled with the place\'s name', page.inner_text('.tab.on .tab-title') == 'Winter Forest')
        place_icon = wait_for(tab_icon, 5)
        check('RT12: the place\'s tab shows its renderer\'s icon (the carved door, 256 px)', place_icon and place_icon[:2] == [256, 256], str(place_icon))
        check('the address box shows the place\'s address with the checked handle', wait_for(lambda: page.input_value('.addr') == f'at://{A_HANDLE}/{PLACE}/winter-forest', 5), page.input_value('.addr'))
        check('no star (the shelf keeps tiles and accounts); no Messages button', page.eval_on_selector('.star-btn', 'b => b.hidden') and not page.is_visible('.pane.front .panel-pill'))
        check('the tab is kept in the page address (#t=)', 'winter-forest' in page.url and '#t=' in page.url)
        reads = [c for c in calls if 'getRecord' in c and PLACE in c]
        check('the record was read from its author\'s own server', any(f'repo={A.replace(":", "%3A")}' in c for c in reads), str(reads[:2]))
        # 1b. Places' tile card (PC1 to PC6): the tile record Raku read, and the banner Raku fetched for it
        rec = records[(A, TILE, '3myxm45elkp22')][1]['tile']['resources']
        BANNER_CID, BIG_CID, SVG_CID, HTML_CID = (rec[k]['src']['ref']['$link'] for k in ['/banner.jpg', '/big.png', '/note.svg', '/'])
        check('the tile\'s card: its name and who made it, from the tile record Raku read', wait_for(lambda: tile_text('.card h2') == 'Winter Forest' and tile_text('.card .tby') == 'A tile by @thunderbird.cafe. Published Oct 28, 2026.', 10), str(tile_text('.card .tby')))
        check('...its description', tile_text('.card .desc') == 'A snowy night forest. A lamp post glows in a clearing.')
        check('...the tile record read from its author\'s server', any('getRecord' in c and 'rkey=3myxm45elkp22' in c for c in calls))
        check('...its banner, from the bytes Raku fetched (a blob: picture, 1280 px)', wait_for(lambda: inner().locator('img.pic').evaluate('i => i.src.startsWith("blob:") && i.complete && i.naturalWidth === 1280'), 10))
        check('...fetched from the author\'s own server', any('getBlob' in c and BANNER_CID in c and A.replace(':', '%3A') in c for c in calls))
        check('...the tile\'s address still under it', tile_text('.card code') == FOREST_TILE)
        page.screenshot(path=str(OUT / 'renderer-place.png'))
        f = inner()
        f.evaluate('''() => { window.__pics = []; addEventListener('message', (e) => { const p = e.data && e.data.payload; if (p && typeof p.gotPicture === 'string') window.__pics.push({ cid: p.gotPicture, from: p.from, error: p.error || null, type: p.type || null, n: p.bytes ? p.bytes.byteLength : 0 }); }); }''')
        up = lambda payload: f.evaluate('(p) => parent.postMessage({ action: "tiles-protocol-up-data-payload", payload: p }, "*")', payload)
        pics = lambda: f.evaluate('() => window.__pics')
        answer = lambda cid, frm: wait_for(lambda: next((x for x in pics() if x['cid'] == cid and x['from'] == frm), None), 8)
        maze_rec = records[(P, TILE, '3myyjuyr2ja2s')][1]['tile']['resources']['/']['src']['ref']['$link']
        blob_calls = lambda cid: [c for c in calls if 'getBlob' in c and cid in c]
        a = answer(maze_rec, FOREST_TILE) if up({'picture': maze_rec, 'from': FOREST_TILE}) is None else None
        check('a picture the record doesn\'t list: refused (not-allowed)', a and a['error'] == 'not-allowed', str(a))
        a = answer(maze_rec, MAZE_TILE) if up({'picture': maze_rec, 'from': MAZE_TILE}) is None else None
        check('...from a record not handed to this renderer: refused', a and a['error'] == 'not-allowed', str(a))
        a = answer(BANNER_CID, f'at://{A}/{PLACE}/winter-forest') if up({'picture': BANNER_CID, 'from': f'at://{A}/{PLACE}/winter-forest'}) is None else None
        check('...from a record handed over that doesn\'t list it (the place): refused', a and a['error'] == 'not-allowed', str(a))
        check('...and nothing was fetched for them', not blob_calls(maze_rec))
        a = answer(BIG_CID, FOREST_TILE) if up({'picture': BIG_CID, 'from': FOREST_TILE}) is None else None
        check('a picture over 1 MB: too-big', a and a['error'] == 'too-big', str(a))
        a = answer(SVG_CID, FOREST_TILE) if up({'picture': SVG_CID, 'from': FOREST_TILE}) is None else None
        check('an SVG (it can carry script): not-a-picture', a and a['error'] == 'not-a-picture', str(a))
        a = answer(HTML_CID, FOREST_TILE) if up({'picture': HTML_CID, 'from': FOREST_TILE}) is None else None
        check('a file that isn\'t a picture: not-a-picture', a and a['error'] == 'not-a-picture', str(a))
        before_pics = len(pics())
        for _ in range(25): up({'picture': BANNER_CID, 'from': FOREST_TILE})
        check('pictures share the 20 per load with reads: the rest refused as too many', wait_for(lambda: len(pics()) >= before_pics + 25, 15) and sum(1 for x in pics()[before_pics:] if x['error'] == 'too-many') >= 5, str([x['error'] for x in pics()[before_pics:]][-6:]))
        sent = [x for x in pics()[before_pics:] if not x['error']]
        # the budget: the tile's own get and banner (2), then too-big, the SVG and the HTML file (3): 15 left
        check('...the allowed ones answered with the JPEG\'s bytes', len(sent) == 15 and all(x['type'] == 'image/jpeg' and x['n'] == len(blobs[BANNER_CID]) for x in sent), f'{len(sent)} {sent[:1]}')

        # 1c. a place whose tile is gone: "Raku couldn't find this tile.", Step into kept (PC5)
        page.click('.newtab')
        page.fill('.addr', f'at://{A_HANDLE}/{PLACE}/gone'); page.press('.addr', 'Enter')
        check('a place whose tile is gone: "Raku couldn\'t find this tile…"', wait_for(lambda: tile_text('.card .cant') == "Raku couldn't find this tile. It may have been deleted, or its author's server may not be answering right now.", 20), str(tile_text('.card .cant')))
        check('...Step into kept, the address under it', inner().locator('button.go').count() == 1 and tile_text('.card code') == f'at://{A}/{TILE}/3mzgonegonegon')
        page.screenshot(path=str(OUT / 'renderer-place-gone.png'))
        page.locator('.tab.on .tab-x').click()
        page.locator('.tab').nth(0).click()            # back to the place's tab (the first)
        wait_for(lambda: page.inner_text('.tab.on .tab-title') == 'Winter Forest' and inner() is not None, 5)

        # 2. Open in (RT3)
        check('"Open in" shows beside the address box', page.is_visible('.openin-btn'))
        page.click('.openin-btn')
        items = page.eval_on_selector_all('.openin-item', 'bs => bs.map(b => [b.textContent, b.getAttribute("aria-checked")])')
        check('...PDSls (ticked: the default) and Taproot', items == [['✓PDSls', 'true'], ['Taproot', 'false']], str(items))
        page.screenshot(path=str(OUT / 'renderer-openin.png'))
        n_pop = len(popups)
        page.click('.openin-item:has-text("Taproot")')
        pop = wait_for(lambda: popups[n_pop] if len(popups) > n_pop else None, 5)
        check('...Taproot opens the record (with the DID) in a new window', pop and wait_for(lambda: pop.url.startswith(f'https://atproto.at/uri/at://{A}/{PLACE}/winter-forest'), 5), pop.url if pop else 'no window')
        check('...with no opener', pop and pop.evaluate('() => window.opener === null'))
        if pop: pop.close()
        check('...and the menu closes', page.eval_on_selector('.openin-menu', 'm => m.hidden'))
        check('...the choice is remembered for records (shared with the link message)', page.evaluate("() => localStorage.getItem('raku-record-app')") == 'taproot')
        page.click('.openin-btn'); page.keyboard.press('Escape')
        check('Escape closes the menu', page.eval_on_selector('.openin-menu', 'm => m.hidden'))

        # 3. Step into (RT5): the place's tile in a new tab; the place stays
        before = tab_count()
        place_tab = page.eval_on_selector('.pane.front', 'p => p.dataset.tab')
        f = inner(); f.locator('button.go').click()
        check('"Step into" opens the place\'s tile in a new tab, in front', wait_for(lambda: tab_count() == before + 1 and page.inner_text('.tab.on .tab-title') == 'Winter Forest' and page.input_value('.addr').endswith('/ing.dasl.masl/3myxm45elkp22'), 10), f'{tab_count()} {page.input_value(".addr")}')
        check('...and it runs', wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Winter Forest tile', 15))
        check('...the place\'s tab is still there, showing the place', page.query_selector(f'.pane[data-tab="{place_tab}"] iframe.tile-frame') is not None)
        check('"Open in" hides on a tile\'s tab', not page.is_visible('.openin-btn'))
        page.locator('.tab').nth(0).click()            # the place's tab is the first
        check('back on the place\'s tab, "Open in" shows again', wait_for(lambda: page.is_visible('.openin-btn'), 3))

        # 4. the limits (RT5): one request a second; at:// only
        time.sleep(1.1)                                  # past the second since the last request (step 3's press)
        f = inner()
        before = tab_count()
        f.evaluate("() => { const b = document.querySelector('button.go'); b.click(); b.click(); }")   # two presses at once
        time.sleep(1.2)
        check('two quick presses open one tab, not two', tab_count() == before + 1, f'{before} -> {tab_count()}')
        page.locator('.tab').nth(0).click(); time.sleep(1.1)
        f = inner()
        before = tab_count(); n_pop = len(popups)
        f.evaluate("() => window.parent.postMessage({ action: 'tiles-protocol-up-data-payload', payload: { open: 'https://outside.localhost:9999/x' } }, '*')")
        time.sleep(0.6)
        check('an https address asked for is refused: no tab, no window', tab_count() == before and len(popups) == n_pop)
        f.evaluate("() => window.parent.postMessage({ action: 'tiles-protocol-up-data-payload', payload: { write: 'at://x/y/z' } }, '*')")
        time.sleep(0.4)
        check('anything but { open } is ignored', tab_count() == before)
        f.evaluate(f"() => window.parent.postMessage({{ action: 'tiles-protocol-up-data-payload', payload: {{ open: 'at://{P_HANDLE}/{PLACE}/maze' }} }}, '*')")
        check('a place asked for opens in a new tab, shown by the renderer', wait_for(lambda: tab_count() == before + 1 and tile_text('h1') == 'Escher maze', 15), f'{tab_count()} {tile_text("h1")}')
        check('...another account\'s place: its own handle', wait_for(lambda: tile_text('.by') == 'A place by @pyxorium.com. Updated Oct 29, 2026.', 5), str(tile_text('.by')))
        f = inner(); time.sleep(1.1)
        f.evaluate(f"() => window.parent.postMessage({{ action: 'tiles-protocol-up-data-payload', payload: {{ open: 'at://{A_HANDLE}/app.bsky.feed.like/3mzlike' }} }}, '*')")
        check('a record with no renderer asked for: the link message', wait_for(lambda: page.is_visible('.link-msg'), 5) and "Raku doesn't show app.bsky.feed.like records yet." in page.inner_text('.link-msg'))
        check('...its menu remembers Taproot (the shared choice)', page.eval_on_selector('.link-msg-app', 's => s.value') == 'taproot')
        page.keyboard.press('Escape')

        # 5. a reload (and a copied link) brings the place's tab back (RT2)
        page.reload(); page.wait_for_selector('.addr')
        page.locator('.tab').nth(0).click()
        check('after a reload the place\'s tab comes back, shown by the renderer', wait_for(lambda: tile_text('h1') == 'Winter Forest', 15), str(tile_text('h1')))

        # 6. what still opens the link message, and what's refused
        page.fill('.addr', f'at://{A_HANDLE}/{PLACE}'); page.press('.addr', 'Enter')
        check('a whole collection of places: still the link message', wait_for(lambda: page.is_visible('.link-msg'), 5) and 'This opens the list of them.' in page.inner_text('.link-msg'))
        page.keyboard.press('Escape')
        page.fill('.addr', f'at://{A_HANDLE}/app.bsky.feed.like/3mzlike'); page.press('.addr', 'Enter')
        check('a record of a kind with no renderer: still the link message', wait_for(lambda: page.is_visible('.link-msg'), 5))
        page.keyboard.press('Escape')
        page.click('.newtab')
        page.fill('.addr', f'at://{B_HANDLE}/{PLACE}/hidden'); page.press('.addr', 'Enter')
        check('a place from a hidden account isn\'t shown', wait_for(lambda: "This account's records aren't shown in Raku." in page.inner_text('.pane.front .tile-status'), 10))
        check('...and the renderer isn\'t started', page.query_selector('.pane.front iframe.tile-frame') is None)
        check('...its tab keeps the plain dot (no renderer, no icon)', page.query_selector('.tab.on img.tab-icon') is None and page.query_selector('.tab.on .tab-dot') is not None)
        page.fill('.addr', f'at://{A_HANDLE}/{PLACE}/nowhere'); page.press('.addr', 'Enter')
        check('a place that doesn\'t exist: says so', wait_for(lambda: "There's no record at that address" in page.inner_text('.pane.front .tile-status'), 10))

        # 6b. the signpost renderer: the record handed over, then the names it asks Raku for (SR2, SR6)
        page.click('.newtab')
        page.fill('.addr', f'at://{A_HANDLE}/{SIGNPOST}/winter-forest.slide'); page.press('.addr', 'Enter')
        check('a signpost address opens in a tab, shown by the Signposts renderer', wait_for(lambda: tile_text('.out') == 'A way out of [place: winter-forest] [leave/exit: slide]', 20), str(tile_text('.out')))
        check('...the names Raku read for it: the heading from Winter Forest\'s place', wait_for(lambda: tile_text('h1') == 'Slide, in Winter Forest', 10), str(tile_text('h1')))
        check('...the button from the maze\'s place', wait_for(lambda: tile_text('button.go') == 'Go to Escher maze', 5), str(tile_text('button.go')))
        check('...the destination\'s account with its checked handle', wait_for(lambda: tile_text('.dest .sub') == f'by @{P_HANDLE} [{P}]', 5), str(tile_text('.dest .sub')))
        sign_icon = wait_for(tab_icon, 5)
        check('RT12: the signpost\'s tab shows its renderer\'s icon (the trail signpost), not the door', sign_icon and sign_icon[:2] == [256, 256] and sign_icon != place_icon, str(sign_icon))
        maze_reads = [c for c in calls if 'getRecord' in c and 'rkey=maze' in c and f'repo={P.replace(":", "%3A")}' in c]
        check('...the maze\'s place read from its author\'s own server', maze_reads, str(maze_reads[:1]))
        f = inner()
        f.evaluate('''() => { window.__got = []; addEventListener('message', (e) => { const p = e.data && e.data.payload; if (p && typeof p.got === 'string') window.__got.push(p); }); }''')
        up = lambda payload: f.evaluate('(p) => parent.postMessage({ action: "tiles-protocol-up-data-payload", payload: p }, "*")', payload)
        got = lambda: f.evaluate('() => window.__got')
        other = f'at://{P}/{PLACE}/somewhere-else'
        up({'get': other})
        check('a record the signpost doesn\'t name, in another account: refused', wait_for(lambda: any(g.get('got') == other and g.get('error') == 'not-allowed' for g in got()), 5), str(got()))
        up({'get': f'at://{P}/{PLACE}'})
        check('...a whole collection: refused', wait_for(lambda: any(g.get('error') == 'not-allowed' and g.get('got') == f'at://{P}/{PLACE}' for g in got()), 5))
        check('...and nothing was read for them', not any('somewhere-else' in c for c in calls))
        for _ in range(25): up({'get': MAZE_PLACE})
        check('at most 20 reads per load: the rest refused as too many', wait_for(lambda: sum(1 for g in got() if g.get('error') == 'too-many') >= 5, 10), str([g.get('error') or 'record' for g in got()][-8:]))
        check('...the allowed ones answered with the record', sum(1 for g in got() if g.get('record')) == 18, str(sum(1 for g in got() if g.get('record'))))
        n = tab_count()
        f.locator('button.go').click()
        check('"Go to Escher maze" opens the maze\'s place in a new tab (its postcard)', wait_for(lambda: tab_count() == n + 1 and tile_text('h1') == 'Escher maze', 15), str(tile_text('h1')))
        page.screenshot(path=str(OUT / 'renderer-signpost-go.png'))

        # 7. a renderer that changed since it was pinned is refused
        state['renderer_cid'] = 'bafyreisomethingelseentirelyaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        page.goto(RAKU + '?loader=' + LOADER + '#t=' + 'at%3A%2F%2Fthunderbird.cafe%2Fcafe.thunderbird.way.place%2Fwinter-forest' + '&a=0')
        check('a renderer whose record changed since it was pinned isn\'t run', wait_for(lambda: 'has changed since Raku was set up to use it' in page.inner_text('.pane.front .tile-status'), 15))
        check('..."Open in" still shows the record', page.is_visible('.openin-btn'))
        state['renderer_cid'] = RENDERER_CID

        # 8. a phone
        phone = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']:
            phone.route(host, route)
        pp = phone.new_page()
        POKE['page'] = pp
        pp.goto(RAKU + '?loader=' + LOADER + '#t=' + 'at%3A%2F%2Fthunderbird.cafe%2Fcafe.thunderbird.way.place%2Fwinter-forest' + '&a=0')
        def phone_text(sel):
            for fr in pp.frames:
                if re.match(r'http://[a-z]{20}\.tiles\.lex\.localhost/$', fr.url) and fr.parent_frame and fr.parent_frame.parent_frame == pp.main_frame:
                    return fr.locator(sel).first.inner_text()
            return None
        check('phone: the place shows', wait_for(lambda: phone_text('h1') == 'Winter Forest', 15))
        check('phone: "Open in" fits in the top bar', pp.is_visible('.openin-btn') and pp.evaluate("() => { const r = document.querySelector('.openin-btn').getBoundingClientRect(); return r.right <= innerWidth && r.top < 60; }"))
        pp.tap('.openin-btn')
        # RT3a: a dropdown right under the button, its right side lined up with the button's, all of it on screen
        check('phone: its menu drops down right under the button, all of it on screen', pp.evaluate("() => { const m = document.querySelector('.openin-menu').getBoundingClientRect(), b = document.querySelector('.openin-btn').getBoundingClientRect(); return m.top >= b.bottom && m.top - b.bottom < 12 && Math.abs(m.right - b.right) < 2 && m.left >= 0 && m.right <= innerWidth && m.bottom < innerHeight / 2; }"))
        pp.screenshot(path=str(OUT / 'renderer-phone.png'))
        pp.set_viewport_size({'width': 320, 'height': 640})
        check('phone: on a small screen (320 px) too', pp.evaluate("() => { const m = document.querySelector('.openin-menu').getBoundingClientRect(), b = document.querySelector('.openin-btn').getBoundingClientRect(); return !document.querySelector('.openin-menu').hidden && m.top >= b.bottom && m.left >= 0 && m.right <= innerWidth; }"))
        pp.tap('.openin-item:has-text("PDSls")')
        check('phone: picking an explorer closes the menu', pp.evaluate("() => document.querySelector('.openin-menu').hidden"))
        phone.close()

        POKE['page'] = page
        # The stand-in servers know only this check's accounts and records: the first screen's picks, tables and Rooms card
        # (and the missing-place check) get 400s and 404s from them, which browsers log. Anything else counts.
        STANDINS = ('https://pds.fakepds.net/', 'https://plc.directory/')
        # Also the loading server's own policy typo ('form-src', on the home page's small later items): every tile logs it.
        errors = [c for c in console if not (c[1].startswith('Failed to load resource') and str(c[2] if len(c) > 2 else '').startswith(STANDINS))
                  and "directive 'form-src'" not in c[1]]
        check('no errors on Raku\'s page (besides the stand-in servers\' "no such record")', not errors, str(errors[:3]))
        b.close()
finally:
    servers.terminate(); replica.terminate()

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed} passed, {len(results) - passed} failed')
sys.exit(0 if passed == len(results) else 1)
