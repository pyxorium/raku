# Preparing a tile while its card shows (claude/raku-prepare-tiles-plan.md, PT1 to PT5), browser checks in the chat
# sandbox: a card on screen a second fetches its tile's page once, and nothing before that; a resting pointer or a touch
# fetches the rest, within 2 MB; never a tile over the ask size, nor with data saver on; opening the tile then fetches
# no file again and reads its record once, in the background, after its page; a record changed since the card shows
# "This tile has been updated since it opened." with Reload (the new version), a deleted one "Its author has deleted
# this tile." with only ×; inside a tile post (Play here) the same note in the post; the first screen's picks.
# Everything outside is a Playwright route. Tiles don't run: the stand-in @dasl/tile-loader asks Raku for "/" and then
# the tile's other files, as the real worker would, so Raku's own file loading is what's checked.
# Usage: python3 test/browser/check_prepare.py <work folder>   (servers.mjs already running on 127.0.0.1:5180)
import hashlib, io, json, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
POST = 'cafe.thunderbird.tile.post'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
HANDLES = {T: T_H, P: P_H}
PDS = 'https://pds.fakepds.net'
KB = 1024; MB = 1024 * KB

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(320, 180)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def res(path, data, ctype, size=None):
    return path, {'src': {'$type': 'blob', 'ref': {'$link': cid_for(data)}, 'mimeType': ctype, 'size': size if size is not None else len(data)}, 'content-type': ctype}
def tile(name, color, extra=(), version=1):
    files = [res('/', f'<!doctype html><h1>{name} v{version}</h1>'.encode(), 'text/html'), res('/banner.png', png(color), 'image/png')] + list(extra)
    return {'$type': 'ing.dasl.masl', 'tile': {'name': name, 'description': name, 'resources': dict(files), 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-01T10:00:00Z'}
def cid_of(t, path): return t['tile']['resources'][path]['src']['ref']['$link']

LANTERN_EXTRA = [res('/lantern.js', b'// lantern ' + b'x' * 4000, 'text/javascript'), res('/s.css', b'body{}', 'text/css'),
                 res('/huge.bin', b'big file stand-in', 'application/octet-stream', size=int(2.5 * MB))]   # (declared 2.5 MB: left for opening)
TILES = {
    (T, 'lantern'): tile('Glass Lantern', (200, 150, 60), LANTERN_EXTRA),
    (P, 'cube'): tile('Cube', (90, 60, 160), [res('/cube.js', b'// cube', 'text/javascript')]),
    (T, 'big'): tile('Big tile', (40, 40, 40), [res('/movie.mp4', b'not really', 'video/mp4', size=30 * MB)]),
}
versions = {k: 1 for k in TILES}
B32 = str.maketrans('0189', 'abcd')   # (Raku checks CIDs are base32: no 0, 1, 8 or 9)
def tcid(key): return f"bafyreitile{key[1]}v{'abcdefg'[versions[key]]}".translate(B32).ljust(40, 'a')
NOW = time.time()
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - h * 3600))
def tpost(did, rkey, text, h, tdid, trkey):
    return {'uri': f'at://{did}/{POST}/{rkey}', 'cid': ('bafyreipost' + rkey).translate(B32).ljust(40, 'a'), 'value': {'$type': POST, 'tile': {'uri': f'at://{tdid}/ing.dasl.masl/{trkey}', 'cid': tcid((tdid, trkey))}, 'text': text, 'createdAt': iso(h)}}
# (built when asked for: a post names the tile's version at that moment, so posts draw; a change made after a card is on
# screen is the case PT5 is about)
def posts_of(did):
    return {T: [tpost(T, '3mza2', 'The lantern', 1, T, 'lantern'), tpost(T, '3mza3', 'A big one', 3, T, 'big')],
            P: [tpost(P, '3mzp2', 'A cube', 2, P, 'cube')]}.get(did, [])
POSTS = {T: None, P: None}

calls = []      # (time, kind, did, rkey-or-cid)
def generic(did, rkey):   # the picks and anything else: a small tile of its own
    return tile(f'Pick {rkey[-4:]}', (100, 120, 140), [res('/app.js', f'// {rkey}'.encode(), 'text/javascript')])
def route(r):
    url = r.request.url
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'relay1.us-east.bsky.network':
        if q.get('collection') == POST: return js({'repos': [{'did': d} for d in POSTS]})
        return js({'repos': []})
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES.get(did, did[8:20] + ".fakepds.net")}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            hd = q.get('handle', ''); did = {v: k for k, v in HANDLES.items()}.get(hd)
            if not did and hd.endswith('.fakepds.net'): did = 'did:plc:' + hd.split('.')[0]
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        prof = lambda d: {'did': d, 'handle': HANDLES.get(d, 'handle.invalid'), 'displayName': '', 'labels': []}
        if u.path.endswith('getProfiles'): return js({'profiles': [prof(d) for d in parse_qs(u.query).get('actors', [])]})
        if u.path.endswith('getProfile'): return js(prof(q.get('actor')))
        return js({'error': 'NotFound'}, 404)
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return js({'version': 1, 'salt': 'x', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        repo = q.get('repo')
        if u.path.endswith('listRecords'):
            if q.get('collection') == POST: return js({'records': posts_of(repo)})
            return js({'records': []})
        if u.path.endswith('getRecord'):
            if q.get('collection') == POST:
                rec = next((x for x in posts_of(repo) if x['uri'].endswith('/' + q.get('rkey', ''))), None)
                return js(rec) if rec else js({'error': 'RecordNotFound'}, 400)
            key = (repo, q.get('rkey'))
            calls.append((time.time(), 'record', repo, q.get('rkey')))
            if key in TILES:
                t = TILES[key]
                if t is None: return js({'error': 'RecordNotFound'}, 400)
                return js({'uri': f"at://{repo}/ing.dasl.masl/{key[1]}", 'cid': tcid(key), 'value': t})
            return js({'uri': f"at://{repo}/ing.dasl.masl/{key[1]}", 'cid': 'bafyreigeneric' + key[1], 'value': generic(*key)})
        if u.path.endswith('getBlob'):
            calls.append((time.time(), 'blob', repo, q.get('cid')))
            b = blobs.get(q.get('cid'))
            return r.fulfill(status=200 if b else 404, headers={**cors, 'content-type': 'application/octet-stream'}, body=b or b'')
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
def wait_for(fn, timeout=10.0, step=0.1, page=None):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        if page: page.evaluate('1')
        time.sleep(step)
    return None
def pause(pg, s):
    end = time.time() + s
    while time.time() < end: pg.evaluate('1'); time.sleep(0.05)
def blob_count(cid): return sum(1 for c in calls if c[1] == 'blob' and c[3] == cid)
def record_count(did, rkey): return sum(1 for c in calls if c[1] == 'record' and c[2] == did and c[3] == rkey)
LAN = (T, 'lantern'); BIG = (T, 'big')
def lan(path): return cid_of(TILES[LAN], path)
POSTS_URL = RAKU + '#t=raku%3Adiscover%2Fposts&a=0'
def card(trkey): return f'.tp-card[data-tile$="/{trkey}"]'

with sync_playwright() as pw:
    b = pw.chromium.launch()
    def new_ctx(init='', **kw):
        ctx = b.new_context(**({'viewport': {'width': 1400, 'height': 1000}, 'color_scheme': 'dark'} | kw))
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
            ctx.route(host, route)
        if init: ctx.add_init_script(init)
        return ctx
    errors = []
    def open_posts(ctx):
        calls.clear()
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(POSTS_URL); pg.wait_for_selector('.discover')
        wait_for(lambda: len(pg.query_selector_all('.tp-card .tp-play')) >= 2, page=pg)
        return pg

    # ---- 1. on screen a second: the page only, once ----
    ctx = new_ctx()
    pg = open_posts(ctx)
    t0 = time.time()
    check('tile posts drawn with Play here', len(pg.query_selector_all('.tp-play')) >= 2)
    check('no page fetched in the first moment', blob_count(lan('/')) == 0)
    pause(pg, 1.6)
    check('after a second on screen: the lantern page fetched', blob_count(lan('/')) == 1, str(blob_count(lan('/'))))
    check('…and none of its other files', blob_count(lan('/lantern.js')) == 0 and blob_count(lan('/s.css')) == 0)
    check('the big tile (over 25 MB): nothing fetched', blob_count(cid_of(TILES[BIG], '/')) == 0)
    check('the record was not read again for it (the card\'s copy is kept)', record_count(*LAN) == 1, str(record_count(*LAN)))
    pause(pg, 1.2)
    check('still once after staying on screen', blob_count(lan('/')) == 1)

    # ---- 2. a resting pointer: the rest, within 2 MB; sweeping across doesn't count ----
    box = pg.query_selector(card('cube')).bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + 40); pause(pg, 0.08)
    pg.mouse.move(5, 5); pause(pg, 0.5)
    check('a pointer sweeping across the cube card fetches nothing more', blob_count(cid_of(TILES[(P, 'cube')], '/cube.js')) == 0)
    box = pg.query_selector(card('lantern')).bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] - 30); pause(pg, 0.9)
    check('a resting pointer: the lantern\'s small files fetched', blob_count(lan('/lantern.js')) == 1 and blob_count(lan('/s.css')) == 1)
    check('…not the 2.5 MB file (over the 2 MB limit)', blob_count(lan('/huge.bin')) == 0)
    check('…and the page not fetched twice', blob_count(lan('/')) == 1)
    box = pg.query_selector(card('big')).bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] - 30); pause(pg, 0.9)
    check('resting on the big tile\'s card: still nothing', not any(c[1] == 'blob' and c[3] in (cid_of(TILES[BIG], '/'), cid_of(TILES[BIG], '/movie.mp4')) for c in calls))

    # ---- 3. opening it: nothing fetched again; its record read once, after its page ----
    n_before = len(calls)
    rec_before = record_count(*LAN)
    # (when the tile's page reached its frame: the stand-in sets srcdoc once Raku has served "/")
    pg.evaluate("""() => { window.__pageAt = 0; new MutationObserver(() => { const f = document.querySelector('.tile-frame[data-standin]');
      if (f && f.srcdoc && !window.__pageAt) window.__pageAt = Date.now(); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['srcdoc'] }); }""")
    pg.click(f'{card("lantern")} .card-main')
    wait_for(lambda: pg.query_selector('.tile-frame[data-standin]'), page=pg)
    pause(pg, 1.5)
    after = calls[n_before:]
    check('opened: a tile frame in the tab', pg.query_selector('.tile-frame[data-standin]') is not None)
    check('opening fetched none of the kept files again', not any(c[1] == 'blob' and c[3] in (lan('/'), lan('/lantern.js'), lan('/s.css')) for c in after),
          str([c[3][-6:] for c in after if c[1] == 'blob']))
    check('…the file over the limit loads on opening, as now', blob_count(lan('/huge.bin')) == 1)
    check('the record read once more, in the background', record_count(*LAN) == rec_before + 1, f'{rec_before} -> {record_count(*LAN)}')
    page_at = pg.evaluate('window.__pageAt') / 1000
    rec_at = next((c[0] for c in after if c[1] == 'record'), None)
    check('…only after its page was in (no getRecord before the tile starts)', page_at and rec_at and rec_at >= page_at - 0.05, f'page {page_at:.3f}, record {rec_at}')
    check('unchanged: no note', pg.query_selector('.record-hint') is None)

    # ---- 4. changed since the card: the note, Reload opens the new version ----
    pg.goto(POSTS_URL); wait_for(lambda: len(pg.query_selector_all('.tp-card .tp-play')) >= 2, page=pg)
    pause(pg, 0.5)
    versions[LAN] = 2
    old_tile = TILES[LAN]
    TILES[LAN] = tile('Glass Lantern', (200, 150, 60), LANTERN_EXTRA, version=2)
    pg.click(f'{card("lantern")} .card-main')
    note = wait_for(lambda: pg.query_selector('.pane .record-hint[data-kind="changed"]'), page=pg)
    check('changed: the note shows', note is not None)
    if note:
        check('…its words', note.inner_text().startswith('This tile has been updated since it opened.'), note.inner_text())
        check('…Reload and ×', note.query_selector('button.primary') is not None and note.query_selector('.table-hint-x') is not None)
        pg.screenshot(path=str(OUT / 'prepare-changed.png'))
        check('the old version keeps running meanwhile', blob_count(cid_of(old_tile, '/')) >= 1 and pg.query_selector('.tile-frame[data-standin]') is not None)
        newpage = cid_of(TILES[LAN], '/')
        recs = record_count(*LAN)
        note.query_selector('button.primary').click()
        wait_for(lambda: blob_count(newpage) >= 1, page=pg)
        pause(pg, 0.8)
        check('Reload: the new version\'s page fetched', blob_count(newpage) == 1)
        check('…its record read fresh', record_count(*LAN) == recs + 1, f'{recs} -> {record_count(*LAN)}')
        check('…and no note after', pg.query_selector('.record-hint') is None)

    # ---- 5. deleted since the card: the note with × only (the cube: the lantern's post now names an older version, so
    # Raku's kept list of tile posts rightly shows it can't be shown) ----
    CUBE = (P, 'cube')
    pg.goto(POSTS_URL); wait_for(lambda: pg.query_selector(f'{card("cube")} .tp-play'), page=pg)
    pause(pg, 0.5)
    cube_tile = TILES[CUBE]
    TILES[CUBE] = None
    pg.click(f'{card("cube")} .card-main')
    note = wait_for(lambda: pg.query_selector('.pane .record-hint[data-kind="deleted"]'), page=pg)
    check('deleted: the note shows', note is not None)
    if note:
        check('…its words', note.inner_text().strip() == 'Its author has deleted this tile.', note.inner_text())
        check('…× only, no Reload', note.query_selector('button.primary') is None and note.query_selector('.table-hint-x') is not None)
        check('…and the tile keeps running', pg.query_selector('.tile-frame[data-standin]') is not None)
        pg.screenshot(path=str(OUT / 'prepare-deleted.png'))
        note.query_selector('.table-hint-x').click(); pause(pg, 0.2)
        check('× hides it', pg.query_selector('.record-hint') is None)
    TILES[CUBE] = cube_tile
    ctx.close()

    # ---- 6. inside a tile post (Play here): the same note in the post; Reload restarts it there ----
    versions[LAN] = 2
    ctx = new_ctx()
    pg = open_posts(ctx)
    versions[LAN] = 3
    TILES[LAN] = tile('Glass Lantern', (200, 150, 60), LANTERN_EXTRA, version=3)
    pg.click(f'{card("lantern")} .tp-play')
    note = wait_for(lambda: pg.query_selector(f'{card("lantern")} .tp-slot .record-hint[data-kind="changed"]'), page=pg)
    check('Play here, changed: the note inside the post', note is not None)
    if note:
        check('…same words', note.inner_text().startswith('This tile has been updated since it opened.'))
        pg.screenshot(path=str(OUT / 'prepare-play-changed.png'), clip=pg.query_selector(card('lantern')).bounding_box())
        newpage = cid_of(TILES[LAN], '/')
        note.query_selector('button.primary').click()
        wait_for(lambda: blob_count(newpage) >= 1, page=pg)
        pause(pg, 0.8)
        check('Reload in the post: the new version started there', blob_count(newpage) == 1 and pg.query_selector(f'{card("lantern")} .tp-slot iframe.tp-frame') is not None)
        check('…still playing, no note', pg.query_selector(f'{card("lantern")} .tp-slot.playing') is not None and pg.query_selector(f'{card("lantern")} .record-hint') is None)
    ctx.close()

    # ---- 7. a touch: the rest at once ----
    ctx = new_ctx(has_touch=True)
    pg = open_posts(ctx)
    cube_js = cid_of(TILES[(P, 'cube')], '/cube.js')
    pg.eval_on_selector(card('cube'), "el => el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }))")
    wait_for(lambda: blob_count(cube_js) >= 1, timeout=1.0, page=pg)
    check('a touch: the cube\'s files fetched at once', blob_count(cube_js) == 1 and blob_count(cid_of(TILES[(P, 'cube')], '/')) == 1)
    ctx.close()

    # ---- 8. data saver: nothing ----
    ctx = new_ctx("Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });")
    pg = open_posts(ctx)
    pause(pg, 1.6)
    box = pg.query_selector(card('cube')).bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] - 30); pause(pg, 0.8)
    check('data saver: no tile page or file fetched early', not any(c[1] == 'blob' and c[3] in (lan('/'), cube_js, cid_of(TILES[(P, 'cube')], '/')) for c in calls))
    ctx.close()

    # ---- 9. the first screen's picks ----
    ctx = new_ctx()
    calls.clear()
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(RAKU); wait_for(lambda: len(pg.query_selector_all('.card')) >= 6, page=pg)
    pause(pg, 2.5)
    pick_pages = [cid_of(generic(None, u.split('/')[-1]), '/') for u in [
        'at://did:plc:vryspragp5yyohzghxpgqm7i/ing.dasl.masl/3mx27cvoqvz2g', 'at://did:plc:qpdjl22sgfejceds2ibabye6/ing.dasl.masl/3mx2yq4ti6g2s',
        'at://did:plc:jatbf7xbmjzy4uol34yyeh6t/ing.dasl.masl/3mxrdcu5qrk2d', 'at://did:plc:33k6yq7knpf5ecf532kdi5xy/ing.dasl.masl/3mxrcgrmw452v',
        'at://did:plc:mhu5ya2asqislku2audcqmtm/ing.dasl.masl/3mxjvqfkjo22o']]
    got = sum(1 for c in pick_pages if blob_count(c) == 1)
    check('first screen: the picks on screen have their pages fetched, once each', got >= 3, f'{got} of 5')
    app_js = [cid_of(generic(None, '3mx2yq4ti6g2s'), '/app.js')]
    check('…but not their other files', all(blob_count(c) == 0 for c in app_js))
    ctx.close()

    check('no page errors', not errors, '; '.join(errors[:3]))
    b.close()

n = sum(1 for r in results if r[1])
print(f'\n{n} of {len(results)} passed')
sys.exit(0 if n == len(results) else 1)
