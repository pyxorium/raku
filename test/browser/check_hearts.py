# Hearts on tile posts (claude/raku-hearts-plan.md, HT1 to HT15; the approved mockup claude/raku-hearts-mockup.html),
# browser checks in the chat sandbox: the row (as wide as the tile card, the heart at the left group's end of 65%,
# Share at the right edge, its menu opening leftward); counts filling in after the posts (none at zero; distinct
# accounts; a hidden account's hearts left out and not even read); a heart given and taken back (filled, the pop, the
# count, the aria words; the record written to the current account, Bluesky's like shape; deleted on un-heart); quick
# taps saving only the last choice; a failed save putting it back with the line; signed out: "Sign in to heart" then
# the heart given; a sign-in from before hearts: "Sign in again to heart" then the heart given; switching accounts;
# a post's own page; the promise's words; the light look and the phone.
# Everything outside is a Playwright route; the sign-in is the stand-in (test/browser/oauth-standin.js). Tiles don't run
# (screens only: a stand-in loader is enough).
# Usage: python3 test/browser/check_hearts.py <work folder>   (servers.mjs already running on 127.0.0.1:5180)
import hashlib, io, json, re, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
POST = 'cafe.thunderbird.tile.post'
LIKE = 'cafe.thunderbird.tile.like'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
WN = 'did:plc:joer5rzmwgec3dkr4srfmq45'; WN_H = 'thunderbirdwine.bsky.social'
C = 'did:plc:ro563p5faldqu44apudq44k4'; C_H = 'colorado.atprotocol.space'
H = 'did:plc:hiddenaaaaaaaaaaaaaaaaaa'; H_H = 'hidden.fakepds.net'
HANDLES = {T: T_H, P: P_H, WN: WN_H, C: C_H, H: H_H}
PDS = 'https://pds.fakepds.net'
SALT = 'lexicographer.space hide list v1'
FULL = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post&collection=cafe.thunderbird.tile.like rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*'
OLD = FULL.replace('&collection=cafe.thunderbird.tile.like', '')
PROMISE = "Signing in lets Raku save your match results, show you in rooms and game lounges, post tiles from your accounts, and heart tile posts. It asks once, for all of these. Hearts are Raku's own, kept in your account; Raku doesn't touch your Bluesky posts, likes, follows or anything else."

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(640, 360)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def tile(name, color):
    page = f'<!doctype html><h1>{name}</h1>'.encode(); banner = png(color)
    res = {'/': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(page)}, 'mimeType': 'text/html', 'size': len(page)}, 'content-type': 'text/html'},
           '/banner.png': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(banner)}, 'mimeType': 'image/png', 'size': len(banner)}, 'content-type': 'image/png'}}
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': name, 'description': name, 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-01T10:00:00Z'}
TCID = lambda rkey: 'bafyreitile' + hashlib.sha256(rkey.encode()).hexdigest()[:40].replace('0', 'a').replace('1', 'b').replace('8', 'c').replace('9', 'd')
PCID = lambda rkey: 'bafyreipost' + hashlib.sha256(rkey.encode()).hexdigest()[:40].replace('0', 'a').replace('1', 'b').replace('8', 'c').replace('9', 'd')
TILES = {(T, 'maze'): tile('The Escher maze', (60, 160, 150)), (P, 'cube'): tile('Cube', (90, 60, 160))}
NOW = time.time()
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - h * 3600))
def tpost(did, rkey, text, h, tdid, trkey):
    return {'uri': f'at://{did}/{POST}/{rkey}', 'cid': PCID(rkey), 'value': {'$type': POST, 'tile': {'uri': f'at://{tdid}/ing.dasl.masl/{trkey}', 'cid': TCID(trkey)}, 'text': text, 'createdAt': iso(h)}}
POSTS = {T: [tpost(T, '3mza1', 'The maze, from thunderbird.cafe', 1, T, 'maze')],
         P: [tpost(P, '3mzp1', 'A cube from pyxorium', 2, P, 'cube'), tpost(P, '3mzp2', 'Nobody has hearted this one', 3, T, 'maze')]}
U1 = f'at://{T}/{POST}/3mza1'; U2 = f'at://{P}/{POST}/3mzp1'; U3 = f'at://{P}/{POST}/3mzp2'
def heart(did, rkey, uri, rk):
    return {'uri': f'at://{did}/{LIKE}/{rkey}', 'cid': 'bafyreiheart' + rkey.lower().replace('0', 'a').replace('1', 'b').ljust(20, 'a'), 'value': {'$type': LIKE, 'subject': {'uri': uri, 'cid': PCID(rk)}, 'createdAt': iso(0.5)}}
# Already given: C hearts the maze post twice (one account), P and C the cube post, H (hidden) all three; T none.
HEARTS0 = {C: [heart(C, '3hc1', U1, '3mza1'), heart(C, '3hc2', U1, '3mza1'), heart(C, '3hc3', U2, '3mzp1')],
           P: [heart(P, '3hp1', U2, '3mzp1')],
           H: [heart(H, '3hh1', U1, '3mza1'), heart(H, '3hh2', U2, '3mzp1'), heart(H, '3hh3', U3, '3mzp2')]}
hearts = {k: list(v) for k, v in HEARTS0.items()}
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [hashlib.sha256(f'{SALT}\n{H}'.encode()).hexdigest()], 'tiles': []})
state = {'fail_put': False, 'slow_put': 0}
writes = []   # ('put'|'del', did, scope, body)

def grant_allows(scope, collection):
    for tok in scope.split():
        m = re.match(r'^(repo)(?::([^?]*))?(?:\?(.*))?$', tok)
        if not m: continue
        names = [m.group(2)] if m.group(2) else parse_qs(m.group(3) or '').get('collection', [])
        if '*' in names or collection in names: return True
    return False

calls = []
def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'relay1.us-east.bsky.network':
        if q.get('collection') == LIKE: return js({'repos': [{'did': d} for d in hearts if hearts[d]]})
        return js({'repos': [{'did': d} for d in POSTS]})
    if u.hostname == 'plc.directory':
        did = u.path.strip('/'); hd = HANDLES.get(did)
        if not hd: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{hd}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        prof = lambda d: {'did': d, 'handle': HANDLES.get(d, 'handle.invalid'), 'displayName': HANDLES.get(d, 'x').split('.')[0].title(), 'labels': []}
        if u.path.endswith('getProfiles'): return js({'profiles': [prof(d) for d in parse_qs(u.query).get('actors', [])]})
        if u.path.endswith('getProfile'): return js(prof(q.get('actor')))
        return js({'error': 'NotFound'}, 404)
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=HIDE_LIST)
    if u.hostname == 'pds.fakepds.net':
        repo = q.get('repo')
        if u.path.endswith('putRecord'):
            body = json.loads(r.request.post_data or '{}'); scope = q.get('standin_scope', '')
            writes.append(('put', q.get('standin_did'), scope, body))
            if state['slow_put']: time.sleep(state['slow_put'])
            if state['fail_put']: return js({'error': 'InternalServerError', 'message': 'The server answered 502'}, 502)
            if not grant_allows(scope, body.get('collection')): return js({'error': 'ScopeMissingError', 'message': 'Missing required scope'}, 403)
            if body.get('collection') == LIKE:
                hearts.setdefault(body['repo'], []).append({'uri': f"at://{body['repo']}/{LIKE}/{body['rkey']}", 'cid': 'bafyreiwrittenaaaaaaaaaaaa', 'value': body['record']})
            return js({'uri': f"at://{body['repo']}/{body['collection']}/{body['rkey']}", 'cid': 'bafyreiwrittenaaaaaaaaaaaa'})
        if u.path.endswith('deleteRecord'):
            body = json.loads(r.request.post_data or '{}'); scope = q.get('standin_scope', '')
            writes.append(('del', q.get('standin_did'), scope, body))
            if not grant_allows(scope, body.get('collection')): return js({'error': 'ScopeMissingError', 'message': 'Missing required scope'}, 403)
            hearts[body['repo']] = [x for x in hearts.get(body['repo'], []) if not x['uri'].endswith('/' + body['rkey'])]
            return js({})
        if u.path.endswith('listRecords'):
            if q.get('collection') == POST: return js({'records': POSTS.get(repo, [])})
            if q.get('collection') == LIKE: return js({'records': hearts.get(repo, [])})
            return js({'records': []})
        if u.path.endswith('getRecord'):
            if q.get('collection') == POST:
                rec = next((x for x in POSTS.get(repo, []) if x['uri'].endswith('/' + q.get('rkey', ''))), None)
                return js(rec) if rec else js({'error': 'RecordNotFound'}, 400)
            rec = TILES.get((repo, q.get('rkey')))
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{repo}/ing.dasl.masl/{q['rkey']}", 'cid': TCID(q['rkey']), 'value': rec})
        if u.path.endswith('getBlob'):
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
def texts(pg, sel): return pg.eval_on_selector_all(sel, 'els => els.map(e => e.textContent.trim())')
POSTS_URL = RAKU + '#t=raku%3Adiscover%2Fposts&a=0'
enc = lambda s: quote(s, safe='')
def seed(accounts, scopes, extra=''):
    acc = [{'did': d, 'handle': HANDLES[d]} for d in accounts]
    sess = {d: {'scope': s} for d, s in scopes.items()}
    return (f"try {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-accounts', {json.dumps(json.dumps(acc))});"
            f" localStorage.setItem('raku-account', {json.dumps(json.dumps(accounts[0] if accounts else None))});"
            f" localStorage.setItem('standin-sessions', {json.dumps(json.dumps(sess))}); {extra} sessionStorage.setItem('seeded', '1'); }} }} catch {{}}")
def card(uri): return f'.tile-post[data-uri="{uri}"]'
def heart_state(pg, uri):
    return pg.eval_on_selector(f'{card(uri)} .ht-btn', 'b => ({ on: b.getAttribute("aria-pressed"), n: b.querySelector(".ht-count").textContent, label: b.getAttribute("aria-label"), waiting: b.classList.contains("waiting") })')
def reset_hearts():
    hearts.clear(); hearts.update({k: list(v) for k, v in HEARTS0.items()}); writes.clear()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    def new_ctx(init='', **kw):
        ctx = b.new_context(**({'viewport': {'width': 1400, 'height': 900}, 'color_scheme': 'dark'} | kw))
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
            ctx.route(host, route)
        if init: ctx.add_init_script(init)
        return ctx
    errors = []
    def open_posts(ctx):
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(POSTS_URL); pg.wait_for_selector('.discover')
        wait_for(lambda: len(pg.query_selector_all('.tile-post')) == 3, page=pg)
        return pg

    # ---- signed in as thunderbird.cafe, the new set ----
    ctx = new_ctx(seed([T, WN], {T: FULL, WN: FULL}))
    page = open_posts(ctx)
    wait_for(lambda: not heart_state(page, U2)['waiting'], page=page)
    check('every post has a heart in its row, left of Share', all(page.eval_on_selector(card(u), 'c => !!c.querySelector(".ha-row .ha-heart .ht-btn") && !!c.querySelector(".ha-row .ha-share .ps-btn")') for u in (U1, U2, U3)))
    geo = page.eval_on_selector(card(U2), '''c => { const t = c.querySelector('.tp-card').getBoundingClientRect(), r = c.querySelector('.ha-row').getBoundingClientRect(),
      h = c.querySelector('.ht-btn .icon').getBoundingClientRect(), n = c.querySelector('.ht-count').getBoundingClientRect(), s = c.querySelector('.ps-btn').getBoundingClientRect(),
      slot = c.querySelector('.ha-heart').getBoundingClientRect();
      return { t: [t.left, t.right], r: [r.left, r.right], slot: slot.left, heart: h.left, count: (n.left + n.right) / 2, share: s.right }; }''')
    w = geo['t'][1] - geo['t'][0]
    check('the row is as wide as the tile card, Share at its right edge', abs(geo['r'][0] - geo['t'][0]) < 1.5 and abs(geo['r'][1] - geo['t'][1]) < 1.5 and abs(geo['share'] - geo['t'][1]) < 1.5, str(geo))
    check('...the heart\'s slot starts two thirds into the left group (65%: 43% in, plus the row\'s two 6 px gaps, as in the mockup), the heart inside it', abs((geo['slot'] - geo['t'][0]) - (w * 0.65 * 2 / 3 + 12)) < 1.5 and 0 <= geo['heart'] - geo['slot'] < 16, f"slot {(geo['slot'] - geo['t'][0]) / w:.3f} heart +{geo['heart'] - geo['slot']:.1f}px")
    check('counts: distinct accounts, the hidden account left out, none at zero', [heart_state(page, u)['n'] for u in (U1, U2, U3)] == ['1', '2', ''], str([heart_state(page, u) for u in (U1, U2, U3)]))
    check("...a hidden account's hearts aren't even read", not any('listRecords' in c and enc(H) in c and LIKE in c for c in calls))
    check('...the words for screen readers', heart_state(page, U2)['label'] == 'Heart this post (2 hearts)' and heart_state(page, U3)['label'] == 'Heart this post', str(heart_state(page, U2)))
    page.screenshot(path=str(OUT / 'h-list-dark.png'))

    # give a heart
    page.click(f'{card(U3)} .ht-btn')
    s = heart_state(page, U3)
    check('a heart given: filled at once, the count 1, the pop, the words', s['on'] == 'true' and s['n'] == '1' and s['label'] == 'Remove your heart (1 heart)' and page.eval_on_selector(f'{card(U3)} .ht-btn', 'b => b.classList.contains("pop")'), str(s))
    wait_for(lambda: any(x[0] == 'put' for x in writes), page=page)
    put = next(x for x in writes if x[0] == 'put')
    rec = put[3].get('record', {})
    check('...saved to the current account, Bluesky\'s like shape, a TID key', put[1] == T and put[3]['collection'] == LIKE and put[3]['repo'] == T
          and rec.get('$type') == LIKE and rec.get('subject') == {'uri': U3, 'cid': PCID('3mzp2')} and re.match(r'^[2-7a-z]{13}$', put[3]['rkey'] or '') and set(rec) == {'$type', 'subject', 'createdAt'}, json.dumps(put[3])[:200])
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / 'h-given.png'))
    # take it back
    page.click(f'{card(U3)} .ht-btn')
    wait_for(lambda: any(x[0] == 'del' for x in writes), page=page)
    d = next(x for x in writes if x[0] == 'del')
    check('un-hearting deletes that record; the heart outline again, no number', d[1] == T and d[3] == {'repo': T, 'collection': LIKE, 'rkey': put[3]['rkey']} and heart_state(page, U3)['on'] == 'false' and heart_state(page, U3)['n'] == '', str(d))
    # quick taps: heart, un-heart, heart → one heart
    writes.clear()
    page.eval_on_selector(f'{card(U1)} .ht-btn', 'b => { b.click(); b.click(); b.click(); }')   # three taps before any save is back
    page.wait_for_timeout(1500)
    check('quick taps save only the last choice: one heart written, none deleted', [x[0] for x in writes] == ['put'] and heart_state(page, U1)['on'] == 'true' and heart_state(page, U1)['n'] == '2', f"{[x[0] for x in writes]} {heart_state(page, U1)}")
    # Refresh: counts read again, yours counted once
    page.click('.dv-refresh, button:has-text("Refresh")')
    wait_for(lambda: len(page.query_selector_all('.tile-post')) == 3 and not heart_state(page, U1)['waiting'], page=page)
    page.wait_for_timeout(500)
    check('after Refresh, the count includes your heart once', heart_state(page, U1)['n'] == '2' and heart_state(page, U1)['on'] == 'true', str(heart_state(page, U1)))
    # a failed save
    state['fail_put'] = True
    page.click(f'{card(U2)} .ht-btn')
    gone = wait_for(lambda: page.is_visible(f'{card(U2)} .ht-note') and heart_state(page, U2)['on'] == 'false', page=page)
    check('a failed save: the heart back as it was, "Couldn\'t save your heart. Try again."', gone and page.inner_text(f'{card(U2)} .ht-note') == 'Couldn’t save your heart. Try again.' and heart_state(page, U2)['n'] == '2', str(heart_state(page, U2)))
    page.screenshot(path=str(OUT / 'h-failed.png'))
    check('...and the line goes after a few seconds', wait_for(lambda: page.is_hidden(f'{card(U2)} .ht-note'), timeout=8, page=page))
    state['fail_put'] = False
    # the Share menu opens leftward, on the card
    page.click(f'{card(U2)} .ps-btn')
    m = page.eval_on_selector(card(U2), 'c => { const m = c.querySelector(".ps-menu").getBoundingClientRect(), t = c.querySelector(".tp-card").getBoundingClientRect(); return [m.left >= t.left - 1, Math.abs(m.right - t.right) < 2]; }')
    check('the Share menu opens leftward from the right edge', m == [True, True], str(m))
    page.keyboard.press('Escape')
    # switching accounts: hearts shown as the new current account's
    page.click('.account-btn'); page.wait_for_selector('.account-menu:not([hidden])')
    page.click(f'.account-menu .acct-row:has-text("{WN_H}")')
    page.keyboard.press('Escape')
    sw = wait_for(lambda: heart_state(page, U1)['on'] == 'false' and heart_state(page, U1)['n'] == '2', page=page)
    check('switching accounts: the heart shows the new current account\'s (not yours from the other), the count the same', sw, str(heart_state(page, U1)))
    writes.clear()
    page.click(f'{card(U2)} .ht-btn')
    wait_for(lambda: writes, page=page)
    check('...and a heart now comes from that account', writes and writes[0][1] == WN and writes[0][3]['repo'] == WN, str(writes[:1]))
    check('no page errors (signed in)', not errors, str(errors))
    ctx.close()

    # ---- a post's own page ----
    reset_hearts()
    ctx = new_ctx(seed([T], {T: FULL}))
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(RAKU + f'#t={enc(U2)}&a=0'); pg.wait_for_selector('.tpp-head')
    ok = wait_for(lambda: pg.query_selector(f'{card(U2)} .ht-btn') and heart_state(pg, U2)['n'] == '2', page=pg)
    check("a post's own page: the heart and its count", ok, str(heart_state(pg, U2) if pg.query_selector(card(U2)) else 'no card'))
    ctx.close()

    # ---- signed out ----
    reset_hearts()
    ctx = new_ctx()
    page = open_posts(ctx)
    wait_for(lambda: heart_state(page, U2)['n'] == '2', page=page)
    check('signed out: the counts show', [heart_state(page, u)['n'] for u in (U1, U2, U3)] == ['1', '2', ''])
    page.click(f'{card(U3)} .ht-btn')
    page.wait_for_selector('.rk-dialog .signin-handle')
    check('...tapping opens "Sign in to heart", with the permission line and the promise',
          page.inner_text('.rk-dialog h2') == 'Sign in to heart' and 'hearting tile posts' in page.inner_text('.rk-dialog .rk-details') and page.inner_text('.rk-dialog .rk-promise') == PROMISE)
    page.screenshot(path=str(OUT / 'h-signin.png'))
    page.fill('.rk-dialog .signin-handle', T_H)
    with ctx.expect_page() as pop: page.click('.rk-dialog .signin-row button.primary')
    given = wait_for(lambda: page.is_hidden('.rk-dialog') and heart_state(page, U3)['on'] == 'true', timeout=15, page=page)
    wait_for(lambda: writes, page=page)
    check('...once signed in, the heart is given (no second tap)', given and writes and writes[0][0] == 'put' and writes[0][1] == T and writes[0][3]['record']['subject']['uri'] == U3, f"{heart_state(page, U3)} {writes[:1]}")
    check('no page errors (signed out)', not errors, str(errors))
    ctx.close()

    # ---- a sign-in from before hearts ----
    reset_hearts()
    ctx = new_ctx(seed([T], {T: OLD}))
    page = open_posts(ctx)
    wait_for(lambda: heart_state(page, U2)['n'] == '2', page=page)
    page.click(f'{card(U2)} .ht-btn')
    page.wait_for_selector('.rk-dialog h2')
    check('an older sign-in: "Sign in again to heart", the handle filled in, nothing written',
          page.inner_text('.rk-dialog h2') == 'Sign in again to heart' and page.input_value('.rk-dialog .signin-handle') == T_H and not writes and heart_state(page, U2)['on'] == 'false', page.inner_text('.rk-dialog h2'))
    page.screenshot(path=str(OUT / 'h-again.png'))
    with ctx.expect_page() as pop: page.click('.rk-dialog .signin-row button.primary')
    given = wait_for(lambda: page.is_hidden('.rk-dialog') and heart_state(page, U2)['on'] == 'true' and heart_state(page, U2)['n'] == '3', timeout=15, page=page)
    wait_for(lambda: writes, page=page)
    check('...approved again: the heart given, with the new grant', given and writes and writes[0][0] == 'put' and 'cafe.thunderbird.tile.like' in writes[0][2], f"{heart_state(page, U2)} {[(x[0], x[2][-60:]) for x in writes[:1]]}")
    ctx.close()
    reset_hearts()
    ctx = new_ctx(seed([T], {T: OLD}, "localStorage.setItem('standin-nohearts', '1');"))
    page = open_posts(ctx)
    wait_for(lambda: heart_state(page, U2)['n'] == '2', page=page)
    page.click(f'{card(U2)} .ht-btn'); page.wait_for_selector('.rk-dialog h2')
    with ctx.expect_page() as pop: page.click('.rk-dialog .signin-row button.primary')
    said = wait_for(lambda: page.is_hidden('.rk-dialog') and page.is_visible(f'{card(U2)} .ht-note'), timeout=15, page=page)
    check('..."Raku" not approved for hearts: nothing written, a line says so', said and not writes and 'wasn’t approved' in page.inner_text(f'{card(U2)} .ht-note') and heart_state(page, U2)['on'] == 'false')
    check('no page errors (older sign-in)', not errors, str(errors))
    ctx.close()

    # ---- the light look and the phone ----
    reset_hearts()
    ctx = new_ctx(seed([T], {T: FULL}), color_scheme='light')
    page = open_posts(ctx)
    wait_for(lambda: heart_state(page, U2)['n'] == '2', page=page)
    page.click(f'{card(U3)} .ht-btn'); page.wait_for_timeout(400)
    col = page.eval_on_selector(f'{card(U3)} .ht-btn', 'b => [getComputedStyle(b).color, getComputedStyle(document.documentElement).getPropertyValue("--glaze").trim()]')
    check('light look: your heart in the light style\'s own accent', col[1] and col[0].replace(' ', '') != '', str(col))
    page.screenshot(path=str(OUT / 'h-light.png'))
    ctx.close()
    ctx = new_ctx(seed([T], {T: FULL}), viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    pg = ctx.new_page(); pg.goto(POSTS_URL); pg.wait_for_selector('.discover')
    wait_for(lambda: len(pg.query_selector_all('.tile-post')) == 3 and heart_state(pg, U2)['n'] == '2', page=pg)
    g = pg.eval_on_selector(card(U2), '''c => { const t = c.querySelector('.tp-card').getBoundingClientRect(), h = c.querySelector('.ha-heart').getBoundingClientRect(), s = c.querySelector('.ps-btn').getBoundingClientRect();
      return { wide: document.documentElement.scrollWidth <= innerWidth, heart: (h.left - t.left - 12) / (t.right - t.left), share: Math.abs(s.right - t.right) }; }''')
    check('phone: the row fits, the heart at the same place (65%), Share at the card\'s right edge', g['wide'] and abs(g['heart'] - 0.65 * 2 / 3) < 0.02 and g['share'] < 1.5, str(g))
    pg.screenshot(path=str(OUT / 'h-phone.png'))
    ctx.close()
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
