# Writing tile posts from inside Raku (claude/raku-write-posts-plan.md, WP1 to WP13; the approved mockup
# claude/raku-write-posts-mockup.html) and Raku's one sign-in (WP3 to WP5, WP11), browser checks in the chat sandbox:
# Post on a tile's tab only for a tile of an account signed in here (WP1); the post box (the tile, the counter, More,
# From starting on the tile's account, posting from another account, WP2); Posting… and the Posted note; the record
# written (the tile's exact version, validate false, a TID key) and read back; staying on the tile; See it in Tile
# posts (a new tab, the post at the top without waiting); a failed write keeping the words; a failed read-back's
# warning; a sign-in without tile posts asking for "Raku" again from the click; Write a post (signed in: your tiles by
# account, hidden ones left out, "Your tiles" back; after posting, the post at the top when the box closes); Write a
# post signed out (Sign in to post, one window asking for the one set); the empty page's words; the promise; the phone.
# Everything outside is a Playwright route; the sign-in is the stand-in (test/browser/oauth-standin.js), which expands
# "Raku" into the grouped form Bluesky handed back in the probe.
# Usage: python3 test/browser/check_write.py <work folder>   (servers.mjs already running on 127.0.0.1:5180)
import hashlib, io, json, re, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
COLL = 'cafe.thunderbird.tile.post'
T = 'did:plc:6vxjigxrqizmbo56gojxico3'; T_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
X = 'did:plc:someoneelseaaaaaaaaaaaaa'; X_H = 'alice.fakepds.net'      # an account nobody here is signed in to
HANDLES = {T: T_H, P: P_H, X: X_H}
PDS = 'https://pds.fakepds.net'
SALT = 'lexicographer.space hide list v1'
RAKU_SCOPE = 'atproto include:cafe.thunderbird.authRaku'
FULL = 'repo?collection=cafe.thunderbird.daisy.lounge&collection=cafe.thunderbird.daisy.match&collection=cafe.thunderbird.sevenup.match&collection=cafe.thunderbird.tile.post rpc?lxm=cafe.thunderbird.daisy.lounge.enter&lxm=cafe.thunderbird.rooms.join&aud=*'
PARTIAL = FULL.replace('&collection=cafe.thunderbird.tile.post', '')

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(640, 360)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def tile(name, desc, color, when):
    page = f'<!doctype html><h1>{name}</h1>'.encode(); banner = png(color)
    res = {'/': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(page)}, 'mimeType': 'text/html', 'size': len(page)}, 'content-type': 'text/html'},
           '/banner.png': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(banner)}, 'mimeType': 'image/png', 'size': len(banner)}, 'content-type': 'image/png'}}
    return {'$type': 'ing.dasl.masl', 'tile': {'name': name, 'description': desc, 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': when}
TCID = lambda rkey: 'bafyreitile' + hashlib.sha256(rkey.encode()).hexdigest()[:40].replace('0', 'a').replace('1', 'b').replace('8', 'c').replace('9', 'd')
TILES = {
    (P, '3mzmaze'): tile('Escher maze', 'Wander an impossible little maze', (60, 160, 150), '2026-11-06T10:00:00Z'),
    (P, '3mztape'): tile('Mixtape C60: Night Bus', 'Twelve songs for the last bus home', (190, 120, 60), '2026-10-21T10:00:00Z'),
    (P, '3mzhide'): tile('A hidden tile', 'Not shown', (90, 90, 90), '2026-11-07T10:00:00Z'),
    (T, '3mzforest'): tile('Winter Forest', 'Snow, pines and a lamp post', (220, 230, 240), '2026-10-28T10:00:00Z'),
    (X, '3mzrain'): tile('Rain on the roof', 'Someone else’s tile', (60, 80, 110), '2026-11-01T10:00:00Z'),
}
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [], 'tiles': [hashlib.sha256(f'{SALT}\n{P}\n3mzhide'.encode()).hexdigest()]})
NOW = time.time()
OLD_POST = {'uri': f'at://{T}/{COLL}/3mzoldpost222', 'cid': 'bafyreipostold', 'value': {'$type': COLL, 'tile': {'uri': f'at://{T}/ing.dasl.masl/3mzforest', 'cid': TCID('3mzforest')},
            'text': 'An older post', 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - 7200))}}
written = {}     # (did, rkey) -> record (what the account server holds)
puts = []        # every putRecord the server saw: { did, scope, body }
state = {'fail_put': False, 'mangle': False, 'lag': False, 'empty': False}

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
    if u.hostname == 'relay1.us-east.bsky.network': return js({'repos': []})
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
            puts.append({'did': q.get('standin_did'), 'scope': scope, 'body': body})
            if state['fail_put']: return js({'error': 'InternalServerError', 'message': 'The server answered 502'}, 502)
            if not grant_allows(scope, body.get('collection')): return js({'error': 'ScopeMissingError', 'message': 'Missing required scope'}, 403)
            rec = dict(body['record'])
            if state['mangle']: rec['text'] = 'changed on the way'
            written[(body['repo'], body['rkey'])] = rec
            return js({'uri': f"at://{body['repo']}/{body['collection']}/{body['rkey']}", 'cid': 'bafyreiwritten' + body['rkey']})
        if u.path.endswith('listRecords'):
            if q.get('collection') == COLL:
                if state['empty']: return js({'records': []})
                mine = [] if state['lag'] else [{'uri': f'at://{d}/{COLL}/{k}', 'cid': 'bafyreiwritten' + k, 'value': v} for (d, k), v in written.items() if d == repo]
                return js({'records': (mine + ([OLD_POST] if repo == T else []))[:int(q.get('limit', 50))]})
            if q.get('collection') == 'ing.dasl.masl':
                recs = [{'uri': f'at://{d}/ing.dasl.masl/{k}', 'cid': TCID(k), 'value': v} for (d, k), v in TILES.items() if d == repo]
                return js({'records': recs})
            return js({'records': []})
        if u.path.endswith('getRecord'):
            if q.get('collection') == COLL:
                v = written.get((repo, q.get('rkey')))
                return js({'uri': f"at://{repo}/{COLL}/{q['rkey']}", 'cid': 'bafyreiwritten' + q['rkey'], 'value': v}) if v else js({'error': 'RecordNotFound'}, 400)
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
def safe_text(pg, sel):
    try: return pg.inner_text(sel, timeout=2000)
    except Exception: return ''
def texts(pg, sel): return pg.eval_on_selector_all(sel, 'els => els.map(e => e.textContent.trim())')
def tile_url(did, rkey): return RAKU + '#t=' + f'at%3A%2F%2F{did.replace(":", "%3A")}%2Fing.dasl.masl%2F{rkey}' + '&a=0'
POSTS_URL = RAKU + '#t=raku%3Adiscover%2Fposts&a=0'

def seed(accounts, scopes):
    """Signed in on this browser already: Raku's account list and the stand-in's sign-ins (scopes: did -> granted)."""
    acc = [{'did': d, 'handle': HANDLES[d]} for d in accounts]
    sess = {d: {'scope': s} for d, s in scopes.items()}
    # (try: the script also runs in the tiles' sandboxed frames, which have no storage)
    return (f"try {{ if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-accounts', {json.dumps(json.dumps(acc))});"
            f" localStorage.setItem('raku-account', {json.dumps(json.dumps(accounts[0] if accounts else None))});"
            f" localStorage.setItem('standin-sessions', {json.dumps(json.dumps(sess))}); sessionStorage.setItem('seeded', '1'); }} }} catch {{}}")

import traceback
try:
  pw_ctx = sync_playwright()
except Exception: raise
with pw_ctx as pw:
    b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
    def new_ctx(init='', **kw):
        ctx = b.new_context(**({'viewport': {'width': 1400, 'height': 900}} | kw))
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
            ctx.route(host, route)
        if init: ctx.add_init_script(init)
        return ctx
    errors = []
    ctx = new_ctx(seed([T, P], {T: FULL, P: FULL}))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ---- Post on a tile's tab (WP8 A, WP1) ----
    page.goto(tile_url(P, '3mzmaze'))
    btn = wait_for(lambda: page.is_visible('.post-btn') and page.query_selector('.post-btn'), page=page)
    check("Post shows on a tile of one of your accounts (pyxorium.com's tile, signed in here)", btn, '')
    check('...beside the address box, after the star: its icon and "Post"', page.eval_on_selector('.bar', 'b => { const f = b.querySelector(".addr-form"); return f.nextElementSibling.classList.contains("post-btn"); }')
          and page.inner_text('.post-btn').strip() == 'Post' and page.eval_on_selector('.post-btn svg', 's => s.classList.contains("icon-posts")'))
    page.goto(tile_url(X, '3mzrain'))
    wait_for(lambda: page.is_visible('.star-btn'), page=page)
    page.wait_for_timeout(500)
    check("...but not on someone else's tile (WP1)", page.is_hidden('.post-btn'))
    page.goto(tile_url(P, '3mzmaze'))
    wait_for(lambda: page.is_visible('.post-btn'), page=page)
    page.screenshot(path=str(OUT / 'w1-tab.png'))

    # ---- the post box (WP9) ----
    page.click('.post-btn')
    wait_for(lambda: page.is_visible('.rk-dialog .wp-words'), page=page)
    d = '.rk-dialog'
    check('the post box over the tab: "Post this tile", the help line, the tile and its author', page.inner_text(f'{d} h2') == 'Post this tile'
          and page.inner_text(f'{d} .wp-help') == 'Share it in Tile posts, where people can play it right in the post. A few words, or just the tile.'
          and page.inner_text(f'{d} .wp-tile-name') == 'Escher maze' and wait_for(lambda: page.inner_text(f'{d} .wp-tile-by') == f'by @{P_H}', page=page), page.inner_text(f'{d} .wp-tile-by'))
    check("...its banner, from the tile's own server", wait_for(lambda: page.eval_on_selector(f'{d} .wp-tile-pic img', 'i => i.complete && i.naturalWidth > 0'), page=page))
    opts = page.eval_on_selector_all(f'{d} #wp-from option', 'os => os.map(o => o.textContent)')
    check("From: your signed-in accounts, starting on the tile's own (WP2, WP9)", opts == [f'@{P_H} (the tile’s account)', f'@{T_H}'] and page.eval_on_selector(f'{d} #wp-from', 's => s.selectedIndex') == 0, str(opts))
    check('...the counter, and More folded with the alt hint (the tile’s description) and a language box', page.inner_text(f'{d} .wp-count') == '0 / 300'
          and not page.eval_on_selector(f'{d} .wp-more', 'x => x.open') and page.get_attribute(f'{d} #wp-alt', 'placeholder') == 'Wander an impossible little maze')
    check('...the tile is still running behind the box (the tab not left)', page.evaluate('location.hash').startswith('#t=at%3A%2F%2F'))
    page.fill(f'{d} #wp-words', 'x' * 301)
    check('over 300: the counter says so and Post to Raku waits', 'over' in page.get_attribute(f'{d} .wp-count', 'class') and page.is_disabled(f'{d} .actions button.primary'))
    page.fill(f'{d} #wp-words', 'Walk the maze, then find the door to the forest.')
    page.click(f'{d} .wp-more summary')
    page.fill(f'{d} #wp-alt', 'A small 3D maze you walk with the arrow keys.')
    page.fill(f'{d} #wp-lang', 'en')
    page.select_option(f'{d} #wp-from', T)
    page.screenshot(path=str(OUT / 'w2-box-more.png'))
    page.click(f'{d} .actions button.primary')
    wait_for(lambda: page.is_visible(f'{d} .wp-done'), page=page)
    check('Posted: the note, the post’s address with Copy, See it in Tile posts and Close (WP10)', 'Posted to Tile posts.' in safe_text(page, f'{d} .wp-done')
          and re.match(rf'^at://{re.escape(T)}/{COLL}/[234567a-j][234567a-z]{{12}}$', safe_text(page, f'{d} .wp-addr code')) is not None
          and texts(page, f'{d} .actions button') == ['See it in Tile posts', 'Close'], safe_text(page, f'{d} .wp-addr code'))
    put = puts[-1] if puts else {'did': None, 'scope': '', 'body': {'record': {'tile': None}, 'repo': None, 'collection': None, 'rkey': ''}}
    rec = put['body']['record']
    check('the record went to the account chosen in From (thunderbird.cafe posting a pyxorium.com tile, WP2)', put['did'] == T and put['body']['repo'] == T and put['body']['collection'] == COLL)
    check("...naming the tile's exact version (its record's uri by DID and cid)", rec['tile'] == {'uri': f'at://{P}/ing.dasl.masl/3mzmaze', 'cid': TCID('3mzmaze')}, str(rec['tile']))
    check('...the words, alt and language; validate false; a TID key', rec.get('text') == 'Walk the maze, then find the door to the forest.' and rec.get('alt') == 'A small 3D maze you walk with the arrow keys.'
          and rec.get('langs') == ['en'] and put['body'].get('validate') is False and re.match(r'^[234567a-j][234567a-z]{12}$', put['body']['rkey']) and rec['$type'] == COLL)
    check('...with the one sign-in’s grant (the grouped form)', put['scope'] == FULL, put['scope'][:80])
    check('...and read back (getRecord after the write)', any('getRecord' in c and COLL in c for c in calls))
    page.screenshot(path=str(OUT / 'w3-posted.png'))
    state['lag'] = True        # the account server's list doesn't have it yet: Tile posts must show it anyway
    page.click(f'{d} .actions button:has-text("See it in Tile posts")')
    wait_for(lambda: len(page.query_selector_all('.pane.front .tile-post')) >= 2, page=page)
    first = page.eval_on_selector_all('.pane.front .tile-post .post-text', 'ps => ps.map(p => p.textContent)')
    check('See it in Tile posts: a new Raku tab, the new post at the top without waiting for the server or Refresh (WP10)', first[:2] == ['Walk the maze, then find the door to the forest.', 'An older post'], str(first))
    strip = texts(page, '.tabstrip .tab .tab-title')
    check('...the tile you posted from is still open in its own tab (you stayed where you were)', 'Escher maze' in strip and 'Discover' in strip and page.is_hidden('.rk-dialog')
          and page.eval_on_selector_all('.pane', 'ps => ps.some(p => !p.classList.contains("front") && p.querySelector(".tile-status, iframe"))'), str(strip))
    page.click('.tabstrip .tab:has-text("Escher maze")')
    wait_for(lambda: page.is_visible('.post-btn'), page=page)

    # ---- failures: a failed write keeps the words; a failed read-back warns (WP10) ----
    page.click('.post-btn'); wait_for(lambda: page.is_visible('.rk-dialog .wp-words'), page=page)
    page.fill(f'{d} #wp-words', 'Second try')
    state['fail_put'] = True
    page.click(f'{d} .actions button.primary')
    wait_for(lambda: 'Couldn’t post' in page.inner_text(f'{d} .rk-status') or "Couldn't post" in page.inner_text(f'{d} .rk-status'), page=page)
    check('a failed write: the error, the words kept, Post to Raku again', "Couldn't post" in page.inner_text(f'{d} .rk-status') and 'try again' in page.inner_text(f'{d} .rk-status')
          and page.input_value(f'{d} #wp-words') == 'Second try' and page.is_enabled(f'{d} .actions button.primary'), page.inner_text(f'{d} .rk-status'))
    state['fail_put'] = False; state['mangle'] = True
    page.click(f'{d} .actions button.primary')
    wait_for(lambda: page.is_visible(f'{d} .wp-warn'), page=page)
    check("a failed read-back: \"It may still have been posted; look in Tile posts before trying again.\"", 'It may still have been posted; look in Tile posts before trying again.' in safe_text(page, f'{d} .wp-warn'))
    page.screenshot(path=str(OUT / 'w4-readback.png'))
    state['mangle'] = False
    page.keyboard.press('Escape')
    check('...Escape closes the box', wait_for(lambda: page.is_hidden('.rk-dialog'), page=page))

    # ---- a sign-in without tile posts: "Raku" again, from the click ----
    page.evaluate(f"(() => {{ const s = JSON.parse(localStorage.getItem('standin-sessions')); s['{P}'].scope = {json.dumps(PARTIAL)}; localStorage.setItem('standin-sessions', JSON.stringify(s)); }})()")
    page.reload(); wait_for(lambda: page.is_visible('.post-btn'), page=page)
    page.click('.post-btn'); wait_for(lambda: page.is_visible('.rk-dialog .wp-words'), page=page)
    page.fill(f'{d} #wp-words', 'From pyxorium')
    n_puts = len(puts)
    page.click(f'{d} .actions button.primary')
    wait_for(lambda: 'approve' in page.inner_text(f'{d} .rk-status'), page=page)
    check('a sign-in whose grant lacks tile posts: the server refuses, and the box says to approve "Raku" again', 'Sign in again to approve “Raku”' in page.inner_text(f'{d} .rk-status')
          and len(puts) == n_puts + 1, page.inner_text(f'{d} .rk-status'))
    try:
        with ctx.expect_page(timeout=8000):
            page.click(f'{d} .actions button.primary')
    except Exception: pass
    wait_for(lambda: page.is_visible(f'{d} .wp-done'), timeout=15, page=page)
    log = page.evaluate("JSON.parse(localStorage.getItem('standin-calls') || '[]')")
    popups = [c for c in log if c.get('kind') == 'popup']
    check('...the next Post opens the small window asking for the one set, "Raku", then posts', popups and popups[-1]['scope'] == RAKU_SCOPE and puts[-1]['did'] == P and FULL in puts[-1]['scope'] and page.is_visible(f'{d} .wp-done'),
          f"{popups[-1:]} last put {puts[-1]['did']} {puts[-1]['scope'][:60]} status={safe_text(page, f'{d} .rk-status')} done={page.is_visible(f'{d} .wp-done')}")
    if page.is_hidden(f'{d} .wp-done'): page.keyboard.press('Escape'); page.evaluate("document.querySelector('.rk-dialog-x')?.click()")
    page.click(f'{d} .actions button:has-text("Close")')

    # ---- Write a post (WP8 C, WP13) ----
    state['lag'] = False
    page.goto(POSTS_URL)
    wait_for(lambda: page.is_visible('.dv-write'), page=page)
    head = page.eval_on_selector_all('.dv-head > *', 'es => es.map(e => e.className || e.tagName)')
    check('Write a post in Tile posts’ header, before Autoplay and Refresh', head.index('dv-write') < head.index('dv-autoplay') < head.index('dv-refresh') and page.inner_text('.dv-write').strip() == 'Write a post', str(head))
    page.click('.dv-write')
    wait_for(lambda: len(page.query_selector_all('.rk-dialog .wp-row')) >= 3, page=page)
    groups = page.eval_on_selector_all('.rk-dialog .wp-acct', 'hs => hs.map(h => [h.textContent, [...h.nextElementSibling.querySelectorAll(".wp-row-name")].map(n => n.textContent)])')
    check('your tiles: grouped by account (the current one first), newest first; a hidden tile left out (WP13)', groups == [[f'@{P_H}', ['Escher maze', 'Mixtape C60: Night Bus']], [f'@{T_H}', ['Winter Forest']]], str(groups))
    check("...someone else's tiles aren't listed", 'Rain on the roof' not in page.inner_text('.rk-dialog'))
    check('...each with its banner', wait_for(lambda: page.eval_on_selector_all('.rk-dialog .wp-row-pic img', 'is => is.filter(i => i.complete && i.naturalWidth > 0).length') >= 3, page=page))
    page.screenshot(path=str(OUT / 'w5-your-tiles.png'))
    page.click('.rk-dialog .wp-row:has-text("Mixtape")')
    wait_for(lambda: page.is_visible('.rk-dialog .wp-back'), page=page)
    check('choosing one opens the same post box, with "Your tiles" to go back', page.inner_text('.rk-dialog .wp-tile-name') == 'Mixtape C60: Night Bus' and page.inner_text('.rk-dialog .wp-back').strip() == 'Your tiles')
    page.fill('.rk-dialog #wp-words', 'Side A')
    page.click('.rk-dialog .wp-back')
    wait_for(lambda: len(page.query_selector_all('.rk-dialog .wp-row')) >= 3, page=page)
    page.click('.rk-dialog .wp-row:has-text("Mixtape")')
    wait_for(lambda: page.is_visible('.rk-dialog .wp-words'), page=page)
    check('...going back and choosing again keeps what you typed', page.input_value('.rk-dialog #wp-words') == 'Side A')
    page.click('.rk-dialog .actions button.primary')
    wait_for(lambda: page.is_visible('.rk-dialog .wp-done'), page=page)
    page.click('.rk-dialog .actions button:has-text("Close")')
    wait_for(lambda: page.query_selector('.tile-post .post-text') and page.inner_text('.tile-post .post-text') == 'Side A', page=page)
    check('after posting from Write a post, closing the box shows the new post at the top (WP10)', page.inner_text('.tile-post .post-text') == 'Side A')
    page.screenshot(path=str(OUT / 'w6-after.png'))
    check('the account menu shows the one sign-in’s promise (WP11)', (page.click('.account-btn'), wait_for(lambda: page.is_visible('.account-menu .rk-promise'), page=page),
          page.inner_text('.account-menu .rk-promise'))[2] == "Signing in lets Raku save your match results, show you in rooms and game lounges, and post tiles from your accounts. It asks once, for all of these. Raku doesn't touch your Bluesky posts, likes, follows or anything else.")
    ctx.close()

    # ---- Write a post signed out (WP13): Sign in to post, one window for the one set ----
    ctx2 = new_ctx()
    pg = ctx2.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(POSTS_URL); wait_for(lambda: pg.is_visible('.dv-write'), page=pg)
    pg.goto(tile_url(P, '3mzmaze')); wait_for(lambda: pg.is_visible('.star-btn'), page=pg); pg.wait_for_timeout(400)
    check('signed out: no Post on a tile’s tab', pg.is_hidden('.post-btn'))
    pg.goto(POSTS_URL); wait_for(lambda: pg.is_visible('.dv-write'), page=pg)
    pg.click('.dv-write')
    wait_for(lambda: pg.is_visible('.rk-dialog .signin-handle'), page=pg)
    check('Write a post signed out: "Sign in to post", one permission "Raku", the promise', pg.inner_text('.rk-dialog h2') == 'Sign in to post' and 'one permission, Raku' in pg.inner_text('.rk-dialog .rk-details')
          and "It asks once, for all of these." in pg.inner_text('.rk-dialog .rk-promise'))
    pg.screenshot(path=str(OUT / 'w7-signin.png'))
    pg.fill('.rk-dialog .signin-handle', T_H)
    with ctx2.expect_page():
        pg.click('.rk-dialog .signin-row button.primary')
    wait_for(lambda: len(pg.query_selector_all('.rk-dialog .wp-row')) >= 1, timeout=15, page=pg)
    log = pg.evaluate("JSON.parse(localStorage.getItem('standin-calls') || '[]')")
    check('...one small window asking for the one set; then your tiles', [c['scope'] for c in log if c.get('kind') == 'popup'] == [RAKU_SCOPE] and texts(pg, '.rk-dialog .wp-row-name') == ['Winter Forest'], str(log[-2:]))
    loads = [c for c in log if c.get('kind') == 'load']
    check("...the sign-in on this computer is the loopback one naming the one set (WP5's new address is the live one's)", loads and 'include%3Acafe.thunderbird.authRaku' in loads[0]['clientId'], loads[0]['clientId'] if loads else '')
    ctx2.close()

    # ---- the empty page (WP13) ----
    state['empty'] = True
    ctx3 = new_ctx(seed([T], {T: FULL}))
    pg = ctx3.new_page(); pg.goto(POSTS_URL)
    wait_for(lambda: pg.is_visible('.dv-empty'), page=pg)
    check('the empty page: post from a tile or Write a post', pg.inner_text('.dv-empty .tp-how').startswith('Open one of your tiles and press Post, or use Write a post above.'), pg.inner_text('.dv-empty .tp-how'))
    ctx3.close(); state['empty'] = False

    # ---- the phone ----
    ctx4 = new_ctx(seed([T, P], {T: FULL, P: FULL}), viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    ph = ctx4.new_page(); ph.on('pageerror', lambda e: errors.append(str(e)))
    ph.goto(tile_url(P, '3mzmaze'))
    wait_for(lambda: ph.is_visible('.post-btn'), page=ph)
    box = ph.eval_on_selector('.post-btn', 'b => { const r = b.getBoundingClientRect(); return [r.width, r.height, r.right] }')
    check('phone: Post is the icon alone at the end of the address row, a thumb-size target', ph.is_hidden('.post-btn .lbl') and box[0] >= 36 and box[1] >= 36 and box[2] <= 390, str(box))
    check('...no sideways scrolling', ph.evaluate('document.documentElement.scrollWidth') <= 390)
    ph.screenshot(path=str(OUT / 'w8-phone-tab.png'))
    ph.click('.post-btn'); wait_for(lambda: ph.is_visible('.rk-dialog .wp-words'), page=ph)
    sheet = ph.eval_on_selector('.rk-dialog-box', 'b => { const r = b.getBoundingClientRect(), s = document.querySelector(".stage").getBoundingClientRect(); return [r.left, r.width, Math.round(s.bottom - r.bottom)] }')
    check('...the post box as a sheet from the bottom of the page (above the toolbar, as Raku\u2019s other dialogs), the full width', sheet[0] == 0 and sheet[1] == 390 and abs(sheet[2]) <= 1, str(sheet))
    ph.screenshot(path=str(OUT / 'w9-phone-box.png'))
    ph.keyboard.press('Escape')
    ph.goto(POSTS_URL); wait_for(lambda: ph.is_visible('.dv-write'), page=ph)
    check('...Write a post fits (the short label "Write")', ph.inner_text('.dv-write').strip() == 'Write' and ph.evaluate('document.documentElement.scrollWidth') <= 390)
    ph.screenshot(path=str(OUT / 'w10-phone-posts.png'))
    ctx4.close()

    check('no page errors', not errors, '; '.join(errors[:3]))
    b.close()

ok = sum(1 for _, c, _ in results if c)
print(f'\n{ok}/{len(results)} passed')
sys.exit(0 if ok == len(results) else 1)
