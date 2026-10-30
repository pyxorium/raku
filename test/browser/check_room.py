# Rooms in Raku, step 1 (claude/raku-rooms-plan.md, RR1 to RR10): a room as a Raku tab, and the mixed room
# (RR3): Raku pages and the rooms lab's own page in one room, through the lab's real relay.
#
# Separate browser contexts stand for separate computers (separate storage), with a fake microphone and screen.
#   - Raku's page (servers.mjs, port 5180, with its page policy) bundled with the stand-in sign-in library
#     (oauth-standin.js) and rooms-lab from node_modules (the package Raku pins); tiles run through the loader
#     replica (port 80) with the real loading server's files, the house tile pinned by its record CID;
#   - the rooms lab's own dev page and its real relay (room-servers.mjs: dev/serve.mjs, relay/server.js, the
#     relay's own sign-in check around a stand-in verifyJwt), which lets Raku's page in;
#   - stand-ins for plc.directory, Bluesky's public API, the account server (the house's and a test tile's
#     records and files; the sign-in's passes, refusing any other audience or method), the hide list.
#
# Usage: python3 test/browser/check_room.py <work folder> [--rooms-lab <rooms-lab folder>]
#        [--loader <tiles-loading-server folder>] [--modules <folder holding node_modules>]
# It bundles, starts the servers and stops them at the end. WebRTC between pages in one sandbox connects
# locally: the owner's two-computer test (one computer on the lab page, one in Raku) is the real proof.
import base64, hashlib, json, os, re, signal, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote, quote
from playwright.sync_api import sync_playwright

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

W = Path(sys.argv[1]); W.mkdir(parents=True, exist_ok=True)
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU_DIR = Path(__file__).resolve().parents[2]
LAB_DIR = Path(arg('--rooms-lab', str(RAKU_DIR / 'node_modules/rooms-lab')))
LOADER_DIR = Path(arg('--loader', '/mnt/user-data/uploads/tiles-loading-server'))
MODULES = Path(arg('--modules', str(RAKU_DIR)))
ESBUILD = arg('--esbuild', '/opt/npm-tools/node_modules/.bin/esbuild')
RELAY = 'ws://127.0.0.1:8899/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
RAKU = f"http://127.0.0.1:5180/?loader={LOADER}&roomsRelay={quote(RELAY, safe='')}"
LAB = f"http://127.0.0.1:5190/?relay={quote(RELAY, safe='')}"
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
C = 'did:plc:joer5rzmwgec3dkr4srfmq45'; C_HANDLE = 'thunderbirdwine.bsky.social'
T = 'did:plc:tttttttttttttttttttttttt'; T_HANDLE = 'tiles.test'
HANDLES = {A: A_HANDLE, C: C_HANDLE, T: T_HANDLE}
ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required']

def node_json(code):
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True, cwd=RAKU_DIR, env={**os.environ, 'NODE_PATH': str(MODULES / 'node_modules')}).stdout)
ROOMS = node_json(f"import('{RAKU_DIR}/src/config.js').then(m => process.stdout.write(JSON.stringify(m.ROOMS)))")

# ---------- the stand-in network ----------
def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs, records, record_cids = {}, {}, {}
TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png'}
def tile_record(name, files, sizing=None, csp=None):
    res = {}
    for path, (data, ctype) in files.items():
        c = raw_cid(data); blobs[c] = data
        res[path] = {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}, 'content-type': ctype}
        if path == '/' and csp: res[path]['content-security-policy'] = csp
    t = {'name': name, 'description': '', 'resources': res}
    if sizing: t['sizing'] = sizing
    if '/banner.png' in files: t['screenshots'] = [{'src': '/banner.png', 'sizes': '1280x720'}]
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': t, 'createdAt': '2026-10-29T00:00:00Z'}
# The house, as rooms-lab publishes it (scripts/tiles.mjs), at its pinned address and record CID.
house_dir = LAB_DIR / 'tiles/house'
house_files = {('/' if f == 'index.html' else f'/{f}'): ((house_dir / f).read_bytes(), TYPES[Path(f).suffix]) for f in ['index.html', 'house.css', 'house.js', 'rules.js', 'talk.js', 'icon.png', 'banner.png']}
house_csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', house_files['/'][0].decode()).group(1)
hdid, _, hrkey = ROOMS['house']['uri'].replace('at://', '').split('/')
records[(hdid, hrkey)] = tile_record('Rooms lab house', house_files, {'width': 420, 'height': 240}, house_csp)
record_cids[(hdid, hrkey)] = ROOMS['house']['cid']
# A small tile to open for everyone: a counter.
COUNTER = b'<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;margin:12px;background:#fffdf7"><p>Counter</p><button id="b">0</button><script src="/c.js"></script>'
records[(T, 'counter1')] = tile_record('Counter', {'/': (COUNTER, 'text/html'), '/c.js': (b"document.getElementById('b').onclick=(e)=>{e.target.textContent=String(+e.target.textContent+1)}", 'text/javascript')}, {'width': 360, 'height': 200})
record_cids[(T, 'counter1')] = 'bafyrei' + 'q' * 52
COUNTER_URI = f'at://{T}/ing.dasl.masl/counter1'

passes = []          # every pass the stand-in account server handed out: (did, aud, lxm)
def b64(obj): return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
def route(r):
    u = urlparse(r.request.url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = unquote(u.path.strip('/'))
        if did not in HANDLES: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES[did]}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {h: d for d, h in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile'): return js({'did': q.get('actor'), 'labels': []})
        if u.path.endswith('getProfiles'): return js({'profiles': []})
        if u.path.endswith('getFeed'): return js({'feed': []})
        return js({})
    if u.hostname in ('typeahead.waow.tech',): return js({'actors': []})
    if u.hostname == 'lexicographer.space': return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('getServiceAuth'):
            did, scope = q.get('standin_did'), q.get('standin_scope', '')
            aud, lxm = q.get('aud'), q.get('lxm')
            # as a real account server: only what the sign-in's permissions allow
            if f'rpc:{lxm}?aud={aud.replace("#", "%23")}' not in scope.split(' '): return js({'error': 'ScopeMissingError'}, 403)
            passes.append((did, aud, lxm))
            tok = f"{b64({'typ': 'JWT', 'alg': 'none'})}.{b64({'iss': did, 'aud': aud, 'lxm': lxm, 'exp': int(q.get('exp')), 'jti': os.urandom(8).hex()})}.standin"
            return js({'token': tok})
        if u.path.endswith('getRecord'):
            key = (q.get('repo'), q.get('rkey'))
            rec = records.get(key)
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{q['repo']}/ing.dasl.masl/{q['rkey']}", 'cid': record_cids[key], 'value': rec})
        if u.path.endswith('listRecords'): return js({'records': []})
        if u.path.endswith('getBlob'):
            b = blobs.get(q.get('cid'))
            if b is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=b)
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
def wait_for(fn, timeout=15.0, step=0.15, pages=()):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        for pg in pages:
            try: pg.evaluate('1')        # keeps Playwright's routes answering while we wait
            except Exception: pass
        time.sleep(step)
    return None

# ---------- build and servers ----------
procs = []
def start():
    env = {**os.environ, 'NODE_PATH': f"{MODULES / 'node_modules'}:/opt/npm-tools/node_modules"}
    site = W / 'site' / 'assets'; site.mkdir(parents=True, exist_ok=True)
    subprocess.run([ESBUILD, str(RAKU_DIR / 'src/main.js'), '--bundle', '--format=esm', f'--alias:@atproto/oauth-client-browser={RAKU_DIR}/test/browser/oauth-standin.js',
                    '--define:__RAKU_BUILD__="test-1"', f'--outdir={site}', '--log-level=warning'], check=True, cwd=RAKU_DIR, env=env)
    procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/servers.mjs'), str(W), str(RAKU_DIR)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, env=env))
    procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/loader-replica.mjs'), str(LOADER_DIR), '80'], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, env=env))
    procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/room-servers.mjs'), str(LAB_DIR), '5190', '8899'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env))
    time.sleep(1.5)

CSP_WATCH = "window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"
LAB_TILE_HOST = """window.__roomsLabTileHost = { async render({ loader }) { const r = await loader.resolvePath('/'); const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); if (r.ok) f.srcdoc = new TextDecoder().decode(r.body); return f; } };"""
def computer(b, name, viewport=None):
    ctx = b.new_context(viewport=viewport or {'width': 1280, 'height': 900}, permissions=['microphone'])
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
        ctx.route(host, route)
    ctx.add_init_script(CSP_WATCH)
    ctx.add_init_script(LAB_TILE_HOST)
    pg = ctx.new_page()
    pg._name = name
    pg._errors = []
    pg.on('pageerror', lambda e: pg._errors.append(str(e)))
    pg.on('console', lambda m: pg._errors.append(m.text) if m.type == 'error' and 'data.js' not in m.text and 'Failed to load resource' not in m.text else None)
    return ctx, pg

ROOM = "(() => { const e = [...__raku.rooms.entries.values()].find((x) => x.api && x.api.room); return e ? e.api.room : null; })()"
def rroom(pg, expr):            # something about Raku's room (r: the room object)
    return pg.evaluate(f"(() => {{ const r = {ROOM}; return r ? ({expr}) : null; }})()")
def lroom(pg, expr):            # the same on the lab page
    return pg.evaluate(f"(() => {{ const r = window.__roomsLab && __roomsLab.room; return r ? ({expr}) : null; }})()")
FRONT = '.pane.front'
def people(pg, lab=False):
    sel = '.rl-person .rl-who' if lab else f'{FRONT} .rl-person .rl-who'
    return sorted(t.strip() for t in pg.locator(sel).all_inner_texts())
def joined(pg, lab=False):
    return (lroom if lab else rroom)(pg, 'r.link.joined') is True
def hears(pg, lab, from_name):
    expr = """(async (who) => { const r = %s; const peer = [...r.people.values()].find((x) => (x.verified ? '@' + x.name : x.name) === who)?.peer;
      const pc = r.mesh.connection(peer); if (!pc) return -1; let n = 0; (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'audio') n += s.bytesReceived || 0; }); return n; })""" % ('window.__roomsLab.room' if lab else ROOM)
    a = pg.evaluate(expr, from_name); time.sleep(1.2); b2 = pg.evaluate(expr, from_name)
    return a >= 0 and b2 > a
def txt(pg, sel):
    loc = pg.locator(sel)
    try: return loc.first.inner_text(timeout=3000) if loc.count() else ''
    except Exception: return ''
def hash_of(pg): return pg.evaluate('location.hash')
def csp(pg): return pg.evaluate('window.__csp || []')
def no_scroll(pg): return pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        ca, a = computer(b, 'Nick (Raku, signed in)')
        cl, lab = computer(b, 'Robin (lab page)')
        ct, t = computer(b, 'Ted (Raku, typed name)')

        # ---- the first screen (FS1, RR5) ----
        a.goto(RAKU)
        wait_for(lambda: a.is_visible('.first h2:has-text("Tables and rooms")'), 15, pages=[a])
        check('first screen: the shorter line (FS1)', txt(a, '.first .lede') == "A browser for web tiles. Paste a tile's address or someone's handle above, or start with one of these.", txt(a, '.first .lede'))
        check('first screen: "Tables and rooms" and its line (RR5)', a.locator('.first h2:has-text("Tables and rooms") + .small-lede').inner_text() == 'Groups of tiles that play together, and rooms for meeting up.')
        card = a.locator('.first .rooms-card')
        check('the Rooms card, after the tables', card.count() == 1 and card.locator('.card-title').inner_text() == 'Rooms' and card.locator('.card-desc').inner_text() == 'Voice, one shared screen, and tiles opened for everyone. For small meetups among friends.')
        check('the Rooms card shows the house tile’s banner', wait_for(lambda: a.evaluate("!!document.querySelector('.rooms-card .card-pic img, .rooms-card .card-pic[style*=\"background\"]') || getComputedStyle(document.querySelector('.rooms-card .card-pic')).backgroundImage !== 'none'"), 10, pages=[a]))

        # ---- signing in to Raku first (the account menu), Play Daisy style: no Rooms yet ----
        a.evaluate("localStorage.setItem('standin-sessions', JSON.stringify({ 'did:plc:6vxjigxrqizmbo56gojxico3': { scope: 'atproto repo:cafe.thunderbird.daisy.match' } })); localStorage.setItem('raku-accounts', JSON.stringify([{ did: 'did:plc:6vxjigxrqizmbo56gojxico3', handle: 'thunderbird.cafe' }])); localStorage.setItem('raku-account', JSON.stringify('did:plc:6vxjigxrqizmbo56gojxico3'));")
        a.goto(RAKU)
        wait_for(lambda: a.is_visible('.first .rooms-card'), 15, pages=[a])
        card = a.locator('.first .rooms-card')
        card.locator('.card-main').click()
        wait_for(lambda: a.is_visible(f'{FRONT} .rk-room-join'), 10, pages=[a])
        check('the Rooms card opens a room tab: "Room", raku:room in the address box', txt(a, '.tab.on .tab-title') == 'Room' and a.input_value('.addr') == 'raku:room', f"{txt(a, '.tab.on .tab-title')} {a.input_value('.addr')}")
        check("…and Raku's address holds only raku:room", hash_of(a) == '#t=raku%3Aroom&a=0', hash_of(a))
        check('signed in: "Join as @thunderbird.cafe ✓" and "or type a name instead" (RR4)', txt(a, f'{FRONT} .rl-appear-as') == 'Join as@thunderbird.cafe ✓' or re.sub(r'\s+', ' ', txt(a, f'{FRONT} .rl-appear-as')) == 'Join as @thunderbird.cafe ✓', txt(a, f'{FRONT} .rl-appear-as'))
        check('…"or type a name instead"', a.is_visible(f'{FRONT} .rk-type-instead'))
        check('…and the one-time "Rooms" permission is explained', 'one more permission, “Rooms”' in txt(a, f'{FRONT} .rk-room-join'))
        check('the join screen: New room, and a box for an invite', a.is_visible(f'{FRONT} button:has-text("New room")') and a.is_visible(f'{FRONT} .rk-invite-box'))
        check('the star keeps Rooms (the house tile)', a.is_visible('.star-btn'))
        a.screenshot(path=str(OUT / 'room-join-signed-in.png'))

        # ---- New room: the "Rooms" window first, then in as host with a checked handle ----
        a.click(f'{FRONT} button:has-text("New room")')
        wait_for(lambda: 'Press the button again' in txt(a, f'{FRONT} .rk-room-join'), 15, pages=[a])
        calls = a.evaluate("JSON.parse(localStorage.getItem('standin-calls') || '[]')")
        popup = [c for c in calls if c.get('kind') == 'popup']
        check('the first join asks for "Rooms" in a small window, keeping Play Daisy', popup and popup[-1]['scope'] == f"atproto include:cafe.thunderbird.daisy.authPlay {ROOMS['scope']}", popup[-1]['scope'] if popup else calls)
        check('…then says to press again (the sound starts from a click)', '“Rooms” approved. Press the button again to go in.' in txt(a, f'{FRONT} .rk-room-join'))
        a.click(f'{FRONT} button:has-text("New room")')
        check('Nick is in, as host', wait_for(lambda: rroom(a, 'r.link.joined && r.host'), 15, pages=[a]))
        check('…shown as @thunderbird.cafe ✓ (the relay checked the pass)', wait_for(lambda: people(a) == ['@thunderbird.cafe ✓'], 10, pages=[a]), people(a))
        check('the pass was for the rooms relay and for joining only', passes and passes[-1] == (A, 'did:web:relay.rooms.thunderbird.cafe#rooms_relay', 'cafe.thunderbird.rooms.join'), passes)
        code = rroom(a, 'r.code')
        invite = a.input_value(f'{FRONT} .rl-invite')
        check("the invite link is Raku's own (#r=…, no host key; on this computer the test switches go along)", re.fullmatch(r'http://127\.0\.0\.1:5180/\?roomsRelay=[^#&]+&loader=[^#&]+#r=' + code, invite or '') is not None and '&k=' not in invite, invite)
        check("Raku's address still holds only raku:room (no code)", hash_of(a) == '#t=raku%3Aroom&a=0' and code not in a.url, a.url)
        check('the room is kept in this tab only (sessionStorage), not localStorage', json.loads(a.evaluate("sessionStorage.getItem('raku-room')") or 'null', ).get('code') == code and code not in json.dumps(a.evaluate('Object.assign({}, localStorage)')))
        check('no lab heading or footer in Raku', a.locator(f'{FRONT} .rl-top').count() == 0 and a.locator(f'{FRONT} .rl-honest').count() == 0)
        check('the house runs on the host’s page through Raku’s loader (pinned)', wait_for(lambda: a.evaluate("document.querySelector('.pane.front .rl-house-line')?.dataset.house") == 'ready', 30, pages=[a]), a.evaluate("document.querySelector('.pane.front .rl-house-line')?.textContent"))
        check("…its frame on the loading server", a.evaluate("[...document.querySelectorAll('.pane.front .rl-house iframe')].some((f) => /tiles\\.lex\\.localhost/.test(f.src))"))

        # ---- the mixed room: Robin joins from the lab page ----
        lab_link = f"{LAB}#r={code}"
        lab.goto(lab_link)
        lab.fill('.rl-name', 'Robin')
        lab.click('button:has-text("Join room")')
        check('Robin (lab page) is in the same room', wait_for(lambda: joined(lab, True), 15, pages=[lab]))
        check("…Raku sees Robin (unverified), the lab page sees Nick's checked handle as host",
              wait_for(lambda: people(a) == ['@thunderbird.cafe ✓', 'Robin (unverified)'] and people(lab, True) == ['@thunderbird.cafe ✓', 'Robin (unverified)'], 15, pages=[a, lab]), f'{people(a)} {people(lab, True)}')
        check('…and the lab page marks him host', lab.locator('.rl-person:has(.rl-check) .rl-tag-host').count() == 1)
        check('the direct connection comes up between Raku and the lab page', wait_for(lambda: rroom(a, "[...r.conn.values()].includes('connected')") and lroom(lab, "[...r.conn.values()].includes('connected')"), 20, pages=[a, lab]))
        a.click(f'{FRONT} .rl-mic'); lab.click('.rl-mic')
        check('voice both ways: Raku hears Robin, the lab page hears Nick', wait_for(lambda: hears(a, False, 'Robin') and hears(lab, True, '@thunderbird.cafe'), 20, pages=[a, lab]))

        # ---- a tile opened for everyone from Raku: Raku's loader, the lab page's copy ----
        a.fill(f'{FRONT} .rl-tile-input', COUNTER_URI)
        a.click(f'{FRONT} .rl-tile-preview-go')
        tile_sel = f'{FRONT} .rl-tile[data-uri="{COUNTER_URI}"]'
        check('Nick previews the counter in Raku (through the loading server)', wait_for(lambda: a.evaluate(f"document.querySelector('{tile_sel}')?.dataset.state") == 'open', 30, pages=[a]))
        check("…the preview's frame is Raku's tile loader's", a.evaluate(f"/tiles\\.lex\\.localhost/.test(document.querySelector('{tile_sel} iframe')?.src || '')"))
        a.click(f'{tile_sel} .rl-tile-open')
        check('…opened for everyone: the lab page opens its own copy', wait_for(lambda: lab.evaluate(f"document.querySelector('.rl-tile[data-uri=\"{COUNTER_URI}\"]')?.dataset.state") == 'open', 20, pages=[a, lab]))
        check('…on the stage on both', wait_for(lambda: a.evaluate("document.querySelector('.pane.front .rl-stage')?.dataset.on") == 'tile' and lab.evaluate("document.querySelector('.rl-stage')?.dataset.on") == 'tile', 15, pages=[a, lab]))

        # ---- rooms step 3, Expand (claude/raku-rooms-step3.md): the room's stage fills Raku's tab area; Raku folds its
        # own rows away where agreed: the address row in the installed window (RR20), the top bar and toolbar on a phone (RR19) ----
        GEO = """(() => { const q = (s) => document.querySelector(s); const r = (el) => el ? el.getBoundingClientRect().toJSON() : null; const d = (s) => q(s) ? getComputedStyle(q(s)).display : null;
          return { stage: r(q('.stage')), room: r(q('.pane.front .rl-stage')), xbar: r(q('.pane.front .rl-xbar')), card: r(q('.pane.front .rl-tile-on-stage')),
            bar: d('.chrome > .bar'), strip: d('.strip-row'), chrome: d('.chrome'), toolbar: d('.toolbar'), html: document.documentElement.className,
            x: !!q('.pane.front .rl-room.rl-expanded') }; })()"""
        near = lambda u, v: abs(u - v) <= 1.5
        def fills(g, bottom_bar=False):
            if not (g['x'] and g['room'] and g['xbar']): return False
            st, rm, xb = g['stage'], g['room'], g['xbar']
            if bottom_bar: ok = near(rm['top'], st['top']) and near(rm['bottom'], xb['top']) and near(xb['bottom'], st['bottom'])
            else: ok = near(xb['top'], st['top']) and near(rm['top'], xb['bottom']) and near(rm['bottom'], st['bottom'])
            return ok and near(rm['left'], st['left']) and near(rm['width'], st['width']) and (g['card'] is None or (near(g['card']['top'], rm['top']) and near(g['card']['height'], rm['height'])))
        a.evaluate(f"document.querySelector('{tile_sel} iframe').dataset.mark = 'kept'")
        a.click(f'{tile_sel} .rl-tile-expand')
        check('Expand (step 3), in a browser tab: the stage fills Raku’s tab area under the room bar, the counter over it', wait_for(lambda: fills(a.evaluate(GEO)), 10, pages=[a]), json.dumps(a.evaluate(GEO))[:400])
        g = a.evaluate(GEO)
        check('…Raku’s top bar stays in a browser tab (its tabs live there, RR20)', g['bar'] != 'none' and g['strip'] != 'none' and 'room-expanded-app' not in g['html'], g['html'])
        check('…the same frame (nothing reloaded)', a.evaluate(f"document.querySelector('{tile_sel} iframe')?.dataset.mark") == 'kept')
        check('…only Nick’s own view: the lab page isn’t expanded (RR15)', lab.evaluate("!document.querySelector('.rl-room.rl-expanded')"))
        a.screenshot(path=str(OUT / 'expand-tab.png'))
        a.click(f'{FRONT} .rl-x-back')
        check('Back to the room: the stage back in the room', wait_for(lambda: not a.evaluate(GEO)['x'], 10, pages=[a]) and 'room-expanded' not in a.evaluate(GEO)['html'])
        # The installed window (headless Chromium can't be one: the display-mode answer stood in, as in check_app.py).
        a.evaluate("""(() => { const mm = window.matchMedia.bind(window); window.__mmReal = mm;
          window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); })()""")
        top_before = a.evaluate(GEO)['stage']['top']
        a.click(f'{tile_sel} .rl-tile-expand')
        check('installed window: the address row folds away, the tabs stay (RR20)', wait_for(lambda: a.evaluate(GEO)['bar'] == 'none' and fills(a.evaluate(GEO)), 10, pages=[a]) and a.evaluate(GEO)['strip'] != 'none', json.dumps(a.evaluate(GEO))[:400])
        check('…the stage grows into the address row’s place', a.evaluate(GEO)['stage']['top'] < top_before - 30, f"{top_before} → {a.evaluate(GEO)['stage']['top']}")
        a.screenshot(path=str(OUT / 'expand-installed.png'))
        room_tab = a.evaluate('__raku.tabs.active.id')
        a.evaluate("__raku.openNew('raku:about')")
        check('another tab in front: Raku’s address row comes back', wait_for(lambda: a.evaluate(GEO)['bar'] != 'none' and 'room-expanded' not in a.evaluate(GEO)['html'], 10, pages=[a]))
        check('…and the room carries on, still expanded in its tab', joined(a) and rroom(a, 'r.expanded') is True)
        about_tab = a.evaluate('__raku.tabs.active.id')
        a.evaluate(f"__raku.tabs.activate({json.dumps(room_tab)})")
        check('back to the room tab: the address row folds away again', wait_for(lambda: a.evaluate(GEO)['bar'] == 'none' and fills(a.evaluate(GEO)), 10, pages=[a]))
        a.evaluate(f"__raku.tabs.close({json.dumps(about_tab)})")
        a.set_viewport_size({'width': 390, 'height': 844})
        check('phone: Raku’s top bar and toolbar fold away, the stage fills the screen, the room bar at the bottom (RR19)',
              wait_for(lambda: (lambda g: g['chrome'] == 'none' and g['toolbar'] == 'none' and near(g['stage']['top'], 0) and near(g['stage']['bottom'], 844) and fills(g, bottom_bar=True))(a.evaluate(GEO)), 10, pages=[a]), json.dumps(a.evaluate(GEO))[:400])
        check('…no sideways scroll', no_scroll(a))
        a.screenshot(path=str(OUT / 'expand-phone.png'))
        a.click(f'{FRONT} .rl-x-back')
        check('…Back to the room: Raku’s bars come back', wait_for(lambda: (lambda g: g['chrome'] != 'none' and g['toolbar'] != 'none' and not g['x'])(a.evaluate(GEO)), 10, pages=[a]))
        a.set_viewport_size({'width': 1280, 'height': 900})
        a.evaluate("window.matchMedia = window.__mmReal")

        # ---- a screen from the lab page, on Raku's stage: the guest asks, the house on Raku's page sends it to the host ----
        lab.click('.rl-share')
        check("Robin (lab page) asks to present: the approval card on Nick's Raku page (the house's \"ask the host\")", wait_for(lambda: a.is_visible(f'{FRONT} .rl-approval button:has-text("Allow")'), 15, pages=[a, lab]))
        a.click(f'{FRONT} .rl-approval button:has-text("Allow")')
        wait_for(lambda: lab.is_visible('button:has-text("Choose what to share")'), 15, pages=[a, lab])
        check('…Nick allows; Robin gets "The host said you can present"', 'The host said you can present' in txt(lab, '.rl-prompt'))
        lab.click('button:has-text("Choose what to share")')
        check("Robin's screen (lab page) shows on Raku's stage", wait_for(lambda: a.evaluate("(() => { const v = document.querySelector('.pane.front .rl-video'); return v && !v.hidden && v.videoWidth > 0; })()"), 25, pages=[a, lab]))
        lab.click('.rl-share')          # Stop sharing

        # ---- Ted opens Raku from the invite link: the join screen, the code taken out of the address ----
        t.goto(invite)
        wait_for(lambda: t.is_visible(f'{FRONT} .rk-room-join'), 15, pages=[t])
        check("Ted's Raku opens a room tab from the invite: \"You're invited to a room. Room …\"", f'You’re invited to a room. Room {code}.' in txt(t, f'{FRONT} .rk-room-join'), txt(t, f'{FRONT} .rk-room-join')[:200])
        check("…and Raku takes the code out of its own address (RR2)", hash_of(t) == '#t=raku%3Aroom&a=0' and code not in t.url, t.url)
        check('signed out: "Sign in to show your handle", or a typed name', t.is_visible(f'{FRONT} button:has-text("Sign in to show your handle")') and t.is_visible(f'{FRONT} .rl-name'))
        t.fill(f'{FRONT} .rl-name', '@ted')
        check('a typed name can’t start with "@"', 'can’t start with “@”' in txt(t, f'{FRONT} .rl-appear-as') and t.is_disabled(f'{FRONT} button:has-text("Join room")'))
        t.fill(f'{FRONT} .rl-name', 'Ted')
        t.click(f'{FRONT} button:has-text("Join room")')
        check('Ted is in: three people on every page', wait_for(lambda: len(people(a)) == 3 and len(people(t)) == 3 and len(people(lab, True)) == 3, 20, pages=[a, t, lab]), f'{people(a)} {people(t)} {people(lab, True)}')
        check("Ted gets the tile that's open for everyone", wait_for(lambda: t.evaluate(f"document.querySelector('{tile_sel}')?.dataset.state") == 'open', 30, pages=[t]))
        check('Ted’s typed name is kept for next time (localStorage rooms-lab-name)', t.evaluate("localStorage.getItem('rooms-lab-name')") == 'Ted')

        # ---- while in a room, the room tab stays a room ----
        t.fill('.addr', COUNTER_URI); t.press('.addr', 'Enter')
        check('an address typed in the room tab opens in a new tab; the room carries on', wait_for(lambda: t.evaluate('__raku.tabs.list.length') == 2, 10, pages=[t]) and joined(t) and t.input_value('.addr') != 'raku:room')
        t.click('.tab:has-text("Room")')
        t.click('.nav-btn[title="Reload this tile"]')
        check('Reload in the room tab says to leave first, and the room carries on', 'Leave the room first' in txt(t, '.note') and joined(t), txt(t, '.note'))

        # ---- one room at a time (RR6) ----
        lab2_ctx, lab2 = computer(b, 'Zoe (lab page, another room)')
        lab2.goto(LAB); lab2.fill('.rl-name', 'Zoe'); lab2.click('button:has-text("New room")')
        wait_for(lambda: joined(lab2, True), 15, pages=[lab2])
        other = lab2.input_value('.rl-invite'); other_code = lroom(lab2, 'r.code')
        t.click('.tab:not(:has-text("Room"))')               # Ted is on his other tab
        t.fill('.addr', other); t.press('.addr', 'Enter')
        wait_for(lambda: t.is_visible('.rk-dialog'), 10, pages=[t])
        check('another room’s invite while in one: the current room’s tab comes to the front, and Raku asks',
              txt(t, '.tab.on .tab-title') == 'Room' and txt(t, '.rk-dialog .rk-leave-q') == "You're in a room with @thunderbird.cafe and Robin. Leave it and join this one?", txt(t, '.rk-dialog') if t.is_visible('.rk-dialog') else 'no dialog')
        t.click('.rk-dialog .rk-stay')
        check('Stay: still in the room', joined(t) and rroom(t, 'r.code') == code and t.locator('.rk-dialog').count() == 0)
        t.fill('.addr', other); t.press('.addr', 'Enter')
        wait_for(lambda: t.is_visible('.rk-dialog'), 10, pages=[t])
        t.click('.rk-dialog .rk-leave-join')
        check('Leave and join: the old room is hung up and its tab closed', wait_for(lambda: len(people(a)) == 2, 15, pages=[a, t]) and t.locator('.tab:has-text("Room")').count() == 1, people(a))
        check('…and a room tab with the lab-made room’s join screen (the lab page’s invite, RR3)', wait_for(lambda: f'Room {other_code}.' in txt(t, f'{FRONT} .rk-room-join'), 10, pages=[t]))
        t.click(f'{FRONT} button:has-text("Join room")')
        check('Ted joins Zoe’s room from Raku (made on the lab page)', wait_for(lambda: people(lab2, True) == ['Ted (unverified)', 'Zoe (unverified)'], 15, pages=[t, lab2]), people(lab2, True))
        check('…a lab-made room, its house on the lab host’s page: Raku’s guest sees the host', t.locator(f'{FRONT} .rl-person:has-text("Zoe") .rl-tag-host').count() == 1)

        # ---- a reload: one click to rejoin (RR10) ----
        a.reload()
        wait_for(lambda: a.is_visible(f'{FRONT} .rk-room-back'), 15, pages=[a])
        check('after a reload, the room tab says "You were in room … as its host. Rejoin?"', f'You were in room {code} as its host. Rejoin?' in txt(a, f'{FRONT} .rk-room-back'), txt(a, f'{FRONT} .rk-room-join')[:200] if a.locator(f'{FRONT} .rk-room-join').count() else 'nothing')
        check('…with the same way in ("Join as @thunderbird.cafe ✓")', '@thunderbird.cafe' in txt(a, f'{FRONT} .rk-room-back .rl-appear-as'))
        check('…and nothing rejoins without that click', not joined(a))
        a.click(f'{FRONT} .rk-rejoin')
        check('Rejoin: back in as host, Robin still there', wait_for(lambda: rroom(a, 'r.link.joined && r.host') and people(a) == ['@thunderbird.cafe ✓', 'Robin (unverified)'], 20, pages=[a, lab]), people(a))
        check("…the tile that was open for everyone comes back with the host's page", wait_for(lambda: a.evaluate(f"document.querySelector('{tile_sel}')?.dataset.state") == 'open', 30, pages=[a]))

        # ---- closing the room tab leaves the room ----
        t.click('.tab:has-text("Room") .tab-x')
        check('closing the room tab leaves the room (no question)', wait_for(lambda: people(lab2, True) == ['Zoe (unverified)'], 15, pages=[t, lab2]), people(lab2, True))
        check('…and forgets it (nothing kept to rejoin)', t.evaluate("sessionStorage.getItem('raku-room')") is None)

        # ---- the lab page hosts, Raku pastes its invite into the join screen ----
        t.locator('.first .rooms-card .card-main').click() if t.is_visible('.first .rooms-card') else t.evaluate("__raku.openNew('raku:room')")
        wait_for(lambda: t.is_visible(f'{FRONT} .rk-invite-box'), 10, pages=[t])
        t.fill(f'{FRONT} .rk-invite-box', 'https://example.com/#r=abcdefghjkmn')
        t.click(f'{FRONT} .rk-paste button')
        check('a link that isn’t an invite is refused', 'isn’t an invite link' in txt(t, f'{FRONT} .rk-room-join'))
        t.fill(f'{FRONT} .rk-invite-box', other)
        t.click(f'{FRONT} .rk-paste button')
        check("a pasted lab invite gives that room's join screen in the same tab", wait_for(lambda: f'Room {other_code}.' in txt(t, f'{FRONT} .rk-room-join'), 10, pages=[t]) and t.locator('.tab:has-text("Room")').count() == 1)

        # ---- the page policy, errors, the phone ----
        for pg in (a, t):
            check(f"{pg._name}: Raku's page policy refused nothing", csp(pg) == [], str(csp(pg)))
            # (the loading server's own policy names form-src, which browsers don't know: on the Later list, not Raku's)
            errs = [e for e in pg._errors if 'house tile' not in e and "directive 'form-src'" not in e]
            check(f'{pg._name}: no errors', not errs, str(errs[:3]))
        a.set_viewport_size({'width': 390, 'height': 844})
        time.sleep(0.5)
        check('phone width: the room tab has no sideways scroll', no_scroll(a))
        a.screenshot(path=str(OUT / 'room-phone.png'))
        a.set_viewport_size({'width': 1280, 'height': 900})
        a.screenshot(path=str(OUT / 'room-in.png'), full_page=False)

        # ---- a second room tab, joining while in a room: Raku asks over the room you're in (RR6) ----
        a.evaluate("__raku.openNew('raku:room')")
        wait_for(lambda: a.is_visible(f'{FRONT} .rk-room-join button:has-text("New room")'), 10, pages=[a])
        a.click(f'{FRONT} .rk-room-join button:has-text("New room")')
        wait_for(lambda: a.is_visible('.rk-dialog'), 10, pages=[a])
        check("joining from a second room tab: the room you're in comes to the front, and Raku asks",
              txt(a, '.rk-dialog .rk-leave-q') == "You're in a room with Robin. Leave it and join this one?" and a.evaluate('__raku.rooms.isLive(__raku.tabs.active.id)'), txt(a, '.rk-dialog'))
        a.click('.rk-dialog .rk-stay')
        check('…Stay: nothing changes', joined(a) and people(lab, True) == ['@thunderbird.cafe ✓', 'Robin (unverified)'])

        # ---- the About page ----
        a.evaluate("__raku.openNew('raku:about')")
        wait_for(lambda: a.is_visible(f'{FRONT} .about'), 10, pages=[a])
        about = txt(a, f'{FRONT} .about')
        check('About: rooms in "You don\'t need an account", "What stays", "Who Raku talks to" and the box',
              all(s in about for s in ['joining a room with a typed name', 'A room you’re in', 'The name you typed', 'The rooms relay (relay.rooms.thunderbird.cafe)', 'The people in your room', 'connection helpers', 'only when you unmute in a room']))
        check('the room is still on while another tab is in front', joined(a))
        # Closing the room tab while expanded (installed window): the room leaves and Raku's rows come back.
        room_tab = a.evaluate('[...__raku.rooms.entries.entries()].find(([, e]) => e.joined)[0]')
        a.evaluate(f"__raku.tabs.activate({json.dumps(room_tab)})")
        wait_for(lambda: a.is_visible(f'{tile_sel} .rl-tile-stage-on'), 10, pages=[a])
        a.click(f'{tile_sel} .rl-tile-stage-on')
        wait_for(lambda: a.is_visible(f'{tile_sel} .rl-tile-expand'), 10, pages=[a])
        a.evaluate("""(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); })()""")
        a.click(f'{tile_sel} .rl-tile-expand')
        wait_for(lambda: a.evaluate("document.documentElement.classList.contains('room-expanded-app')"), 10, pages=[a])
        a.evaluate(f"__raku.tabs.close({json.dumps(room_tab)})")
        check('closing the room tab while expanded: the room is left and Raku’s address row comes back', wait_for(lambda: not joined(a) and 'room-expanded' not in a.evaluate('document.documentElement.className') and a.evaluate("getComputedStyle(document.querySelector('.chrome > .bar')).display") != 'none', 10, pages=[a, lab]))
        b.close()

try:
    start()
    run()
finally:
    for pr in procs:
        try: pr.send_signal(signal.SIGTERM)
        except Exception: pass
    time.sleep(0.3)
    for pr in procs:
        try: pr.kill()
        except Exception: pass
passed = sum(1 for _, ok in results if ok)
print(f'\n{passed}/{len(results)} checks passed')
sys.exit(0 if passed == len(results) and results else 1)
