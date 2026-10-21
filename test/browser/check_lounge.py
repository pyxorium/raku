# Raku step 5b browser checks: Daisy's lounge in Raku (run in the chat sandbox, like check_daisy.py, whose
# setup this copies). Separate browser contexts stand for separate computers. The relay is daisy-relay's own
# lounge stand-in (test/lounge-standin.mjs: the real server.js and lounge.js, with stand-in lookups: a pass
# is "pass:<did>", every account has a lounge record, no blocks), which also passes the tables. Raku's page
# uses the stand-in sign-in (oauth-standin.js); the site's Daisy page is bundled with a stand-in too, so a
# Raku mingler and a Daisy page mingler can find each other (one lounge, Q54).
#
# Usage: python3 test/browser/check_lounge.py <work folder> [--site <site src folder>] [--tiles <daisy-tiles folder>]
#        [--relay <daisy-relay folder, with node_modules (ws)>] [--loader <tiles-loading-server folder>] [--modules <folder holding node_modules/@dasl/tile-loader>]
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
RELAY_DIR = Path(arg('--relay', str(RAKU_DIR.parent / 'daisy-relay')))
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
    (dp / 'fake-oauth.js').write_text((FAKE_LIB.replace('%(HANDLES)s', json.dumps({A_HANDLE: A, C_HANDLE: C, D_HANDLE: D})).replace('%%', '%')))
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
const expand = (scope) => ['repo:cafe.thunderbird.daisy.match', ...(/authLounge/.test(scope || '') ? ['repo:cafe.thunderbird.daisy.lounge', 'rpc:cafe.thunderbird.daisy.lounge.enter?aud=did:web:relay.daisy.thunderbird.cafe%%23daisy_relay'] : []), 'atproto'].join(' ');
function session(did) {
  return {
    did, sub: did,
    async getTokenInfo() { return { sub: did, scope: expand(SCOPES[did]) }; },
    async fetchHandler(path, init = {}) {
      if (path.startsWith('/xrpc/com.atproto.server.getServiceAuth')) {
        if (!/authLounge/.test(SCOPES[did] || '')) return new Response(JSON.stringify({ error: 'ScopeMissingError' }), { status: 403 });
        return new Response(JSON.stringify({ token: `pass:${did}` }), { status: 200 });
      }
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
passes = []
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
        if u.path.endswith('getProfiles'):
            actors = parse_qs(u.query).get('actors', [])
            return js({'profiles': [{'did': d, 'handle': HANDLES[d], 'displayName': HANDLES[d].split('.')[0].title()} for d in actors if d in HANDLES]})
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
        if u.path.endswith('getServiceAuth'):
            did, scope = q.get('standin_did'), q.get('standin_scope', '')
            passes.append((did, q.get('aud'), q.get('lxm')))
            if not any(s.startswith('rpc:cafe.thunderbird.daisy.lounge.enter') for s in scope.split(' ')): return js({'error': 'ScopeMissingError'}, 403)
            return js({'token': f'pass:{did}'})
        if u.path.endswith('deleteRecord'):
            body = json.loads(r.request.post_data or '{}')
            did, scope = q.get('standin_did'), q.get('standin_scope', '')
            if f"repo:{body.get('collection')}" not in scope.split(' '): return js({'error': 'ScopeMissingError'}, 403)
            saved.pop((did, body['collection'], body['rkey']), None)
            return js({})
        if u.path.endswith('getRecord') and q.get('collection') == 'cafe.thunderbird.daisy.lounge':
            rec = saved.get((q.get('repo'), q.get('collection'), q.get('rkey')))
            return js({'uri': f"at://{q['repo']}/{q['collection']}/self", 'value': rec}) if rec else js({'error': 'RecordNotFound'}, 400)
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
    # the relay with the lounge (daisy-relay's stand-in), which also passes the tables
    p = subprocess.Popen(['node', str(RELAY_DIR / 'test/lounge-standin.mjs'), '8787'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(1.0)
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
def lounge_state(pg): return pg.eval_on_selector('.pane.front .daisy-lounge', 'e => e.dataset.state') if pg.query_selector('.pane.front .daisy-lounge') else None
def lounge_note(pg): return pg.inner_text('.pane.front .lounge-note')
def start_url(extra=''): return RAKU + '?loader=' + LOADER + '&timers=short' + extra + '#t=raku%3Atable%2Fdaisy&a=0'
def who(pg, timeout=8):
    """Press "Who else is mingling?" and return the handles listed (the relay answers at most every 5 s)."""
    before = pg.inner_text('.pane.front .lounge-who-time') if pg.is_visible('.pane.front .lounge-who-time') else ''
    pg.click('.pane.front .lounge-who-ask')
    wait_for(lambda: pg.inner_text('.pane.front .lounge-who-time') != before and 'Looking' not in pg.inner_text('.pane.front .lounge-who-note'), timeout)
    return pg.eval_on_selector_all('.pane.front .lounge-person-handle', 'els => els.map(e => e.textContent)')
def lounge_sent(pg, kind): return [json.loads(f) for f in pg._sent if isinstance(f, str) and f'"type":"{kind}"' in f]

bundle()
procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/servers.mjs'), str(W), str(RAKU_DIR)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT))
procs.append(subprocess.Popen(['node', str(RAKU_DIR / 'test/browser/loader-replica.mjs'), str(LOADER_DIR), '80'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT))
procs.append(subprocess.Popen([sys.executable, '-m', 'http.server', '4321', '--bind', '127.0.0.1', '--directory', str(W / 'daisy-page')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
relay = start_relay()
time.sleep(1.0)
LOUNGE_SET = PINS['daisy']['lounge']['scope']

try:
  with sync_playwright() as p:
    b = p.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    # ---------- 1. signed out: the switch signs you in (one window: account, Play Daisy, Daisy lounge) ----------
    print('1. Mingling from signed out', flush=True)
    ca, a = computer(b)
    a.goto(start_url())
    ok = wait_for(lambda: a.is_visible('.pane.front .daisy-lounge'), 10)
    check('the Lounge sits on Daisy\'s start screen under the two cards (Q54)', ok and a.eval_on_selector('.pane.front .daisy-lounge', "e => e.getBoundingClientRect().top > document.querySelector('.pane.front .daisy-choices').getBoundingClientRect().bottom"))
    check('signed out: "Sign in to mingle. Joining the lounge requires one additional authorization."', lounge_note(a) == 'Sign in to mingle. Joining the lounge requires one additional authorization.', lounge_note(a))
    check('the lounge line that said "comes to Raku next" is gone', not a.query_selector('.pane.front .daisy-lounge-soon'))
    a.click('.pane.front .lounge-switch')
    dlg = '.pane.front .rk-dialog'
    ok = wait_for(lambda: a.is_visible(dlg) and 'Turn on mingling?' in a.inner_text(dlg), 5)
    text = a.inner_text(dlg) if ok else ''
    check('the explanation first: "while Daisy\'s start screen is the tab in front", blocks, the extra approval, and Raku\'s promise', ok and "Daisy's start screen is the tab in front" in text and 'blocked' in text and 'one additional authorization' in text and '“Daisy lounge”' in text and 'if you choose to mingle' in text, text[:300])
    check('…and the quiet mark, said plainly (5b-2): "Raku shows a small mark when someone arrives… It never says who."', 'Raku shows a small mark when someone arrives in the lounge. It never says who.' in text)
    check('…the handle box comes first, the explanation and the promise below it (Q55)', a.eval_on_selector(dlg, "d => d.querySelector('.signin-handle').getBoundingClientRect().bottom < d.querySelector('.rk-details').getBoundingClientRect().top && d.querySelector('.rk-details').textContent.includes('Daisy lounge')"))
    a.screenshot(path=str(OUT / 's5b-explain.png'))
    a.fill(f'{dlg} .signin-handle', A_HANDLE)
    a.click(f'{dlg} .signin-form button.primary')
    ok = wait_for(lambda: lounge_state(a) == 'here', 15, pages=[a])
    calls = a.evaluate("() => JSON.parse(localStorage.getItem('standin-calls') || '[]').filter(c => c.kind === 'popup')")
    check('one window asks for the account, "Play Daisy" and "Daisy lounge" together (Q54)', calls and calls[-1]['scope'] == f'atproto include:cafe.thunderbird.daisy.authPlay {LOUNGE_SET}', str(calls[-1:]))
    check('…the lounge record is written to your own account (cafe.thunderbird.daisy.lounge/self)', (A, 'cafe.thunderbird.daisy.lounge', 'self') in saved)
    check('…and you are in the lounge: "Mingling: other mingling players can see you while Daisy\'s start screen is the tab in front"', ok and 'Mingling' in lounge_note(a) and 'tab in front' in lounge_note(a), lounge_note(a))
    check('the relay got a pass from your account\'s server, addressed to the relay\'s lounge only', passes and passes[-1] == (A, 'did:web:relay.daisy.thunderbird.cafe#daisy_relay', 'cafe.thunderbird.daisy.lounge.enter') and lounge_sent(a, 'enter') and lounge_sent(a, 'enter')[-1]['pass'] == f'pass:{A}', str(passes[-1:]))
    check('the switch is on', a.eval_on_selector('.pane.front .lounge-switch', 'e => e.getAttribute("aria-checked")') == 'true')
    check('nobody else yet: "Nobody else is mingling here right now"', who(a) == [] and 'Nobody else' in a.inner_text('.pane.front .lounge-who-note'))
    a.screenshot(path=str(OUT / 's5b-here.png'))

    # ---------- 2. signed in with "Play Daisy" only: Continue opens one short window for the lounge ----------
    print('2. Mingling when already signed in', flush=True)
    cb, bb = computer(b)
    bb.goto(start_url())
    wait_for(lambda: bb.is_visible('.pane.front .daisy-open'), 10)
    bb.click('.pane.front .daisy-open')
    wait_for(lambda: bb.is_visible('.pane.front .rk-dialog .signin-handle'), 5)
    bb.fill('.pane.front .rk-dialog .signin-handle', C_HANDLE)
    bb.click('.pane.front .rk-dialog .signin-form button.primary')
    wait_for(lambda: bb.is_visible('.pane.front .daisy-invite'), 15)
    bb.click('.pane.front .daisy-home')
    ok = wait_for(lambda: bb.is_visible('.pane.front .daisy-lounge') and lounge_state(bb) == 'off', 10)
    check('signed in without "Daisy lounge": Off, "Joining the lounge requires one additional authorization."', ok and 'additional authorization' in lounge_note(bb), lounge_note(bb))
    bb.click('.pane.front .lounge-switch')
    wait_for(lambda: bb.is_visible('.pane.front .rk-dialog'), 5)
    check('…the explanation with Continue (no sign-in form: you are already signed in)', bb.is_visible(".pane.front .rk-dialog button:has-text('Continue')") and not bb.is_visible('.pane.front .rk-dialog .signin-handle'))
    n = len(bb._popups)
    bb.click(".pane.front .rk-dialog button:has-text('Continue')")
    ok = wait_for(lambda: lounge_state(bb) == 'here', 15, pages=[bb])
    calls = bb.evaluate("() => JSON.parse(localStorage.getItem('standin-calls') || '[]').filter(c => c.kind === 'popup')")
    check('…one short window from the press, asking to add "Daisy lounge" (keeping "Play Daisy")', ok and len(bb._popups) > n and calls[-1]['scope'] == f'atproto include:cafe.thunderbird.daisy.authPlay {LOUNGE_SET}', str(calls[-1:]))
    time.sleep(5.2)
    check('Who else is mingling? Raku players see each other by handle', who(bb) == ['@thunderbird.cafe'] and who(a) == ['@thunderbirdwine.bsky.social'])
    check('…with Invite beside each', bb.is_visible('.pane.front .lounge-invite') and a.is_visible('.pane.front .lounge-invite'))
    bb.screenshot(path=str(OUT / 's5b-who.png'))

    # ---------- 3. an invitation: Not now stays private ----------
    print('3. Invitations', flush=True)
    a.click('.pane.front .lounge-invite')
    check('Invite → "Invite sent"', wait_for(lambda: 'Invite sent' in a.inner_text('.pane.front .lounge-people'), 3))
    ok = wait_for(lambda: bb.is_visible('.pane.front .lounge-knock'), 8)
    check('the knock card on the other computer: "@thunderbird.cafe invites you to a game of Daisy." with Play / Not now', ok and '@thunderbird.cafe invites you to a game of Daisy.' in bb.inner_text('.pane.front .lounge-knock'))
    bb.screenshot(path=str(OUT / 's5b-knock.png'))
    bb.click(".pane.front .lounge-knock button:has-text('Not now')")
    check('Not now: the card goes; the inviter sees "No answer" after a while (4 s with short timers), whatever happened', not bb.is_visible('.pane.front .lounge-knock') and wait_for(lambda: 'No answer' in a.inner_text('.pane.front .lounge-people'), 8))
    # ---------- 4. the other way: Play → both to one table ----------
    bb.click('.pane.front .lounge-invite')
    ok = wait_for(lambda: a.is_visible('.pane.front .lounge-knock'), 8)
    a.click(".pane.front .lounge-knock button:has-text('Play')")
    ok = wait_for(lambda: re.match(r'^raku:table/daisy/[a-z0-9]+$', a.input_value('.addr')) and re.match(r'^raku:table/daisy/[a-z0-9]+$', bb.input_value('.addr')), 10)
    check('Play: both tabs go to the same new table (raku:table/daisy/<id>)', ok and a.input_value('.addr') == bb.input_value('.addr'), f"{a.input_value('.addr')} {bb.input_value('.addr')}")
    ok = wait_for(lambda: drv(bb, 'd.me && d.me.seat') == 1 and drv(a, 'd.me && d.me.seat') == 2, 15)
    check('…the inviter at seat 1, the one who said yes at seat 2', ok)
    ok = wait_for(lambda: 'Playing with @thunderbird.cafe' in status(bb) and 'Playing with @thunderbirdwine.bsky.social' in status(a), 15)
    check('…both "Playing with @…", and no link to send (a lounge table)', ok and not bb.is_visible('.pane.front .daisy-invite') and not a.is_visible('.pane.front .daisy-invite'))
    check('…at a table you are out of the lounge (the start screen and its lounge are gone)', not a.query_selector('.pane.front .daisy-lounge'))
    ready(a); ready(bb)
    pick(a, 'jade'); pick(bb, 'marigold')
    check('…and the table plays (glazes, the coin agreed)', wait_for(lambda: phase(a) == 'playing' and shared(a) == shared(bb), 20))
    a.screenshot(path=str(OUT / 's5b-table.png'))

    # ---------- 5. here = Daisy's start screen in front (Q51) ----------
    print('5. Here only while the start screen is in front', flush=True)
    for pg in (a, bb):
        pg.click('.pane.front .daisy-home')
        if pg.is_visible('.pane.front .daisy-leave'): pg.click(".pane.front .daisy-leave button:has-text('Leave')")
    ok = wait_for(lambda: lounge_state(a) == 'here' and lounge_state(bb) == 'here', 15)
    check('Back to the start: back in the lounge by itself (mingling stays on)', ok)
    a.click('.newtab')
    ok = wait_for(lambda: a.eval_on_selector('.pane[data-tab] .daisy-lounge', 'e => e.dataset.state') == 'away', 8)
    check('another Raku tab in front: you quietly leave the lounge ("away")', ok)
    time.sleep(5.2)
    check('…the other computer no longer lists you', who(bb) == [], str(who(bb)))
    check('…but still connected, listening (5b-2): the relay was told "away", not left', any(json.loads(f).get('type') == 'away' for f in a._sent if isinstance(f, str) and f.startswith('{')) and not a.query_selector('.tab.signal'))
    # someone arrives (the other computer steps away and comes back): the quiet mark
    bb.click('.newtab'); wait_for(lambda: bb.eval_on_selector('.pane[data-tab] .daisy-lounge', 'e => e.dataset.state') == 'away', 8)
    bb.click('.tab:has-text("Daisy")'); wait_for(lambda: lounge_state(bb) == 'here', 8)
    ok = wait_for(lambda: a.query_selector('.tab.signal') is not None, 8)
    check('someone arrives while you are on another tab: the Daisy tab glows turquoise with ●, "Someone arrived in the Daisy lounge" (no name)', ok and a.get_attribute('.tab.signal .tab-signal', 'title') == 'Someone arrived in the Daisy lounge' and 'thunderbirdwine' not in a.inner_text('.tabstrip'))
    check('…and Raku\'s browser icon gets its pip (the title unchanged)', a.eval_on_selector('link[rel="icon"]', 'l => l.href.startsWith("data:image/svg+xml")') and not a.title().startswith('●'))
    a.screenshot(path=str(OUT / 's5b2-mark.png'))
    a.click('.tab:has-text("Daisy")')
    ok = wait_for(lambda: lounge_state(a) == 'here', 10)
    check('back to the Daisy tab: the mark and the pip clear', ok and not a.query_selector('.tab.signal') and a.eval_on_selector('link[rel="icon"]', 'l => l.href.endsWith("/icon.svg")'))
    time.sleep(5.2)
    check('back to the Daisy tab: in the lounge again ("back"), and listed', ok and who(bb) == ['@thunderbird.cafe'] and any(json.loads(f).get('type') == 'back' for f in a._sent if isinstance(f, str) and f.startswith('{')))
    a.close_tab = None
    # another browser tab in front (the page hidden)
    other = ca.new_page(); other.goto(RAKU + 'robots.txt'); other.bring_to_front()
    a.evaluate("() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }")
    ok = wait_for(lambda: lounge_state(a) == 'away', 8)
    time.sleep(5.2)
    check('Raku itself out of sight (another browser tab, minimized): away too, not listed', ok and who(bb) == [])
    a.evaluate("() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }")
    a.bring_to_front(); other.close()
    check('…seen again: back in the lounge', wait_for(lambda: lounge_state(a) == 'here', 10))

    # ---------- 6. one lounge with the Daisy page ----------
    print('6. Raku and the Daisy page in one lounge', flush=True)
    cf, ff = computer(b)
    ff.goto(DAISY_PAGE + 'index.html?loader=' + LOADER + '&timers=short')
    ff.wait_for_function('() => window.__daisy', timeout=10000)
    ff.fill('.dz-handle', D_HANDLE); ff.click('.dz-signin')
    ff.wait_for_function("() => !document.querySelector('.dz-account').hidden", timeout=10000)
    ff.click('.dz-switch')
    ff.locator('.dz-ldialog:not([hidden])').wait_for(timeout=5000)
    check("the Daisy page's mingling dialog says so too (5b-2): \"…mingling players in Raku who are on another tab may see a small mark… It never says who.\"", 'mingling players in Raku who are on another tab may see a small mark that someone has arrived. It never says who.' in ff.inner_text('.dz-ldialog'))
    ff.click('.dz-ldialog-yes')
    ok = wait_for(lambda: ff.evaluate('window.__daisy.lounge.state') == 'here', 15, pages=[ff])
    check('a player mingling on the Daisy page…', ok, ff.evaluate('window.__daisy.lounge.state'))
    time.sleep(5.2)
    seen = who(a)
    check('…is listed in Raku\'s lounge, and Raku\'s players on the Daisy page (one lounge)', '@colorado.atprotocol.space' in seen and wait_for(lambda: (ff.click('.dz-who-ask') or True) and ff.eval_on_selector_all('.dz-person-handle', 'els => els.map(e => e.textContent)').count('@thunderbird.cafe') == 1, 8), str(seen))
    # the same account in two places: the newest wins
    cg, gg = computer(b)
    gg.goto(DAISY_PAGE + 'index.html?loader=' + LOADER + '&timers=short')
    gg.wait_for_function('() => window.__daisy', timeout=10000)
    gg.fill('.dz-handle', A_HANDLE); gg.click('.dz-signin')
    gg.wait_for_function("() => !document.querySelector('.dz-account').hidden", timeout=10000)
    wait_for(lambda: gg.evaluate('window.__daisy.lounge.state') in ('here', 'needs-signin', 'off'), 10, pages=[gg])
    if gg.evaluate('window.__daisy.lounge.state') != 'here':
        if gg.is_visible('.dz-lounge-retry'): gg.click('.dz-lounge-retry')
        else:
            gg.click('.dz-switch'); gg.locator('.dz-ldialog:not([hidden])').wait_for(timeout=5000); gg.click('.dz-ldialog-yes')
    ok = wait_for(lambda: lounge_state(a) == 'replaced', 15, pages=[gg])
    check('the same account mingling on the Daisy page too: Raku says "@thunderbird.cafe is mingling in another window now", with Rejoin', ok and 'mingling in another window' in lounge_note(a) and a.is_visible('.pane.front .lounge-retry'), lounge_note(a))
    a.click('.pane.front .lounge-retry')
    check('…Rejoin: Raku is back in the lounge (and the Daisy page steps back)', wait_for(lambda: lounge_state(a) == 'here', 10) and wait_for(lambda: gg.evaluate('window.__daisy.lounge.state') == 'away', 10))
    cg.close()

    # ---------- 7. mingling off; the message panel; the phone ----------
    print('7. Mingling off', flush=True)
    a.click('.pane.front .panel-btn')
    lines = a.eval_on_selector_all('.pane.front .panel-list li', 'ls => ls.map(l => l.textContent)')
    check('the start screen\'s message panel logs the lounge\'s comings and goings', any('lounge → Raku  in' in l for l in lines) and any('Raku → lounge  enter' in l for l in lines) and any('Raku → lounge  who' in l for l in lines) and any('lounge → Raku  people' in l for l in lines) and any('replaced' in l for l in lines), str(lines[:10]))
    a.click('.pane.front .panel-close')
    a.click('.pane.front .lounge-switch')
    ok = wait_for(lambda: lounge_state(a) == 'off', 10, pages=[a])
    check('mingling off: the lounge record is deleted from your account, the switch off, out of the lounge', ok and (A, 'cafe.thunderbird.daisy.lounge', 'self') not in saved and a.eval_on_selector('.pane.front .lounge-switch', 'e => e.getAttribute("aria-checked")') == 'false')
    time.sleep(5.2)
    check('…the others no longer see you', '@thunderbird.cafe' not in who(bb))
    a.reload()
    ok = wait_for(lambda: lounge_state(a) == 'off', 10)
    check('…and after a reload it stays off (no record)', ok)
    bb.reload()
    ok = wait_for(lambda: lounge_state(bb) == 'here', 15, pages=[bb])
    check('a reload while mingling: back in the lounge by itself, no window (the record and the sign-in kept)', ok)
    bb.set_viewport_size({'width': 390, 'height': 800})
    time.sleep(0.5)
    check('phone width: the lounge fits (no sideways scroll)', bb.evaluate('() => document.documentElement.scrollWidth <= 390'))
    bb.screenshot(path=str(OUT / 's5b-phone.png'))

    errs = [c for pg in (a, bb) for c in pg._console if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU) and not c[1].startswith('WebSocket connection to ')]
    check("no errors on Raku's page", not errs, str(errs[:5]))
    csp = [c for pg in (a, bb) for c in pg._console if ('Content Security Policy' in c[1] or 'Refused' in c[1]) and c[2].startswith(RAKU)]
    check("Raku's own policy refused nothing", not csp, str(csp[:3]))
    b.close()
finally:
    for pr in procs + [relay]:
        try: pr.send_signal(signal.SIGTERM)
        except Exception: pass

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed} of {len(results)} checks passed')
sys.exit(0 if passed == len(results) else 1)
