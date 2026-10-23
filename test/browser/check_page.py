# Raku stage 1 browser checks (run in the chat sandbox; see README "Browser checks"): Raku's page with its
# security policy, the loading server's own files through a local replica (loader-replica.mjs), a stand-in
# PDS, PLC directory and Bluesky API through Playwright routes, and an "outside" server that logs anything
# a tile manages to send out.
# Usage: python3 test/browser/check_page.py <work folder> [the site's src folder, for the two games' memory tiles]
#        (servers.mjs and the replica already running)
import hashlib, io, json, sys, time, re
from urllib.parse import quote
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'; B_HANDLE = 'bad.fakepds.net'
C = 'did:plc:joer5rzmwgec3dkr4srfmq45'; C_HANDLE = 'thunderbirdwine.bsky.social'
LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
SALT = 'lexicographer.space hide list v1'
MB = 1024 * 1024

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]
    blobs[c] = data
    return c
def png(color, size=(1280, 720)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def res(data, ctype, declared=None):
    return {'src': {'$type': 'blob', 'ref': {'$link': cid_for(data)}, 'mimeType': ctype, 'size': declared if declared is not None else len(data)}, 'content-type': ctype}

PROBE_HTML = b'''<!doctype html><meta charset=utf-8><title>Probe</title>
<body style="font:16px sans-serif;background:#fffdf7;color:#222;padding:16px">
<h1 id=h>Probe tile</h1><p>Count: <span id=n>0</span></p>
<button id=open>open popup</button> <button id=nav>navigate</button> <a id=link href="http://outside.localhost:9999/link" target=_blank>link</a>
<script src="/probe.js"></script>'''
PROBE_JS = b'''const O = 'http://outside.localhost:9999';
fetch(O + '/fetch').catch(() => {});
try { new WebSocket('ws://outside.localhost:9999/ws'); } catch {}
const i = new Image(); i.src = O + '/img';
const f = document.createElement('iframe'); f.src = O + '/iframe'; document.body.append(f);
try { navigator.sendBeacon(O + '/beacon', 'x'); } catch {}
const l = document.createElement('link'); l.rel = 'prefetch'; l.href = O + '/prefetch'; document.head.append(l);
document.getElementById('open').onclick = () => window.open(O + '/popup');
document.getElementById('nav').onclick = () => { location.href = O + '/nav'; };
let n = 0; setInterval(() => { document.getElementById('n').textContent = String(++n); }, 100);
document.getElementById('h').dataset.ran = 'yes';'''
PLAIN = lambda title: f'<!doctype html><meta charset=utf-8><body style="font:20px sans-serif;background:#fffdf7;padding:24px"><h1 id=h>{title}</h1>'.encode()

def tile(name, resources, desc='', banner=None, icon=None):
    t = {'name': name, 'description': desc, 'resources': resources}
    if banner:
        resources['/banner.png'] = res(banner, 'image/png'); t['screenshots'] = [{'src': '/banner.png', 'sizes': '1280x720'}]
    if icon:
        resources['/icon.png'] = res(icon, 'image/png'); t['icons'] = [{'src': '/icon.png', 'sizes': '256x256'}]
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': t, 'createdAt': '2026-10-19T00:00:00Z'}

# The first screen's six picks (Oct 21): stand-ins under the picks' own accounts and record keys
# (src/config.js PICKS), in order, each with a banner.
PICK_ACCOUNTS = [
    ('did:plc:vryspragp5yyohzghxpgqm7i', 'gabriellanonino.com', '3mx27cvoqvz2g', "@gabriellanonino.com's sprite"),
    ('did:plc:qpdjl22sgfejceds2ibabye6', 'jackvalinsky.com', '3mx2yq4ti6g2s', "@jackvalinsky.com's glass lantern"),
    ('did:plc:jatbf7xbmjzy4uol34yyeh6t', 'justinerickson.me', '3mxrdcu5qrk2d', 'Moab Red Hot'),
    ('did:plc:33k6yq7knpf5ecf532kdi5xy', 'center.for.cybernetic.beauty', '3mxrcgrmw452v', 'Four On The Floor'),
    ('did:plc:mhu5ya2asqislku2audcqmtm', 'lowpoly.gg', '3mxjvqfkjo22o', '3D CSS Saturn'),
    ('did:plc:rqbqpaaluty5v47jwciowpik', 'pyxorium.com', '3mx6h2wjtgq2h', 'Roller Coaster'),
]
PICK_NAMES = [n for _, _, _, n in PICK_ACCOUNTS]
# Q128/Q129: appmosphe.re keeps copies of the first three picks' banners (its /img/ answers carry no CORS header,
# like the real site); the last three it never copied, so those fall back to the authors' own servers.
COPIED = {d for d, _, _, _ in PICK_ACCOUNTS[:3]}
records = {
    (A, '3mw763im3qw2t'): tile('Pick one', {'/': res(PLAIN('Pick one'), 'text/html')}, 'The first pick', banner=png((242, 178, 51)), icon=png((242, 178, 51), (256, 256))),
    (C, '3mwwhkjfvfq2o'): tile('Pick two', {'/': res(PLAIN('Pick two'), 'text/html')}, 'The second pick', banner=png((94, 156, 134))),
    (C, '3mwztqi2rl2i4'): tile('Pick three', {'/': res(PLAIN('Pick three'), 'text/html')}, 'The third pick', banner=png((30, 35, 64))),
    (A, '3myfnywxt6v2r'): tile('Daisy', {'/': res(PLAIN('Daisy player'), 'text/html')}, 'A dice race for two players'),
    (A, 'probe1'): tile('Probe tile', {'/': res(PROBE_HTML, 'text/html'), '/probe.js': res(PROBE_JS, 'text/javascript')}, icon=png((63, 184, 168), (256, 256))),
    (A, 'other1'): tile('Second tile', {'/': res(PLAIN('Second tile'), 'text/html')}),
    (A, 'large1'): tile('Long mixtape', {'/': res(PLAIN('Long mixtape'), 'text/html'), '/song.flac': {'src': {'$type': 'blob', 'ref': {'$link': 'bafkreinotdownloadedaaaaaaaaaaaaaaaaaaaa'}, 'size': 60 * MB}}}),
    (A, 'huge1'): tile('Huge tile', {'/': res(PLAIN('Huge'), 'text/html'), '/big.bin': {'src': {'$type': 'blob', 'ref': {'$link': 'bafkreinotdownloadedbbbbbbbbbbbbbbbbbbbb'}, 'size': 600 * MB}}}),
    (A, 'hidden1'): tile('Hidden tile', {'/': res(PLAIN('Should never show'), 'text/html')}),
    (B, 'shown1'): tile('Labelled account tile', {'/': res(PLAIN('Should never show'), 'text/html')}),
}
for i, (did, _, rkey, name) in enumerate(PICK_ACCOUNTS):
    records[(did, rkey)] = tile(name, {'/': res(PLAIN(name), 'text/html')}, f'Pick {i + 1}', banner=png((40 * i, 120, 200 - 30 * i)))
for k in range(12):
    records[(A, f'many{k}')] = tile(f'Tile {k}', {'/': res(PLAIN(f'Tile {k}'), 'text/html')})
# stage 2: an older, flat record (not runnable here), and a tile that will be deleted after it's kept
records[(A, 'flat1')] = {'$type': 'ing.dasl.masl', 'name': 'An old flat tile', 'src': {'$link': 'bafkreiflataaaaaaaaaaaaaaaaaaaaaaaaaa'}}
records[(A, 'gone1')] = tile('Soon gone', {'/': res(PLAIN('Soon gone'), 'text/html')}, 'Deleted after it was kept', banner=png((168, 67, 46)))
AVATAR = png((63, 184, 168), (64, 64))
TALKER_HTML = b'<!doctype html><meta charset=utf-8><body style="font:18px sans-serif;background:#fffdf7;padding:20px"><h1>Talker</h1><script type="module" src="/talk.js"></script>'
TALKER_JS = b"window.parent.postMessage({ action: 'tiles-protocol-up-data-ready' }, '*'); setTimeout(() => window.parent.postMessage({ action: 'tiles-protocol-up-data-payload', payload: { kind: 'hello-host' } }, '*'), 300);"
records[(A, 'talker1')] = tile('Talker', {'/': res(TALKER_HTML, 'text/html'), '/talk.js': res(TALKER_JS, 'text/javascript')})

def h(s): return hashlib.sha256(s.encode()).hexdigest()
# Stage 3: the two tables' real tiles (the site's memory copies, src/*/tiles.generated.js, written out as
# records and blobs with their content addresses), served under the pinned addresses with the pinned CIDs.
import base64, subprocess
def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
SITE_SRC = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('/mnt/user-data/uploads/pyxorium.github.io/src')
def memory_tiles(game):
    out = subprocess.run(['node', '-e', f"import('{SITE_SRC}/{game}/tiles.generated.js').then(m => process.stdout.write(JSON.stringify(m.TILES)))"], capture_output=True, text=True, check=True).stdout
    return json.loads(out)
RAKU_SRC = Path(__file__).resolve().parents[2] / 'src'
PINS = json.loads(subprocess.run(['node', '-e', f"import('{RAKU_SRC}/config.js').then(m => process.stdout.write(JSON.stringify(m.TABLES)))"], capture_output=True, text=True, check=True).stdout)
PIN_CIDS = {}
for game in ['sevenup', 'daisy']:
    tiles = memory_tiles(game)
    for role in ['house', 'player']:
        t = tiles[role]
        resources = {}
        for path, r in t['resources'].items():
            data = r['src'].encode()
            c = raw_cid(data); blobs[c] = data
            resources[path] = {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': r['content-type'], 'size': len(data)}, 'content-type': r['content-type']}
        uri = PINS[game][role]['uri']
        did, _, rkey = uri.replace('at://', '').split('/')
        records[(did, rkey)] = {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': t['name'], 'description': t.get('description', ''), 'sizing': t.get('sizing'), 'resources': resources}}
        PIN_CIDS[(did, rkey)] = PINS[game][role]['cid']
BOT_DID = 'did:plc:hd2efebmfhpqcusfya4lguce'

HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [], 'tiles': [h(f'{SALT}\n{A}\nhidden1')]})

calls = []
typed = []
def route(r):
    url = r.request.url
    calls.append(url)
    from urllib.parse import urlparse, parse_qs
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'appmosphe.re' and u.path.startswith('/img/'):
        parts = u.path.split('/')          # /img/<did>/<cid>
        b = blobs.get(parts[3]) if len(parts) == 4 and parts[2] in COPIED else None
        return r.fulfill(status=200 if b else 404, headers={'content-type': 'image/png' if b else 'text/plain'}, body=b or b'not found')
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        handle = {A: A_HANDLE, B: B_HANDLE, C: C_HANDLE, BOT_DID: 'dicesprite.thunderbird.cafe', **{d: hd for d, hd, _, _ in PICK_ACCOUNTS}}.get(did)
        if not handle: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{handle}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {A_HANDLE: A, B_HANDLE: B, C_HANDLE: C, **{hd: d for d, hd, _, _ in PICK_ACCOUNTS}}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile'):
            labels = [{'src': LABELER, 'uri': f'at://{B}', 'val': '!hide', 'cts': '2026-10-01T00:00:00Z'}] if q.get('actor') == B else []
            prof = {'did': q.get('actor'), 'labels': labels}
            if q.get('actor') == A: prof.update({'displayName': 'Thunderbird Cafe', 'avatar': 'https://cdn.bsky.app/img/avatar/plain/a/av@jpeg'})
            return js(prof)
    if u.hostname == 'typeahead.waow.tech':
        typed.append(q.get('q'))
        actors = [{'handle': A_HANDLE, 'displayName': 'Thunderbird Cafe', 'avatar': 'https://cdn.bsky.app/img/avatar/plain/a/av@jpeg'},
                  {'handle': C_HANDLE, 'displayName': 'Wine'}] if 'thund' in (q.get('q') or '') else []
        return js({'actors': actors})
    if u.hostname == 'cdn.bsky.app':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'image/png'}, body=AVATAR)
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=HIDE_LIST)
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('getRecord'):
            rec = records.get((q.get('repo'), q.get('rkey')))
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{q['repo']}/ing.dasl.masl/{q['rkey']}", 'cid': PIN_CIDS.get((q.get('repo'), q.get('rkey')), 'bafyreirecord'), 'value': rec})
        if u.path.endswith('listRecords'):
            repo = q.get('repo'); limit = int(q.get('limit', 50)); start = int(q.get('cursor', 0))
            keys = sorted([k for (d, k) in records if d == repo], reverse=True)
            chunk = keys[start:start + limit]
            out = {'records': [{'uri': f'at://{repo}/ing.dasl.masl/{k}', 'cid': 'bafyreirecord', 'value': records[(repo, k)]} for k in chunk]}
            if start + limit < len(keys): out['cursor'] = str(start + limit)
            return js(out)
        if u.path.endswith('getBlob'):
            b = blobs.get(q.get('cid'))
            if b is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=b)
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)

def outside():
    return (W / 'outside.log').read_text()

def wait_for(fn, timeout=10.0, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None

with sync_playwright() as p:
    b = p.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://192.168.1.5/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**']:
        ctx.route(host, route)
    popups = []
    ctx.on('page', lambda pg: popups.append(pg))
    page = ctx.new_page()
    console = []
    page.on('console', lambda m: console.append((m.type, m.text, (m.location or {}).get('url', ''))))
    page.on('pageerror', lambda e: console.append(('pageerror', str(e), RAKU)))
    page.goto(RAKU + '?loader=' + LOADER)

    # 1. first screen
    wait_for(lambda: page.eval_on_selector_all('.picks .card-title', "els => els.length === 6 && els.every(e => e.textContent !== '…')"), 10)
    names = page.eval_on_selector_all('.picks .card-title', 'els => els.map(e => e.textContent)')
    check('first screen: the six picks show their names from their records, in order', names == PICK_NAMES, str(names))
    wait_for(lambda: page.eval_on_selector_all('.picks .card-pic img', 'els => els.length === 6 && els.every(i => i.complete)'), 10)
    check('the hide list is read from lexicographer.space', any(c == 'https://lexicographer.space/hidden-tiles.json' for c in calls))
    check('first screen: card pictures drawn from the tiles\' banners', page.eval_on_selector_all('.picks .card-pic img', 'els => els.every(i => i.naturalWidth === 1280)'))
    srcs = page.eval_on_selector_all('.picks .card-pic img', 'els => els.map(i => [i.src.split(":")[0], i.referrerPolicy])')
    check("first screen (Q128): banners from appmosphe.re's copies where it has them, no referrer; else from the author's server",
          [x[0] for x in srcs] == ['https', 'https', 'https', 'blob', 'blob', 'blob'] and all(x[1] == 'no-referrer' for x in srcs[:3]), str(srcs))
    copied_blobs = [c for c in calls if 'getBlob' in c and any(quote(d, safe='') in c for d in COPIED)]
    check("...the copied ones aren't downloaded from the authors' servers", not copied_blobs, str(copied_blobs[:2]))
    check('first screen: "by @handle" only after the handle checks both ways', wait_for(lambda: page.eval_on_selector_all('.picks .card-by', "els => els.length === 6 && els[0].textContent === 'by @gabriellanonino.com' && els[5].textContent === 'by @pyxorium.com'"), 10))
    check('computer: no bottom toolbar; arrows in the top bar', not page.is_visible('.toolbar') and page.is_visible('.bar .nav'))
    check('computer: back, forward, reload, the shelf, Discover and + are drawn icons, not text', page.eval_on_selector_all('.bar .nav-btn, .newtab', "bs => bs.length === 6 && bs.every(b => b.querySelector('svg.icon') && b.textContent.trim() === '')"))
    check('page title "Raku", no lab label (public since the go-public commit)', page.title() == 'Raku' and '(lab)' not in page.inner_text('.strip-row') and '(lab)' not in page.inner_text('.first h1'))
    icons = page.eval_on_selector_all('link[rel~=icon], link[rel=apple-touch-icon]', 'ls => ls.map(l => l.getAttribute("href"))')
    check('icons for other sites: favicon.ico, a PNG, the SVG and the Apple icon are linked', icons == ['/favicon.ico', '/favicon-32.png', '/icon.svg', '/apple-touch-icon.png'], str(icons))
    served = [(lambda r: r.ok and len(r.body()) > 0)(page.request.get(RAKU.rstrip('/') + u)) for u in ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png']]
    check('...and served', all(served), str(served))
    check('the built page carries its security policy', page.eval_on_selector('meta[http-equiv="Content-Security-Policy"]', 'm => m.content.includes("frame-src")'))
    check('public: no noindex', page.query_selector('meta[name=robots]') is None)
    page.screenshot(path=str(OUT / 'first-screen.png'))

    # 2. open a tile from the address box
    page.fill('.addr', f'at://{A}/ing.dasl.masl/probe1')
    page.press('.addr', 'Enter')
    page.wait_for_selector('.pane.front iframe.tile-frame', timeout=10000)
    fl = page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe')
    ok = wait_for(lambda: fl.locator('#h[data-ran=yes]').count() == 1, 15)
    check('a tile opens from its at:// address and runs (its script ran)', ok)
    src = page.eval_on_selector('.pane.front iframe.tile-frame', 'f => f.src')
    shuttle = [f for f in page.frames if '.tiles.lex.localhost' in f.url]
    check('the tile runs on its own random name under the loading server', any(re.match(r'http://[a-z]{20}\.tiles\.lex\.localhost/', f.url) for f in shuttle), str([f.url for f in page.frames]))
    check('the status box is gone once the tile\'s page is handed over', wait_for(lambda: page.eval_on_selector('.pane.front .tile-status', 'b => b.hidden'), 5))
    check('the tab is titled with the tile\'s name', wait_for(lambda: page.inner_text('.tab.on .tab-title') == 'Probe tile', 5))
    check('the tab shows the tile\'s icon', wait_for(lambda: page.eval_on_selector('.tab.on', 't => !!t.querySelector("img.tab-icon")'), 5))
    check('the address box shows the checked handle form', wait_for(lambda: page.input_value('.addr') == f'at://{A_HANDLE}/ing.dasl.masl/probe1', 5), page.input_value('.addr'))
    check('the open tabs are kept in the page address', 'probe1' in page.url and '#t=' in page.url)
    check('the document title names the tile', page.title().startswith('Probe tile'))
    page.screenshot(path=str(OUT / 'tile-open.png'))

    # 3. the sandbox re-check: what a tile can reach
    time.sleep(2.5)
    log = outside()
    for what in ['/fetch', '/img', '/iframe', '/beacon', '/prefetch', 'UPGRADE /ws']:
        check(f'sandbox: the tile could not reach outside by {what.split("/")[-1] or what}', what not in log, log)
    shuttle_frame = fl.locator('#open')
    try:
        shuttle_frame.click(timeout=5000)
        time.sleep(1.5)
    except Exception as e:
        print('popup click failed', e)
    popup_reached = '/popup' in outside()
    results.append(('FINDING popup', popup_reached, 'window.open from a click inside a tile reached the outside server' if popup_reached else 'blocked'))
    print('FINDING: window.open after a click inside the tile ' + ('REACHED the outside server' if popup_reached else 'was blocked'))
    for pg in popups:
        if pg is page: continue
        try: pg.close()
        except Exception: pass
    try:
        fl.locator('#nav').click(timeout=5000)
        time.sleep(1.5)
    except Exception as e:
        print('nav click failed', e)
    nav_reached = '/nav' in outside()
    results.append(('FINDING nav', nav_reached, ''))
    print('FINDING: the tile navigating its own frame away ' + ('REACHED the outside server' if nav_reached else 'was blocked'))
    check('a tile navigating itself never moves Raku\'s own page', page.url.startswith(RAKU))
    page.click('.nav-btn[title="Reload this tile"]')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h[data-ran=yes]').count() == 1, 15)
    check('Reload starts the tile afresh', ok)

    # 4. background tabs keep running
    def count():
        return int(page.frame_locator('.pane[data-tab] iframe.tile-frame').first.frame_locator('iframe').locator('#n').inner_text())
    probe_tab = page.eval_on_selector('.pane.front', 'p => p.dataset.tab')
    page.click('.newtab')
    check('+ opens a new tab on the first screen, address box focused', wait_for(lambda: page.evaluate('() => document.activeElement.classList.contains("addr")'), 3) and page.eval_on_selector('.pane.front', 'p => !!p.querySelector(".first")'))
    def probe_count():
        return int(page.frame_locator(f'.pane[data-tab="{probe_tab}"] iframe.tile-frame').frame_locator('iframe').locator('#n').inner_text())
    c1 = probe_count(); time.sleep(2); c2 = probe_count()
    check('a tab in the background keeps running', c2 - c1 >= 10, f'{c1} -> {c2}')

    # 5. other address forms in the new tab
    page.fill('.addr', f'https://lexicographer.space/@{A_HANDLE}/other1'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check('a lexicographer.space link opens its tile', ok)
    page.fill('.addr', f'tile://many0.{A.replace(":", "%3A")}/'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Tile 0', 15)
    check("Beaver's tile:// form opens its tile", ok)
    page.click('.nav-btn[title="Back"]')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check('Back returns to the previous tile in this tab', ok)
    page.click('.nav-btn[title="Forward"]')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Tile 0', 15)
    check('Forward goes ahead again', ok)

    def status_text():
        return page.eval_on_selector('.pane.front .tile-status', 'b => b.hidden ? "" : b.innerText')

    # 6. sizes
    page.fill('.addr', f'@{A_HANDLE}/large1'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: 'This tile is large (60 MB). Open anyway?' in status_text(), 8)
    check('a large tile asks first: "This tile is large (60 MB). Open anyway?"', ok, status_text())
    check('the status box shows only its words and buttons', 'null' not in status_text())
    check('nothing runs before the answer', page.eval_on_selector('.pane.front', 'p => !p.querySelector("iframe")'))
    page.screenshot(path=str(OUT / 'ask-large.png'))
    page.click('.pane.front .tile-status button:has-text("Not now")')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Tile 0', 15)
    check('"Not now" goes back', ok)
    page.click('.nav-btn[title="Forward"]')
    wait_for(lambda: 'Open anyway' in status_text(), 8)
    page.click('.pane.front .tile-status button:has-text("Open anyway")')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Long mixtape', 15)
    check('"Open anyway" opens it', ok)
    page.fill('.addr', f'@{A_HANDLE}/huge1'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: 'too large to open here (600 MB)' in status_text(), 8)
    check('a tile over the limit is refused (600 MB)', ok, status_text())

    # 7. moderation
    page.fill('.addr', f'@{A_HANDLE}/hidden1'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: "isn't shown in Raku" in status_text(), 8)
    check('a tile on the coded hide list is not shown', ok, status_text())
    check('…with a link to Reporting and takedowns, and nothing loaded', page.eval_on_selector('.pane.front .tile-status a', 'a => a.href') == 'https://lexicographer.space/takedowns' and page.eval_on_selector('.pane.front', 'p => !p.querySelector("iframe")'))
    page.screenshot(path=str(OUT / 'hidden.png'))
    page.fill('.addr', f'at://{B_HANDLE}/ing.dasl.masl/shown1'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: "isn't shown in Raku" in status_text(), 8)
    check("an account Bluesky's moderation labelled !hide is not shown", ok, status_text())
    check('hidden tiles\' records were never fetched', not any('rkey=hidden1' in c or 'rkey=shown1' in c for c in calls))

    # 8. errors
    page.fill('.addr', f'@{A_HANDLE}/nosuchtile'); page.press('.addr', 'Enter')
    check('a missing tile says so', wait_for(lambda: "no tile at that address" in status_text(), 8), status_text())
    page.fill('.addr', 'at://did:web:192.168.1.5/ing.dasl.masl/x1'); page.press('.addr', 'Enter')
    check('a did:web on a private address is refused before any request', wait_for(lambda: 'private address' in status_text(), 8) and not any(c.startswith('https://192.168.1.5') for c in calls) and page.eval_on_selector('.pane.front .tile-status', 'b => !b.querySelector("button")'), status_text())
    page.fill('.addr', 'https://example.com/hello'); page.press('.addr', 'Enter')
    check('an ordinary web link is refused with a reason', wait_for(lambda: 'not other web pages' in page.inner_text('.note'), 3))

    # 9. reload the page: tabs come back
    tabs_before = page.eval_on_selector_all('.tab', 'ts => ts.length')
    page.reload()
    page.wait_for_selector('.tab', timeout=10000)
    tabs_after = page.eval_on_selector_all('.tab', 'ts => ts.length')
    check('reloading Raku reopens the same tabs', tabs_before == tabs_after == 2, f'{tabs_before} -> {tabs_after}')
    ok = wait_for(lambda: page.frame_locator('.pane[data-tab] iframe.tile-frame').first.frame_locator('iframe').locator('#h[data-ran=yes]').count() == 1, 15)
    check('…and the probe tile in the first tab runs again', ok)

    # 10. the tab cap
    for k in range(12):
        if page.is_disabled('.newtab'): break
        page.click('.newtab')
        page.fill('.addr', f'@{A_HANDLE}/many{k}'); page.press('.addr', 'Enter')
    n = page.eval_on_selector_all('.tab', 'ts => ts.length')
    check('at most 10 tabs; + is greyed at the cap', n == 10 and page.is_disabled('.newtab'), str(n))
    page.screenshot(path=str(OUT / 'ten-tabs.png'))
    page.click('.tab.on .tab-x')
    check('closing a tab frees a place', page.eval_on_selector_all('.tab', 'ts => ts.length') == 9 and not page.is_disabled('.newtab'))

    errs = [c for c in console if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU)]
    check('no errors on Raku\'s page', not errs, str(errs[:5]))
    csp = [c for c in console if ('Content Security Policy' in c[1] or 'Refused' in c[1]) and c[2].startswith(RAKU)]
    tile_refusals = [c for c in console if 'Refused' in c[1] and not c[2].startswith(RAKU)]
    print(f'(the tiles\' own frames logged {len(tile_refusals)} refusals by the loader\'s no-network policy)')
    check("Raku's own policy refused nothing", not csp, str(csp[:3]))

    # 11. phone width
    m = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        m.route(host, route)
    mp = m.new_page()
    mp.goto(RAKU + '?loader=' + LOADER + '#t=' + f'at%3A%2F%2F{A}%2Fing.dasl.masl%2Fprobe1,&a=0')
    mp.wait_for_selector('.count')
    check('phone: no tab strip, a tab count button', not mp.is_visible('.strip-row') and mp.is_visible('.count') and mp.inner_text('.count') == '2')
    check('phone: no arrows in the top bar; the address gets the row (beside the account button)', not mp.is_visible('.bar .nav') and mp.eval_on_selector('.addr', 'a => a.getBoundingClientRect().width') > 280)
    sizes = mp.eval_on_selector_all('.toolbar button', 'bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.title, Math.round(r.width), Math.round(r.height)]; })')
    check('phone: a bottom toolbar with back, forward, reload, the shelf, Discover and tabs, each at least 44 px', [x[0] for x in sizes] == ['Back', 'Forward', 'Reload this tile', 'Your shelf', 'Discover', 'Open tabs'] and all(w >= 44 and hh >= 44 for _, w, hh in sizes), str(sizes))
    icons = mp.eval_on_selector_all('.toolbar .tool-btn svg.icon', 'is => is.map(i => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })')
    check('phone: the toolbar icons are drawn the same size', len(icons) == 5 and len(set(map(tuple, icons))) == 1, str(icons))
    check('phone: the toolbar sits at the bottom of the screen', mp.eval_on_selector('.toolbar', 't => Math.round(t.getBoundingClientRect().bottom)') == 800)
    ok = wait_for(lambda: mp.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h[data-ran=yes]').count() == 1, 15)
    check('phone: the tile fills the screen and runs', ok)
    check('phone: no sideways scroll', mp.evaluate('() => document.documentElement.scrollWidth <= 390'))
    mp.screenshot(path=str(OUT / 'phone-tile.png'))
    mp.click('.count')
    check('phone: the count opens the list of tabs', mp.is_visible('.sheet') and mp.eval_on_selector_all('.sheet-list li', 'l => l.length') == 2)
    check('phone: each tab in the list closes with a drawn ×', mp.eval_on_selector_all('.sheet-x', "bs => bs.length === 2 && bs.every(b => b.querySelector('svg.icon-close'))"))
    mp.screenshot(path=str(OUT / 'phone-tabs.png'))
    mp.click('.sheet-list li:nth-child(2) .sheet-tab')
    check('phone: choosing a tab brings it to the front', mp.eval_on_selector('.pane.front', 'p => !!p.querySelector(".first")') and not mp.is_visible('.sheet'))
    mp.screenshot(path=str(OUT / 'phone-first.png'))
    mp.fill('.addr', f'@{A_HANDLE}/other1'); mp.press('.addr', 'Enter')
    ok = wait_for(lambda: mp.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check('phone: a tile opened from the address box', ok)
    check('phone: forward greyed, back ready', mp.is_disabled('.toolbar button[title=Forward]') and not mp.is_disabled('.toolbar button[title=Back]'))
    mp.click('.toolbar button[title=Back]')
    check("phone: the toolbar's back returns to the first screen", wait_for(lambda: mp.eval_on_selector('.pane.front', 'p => !!p.querySelector(".first")'), 5))
    mp.click('.toolbar button[title=Forward]')
    ok = wait_for(lambda: mp.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check("phone: the toolbar's forward goes ahead again", ok)
    mp.screenshot(path=str(OUT / 'phone-toolbar.png'))


    # 13. stage 2: the Shelf (a fresh browser profile)
    s2 = b.new_context(viewport={'width': 1280, 'height': 860}, accept_downloads=True)
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        s2.route(host, route)
    sp = s2.new_page()
    s2_console = []
    sp.on('console', lambda m: s2_console.append((m.type, m.text, (m.location or {}).get('url', ''))))
    sp.on('pageerror', lambda e: s2_console.append(('pageerror', str(e), RAKU)))
    s2.route('https://typeahead.waow.tech/**', route)
    sp.goto(RAKU + '?loader=' + LOADER)
    sp.wait_for_selector('.addr')
    check('shelf: no star on the first screen', not sp.is_visible('.star-btn'))
    check("the address box says handles work too", "handle" in sp.get_attribute('.addr', 'placeholder'))
    sp.click('.addr'); sp.keyboard.type('thund')
    ok = wait_for(lambda: sp.is_visible('.rk-ta-list') and sp.eval_on_selector_all('.rk-ta-item', 'is => is.length') == 2, 5)
    check('typing the start of a handle shows suggestions with avatars', ok and sp.eval_on_selector('.rk-ta-item', "li => li.innerText.includes('@thunderbird.cafe') && li.innerText.includes('Thunderbird Cafe') && !!li.querySelector('img')"))
    sp.screenshot(path=str(OUT / 'suggestions.png'))
    sp.keyboard.press('ArrowDown'); sp.keyboard.press('Enter')
    check("choosing a suggestion opens that account's tiles", wait_for(lambda: sp.inner_text('.pane.front h1') == "@thunderbird.cafe's tiles", 10) and not sp.is_visible('.rk-ta-list'))
    before = len(typed)
    sp.fill('.addr', f'at://{A_HANDLE}/ing.dasl.masl/other1')
    sp.keyboard.press('Escape')
    time.sleep(0.5)
    check('a pasted tile address is never sent for suggestions', len(typed) == before and not sp.is_visible('.rk-ta-list'))
    sp.fill('.addr', '@thunderbird.cafe'); sp.press('.addr', 'Enter')
    ok = wait_for(lambda: sp.inner_text('.pane.front h1') == "@thunderbird.cafe's tiles", 10)
    check("shelf: a handle opens that account's tiles", ok)
    titles = wait_for(lambda: (lambda t: t if len(t) >= 24 else None)(sp.eval_on_selector_all('.pane.front .card-title', 'els => els.map(e => e.textContent)')), 10) or []
    check("account page: every tile listed in the server's order, the hidden one left out", len(titles) == 24 and 'Hidden tile' not in titles and titles[0] == 'Talker', str(titles))
    check('account page: a tile Raku can\'t run is greyed with a reason', sp.eval_on_selector_all('.pane.front .card.greyed', "cs => cs.length === 1 && cs[0].innerText.includes('An old flat tile') && cs[0].innerText.includes('no files listed')"))
    check('account page: the avatar from Bluesky\'s picture server and the display name', wait_for(lambda: sp.eval_on_selector('.account-av', 'i => i.tagName === "IMG" && i.complete && i.naturalWidth === 64'), 5) and 'Thunderbird Cafe' in sp.inner_text('.pane.front .sub'))
    check('account page: the address box shows the handle; tab and page title name the account', sp.input_value('.addr') == '@thunderbird.cafe' and sp.inner_text('.tab.on .tab-title') == "@thunderbird.cafe's tiles")
    sp.screenshot(path=str(OUT / 'account-tiles.png'))
    check('account page: the star keeps the account', sp.is_visible('.star-btn') and sp.get_attribute('.star-btn', 'aria-pressed') == 'false')
    sp.click('.star-btn')
    check('…kept: the star fills and says so', sp.get_attribute('.star-btn', 'aria-pressed') == 'true' and 'Account kept' in sp.inner_text('.note'))
    sp.click(".pane.front .card-main:has-text('Second tile')")
    ok = wait_for(lambda: sp.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check('a card opens its tile in the same tab', ok)
    check('the star keeps the tile', wait_for(lambda: sp.is_visible('.star-btn'), 5) and sp.get_attribute('.star-btn', 'aria-pressed') == 'false')
    sp.click('.star-btn')
    check('…kept on the shelf', sp.get_attribute('.star-btn', 'aria-pressed') == 'true')
    sp.click('.nav-btn[title="Back"]')
    check('Back returns to the account page', wait_for(lambda: sp.inner_text('.pane.front h1') == "@thunderbird.cafe's tiles", 10))
    sp.fill('.addr', f'@{A_HANDLE}/gone1'); sp.press('.addr', 'Enter')
    wait_for(lambda: sp.is_visible('.star-btn'), 10)
    sp.click('.star-btn')
    sp.fill('.addr', f'at://{C_HANDLE}/ing.dasl.masl/3mwwhkjfvfq2o'); sp.press('.addr', 'Enter')
    wait_for(lambda: sp.is_visible('.star-btn') and sp.get_attribute('.star-btn', 'aria-pressed') == 'false', 10)
    sp.click('.star-btn')
    del records[(A, 'gone1')]                                   # the author deletes it
    tabs_before = sp.eval_on_selector_all('.tab', 'ts => ts.length')
    sp.click('.nav-btn[title="Your shelf"]')
    ok = wait_for(lambda: sp.inner_text('.pane.front h1') == 'Your shelf', 10)
    check('the Shelf button opens your shelf in a new tab (the running tile stays open)', ok and sp.eval_on_selector_all('.tab', 'ts => ts.length') == tabs_before + 1)
    kept = wait_for(lambda: (lambda t: t if len(t) == 3 and '…' not in t[0] else None)(sp.eval_on_selector_all('.pane.front .card-title', 'els => els.map(e => e.textContent)')), 10)
    check('your shelf: kept tiles, most recently kept first', kept == ['Pick two', 'Soon gone', 'Second tile'], str(kept))
    check('your shelf: a deleted tile says so, greyed', wait_for(lambda: sp.eval_on_selector_all('.pane.front .card.greyed', "cs => cs.length === 1 && cs[0].innerText.includes('deleted by its author')"), 10))
    check('your shelf: the kept account as a chip, with avatar and tile count', wait_for(lambda: sp.eval_on_selector_all('.chip', "cs => cs.length === 1 && cs[0].innerText.includes('@thunderbird.cafe') && /\\d+ tiles/.test(cs[0].innerText) && !!cs[0].querySelector('img')"), 10))
    check('your shelf: pictures drawn from the tiles\' banners', wait_for(lambda: sp.eval_on_selector_all('.pane.front .card-pic img', 'is => is.length === 1 && is.every(i => i.complete && i.naturalWidth === 1280)'), 10))
    check('your shelf: the Shelf button shows it is open', sp.eval_on_selector('.nav-btn[title="Your shelf"]', 'b => b.classList.contains("on")'))
    sp.screenshot(path=str(OUT / 'your-shelf.png'))
    sp.click(".pane.front .card.greyed .card-btn[title='Remove from your shelf']")
    check('Remove takes a tile off the shelf (and the count follows)', sp.eval_on_selector_all('.pane.front .card', 'cs => cs.length') == 2 and '2 tiles' in sp.inner_text('.pane.front .sub'))
    with sp.expect_download() as dl:
        sp.click(".shelf-tools button:has-text('Export')")
    path = dl.value.path()
    exported = json.loads(open(path).read())
    check('Export saves a small file: raku-shelf-<date>.json with the account and the tiles', dl.value.suggested_filename.startswith('raku-shelf-') and exported['format'] == 'raku-shelf' and len(exported['tiles']) == 2 and len(exported['accounts']) == 1, str(exported)[:200])
    sp.click(".pane.front .card:has-text('Pick two') .card-btn[title='Open in a new tab']")
    ok = wait_for(lambda: sp.inner_text('.tab.on .tab-title') == 'Pick two', 10)
    check("a card's corner opens the tile in a new tab", ok)
    sp.click('.newtab')
    check('the first screen shows "From your shelf"', wait_for(lambda: 'FROM YOUR SHELF' in sp.inner_text('.pane.front').upper() and sp.eval_on_selector_all('.pane.front .first .cards.kept .card', 'cs => cs.length') == 2, 10))
    sp.reload()
    sp.wait_for_selector('.tab')
    sp.click('.nav-btn[title="Your shelf"]')
    check('your shelf survives a reload (kept in this browser)', wait_for(lambda: sp.eval_on_selector_all('.pane.front .card', 'cs => cs.length') == 2, 10))
    errs = [c for c in s2_console if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU)]
    check('shelf: no errors on Raku\'s page', not errs, str(errs[:5]))

    # Import into a fresh browser
    s3 = b.new_context(viewport={'width': 1280, 'height': 860})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        s3.route(host, route)
    ip = s3.new_page()
    ip.goto(RAKU + '?loader=' + LOADER)
    ip.wait_for_selector('.addr')
    ip.click('.nav-btn[title="Your shelf"]')
    check('a new browser: an empty shelf says how to keep things', wait_for(lambda: 'Nothing kept yet' in ip.inner_text('.pane.front'), 5))
    ip.set_input_files('.shelf-tools input[type=file]', path)
    check('Import adds the file to the shelf', wait_for(lambda: 'Added 1 account and 2 tiles' in ip.inner_text('.note'), 5) and wait_for(lambda: ip.eval_on_selector_all('.pane.front .card', 'cs => cs.length') == 2, 10))
    ip.set_input_files('.shelf-tools input[type=file]', path)
    check('…and importing it again adds nothing', wait_for(lambda: 'Nothing new' in ip.inner_text('.note'), 5))
    bad = W / 'not-a-shelf.json'; bad.write_text('{"hello": 1}')
    ip.set_input_files('.shelf-tools input[type=file]', str(bad))
    check('a file that isn\'t a shelf is refused', wait_for(lambda: "isn't a Raku shelf" in ip.inner_text('.note'), 5))

    # The phone: the shelf as compact rows
    s4 = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        s4.route(host, route)
    pp = s4.new_page()
    pp.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Atiles%2Fthunderbird.cafe&a=0')
    ok = wait_for(lambda: pp.eval_on_selector_all('.pane.front .card', 'cs => cs.length') >= 19, 10)
    check('phone: an account\'s tiles as compact rows, no sideways scroll', ok and pp.eval_on_selector('.pane.front .card-main', 'm => getComputedStyle(m).flexDirection') == 'row' and pp.evaluate('() => document.documentElement.scrollWidth <= 390'))
    check('phone: the star sits inside the address box', pp.is_visible('.star-btn') and pp.eval_on_selector('.star-btn', 'b => { const r = b.getBoundingClientRect(); const a = document.querySelector(".addr").getBoundingClientRect(); return r.right <= a.right + 1 && r.left >= a.left; }'))
    pp.screenshot(path=str(OUT / 'phone-account.png'))


    # 14. stage 3: tables against the bot
    s5 = b.new_context(viewport={'width': 1280, 'height': 900})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        s5.route(host, route)
    tp = s5.new_page()
    t_console = []
    tp.on('console', lambda m: t_console.append((m.type, m.text, (m.location or {}).get('url', ''))))
    tp.on('pageerror', lambda e: t_console.append(('pageerror', str(e), RAKU)))
    tp.goto(RAKU + '?loader=' + LOADER)
    ok = wait_for(lambda: tp.eval_on_selector_all('.first .tables .card-title', "els => els.map(e => e.textContent).join(',')") == 'Seven-Up,Daisy', 10)
    check('first screen: a Tables row with Seven-Up and Daisy', ok)
    tp.click(".first .tables .card-main:has-text('Daisy')")
    ok = wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Daisy', 10)
    check("a table card opens the table in the tab: Daisy's start screen (raku:table/daisy, stage 5)", ok and tp.input_value('.addr') == 'raku:table/daisy' and tp.inner_text('.tab.on .tab-title') == 'Daisy' and tp.is_visible('.pane.front .daisy-bot') and tp.is_visible('.pane.front .daisy-open'))
    tp.click('.pane.front .daisy-bot')
    check('…Play the bot opens the bot table (raku:table/daisy/bot)', wait_for(lambda: tp.input_value('.addr') == 'raku:table/daisy/bot', 5))
    mine = tp.frame_locator('.pane.front .seat-mine iframe').frame_locator('iframe')
    theirs = tp.frame_locator('.pane.front .seat-theirs iframe').frame_locator('iframe')
    ok = wait_for(lambda: mine.locator('#glazes button').count() >= 6, 25)
    check('Daisy: your tile and the watching copy load from the pinned tiles; the glazes are offered', ok and wait_for(lambda: theirs.locator('#badge').is_visible(), 10))
    check('Daisy: two hidden houses run too (yours and the bot\'s)', tp.eval_on_selector_all('.pane.front .hidden-mount iframe', 'fs => fs.length') == 2)
    mine.locator('#glazes button').first.click()
    rolls = 0
    deadline = time.time() + 150
    over = False
    while time.time() < deadline:
        try:
            if mine.locator('#end').is_visible():
                over = True; break
            if mine.locator('#roll').is_visible() and mine.locator('#roll').is_enabled():
                tl = mine.locator('#turn-line').inner_text()
                m = re.search(r'(\d+)', tl or '')
                if m and int(m.group(1)) >= 12 and mine.locator('#bank').is_enabled():
                    mine.locator('#bank').click()
                else:
                    mine.locator('#roll').click(); rolls += 1
                time.sleep(1.2)
            else:
                time.sleep(0.5)
        except Exception:
            time.sleep(0.5)
    check('Daisy: a whole match against the bot plays to the end', over, f'rolls {rolls}')
    tp.screenshot(path=str(OUT / 'daisy-table.png'))
    if over:
        mine.locator('#save').click()
        check("Daisy: Save signed out opens Raku's own prompt, which signs you in first (stage 4)", wait_for(lambda: tp.is_visible('.pane.front .rk-dialog') and 'Save this Daisy match?' in tp.inner_text('.pane.front .rk-dialog') and tp.is_visible('.pane.front .rk-dialog .signin-handle'), 5))
        tp.click(".pane.front .rk-dialog button:has-text('Not now')")
        check('…"Not now" closes it and the tile can be asked again', wait_for(lambda: not tp.is_visible('.pane.front .rk-dialog') and 'Save it to your account, if you like.' in mine.locator('#save-status').inner_text() and mine.locator('#save').is_enabled(), 5))
    tp.click('.pane.front .panel-btn')
    lines = tp.eval_on_selector_all('.pane.front .panel-list li', 'ls => ls.map(l => l.textContent)')
    check('the message panel shows what passes between the tiles (house ↔ bot, seats, Raku)', any('house → bot' in l for l in lines) and any('mine → house' in l for l in lines) and any('Raku' in l or 'page' in l for l in lines) and not any(' ping' in l or ' pong' in l for l in lines), str(lines[:6]))
    tp.screenshot(path=str(OUT / 'daisy-panel.png'))
    tp.click('.pane.front .panel-close')
    check('the star on a table keeps it on your shelf', tp.is_visible('.star-btn'))
    tp.click('.star-btn')
    tp.click('.nav-btn[title="Your shelf"]')
    ok = wait_for(lambda: tp.eval_on_selector_all('.pane.front .card', 'cs => cs.length') == 1, 10)
    tp.click('.pane.front .card-main')
    check('…and the kept table opens the table again', wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Daisy', 10))

    # Seven-Up
    tp.fill('.addr', 'raku:table/sevenup'); tp.press('.addr', 'Enter')
    ok = wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Seven-Up', 10)
    s1 = tp.frame_locator('.pane.front .table-seat[data-seat="1"] iframe').frame_locator('iframe')
    s2 = tp.frame_locator('.pane.front .table-seat[data-seat="2"] iframe').frame_locator('iframe')
    ok = ok and wait_for(lambda: '@you' in s1.locator('#handle').inner_text() and 'dicesprite' in s2.locator('#handle').inner_text(), 25)
    check('Seven-Up: both seats load from the pinned tiles; you at seat 1, the bot at seat 2', ok)
    played = 0
    deadline = time.time() + 180          # a round lasts until someone rolls a 7: some run long
    sover = False
    while time.time() < deadline:
        try:
            if s1.locator('#end').is_visible():
                sover = True; break
            for sel in ['#offers button:not([disabled])', '#roll:not([disabled])', '#pass:not([disabled])']:
                loc = s1.locator(sel).first
                if loc.count() and loc.is_visible():
                    loc.click(); played += 1; time.sleep(0.6); break
            else:
                time.sleep(0.5)
        except Exception:
            time.sleep(0.5)
    check('Seven-Up: a whole match against the bot plays to the end', sover, f'clicks {played}')
    tp.screenshot(path=str(OUT / 'sevenup-table.png'))
    if sover:
        check('Seven-Up: the tile offers Save (saving is Raku\'s, stage 4)', s1.locator('#save').is_visible() and s1.locator('#save').is_enabled())
    s1.locator('#table-pic').click()
    check("Seven-Up: the house's whole-table view opens over the tab, and closes", wait_for(lambda: tp.is_visible('.pane.front .table-house'), 5) and (tp.keyboard.press('Escape') or True) and wait_for(lambda: not tp.is_visible('.pane.front .table-house'), 5))

    # a table's own tile opened on its own
    tp.fill('.addr', PINS['daisy']['player']['uri']); tp.press('.addr', 'Enter')
    ok = wait_for(lambda: tp.is_visible('.pane.front .table-hint'), 10)
    check("a table's own tile opened directly says it's part of a table", ok and 'Play Daisy' in tp.inner_text('.pane.front .table-hint'))
    tp.click(".pane.front .table-hint button:has-text('Play Daisy')")
    check('…and "Play Daisy" opens the table', wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Daisy', 10))
    tp.fill('.addr', 'raku:table/nosuch'); tp.press('.addr', 'Enter')
    check('an unknown table says so', wait_for(lambda: 'no table called' in tp.inner_text('.pane.front'), 5))
    # the message panel on an ordinary tile
    tp.fill('.addr', f'at://{A}/ing.dasl.masl/talker1'); tp.press('.addr', 'Enter')
    ok = wait_for(lambda: tp.is_visible('.pane.front .panel-pill'), 10)
    check('an ordinary tile that asks Raku something gets a Messages button', ok)
    tp.click('.pane.front .panel-pill')
    check("…and the panel shows what it asked", wait_for(lambda: 'data-ready' in tp.inner_text('.pane.front .panel') or 'data-payload' in tp.inner_text('.pane.front .panel'), 5), tp.inner_text('.pane.front .panel')[:200])
    errs = [c for c in t_console if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU)]
    check("tables: no errors on Raku's page", not errs, str(errs[:5]))
    csp = [c for c in t_console if ('Content Security Policy' in c[1] or 'Refused' in c[1]) and c[2].startswith(RAKU)]
    check("tables: Raku's own policy refused nothing", not csp, str(csp[:3]))

    # phone
    s6 = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**']:
        s6.route(host, route)
    pq = s6.new_page()
    pq.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Atable%2Fdaisy%2Fbot&a=0')
    mine6 = pq.frame_locator('.pane.front .seat-mine iframe').frame_locator('iframe')
    ok = wait_for(lambda: mine6.locator('#glazes button').count() >= 6, 25)
    order = pq.eval_on_selector_all('.pane.front .table-seat', 'ss => ss.map(s => [s.dataset.role, Math.round(s.getBoundingClientRect().top)])')
    check('phone: Daisy stacked, your seat at the bottom; no sideways scroll', ok and order[0][1] > order[1][1] and pq.evaluate('() => document.documentElement.scrollWidth <= 390'), str(order))
    pq.screenshot(path=str(OUT / 'phone-daisy.png'))

    # 12. inside another site's frame
    fp = ctx.new_page()
    fp.goto('http://outside.localhost:9999/framer')
    fr = fp.frame_locator('#f')
    ok = wait_for(lambda: fr.locator('.framed a').inner_text() == 'Open Raku in its own tab', 8)
    check("inside another site's frame Raku shows only a link to open it in its own tab", ok and fr.locator('.addr').count() == 0 and fr.locator('.tab').count() == 0)
    b.close()

fails = [r for r in results if not r[1] and not r[0].startswith('FINDING')]
print(f"\n{len([r for r in results if r[1] and not r[0].startswith('FINDING')])} passed, {len(fails)} failed")
