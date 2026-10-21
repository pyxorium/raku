# Raku stage 5 browser checks: Daisy across two computers (run in the chat sandbox, like check_page.py).
# Two (or three) separate browser contexts stand for separate computers (separate storage). Raku's page is
# bundled with the stand-in sign-in library (oauth-standin.js); the tables' tiles are the site's memory
# copies under the pinned addresses (as check_page.py); the houses talk through Daisy's own stand-in relay
# (daisy-tiles scripts/relay-standin.mjs, the same seat rules as the live relay: relay/tables.js). The site's
# Daisy page is bundled too (with a stand-in sign-in, as daisy-tiles' own checks do), to play a match
# between Raku and the Daisy page: one shared pool of tables (Q44).
#
# Usage: python3 test/browser/check_daisy.py <work folder> [--site <site src folder>] [--tiles <daisy-tiles folder>]
#        [--loader <tiles-loading-server folder>] [--modules <folder holding node_modules/@dasl/tile-loader>]
# It bundles, starts the servers (servers.mjs, the loader replica on port 80, the stand-in relay on 8787 and
# the Daisy page on 4321) and stops them at the end.
import base64, hashlib, json, os, re, signal, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

W = Path(sys.argv[1]); W.mkdir(parents=True, exist_ok=True)
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU_DIR = Path(__file__).resolve().parents[2]
SITE_SRC = Path(arg('--site', '/mnt/user-data/uploads/pyxorium.github.io/src'))
TILES_DIR = Path(arg('--tiles', '/mnt/user-data/uploads/daisy-tiles'))
LOADER_DIR = Path(arg('--loader', '/mnt/user-data/uploads/tiles-loading-server'))
MODULES = Path(arg('--modules', str(RAKU_DIR)))
ESBUILD = arg('--esbuild', '/opt/npm-tools/node_modules/.bin/esbuild')
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
DAISY_PAGE = 'http://127.0.0.1:4321/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
C = 'did:plc:joer5rzmwgec3dkr4srfmq45'; C_HANDLE = 'thunderbirdwine.bsky.social'
D = 'did:plc:ro563p5faldqu44apudq44k4'; D_HANDLE = 'colorado.atprotocol.space'
BOT_DID = 'did:plc:hd2efebmfhpqcusfya4lguce'
HANDLES = {A: A_HANDLE, C: C_HANDLE, D: D_HANDLE, BOT_DID: 'dicesprite.thunderbird.cafe'}

def node_json(code, *args):
    return json.loads(subprocess.run(['node', '-e', code, *args], capture_output=True, text=True, check=True).stdout)
PINS = node_json(f"import('{RAKU_DIR}/src/config.js').then(m => process.stdout.write(JSON.stringify(m.TABLES)))")

# ---------- build ----------
procs = []
def bundle():
    env = {**os.environ, 'NODE_PATH': str(MODULES / 'node_modules')}
    site = W / 'site' / 'assets'; site.mkdir(parents=True, exist_ok=True)
    subprocess.run([ESBUILD, str(RAKU_DIR / 'src/main.js'), '--bundle', '--format=esm', f'--alias:@atproto/oauth-client-browser={RAKU_DIR}/test/browser/oauth-standin.js',
                    f'--outdir={site}', '--log-level=warning'], check=True, cwd=RAKU_DIR, env=env)
    # The Daisy page (the site's src/daisy/), with a stand-in sign-in: COPY of the stand-in in daisy-tiles'
    # test/check_page.py (FAKE_LIB), trimmed to what sitting and saving use.
    dp = W / 'daisy-page'; dp.mkdir(exist_ok=True)
    (dp / 'fake-oauth.js').write_text(FAKE_LIB.replace('%(HANDLES)s', json.dumps({A_HANDLE: A, C_HANDLE: C, D_HANDLE: D})))
    daisy = SITE_SRC / 'daisy'
    (dp / 'entry.js').write_text(
        "import { TileMothership, Tile } from '@dasl/tile-loader';\n"
        "import { MemoryTileLoader } from '@dasl/tile-loader/memory';\n"
        "import { BrowserOAuthClient, LoginContinuedInParentWindowError } from './fake-oauth.js';\n"
        f"import {{ createAuth }} from {json.dumps(str(daisy / 'auth.js'))};\n"
        f"import {{ mountTable }} from {json.dumps(str(daisy / 'table.js'))};\n"
        "const auth = createAuth({ BrowserOAuthClient, LoginContinuedInParentWindowError });\n"
        "auth.start().then((started) => { window.__daisy = mountTable(document.getElementById('daisy'), { TileMothership, MemoryTileLoader, Tile, auth, authProblem: started.error || null }); });\n")
    subprocess.run([ESBUILD, str(dp / 'entry.js'), '--bundle', '--format=esm', f'--outfile={dp}/index.js', '--log-level=warning'], check=True, env=env)
    (dp / 'daisy.css').write_text(''.join((daisy / f).read_text() for f in ('daisy-page.css', 'daisy.css')))
    (dp / 'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Daisy</title><link rel="icon" href="data:,">'
                                   '<link rel="stylesheet" href="daisy.css"></head><body><div id="daisy"></div><script type="module" src="index.js"></script></body></html>')

FAKE_LIB = r"""
const HANDLES = %(HANDLES)s;
class KeptSet extends Set {
  constructor() { super(JSON.parse(localStorage.getItem('fake-valid') || '[]')); }
  add(v) { super.add(v); localStorage.setItem('fake-valid', JSON.stringify([...this])); return this; }
  delete(v) { const r = super.delete(v); localStorage.setItem('fake-valid', JSON.stringify([...this])); return r; }
}
window.__fakeAuth = { valid: new KeptSet(), saved: [], signIns: [] };
const F = () => window.__fakeAuth;
const SCOPES = JSON.parse(localStorage.getItem('fake-scopes') || '{}');
const expand = (scope) => ['repo:cafe.thunderbird.daisy.match', 'atproto'].join(' ');
function session(did) {
  return {
    did, sub: did,
    async getTokenInfo() { return { sub: did, scope: expand(SCOPES[did]) }; },
    async fetchHandler(path, init = {}) {
      const body = JSON.parse(init.body);
      F().saved.push({ did, path, ...body });
      return new Response(JSON.stringify({ uri: `at://${did}/${body.collection}/${body.rkey}`, cid: 'bafyfakecid' }), { status: 200 });
    },
  };
}
export class LoginContinuedInParentWindowError extends Error {}
export class BrowserOAuthClient {
  static async load(opts) { window.__fakeAuth.clientId = opts.clientId; return new BrowserOAuthClient(); }
  async init() {}
  addEventListener() {}
  async signInPopup(handle, { signal, popupName, scope } = {}) {
    await new Promise((r) => setTimeout(r, 300));
    try { const w = window.open('', popupName); if (w) w.close(); } catch {}
    const did = HANDLES[handle];
    SCOPES[did] = scope || ''; localStorage.setItem('fake-scopes', JSON.stringify(SCOPES));
    F().valid.add(did); F().signIns.push(handle);
    return session(did);
  }
  async restore(did) { if (!F().valid.has(did)) throw new Error('no session'); return session(did); }
  async revoke(did) { F().valid.delete(did); }
}
"""

# ---------- the stand-in network (as check_signin.py) ----------
def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs, records, pin_cids = {}, {}, {}
for game in ['sevenup', 'daisy']:
    tiles = node_json(f"import('{SITE_SRC}/{game}/tiles.generated.js').then(m => process.stdout.write(JSON.stringify(m.TILES)))")
    for role in ['house', 'player']:
        t = tiles[role]; resources = {}
        for path, r in t['resources'].items():
            data = r['src'].encode(); c = raw_cid(data); blobs[c] = data
            resources[path] = {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': r['content-type'], 'size': len(data)}, 'content-type': r['content-type']}
        did, _, rkey = PINS[game][role]['uri'].replace('at://', '').split('/')
        records[(did, rkey)] = {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': t['name'], 'description': t.get('description', ''), 'sizing': t.get('sizing'), 'resources': resources}}
        pin_cids[(did, rkey)] = PINS[game][role]['cid']

saved = {}
def route(r):
    u = urlparse(r.request.url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        from urllib.parse import unquote
        did = unquote(u.path.strip('/'))
        if did not in HANDLES: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES[did]}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {h: d for d, h in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile'): return js({'did': q.get('actor'), 'labels': []})
        if u.path.endswith('getProfiles'): return js({'profiles': []})
    if u.hostname == 'typeahead.waow.tech': return js({'actors': []})
    if u.hostname == 'cdn.bsky.app': return r.fulfill(status=404, headers=cors, body='')
    if u.hostname == 'lexicographer.space': return js({'version': 1, 'salt': 'x', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('putRecord'):
            body = json.loads(r.request.post_data or '{}')
            did, scope = q.get('standin_did'), q.get('standin_scope', '')
            if body.get('repo') != did: return js({'error': 'InvalidRequest'}, 400)
            if f"repo:{body.get('collection')}" not in scope.split(' '): return js({'error': 'ScopeMissingError'}, 403)
            saved[(did, body['collection'], body['rkey'])] = body['record']
            return js({'uri': f"at://{did}/{body['collection']}/{body['rkey']}", 'cid': 'bafyreisaved'})
        if u.path.endswith('getRecord'):
            rec = records.get((q.get('repo'), q.get('rkey')))
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{q['repo']}/ing.dasl.masl/{q['rkey']}", 'cid': pin_cids.get((q.get('repo'), q.get('rkey')), 'bafyreirecord'), 'value': rec})
        if u.path.endswith('listRecords'):
            col = q.get('collection')
            mine = [(k[2], v) for k, v in saved.items() if k[0] == q.get('repo') and k[1] == col]
            return js({'records': [{'uri': f"at://{q['repo']}/{col}/{k}", 'cid': 'bafy', 'value': v} for k, v in mine]})
        if u.path.endswith('getBlob'):
            b = blobs.get(q.get('cid'))
            if b is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=b)
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
def wait_for(fn, timeout=10.0, step=0.1, pages=()):
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

def start_relay():
    p = subprocess.Popen(['node', str(TILES_DIR / 'scripts/relay-standin.mjs'), '8787'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    return p

# ---------- helpers for Raku pages ----------
def computer(b, viewport=None):
    ctx = b.new_context(viewport=viewport or {'width': 1280, 'height': 900})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://typeahead.waow.tech/**']:
        ctx.route(host, route)
    pages = []
    ctx.on('page', lambda pg: pages.append(pg))
    pg = ctx.new_page()
    pg._console = []
    pg.on('console', lambda m: pg._console.append((m.type, m.text, (m.location or {}).get('url', ''))))
    pg.on('pageerror', lambda e: pg._console.append(('pageerror', str(e), RAKU)))
    pg._sent = []
    pg.on('websocket', lambda ws: ws.on('framesent', lambda f: pg._sent.append(f if isinstance(f, str) else f.get('payload') if isinstance(f, dict) else str(f))))
    pg._popups = pages
    return ctx, pg

def raku(pg, hash_=''):
    pg.goto(RAKU + '?loader=' + LOADER + hash_)
def mine(pg): return pg.frame_locator('.pane.front .seat-mine iframe').frame_locator('iframe')
def theirs(pg): return pg.frame_locator('.pane.front .seat-theirs iframe').frame_locator('iframe')
def drv(pg, expr): return pg.evaluate(f"(() => {{ const d = window.__raku && __raku.table && __raku.table.driver; return d ? {expr} : null; }})()")
def phase(pg): return drv(pg, 'd.phase')
def shared(pg): return drv(pg, 'JSON.stringify(d.snapshot && d.snapshot.shared)')
def status(pg): return pg.inner_text('.pane.front .table-status')
def joins(pg): return [json.loads(f) for f in pg._sent if isinstance(f, str) and '"type":"join"' in f]
def ready(pg, roles=('house', 'mine', 'theirs'), timeout=30):
    return wait_for(lambda: all(drv(pg, f"d.frames.status('{r}')") == 'ready' for r in roles), timeout)
def pick(pg, glaze, tile=mine):
    tile(pg).locator(f'.glaze[data-id="{glaze}"]:not([disabled])').click(timeout=15000)
def sign_in_dialog(pg, handle):
    dlg = '.pane.front .rk-dialog'
    wait_for(lambda: pg.is_visible(f'{dlg} .signin-handle'), 5)
    pg.fill(f'{dlg} .signin-handle', handle)
    pg.click(f'{dlg} .signin-form button.primary')
    return wait_for(lambda: not pg.is_visible(dlg), 10)

# ---------- helpers for the Daisy page ----------
def dz_tile(pg, role): return pg.frame_locator(f'.dz-{role} .dz-mount iframe').frame_locator('iframe')

def play(players, limit=500, bank_at=8):
    """players: [(page, mine-locator-fn, phase-fn, total-fn)]. Each rolls until its turn is worth bank_at, then banks."""
    for _ in range(limit):
        if all(ph(pg) == 'over' for pg, _, ph, _t in players): return True
        moved = False
        for pg, t, ph, tot in players:
            try:
                roll, bank = t(pg).locator('#roll'), t(pg).locator('#bank')
                if roll.is_visible() and roll.is_enabled():
                    (bank if (tot(pg) or 0) >= bank_at and bank.is_enabled() else roll).click(timeout=3000)
                    moved = True
                    pg.wait_for_timeout(250)
            except Exception:
                pass
        if not moved: players[0][0].wait_for_timeout(150)
    return False
RAKU_TOTAL = lambda pg: drv(pg, "(d.snapshot && d.snapshot.shared.play ? d.snapshot.shared.play.turnRolls.reduce((a,b)=>a+b,0) : 0)")
DZ_PHASE = lambda pg: pg.evaluate('window.__daisy.phase')
DZ_TOTAL = lambda pg: pg.evaluate("(() => { const s = window.__daisy.snapshot; return s && s.shared.play ? s.shared.play.turnRolls.reduce((a,b)=>a+b,0) : 0 })()")
RAKU_P = lambda pg: (pg, mine, phase, RAKU_TOTAL)

def verify(result):
    # Raku's copy of Daisy's verify.js (src/tables/daisy-shared/), the same as daisy-tiles/shared/verify.js
    code = f"import('{RAKU_DIR}/src/tables/daisy-shared/verify.js').then(m => process.stdout.write(JSON.stringify(m.verifyMatch(JSON.parse(process.argv[1])))))"
    return node_json(code, json.dumps(result))
def check_record(record):
    return node_json(f"import('{RAKU_DIR}/src/tables/daisy-record.js').then(m => process.stdout.write(JSON.stringify(m.checkRecord(JSON.parse(process.argv[1])))))", json.dumps(record))

# ---------- run ----------
bundle()
procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/servers.mjs'), str(W), str(RAKU_DIR)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT))
procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/loader-replica.mjs'), str(LOADER_DIR), '80'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT))
procs.append(subprocess.Popen([sys.executable, '-m', 'http.server', '4321', '--bind', '127.0.0.1', '--directory', str(W / 'daisy-page')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
relay = start_relay()
time.sleep(1.0)

try:
  with sync_playwright() as p:
    b = p.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    # ---------- 1. the start screen (signed out) ----------
    print('1. The start screen', flush=True)
    ca, a = computer(b)
    raku(a, '#t=raku%3Atable%2Fdaisy&a=0')
    ok = wait_for(lambda: a.inner_text('.pane.front .table-bar h1') == 'Daisy' and a.is_visible('.pane.front .daisy-open'), 10)
    check('raku:table/daisy shows the start screen: Play the bot and Open a table (Q47)', ok and a.is_visible('.pane.front .daisy-bot') and status(a) == 'Choose how to play')
    check('…no tiles load on the start screen', a.eval_on_selector_all('.pane.front iframe', 'fs => fs.length') == 0)
    check('…and the Lounge below the two cards (step 5b)', a.is_visible('.pane.front .daisy-lounge'))
    a.screenshot(path=str(OUT / 's5-start.png'))
    a.click('.pane.front .daisy-bot')
    ok = wait_for(lambda: a.input_value('.addr') == 'raku:table/daisy/bot', 5)
    check('Play the bot: no sign-in, the bot table at raku:table/daisy/bot', ok and wait_for(lambda: mine(a).locator('#glazes button').count() >= 6, 25) and len(a._popups) == 1)
    check('…Back returns to the start screen', (a.click('.nav-btn[title="Back"]') or True) and wait_for(lambda: a.input_value('.addr') == 'raku:table/daisy' and a.is_visible('.pane.front .daisy-open'), 5))

    # ---------- 2. Open a table: sign in first ----------
    print('2. Opening a table', flush=True)
    a.click('.pane.front .daisy-open')
    ok = wait_for(lambda: a.is_visible('.pane.front .rk-dialog') and 'Sign in to open a table' in a.inner_text('.pane.front .rk-dialog'), 5)
    check('Open a table signed out: Raku\'s sign-in dialog, saying why (a real, checked handle) and what it asks ("Play Daisy")', ok and 'checked handle' in a.inner_text('.pane.front .rk-dialog') and '"Play Daisy"' in a.inner_text('.pane.front .rk-dialog'))
    check('…the handle box first, why and what below it (Q55)', a.eval_on_selector('.pane.front .rk-dialog', "d => d.querySelector('.signin-handle').getBoundingClientRect().bottom < d.querySelector('.rk-details').getBoundingClientRect().top && d.querySelector('.rk-details').textContent.includes('checked handle')"))
    a.screenshot(path=str(OUT / 's5-open-signin.png'))
    sign_in_dialog(a, A_HANDLE)
    calls = a.evaluate("() => JSON.parse(localStorage.getItem('standin-calls') || '[]').filter(c => c.kind === 'popup')")
    check('…the sign-in asks for your account plus "Play Daisy" only', calls and calls[-1]['scope'] == 'atproto include:cafe.thunderbird.daisy.authPlay', str(calls[-1:]))
    ok = wait_for(lambda: re.match(r'^raku:table/daisy/[a-z0-9]{8,32}$', a.input_value('.addr')), 10)
    table_id = a.input_value('.addr').split('/')[-1] if ok else ''
    check('…then a new table in the tab: raku:table/daisy/<table id>', ok, a.input_value('.addr'))
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-invite'), 10)
    link = a.input_value('.pane.front .dz-link') if ok else ''
    check('…you sit at seat 1 and get the link to send: Raku\'s own address with this table\'s tab (Q45)', ok and link.startswith(RAKU + '?loader=') and parse_qs(urlparse(link).query)['loader'][0] == LOADER and link.endswith(f'#t=raku:table/daisy/{table_id}&a=0') and drv(a, 'd.me.seat') == 1, link)
    check('…the status says it\'s waiting for the other player', 'Waiting for the other player' in status(a))
    j = joins(a)
    check('the join is the Daisy page\'s own: the table, seat 1, the account, the pinned house\'s CID, fresh (Q44)',
          j and j[0] == {'type': 'join', 'table': table_id, 'seat': 1, 'did': A, 'handle': A_HANDLE, 'house': PINS['daisy']['house']['cid'], 'fresh': True}, str(j[:1]))
    check('three tiles load from the pinned tiles (your house, your seat, the watching copy)', ready(a))
    time.sleep(2)     # longer than the tiles' 1.5 s before they'd show their card pictures on their own
    check('seated: both tiles show the game, never their card pictures; no "Joining" box', mine(a).locator('#card').is_hidden() and theirs(a).locator('#card').is_hidden() and not a.is_visible('.pane.front .daisy-joining'))
    a.screenshot(path=str(OUT / 's5-waiting.png'))

    # ---------- 3. the friend opens the link ----------
    print('3. The friend takes a seat', flush=True)
    cb, bb = computer(b)
    bb.goto(link)
    ok = wait_for(lambda: bb.is_visible('.pane.front .daisy-lobby') and "You've been invited" in bb.inner_text('.pane.front .daisy-lobby'), 10)
    check('the link opens Raku at that table: "You\'ve been invited to a table of Daisy", Sign in to take a seat', ok and 'Sign in to take a seat' in bb.inner_text('.pane.front .daisy-lobby') and bb.eval_on_selector_all('.pane.front iframe', 'fs => fs.length') == 0)
    bb.screenshot(path=str(OUT / 's5-invited.png'))
    bb.click(".pane.front .daisy-lobby button:has-text('Sign in to take a seat')")
    check('…signing in takes you straight to the seat', sign_in_dialog(bb, C_HANDLE) and wait_for(lambda: drv(bb, 'd.me && d.me.seat') == 2, 10))
    jb = joins(bb)
    check('…the friend joins as "any" seat, fresh, with the same house', jb and jb[0]['seat'] == 'any' and jb[0]['did'] == C and jb[0]['house'] == PINS['daisy']['house']['cid'] and jb[0]['fresh'] is True, str(jb[:1]))
    ready(bb)
    ok = wait_for(lambda: 'Playing with @thunderbirdwine.bsky.social' in status(a) and 'Playing with @thunderbird.cafe' in status(bb), 10)
    check('both pages see each other ("Playing with @…"); the link box is gone', ok and not a.is_visible('.pane.front .daisy-invite'), f'{status(a)} | {status(bb)}')
    check('the seat lines name both players', '@thunderbirdwine.bsky.social' in a.inner_text('.pane.front .seat-theirs .seat-line') and 'seat 2' in a.inner_text('.pane.front .seat-theirs .seat-line'))
    pick(a, 'jade')
    ok = wait_for(lambda: mine(bb).locator('.glaze[data-id="jade"][disabled]').count() == 1, 10)
    check('a glaze taken on one computer greys out on the other', ok)
    pick(bb, 'marigold')
    ok = wait_for(lambda: phase(a) == 'playing' and phase(bb) == 'playing', 15)
    check('the coin: both houses agree who goes first', ok and wait_for(lambda: shared(a) == shared(bb), 8))
    a.screenshot(path=str(OUT / 's5-playing.png'))
    # a few moves, then a reload on B
    play([RAKU_P(a), RAKU_P(bb)], limit=8)
    match_id = drv(a, 'd.snapshot.shared.matchId')
    bb.reload()
    ok = wait_for(lambda: drv(bb, 'd.me && d.me.seat') == 2 and 'Playing with @thunderbird.cafe' in status(bb), 15)
    check('a reload mid-match comes back to the seat (this browser keeps it) and the same match', ok and drv(bb, 'd.snapshot && d.snapshot.shared.matchId') == match_id)
    jb2 = joins(bb)
    check('…rejoining with its seat (2), not fresh', jb2 and jb2[-1]['seat'] == 2 and jb2[-1]['fresh'] is False, str(jb2[-1:]))
    ready(bb)
    check('…and both houses still agree', wait_for(lambda: shared(a) == shared(bb), 10))
    # the relay restarts mid-match
    relay.send_signal(signal.SIGKILL); relay.wait()
    ok = wait_for(lambda: 'Lost the connection' in status(a), 8)
    check('the relay goes away: "Lost the connection to the table. Reconnecting…"', ok, status(a))
    relay = start_relay()
    ok = wait_for(lambda: 'Playing with' in status(a) and 'Playing with' in status(bb), 20)
    check('…it comes back by itself and the match goes on', ok and wait_for(lambda: shared(a) == shared(bb), 10))
    # the phone width on B
    bb.set_viewport_size({'width': 390, 'height': 800})
    order = bb.eval_on_selector_all('.pane.front .table-seat', 'ss => ss.map(s => [s.dataset.role, Math.round(s.getBoundingClientRect().top)])')
    check('phone width: stacked, your seat at the bottom; no sideways scroll', order and order[0][0] == 'mine' and order[0][1] > order[1][1] and bb.evaluate('() => document.documentElement.scrollWidth <= 390'), str(order))
    bb.screenshot(path=str(OUT / 's5-phone.png'))
    bb.set_viewport_size({'width': 1280, 'height': 900})
    over = play([RAKU_P(a), RAKU_P(bb)])
    check('a whole match on two computers plays to the end', over)
    ok = wait_for(lambda: shared(a) == shared(bb), 8)
    res_a = drv(a, 'd.result'); res_b = drv(bb, 'd.result')
    check('…both houses end identical, with the same result', ok and res_a and res_a == res_b)
    v = verify(res_a) if res_a else {'ok': False}
    check('…and the result re-checks (verifyMatch: the dice from both chains, the rules)', v.get('ok') is True, str(v)[:200])
    a.click('.pane.front .panel-btn')
    lines = a.eval_on_selector_all('.pane.front .panel-list li', 'ls => ls.map(l => l.textContent)')
    check('the message panel shows what goes to and comes from the other page through the relay', any('house → the other page' in l for l in lines) and any('the other page → house' in l for l in lines) and any('relay → Raku  joined' in l for l in lines), str(lines[:8]))
    a.click('.pane.front .panel-close')
    # saving: the sitting account, no "Use another account", anyone can re-check
    dlg = '.pane.front .rk-dialog'
    mine(a).locator('#save').click()
    ok = wait_for(lambda: a.is_visible(dlg) and 'Save this match to @thunderbird.cafe?' in a.inner_text(dlg), 8)
    text = a.inner_text(dlg) if ok else ''
    check('Save: Raku\'s prompt for the account sitting here; it mentions the other player; anyone can re-check the dice', ok and '@thunderbirdwine.bsky.social, who played the other seat' in text and 'Anyone can re-check the dice' in text and 'nobody else can check' not in text, text[:300])
    check('…and no "Use another account" (the seat belongs to @thunderbird.cafe)', 'Use another account' not in text and 'account sitting at this table' in text)
    a.screenshot(path=str(OUT / 's5-save.png'))
    a.click(f"{dlg} .actions button:has-text('Allow once')")
    ok = wait_for(lambda: (A, 'cafe.thunderbird.daisy.match', match_id) in saved, 10, pages=[a])
    rec = saved.get((A, 'cafe.thunderbird.daisy.match', match_id))
    check('…saved to @thunderbird.cafe with the match id as key; the record names both real players and the pinned house', ok and rec and [pl['did'] for pl in rec['players']] == ([A, C] if rec['seat'] == 1 else [C, A]) and rec['house'] == PINS['daisy']['house'] and not any(pl.get('bot') for pl in rec['players']))
    check("…and passes Daisy's own record check (the dice re-checked)", rec is not None and check_record(rec) is None)
    a.click(f"{dlg} .actions button:has-text('Close')")
    a.hover('.pane.front .daisy-home')
    hover_color = a.eval_on_selector('.pane.front .daisy-home', 'e => getComputedStyle(e).color')
    a.mouse.move(5, 600)
    rest_color = a.eval_on_selector('.pane.front .daisy-home', 'e => getComputedStyle(e).color')
    check('"Back to the start" answers the mouse (brighter on hover)', hover_color != rest_color, f'{rest_color} / {hover_color}')
    a.click('.pane.front .daisy-after')
    ok = wait_for(lambda: a.input_value('.addr') == 'raku:table/daisy' and a.is_visible('.pane.front .daisy-open'), 5)
    check('after the match "Back to the start" goes straight to the start screen; no match in progress there', ok and not a.is_visible('.pane.front .daisy-going'))
    check('…and the other page hears you left (its end screen says so)', wait_for(lambda: 'no longer at the table' in mine(bb).locator('#end-note').inner_text(), 10))

    # ---------- 3b. no relay to reach: "Joining the table…", then a hint (owner's test, Oct 21) ----------
    print('3b. No relay', flush=True)
    relay.send_signal(signal.SIGKILL); relay.wait()
    a.click('.pane.front .daisy-open')
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-joining') and 'Joining the table' in a.inner_text('.pane.front .daisy-joining'), 5)
    check('no relay: "Joining the table…" where the seats go; the seats (still loading) stay out of sight', ok and not a.is_visible('.pane.front .seat-mine iframe') and not a.is_visible('.pane.front .daisy-invite'))
    time.sleep(2.5)
    check('…so the tiles\' card pictures never show', not a.is_visible('.pane.front .seat-mine iframe'))
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-joining-hint'), 6)
    hint = a.inner_text('.pane.front .daisy-joining-hint') if ok else ''
    check('…after 5 s a hint: on this computer, start the stand-in relay (the folder and the command)', ok and 'node scripts/relay-standin.mjs' in hint and 'daisy-tiles' in hint and 'Still joining' in a.inner_text('.pane.front .daisy-joining'), hint)
    a.screenshot(path=str(OUT / 's5-no-relay.png'))
    relay = start_relay()
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-invite') and a.is_visible('.pane.front .seat-mine iframe') and not a.is_visible('.pane.front .daisy-joining'), 20)
    check('…the relay comes up: seated at 1, the seats and the link appear by themselves', ok and drv(a, 'd.me.seat') == 1)
    a.click('.pane.front .daisy-home')
    wait_for(lambda: a.is_visible('.pane.front .daisy-open'), 5)

    # ---------- 4. signed in: no window; the address box; full; held; leaving mid-match ----------
    print('4. Signed in, full, held, leaving and coming back', flush=True)
    n = len(a._popups)
    a.click('.pane.front .daisy-open')
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-invite'), 10)
    check('signed in with "Play Daisy": Open a table needs no window', ok and len(a._popups) == n and not a.is_visible('.pane.front .rk-dialog'))
    link2 = a.input_value('.pane.front .dz-link'); t2 = a.input_value('.addr').split('/')[-1]
    bb.click('.newtab')
    # (the live form of the link: on this computer the link starts http://127.0.0.1:5180/, which isn't Raku's address)
    bb.fill('.addr', f'https://raku.lexicographer.space/#t=raku:table/daisy/{t2}&a=0'); bb.press('.addr', 'Enter')
    ok = wait_for(lambda: bb.is_visible('.pane.front .daisy-lobby') and 'Take a seat as @thunderbirdwine.bsky.social' in bb.inner_text('.pane.front .daisy-lobby'), 10)
    check('a Raku table link pasted into the address box opens that table; signed in: "Take a seat as @…"', ok and bb.input_value('.addr') == f'raku:table/daisy/{t2}', f"{bb.input_value('.addr')} | {bb.inner_text('.pane.front')[:300]}")
    n = len(bb._popups)
    bb.click(".pane.front .daisy-lobby button:has-text('Take a seat')")
    check('…a seat with no window', wait_for(lambda: drv(bb, 'd.me && d.me.seat') == 2, 10) and len(bb._popups) == n)
    ready(bb); ready(a)
    # a third player: full
    cd, dd = computer(b)
    dd.goto(link2)
    dd.click(".pane.front .daisy-lobby button:has-text('Sign in to take a seat')")
    sign_in_dialog(dd, D_HANDLE)
    ok = wait_for(lambda: 'This table is full' in status(dd), 10)
    check('a third player: "This table is full", and no tiles stay loaded', ok and dd.eval_on_selector_all('.pane.front iframe', 'fs => fs.length') == 0, status(dd))
    # the same account in another browser without the seat's game: held
    ce, ee = computer(b)
    ee.goto(link2)
    ee.click(".pane.front .daisy-lobby button:has-text('Sign in to take a seat')")
    sign_in_dialog(ee, A_HANDLE)
    ok = wait_for(lambda: 'already sits at this table in another browser' in status(ee), 10)
    check('the seated account in another browser: "already sits at this table in another browser"; the first stays seated', ok and 'Playing with' in status(a) and drv(a, 'd.me.seat') == 1, status(ee))
    cd.close(); ce.close()
    pick(a, 'bone'); pick(bb, 'brick')
    wait_for(lambda: phase(a) == 'playing' and phase(bb) == 'playing', 15)
    play([RAKU_P(a), RAKU_P(bb)], limit=6)
    m2 = drv(a, 'd.snapshot.shared.matchId')
    a.click('.pane.front .daisy-home')
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-leave'), 3)
    check('"Back to the start" mid-match asks first (the 2-minute forfeit, said plainly)', ok and '2 minutes' in a.inner_text('.pane.front .daisy-leave'))
    a.click(".pane.front .daisy-leave button:has-text('Leave')")
    ok = wait_for(lambda: a.input_value('.addr') == 'raku:table/daisy' and a.is_visible('.pane.front .daisy-going'), 8)
    check('…Leave: the start screen says "You have a match in progress with @thunderbirdwine.bsky.social. Back to the table"', ok and 'You have a match in progress with @thunderbirdwine.bsky.social' in a.inner_text('.pane.front .daisy-going'))
    check('…the other computer sees "@thunderbird.cafe lost connection. Waiting… 1:5x"', wait_for(lambda: re.search(r'@thunderbird\.cafe lost connection\. Waiting… 1:[45]\d', status(bb)), 8), status(bb))
    a.screenshot(path=str(OUT / 's5-in-progress.png'))
    a.click(".pane.front .daisy-going button:has-text('Back to the table')")
    ok = wait_for(lambda: drv(a, 'd.me && d.me.seat') == 1 and 'Playing with' in status(a), 15)
    check('…Back to the table: the same seat and the same match', ok and drv(a, 'd.snapshot && d.snapshot.shared.matchId') == m2)
    check('…and the other computer sees you back', wait_for(lambda: 'Playing with @thunderbird.cafe' in status(bb), 10), status(bb))
    ready(a)
    check('…both houses agree again', wait_for(lambda: shared(a) == shared(bb), 10))
    # leave B's second tab on a finished state: close it
    bb.click('.tab.on .tab-x')

    # ---------- 5. Raku and the Daisy page at one table (Q44) ----------
    print('5. Raku and the Daisy page', flush=True)
    cf, ff = computer(b)
    ff.on('console', lambda m: print('   [daisy page]', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
    ff.goto(DAISY_PAGE + 'index.html?loader=' + LOADER)
    ff.wait_for_function('() => window.__daisy', timeout=10000)
    ff.fill('.dz-handle', C_HANDLE); ff.click('.dz-signin')
    ff.wait_for_function("() => !document.querySelector('.dz-account').hidden", timeout=10000)
    ff.click('.dz-open')
    ff.locator('.dz-invite:not([hidden])').wait_for(timeout=10000)
    dz_link = ff.input_value('.dz-link')
    t3 = parse_qs(urlparse(dz_link).query)['table'][0]
    check('the Daisy page opens a table (its own link)', bool(t3), dz_link)
    a.click('.newtab')
    a.fill('.addr', f'https://thunderbird.cafe/webtiles/daisy/?table={t3}'); a.press('.addr', 'Enter')
    ok = wait_for(lambda: a.input_value('.addr') == f'raku:table/daisy/{t3}' and 'Take a seat as @thunderbird.cafe' in a.inner_text('.pane.front .daisy-lobby'), 10)
    check('a Daisy page link pasted into Raku opens the same table in Raku', ok, f"{a.input_value('.addr')} | {a.inner_text('.pane.front')[:300]}")
    a.click(".pane.front .daisy-lobby button:has-text('Take a seat')")
    ok = wait_for(lambda: drv(a, 'd.me && d.me.seat') == 2 and 'Playing with @thunderbirdwine.bsky.social' in status(a), 15)
    check('…Raku sits at seat 2 opposite the Daisy page; the house versions match (no mismatch on either side)', ok and not drv(a, 'd.mismatch') and not ff.evaluate('window.__daisy.mismatch'))
    ff.wait_for_function("() => document.querySelector('.dz-status').textContent.includes('Playing with @thunderbird.cafe')", timeout=10000)
    ready(a)
    if not wait_for(lambda: ff.evaluate("['house','mine','theirs'].every(r => __daisy.frames.status(r) === 'ready')"), 30):
        print('   daisy page frames:', ff.evaluate("['house','mine','theirs'].map(r => __daisy.frames.status(r))"), ff.inner_text('#daisy')[:400])
    dz_tile(ff, 'mine').locator('.glaze[data-id="midnight"]:not([disabled])').click(timeout=15000)
    wait_for(lambda: mine(a).locator('.glaze[data-id="midnight"][disabled]').count() == 1, 10)
    pick(a, 'glow')
    ok = wait_for(lambda: phase(a) == 'playing' and DZ_PHASE(ff) == 'playing', 15)
    check('…glazes and the coin agree across Raku and the Daisy page', ok and wait_for(lambda: shared(a) == ff.evaluate('JSON.stringify(window.__daisy.snapshot && window.__daisy.snapshot.shared)'), 8))
    over = play([RAKU_P(a), (ff, lambda pg: dz_tile(pg, 'mine'), DZ_PHASE, DZ_TOTAL)])
    check('…a whole match between Raku and the Daisy page plays to the end', over)
    ok = wait_for(lambda: shared(a) == ff.evaluate('JSON.stringify(window.__daisy.snapshot && window.__daisy.snapshot.shared)'), 8)
    res = drv(a, 'd.result')
    check('…both houses identical; the result re-checks', ok and res and res == ff.evaluate('window.__daisy.result') and verify(res).get('ok') is True)
    a.screenshot(path=str(OUT / 's5-with-daisy-page.png'))
    ff.screenshot(path=str(OUT / 's5-daisy-page-side.png'))
    # and the other way: Raku opens, the Daisy page takes a seat from its own link form
    a.click('.newtab')
    a.fill('.addr', 'raku:table/daisy'); a.press('.addr', 'Enter')
    wait_for(lambda: a.is_visible('.pane.front .daisy-open'), 5)
    a.click('.pane.front .daisy-open')
    wait_for(lambda: a.is_visible('.pane.front .daisy-invite'), 10)
    t4 = a.input_value('.addr').split('/')[-1]
    ff.goto(DAISY_PAGE + f'index.html?table={t4}&loader=' + LOADER)
    ff.wait_for_function('() => window.__daisy', timeout=10000)
    ff.wait_for_function("() => !document.querySelector('.dz-account').hidden", timeout=10000)
    ff.click('.dz-sit')
    ok = wait_for(lambda: 'Playing with @thunderbirdwine.bsky.social' in status(a), 15)
    check('…and the other way: a table opened in Raku, joined from the Daisy page', ok and ff.evaluate('window.__daisy.me.seat') == 2)
    cf.close()

    # ---------- 6. a page with another version of the house ----------
    print('6. The house version check', flush=True)
    a.click('.newtab')
    a.fill('.addr', 'raku:table/daisy'); a.press('.addr', 'Enter')
    wait_for(lambda: a.is_visible('.pane.front .daisy-open'), 5)
    a.click('.pane.front .daisy-open')
    wait_for(lambda: a.is_visible('.pane.front .daisy-invite'), 10)
    t5 = a.input_value('.addr').split('/')[-1]
    cg, gg = computer(b)
    gg.goto(RAKU + 'robots.txt')
    gg.evaluate("""(t) => { const ws = new WebSocket('ws://127.0.0.1:8787/'); window.__ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', table: t, seat: 'any', did: 'did:plc:ro563p5faldqu44apudq44k4', handle: 'colorado.atprotocol.space', house: 'memory:0123456789abcdef', fresh: true })); }""", t5)
    ok = wait_for(lambda: 'different version of Daisy' in status(a), 10)
    check("another house version at the table: the table doesn't start, and Raku says why", ok and not a.is_visible('.pane.front .table-seats'), status(a))
    cg.close()

    # ---------- 7. a closed tab counts as leaving; the console ----------
    # (the browser's own "WebSocket connection … failed" lines while the relay was down on purpose don't count)
    errs = [c for pg in (a, bb) for c in pg._console if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU) and not c[1].startswith('WebSocket connection to ')]
    check("no errors on Raku's page", not errs, str(errs[:5]))
    csp = [c for pg in (a, bb) for c in pg._console if ('Content Security Policy' in c[1] or 'Refused' in c[1]) and c[2].startswith(RAKU)]
    check("Raku's own policy refused nothing (the relay is allowed by name)", not csp, str(csp[:3]))
    b.close()
finally:
    for pr in procs + [relay]:
        try: pr.send_signal(signal.SIGTERM)
        except Exception: pass

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed} of {len(results)} checks passed')
sys.exit(0 if passed == len(results) else 1)
