# Raku's Tile posts (Discover → Tile posts, raku:discover/posts; claude/tile-posts-plan.md stage 3) browser checks,
# in the chat sandbox: posts from several accounts in order (the relay's, the owner's and the shelf's), the author
# (avatar, name, handle), the time, the text and the tile's card with its banner and the post's alt; the relay failing
# (the accounts Raku knows, and the quiet note); a hidden account and a hidden tile; a missing and a changed tile
# ("This tile can't be shown."); over-long text cut; opening a card (the tile in this tab) and its corner button (a new
# tab); Refresh; the right column's preview from another source; the empty page; the phone.
# Everything outside is a Playwright route (the account directory, the relay, account servers, Bluesky's public API
# and its picture server, the hide list). Tiles aren't run here (check_page.py does that).
# Usage: python3 test/browser/check_posts.py <work folder>   (servers.mjs already running, as for check_discover.py)
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
state = {'relay': 'ok', 'empty': False}

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
        return js({'repos': [] if state['empty'] else [{'did': R}, {'did': A}, {'did': H}]})
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
            return js({'records': POSTS.get(repo, [])[:int(q.get('limit', 50))]})
        if u.path.endswith('getRecord'):
            rec = TILES.get((repo, q.get('rkey')))
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
    alt = wait_for(lambda: page.eval_on_selector(f'{first} .card-pic img', 'i => i.complete && i.naturalWidth > 0 && i.alt'), page=page)
    check("...its banner, from the tile's own server, described by the post's alt", alt == 'A small 3D maze you walk with the arrow keys', str(alt))
    sec = '.tile-post:nth-child(2)'
    alt2 = wait_for(lambda: page.eval_on_selector(f'{sec} .card-pic img', 'i => i.complete && i.naturalWidth > 0 && i.alt'), page=page)
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
    wait_for(lambda: page4.eval_on_selector('.tile-post:nth-child(1) .card-pic img', 'i => i.complete && i.naturalWidth > 0'), page=page4)
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
    b.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
