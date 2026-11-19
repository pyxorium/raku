# Game saves in a browser (claude/cosmic-junkyard-v2-plan.md, CJ2-5 to CJ2-11): the real Cosmic Junkyard version 2 page
# (index.html and sprite.png from C:\thunderbird-cafe\cosmic-junkyard-tile\tile) at its own address, run through a replica of
# the tile loading server, with a stand-in account server. Real runs are played (about 45 seconds each, a few at once).
# Checked: the game is told it can save (can-save) and shows "Save this run"; signed out, Raku's prompt signs you in first,
# then asks; No tells the game "declined"; Allow once with the moves box ticked writes a cafe.thunderbird.cosmicjunkyard.run
# record whose game is the tile's own address and running version, whose moves replay (the repo's scripts/check-run.mjs) to
# its score; the game says "Saved to @… ✓" and its "See it" opens Raku's "Open in" message for that record only; Always,
# then the next run saved without asking, listed in the account menu's "Saves without asking"; a sign-in from before game
# runs joined "Raku" approves again in the small window first; a copy of the game at another address isn't offered saving
# and its write-record is refused (not-allowed); a made-up record is refused (invalid); none of it on the Messages pill.
#
# Usage: python3 test/browser/check_game_saves.py <work folder> <tiles-loading-server folder> <cosmic-junkyard-tile folder>
#   (the last: the repo's top folder, with tile\ and scripts\check-run.mjs; needs Playwright with Chromium, esbuild,
#   node_modules with @dasl/tile-loader and rooms-lab, and port 80 free for the loader replica)
import base64, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
CJREPO = Path(sys.argv[3]).resolve()
CJ = CJREPO / 'tile'
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
TILE = 'ing.dasl.masl'
CJ_RKEY = '3mwvoqidyqd24'; CJ_CID = 'bafyreicosmicjunkyardversiontwo'
COPY_RKEY = '3cosmiccopytest'
RUN = 'cafe.thunderbird.cosmicjunkyard.run'
GRANT = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post&collection=cafe.thunderbird.tile.like{} rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*'
FULL = GRANT.format('&collection=' + RUN)
BEFORE = GRANT.format('')          # a sign-in from before game runs joined "Raku"

def raw_cid(data):
    mh = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return 'b' + base64.b32encode(mh).decode().lower().rstrip('=')
blobs = {}
def res(did, data, ctype):
    c = raw_cid(data); blobs[(did, c)] = data
    return {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}, 'content-type': ctype}
cj_res = {'/': res(T, (CJ / 'index.html').read_bytes(), 'text/html'), '/sprite.png': res(T, (CJ / 'sprite.png').read_bytes(), 'image/png')}
records = {
    (T, TILE, CJ_RKEY): (CJ_CID, {'$type': TILE, 'tile': {'name': 'Cosmic Junkyard', 'resources': cj_res}}),
    (T, TILE, COPY_RKEY): ('bafyreicosmiccopy', {'$type': TILE, 'tile': {'name': 'Cosmic Junkyard (a copy)', 'resources': cj_res}}),
}
puts = []
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

HANDLES = {T: T_H, P: P_H}
def route(r):
    url = r.request.url
    calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        if did not in HANDLES: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{HANDLES[did]}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfiles'): return js({'profiles': [{'did': d, 'handle': HANDLES.get(d, 'handle.invalid'), 'labels': []} for d in parse_qs(u.query).get('actors', [])]})
        if u.path.endswith('getProfile'): return js({'did': q.get('actor'), 'handle': HANDLES.get(q.get('actor'), 'handle.invalid'), 'labels': []})
        return js({})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('putRecord'):
            body = json.loads(r.request.post_data or '{}'); scope = q.get('standin_scope', '')
            puts.append({'did': q.get('standin_did'), 'scope': scope, 'body': body})
            if f'collection={body.get("collection")}' not in scope and f'repo:{body.get("collection")}' not in scope:
                return js({'error': 'ScopeMissingError', 'message': 'Missing required scope'}, 403)
            return js({'uri': f"at://{body['repo']}/{body['collection']}/{body['rkey']}", 'cid': 'bafyreiwritten' + body['rkey']})
        if u.path.endswith('getRecord'):
            key = (q.get('repo'), q.get('collection'), q.get('rkey'))
            got = records.get(key)
            if not got: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{key[0]}/{key[1]}/{key[2]}", 'cid': got[0], 'value': got[1]})
        if u.path.endswith('getBlob'):
            bb = blobs.get((q.get('did'), q.get('cid')))
            if bb is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=bb)
        if u.path.endswith('listRecords'): return js({'records': []})
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

def seed(accounts, scope=FULL):
    acc = [{'did': d, 'handle': HANDLES[d]} for d in accounts]
    return (f"try {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-accounts', {json.dumps(json.dumps(acc))});"
            f" localStorage.setItem('raku-account', {json.dumps(json.dumps(accounts[0] if accounts else None))});"
            f" localStorage.setItem('standin-sessions', {json.dumps(json.dumps({d: {'scope': scope} for d in accounts}))});"
            f" sessionStorage.setItem('seeded', '1'); }} }} catch {{}}")

# Talk to Raku from inside a tile, as a game would (its data channel), and collect the answers for a while.
TALK = """async ([msg, ms]) => { const d = await import('/.well-known/web-tiles/data.js'); const got = [];
  d.addDataHandler((m) => got.push(m && typeof m === 'object' ? JSON.parse(JSON.stringify(m, (k, v) => (v instanceof Blob ? 'blob' : v))) : m));
  if (msg) d.sendData(msg); await new Promise((r) => setTimeout(r, ms)); return got; }"""

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--autoplay-policy=no-user-gesture-required'])
        HOSTS = ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://rpg.actor/**']
        def new_page(script):
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
            for host in HOSTS: ctx.route(host, route)
            if script: ctx.add_init_script(script)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            PAGES.append(page)
            return ctx, page, errs
        def game(page):
            for f in page.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url:
                    if f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def start(page, uri):
            page.goto(RAKU + '?loader=' + LOADER); page.wait_for_selector('.addr')
            page.fill('.addr', uri); page.press('.addr', 'Enter')
            g = wait_for(lambda: game(page) and game(page).is_visible('#game') and game(page), 25)
            time.sleep(1.5)
            return g
        def play(page, moves=True):
            """Start the run (Enter on the canvas) with a few key holds early on; it then plays itself to the end."""
            g = game(page)
            g.focus('#game'); page.keyboard.press('Enter')
            if moves:
                for key, ms in [('ArrowLeft', 400), ('ArrowRight', 900), ('ArrowLeft', 300)]:
                    page.keyboard.down(key); time.sleep(ms / 1000); page.keyboard.up(key); time.sleep(0.2)
        def ended(page): return game(page).evaluate("() => !document.getElementById('savePanel').hidden")
        def save_status(page): return game(page).inner_text('#saveStatus')
        def my_puts(did): return [p for p in puts if p['did'] == did and p['body'].get('collection') == RUN]
        CJ_URI = f'at://{T_H}/{TILE}/{CJ_RKEY}'

        # Four runs at once: A signed out, B signed in (Always), C a sign-in from before game runs, D the copy.
        ctxA, A, errsA = new_page(seed([]))
        ctxB, B, errsB = new_page(seed([T]))
        ctxC, C, errsC = new_page(seed([P], scope=BEFORE))
        ctxD, D, errsD = new_page(seed([T]))
        for pg, uri in [(A, CJ_URI), (B, CJ_URI), (C, f'at://{P_H}/{TILE}/{CJ_RKEY}'.replace(P_H, T_H)), (D, f'at://{T_H}/{TILE}/{COPY_RKEY}')]:
            check(f'the game loads in Raku ({uri.split("/")[-1]})', start(pg, uri))
        # The copy: no can-save, and a write-record refused
        got = game(D).evaluate(TALK, [{'kind': 'hello', 'v': 1}, 1500])
        kinds = [m.get('kind') for m in got if isinstance(m, dict)]
        check('a copy of the game at another address: its hello gets no can-save (CJ2-9)', 'can-save' not in kinds and 'sprite' in kinds + ['sprite'] and kinds, str(kinds))
        got = game(D).evaluate(TALK, [{'kind': 'write-record', 'id': 'x1', 'action': 'create', 'collection': RUN, 'record': {'score': 1, 'day': '2026-11-19', 'playedAt': '2026-11-19T00:00:00.000Z'}}, 1500])
        check('...and its write-record is refused: not-allowed', {'kind': 'write-record-result', 'id': 'x1', 'ok': False, 'error': 'not-allowed'} in got, str(got))
        got = game(B).evaluate(TALK, [{'kind': 'hello', 'v': 1}, 1500])
        check('the game at its own address: its hello gets can-save with its collection', {'kind': 'can-save', 'collections': [RUN]} in got, str(got))
        got = game(B).evaluate(TALK, [{'kind': 'write-record', 'id': 'x2', 'action': 'create', 'collection': RUN, 'record': {'score': 10 ** 6, 'day': 'today', 'playedAt': 'now'}}, 1500])
        check('...a made-up record is refused before asking: invalid', {'kind': 'write-record-result', 'id': 'x2', 'ok': False, 'error': 'invalid'} in got and not B.is_visible('.rk-dialog'), str(got))
        got = game(B).evaluate(TALK, [{'kind': 'open-record', 'uri': f'at://{T}/app.bsky.feed.post/3abc'}, 800])
        check('..."open-record" for an address Raku didn\'t write for it: nothing opens', not B.is_visible('.link-msg'))
        check('...none of it on the Messages pill', not B.is_visible('.pane.front .panel-pill'))
        for pg in (A, B, C): play(pg)
        play(D, moves=False)
        print('   (four runs playing, about 45 seconds)', flush=True)
        check('the runs end, and the game at its own address offers "Save this run"', wait_for(lambda: ended(A) and ended(B) and ended(C), 90))
        check('...the copy doesn\'t (it was never told it can save)', wait_for(lambda: game(D).evaluate("() => document.getElementById('savePanel').hidden") and 'Final' not in '', 5))

        # ---- A: signed out: sign in first, then ask; No; then Allow once with moves ----
        game(A).click('#saveBtn')
        check('signed out: Raku\'s prompt asks to sign in first', wait_for(lambda: A.is_visible('.rk-dialog') and 'Save this Cosmic Junkyard run?' in A.inner_text('.rk-dialog h2'), 5))
        check('...the game says it\'s waiting for you', wait_for(lambda: 'allow' in save_status(A), 3), save_status(A))
        A.screenshot(path=str(OUT / 'save-signin.png'))
        A.fill('.rk-dialog .signin-handle', T_H)
        with A.expect_popup() as pop:
            A.click('.rk-dialog button:has-text("Sign in")')
        check('...after signing in, it asks to save to that account', wait_for(lambda: A.inner_text('.rk-dialog h2') == f'Save this run to @{T_H}?', 15), A.inner_text('.rk-dialog') if A.is_visible('.rk-dialog') else '')
        text = A.inner_text('.rk-dialog')
        check('...saying what it adds, and that moves aren\'t in it', 'a Cosmic Junkyard run record and nothing else' in text and 'moves' not in text.split('What will be saved')[0], text)
        A.click('.rk-dialog button:text-is("No")')
        check('No: the game says "Not saved." and Save works again', wait_for(lambda: save_status(A) == 'Not saved.' and not game(A).evaluate("() => document.getElementById('saveBtn').disabled"), 5), save_status(A))
        check('...nothing written', not my_puts(T))
        game(A).check('#movesBox'); game(A).click('#saveBtn')
        check('again with the moves box ticked: the prompt says the moves are in it', wait_for(lambda: A.is_visible('.rk-dialog') and 'includes your moves' in A.inner_text('.rk-dialog'), 5))
        A.screenshot(path=str(OUT / 'save-ask.png'))
        A.click('.rk-dialog button:text-is("Allow once")')
        check('Allow once: written to the account', wait_for(lambda: my_puts(T), 8))
        put = my_puts(T)[-1]['body']
        rec = put['record']
        check('...a cafe.thunderbird.cosmicjunkyard.run record, key a TID, validate left to the server', put['collection'] == RUN and len(put['rkey']) == 13 and 'validate' not in put and rec['$type'] == RUN, str(put)[:300])
        check('...its game: the tile\'s own address and the version running (CJ2-9)', rec['game'] == {'uri': f'at://{T}/{TILE}/{CJ_RKEY}', 'cid': CJ_CID}, str(rec.get('game')))
        check('...score, day, playedAt, tally, moves, createdAt', set(rec) == {'$type', 'game', 'score', 'day', 'playedAt', 'tally', 'moves', 'createdAt'}, str(set(rec)))
        (W / 'run-a.json').write_text(json.dumps(rec))
        out = subprocess.run(['node', str(CJREPO / 'scripts' / 'check-run.mjs'), str(W / 'run-a.json'), str(CJ / 'index.html')], capture_output=True, text=True)
        check('...and its moves replay to its score (scripts/check-run.mjs)', out.returncode == 0 and 'checks out' in out.stdout, out.stdout + out.stderr)
        print('   ', out.stdout.strip().replace('\n', ' / '), flush=True)
        uri = f"at://{T}/{RUN}/{put['rkey']}"
        check('the game: "Saved to @thunderbird.cafe\'s account ✓" and "See it"', wait_for(lambda: save_status(A).startswith(f"Saved to @{T_H}'s account ✓") and 'See it' in save_status(A), 5), save_status(A))
        check('...Raku\'s prompt says saved, with the record\'s link', 'Saved to @thunderbird.cafe.' in A.inner_text('.rk-dialog') and A.get_attribute('.rk-dialog .rk-saved a', 'href') == f'https://pdsls.dev/{uri}')
        A.screenshot(path=str(OUT / 'save-saved.png'))
        A.click('.rk-dialog button:text-is("Close")')
        game(A).click('#seeIt')
        check('"See it": Raku\'s "Open in" message for that record (CJ2-11)', wait_for(lambda: A.is_visible('.link-msg') and uri in A.inner_text('.link-msg'), 5), A.inner_text('.link-msg') if A.is_visible('.link-msg') else '')
        A.screenshot(path=str(OUT / 'save-see-it.png'))
        check('no errors on the page (signed out, then in)', not errsA, str(errsA))

        # ---- C: a sign-in from before game runs: approve "Raku" again in the small window ----
        game(C).click('#saveBtn')
        check('a sign-in from before game runs: the prompt says "Raku" needs approving again', wait_for(lambda: C.is_visible('.rk-dialog .rk-ask'), 8), C.inner_text('.rk-dialog') if C.is_visible('.rk-dialog') else '')
        with C.expect_popup():
            C.click('.rk-dialog button:text-is("Allow once")')
        check('...Allow once: the small window, then saved', wait_for(lambda: my_puts(P) and save_status(C).startswith(f"Saved to @{P_H}'s account ✓"), 15), save_status(C))
        check('...the record without moves (box unticked)', 'moves' not in my_puts(P)[-1]['body']['record'])
        check('no errors on the page (approving again)', not errsC, str(errsC))

        # ---- B: Always, then the next run saved without asking ----
        game(B).click('#saveBtn')
        wait_for(lambda: B.is_visible('.rk-dialog button:text-is("Always")'), 5)
        B.click('.rk-dialog button:text-is("Always")')
        check('Always: saved', wait_for(lambda: len(my_puts(T)) == 2 and save_status(B).startswith('Saved to'), 8), save_status(B))
        check('...kept for this account and game', B.evaluate("() => JSON.parse(localStorage.getItem('raku-always'))") == {f'{T} cosmicjunkyard': True})
        B.click('.rk-dialog button:text-is("Close")')
        game(B).focus('#game'); B.keyboard.press('Enter')
        check('Play Again: the save controls go', wait_for(lambda: game(B).evaluate("() => document.getElementById('savePanel').hidden"), 3))
        print('   (one more run, about 45 seconds)', flush=True)
        check('...the next run ends', wait_for(lambda: ended(B), 90))
        game(B).click('#saveBtn')
        check('...and is saved without asking (no prompt), with a note in Raku', wait_for(lambda: len(my_puts(T)) == 3 and save_status(B).startswith('Saved to'), 8) and not B.is_visible('.rk-dialog')
              and 'without asking' in B.inner_text('body'), save_status(B))
        B.click('.account-btn')
        check('the account menu lists "Cosmic Junkyard · @thunderbird.cafe" under Saves without asking', wait_for(lambda: 'Cosmic Junkyard · @thunderbird.cafe' in B.inner_text('.account-menu'), 5))
        B.screenshot(path=str(OUT / 'save-always-menu.png'))
        B.click('.account-menu .acct-always button:has-text("Turn off")')
        check('...Turn off: gone', wait_for(lambda: B.evaluate("() => JSON.parse(localStorage.getItem('raku-always'))") == {}, 3))
        check('the promise says game runs', 'save your match results and game runs' in B.inner_text('.account-menu .rk-promise'))
        check('no errors on the page (Always)', not errsB, str(errsB))
        check('no errors on the page (the copy)', not errsD, str(errsD))
        b.close()
finally:
    servers.terminate(); replica.terminate()

bad = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(bad)} of {len(results)} checks passed', flush=True)
sys.exit(1 if bad else 0)
