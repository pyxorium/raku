# Games in tile posts (Play here; claude/raku-play-here-games-plan.md, PG1 to PG4) in a browser: the real Cosmic Junkyard
# version 2 page (index.html and sprite.png from C:\thunderbird-cafe\cosmic-junkyard-tile\tile) posted as a tile post on
# Discover → Tile posts, run through a replica of the tile loading server, with a stand-in account server.
# Checked: Play here → the game gets the signed-in player's character ("Playing as @…", the sheet drawn) and can-save
# (PG1); its sprite button opens the account menu as in a tab; a real run, "Save this run" with the moves ticked → Raku's
# prompt over its whole window, the post dimmed behind (PG2) → Allow once → a cafe.thunderbird.cosmicjunkyard.run record
# naming the game's address and the version the post plays, whose moves replay to its score; "Saved to @… ✓", Close gives
# the keys back to the post, See it opens Raku's "Open in" message. A post of a tile with ways: its own tile gets no
# can-save and is refused (not-allowed); its way leads to Cosmic Junkyard inside the post, which then gets can-save; there,
# expanded, the sprite button opens the menu with Raku's bar over the expanded view, the post staying expanded, and
# Escape closes only the menu (PG6); from Full screen it leaves full screen first (PG7); a run's prompt sits over the
# expanded view; No → "Not saved."; Stop mid-prompt closes the prompt and saves nothing. Back on the game's own post,
# expanded and in Full screen: a save leaves full screen for the prompt (PG7), Always; then, in Full screen again, the
# next save goes without a prompt and full screen stays. Signed out: the button opens the menu to sign in (SG2).
#
# Usage: python3 test/browser/check_play_here_games.py <work folder> <tiles-loading-server folder> <cosmic-junkyard-tile folder>
#   (as check_game_saves.py: Playwright with Chromium, esbuild, node_modules with @dasl/tile-loader and rooms-lab, port 80 free)
import base64, datetime, hashlib, io, json, os, shutil, subprocess, sys, time, zoneinfo
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
CJREPO = Path(sys.argv[3]).resolve()
CJ = CJREPO / 'tile'
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
POSTS_URL = RAKU + '?loader=' + LOADER + '#t=raku%3Adiscover%2Fposts&a=0'
PDS = 'https://pds.fakepds.net'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
TILE = 'ing.dasl.masl'; COLL = 'cafe.thunderbird.tile.post'; SIGN = 'cafe.thunderbird.way.signpost'
CJ_RKEY = '3mwvoqidyqd24'; CJ_CID = 'bafyreicosmicjunkyardversiontwo'
WAY_RKEY = 'waytile'; WAY_CID = 'bafyreiwaytileversionone'
RUN = 'cafe.thunderbird.cosmicjunkyard.run'
GRANT = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post&collection=cafe.thunderbird.tile.like&collection=' + RUN + ' rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*'

def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs = {}
def blob(did, data, ctype):
    c = raw_cid(data); blobs[(did, c)] = data
    return {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}
def res(did, data, ctype): return {'src': blob(did, data, ctype), 'content-type': ctype}
def png(colour, size=(1280, 720)):
    b = io.BytesIO(); Image.new('RGB', size, colour).save(b, 'PNG'); return b.getvalue()
def sheet(colour):
    im = Image.new('RGBA', (144, 192), (0, 0, 0, 0))
    for r in range(4):
        for c in range(3):
            for y in range(8, 44):
                for x in range(12, 36): im.putpixel((c * 48 + x, r * 48 + y), colour)
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
RED = sheet((220, 40, 40, 255))

# ---- the tiles: the real Cosmic Junkyard; a stand-in tile with one way (its door leads to Cosmic Junkyard) ----
WAY_JS = b'''
const UP = 'tiles-protocol-up-way-payload', DOWN = 'tiles-protocol-down-way-payload';
let host = false;
addEventListener('message', (e) => { const d = e.data; if (e.source === parent && d && d.action === DOWN && d.payload && d.payload.v === 1) host = true; });
const hello = () => parent.postMessage({ action: UP, payload: { v: 1, kind: 'hello', tile: 'waytile', ways: '/ways.json' } }, '*');
hello(); setTimeout(() => { if (!host) hello(); }, 500);
window.leave = (exit) => parent.postMessage({ action: UP, payload: { v: 1, kind: 'leave', exit, facing: 'n' } }, '*');
'''
WAY_PAGE = b'<!doctype html><meta charset=utf-8><body style="font:18px sans-serif;padding:16px"><h1 id=h>Way tile</h1><script src="/way.js"></script>'
BANNER = png((40, 40, 90))
cj_res = {'/': res(T, (CJ / 'index.html').read_bytes(), 'text/html'), '/sprite.png': res(T, (CJ / 'sprite.png').read_bytes(), 'image/png'),
          '/banner.png': res(T, BANNER, 'image/png')}
way_res = {'/': res(T, WAY_PAGE, 'text/html'), '/way.js': res(T, WAY_JS, 'text/javascript'), '/banner.png': res(T, png((60, 120, 160)), 'image/png'),
           '/ways.json': res(T, json.dumps({'v': 1, 'tile': 'waytile', 'place': f'at://{T}/cafe.thunderbird.way.place/waytile',
                                            'exits': [{'id': 'door', 'signpost': f'at://{T}/{SIGN}/waytile.door', 'fallback': 'https://thunderbird.cafe/way/waytile/door'}],
                                            'entrances': [{'id': 'door'}]}).encode(), 'application/json')}
NOW = time.time()
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - h * 3600))
def tpost(rkey, text, h, tile_rkey, cid):
    return {'uri': f'at://{T}/{COLL}/{rkey}', 'cid': 'bafyreipost' + rkey,
            'value': {'$type': COLL, 'text': text, 'tile': {'uri': f'at://{T}/{TILE}/{tile_rkey}', 'cid': cid}, 'createdAt': iso(h)}}
records = {   # (repo, collection, rkey) -> (cid, value)
    (T, TILE, CJ_RKEY): (CJ_CID, {'$type': TILE, 'tile': {'name': 'Cosmic Junkyard', 'resources': cj_res, 'screenshots': [{'src': '/banner.png'}]}}),
    (T, TILE, WAY_RKEY): (WAY_CID, {'$type': TILE, 'tile': {'name': 'Way tile', 'resources': way_res, 'screenshots': [{'src': '/banner.png'}]}}),
    (T, SIGN, 'waytile.door'): ('bafyreisignwaytiledoor', {'$type': SIGN, 'to': [{'tile': f'at://{T}/{TILE}/{CJ_RKEY}'}], 'updatedAt': '2026-11-01T00:00:00Z'}),
    (T, 'actor.rpg.sprite', 'self'): ('bafyreiownsprite', {'$type': 'actor.rpg.sprite', 'spriteSheet': blob(T, RED, 'image/png'), 'width': 144, 'height': 192,
                                                         'frameWidth': 48, 'frameHeight': 48, 'columns': 3, 'rows': 4}),
}
POSTS = {T: [tpost('3mzg1', 'Play Cosmic Junkyard', 1, CJ_RKEY, CJ_CID), tpost('3mzg2', 'A tile with a way', 2, WAY_RKEY, WAY_CID)]}
puts = []; calls = []

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

HANDLES = {T: T_H, P: P_H}
def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'relay1.us-east.bsky.network': return js({'repos': []})
    if u.hostname == 'rpg.actor': return js({'error': 'NotFound'}, 404)        # the Compendium unreadable: the own record instead
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        if did not in HANDLES: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES[did]}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        prof = lambda d: {'did': d, 'handle': HANDLES.get(d, 'handle.invalid'), 'displayName': HANDLES.get(d, 'x').split('.')[0].title(), 'labels': []}
        if u.path.endswith('getProfiles'): return js({'profiles': [prof(d) for d in parse_qs(u.query).get('actors', [])]})
        if u.path.endswith('getProfile'): return js(prof(q.get('actor')))
        return js({})
    if u.hostname == 'cdn.bsky.app': return r.fulfill(status=200, headers={**cors, 'content-type': 'image/png'}, body=png((63, 184, 168), (64, 64)))
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('putRecord'):
            body = json.loads(r.request.post_data or '{}')
            puts.append({'did': q.get('standin_did'), 'body': body})
            return js({'uri': f"at://{body['repo']}/{body['collection']}/{body['rkey']}", 'cid': 'bafyreiwritten' + body['rkey']})
        if u.path.endswith('listRecords'):
            if q.get('collection') != COLL: return js({'records': []})
            return js({'records': POSTS.get(q.get('repo'), [])})
        if u.path.endswith('getRecord'):
            key = (q.get('repo'), q.get('collection'), q.get('rkey'))
            got = records.get(key)
            if not got: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{key[0]}/{key[1]}/{key[2]}", 'cid': got[0], 'value': got[1]})
        if u.path.endswith('getBlob'):
            bb = blobs.get((q.get('did'), q.get('cid')))
            if bb is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=bb)
        if u.path.endswith('getLatestCommit'): return js({'cid': 'bafyreicommit', 'rev': '3n2juc3idnk2c'})
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
PAGES = []
def wait_for(fn, timeout=10.0, step=0.15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        for p in PAGES:
            try: p.evaluate('1')
            except Exception: pass
        time.sleep(step)
    return None
def seed(accounts):
    acc = [{'did': d, 'handle': HANDLES[d]} for d in accounts]
    return (f"try {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-accounts', {json.dumps(json.dumps(acc))});"
            f" localStorage.setItem('raku-account', {json.dumps(json.dumps(accounts[0] if accounts else None))});"
            f" localStorage.setItem('standin-sessions', {json.dumps(json.dumps({d: {'scope': GRANT} for d in accounts}))});"
            f" sessionStorage.setItem('seeded', '1'); }} }} catch {{}}")
TALK = """async ([msg, ms]) => { const d = await import('/.well-known/web-tiles/data.js'); const got = [];
  d.addDataHandler((m) => got.push(m && typeof m === 'object' ? JSON.parse(JSON.stringify(m, (k, v) => (v instanceof Blob ? 'blob' : v))) : m));
  if (msg) d.sendData(msg); await new Promise((r) => setTimeout(r, ms)); return got; }"""
POST = lambda text: f'.tile-post:has(.post-text:text-is("{text}"))'
CJP = POST('Play Cosmic Junkyard'); WAYP = POST('A tile with a way')

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--autoplay-policy=no-user-gesture-required'])
        HOSTS = ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://rpg.actor/**',
                 'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://github.com/**']
        def new_page(script):
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
            for host in HOSTS: ctx.route(host, route)
            if script: ctx.add_init_script(script)
            page = ctx.new_page(); errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            PAGES.append(page)
            return page, errs
        def game(page, text=None):
            """The tile frame playing in a tile post (the one whose post has this text, if given)."""
            for f in page.frames:
                if '.tiles.lex.localhost' in (urlparse(f.url).hostname or '') and f.parent_frame and '.tiles.lex.localhost' in (urlparse(f.parent_frame.url).hostname or '') \
                   and f.parent_frame.parent_frame == page.main_frame:
                    try:
                        el = f.parent_frame.frame_element()
                        if el.evaluate('(e, t) => !!e.closest(".tile-post") && (!t || e.closest(".tile-post").querySelector(".post-text").textContent === t)', text): return f
                    except Exception: pass
            return None
        def is_cj(page): g = game(page); return g if g and g.query_selector('#game') and g.is_visible('#game') else None
        def status(page): return game(page).inner_text('#status')
        def save_status(page): return game(page).inner_text('#saveStatus')
        def ended(page): return game(page).evaluate("() => !document.getElementById('savePanel').hidden")
        def play(page, moves=True):
            g = game(page); g.focus('#game'); page.keyboard.press('Enter')
            if moves:
                for key, ms in [('ArrowLeft', 400), ('ArrowRight', 900), ('ArrowLeft', 300)]:
                    page.keyboard.down(key); time.sleep(ms / 1000); page.keyboard.up(key); time.sleep(0.2)
        def runs(did): return [p for p in puts if p['did'] == did and p['body'].get('collection') == RUN]
        def open_posts(page):
            page.goto(POSTS_URL); page.wait_for_selector('.discover')
            return wait_for(lambda: page.is_visible(f'{CJP} .tp-play') and page.is_visible(f'{WAYP} .tp-play'), 20)
        def red_pixels(page):
            return game(page).evaluate('''() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++; return n; }''')
        def topmost_at_post(page):
            """What sits on top at the post's slot's centre: 'dialog' if Raku's prompt covers it."""
            return page.evaluate('''() => { const s = document.querySelector('.tile-post .tp-slot:has(iframe.tp-frame)'); const r = s.getBoundingClientRect();
              const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && e.closest('.rk-dialog') ? 'dialog' : (e ? e.className || e.tagName : 'none'); }''')
        def menu_on_top(page):
            """The account menu open and on top at its own centre (not under the expanded view)."""
            return page.evaluate('''() => { const m = document.querySelector('.account-menu'); if (!m || m.hidden) return false; const r = m.getBoundingClientRect();
              const e = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60)); return !!(e && m.contains(e)); }''')
        def full(page): return page.evaluate('() => document.fullscreenElement ? document.fullscreenElement.className : null')
        def go_full(page):
            page.click('.tp-x .tp-x-full'); return wait_for(lambda: full(page) and 'tp-slot' in full(page), 5)
        def dialog_box(page): return page.eval_on_selector('.rk-dialog', 'd => { const r = d.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, d.parentElement.className]; }')

        # Three pages at once: A signed in (a run saved), B signed in (the way post; expanded; Stop), C signed out.
        A, errsA = new_page(seed([T])); B, errsB = new_page(seed([T])); C, errsC = new_page(seed([]))
        for pg in (A, B, C): check('Discover → Tile posts: both posts have Play here', open_posts(pg))

        # ======== A: the game's own post ========
        A.click(f'{CJP} .tp-play')
        check('Play here: Cosmic Junkyard runs in its post', wait_for(lambda: is_cj(A), 25))
        check('PG1: the character comes in, with the handle: "Playing as @thunderbird.cafe"', wait_for(lambda: status(A) == f'Playing as @{T_H}', 20), str(status(A)))
        check('...from the player\'s own record (the Compendium stand-in unreadable), and the game draws it', wait_for(lambda: red_pixels(A) > 50, 5)
              and any('actor.rpg.sprite' in c for c in calls), str(red_pixels(A)))
        got = game(A).evaluate(TALK, [{'kind': 'hello', 'v': 1}, 1500])
        check('PG1: its hello gets can-save with its collection (the game at its own address)', {'kind': 'can-save', 'collections': [RUN]} in got, str(got))
        check('...and the character again (sprite), no Messages pill anywhere', any(m.get('kind') == 'sprite' for m in got if isinstance(m, dict)) and not A.is_visible('.panel-pill'))
        game(A).click('#spriteBtn')
        check('its sprite button: Raku\'s account menu, "Choose the account whose rpg.actor character plays." (SG3)',
              wait_for(lambda: A.is_visible('.account-menu .acct-reason') and A.inner_text('.account-menu .acct-reason') == 'Choose the account whose rpg.actor character plays.', 5))
        A.keyboard.press('Escape'); wait_for(lambda: not A.is_visible('.account-menu'), 3)
        if A.is_visible('.account-menu'): A.click('.account-btn')

        # ======== B: the post of a tile with a way ========
        B.click(f'{WAYP} .tp-play')
        check('a post of a tile with a way: it runs', wait_for(lambda: game(B) and game(B).query_selector('#h') and game(B).inner_text('#h') == 'Way tile', 25))
        got = game(B).evaluate(TALK, [{'kind': 'hello', 'v': 1}, 1500])
        kinds = [m.get('kind') for m in got if isinstance(m, dict)]
        check('...its hello (not Cosmic Junkyard\'s address): no can-save', 'can-save' not in kinds and kinds, str(kinds))
        got = game(B).evaluate(TALK, [{'kind': 'write-record', 'id': 'w1', 'action': 'create', 'collection': RUN, 'record': {'score': 1, 'day': '2026-11-19', 'playedAt': '2026-11-19T00:00:00.000Z'}}, 1500])
        check('...its write-record refused: not-allowed', {'kind': 'write-record-result', 'id': 'w1', 'ok': False, 'error': 'not-allowed'} in got, str(got))
        game(B).evaluate('() => leave("door")')
        check('its way leads to Cosmic Junkyard inside the post (expanded first)', wait_for(lambda: is_cj(B), 25) and B.query_selector('.tp-x') is not None)
        got = game(B).evaluate(TALK, [{'kind': 'hello', 'v': 1}, 1500])
        check('...there, its hello gets can-save (the place reached by the way is the game\'s own address)', {'kind': 'can-save', 'collections': [RUN]} in got, str(got))
        check('...and the character', wait_for(lambda: status(B) == f'Playing as @{T_H}', 15), str(status(B)))
        game(B).click('#spriteBtn')
        check('PG6: expanded, the sprite button opens the menu over the expanded view, the post staying expanded',
              wait_for(lambda: B.is_visible('.account-menu .acct-reason') and menu_on_top(B), 5) and B.query_selector('.tp-x') is not None
              and B.evaluate("() => document.documentElement.classList.contains('rk-bar-over')"))
        B.screenshot(path=str(OUT / 'post-menu-expanded.png'))
        B.keyboard.press('Escape')
        check('...Escape closes only the menu: still expanded, Raku\'s bar back under', wait_for(lambda: not B.is_visible('.account-menu'), 3)
              and B.query_selector('.tp-x') is not None and not B.evaluate("() => document.documentElement.classList.contains('rk-bar-over')"))
        check('...the game kept running, expanded', is_cj(B) and status(B) == f'Playing as @{T_H}')
        check('Full screen: the post\'s slot alone in full screen', go_full(B))
        # (in full screen, Playwright's own click lands off the button; the button clicked from inside the game instead)
        game(B).evaluate('() => document.getElementById("spriteBtn").click()')
        check('PG7: in full screen, the sprite button leaves full screen first, then the menu over the expanded view',
              wait_for(lambda: full(B) is None and B.is_visible('.account-menu') and menu_on_top(B), 5) and B.query_selector('.tp-x') is not None, str(full(B)))
        B.click('.tp-x-hole', position={'x': 5, 'y': 5}, force=True)
        check('...a click outside closes the menu (and the bar goes back), still expanded', wait_for(lambda: not B.is_visible('.account-menu'), 3)
              and not B.evaluate("() => document.documentElement.classList.contains('rk-bar-over')") and B.query_selector('.tp-x') is not None)

        # ======== C: signed out ========
        C.click(f'{CJP} .tp-play')
        check('signed out: the game runs in its post', wait_for(lambda: is_cj(C), 25))
        check('...its sprite button shows (Raku answered the hello)', wait_for(lambda: game(C).evaluate('() => getComputedStyle(document.getElementById("spriteBtn")).display !== "none"'), 10))
        game(C).click('#spriteBtn')
        check('...and opens the menu to sign in (SG2)', wait_for(lambda: C.is_visible('.account-menu .acct-reason') and C.inner_text('.account-menu .acct-reason') == 'Sign in to play as your rpg.actor character.', 5))
        check('no errors on the page (signed out)', not errsC, str(errsC))

        # ======== real runs: A small, B expanded ========
        play(A); play(B)
        print('   (two runs playing, about 45 seconds)', flush=True)
        check('the runs end, each offering "Save this run"', wait_for(lambda: ended(A) and ended(B), 90))

        # A: moves ticked, the prompt over the window, Allow once
        game(A).check('#movesBox'); game(A).click('#saveBtn')
        check('PG2: Raku\'s prompt opens, "Save this run to @thunderbird.cafe?", the moves in it', wait_for(lambda: A.is_visible('.rk-dialog') and A.inner_text('.rk-dialog h2') == f'Save this run to @{T_H}?'
              and 'includes your moves' in A.inner_text('.rk-dialog'), 5))
        box = dialog_box(A)
        check('...over Raku\'s whole window (not inside the post\'s slot)', box[:4] == [0, 0, 1280, 900] and 'stage' in box[4], str(box))
        check('...the post dimmed behind it (the prompt on top at the post\'s centre)', topmost_at_post(A) == 'dialog', topmost_at_post(A))
        check('...the game says it\'s waiting for you', 'allow' in save_status(A), save_status(A))
        check('...the focus in the prompt', A.evaluate('() => !!document.activeElement.closest(".rk-dialog")'))
        A.screenshot(path=str(OUT / 'post-save-ask.png'))
        A.click('.rk-dialog button:text-is("Allow once")')
        check('Allow once: written to the account', wait_for(lambda: runs(T), 8))
        rec = runs(T)[-1]['body']['record']
        check('...its game: the address and the version the post plays', rec.get('game') == {'uri': f'at://{T}/{TILE}/{CJ_RKEY}', 'cid': CJ_CID}, str(rec.get('game')))
        (W / 'run-post.json').write_text(json.dumps(rec))
        out = subprocess.run(['node', str(CJREPO / 'scripts' / 'check-run.mjs'), str(W / 'run-post.json'), str(CJ / 'index.html')], capture_output=True, text=True)
        check('...and its moves replay to its score (scripts/check-run.mjs)', out.returncode == 0 and 'checks out' in out.stdout, out.stdout + out.stderr)
        print('   ', out.stdout.strip().replace('\n', ' / '), flush=True)
        uri = f"at://{T}/{RUN}/{runs(T)[-1]['body']['rkey']}"
        check('the game: "Saved to @thunderbird.cafe\'s account ✓" and See it', wait_for(lambda: save_status(A).startswith(f"Saved to @{T_H}'s account ✓") and 'See it' in save_status(A), 5), save_status(A))
        A.screenshot(path=str(OUT / 'post-save-saved.png'))
        A.click('.rk-dialog button:text-is("Close")')
        check('Close: the prompt goes and the keys go back to the post (its ring)', wait_for(lambda: not A.is_visible('.rk-dialog')
              and A.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")')
              and A.eval_on_selector(f'{CJP} .tp-slot', 's => s.classList.contains("keys")'), 5))
        game(A).click('#seeIt')
        check('See it: Raku\'s "Open in" message for that record, naming the game', wait_for(lambda: A.is_visible('.link-msg') and uri in A.inner_text('.link-msg')
              and '"Cosmic Junkyard" asked to open' in A.inner_text('.link-msg'), 5), A.inner_text('.link-msg') if A.is_visible('.link-msg') else '')
        # PG7 with the game's own post: expanded, Full screen; a save leaves full screen for the prompt; Always; then the next
        # save in full screen goes without a prompt and full screen stays. (Saves sent as the game sends them.)
        A.keyboard.press('Escape'); wait_for(lambda: not A.is_visible('.link-msg'), 3)
        if A.is_visible('.link-msg'): A.click('.link-msg button:has-text("Close")')
        A.click(f'{CJP} .tp-expand'); wait_for(lambda: A.query_selector('.tp-x') is not None, 5)
        check('the game\'s own post, expanded, in Full screen', go_full(A))
        today = str(datetime.datetime.now(zoneinfo.ZoneInfo('America/Denver')).date())
        now = lambda: datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        before = len(runs(T))
        game(A).evaluate(TALK, [{'kind': 'write-record', 'id': 'fs1', 'action': 'create', 'collection': RUN, 'record': {'score': 12, 'day': today, 'playedAt': now()}}, 300])
        check('PG7: a save in full screen leaves full screen and shows the prompt over the expanded view',
              wait_for(lambda: full(A) is None and A.is_visible('.rk-dialog') and topmost_at_post(A) == 'dialog', 5) and A.query_selector('.tp-x') is not None, str(full(A)))
        A.click('.rk-dialog button:text-is("Always")')
        check('...Always: saved', wait_for(lambda: len(runs(T)) == before + 1 and 'Saved to' in A.inner_text('.rk-dialog'), 8))
        A.click('.rk-dialog button:text-is("Close")')
        check('Full screen again', go_full(A))
        game(A).evaluate(TALK, [{'kind': 'write-record', 'id': 'fs2', 'action': 'create', 'collection': RUN, 'record': {'score': 13, 'day': today, 'playedAt': now()}}, 1500])
        check('...the next save, with Always: no prompt, saved, still in full screen', wait_for(lambda: len(runs(T)) == before + 2, 8)
              and not A.is_visible('.rk-dialog') and full(A) and 'tp-slot' in full(A), str(full(A)))
        A.evaluate('() => document.exitFullscreen()')
        check('no errors on the page (a run saved from a post)', not errsA, str(errsA))

        # B: expanded: the prompt over the expanded view; No; again, then Stop mid-prompt
        saved_b = len(runs(T))
        game(B).click('#saveBtn')
        check('expanded: the prompt opens over the expanded view', wait_for(lambda: B.is_visible('.rk-dialog'), 5) and topmost_at_post(B) == 'dialog'
              and B.evaluate('''() => { const e = document.elementFromPoint(640, 30); return !!(e && e.closest('.rk-dialog')); }'''), topmost_at_post(B))
        B.screenshot(path=str(OUT / 'post-save-expanded.png'))
        B.click('.rk-dialog button:text-is("No")')
        check('No: "Not saved." and nothing written', wait_for(lambda: save_status(B) == 'Not saved.', 5) and len(runs(T)) == saved_b, save_status(B))
        check('...the keys back to the post', wait_for(lambda: B.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")'), 3))
        game(B).click('#saveBtn')
        wait_for(lambda: B.is_visible('.rk-dialog'), 5)
        B.evaluate('''() => document.querySelector('.tile-post .tp-stop').click()''')      # (as Autoplay or the × would)
        check('Stop mid-prompt: the post stops, the prompt closes, nothing saved', wait_for(lambda: not B.is_visible('.rk-dialog') and not B.query_selector('iframe.tp-frame'), 5)
              and len(runs(T)) == saved_b)
        check('no errors on the page (the way post)', not errsB, str(errsB))
        b.close()
finally:
    servers.terminate(); replica.terminate()

bad = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed', flush=True)
sys.exit(1 if bad else 0)
