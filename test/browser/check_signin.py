# Raku stage 4 browser checks: signing in and saving at the tables (run in the chat sandbox, like
# check_page.py). Raku's page is bundled with the stand-in sign-in library (oauth-standin.js) in place of
# @atproto/oauth-client-browser; a stand-in PDS (Playwright routes) takes putRecord and lists records.
# Both tables play their real tiles (the site's memory copies under the pinned addresses), against the bot.
# Usage: python3 test/browser/check_signin.py <work folder> [the site's src folder]
#        (servers.mjs and the replica already running; the bundle made with --alias, see README)
import base64, hashlib, json, re, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
C = 'did:plc:joer5rzmwgec3dkr4srfmq45'; C_HANDLE = 'thunderbirdwine.bsky.social'
BOT_DID = 'did:plc:hd2efebmfhpqcusfya4lguce'
SITE_SRC = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('/mnt/user-data/uploads/pyxorium.github.io/src')
RAKU_DIR = Path(__file__).resolve().parents[2]
# (widened in step 5b, Q53, for the lounge)
PROMISE = "Signing in lets raku.lexicographer.space save your match results from the tables you play and, if you choose to mingle, let other players see you're in a game's lounge. Each game asks for its own permission the first time. Raku doesn't touch your posts, likes, follows or anything else."

def node_json(code):
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True).stdout)
PINS = node_json(f"import('{RAKU_DIR}/src/config.js').then(m => process.stdout.write(JSON.stringify(m.TABLES)))")
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

saved = {}           # (did, collection, rkey) -> record
puts = []            # every putRecord seen: (did, collection, scope)
def route(r):
    url = r.request.url
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/')
        handle = {A: A_HANDLE, C: C_HANDLE, BOT_DID: 'dicesprite.thunderbird.cafe'}.get(did)
        if not handle: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{handle}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {A_HANDLE: A, C_HANDLE: C, 'dicesprite.thunderbird.cafe': BOT_DID}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile'):
            prof = {'did': q.get('actor'), 'labels': []}
            if q.get('actor') == A: prof.update({'displayName': 'Thunderbird Cafe', 'avatar': 'https://cdn.bsky.app/img/avatar/plain/a/av@jpeg'})
            return js(prof)
    if u.hostname == 'typeahead.waow.tech':
        return js({'actors': []})
    if u.hostname == 'cdn.bsky.app':
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
        return r.fulfill(status=200, headers={**cors, 'content-type': 'image/png'}, body=png)
    if u.hostname == 'lexicographer.space':
        return js({'version': 1, 'salt': 'x', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('putRecord'):
            body = json.loads(r.request.post_data or '{}')
            did, scope = q.get('standin_did'), q.get('standin_scope', '')
            puts.append((did, body.get('collection'), scope))
            if body.get('repo') != did: return js({'error': 'InvalidRequest', 'message': 'not your repo'}, 400)
            if f"repo:{body.get('collection')}" not in scope.split(' '): return js({'error': 'ScopeMissingError', 'message': 'missing scope'}, 403)
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
def wait_for(fn, timeout=10.0, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
def acct(pg):
    return ' '.join(pg.eval_on_selector('.pane.front .table-account', 'e => e.textContent').split())
def standin_calls(pg, kind):
    return [c for c in (pg.evaluate("() => JSON.parse(localStorage.getItem('standin-calls') || '[]')") or []) if c['kind'] == kind]
def check_record(game, record):
    out = subprocess.run(['node', '-e', f"import('{RAKU_DIR}/src/tables/{game}-record.js').then(m => process.stdout.write(JSON.stringify(m.checkRecord(JSON.parse(process.argv[1])))))", json.dumps(record)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)

def new_context(b, **kw):
    ctx = b.new_context(**({'viewport': {'width': 1280, 'height': 900}} | kw))
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://typeahead.waow.tech/**']:
        ctx.route(host, route)
    return ctx
def watch(pg, sink):
    pg.on('console', lambda m: sink.append((m.type, m.text, (m.location or {}).get('url', ''))))
    pg.on('pageerror', lambda e: sink.append(('pageerror', str(e), RAKU)))

def play_sevenup(tp, s1, limit=150):
    deadline = time.time() + limit
    while time.time() < deadline:
        try:
            if s1.locator('#end').is_visible(): return True
            for sel in ['#offers button:not([disabled])', '#roll:not([disabled])', '#pass:not([disabled])']:
                loc = s1.locator(sel).first
                if loc.count() and loc.is_visible():
                    loc.click(); time.sleep(0.6); break
            else: time.sleep(0.5)
        except Exception: time.sleep(0.5)
    return False
def play_daisy(mine, limit=180):
    deadline = time.time() + limit
    while time.time() < deadline:
        try:
            if mine.locator('#end').is_visible(): return True
            if mine.locator('#roll').is_visible() and mine.locator('#roll').is_enabled():
                m = re.search(r'(\d+)', mine.locator('#turn-line').inner_text() or '')
                if m and int(m.group(1)) >= 12 and mine.locator('#bank').is_enabled(): mine.locator('#bank').click()
                else: mine.locator('#roll').click()
                time.sleep(1.2)
            else: time.sleep(0.5)
        except Exception: time.sleep(0.5)
    return False

dialog = '.pane.front .rk-dialog'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])

    # ---------- 1. signed out ----------
    ctx = new_context(b)
    popups = []
    ctx.on('page', lambda pg: popups.append(pg))
    tp = ctx.new_page()
    con = []; watch(tp, con)
    tp.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Atable%2Fsevenup&a=0')
    ok = wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Seven-Up', 10)
    check('signed out: the account button says Sign in; the table bar offers "Sign in to save matches"', ok and wait_for(lambda: 'Sign in' in tp.inner_text('.account-btn') and tp.is_visible('.pane.front .signin-btn') and tp.inner_text('.pane.front .signin-btn') == 'Sign in to save matches', 5))
    check('the sign-in library starts without the page waiting for it (Raku drew first)', wait_for(lambda: len(standin_calls(tp, 'load')) == 1, 5) and standin_calls(tp, 'load')[0]['clientId'].startswith('http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5180%2F&scope='))
    tp.click('.account-btn')
    check("the account menu (signed out): a sign-in form and Raku's promise, word for word", tp.is_visible('.account-menu') and tp.is_visible('.account-menu .signin-handle') and PROMISE in tp.inner_text('.account-menu'))
    tp.screenshot(path=str(OUT / 's4-menu-signed-out.png'))
    tp.keyboard.press('Escape')
    check('Escape closes the menu', wait_for(lambda: not tp.is_visible('.account-menu'), 3))

    # ---------- 2. Seven-Up: play, Save → sign in → Allow once ----------
    s1 = tp.frame_locator('.pane.front .table-seat[data-seat="1"] iframe').frame_locator('iframe')
    ok = wait_for(lambda: '@you' in s1.locator('#handle').inner_text(), 25)
    check('Seven-Up loads; signed out you sit as @you', ok)
    over = play_sevenup(tp, s1)
    check('Seven-Up: a match against the bot plays to the end', over)
    s1.locator('#save').click()
    ok = wait_for(lambda: tp.is_visible(dialog) and 'Save this Seven-Up match?' in tp.inner_text(dialog), 5)
    check("Save while signed out opens Raku's prompt (drawn outside the tiles): sign in first, the promise, what will be saved", ok and PROMISE in tp.inner_text(dialog) and tp.is_visible(f'{dialog} .signin-handle') and tp.is_visible(f'{dialog} details.rk-record'))
    check('…the tile says it is asking', wait_for(lambda: s1.locator('#save').is_disabled(), 3))
    tp.screenshot(path=str(OUT / 's4-save-signed-out.png'))
    n_pages = len(popups)
    tp.click(f'{dialog} .signin-form button.primary')
    check('an empty handle is caught before any window opens', wait_for(lambda: 'Type your handle' in tp.inner_text(f'{dialog} .signin-status'), 3) and len(popups) == n_pages)
    tp.fill(f'{dialog} .signin-handle', '@Thunderbird.Cafe')
    n_pages = len(popups)
    tp.click(f'{dialog} .signin-form button.primary')
    ok = wait_for(lambda: len(popups) > n_pages, 5)
    win = popups[-1] if ok else None
    check('Sign in opens the small sign-in window straight from the click', ok)
    if win:
        done = wait_for(lambda: 'Signed in. You can close this window.' in win.inner_text('body'), 8)
        check('the small window finishes the sign-in and says so; Raku itself does not start in it', done and win.locator('.addr').count() == 0) if not win.is_closed() else check('the small window finished the sign-in (and closed)', True)
    ok = wait_for(lambda: 'Save this match to @thunderbird.cafe?' in tp.inner_text(dialog), 10)
    check('…then the prompt for that account: "Save this match to @thunderbird.cafe?" with Allow once / Always / No', ok and all(tp.is_visible(f"{dialog} .actions button:has-text('{t}')") for t in ['Allow once', 'Always', 'No']))
    asked = standin_calls(tp, 'popup')
    check('the first sign-in asked for your account plus Seven-Up\'s set only (Q36)', asked and asked[-1]['scope'] == 'atproto include:cafe.thunderbird.sevenup.authPlay' and asked[-1]['input'] == 'thunderbird.cafe', str(asked))
    rec_text = tp.eval_on_selector(f'{dialog} details.rk-record pre', 'p => p.textContent')
    shown = json.loads(rec_text)
    check('the prompt shows the record: your seat is the account you save to; the house is the pinned one', shown['players'][0]['did'] == A and shown['players'][0]['handle'] == A_HANDLE and shown['players'][1].get('bot') is True and shown['house'] == PINS['sevenup']['house'])
    check('the prompt shows only its words (no stray "null")', 'null' not in tp.inner_text(dialog).replace('"null"', ''))
    tp.screenshot(path=str(OUT / 's4-save-ask.png'))
    tp.click(f"{dialog} .actions button:has-text('Allow once')")
    ok = wait_for(lambda: 'Match saved' in tp.inner_text(dialog), 8)
    key = next((k for k in saved if k[1] == 'cafe.thunderbird.sevenup.match'), None)
    check('Allow once saves: "Match saved · Saved to @thunderbird.cafe." with a link to the record', ok and 'Saved to @thunderbird.cafe.' in tp.inner_text(dialog) and 'pdsls.dev/at://' in tp.eval_on_selector(f'{dialog} a', 'a => a.href'))
    check('…to your own repo, collection cafe.thunderbird.sevenup.match, record key = the match id', key is not None and key[0] == A and saved[key]['matchId'] == key[2], str(saved.keys()))
    check("…and the saved record passes Seven-Up's own check", key is not None and check_record('sevenup', saved[key]) is None)
    check('the tile says "Saved to @thunderbird.cafe."', wait_for(lambda: 'Saved to @thunderbird.cafe.' in s1.locator('#save-status').inner_text(), 5))
    tp.click(f"{dialog} .actions button:has-text('Close')")
    check('the seat line: "@thunderbird.cafe ✓ · 1 match saved"', wait_for(lambda: acct(tp) == '@thunderbird.cafe ✓ · 1 match saved', 8), acct(tp))
    check('the note under the bar says what was saved, with the link', 'Saved to @thunderbird.cafe.' in tp.inner_text('.pane.front .table-saved'))
    check("the account button shows the account's avatar from Bluesky's picture server", wait_for(lambda: tp.eval_on_selector('.account-btn img.acct-av', 'i => i.src.startsWith("https://cdn.bsky.app/")'), 5))
    check("the tile's Save now reads Saved (greyed): one save per match", s1.locator('#save').inner_text() == 'Saved' and s1.locator('#save').is_disabled())
    tp.screenshot(path=str(OUT / 's4-saved.png'))
    n_pages = len(popups)
    tp.reload()
    check('reloading Raku: still signed in (the account comes back without a window), the count read again', wait_for(lambda: acct(tp) == '@thunderbird.cafe ✓ · 1 match saved', 10) and len(popups) == n_pages, acct(tp))

    # ---------- 3. Daisy: signed in, but without Daisy's set → Always (one more Authorize) ----------
    tp.click('.newtab')
    tp.fill('.addr', 'raku:table/daisy/bot'); tp.press('.addr', 'Enter')   # stage 5: the bot has its own address
    ok = wait_for(lambda: tp.inner_text('.pane.front .table-bar h1') == 'Daisy', 10)
    check("Daisy's bar: signed in as @thunderbird.cafe; Daisy asks for its permission at your first save", ok and wait_for(lambda: '@thunderbird.cafe ✓' in acct(tp) and 'Daisy asks for its permission at your first save' in acct(tp), 5), acct(tp))
    mine = tp.frame_locator('.pane.front .seat-mine iframe').frame_locator('iframe')
    ok = wait_for(lambda: mine.locator('#glazes button').count() >= 6, 25)
    check('signed in when the table opens: you sit as the account (the tile says @thunderbird.cafe)', ok and wait_for(lambda: 'thunderbird.cafe' in mine.locator('#handle').inner_text(), 5), mine.locator('#handle').inner_text() if ok else '')
    mine.locator('#glazes button').first.click()
    check('Daisy: a match against the bot plays to the end', play_daisy(mine))
    mine.locator('#save').click()
    ok = wait_for(lambda: tp.is_visible(dialog) and 'Save this match to @thunderbird.cafe?' in tp.inner_text(dialog), 5)
    check("Daisy's prompt says the game asks for its own permission first, and names the bot and the dice", ok and 'Daisy asks for its own permission the first time you save' in tp.inner_text(dialog) and "the table's bot" in tp.inner_text(dialog) and 'nobody else can check the dice' in tp.inner_text(dialog))
    n_pages = len(popups)
    tp.click(f"{dialog} .actions button:has-text('Always')")
    check('Always opens one short Authorize from the click', wait_for(lambda: len(popups) > n_pages, 5))
    ok = wait_for(lambda: 'Match saved' in tp.inner_text(dialog), 10)
    asked = standin_calls(tp, 'popup')
    check("…asking for Daisy's set and keeping Seven-Up's (the sign-in grows, Q36)", asked[-1]['scope'] == 'atproto include:cafe.thunderbird.sevenup.authPlay include:cafe.thunderbird.daisy.authPlay', asked[-1]['scope'])
    dkeys = [k for k in saved if k[1] == 'cafe.thunderbird.daisy.match']
    check("Daisy's match saved to @thunderbird.cafe, and the record passes Daisy's own check (the dice re-checked)", ok and len(dkeys) == 1 and dkeys[0][0] == A and check_record('daisy', saved[dkeys[0]]) is None, str(dkeys))
    tp.click(f"{dialog} .actions button:has-text('Close')")
    mine.locator('#rematch').click()
    ok = wait_for(lambda: not mine.locator('#end').is_visible(), 30)
    check('Daisy: the bot agrees to a rematch', ok)
    if wait_for(lambda: mine.locator('#glazes').is_visible(), 3): mine.locator('#glazes button').first.click()
    check('Daisy: a rematch against the bot plays to the end', play_daisy(mine))
    mine.locator('#save').click()
    # (tp.evaluate keeps Playwright answering the stand-in PDS while this waits: its routes run only then)
    ok = wait_for(lambda: tp.evaluate('1') and len([k for k in saved if k[1] == 'cafe.thunderbird.daisy.match']) == 2, 8)
    check('with Always on, the next save goes without a prompt…', ok and not tp.is_visible(dialog), f"{[k for k in saved if k[1] == 'cafe.thunderbird.daisy.match']} dialog={tp.is_visible(dialog)}")
    check('…and still says "Saved to @thunderbird.cafe without asking", with the link and Turn off', wait_for(lambda: 'without asking' in tp.inner_text('.pane.front .table-saved'), 5) and tp.is_visible(".pane.front .table-saved a") and tp.is_visible(".pane.front .table-saved button:has-text('Turn off Always')"))
    tp.screenshot(path=str(OUT / 's4-daisy-always.png'))

    # ---------- 4. the account menu: Always, another account, switching, signing out ----------
    tp.click('.account-btn')
    check('the menu lists "Saves without asking: Daisy · @thunderbird.cafe" with Turn off', wait_for(lambda: 'Daisy · @thunderbird.cafe' in tp.inner_text('.account-menu .acct-always'), 3))
    tp.screenshot(path=str(OUT / 's4-menu.png'))
    tp.click('.account-menu .acct-always button:has-text("Turn off")')
    check('Turn off removes it', not tp.is_visible('.account-menu .acct-always') or 'Daisy' not in tp.inner_text('.account-menu'))
    tp.click('.account-menu .acct-add')
    tp.fill('.account-menu .signin-handle', C_HANDLE)
    n_pages = len(popups)
    tp.click('.account-menu .signin-form button.primary')
    ok = wait_for(lambda: tp.eval_on_selector_all('.account-menu .acct-row', 'rs => rs.length') == 2, 10)
    asked = standin_calls(tp, 'popup')
    check('Add another account: signed in from the menu, asking only for the account (no game yet)', ok and asked[-1]['scope'] == 'atproto' and asked[-1]['input'] == C_HANDLE, str(asked[-1:]))
    check('…it is now the current account (ticked)', '@thunderbirdwine.bsky.social' in tp.inner_text('.account-menu .acct-row.on'))
    n_pages = len(popups)
    tp.click(".account-menu .acct-row:has-text('@thunderbird.cafe')")
    check('switching back to an account signed in here needs no window', wait_for(lambda: '@thunderbird.cafe' in tp.inner_text('.account-menu .acct-row.on'), 3) and len(popups) == n_pages)
    tp.keyboard.press('Escape')
    check("the table's seat line follows the current account", wait_for(lambda: '@thunderbird.cafe ✓' in acct(tp), 5))
    tp.click('.account-btn')
    tp.click('.account-menu .acct-out')
    check('Sign out revokes the sign-in and leaves the other account current', wait_for(lambda: any(c['did'] == A for c in standin_calls(tp, 'revoke')), 5) and wait_for(lambda: '@thunderbirdwine.bsky.social' in tp.inner_text('.account-menu .acct-row.on') and tp.eval_on_selector_all('.account-menu .acct-row', 'rs => rs.length') == 1, 5))
    tp.click('.account-menu .acct-out')
    check('signing out the last account: the menu offers a sign-in again; the bar too', wait_for(lambda: tp.is_visible('.account-menu .signin-handle'), 5) and wait_for(lambda: tp.is_visible('.pane.front .signin-btn'), 5))
    tp.keyboard.press('Escape')
    errs = [c for c in con if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU)]
    check("no errors on Raku's page", not errs, str(errs[:5]))
    csp = [c for c in con if ('Content Security Policy' in c[1] or 'Refused' in c[1]) and c[2].startswith(RAKU)]
    check("Raku's own policy refused nothing", not csp, str(csp[:3]))

    # ---------- 5. the window blocked: "Sign in in this tab instead" (Q41) ----------
    bctx = new_context(b)
    bctx.add_init_script("window.open = () => null;")
    bp = bctx.new_page()
    bcon = []; watch(bp, bcon)
    bp.goto(RAKU + '?loader=' + LOADER + f'#t=at%3A%2F%2F{A}%2Fing.dasl.masl%2F3my27d43kry2d,raku%3Atable%2Fsevenup&a=1')
    ok = wait_for(lambda: bp.inner_text('.pane.front .table-bar h1') == 'Seven-Up', 10)
    s1b = bp.frame_locator('.pane.front .table-seat[data-seat="1"] iframe').frame_locator('iframe')
    ok = ok and wait_for(lambda: '@you' in s1b.locator('#handle').inner_text(), 25)
    over = play_sevenup(bp, s1b)
    check('(blocked windows) a Seven-Up match plays to the end', over)
    match_id = bp.eval_on_selector('.pane.front .table-root', 'r => r.dataset.result')
    s1b.locator('#save').click()
    wait_for(lambda: bp.is_visible(dialog), 5)
    bp.fill(f'{dialog} .signin-handle', A_HANDLE)
    bp.click(f'{dialog} .signin-form button.primary')
    ok = wait_for(lambda: bp.is_visible(f'{dialog} .signin-blocked'), 5)
    check('a blocked window: "The sign-in window was blocked." with Try again and Sign in in this tab instead', ok and 'The sign-in window was blocked.' in bp.inner_text(f'{dialog} .signin-blocked') and bp.is_visible(f"{dialog} .signin-blocked button:has-text('Try again')") and bp.is_visible(f"{dialog} .signin-blocked button:has-text('Sign in in this tab instead')"))
    check('…saying other tabs will reload and the match is kept', 'Other tabs will reload' in bp.inner_text(f'{dialog} .signin-blocked') and 'This match is kept' in bp.inner_text(f'{dialog} .signin-blocked'))
    bp.screenshot(path=str(OUT / 's4-blocked.png'))
    bp.click(f"{dialog} .signin-blocked button:has-text('Sign in in this tab instead')")
    ok = wait_for(lambda: bp.is_visible(dialog) and 'Save this match to @thunderbird.cafe?' in bp.inner_text(dialog), 25)
    check('after the trip to the account server and back: the prompt comes back for the kept match', ok)
    red = standin_calls(bp, 'redirect')
    check("…the trip asked for your account plus Seven-Up's set", red and red[-1]['scope'] == 'atproto include:cafe.thunderbird.sevenup.authPlay', str(red))
    check('…and says "Signed in as @thunderbird.cafe."', 'Signed in as @thunderbird.cafe.' in bp.inner_text(dialog))
    check('the tabs came back (both, the table in front); the sign-in left nothing in the address', bp.eval_on_selector_all('.tab', 'ts => ts.length') == 2 and bp.inner_text('.tab.on .tab-title') == 'Seven-Up' and 'state=' not in bp.url and 'code=' not in bp.url, bp.url)
    bp.click(f"{dialog} .actions button:has-text('Allow once')")
    ok = wait_for(lambda: 'Match saved' in bp.inner_text(dialog), 8)
    check('Allow once saves the match that was kept for the trip (same match id)', ok and (A, 'cafe.thunderbird.sevenup.match', match_id) in saved, f'{match_id} {list(saved)}')
    bp.click(f"{dialog} .actions button:has-text('Close')")
    errs = [c for c in bcon if c[0] in ('error', 'pageerror') and c[2].startswith(RAKU)]
    check("(blocked windows) no errors on Raku's page", not errs, str(errs[:5]))

    # ---------- 6. the bar's "Sign in to save matches", and a sign-in that is turned down ----------
    cctx = new_context(b)
    cp = cctx.new_page()
    cp.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Atable%2Fdaisy%2Fbot&a=0')
    wait_for(lambda: cp.is_visible('.pane.front .signin-btn'), 10)
    cp.click('.pane.front .signin-btn')
    check('the bar\'s button opens Raku\'s sign-in, with the promise and what the game will ask', wait_for(lambda: cp.is_visible(dialog) and PROMISE in cp.inner_text(dialog) and 'approve "Daisy"' in cp.inner_text(dialog), 5))
    cp.fill(f'{dialog} .signin-handle', 'nobody.example')
    cp.click(f'{dialog} .signin-form button.primary')
    check('an account the server can\'t find: "Couldn\'t sign in" with the reason, nothing kept', wait_for(lambda: "Couldn't sign in" in cp.inner_text(f'{dialog} .signin-status'), 8) and cp.evaluate("() => localStorage.getItem('raku-accounts')") in (None, '[]'))
    cp.evaluate("() => localStorage.setItem('standin-hold', '1')")
    cp.fill(f'{dialog} .signin-handle', A_HANDLE)
    cp.click(f'{dialog} .signin-form button.primary')
    check('while the small window is open: Cancel (Raku never judges the window by whether it looks closed)', wait_for(lambda: cp.is_visible(f'{dialog} .signin-cancel'), 3) and not cp.is_visible(f'{dialog} .signin-blocked'))
    time.sleep(5)
    check('…no "didn\'t finish" by itself while you approve (the old 4-second check is gone)', cp.is_visible(f'{dialog} .signin-cancel') and "didn't finish" not in cp.inner_text(f'{dialog} .signin-status'))
    cp.click(f'{dialog} .signin-cancel')
    check('…Cancel ends the wait: "Sign-in cancelled."', wait_for(lambda: 'Sign-in cancelled.' in cp.inner_text(f'{dialog} .signin-status') and not cp.is_visible(f'{dialog} .signin-cancel'), 3))
    cp.evaluate("() => localStorage.removeItem('standin-hold')")
    cp.click(f'{dialog} .signin-form button.primary')
    check('…then a sign-in for this table: the dialog closes, the bar shows the account', wait_for(lambda: not cp.is_visible(dialog) and '@thunderbird.cafe ✓' in acct(cp), 10))
    check('…asking for Daisy\'s set', standin_calls(cp, 'popup')[-1]['scope'] == 'atproto include:cafe.thunderbird.daisy.authPlay')
    check('…no "asks for its permission" line now that Daisy is covered', 'asks for its permission' not in acct(cp))

    # ---------- 7. the phone ----------
    m = new_context(b, viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.goto(RAKU + '?loader=' + LOADER)
    mp.wait_for_selector('.account-btn')
    pos = mp.eval_on_selector_all('.bar > *', "es => es.filter(e => getComputedStyle(e).display !== 'none').map(e => [e.className.split(' ')[0], Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().width)])")
    order = [x[0] for x in sorted(pos, key=lambda x: x[1])]
    check('phone: the account button sits between the Raku label and the address (a drawn icon when signed out)', order == ['brand', 'account-btn', 'addr-form'] and mp.eval_on_selector('.account-btn', 'b => !!b.querySelector("svg.icon-person")'), str(pos))
    check('phone: the address keeps most of the row', [x for x in pos if x[0] == 'addr-form'][0][2] > 280, str(pos))
    mp.click('.account-btn')
    box = mp.eval_on_selector('.account-menu', 'm => { const r = m.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; }')
    check('phone: the menu opens as a sheet from the bottom', box == [0, 390, 800], str(box))
    check('phone: no sideways scroll', mp.evaluate('() => document.documentElement.scrollWidth <= 390'))
    mp.screenshot(path=str(OUT / 's4-phone-menu.png'))
    b.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
