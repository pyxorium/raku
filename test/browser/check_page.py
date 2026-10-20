# Raku stage 1 browser checks (run in the chat sandbox; see README "Browser checks"): Raku's page with its
# security policy, the loading server's own files through a local replica (loader-replica.mjs), a stand-in
# PDS, PLC directory and Bluesky API through Playwright routes, and an "outside" server that logs anything
# a tile manages to send out.
# Usage: python3 test/browser/check_page.py <work folder>   (servers.mjs and the replica already running)
import hashlib, io, json, sys, time, re
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

records = {
    (A, '3mw763im3qw2t'): tile('Pick one', {'/': res(PLAIN('Pick one'), 'text/html')}, 'The first pick', banner=png((242, 178, 51)), icon=png((242, 178, 51), (256, 256))),
    (C, '3mwwhkjfvfq2o'): tile('Pick two', {'/': res(PLAIN('Pick two'), 'text/html')}, 'The second pick', banner=png((94, 156, 134))),
    (C, '3mwztqi2rl2i4'): tile('Pick three', {'/': res(PLAIN('Pick three'), 'text/html')}, 'The third pick', banner=png((30, 35, 64))),
    (A, '3my6uchoghd2m'): tile('Daisy', {'/': res(PLAIN('Daisy player'), 'text/html')}, 'A dice race for two players'),
    (A, 'probe1'): tile('Probe tile', {'/': res(PROBE_HTML, 'text/html'), '/probe.js': res(PROBE_JS, 'text/javascript')}, icon=png((63, 184, 168), (256, 256))),
    (A, 'other1'): tile('Second tile', {'/': res(PLAIN('Second tile'), 'text/html')}),
    (A, 'large1'): tile('Long mixtape', {'/': res(PLAIN('Long mixtape'), 'text/html'), '/song.flac': {'src': {'$type': 'blob', 'ref': {'$link': 'bafkreinotdownloadedaaaaaaaaaaaaaaaaaaaa'}, 'size': 60 * MB}}}),
    (A, 'huge1'): tile('Huge tile', {'/': res(PLAIN('Huge'), 'text/html'), '/big.bin': {'src': {'$type': 'blob', 'ref': {'$link': 'bafkreinotdownloadedbbbbbbbbbbbbbbbbbbbb'}, 'size': 600 * MB}}}),
    (A, 'hidden1'): tile('Hidden tile', {'/': res(PLAIN('Should never show'), 'text/html')}),
    (B, 'shown1'): tile('Labelled account tile', {'/': res(PLAIN('Should never show'), 'text/html')}),
}
for k in range(12):
    records[(A, f'many{k}')] = tile(f'Tile {k}', {'/': res(PLAIN(f'Tile {k}'), 'text/html')})

def h(s): return hashlib.sha256(s.encode()).hexdigest()
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [], 'tiles': [h(f'{SALT}\n{A}\nhidden1')]})

calls = []
def route(r):
    url = r.request.url
    calls.append(url)
    from urllib.parse import urlparse, parse_qs
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        handle = {A: A_HANDLE, B: B_HANDLE, C: C_HANDLE}.get(did)
        if not handle: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{handle}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {A_HANDLE: A, B_HANDLE: B, C_HANDLE: C}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile'):
            labels = [{'src': LABELER, 'uri': f'at://{B}', 'val': '!hide', 'cts': '2026-10-01T00:00:00Z'}] if q.get('actor') == B else []
            return js({'did': q.get('actor'), 'labels': labels})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=HIDE_LIST)
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('getRecord'):
            rec = records.get((q.get('repo'), q.get('rkey')))
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{q['repo']}/ing.dasl.masl/{q['rkey']}", 'cid': 'bafyreirecord', 'value': rec})
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
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://192.168.1.5/**', 'https://lexicographer.space/**']:
        ctx.route(host, route)
    popups = []
    ctx.on('page', lambda pg: popups.append(pg))
    page = ctx.new_page()
    console = []
    page.on('console', lambda m: console.append((m.type, m.text, (m.location or {}).get('url', ''))))
    page.on('pageerror', lambda e: console.append(('pageerror', str(e), RAKU)))
    page.goto(RAKU + '?loader=' + LOADER)

    # 1. first screen
    wait_for(lambda: page.eval_on_selector_all('.pick-title', "els => els.length === 3 && els.every(e => e.textContent !== '…')"), 10)
    names = page.eval_on_selector_all('.pick-title', 'els => els.map(e => e.textContent)')
    check('first screen: the three picks show their names from their records', names == ['Pick one', 'Pick two', 'Pick three'], str(names))
    wait_for(lambda: page.eval_on_selector_all('.pick-pic img', 'els => els.length === 3 && els.every(i => i.complete)'), 10)
    check('the hide list is read from lexicographer.space', any(c == 'https://lexicographer.space/hidden-tiles.json' for c in calls))
    check('first screen: card pictures drawn from the tiles\' banners', page.eval_on_selector_all('.pick-pic img', 'els => els.every(i => i.src.startsWith("blob:") && i.naturalWidth === 1280)'))
    check('first screen: "by @handle" only after the handle checks both ways', wait_for(lambda: page.eval_on_selector_all('.pick-by', "els => els.length === 3 && els[0].textContent === 'by @thunderbird.cafe' && els[2].textContent === 'by @thunderbirdwine.bsky.social'"), 10))
    check('computer: no bottom toolbar; arrows in the top bar', not page.is_visible('.toolbar') and page.is_visible('.bar .nav'))
    check('computer: back, forward, reload and + are drawn icons, not text', page.eval_on_selector_all('.bar .nav-btn, .newtab', "bs => bs.length === 4 && bs.every(b => b.querySelector('svg.icon') && b.textContent.trim() === '')"))
    check('page title "Raku (lab)" and the lab label', page.title() == 'Raku (lab)' and '(lab)' in page.inner_text('.strip-row'))
    check('the built page carries its security policy', page.eval_on_selector('meta[http-equiv="Content-Security-Policy"]', 'm => m.content.includes("frame-src")'))
    check('noindex while a lab', page.eval_on_selector('meta[name=robots]', 'm => m.content') == 'noindex, nofollow')
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
    page.fill('.addr', f'tile://3my6uchoghd2m.{A.replace(":", "%3A")}/'); page.press('.addr', 'Enter')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Daisy player', 15)
    check("Beaver's tile:// form opens its tile", ok)
    page.click('.nav-btn[title="Back"]')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Second tile', 15)
    check('Back returns to the previous tile in this tab', ok)
    page.click('.nav-btn[title="Forward"]')
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Daisy player', 15)
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
    ok = wait_for(lambda: page.frame_locator('.pane.front iframe.tile-frame').frame_locator('iframe').locator('#h').inner_text() == 'Daisy player', 15)
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
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**']:
        m.route(host, route)
    mp = m.new_page()
    mp.goto(RAKU + '?loader=' + LOADER + '#t=' + f'at%3A%2F%2F{A}%2Fing.dasl.masl%2Fprobe1,&a=0')
    mp.wait_for_selector('.count')
    check('phone: no tab strip, a tab count button', not mp.is_visible('.strip-row') and mp.is_visible('.count') and mp.inner_text('.count') == '2')
    check('phone: no arrows in the top bar; the address gets the row', not mp.is_visible('.bar .nav') and mp.eval_on_selector('.addr', 'a => a.getBoundingClientRect().width') > 300)
    sizes = mp.eval_on_selector_all('.toolbar button', 'bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.title, Math.round(r.width), Math.round(r.height)]; })')
    check('phone: a bottom toolbar with back, forward, reload and tabs, each at least 44 px', [x[0] for x in sizes] == ['Back', 'Forward', 'Reload this tile', 'Open tabs'] and all(w >= 44 and hh >= 44 for _, w, hh in sizes), str(sizes))
    icons = mp.eval_on_selector_all('.toolbar .tool-btn svg.icon', 'is => is.map(i => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })')
    check('phone: back, forward and reload icons are drawn the same size', len(icons) == 3 and len(set(map(tuple, icons))) == 1, str(icons))
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

    # 12. inside another site's frame
    fp = ctx.new_page()
    fp.goto('http://outside.localhost:9999/framer')
    fr = fp.frame_locator('#f')
    ok = wait_for(lambda: fr.locator('.framed a').inner_text() == 'Open Raku in its own tab', 8)
    check("inside another site's frame Raku shows only a link to open it in its own tab", ok and fr.locator('.addr').count() == 0 and fr.locator('.tab').count() == 0)
    b.close()

fails = [r for r in results if not r[1] and not r[0].startswith('FINDING')]
print(f"\n{len([r for r in results if r[1] and not r[0].startswith('FINDING')])} passed, {len(fails)} failed")
