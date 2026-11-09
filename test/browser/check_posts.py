# Raku's Tile posts (Discover → Tile posts, raku:discover/posts; claude/tile-posts-plan.md stage 3) browser checks,
# in the chat sandbox: posts from several accounts in order (the relay's, the owner's and the shelf's), the author
# (avatar, name, handle), the time, the text and the tile's card with its banner and the post's alt; the relay failing
# (the accounts Raku knows, and the quiet note); a hidden account and a hidden tile; a missing and a changed tile
# ("This tile can't be shown."); over-long text cut; opening a card (the tile in this tab) and its corner button (a new
# tab); Refresh; the right column's preview from another source; the empty page; the phone.
# Play here (claude/raku-play-here-plan.md, PH1 to PH8), with stand-in tiles that really run through the loader replica:
# nothing runs until Play; the tile in place of the banner; the keys, the ring and the label fading; a click elsewhere;
# one at a time; the ×; out of view (a brief scroll doesn't stop it); leaving Discover; a large tile's question and a
# too-large one; a tile with ways (its exits' status; a dormant way blocked at the portal; a way taken opening in a new
# tab and the post's tile stopping); the new wording on Discover and the About page; the phone.
# Round C (claude/raku-expand-plan.md, EX1 to EX8, and D: travel inside the post): the expand button; the expanded view
# (the bar, the tile opened in place and never reloaded, the keys, Full screen); closing by ×, Escape and Back; the
# window opening (400 ms, linear) and reduced motion's fade; stepping through a portal while small expanding first and
# travelling inside the post (the screen, the arrival, "Now in", "Back to …" arriving at the portal, Pick a door with
# Stay here, a large place's question, a dormant way); shrinking back after a trip ("Now in" on the card, the new-tab
# button opening the way taken); stopping resetting it; the phone (the bar in two rows, the tile edge to edge); the
# installed window with its title bar folded away (the bar's buttons clear of the window's own).
# Autoplay (claude/raku-expand-plan.md, "After C", AU1 to AU6): off by default; the two switches; a tile showing
# starting by itself, quiet (no keys, its label) until clicked; not taking over a clicked one; × meaning not again; never
# over 25 MB; scrolling past starting nothing; remembered; expanding giving the keys; turned off stopping it; the wording;
# reduced motion; the phone's "Tap".
# Everything outside is a Playwright route (the account directory, the relay, account servers, Bluesky's public API
# and its picture server, the hide list). Tiles aren't run here (check_page.py does that).
# Usage: python3 test/browser/check_posts.py <work folder>   (servers.mjs and the loader replica already running, as for
# check_discover.py: node test/browser/loader-replica.mjs <tiles-loading-server folder>, on port 80)
import hashlib, io, json, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
COLL = 'cafe.thunderbird.tile.post'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_H = 'thunderbird.cafe'       # always read (config.js TILE_POSTS.always)
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'           # always read
S = 'did:plc:shelfaaaaaaaaaaaaaaaaaaa'; S_H = 'shelf.fakepds.net'      # on the shelf only
R = 'did:plc:relayaaaaaaaaaaaaaaaaaaa'; R_H = 'relay.fakepds.net'      # found by the relay only
H = 'did:plc:hiddenaaaaaaaaaaaaaaaaaa'; H_H = 'hidden.fakepds.net'     # an account on the hide list
LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
SALT = 'lexicographer.space hide list v1'
HANDLES = {A: A_H, P: P_H, S: S_H, R: R_H, H: H_H}
PDS = 'https://pds.fakepds.net'

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(1280, 720)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def tile(name, desc, color):
    page = f'<!doctype html><h1>{name}</h1>'.encode()
    banner = png(color)
    res = {'/': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(page)}, 'mimeType': 'text/html', 'size': len(page)}, 'content-type': 'text/html'},
           '/banner.png': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(banner)}, 'mimeType': 'image/png', 'size': len(banner)}, 'content-type': 'image/png'}}
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': name, 'description': desc, 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-01T10:00:00Z'}
TCID = lambda rkey: 'bafyreitile' + hashlib.sha256(rkey.encode()).hexdigest()[:40].replace('0', 'a').replace('1', 'b').replace('8', 'c').replace('9', 'd')
TILES = {   # (did, rkey) -> record; the current CID is TCID(rkey) (except 'changed', whose CID moved on)
    (A, 'maze'): tile('The Escher maze', 'Wander an impossible maze', (60, 160, 150)),
    (P, 'coaster'): tile('Roller Coaster', 'Take your sprite to the amusement park', (90, 60, 160)),
    (S, 'lantern'): tile('Glass Lantern', 'A lantern', (200, 140, 60)),
    (R, 'hiddentile'): tile('A hidden tile', '', (120, 120, 120)),
    (R, 'changed'): tile('Changed since', 'This one changed', (160, 60, 60)),
}
NOW = time.time()
def iso(hours_ago): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - hours_ago * 3600))
def tpost(did, rkey, text, hours_ago, tile_did, tile_rkey, alt=None, cid=None):
    v = {'$type': COLL, 'tile': {'uri': f'at://{tile_did}/ing.dasl.masl/{tile_rkey}', 'cid': cid or TCID(tile_rkey)}, 'createdAt': iso(hours_ago)}
    if text is not None: v['text'] = text
    if alt: v['alt'] = alt
    return {'uri': f'at://{did}/{COLL}/{rkey}', 'cid': 'bafyreipost' + rkey, 'value': v}
LONG = 'Long words. ' * 40                                 # 480 characters: cut to 300
POSTS = {
    R: [tpost(R, '3mzr1', 'Found by the relay: the maze', 1, A, 'maze', alt='A small 3D maze you walk with the arrow keys'),
        tpost(R, '3mzr2', 'A post about a hidden tile', 2, R, 'hiddentile'),
        tpost(R, '3mzr3', 'A tile that changed since', 30, R, 'changed', cid=TCID('the-old-version')),
        {'uri': f'at://{R}/{COLL}/junk', 'value': {'text': 'no tile'}}],
    A: [tpost(A, '3mza1', 'From thunderbird.cafe, my coaster', 3, P, 'coaster'),
        tpost(A, '3mza2', 'A tile that was deleted', 50, A, 'deleted')],
    P: [tpost(P, '3mzp1', None, 5, P, 'coaster')],                     # no text: just the tile
    S: [tpost(S, '3mzs1', LONG, 4, S, 'lantern')],
    H: [tpost(H, '3mzh1', 'From a hidden account', 0.5, A, 'maze')],
}
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [hashlib.sha256(f'{SALT}\n{H}'.encode()).hexdigest()],
                        'tiles': [hashlib.sha256(f'{SALT}\n{R}\nhiddentile'.encode()).hexdigest()]})
state = {'relay': 'ok', 'empty': False, 'play': False}

# ---- Play here: stand-in tiles that run (a key counter; one with ways, speaking the way messages as the maze does) ----
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
SIGN = 'cafe.thunderbird.way.signpost'
WAY_JS = b'''
const UP = 'tiles-protocol-up-way-payload', DOWN = 'tiles-protocol-down-way-payload';
const st = document.getElementById('st'), arr = document.getElementById('arr');
const arrivals = []; let host = false;
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const d = e.data; if (!d || d.action !== DOWN || !d.payload || d.payload.v !== 1) return;
  const p = d.payload;
  if (p.kind === 'status') { host = true; st.textContent = JSON.stringify(p.exits); }
  if (p.kind === 'arrive') { host = true; arrivals.push(p.entrance); arr.textContent = arrivals.join(','); }
});
const hello = () => parent.postMessage({ action: UP, payload: { v: 1, kind: 'hello', tile: 'waytile', ways: '/ways.json' } }, '*');
hello(); setTimeout(() => { if (!host) hello(); }, 500);
window.leave = (exit) => parent.postMessage({ action: UP, payload: { v: 1, kind: 'leave', exit, facing: 'n' } }, '*');
'''
KEYS_JS = b"let n = 0; addEventListener('keydown', (e) => { n++; document.getElementById('k').textContent = n; e.preventDefault(); });"
def blob(data, ctype, size=None):
    c = cid_for(data)
    return {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': size or len(data)}, 'content-type': ctype}
def play_tile(name, color, ways=None, size=None, key='waytile'):
    page = (f'<!doctype html><meta charset=utf-8><body style="font:18px sans-serif;background:#eef4ff;padding:16px;margin:0">'
            f'<h1 id=h>{name}</h1><p>keys <span id=k>0</span></p><p>status <span id=st>none</span> arrived <span id=arr>none</span></p>'
            f'<script src="/keys.js"></script>{"<script src=/way.js></script>" if ways else ""}').encode()
    res = {'/': blob(page, 'text/html', size), '/keys.js': blob(KEYS_JS, 'text/javascript')}
    if ways:
        res['/way.js'] = blob(WAY_JS, 'text/javascript')
        res['/ways.json'] = blob(json.dumps({'v': 1, 'tile': 'waytile', 'place': f'at://{A}/cafe.thunderbird.way.place/waytile',
            'exits': [{'id': e, 'signpost': f'at://{A}/{SIGN}/{key}.{e}', 'fallback': f'https://thunderbird.cafe/way/waytile/{e}'} for e in ways],
            'entrances': [{'id': e} for e in ways]}).encode(), 'application/json')
    banner = png(color)
    res['/banner.png'] = blob(banner, 'image/png')
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': name, 'description': f'{name}, a stand-in', 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-01T10:00:00Z'}
MB = 1024 * 1024
PLAY_TILES = {
    (A, 'waytile'): play_tile('Way tile', (60, 120, 160), ways=['door', 'shut', 'many', 'big']),
    (A, 'forest'): play_tile('Forest', (200, 230, 240), ways=['back'], key='forest'),
    (A, 'second'): play_tile('Second tile', (160, 120, 60)),
    (A, 'large'): play_tile('Large tile', (120, 60, 160), size=60 * MB),
    (A, 'huge'): play_tile('Huge tile', (60, 60, 60), size=620 * MB),
    (A, 'plain'): play_tile('Somewhere plain', (200, 200, 200)),
}
SIGNPOSTS = {
    (A, 'waytile.door'): {'$type': SIGN, 'to': [{'tile': f'at://{A}/ing.dasl.masl/plain'}], 'updatedAt': '2026-11-01T00:00:00Z'},
    (A, 'waytile.shut'): {'$type': SIGN, 'to': [], 'updatedAt': '2026-11-01T00:00:00Z'},
    (A, 'waytile.many'): {'$type': SIGN, 'to': [{'tile': f'at://{A}/ing.dasl.masl/plain', 'label': 'The plain door'},
                                                {'tile': f'at://{A}/ing.dasl.masl/forest', 'entrance': 'back', 'label': 'The forest door'}], 'updatedAt': '2026-11-01T00:00:00Z'},
    (A, 'waytile.big'): {'$type': SIGN, 'to': [{'tile': f'at://{A}/ing.dasl.masl/large'}], 'updatedAt': '2026-11-01T00:00:00Z'},
    (A, 'forest.back'): {'$type': SIGN, 'to': [{'tile': f'at://{A}/ing.dasl.masl/waytile', 'entrance': 'many'}], 'updatedAt': '2026-11-01T00:00:00Z'},
}
PLAY_POSTS = {A: [tpost(A, '3mzq1', 'A tile with ways', 1, A, 'waytile'), tpost(A, '3mzq2', 'A second tile', 2, A, 'second'),
                  tpost(A, '3mzq3', 'A large tile', 3, A, 'large'), tpost(A, '3mzq4', 'A huge tile', 4, A, 'huge')]
              + [tpost(A, f'3mzf{i}', f'Filler {i}', 5 + i, A, 'plain') for i in range(1, 5)]}

calls = []
def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'relay1.us-east.bsky.network':
        if state['relay'] == 'down': return r.abort()
        if state['relay'] == '500': return js({'error': 'InternalServerError'}, 502)
        if q.get('collection') != COLL: return js({'repos': []})
        return js({'repos': [] if state['empty'] or state['play'] else [{'did': R}, {'did': A}, {'did': H}]})
    if u.hostname == 'plc.directory':
        did = u.path.strip('/'); hd = HANDLES.get(did)
        if not hd: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{hd}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest'}, 400)
        prof = lambda d: {'did': d, 'handle': HANDLES.get(d, 'handle.invalid'), 'displayName': HANDLES.get(d, 'x').split('.')[0].title(), 'labels': [],
                          'avatar': 'https://cdn.bsky.app/img/avatar/plain/x/av@jpeg'}
        if u.path.endswith('getProfiles'): return js({'profiles': [prof(d) for d in parse_qs(u.query).get('actors', [])]})
        if u.path.endswith('getProfile'): return js(prof(q.get('actor')))
        return js({'error': 'NotFound'}, 404)
    if u.hostname == 'cdn.bsky.app':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'image/png'}, body=png((63, 184, 168), (64, 64)))
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=HIDE_LIST)
    if u.hostname == 'pds.fakepds.net':
        repo = q.get('repo')
        if u.path.endswith('listRecords'):
            if q.get('collection') != COLL or state['empty']: return js({'records': []})
            if state['play']: return js({'records': PLAY_POSTS.get(repo, [])[:int(q.get('limit', 50))]})
            return js({'records': POSTS.get(repo, [])[:int(q.get('limit', 50))]})
        if u.path.endswith('getRecord'):
            if q.get('collection') == SIGN:
                sp = SIGNPOSTS.get((repo, q.get('rkey')))
                return js({'uri': f"at://{repo}/{SIGN}/{q['rkey']}", 'cid': 'bafyreisign' + q['rkey'].replace('.', ''), 'value': sp}) if sp else js({'error': 'RecordNotFound'}, 400)
            rec = TILES.get((repo, q.get('rkey'))) or PLAY_TILES.get((repo, q.get('rkey')))
            if not rec or q.get('collection') != 'ing.dasl.masl': return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{repo}/ing.dasl.masl/{q['rkey']}", 'cid': TCID(q['rkey']), 'value': rec})
        if u.path.endswith('getBlob'):
            b = blobs.get(q.get('cid'))
            return r.fulfill(status=200 if b else 404, headers={**cors, 'content-type': 'application/octet-stream'}, body=b or b'')
    if u.hostname == 'github.com':
        return r.fulfill(status=200, headers={'content-type': 'text/html'}, body='<!doctype html><title>outside</title>')
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
        if page: page.evaluate('1')        # keeps Playwright's routes answering while we wait
        time.sleep(step)
    return None
def texts(pg, sel): return pg.eval_on_selector_all(sel, 'els => els.map(e => e.textContent.trim())')

SHELF = json.dumps({'version': 1, 'tiles': [], 'accounts': [{'did': S, 'handle': S_H, 'keptAt': '2026-11-01T00:00:00.000Z'}]})
POSTS_URL = RAKU + '#t=raku%3Adiscover%2Fposts&a=0'
post_texts = lambda pg: pg.eval_on_selector_all('.tile-post', 'ps => ps.map(p => (p.querySelector(".post-text") || {}).textContent || "")')

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
    def new_ctx(**kw):
        ctx = b.new_context(**({'viewport': {'width': 1400, 'height': 900}} | kw))
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://github.com/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
            ctx.route(host, route)
        ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-shelf', {json.dumps(SHELF)}); sessionStorage.setItem('seeded', '1'); }}")
        return ctx
    ctx = new_ctx()
    popups = []
    ctx.on('page', lambda pg: popups.append(pg))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ---- the source, a few accounts' posts in order ----
    page.goto(POSTS_URL); page.wait_for_selector('.discover')
    check('raku:discover/posts opens Tile posts in the centre, the source on', texts(page, '.dv-centre h1') == ['Tile posts'] and texts(page, '.dv-src.on') == ['Tile posts'], str(texts(page, '.dv-src.on')))
    check('...Tile posts sits among the sources with its own icon, after Tile news, before Recent tiles', texts(page, '.dv-src:not(.dv-make)')[:3] == ['Tile news', 'Tile posts', 'Recent tiles'] and page.eval_on_selector('.dv-src[data-source="posts"] svg', 's => s.classList.contains("icon-posts")'), str(texts(page, '.dv-src')))
    check('...its blurb', 'from their own accounts' in page.inner_text('.dv-head .sub'))
    wait_for(lambda: len(page.query_selector_all('.tile-post')) >= 6, page=page)
    got = post_texts(page)
    check('the posts, newest first: the relay\'s, the owner\'s, the shelf\'s; hidden ones left out', got[:3] == ['Found by the relay: the maze', 'From thunderbird.cafe, my coaster', LONG[:300] + '…'] and len(got) == 6, str(got))
    check('...a post with no text shows just its tile', got[3] == '' and page.eval_on_selector_all('.tile-post', 'ps => !ps[3].querySelector(".post-text") && !!ps[3].querySelector(".post-tile")'))
    check("...a hidden account's post isn't shown, nor is its account's server asked", 'From a hidden account' not in got and not any(f'repo={H}' in c and 'listRecords' in c for c in calls))
    check('...a post about a hidden tile isn\'t shown', 'A post about a hidden tile' not in got)
    check('...the relay asked once, for tile posts only, 100 at a time', len([c for c in calls if 'listReposByCollection' in c]) == 1 and any(f'collection={COLL}' in c and 'limit=100' in c for c in calls if 'listReposByCollection' in c))
    check('...each account read from its own server, newest few', all('limit=10' in c for c in calls if 'listRecords' in c and COLL in c))
    check('...no network note when the relay answers', page.is_hidden('.tp-note'))
    first = '.tile-post:nth-child(1)'
    wait_for(lambda: page.inner_text(f'{first} .post-handle') == f'@{R_H}', page=page)
    check('the author: avatar, name and checked handle', page.inner_text(f'{first} .post-name') == 'Relay' and page.inner_text(f'{first} .post-handle') == f'@{R_H}'
          and wait_for(lambda: page.eval_on_selector(f'{first} .post-av img', 'i => i.src.startsWith("https://cdn.bsky.app/") && i.referrerPolicy === "no-referrer"'), page=page))
    check('...the time', page.inner_text(f'{first} .post-time') == '1h', page.inner_text(f'{first} .post-time'))
    wait_for(lambda: page.inner_text(f'{first} .card-title') == 'The Escher maze', page=page)
    check("the tile's card: name, description and its author", page.inner_text(f'{first} .card-title') == 'The Escher maze' and page.inner_text(f'{first} .card-desc') == 'Wander an impossible maze'
          and wait_for(lambda: page.inner_text(f'{first} .card-by') == f'by @{A_H}', page=page), page.inner_text(f'{first} .card-by'))
    alt = wait_for(lambda: page.eval_on_selector(f'{first} .tp-slot > img', 'i => i.complete && i.naturalWidth > 0 && i.alt'), page=page)
    check("...its banner, from the tile's own server, described by the post's alt", alt == 'A small 3D maze you walk with the arrow keys', str(alt))
    sec = '.tile-post:nth-child(2)'
    alt2 = wait_for(lambda: page.eval_on_selector(f'{sec} .tp-slot > img', 'i => i.complete && i.naturalWidth > 0 && i.alt'), page=page)
    check("...no alt: the tile's own description", alt2 == 'Take your sprite to the amusement park', str(alt2))
    check('...the card is the same card Raku uses elsewhere (open in a new tab in its corner)', page.eval_on_selector(f'{first} .post-tile', 'c => c.classList.contains("card") && !!c.querySelector(".card-corner .card-btn")'))
    wait_for(lambda: len(page.query_selector_all('.tp-gone')) == 2, page=page)
    gone = page.eval_on_selector_all('.tile-post', 'ps => ps.filter(p => p.querySelector(".tp-gone")).map(p => p.querySelector(".post-text").textContent)')
    check("a deleted tile and a changed one: the post's text with \"This tile can't be shown.\"", sorted(gone) == ['A tile that changed since', 'A tile that was deleted'] and texts(page, '.tp-gone') == ["This tile can't be shown.", "This tile can't be shown."], str(gone))
    full = page.eval_on_selector(f'.tile-post:nth-child(3) .post-text', 'p => p.textContent')
    check('over-long text is cut to 300 characters, with …', len(full) == 301 and full.endswith('…'), str(len(full)))
    page.screenshot(path=str(OUT / 'posts-wide.png'))
    check('no page errors', not errors, str(errors))

    # ---- the right column: Tile posts previewed from another source ----
    page.goto(RAKU + '#t=raku%3Adiscover%2Frecent&a=0'); page.wait_for_selector('.discover')
    pv = wait_for(lambda: (lambda t: t if 'Relay' in t else None)(page.inner_text('.dv-preview[data-source="posts"]')), page=page)
    check('from another source, the right column previews Tile posts (the newest three)', pv and 'Found by the relay' in pv and len(page.query_selector_all('.dv-preview[data-source="posts"] .dv-mini')) == 3, str(pv))
    page.click('.dv-preview[data-source="posts"]')
    check('...clicking it brings Tile posts to the centre', wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'] and 'raku%3Adiscover%2Fposts' in page.evaluate('location.hash'), page=page))

    # ---- opening a card ----
    wait_for(lambda: page.inner_text('.tile-post:nth-child(1) .card-title') == 'The Escher maze', page=page)
    page.click('.tile-post:nth-child(2) .post-tile .card-btn')
    check("the card's corner button opens the tile in a new Raku tab", wait_for(lambda: page.input_value('.addr').endswith(f'/ing.dasl.masl/coaster') and len(page.query_selector_all('.tab')) == 2, page=page), page.input_value('.addr'))
    page.click('.tab:nth-child(1)')
    wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'], page=page)
    wait_for(lambda: page.inner_text('.tile-post:nth-child(1) .card-title') == 'The Escher maze', page=page)
    page.click('.tile-post:nth-child(1) .post-tile .card-main')
    check('opening a card opens the tile in this tab', wait_for(lambda: page.input_value('.addr').endswith('/ing.dasl.masl/maze') and len(page.query_selector_all('.tab')) == 2, page=page), page.input_value('.addr'))
    page.go_back()
    check('...Back returns to Tile posts', wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'], page=page))

    # ---- Refresh, and the relay failing ----
    state['relay'] = '500'
    n = len([c for c in calls if 'listReposByCollection' in c])
    page.click('.dv-refresh')
    note = wait_for(lambda: page.is_visible('.tp-note') and page.inner_text('.tp-note'), page=page)
    check('Refresh asks again; the relay failing: the quiet note', len([c for c in calls if 'listReposByCollection' in c]) == n + 1 and note == "Couldn't reach the network just now, showing accounts you know.", str(note))
    got = wait_for(lambda: (lambda g: g if len(g) == 4 else None)(post_texts(page)), page=page)
    check("...and the accounts Raku knows: the owner's and the shelf's (not the relay's)", got == ['From thunderbird.cafe, my coaster', LONG[:300] + '…', '', 'A tile that was deleted'], str(got))
    state['relay'] = 'down'
    ctx2 = new_ctx(); page2 = ctx2.new_page()
    page2.goto(POSTS_URL); page2.wait_for_selector('.discover')
    note = wait_for(lambda: page2.is_visible('.tp-note') and page2.inner_text('.tp-note'), page=page2)
    check('...the relay unreachable on a fresh visit: the same note', note == "Couldn't reach the network just now, showing accounts you know." and wait_for(lambda: len(post_texts(page2)) == 4, page=page2))
    ctx2.close()
    state['relay'] = 'ok'

    # ---- empty ----
    state['empty'] = True
    ctx3 = new_ctx(); page3 = ctx3.new_page()
    page3.goto(POSTS_URL); page3.wait_for_selector('.discover')
    empty = wait_for(lambda: page3.is_visible('.dv-empty') and page3.inner_text('.dv-empty'), page=page3)
    check('no tile posts anywhere: "No tile posts yet." and how to make one', empty and empty.startswith('No tile posts yet.') and 'pyxorium/tile-posts' in empty, str(empty))
    check('...the link to the repo opens in a new tab with no opener', page3.eval_on_selector('.dv-empty a', 'a => [a.href, a.target, a.rel]') == ['https://github.com/pyxorium/tile-posts', '_blank', 'noopener noreferrer'])
    ctx3.close()
    state['empty'] = False

    # ---- the phone ----
    ctx4 = new_ctx(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page4 = ctx4.new_page()
    page4.goto(POSTS_URL); page4.wait_for_selector('.discover')
    wait_for(lambda: len(page4.query_selector_all('.tile-post')) == 6 and page4.inner_text('.tile-post:nth-child(1) .card-title') == 'The Escher maze', page=page4)
    wait_for(lambda: page4.eval_on_selector('.tile-post:nth-child(1) .tp-slot > img', 'i => i.complete && i.naturalWidth > 0'), page=page4)
    lay = page4.evaluate('''() => {
      const nav = document.querySelector('.dv-sources'), right = document.querySelector('.dv-right');
      const post = document.querySelector('.tile-post').getBoundingClientRect(), card = document.querySelector('.tile-post .post-tile').getBoundingClientRect();
      return { chips: getComputedStyle(nav).display, right: getComputedStyle(right).display, wide: document.documentElement.scrollWidth <= innerWidth,
               inside: card.left >= post.left - 1 && card.right <= post.right + 1 && post.right <= innerWidth };
    }''')
    chips = texts(page4, '.dv-src')
    check('phone: the sources as chips, Tile posts among them, no right column', lay['chips'] == 'flex' and 'Tile posts' in chips and lay['right'] == 'none', str([lay, chips]))
    check('...posts and their tile cards fit the width, no sideways scrolling', lay['wide'] and lay['inside'], str(lay))
    page4.screenshot(path=str(OUT / 'posts-phone.png'))
    page4.screenshot(path=str(OUT / 'posts-phone-full.png'), full_page=True)
    ctx4.close()

    # ================= Play here (PH1 to PH8) =================
    state['play'] = True
    ctx5 = new_ctx()
    page = ctx5.new_page()
    perrors = []
    page.on('pageerror', lambda e: perrors.append(str(e)))
    PLAY_URL = RAKU + '?loader=' + LOADER + '#t=raku%3Adiscover%2Fposts&a=0'
    def post_sel(text): return f'.tile-post:has(.post-text:text-is("{text}"))'
    def inner(text=None):
        for f in page.frames:
            if '.tiles.lex.localhost' in (urlparse(f.url).hostname or '') and f.parent_frame and '.tiles.lex.localhost' in (urlparse(f.parent_frame.url).hostname or '') \
               and f.parent_frame.parent_frame == page.main_frame:
                try:
                    el = f.parent_frame.frame_element()
                    if text is None or el.evaluate('(e, t) => !!e.closest(".tile-post") && e.closest(".tile-post").querySelector(".post-text").textContent === t', text): return f
                except Exception: pass
        return None
    def itext(sel, text=None):
        f = inner(text)
        return f.locator(sel).first.inner_text() if f else None
    frames = lambda: page.eval_on_selector_all('.tile-post iframe.tp-frame', 'fs => fs.length')
    loads = lambda: [c for c in calls if 'load.tiles.lex.localhost' in c]
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W1 = post_sel('A tile with ways'); W2 = post_sel('A second tile'); WL = post_sel('A large tile'); WH = post_sel('A huge tile')
    wait_for(lambda: page.is_visible(f'{W1} .tp-play') and page.is_visible(f'{W2} .tp-play'), page=page)
    check('Play here: each playable tile post has a "Play here" button on its banner', page.is_visible(f'{W1} .tp-play') and page.inner_text(f'{W1} .tp-play') == 'Play here'
          and page.get_attribute(f'{W1} .tp-play', 'aria-label') == 'Play Way tile here')
    page.wait_for_timeout(500)
    check('...nothing runs until asked: no tile frames on the page', frames() == 0, str(frames()))
    check('...the wording on Discover says so', 'press Play here' in page.inner_text('.dv-right'))
    n_tabs = len(page.query_selector_all('.tab'))
    page.click(f'{W1} .tp-play')
    starting = wait_for(lambda: page.is_visible(f'{W1} .tp-over .tp-spin') or frames() == 1, page=page)
    check('Play: the banner dims with "Starting the tile…" (or the tile is already in)', starting)
    ok = wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    check('...the tile runs in the post, in place of the banner, through the loading server', ok and frames() == 1 and page.is_visible(f'{W1} iframe.tp-frame'), str(frames()))
    check('...in this tab: the address and the tabs are unchanged', page.input_value('.addr') == '' and len(page.query_selector_all('.tab')) == n_tabs and 'raku%3Adiscover%2Fposts' in page.evaluate('location.hash'))
    check('...the frame is a tile frame like a tab\'s (no extra permissions, no referrer)', page.eval_on_selector(f'{W1} iframe.tp-frame', 'f => f.getAttribute("allow") === "" && f.getAttribute("referrerpolicy") === "no-referrer" && f.title === "Way tile"'))
    keys = wait_for(lambda: page.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")'), page=page)
    check('PH4: the tile gets the keys at once', keys)
    check('...the ring shows it has them', wait_for(lambda: page.eval_on_selector(f'{W1} .tp-slot', 's => s.classList.contains("keys") && getComputedStyle(s, "::after").boxShadow !== "none"'), page=page))
    check('PH8: "Keys go to the tile" shows…', page.is_visible(f'{W1} .tp-keys-hint') and page.eval_on_selector(f'{W1} .tp-keys-hint', 'h => !h.classList.contains("gone")'))
    y0 = page.evaluate('document.querySelector(".pane.front") ? document.querySelector(".pane.front").scrollTop : 0')
    page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowRight')
    check('...arrow keys go to the tile, not the page', wait_for(lambda: itext('#k', 'A tile with ways') == '3', page=page) and page.evaluate('document.querySelector(".pane.front") ? document.querySelector(".pane.front").scrollTop : 0') == y0, str(itext('#k', 'A tile with ways')))
    check('...and the label fades after a few seconds, the ring stays', wait_for(lambda: page.eval_on_selector(f'{W1} .tp-keys-hint', 'h => h.classList.contains("gone")'), 5, page=page)
          and page.eval_on_selector(f'{W1} .tp-slot', 's => s.classList.contains("keys")'))
    page.click(f'{W1} .post-text')
    check('a click elsewhere gives the keys back to the page: the ring goes', wait_for(lambda: page.eval_on_selector(f'{W1} .tp-slot', 's => !s.classList.contains("keys")'), page=page))
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(300)
    check('...and the keys no longer reach the tile', itext('#k', 'A tile with ways') == '3', str(itext('#k', 'A tile with ways')))
    # PH5: ways
    st = wait_for(lambda: (lambda v: v if v and v != 'none' else None)(itext('#st', 'A tile with ways')), page=page)
    check('PH5: a tile with ways is answered: its exits\' status', st and json.loads(st) == {'door': 'open', 'shut': 'dormant', 'many': 'open', 'big': 'open'}, str(st))
    inner('A tile with ways').evaluate('() => leave("shut")')
    check('...a way that leads nowhere: back at that portal, "The way is blocked."', wait_for(lambda: itext('#arr', 'A tile with ways') == 'shut', page=page)
          and wait_for(lambda: 'The way is blocked.' in page.inner_text('body'), page=page) and frames() == 1)
    check('...the tile stays small for a way that leads nowhere', page.query_selector('.tp-x') is None)
    # (round C replaced PH5's new tab: a way taken now travels inside the post; the full checks are below)
    inner('A tile with ways').evaluate('() => leave("door")')
    travelled = wait_for(lambda: itext('#h', 'A tile with ways') == 'Somewhere plain', 20, page=page)
    check('...a way taken travels inside the post now (round C): no new tab, the place in the same slot', travelled and len(page.query_selector_all('.tab')) == n_tabs and frames() == 1, str(itext('#h')))
    check('...expanded first (EX6)', page.query_selector('.tp-x') is not None)
    if page.query_selector('.tp-x'): page.click('.tp-x-close'); wait_for(lambda: page.query_selector('.tp-x') is None, page=page)
    if page.query_selector(f'{W1} .tp-stop'): page.click(f'{W1} .tp-stop')
    wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    # PH1: one at a time; the ×
    page.click(f'{W1} .tp-play'); wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    page.click(f'{W2} .tp-play'); wait_for(lambda: itext('#h', 'A second tile') == 'Second tile', 20, page=page)
    check('PH1: one at a time: playing another stops the first (its Play is back)', frames() == 1 and page.is_visible(f'{W1} .tp-play') and page.is_visible(f'{W2} iframe.tp-frame'), str(frames()))
    page.click(f'{W2} .tp-stop')
    check('PH2: the × stops it', wait_for(lambda: frames() == 0 and page.is_visible(f'{W2} .tp-play'), page=page))
    # PH3: large and too large
    page.click(f'{WL} .tp-play')
    q = wait_for(lambda: page.is_visible(f'{WL} .tp-over') and page.inner_text(f'{WL} .tp-over p'), page=page)
    check('PH3: a large tile asks first: "This tile is large (60 MB). Play anyway?"', q == 'This tile is large (60 MB). Play anyway?' and frames() == 0, str(q))
    page.click(f'{WL} .tp-over button:text-is("Cancel")')
    check('...Cancel: the banner and Play back, nothing loaded', page.is_visible(f'{WL} .tp-play') and frames() == 0)
    page.click(f'{WL} .tp-play'); page.click(f'{WL} .tp-over button:text-is("Play anyway")')
    check('...Play anyway: it runs', wait_for(lambda: itext('#h', 'A large tile') == 'Large tile', 20, page=page))
    page.click(f'{WL} .tp-stop'); wait_for(lambda: page.is_visible(f'{WL} .tp-play'), page=page)
    page.click(f'{WL} .tp-play')
    check('...and doesn\'t ask again this visit', wait_for(lambda: frames() == 1, page=page) and 'Play anyway' not in page.inner_text(WL))
    page.click(f'{WL} .tp-stop')
    th = page.inner_text(f'{WH} .tp-over') if page.query_selector(f'{WH} .tp-over') else ''
    check('...over 500 MB: "This tile is too large to open", and no Play', th == 'This tile is too large to open (620 MB).' and page.query_selector(f'{WH} .tp-play') is None, th)
    # PH2: out of view
    page.click(f'{W2} .tp-play'); wait_for(lambda: itext('#h', 'A second tile') == 'Second tile', 20, page=page)
    scroll_to = lambda sel: page.eval_on_selector(sel, 'e => e.scrollIntoView({ block: "center" })')
    scroll_to(post_sel('Filler 4')); page.wait_for_timeout(1200); scroll_to(W2); page.wait_for_timeout(3500)
    check('PH2: a brief scroll away doesn\'t stop it', frames() == 1 and page.is_visible(f'{W2} iframe.tp-frame'))
    scroll_to(post_sel('Filler 4'))
    check('...a few seconds fully out of view does', wait_for(lambda: frames() == 0, 8, page=page) and page.query_selector(f'{W2} .tp-play') is not None)
    scroll_to(W2)
    page.click(f'{W2} .tp-play'); wait_for(lambda: frames() == 1, 20, page=page)
    page.click('.dv-src[data-source="recent"]')
    wait_for(lambda: page.inner_text('.dv-centre h1') == 'Recent tiles', page=page)
    check('PH2: leaving Tile posts stops it (no tile frame left anywhere)', page.eval_on_selector_all('iframe.tp-frame', 'fs => fs.length') == 0)
    page.click('.dv-src[data-source="posts"]'); wait_for(lambda: page.is_visible(f'{W2} .tp-play'), page=page)
    check('...back on Tile posts: the banner and Play, nothing running', frames() == 0 and page.is_visible(f'{W2} .tp-play'))
    page.click(f'{W2} .card-main')
    check('the card\'s words still open the tile in this tab', wait_for(lambda: page.input_value('.addr').endswith('/ing.dasl.masl/second'), page=page), page.input_value('.addr'))
    page.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Aabout&a=0'); page.wait_for_selector('.about')
    check('the About page says when a tile runs', 'press Play here on a tile post' in page.inner_text('.about'))
    check('no page errors while playing', not perrors, str(perrors))
    ctx5.close()
    # the phone
    ctx6 = new_ctx(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx6.new_page()
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W2 = post_sel('A second tile')
    wait_for(lambda: page.is_visible(f'{W2} .tp-play'), page=page)
    page.eval_on_selector(W2, 'e => e.scrollIntoView({ block: "center" })')
    page.tap(f'{W2} .tp-play')
    ran = wait_for(lambda: itext('#h', 'A second tile') == 'Second tile', 20, page=page)
    lay = page.evaluate("""() => { const s = document.querySelector('.tile-post iframe.tp-frame').closest('.tp-slot'), r = s.getBoundingClientRect(), post = s.closest('.tile-post').getBoundingClientRect();
      return { ratio: Math.round(r.width / r.height * 100) / 100, full: r.left >= post.left && r.right <= post.right && r.width >= post.width - 40, wide: document.documentElement.scrollWidth <= innerWidth }; }""")
    check("PH6: on a phone, a tap on Play runs it; 16:9 at the post's full width, no sideways scrolling", ran and abs(lay['ratio'] - 1.78) < 0.03 and lay['full'] and lay['wide'], str(lay))
    page.wait_for_timeout(2800)
    # a playing card scrolled under the sticky source chips stays under them (its Play, × and corner don't float over)
    page.evaluate('() => { const p = document.querySelector(".pane.front") || document.scrollingElement; const s = document.querySelector(".dv-left").getBoundingClientRect(); const c = [...document.querySelectorAll(".tile-post")][0].querySelector(".tp-play").getBoundingClientRect(); p.scrollBy(0, c.top - s.top - 10); }')
    under = page.evaluate('() => { const s = document.querySelector(".dv-left").getBoundingClientRect(); const x = s.left + 60, y = s.top + s.height / 2; const e = document.elementFromPoint(x, y); return !!e && !!e.closest(".dv-left"); }')
    check("...a card scrolled under the sticky source chips stays under them", under)
    page.screenshot(path=str(OUT / 'play-phone.png'))
    ctx6.close()

    # ================= Round C: expand (EX1 to EX8) and travel inside the post (D) =================
    ctx7 = new_ctx()
    page = ctx7.new_page()
    cerrors = []
    page.on('pageerror', lambda e: cerrors.append(str(e)))
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W1 = post_sel('A tile with ways'); J1 = '[data-ck="w1"]'
    wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    page.eval_on_selector(W1, 'e => e.setAttribute("data-ck", "w1")')
    check('EX2: the banner keeps its single "Play here" (no expand before playing)', page.query_selector(f'{W1} .tp-expand') is None and len(page.query_selector_all(f'{W1} .tp-slot button')) == 1)
    page.click(f'{W1} .tp-play')
    wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    wait_for(lambda: page.is_visible(f'{W1} .tp-expand'), page=page)
    pos = page.evaluate(f"""() => {{ const c = document.querySelector('{J1}'); const r = (s) => c.querySelector(s).getBoundingClientRect();
      return {{ ex: r('.tp-expand').right, x: r('.tp-stop').left, xr: r('.tp-stop').right, nt: r('.card-corner .card-btn').left, top: Math.abs(r('.tp-expand').top - r('.tp-stop').top) }}; }}""")
    check('EX2: a playing tile has an expand button in its corner, left of the × and the new-tab button', page.is_visible(f'{W1} .tp-expand') and pos['ex'] <= pos['x'] and pos['xr'] <= pos['nt'] and pos['top'] < 2
          and page.get_attribute(f'{W1} .tp-expand', 'aria-label') == 'Expand Way tile', str(pos))
    wait_for(lambda: page.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")'), page=page)
    page.keyboard.press('ArrowUp'); page.keyboard.press('ArrowUp')
    wait_for(lambda: itext('#k', 'A tile with ways') == '2', page=page)
    small = page.eval_on_selector(f'{W1} .tp-slot', 's => { const r = s.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }')
    hist0 = page.evaluate('history.length')
    page.click(f'{W1} .tp-expand')
    opened = wait_for(lambda: page.is_visible('.tp-x') and page.eval_on_selector(f'{W1} .tp-slot', 's => s.classList.contains("expanded") && getComputedStyle(s).position === "fixed"'), page=page)
    page.wait_for_timeout(500)
    geo = page.evaluate(f"""() => {{ const s = document.querySelector('{J1} .tp-slot').getBoundingClientRect(), h = document.querySelector('.tp-x-hole').getBoundingClientRect(),
      bar = document.querySelector('.tp-x-bar').getBoundingClientRect(), chrome = document.querySelector('.chrome').getBoundingClientRect();
      const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
      const top = document.elementFromPoint(chrome.left + 200, chrome.top + 10);
      return {{ s: [s.left, s.top, s.width, s.height], h: [h.left, h.top, h.width, h.height], barTop: bar.top, overChrome: !!top && !!top.closest('.tp-x'), hitFrame: !!hit && hit.classList.contains('tp-frame'),
        w: innerWidth, hh: innerHeight }}; }}""")
    check('EX1: expand fills Raku\'s window: the bar at the top, over Raku\'s own bars, on a dark backdrop', opened and geo['barTop'] == 0 and geo['overChrome'], str(geo))
    check('...the tile grown in place to the stage (14 px margin on a computer), in front of the backdrop', all(abs(a - b) < 2 for a, b in zip(geo['s'], geo['h'])) and abs(geo['h'][0] - 14) < 1
          and geo['s'][2] > small[2] * 1.5 and geo['hitFrame'], str([geo, small]))
    check('...the same frame, never reloaded (the keys counted before expanding are still there)', itext('#k', 'A tile with ways') == '2' and frames() == 1)
    check('EX1: the bar: the tile\'s name and author, New tab, Full screen (allowed here), ×; no "Back to" before a trip',
          page.inner_text('.tp-x-name') == 'Way tile' and wait_for(lambda: page.inner_text('.tp-x-by') == f'by @{A_H}', page=page) and page.is_visible('.tp-x-new') and page.is_visible('.tp-x-full')
          and page.is_visible('.tp-x-close') and page.is_hidden('.tp-x-btn.back'), page.inner_text('.tp-x-bar'))
    page.screenshot(path=str(OUT / 'expand-wide.png'))
    check('...the card\'s own buttons hidden under it (expand, × and the corner)', not page.is_visible(f'{W1} .tp-expand') and not page.is_visible(f'{W1} .tp-stop') and not page.is_visible(f'{W1} .card-corner .card-btn'))
    check('EX5: expanding adds one step to the browser\'s history', page.evaluate('history.length') == hist0 + 1)
    keys = wait_for(lambda: page.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")'), page=page)
    page.keyboard.press('ArrowLeft')
    check('...expanding gives the tile the keys, with the ring', keys and wait_for(lambda: itext('#k', 'A tile with ways') == '3', page=page) and page.eval_on_selector(f'{W1} .tp-slot', 's => s.classList.contains("keys")'))
    page.wait_for_timeout(3500)
    check('...while expanded it never stops (more than the out-of-view time)', frames() == 1 and page.is_visible('.tp-x'))
    page.set_viewport_size({'width': 1100, 'height': 760}); page.wait_for_timeout(300)
    geo2 = page.evaluate(f"""() => {{ const s = document.querySelector('{J1} .tp-slot').getBoundingClientRect(), h = document.querySelector('.tp-x-hole').getBoundingClientRect(); return [s.width - h.width, s.height - h.height]; }}""")
    check('...a resized window: the tile follows the stage', abs(geo2[0]) < 2 and abs(geo2[1]) < 2, str(geo2))
    page.set_viewport_size({'width': 1400, 'height': 900}); page.wait_for_timeout(300)
    page.click('.tp-x-full')
    full = wait_for(lambda: page.evaluate(f"() => document.fullscreenElement === document.querySelector('{J1} .tp-slot')"), 4, page=page)
    check('EX1: "Full screen": the browser\'s own full screen for the tile', full)
    if full: page.evaluate('() => document.exitFullscreen()'); wait_for(lambda: page.evaluate('() => !document.fullscreenElement'), page=page)
    check('...leaving full screen keeps it expanded', page.is_visible('.tp-x') and frames() == 1)
    page.click('.tp-x-close')
    closed = wait_for(lambda: page.query_selector('.tp-x') is None and page.eval_on_selector(f'{W1} .tp-slot', 's => !s.classList.contains("expanded") && getComputedStyle(s).position === "relative" && !s.getAttribute("style")'), page=page)
    back = page.eval_on_selector(f'{W1} .tp-slot', 's => { const r = s.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }')
    check('EX5: × shrinks it back into the post, where it was', closed and all(abs(a - b) < 2 for a, b in zip(back, small)) and page.query_selector('.tp-slot-spacer') is None, str([back, small]))
    check('...still playing, the same frame (the keys counted are still there), Raku\'s address unchanged', frames() == 1 and itext('#k', 'A tile with ways') == '3' and 'raku%3Adiscover%2Fposts' in page.evaluate('location.hash'))
    check('...and the history step taken back off', wait_for(lambda: page.evaluate('history.state') is None, page=page))
    page.click(f'{W1} .tp-expand'); wait_for(lambda: page.is_visible('.tp-x'), page=page); page.wait_for_timeout(800)
    page.click('.tp-x-name'); page.keyboard.press('Escape')
    check('EX5: Escape (the keys with Raku) closes it', wait_for(lambda: page.query_selector('.tp-x') is None, page=page) and frames() == 1)
    page.wait_for_timeout(300)
    page.click(f'{W1} .tp-expand'); wait_for(lambda: page.is_visible('.tp-x'), page=page); page.wait_for_timeout(800)
    page.keyboard.press('Escape')
    check('...Escape pressed in the tile stays the tile\'s (keys pressed in a tile never reach Raku)', page.is_visible('.tp-x'))
    page.go_back()
    check('EX5: Back closes it, and stays in Raku on Tile posts', wait_for(lambda: page.query_selector('.tp-x') is None, page=page) and frames() == 1
          and texts(page, '.dv-centre h1') == ['Tile posts'] and 'raku%3Adiscover%2Fposts' in page.evaluate('location.hash'))
    page.wait_for_timeout(300)

    # ---- D: travel inside the post ----
    page.click(f'{W1} .tp-stop'); wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    page.click(f'{W1} .tp-play'); wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    wait_for(lambda: (itext('#st', 'A tile with ways') or 'none') != 'none', page=page)
    n_tabs = len(page.query_selector_all('.tab'))
    inner('A tile with ways').evaluate('() => leave("door")')
    exp = wait_for(lambda: page.is_visible('.tp-x'), page=page)
    scr = wait_for(lambda: page.is_visible(f'{W1} .way-screen') and page.inner_text(f'{W1} .way-name'), page=page)
    check('EX6: stepping through a portal while small expands first, then travels', exp and page.eval_on_selector(f'{W1} .tp-slot', 's => s.classList.contains("expanded")'))
    check('D: the screen between places, in the expanded tile, names where it leads', scr == 'Somewhere plain', str(scr))
    arrived = wait_for(lambda: itext('#h', 'A tile with ways') == 'Somewhere plain', 20, page=page)
    check('D: the place it leads to runs in the same slot (no new tab, Raku\'s address unchanged)', arrived and len(page.query_selector_all('.tab')) == n_tabs and frames() == 1
          and 'raku%3Adiscover%2Fposts' in page.evaluate('location.hash'))
    check('...the screen goes once it has arrived', wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page))
    check('EX7: the bar: "Somewhere plain", "Now in · by @…", "Back to Way tile"', page.inner_text('.tp-x-name') == 'Somewhere plain' and page.inner_text('.tp-x-by') == f'Now in · by @{A_H}'
          and page.is_visible('.tp-x-btn.back') and page.inner_text('.tp-x-btn.back') == 'Back to Way tile', page.inner_text('.tp-x-bar'))
    page.screenshot(path=str(OUT / 'expand-trip-wide.png'))
    check('...the place gets the keys', wait_for(lambda: page.evaluate('() => document.activeElement && document.activeElement.classList.contains("tp-frame")'), page=page))
    page.click('.tp-x-btn.back')
    check('EX7: "Back to Way tile": the screen names it, and it runs again', wait_for(lambda: page.is_visible(f'{W1} .way-screen') and page.inner_text(f'{W1} .way-name') == 'Way tile', page=page)
          and wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page))
    check('...arriving at the portal it was left by', wait_for(lambda: itext('#arr', 'A tile with ways') == 'door', page=page), str(itext('#arr', 'A tile with ways')))
    check('...and the bar is the post\'s own again: no "Back to", no "Now in"', wait_for(lambda: page.is_hidden('.tp-x-btn.back') and page.inner_text('.tp-x-by') == f'by @{A_H}', page=page), page.inner_text('.tp-x-bar'))
    wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page)
    # several doors: Pick a door, Stay here
    inner('A tile with ways').evaluate('() => leave("many")')
    pick = wait_for(lambda: page.is_visible(f'{W1} .way-door-list') and texts(page, f'{W1} .way-door-name'), page=page)
    page.screenshot(path=str(OUT / 'expand-pick-wide.png'))
    check('D: a way to several places: "Pick a door", with Stay here', pick == ['Somewhere plain', 'Forest'] and page.inner_text(f'{W1} .way-name') == 'Pick a door'
          and page.is_visible(f'{W1} .way-actions button:text-is("Stay here")'), str(pick))
    page.click(f'{W1} .way-actions button:text-is("Stay here")')
    check('...Stay here: back at that portal, in the same place', wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None and itext('#arr', 'A tile with ways') == 'door,many', page=page)
          and itext('#h', 'A tile with ways') == 'Way tile', str(itext('#arr', 'A tile with ways')))
    inner('A tile with ways').evaluate('() => leave("many")')
    wait_for(lambda: page.is_visible(f'{W1} .way-door-list'), page=page)
    page.click(f'{W1} .way-door:has-text("Forest")')
    check('...a door chosen: that place, at the door\'s entrance', wait_for(lambda: itext('#h', 'A tile with ways') == 'Forest', 20, page=page)
          and wait_for(lambda: itext('#arr', 'A tile with ways') == 'back', page=page) and page.inner_text('.tp-x-btn.back') == 'Back to Way tile')
    fst = wait_for(lambda: (lambda v: v if v and v != 'none' else None)(itext('#st', 'A tile with ways')), page=page)
    check('...and its own exits answered', fst and json.loads(fst) == {'back': 'open'}, str(fst))
    # a large place asks first
    page.click('.tp-x-btn.back'); wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page)
    inner('A tile with ways').evaluate('() => leave("big")')
    q = wait_for(lambda: page.is_visible(f'{W1} .way-msg') and page.inner_text(f'{W1} .way-msg'), page=page)
    check('D: a large place asks first, on the screen: "This tile is large (60 MB). Go anyway?"', q == 'This tile is large (60 MB). Go anyway?' and itext('#h', 'A tile with ways') == 'Way tile', str(q))
    page.click(f'{W1} .way-actions button:text-is("Stay here")')
    check('...Stay here: back at that portal', wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None and itext('#arr', 'A tile with ways').endswith(',big'), page=page), str(itext('#arr', 'A tile with ways')))
    # a dormant way while expanded
    inner('A tile with ways').evaluate('() => leave("shut")')
    note = wait_for(lambda: page.is_visible('.tp-x-note') and page.inner_text('.tp-x-note'), page=page)
    check('D: a way that leads nowhere, expanded: back at that portal, "The way is blocked." in the expanded view', note == 'The way is blocked.' and wait_for(lambda: itext('#arr', 'A tile with ways').endswith(',shut'), page=page), str(note))
    # shrinking back after a trip (EX7)
    inner('A tile with ways').evaluate('() => leave("door")')
    wait_for(lambda: itext('#h', 'A tile with ways') == 'Somewhere plain', 20, page=page)
    wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page)
    page.click('.tp-x-close')
    wait_for(lambda: page.query_selector('.tp-x') is None, page=page)
    now = wait_for(lambda: page.is_visible(f'{W1} .tp-now') and page.inner_text(f'{W1} .tp-now'), page=page)
    page.eval_on_selector(W1, 'e => e.scrollIntoView({ block: "center" })'); page.screenshot(path=str(OUT / 'expand-back-wide.png'))
    check('EX7: shrunk back after a trip: it stays where it went, with "Now in: Somewhere plain, by @…" and "Back to Way tile" on the card',
          now and now.replace('\n', ' ').startswith(f'Now in: Somewhere plain, by @{A_H}') and 'Back to Way tile' in now and itext('#h', 'A tile with ways') == 'Somewhere plain', str(now))
    page.click(f'{W1} .card-corner .card-btn')
    wt = wait_for(lambda: len(page.query_selector_all('.tab')) == n_tabs + 1 and page.input_value('.addr'), page=page)
    check("EX7: the card's new-tab button opens the way taken (raku:way/…)", wt and 'raku:way/' in wt and wt.endswith('/waytile.door'), str(wt))
    page.click('.tab:nth-child(1)'); wait_for(lambda: page.is_visible(f'{W1} .tp-now'), page=page)
    page.click(f'{W1} .tp-now button')
    check('...the card\'s "Back to Way tile": back in place, small, at the portal; the line goes', wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
          and page.query_selector('.tp-x') is None and wait_for(lambda: page.is_hidden(f'{W1} .tp-now'), page=page) and wait_for(lambda: itext('#arr', 'A tile with ways') == 'door', page=page),
          str([itext('#h', 'A tile with ways'), itext('#arr', 'A tile with ways'), page.is_hidden(f'{W1} .tp-now'), frames()]))
    wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page)
    # the expanded view's New tab after a trip
    inner('A tile with ways').evaluate('() => leave("door")')
    wait_for(lambda: itext('#h', 'A tile with ways') == 'Somewhere plain', 20, page=page)
    n2 = len(page.query_selector_all('.tab'))
    page.click('.tp-x-new')
    wt2 = wait_for(lambda: len(page.query_selector_all('.tab')) == n2 + 1 and page.input_value('.addr'), page=page)
    check('EX7: the expanded view\'s New tab: it shrinks back and the way taken opens in a new tab', wt2 and wt2.endswith('/waytile.door') and page.query_selector('.tp-x') is None, str(wt2))
    page.wait_for_timeout(800)
    check('...and the new tab stays (the history step taken off didn\'t undo it)', len(page.query_selector_all('.tab')) == n2 + 1 and wait_for(lambda: page.evaluate('() => document.querySelector(".tab.on") === document.querySelector(".tab:last-child")'), page=page))
    page.click('.tab:nth-child(1)'); wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'], page=page)
    # stopping resets it
    if not page.is_visible(f'{W1} .tp-stop'): page.click(f'{W1} .tp-play')
    wait_for(lambda: page.is_visible(f'{W1} .tp-stop'), page=page)
    page.click(f'{W1} .tp-stop')
    check('EX7: stopping brings the post\'s own banner back, ready from the start (no "Now in")', wait_for(lambda: page.is_visible(f'{W1} .tp-play') and frames() == 0, page=page) and page.is_hidden(f'{W1} .tp-now'))
    page.click(f'{W1} .tp-play')
    check('...Play again: the post\'s own tile', wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page))
    page.click(f'{W1} .tp-expand'); wait_for(lambda: page.is_visible('.tp-x'), page=page); page.wait_for_timeout(800)
    page.eval_on_selector('.tab:nth-child(2)', 't => t.click()')       # (under the expanded view: as from the keyboard)
    check('another Raku tab in front while expanded: it shrinks back (and stops after a few seconds, PH2)', wait_for(lambda: page.query_selector('.tp-x') is None, page=page)
          and wait_for(lambda: len(page.query_selector_all('.tab')) == 3, page=page))
    page.click('.tab:nth-child(1)'); wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'], page=page)
    check('no page errors with expand and travel', not cerrors, str(cerrors))
    ctx7.close()

    # ---- EX4: window, 400 ms, linear (the owner's choice; the test switch removed); EX8: reduced motion fades ----
    def tag(pg, sel):           # (Playwright's :text-is isn't for the page's own querySelector: mark the post)
        pg.eval_on_selector(sel, 'e => e.setAttribute("data-ck", "x")'); return '[data-ck="x"]'
    def motion_of(pg, sel):
        return pg.evaluate(f"""() => {{ const s = document.querySelector('{tag(pg, sel)} .tp-slot'); document.querySelector('{tag(pg, sel)} .tp-expand').click();
          const g = document.querySelector('.tp-ghost');
          return {{ slot: s.getAnimations().map(a => [a.effect.getTiming().duration, a.effect.getTiming().easing, Object.keys(a.effect.getKeyframes()[0]).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort().join(',')]),
                   ghost: g ? g.getAnimations().length : 0, opacity: s.style.opacity }}; }}""")
    for q, label in [('', 'EX4: expanding opens as a window (a clip from the post\'s box), 400 ms, linear'),
                     ('?expand=grow&ms=900&ease=ease-out&', '...the old test switch in the address is ignored now (the same window, 400 ms)')]:
        cx = new_ctx(); pg = cx.new_page()
        pg.goto(RAKU + (q or '?') + 'loader=' + LOADER + '#t=raku%3Adiscover%2Fposts&a=0'); pg.wait_for_selector('.discover')
        S2 = post_sel('A second tile')
        page = pg
        wait_for(lambda: pg.is_visible(f'{S2} .tp-play'), page=pg); pg.click(f'{S2} .tp-play')
        wait_for(lambda: pg.is_visible(f'{S2} .tp-expand'), 20, page=pg)
        small = pg.eval_on_selector(f'{S2} .tp-slot', 's => s.getBoundingClientRect().width')
        m = motion_of(pg, S2)
        width_now = pg.eval_on_selector(f'{S2} .tp-slot', 's => s.getBoundingClientRect().width')
        check(label, any(a[0] == 400 and a[1] == 'linear' and a[2] == 'clipPath' for a in m['slot']) and not any('width' in a[2] for a in m['slot']) and m['ghost'] == 0, str(m))
        check('...the live tile is at its full size from the start (not redrawn at every size)', width_now > small * 1.5, str([small, width_now]))
        done = wait_for(lambda: pg.eval_on_selector(f'{S2} .tp-slot', 's => s.getAnimations().length === 0 && !s.style.clipPath'), 5, page=pg)
        geo = pg.evaluate(f"""() => {{ const s = document.querySelector('{tag(pg, S2)} .tp-slot').getBoundingClientRect(), h = document.querySelector('.tp-x-hole').getBoundingClientRect(); return [s.width - h.width, s.height - h.height]; }}""")
        check('...and it ends filling the stage, unclipped', done and abs(geo[0]) < 2 and abs(geo[1]) < 2, str(geo))
        if not q:
            pg.click('.tp-x-close')
            closing = pg.evaluate(f"() => document.querySelector('{tag(pg, S2)} .tp-slot').getAnimations().map(a => Object.keys(a.effect.getKeyframes()[0]).join(','))")
            check('...closing: the clip closes back to the post\'s box', any('clipPath' in k for k in closing), str(closing))
            back = wait_for(lambda: pg.query_selector('.tp-x') is None and pg.eval_on_selector(f'{S2} .tp-slot', 's => !s.getAttribute("style")'), page=pg)
            check('...then the tile is back in its post, nothing left pinned or clipped', back)
        cx.close()
    cx = new_ctx(reduced_motion='reduce'); pg = cx.new_page(); page = pg
    pg.goto(PLAY_URL); pg.wait_for_selector('.discover')
    S2 = post_sel('A second tile')
    wait_for(lambda: pg.is_visible(f'{S2} .tp-play'), page=pg); pg.click(f'{S2} .tp-play')
    wait_for(lambda: pg.is_visible(f'{S2} .tp-expand'), 20, page=pg)
    m = motion_of(pg, S2)
    check('EX8: with reduced motion, expanding is a plain fade (no clip, no growing)', any(a[2] == 'opacity' for a in m['slot']) and not any(a[2] in ('clipPath',) or 'width' in a[2] for a in m['slot']), str(m))
    pg.wait_for_timeout(600)
    pg.click('.tp-x-close')
    check('...and closing too', pg.evaluate(f"() => document.querySelector('{tag(pg, S2)} .tp-slot').getAnimations().some(a => Object.keys(a.effect.getKeyframes()[0]).includes('opacity'))")
          and wait_for(lambda: pg.query_selector('.tp-x') is None, page=pg))
    cx.close()

    # ---- the phone ----
    ctx9 = new_ctx(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx9.new_page()
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W1 = post_sel('A tile with ways')
    wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    page.eval_on_selector(W1, 'e => { e.setAttribute("data-ck", "w1"); e.scrollIntoView({ block: "center" }); }')
    page.tap(f'{W1} .tp-play'); wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    wait_for(lambda: page.is_visible(f'{W1} .tp-expand'), page=page)
    page.tap(f'{W1} .tp-expand'); wait_for(lambda: page.is_visible('.tp-x'), page=page); page.wait_for_timeout(500)
    lay = page.evaluate(f"""() => {{ const s = document.querySelector('{J1} .tp-slot').getBoundingClientRect(), who = document.querySelector('.tp-x-who').getBoundingClientRect(),
      x = document.querySelector('.tp-x-close').getBoundingClientRect(), bar = document.querySelector('.tp-x-bar').getBoundingClientRect();
      return {{ s: [s.left, s.top, s.width, s.bottom], who: [who.width, who.bottom], x: [x.top, x.right], bar: bar.bottom, w: innerWidth, h: innerHeight, wide: document.documentElement.scrollWidth <= innerWidth }}; }}""")
    check('phone: the expanded bar in two rows (the name, then the buttons on the right)', lay['x'][0] >= lay['who'][1] - 1 and abs(lay['x'][1] - (lay['w'] - 10)) < 2 and lay['who'][0] > 300, str(lay))
    check('...the tile edge to edge under the bar, to the bottom of the screen', abs(lay['s'][0]) < 1 and abs(lay['s'][2] - lay['w']) < 1 and abs(lay['s'][1] - lay['bar']) < 1 and abs(lay['s'][3] - lay['h']) < 1 and lay['wide'], str(lay))
    page.screenshot(path=str(OUT / 'expand-phone.png'))
    inner('A tile with ways').evaluate('() => leave("door")')
    wait_for(lambda: itext('#h', 'A tile with ways') == 'Somewhere plain', 20, page=page)
    wait_for(lambda: page.query_selector(f'{W1} .way-screen') is None, 6, page=page)
    check('...after a trip: "Back to Way tile" in the bar, with its words', page.is_visible('.tp-x-btn.back') and page.inner_text('.tp-x-btn.back') == 'Back to Way tile')
    page.screenshot(path=str(OUT / 'expand-phone-trip.png'))
    page.tap('.tp-x-close'); wait_for(lambda: page.query_selector('.tp-x') is None, page=page)
    check('...shrunk back: the "Now in" line on the card fits the width', page.is_visible(f'{W1} .tp-now') and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.screenshot(path=str(OUT / 'expand-phone-back.png'))
    ctx9.close()

    # ---- the installed window with its title bar folded away (stage 9, S7): the bar keeps clear of the window's buttons ----
    ctx10 = new_ctx(viewport={'width': 1200, 'height': 800})
    ctx10.add_init_script("""
      const overlay = new EventTarget(); overlay.visible = true;
      overlay.getTitlebarAreaRect = () => new DOMRect(0, 0, (window.__areaW || innerWidth) - 140, 33);
      Object.defineProperty(navigator, 'windowControlsOverlay', { value: overlay });
      // as the real window did (owner, Nov 8): the new title bar told of before the window's width changes
      window.__news = (w) => { window.__areaW = w; overlay.dispatchEvent(new Event('geometrychange')); };
    """)
    page = ctx10.new_page()
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W1 = post_sel('A tile with ways')
    wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    page.click(f'{W1} .tp-play'); wait_for(lambda: itext('#h', 'A tile with ways') == 'Way tile', 20, page=page)
    wait_for(lambda: page.is_visible(f'{W1} .tp-expand'), page=page)
    page.click(f'{W1} .tp-expand'); wait_for(lambda: page.is_visible('.tp-x'), page=page); page.wait_for_timeout(800)
    lay = page.evaluate("""() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const reg = (s) => getComputedStyle(document.querySelector(s)).webkitAppRegion;
      return { wco: document.documentElement.classList.contains('wco'), x: r('.tp-x-close').right, full: r('.tp-x-full').right, limit: innerWidth - 140,
               bar: reg('.tp-x-bar'), btn: reg('.tp-x-close'), newtab: reg('.tp-x-new') }; }""")
    check("installed, title bar folded away: the expanded bar's buttons keep clear of the window's own (…, minimise, maximise, close)",
          lay['wco'] and lay['x'] <= lay['limit'] - 8 and lay['full'] < lay['x'], str(lay))
    check('...the bar moves the window; its buttons still click', lay['bar'] == 'drag' and lay['btn'] == 'no-drag' and lay['newtab'] == 'no-drag', str(lay))
    def after_resize(w):
        page.evaluate(f'__news({w})')
        page.set_viewport_size({'width': w, 'height': 800})
        page.wait_for_timeout(400)
        return page.evaluate("""() => ({ x: document.querySelector('.tp-x-close').getBoundingClientRect().right, w: innerWidth,
          slot: Math.abs(document.querySelector('.tp-slot.expanded').getBoundingClientRect().width - document.querySelector('.tp-x-hole').getBoundingClientRect().width) })""")
    smaller = after_resize(900)
    check('...the window made smaller while expanded: the buttons stay just left of the window\'s own (not pushed far left)', smaller['w'] == 900 and smaller['w'] - 160 <= smaller['x'] <= smaller['w'] - 148 and smaller['slot'] < 2, str(smaller))
    bigger = after_resize(1300)
    check('...and made bigger again: still clear of them (not back under them)', bigger['w'] == 1300 and bigger['w'] - 160 <= bigger['x'] <= bigger['w'] - 148 and bigger['slot'] < 2, str(bigger))
    page.screenshot(path=str(OUT / 'expand-wco.png'), clip={'x': 0, 'y': 0, 'width': 1200, 'height': 120})
    page.click('.tp-x-close')
    check('...and × closes it there', wait_for(lambda: page.query_selector('.tp-x') is None, page=page))
    ctx10.close()

    # ================= Autoplay (claude/raku-expand-plan.md, "After C", AU1 to AU6) =================
    playing_post = lambda: page.evaluate("() => { const f = document.querySelector('.tile-post iframe.tp-frame'); return f ? f.closest('.tile-post').querySelector('.post-text').textContent : null; }")
    has_keys = lambda: page.evaluate('() => !!document.activeElement && document.activeElement.classList.contains("tp-frame")')
    def centre(text):
        page.eval_on_selector(post_sel(text), 'e => e.scrollIntoView({ block: "center" })')
    ctx11 = new_ctx()
    page = ctx11.new_page()
    aerrors = []
    page.on('pageerror', lambda e: aerrors.append(str(e)))
    page.goto(PLAY_URL); page.wait_for_selector('.discover')
    W1 = post_sel('A tile with ways')
    wait_for(lambda: page.is_visible(f'{W1} .tp-play'), page=page)
    page.wait_for_timeout(2500)
    check('AU1: Autoplay is off by default: nothing starts by itself', frames() == 0)
    sw = '.dv-head .dv-autoplay .rk-switch'
    check('AU5: the switch in Tile posts\' header, beside Refresh: "Autoplay", off', page.is_visible(sw) and page.get_attribute(sw, 'aria-checked') == 'false'
          and page.inner_text('.dv-head .dv-autoplay') == 'Autoplay' and page.evaluate("() => document.querySelector('.dv-autoplay').nextElementSibling.classList.contains('dv-refresh')"))
    page.click('.account-btn')
    msw = '.account-menu .acct-autoplay .rk-switch'
    check('AU5: and a line in the account menu (signed out too), off', page.is_visible(msw) and page.get_attribute(msw, 'aria-checked') == 'false'
          and 'Autoplay tile posts' in page.inner_text('.acct-autoplay'))
    page.keyboard.press('Escape')
    page.click(sw)
    started = wait_for(lambda: frames() == 1, 8, page=page)
    first = playing_post()
    check('AU2: turned on, a tile already showing starts by itself after a moment (one at a time)', started and first in ('A tile with ways', 'A second tile'), str(first))
    FS = post_sel(first)
    lab = wait_for(lambda: page.is_visible(f'{FS} .tp-auto-hint') and page.inner_text(f'{FS} .tp-auto-hint'), 20, page=page)
    check('AU3: its label: "Click to play with keys and sound", which stays', lab == 'Click to play with keys and sound', str(lab))
    page.wait_for_timeout(3000)
    check('AU3: it takes no keys (no ring) while untouched', not has_keys() and not page.eval_on_selector(f'{FS} .tp-slot', 's => s.classList.contains("keys")')
          and page.is_visible(f'{FS} .tp-auto-hint'))
    page.click('.account-btn')
    check('AU5: the account menu\'s switch says on too', page.get_attribute(msw, 'aria-checked') == 'true')
    page.keyboard.press('Escape')
    box = page.eval_on_selector(f'{FS} .tp-slot', 's => { const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }')
    page.mouse.click(box[0], box[1])
    check('AU3: clicked: the keys and the ring, the label gone', wait_for(lambda: has_keys(), page=page) and wait_for(lambda: page.query_selector(f'{FS} .tp-auto-hint') is None, page=page)
          and page.eval_on_selector(f'{FS} .tp-slot', 's => s.classList.contains("keys")'))
    # a tile you've clicked isn't taken over
    other = 'A second tile' if first == 'A tile with ways' else 'A tile with ways'
    page.evaluate("() => document.querySelector('.pane.front').scrollBy(0, 60)")
    page.wait_for_timeout(2000)
    check('...a tile you\'ve clicked isn\'t taken over by another one showing', playing_post() == first, str(playing_post()))
    # × : not again while you stay
    page.click(f'{FS} .tp-stop')
    wait_for(lambda: page.is_visible(f'{FS} .tp-play'), page=page)
    page.eval_on_selector(FS, """p => { window.__again = false; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes)
      if (n.classList && n.classList.contains('tp-frame')) window.__again = true; }).observe(p.querySelector('.tp-slot'), { childList: true }); }""")
    page.wait_for_timeout(2500)
    check('stopped with its ×: it doesn\'t start again by itself while you stay on the page', not page.evaluate('window.__again') and playing_post() != first, str(playing_post()))
    # the large one never starts by itself (AU4)
    page.click(f'{post_sel(playing_post())} .tp-stop') if playing_post() else None
    centre('A large tile')
    page.wait_for_timeout(3000)
    LG = post_sel('A large tile')
    check('AU4: a tile over 25 MB never starts by itself: Play here and its question as before', playing_post() != 'A large tile' and page.is_visible(f'{LG} .tp-play'), str(playing_post()))
    # scrolling to a filler: it starts; scrolled past quickly: nothing
    centre('Filler 2')
    check('AU2: scrolled to another post, it starts by itself there', wait_for(lambda: playing_post() == 'Filler 2', 8, page=page), str(playing_post()))
    centre('Filler 4'); page.wait_for_timeout(300); centre('Filler 2')
    page.wait_for_timeout(2000)
    check('...scrolled past another quickly: that one didn\'t start', playing_post() == 'Filler 2', str(playing_post()))
    # remembered in this browser
    page.reload(); page.wait_for_selector('.discover')
    check('AU1: remembered in this browser: still on after a reload, and a tile starts by itself', page.get_attribute(sw, 'aria-checked') == 'true' and wait_for(lambda: frames() == 1, 10, page=page))
    first = playing_post(); FS = post_sel(first)
    wait_for(lambda: page.is_visible(f'{FS} .tp-auto-hint'), 20, page=page)
    page.click(f'{FS} .tp-expand')
    check('expanding a tile that started by itself gives it the keys (the label goes)', wait_for(lambda: page.is_visible('.tp-x'), page=page) and wait_for(lambda: has_keys(), page=page)
          and page.query_selector(f'{FS} .tp-auto-hint') is None)
    page.click('.tp-x-close'); wait_for(lambda: page.query_selector('.tp-x') is None, page=page)
    page.click(f'{FS} .tp-stop'); wait_for(lambda: frames() == 0, page=page)
    page.wait_for_timeout(200)
    # (any tile starting meanwhile is untouched) turning it off stops an untouched one
    centre('Filler 3')
    wait_for(lambda: playing_post() == 'Filler 3', 8, page=page)
    page.click('.account-btn'); page.click(msw); page.keyboard.press('Escape')
    check('turned off (from the account menu): an untouched tile stops; the header\'s switch says off', wait_for(lambda: frames() == 0, page=page) and page.get_attribute(sw, 'aria-checked') == 'false')
    page.wait_for_timeout(2000)
    check('...and nothing starts by itself any more', frames() == 0)
    check('the wording on Discover says so', 'if you turn on Autoplay, when its post has been on screen a moment' in page.inner_text('.dv-right'))
    page.goto(RAKU + '#t=raku%3Aabout&a=0'); page.wait_for_selector('.about')
    check('...and the About page', 'if you turn on Autoplay' in page.inner_text('.about') and 'off unless you turn it on' in page.inner_text('.about'))
    check('no page errors with Autoplay', not aerrors, str(aerrors))
    ctx11.close()
    # AU6: reduced motion doesn't stop it; a phone says "Tap"
    ctx12 = new_ctx(reduced_motion='reduce')
    ctx12.add_init_script("try { localStorage.setItem('raku-autoplay', 'on'); } catch {}")
    page = ctx12.new_page(); page.goto(PLAY_URL); page.wait_for_selector('.discover')
    check('AU6: with reduced motion, Autoplay (turned on) still starts tiles', wait_for(lambda: frames() == 1, 10, page=page))
    ctx12.close()
    ctx13 = new_ctx(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx13.add_init_script("try { localStorage.setItem('raku-autoplay', 'on'); } catch {}")
    page = ctx13.new_page(); page.goto(PLAY_URL); page.wait_for_selector('.discover')
    page.tap('.dv-head h1')
    wait_for(lambda: frames() == 1, 10, page=page)
    first = playing_post(); FS = post_sel(first)
    lab = wait_for(lambda: page.is_visible(f'{FS} .tp-auto-hint') and page.inner_text(f'{FS} .tp-auto-hint'), 20, page=page)
    check('phone: an auto-started tile says "Tap to play with keys and sound"', lab == 'Tap to play with keys and sound', str(lab))
    check('...the header (switch and Refresh) fits the width', page.evaluate('document.documentElement.scrollWidth <= innerWidth') and page.is_visible(sw))
    page.screenshot(path=str(OUT / 'autoplay-phone.png'))
    ctx13.close()
    state['play'] = False
    b.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
