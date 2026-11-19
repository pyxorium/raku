# Sprite games in a browser (claude/raku-sprite-games-plan.md, SG1 to SG8): the real Cosmic Junkyard page (its
# published index.html and sprite.png, copied from C:\thunderbird-cafe\cosmic-junkyard-tile\tile) runs through a replica
# of the tile loading server, with stand-ins for rpg.actor (its Compendium tile: getLatestCommit, the record, the
# catalog and a sprite) and an account server. Checked: signed out, Raku answers the hello with "ready" (the game's
# button shows) and the button opens the account menu saying why; signed in, the character arrives with the handle
# ("Playing as @…"), from the Compendium, answered without the Messages pill; the button then opens the menu to choose the
# account; turning "Show my character in games" off and on; switching to an account that isn't in the Compendium (its
# own record instead); a second game soon after reads nothing new from rpg.actor; the switch off: the button says so;
# the About page names rpg.actor; a tile that doesn't say the hello gets no answer.
#
# Usage: python3 test/browser/check_sprite_games.py <work folder> <tiles-loading-server folder> <cosmic-junkyard tile folder>
#   (needs Playwright with Chromium, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader and
#   rooms-lab, and port 80 free for the loader replica)
import base64, hashlib, io, json, os, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
from PIL import Image

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
CJ = Path(sys.argv[3]).resolve()
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
RPG = 'https://rpg.actor'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'        # in the Compendium
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'            # not in it: its own record
COMP = 'did:plc:kwgllf365cwmxbnxitx4pjdj'; COMP_RKEY = '3n2gvvgkkok2i'
TILE = 'ing.dasl.masl'
# the stand-in sign-ins' grant (as check_write.py's): "Raku" expanded
FULL = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post&collection=cafe.thunderbird.tile.like rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*'

def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs = {}       # (did, cid) -> bytes
def blob(did, data, ctype='application/octet-stream'):
    c = raw_cid(data); blobs[(did, c)] = data
    return {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}
def res(did, data, ctype): return {'src': blob(did, data, ctype), 'content-type': ctype}

def sheet(colour):
    im = Image.new('RGBA', (144, 192), (0, 0, 0, 0))
    for r in range(4):
        for c in range(3):
            for y in range(8, 44):
                for x in range(12, 36): im.putpixel((c * 48 + x, r * 48 + y), colour)
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

# ---- the tiles: the real Cosmic Junkyard, and a quiet tile ----
cj_res = {'/': res(T, (CJ / 'index.html').read_bytes(), 'text/html'), '/sprite.png': res(T, (CJ / 'sprite.png').read_bytes(), 'image/png')}
QUIET = b'<!doctype html><meta charset=utf-8><body style="font:20px sans-serif;padding:24px"><h1 id=h>A quiet tile</h1>'
quiet_res = {'/': res(T, QUIET, 'text/html')}
# ---- rpg.actor's Compendium: thunderbird.cafe in it (a red sheet), pyxorium.com not (its own record: a blue sheet) ----
RED = sheet((220, 40, 40, 255)); BLUE = sheet((40, 80, 220, 255))
red_cid = raw_cid(RED)
catalog = {'schema': 'rpg.actor.sprite-compendium/4', 'version': 'test', 'records': [
    {'did': T, 'handle': T_H, 'stale': False, 'sprite': {'cid': red_cid, 'geometry': {'columns': 3, 'rows': 4, 'frames': 12, 'frameWidth': 48, 'frameHeight': 48, 'width': 144, 'height': 192},
     'asset': {'cid': red_cid, 'path': 'sprites/red.png', 'contentType': 'image/png', 'bytes': len(RED), 'width': 144, 'height': 192}}}]}
CATALOG = json.dumps(catalog).encode()
comp_res = {'/catalog.json': res(COMP, CATALOG, 'application/json'), '/sprites/red.png': res(COMP, RED, 'image/png'), '/': res(COMP, b'<!doctype html>compendium', 'text/html')}
records = {   # (repo, collection, rkey) -> (cid, value)
    (T, TILE, '3cosmicjunkyard'): ('bafyreicosmicjunkyard', {'$type': TILE, 'tile': {'name': 'Cosmic Junkyard', 'resources': cj_res, 'sizing': {'width': 360, 'height': 530}}}),
    (T, TILE, '3quietgametest'): ('bafyreiquietgame', {'$type': TILE, 'tile': {'name': 'A quiet tile', 'resources': quiet_res}}),
    (COMP, TILE, COMP_RKEY): ('bafyreicompendium', {'$type': TILE, 'tile': {'name': 'rpg.actor Compendium', 'resources': comp_res}}),
    (P, 'actor.rpg.sprite', 'self'): ('bafyreiownsprite', {'$type': 'actor.rpg.sprite', 'spriteSheet': blob(P, BLUE, 'image/png'), 'width': 144, 'height': 192,
        'frameWidth': 48, 'frameHeight': 48, 'columns': 3, 'rows': 4}),
}
calls = []

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

HANDLES = {T: T_H, P: P_H, COMP: 'rpg.actor'}
def route(r):
    url = r.request.url
    calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        if did not in HANDLES: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES[did]}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': RPG if did == COMP else PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile') or u.path.endswith('getProfiles'): return js({'did': q.get('actor') or q.get('actors'), 'labels': []})
        return js({})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname in ('pds.fakepds.net', 'rpg.actor'):
        if u.path.endswith('getLatestCommit'): return js({'cid': 'bafyreicommit', 'rev': '3n2juc3idnk2c'})
        if u.path.endswith('getRecord'):
            key = (q.get('repo'), q.get('collection'), q.get('rkey'))
            got = records.get(key)
            if not got: return js({'error': 'RecordNotFound'}, 400)
            cid, value = got
            return js({'uri': f"at://{key[0]}/{key[1]}/{key[2]}", 'cid': cid, 'value': value})
        if u.path.endswith('getBlob'):
            bb = blobs.get((q.get('did'), q.get('cid')))
            if bb is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=bb)
        if u.path.endswith('listRecords'): return js({'records': []})
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
POKE = {'page': None}
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

def seed(accounts, off=()):
    acc = [{'did': d, 'handle': HANDLES[d]} for d in accounts]
    return (f"try {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-accounts', {json.dumps(json.dumps(acc))});"
            f" localStorage.setItem('raku-account', {json.dumps(json.dumps(accounts[0] if accounts else None))});"
            f" localStorage.setItem('standin-sessions', {json.dumps(json.dumps({d: {'scope': FULL} for d in accounts}))});"
            f" localStorage.setItem('raku-character-off', {json.dumps(json.dumps(list(off)))}); sessionStorage.setItem('seeded', '1'); }} }} catch {{}}")

CJ_URI = f'at://{T_H}/{TILE}/3cosmicjunkyard'
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
        HOSTS = ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://rpg.actor/**', 'https://lexicographer.space/**',
                 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']
        def new_page(script):
            ctx = b.new_context(viewport={'width': 1280, 'height': 860}, color_scheme='dark')
            for host in HOSTS: ctx.route(host, route)
            if script: ctx.add_init_script(script)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            POKE['page'] = page
            return ctx, page, errs
        def game(page):
            for f in page.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url:
                    if f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def cj_status(page): f = game(page); return f.inner_text('#status') if f else None
        def cj_button(page):
            f = game(page)
            return f.evaluate('() => { const b = document.getElementById("spriteBtn"); return { shown: getComputedStyle(b).display !== "none", text: b.textContent }; }') if f else None
        def messages(page):
            page.evaluate("() => { const b = document.querySelector('.pane.front .panel-pill'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }")
            return page.eval_on_selector_all('.pane.front .panel-list li', 'ls => ls.map(l => l.textContent.replace(/^\\s*[\\d.]+\\s+/, ""))')
        def open_tile(page, uri):
            page.fill('.addr', uri); page.press('.addr', 'Enter')

        # ---- signed out: "ready", the game's button, the menu saying why (SG2) ----
        ctx, page, errs = new_page(seed([]))
        page.goto(RAKU + '?loader=' + LOADER); page.wait_for_selector('.addr')
        open_tile(page, CJ_URI)
        check('signed out: Raku answers the game\u2019s hello with "ready", so its button shows', wait_for(lambda: (cj_button(page) or {}).get('shown'), 25), str(cj_button(page)))
        check('...the game keeps its own sprite and resting line', cj_status(page) == '\u2190 \u2192 or tap the left / right half to move', str(cj_status(page)))
        check('...answered, not logged: no Messages pill over the game\u2019s button', not page.is_visible('.pane.front .panel-pill'))
        check('...nothing asked of rpg.actor while signed out', not any('rpg.actor' in c for c in calls))
        game(page).click('#spriteBtn')
        check('the button: Raku\u2019s account menu opens, saying why', wait_for(lambda: page.is_visible('.account-menu .acct-reason') and page.inner_text('.account-menu .acct-reason') == 'Sign in to play as your rpg.actor character.', 5),
              page.inner_text('.account-menu') if page.is_visible('.account-menu') else 'closed')
        check('...with the sign-in form in front (the handle box has the focus)', page.evaluate("() => document.activeElement?.classList.contains('signin-handle')"))
        check('...the game\u2019s "Search for your handle" line is gone at once ("cancelled")', wait_for(lambda: 'Search for your handle' not in (cj_status(page) or ''), 3), str(cj_status(page)))
        check('...the promise is the new one (SG5)', page.inner_text('.account-menu .rk-promise') == 'Signing in lets Raku save your match results and game runs, show you in rooms and game lounges, bring your rpg.actor character into games, post tiles from your accounts, and heart tile posts.')
        page.screenshot(path=str(OUT / 'sprite-signed-out-menu.png'))
        page.keyboard.press('Escape')
        check('closing the menu: the line goes with it', wait_for(lambda: not page.is_visible('.account-menu'), 3))
        check('no errors on the page (signed out)', not errs, str(errs))
        ctx.close()

        # ---- signed in (thunderbird.cafe, in the Compendium; pyxorium.com not) ----
        calls.clear()
        ctx, page, errs = new_page(seed([T, P]))
        page.goto(RAKU + '?loader=' + LOADER); page.wait_for_selector('.addr')
        open_tile(page, CJ_URI)
        check('signed in: the character arrives with the handle (SG8): "Playing as @thunderbird.cafe"', wait_for(lambda: cj_status(page) == f'Playing as @{T_H}', 25), str(cj_status(page)))
        check('...the game\u2019s button now offers another', (cj_button(page) or {}).get('text') == 'Load a different sprite', str(cj_button(page)))
        rpg = [c for c in calls if c.startswith(RPG)]
        kinds = [urlparse(c).path.split('.')[-1] for c in rpg]
        check('...read from rpg.actor: the change check, the record, the catalog, the picture (SG1, SG6)', kinds == ['getLatestCommit', 'getRecord', 'getBlob', 'getBlob'], str(kinds))
        check('...not from the player\u2019s own server', not any('actor.rpg.sprite' in c for c in calls))
        page.screenshot(path=str(OUT / 'sprite-playing.png'))
        # the drawn sheet is the red one Raku handed over (a pixel of the game's canvas)
        red = game(page).evaluate('''() => { const c = document.querySelector('canvas'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++; return n; }''')
        check('...and the game draws it (red pixels on its canvas)', red and red > 50, str(red))

        game(page).click('#spriteBtn')
        check('the button, signed in: the menu, to choose the account whose character plays (SG3)', wait_for(lambda: page.is_visible('.account-menu .acct-reason') and page.inner_text('.account-menu .acct-reason') == 'Choose the account whose rpg.actor character plays.', 5))
        check('...the switch is there, on (SG4)', page.get_attribute('.account-menu .acct-character .rk-switch', 'aria-checked') == 'true')
        check('...the game kept its character (the line back to "Playing as")', wait_for(lambda: cj_status(page) == f'Playing as @{T_H}', 3), str(cj_status(page)))
        page.screenshot(path=str(OUT / 'sprite-menu-accounts.png'))
        page.click('.account-menu .acct-character .rk-switch')
        check('turning the switch off: nothing taken back (the game keeps its character)', wait_for(lambda: page.get_attribute('.account-menu .acct-character .rk-switch', 'aria-checked') == 'false', 5) and cj_status(page) == f'Playing as @{T_H}', str(cj_status(page)))
        check('...kept for that account in the browser', page.evaluate("() => localStorage.getItem('raku-character-off')") == json.dumps([T]))
        before = len([c for c in calls if c.startswith(RPG)])
        sprite_gets = lambda: len([c for c in calls if c.startswith(RPG) and 'getBlob' in c and red_cid in c])
        n = sprite_gets()
        page.click('.account-menu .acct-character .rk-switch')
        check('turning it on again: the character fetched and sent again', wait_for(lambda: sprite_gets() > n and cj_status(page) == f'Playing as @{T_H}', 8), f'{sprite_gets()} {cj_status(page)}')
        check('...without reading the Compendium again (within 15 s: the picture only, from the files kept)',
              [urlparse(c).path.split('.')[-1] for c in calls if c.startswith(RPG)][before:] in ([], ['getBlob']), str(calls[-4:]))

        # switching accounts: pyxorium.com, not in the Compendium: its own record
        page.click(f'.account-menu .acct-row:has-text("@{P_H}")')
        check('switching to an account not in the Compendium: its own record\u2019s character', wait_for(lambda: cj_status(page) == f'Playing as @{P_H}', 15), str(cj_status(page)))
        check('...read from its own server', any('actor.rpg.sprite' in c and 'pds.fakepds.net' in c for c in calls))
        blue = game(page).evaluate('''() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 60) n++; return n; }''')
        check('...and the game draws it (blue pixels)', blue and blue > 50, str(blue))

        # a second game soon after: nothing new from rpg.actor
        page.keyboard.press('Escape')
        page.click('.newtab')
        page.click(f'.account-btn'); page.click(f'.account-menu .acct-row:has-text("@{T_H}")'); page.keyboard.press('Escape')
        before = [c for c in calls if c.startswith(RPG) and 'getBlob' not in c]
        open_tile(page, CJ_URI)
        check('a second game: its character too', wait_for(lambda: cj_status(page) == f'Playing as @{T_H}', 25), str(cj_status(page)))
        check('...without reading rpg.actor\u2019s record or catalog again', [c for c in calls if c.startswith(RPG) and 'getBlob' not in c] == before)

        # the switch off: the button says to turn it on
        page.click('.account-btn')
        page.click('.account-menu .acct-character .rk-switch'); page.keyboard.press('Escape')
        game(page).click('#spriteBtn')
        check('the switch off: the button opens the menu at the switch, saying why (SG4)', wait_for(lambda: page.is_visible('.account-menu .acct-reason') and page.inner_text('.account-menu .acct-reason').startswith('Turn on'), 5)
              and page.evaluate("() => document.activeElement?.closest('.acct-character') !== null"))
        page.screenshot(path=str(OUT / 'sprite-menu-switch.png'))
        page.click('.account-menu .acct-character .rk-switch')
        check('...turning it on there: the character arrives', wait_for(lambda: cj_status(page) == f'Playing as @{T_H}', 10), str(cj_status(page)))
        page.keyboard.press('Escape')

        # a tile that doesn't say the hello: no answer
        open_tile(page, f'at://{T_H}/{TILE}/3quietgametest')
        wait_for(lambda: game(page) and game(page).inner_text('#h') == 'A quiet tile', 20)
        time.sleep(1)
        check('a tile that doesn\u2019t ask: no answer, no Messages button', not page.is_visible('.pane.front .panel-pill'))

        # the About page
        page.fill('.addr', 'raku:about'); page.press('.addr', 'Enter')
        about = wait_for(lambda: page.inner_text('.pane.front .about'), 10) or ''
        check('the About page names rpg.actor, the switch kept in the browser, and what a game gets',
              'rpg.actor' in about and 'Compendium' in about and 'Show my character in games' in about and 'gets your rpg.actor character and handle' in about)
        check('no errors on the page (signed in)', not errs, str(errs))
        ctx.close()
        b.close()
finally:
    servers.terminate(); replica.terminate()

bad = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed', flush=True)
sys.exit(1 if bad else 0)
