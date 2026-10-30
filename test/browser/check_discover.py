# Raku stage 6 (Discover) browser checks, in the chat sandbox: the Discover page's columns at four widths,
# Following (newest first, hidden ones left out, "New" since the last visit), search (the address box and the
# Discover box: your shelf first, then appmosphe.re, only on Enter), Tile news from a stand-in feed (?feed=,
# this computer only) with a post linking a tile, labels and the link message, and a post's address in the box;
# Recent tiles (stage 6c: appmosphe.re's list as it is, the hide list and account labels, pictures only from
# appmosphe.re's /img/ copies, More, "New" since the last visit); Make a tile (the makers in two groups,
# Open in a new tab, set apart at the bottom of the sources); the About page (going public, Q134: its three links,
# what it says, the phone).
# Everything outside is a Playwright route (account directory, account servers, Bluesky's public API, its
# picture server, appmosphe.re). Tiles aren't run here (check_page.py does that).
# Usage: python3 test/browser/check_discover.py <work folder>   (servers.mjs and the replica already running,
# as for check_page.py)
import hashlib, io, json, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_H = 'thunderbird.cafe'
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'
B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'; B_H = 'bad.fakepds.net'          # hidden by Bluesky's moderation
MK = 'did:plc:makeraaaaaaaaaaaaaaaaaaa'; MK_H = 'maker.fakepds.net'        # a made-up tile maker
LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
SALT = 'lexicographer.space hide list v1'
FEED = f'at://{A}/app.bsky.feed.generator/Web-Tiles'          # the real feed's address (config.js FEED, step 6b)
AD = 'did:plc:adultaaaaaaaaaaaaaaaaaaa'; AD_H = 'adult.fakepds.net'      # labelled adult: pictures blurred
NH = 'did:plc:nohandleaaaaaaaaaaaaaaaa'                                      # a handle Bluesky couldn't check
RB = 'did:plc:izttpdp3l6vss5crelt5kcux'; RB_H = 'robin.berjon.com'      # hand-picked posts (config.js NEWS_PINS)
HANDLES = {A: A_H, P: P_H, B: B_H, MK: MK_H, RB: RB_H}

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(1280, 720)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def tile(name, created, desc='', color=(120, 120, 120)):
    page = f'<!doctype html><h1>{name}</h1>'.encode()
    res = {'/': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(page)}, 'mimeType': 'text/html', 'size': len(page)}, 'content-type': 'text/html'}}
    banner = png(color)
    res['/banner.png'] = {'src': {'$type': 'blob', 'ref': {'$link': cid_for(banner)}, 'mimeType': 'image/png', 'size': len(banner)}, 'content-type': 'image/png'}
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': name, 'description': desc, 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': created}

records = {
    (A, 'coaster2'): tile('Coaster Two', '2026-10-20T10:00:00Z', 'A second coaster', (200, 90, 60)),
    (A, 'lantern1'): tile('Glass Lantern', '2026-10-05T10:00:00Z', 'A lantern', (60, 160, 150)),
    (A, 'hidden1'): tile('Hidden coaster', '2026-10-21T10:00:00Z'),
    (P, '3mx6h2wjtgq2h'): tile('Roller Coaster', '2026-10-12T10:00:00Z', 'Take your sprite to the amusement park', (90, 60, 160)),
    (B, 'bad1'): tile('Bad coaster', '2026-10-21T11:00:00Z'),
    (MK, 'rc1'): tile('Pebble Garden', '2026-10-22T00:00:00Z', 'A garden of pebbles', (150, 140, 120)),   # Recent tiles (stage 6c)
}
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [], 'tiles': [hashlib.sha256(f'{SALT}\n{A}\nhidden1'.encode()).hexdigest()]})

def post(did, rkey, text, created, facets=None, embed_rec=None, embed_view=None, labels=None, reply=None):
    rec = {'$type': 'app.bsky.feed.post', 'text': text, 'createdAt': created}
    if reply: rec['reply'] = {'root': {'uri': reply[0], 'cid': 'bafyreix'}, 'parent': {'uri': reply[1], 'cid': 'bafyreix'}}
    if facets: rec['facets'] = facets
    if embed_rec: rec['embed'] = embed_rec
    v = {'uri': f'at://{did}/app.bsky.feed.post/{rkey}', 'cid': 'bafyreipost' + rkey, 'author': {'did': did, 'handle': HANDLES[did], 'displayName': HANDLES[did].split('.')[0].title(), 'avatar': 'https://cdn.bsky.app/img/avatar/plain/x/av@jpeg', 'labels': []},
         'record': rec, 'labels': labels or [], 'indexedAt': created}
    if embed_view: v['embed'] = embed_view
    return v
def facet(text, sub, feat):
    i = text.index(sub); s = len(text[:i].encode()); return {'index': {'byteStart': s, 'byteEnd': s + len(sub.encode())}, 'features': [feat]}

T2 = 'New tile out: https://example.org/blog by @thunderbird.cafe #webtiles and lexicographer.space/@thunderbird.cafe/coaster2'
POSTS = [
    post(MK, '3post1', 'My new tile is up', '2026-10-16T11:52:53Z',
         embed_rec={'$type': 'app.bsky.embed.external', 'external': {'uri': 'https://lexicographer.space/@pyxorium.com/3mx6h2wjtgq2h', 'title': 'Roller Coaster', 'description': 'Take your sprite to the amusement park'}},
         embed_view={'$type': 'app.bsky.embed.external#view', 'external': {'uri': 'https://lexicographer.space/@pyxorium.com/3mx6h2wjtgq2h', 'title': 'Roller Coaster', 'description': 'Take your sprite to the amusement park', 'thumb': 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/t@jpeg'}}),
    post(A, '3post2', T2, '2026-10-20T09:00:00Z', facets=[
        facet(T2, 'https://example.org/blog', {'$type': 'app.bsky.richtext.facet#link', 'uri': 'https://example.org/blog'}),
        facet(T2, '@thunderbird.cafe', {'$type': 'app.bsky.richtext.facet#mention', 'did': A}),
        facet(T2, '#webtiles', {'$type': 'app.bsky.richtext.facet#tag', 'tag': 'webtiles'}),
        facet(T2, 'lexicographer.space/@thunderbird.cafe/coaster2', {'$type': 'app.bsky.richtext.facet#link', 'uri': 'https://lexicographer.space/@thunderbird.cafe/coaster2'})]),
    post(A, '3post3', 'Pictures of the die', '2026-10-19T09:00:00Z', labels=[{'src': LABELER, 'val': 'graphic-media'}],
         embed_view={'$type': 'app.bsky.embed.images#view', 'images': [{'thumb': 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/p1@jpeg', 'fullsize': 'https://cdn.bsky.app/img/feed_fullsize/plain/x/p1@jpeg', 'alt': 'a die'}, {'thumb': 'https://evil.example/p.jpg'}]}),
    post(A, '3post4', 'This one is hidden by moderation', '2026-10-18T09:00:00Z', labels=[{'src': LABELER, 'val': '!hide'}]),
    post(P, '3post5', 'Behind a warning', '2026-10-17T09:00:00Z', labels=[{'src': LABELER, 'val': '!warn'}]),
    post(B, '3post6', 'From a hidden account', '2026-10-17T08:00:00Z'),
]
# Q97: replies with their thread. The owner's example shape: a first post, a reply to it, a reply to that.
U = lambda did, rkey: f'at://{did}/app.bsky.feed.post/{rkey}'
TH1 = post(P, 'th1', 'Anyone noticed we could build a web of tiles?', '2026-10-15T09:00:00Z')
TH2 = post(A, 'th2', 'If it meets someone\'s needs, it is just the web.', '2026-10-15T10:00:00Z', reply=(U(P, 'th1'), U(P, 'th1')))
TH3 = post(MK, 'th3', 'What is the name spec about?', '2026-10-15T11:00:00Z', reply=(U(P, 'th1'), U(A, 'th2')))
DP2 = post(A, 'dp2', 'Deep in a thread', '2026-10-14T10:00:00Z', reply=(U(P, 'dr1'), U(P, 'dmid')))
DP3 = post(MK, 'dp3', 'Answering the deep one', '2026-10-14T11:00:00Z', reply=(U(P, 'dr1'), U(A, 'dp2')))
TH4 = post(P, 'th4', 'Another answer to the first post', '2026-10-15T09:30:00Z', reply=(U(P, 'th1'), U(P, 'th1')))   # Q123: same thread as TH3
LONE = post(MK, 'lone1', 'A reply sent without its thread', '2026-10-13T11:00:00Z', reply=(U(P, 'zz1'), U(P, 'zz1')))
# Hand-picked posts (NEWS_PINS, Oct 24): the stand-in answers getPosts for three of the real addresses (the others
# drop out, as a deleted post would); one is newer than the feed's oldest post, so it's mixed in, not at the end.
PIN_URIS = [l.split("'")[1] for l in (Path(__file__).parents[2] / 'src' / 'config.js').read_text().split('export const NEWS_PINS')[1].split(']);')[0].splitlines() if l.strip().startswith("'at://")]
PINS = [
    post(RB, '3juhmexrpxd2m', 'Very early "Web Tiles" working!', '2023-04-28T21:59:21.128Z',
         embed_view={'$type': 'app.bsky.embed.images#view', 'images': [{'thumb': 'https://cdn.bsky.app/img/feed_thumbnail/plain/x/rb@jpeg', 'fullsize': 'https://cdn.bsky.app/img/feed_fullsize/plain/x/rb@jpeg', 'alt': 'an early tile'}]}),
    post(RB, '3mej27i74zk2t', 'Hot off the internets: Web Tiles!', '2026-02-10T13:15:05.652Z',
         embed_view={'$type': 'app.bsky.embed.external#view', 'external': {'uri': 'https://webtil.es/', 'title': 'Web Tiles', 'description': 'Publish tiles to AT'}}),
    post(RB, '3mjf6xuzgtk2t', 'Hidden by moderation, hand-picked or not', '2026-04-13T15:35:33.850Z', labels=[{'src': LABELER, 'val': '!hide'}]),
    post(RB, '3mia346rdic2b', 'Dated between two feed posts', '2026-10-14T12:00:00Z'),   # mixed in by date: before dp3 (Oct 14 11:00)
]
THREAD_ITEMS = [
    {'post': TH3, 'reply': {'root': TH1, 'parent': TH2}},
    {'post': TH2, 'reply': {'root': TH1, 'parent': TH1}},             # already drawn as context above: not again
    {'post': TH4, 'reply': {'root': TH1, 'parent': TH1}},             # Q123: same thread, not drawn: counted on TH3's card
    {'post': DP3, 'reply': {'root': {'$type': 'app.bsky.feed.defs#blockedPost', 'uri': U(P, 'dr1'), 'blocked': True}, 'parent': DP2}},
    {'post': LONE},
]

# Recent tiles (stage 6c): appmosphe.re's /api/tiles, its shape as checked Oct 22.
from datetime import datetime, timezone, timedelta
def iso(dt): return dt.strftime('%Y-%m-%dT%H:%M:%S.000Z')
NOW = datetime.now(timezone.utc)
IMG = lambda did, cid: f'https://appmosphe.re/img/{did}/{cid}'
def rt(did, rkey, name, created, shots=(), icon=None, desc=None, handle='stale.example'):
    return {'uri': f'at://{did}/ing.dasl.masl/{rkey}', 'shortId': f'@{handle}/{rkey}', 'url': f'https://appmosphe.re/@{handle}/{rkey}', 'did': did, 'handle': handle,
            'rkey': rkey, 'name': name, 'description': desc, 'categories': [], 'icon': icon, 'screenshots': [{'url': u, 'type': 'image/png'} for u in shots],
            'sizing': None, 'recordCid': 'bafyreirecent' + rkey, 'createdAt': created, 'createdAtDerived': False, 'indexedAt': created,
            'author': {'did': did, 'handle': handle, 'displayName': 'X', 'avatar': None}}
RECENT_PAGES = {
    1: [rt(MK, 'rc1', 'Pebble Garden', iso(NOW - timedelta(hours=3)), shots=[IMG(MK, 'bafkreipebble')], desc='A garden of pebbles'),
        rt(A, 'hidden1', 'Hidden coaster', iso(NOW - timedelta(hours=4))),
        rt(B, 'bad2', 'From a hidden account', iso(NOW - timedelta(hours=5))),
        rt(AD, 'ad1', 'Late Night Tile', iso(NOW - timedelta(hours=6)), shots=[IMG(AD, 'bafkreilate')]),
        rt(NH, 'nh1', 'Nameless Maker Tile', iso(NOW - timedelta(days=2)), icon=IMG(NH, 'bafkreiicon')),
        rt(P, 'rc6', 'Moon Lantern', iso(NOW - timedelta(days=3)), shots=['https://evil.example/moon.png'])],
    2: [rt(MK, 'rc7', 'Old Kiln', '2026-10-01T10:00:00.000Z', shots=[IMG(MK, 'bafkreikiln')])],
}
PROFILE_LABELS = {B: [{'src': LABELER, 'uri': f'at://{B}', 'val': '!hide'}], AD: [{'src': LABELER, 'uri': f'at://{AD}', 'val': 'porn'}]}
PROFILE_HANDLES = {**HANDLES, AD: AD_H, NH: 'handle.invalid'}

SEARCH_ANSWER = {'results': [{'uri': f'at://{P}/ing.dasl.masl/3mx6h2wjtgq2h', 'name': 'Roller Coaster'}, {'uri': f'at://{A}/ing.dasl.masl/hidden1'}, {'uri': f'at://{A}/ing.dasl.masl/missing1'}]}

# Tile news on scroll (Oct 25): a second stand-in feed, long enough to page (5 posts a page, 25 in all); the batch
# after 20 fails once, to see Try again.
FEED2 = f'at://{A}/app.bsky.feed.generator/scroll-test'
SCROLL_POSTS = [post(A, f'sc{i:02d}', f'Scroll post {i}', f'2026-10-{24 - i // 2:02d}T{(12 - i % 2 * 6):02d}:00:00Z') for i in range(25)]
feed2_asks = []
feed2_fail = {'20': 1}

calls = []
pin_asks = []
def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/'); hd = HANDLES.get(did)
        if not hd: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f'at://{hd}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            did = {v: k for k, v in HANDLES.items()}.get(q.get('handle'))
            return js({'did': did}) if did else js({'error': 'InvalidRequest', 'message': 'Unable to resolve handle'}, 400)
        if u.path.endswith('getProfiles'):
            actors = parse_qs(u.query).get('actors', [])
            return js({'profiles': [{'did': d, 'handle': PROFILE_HANDLES.get(d, 'handle.invalid'), 'labels': PROFILE_LABELS.get(d, [])} for d in actors]})
        if u.path.endswith('getProfile'):
            labels = [{'src': LABELER, 'uri': f'at://{B}', 'val': '!hide'}] if q.get('actor') == B else []
            return js({'did': q.get('actor'), 'labels': labels, 'avatar': 'https://cdn.bsky.app/img/avatar/plain/x/av@jpeg'})
        if u.path.endswith('getFeed'):
            if q.get('feed') == FEED2:
                c = q.get('cursor'); feed2_asks.append(c)
                if c and feed2_fail.get(c): feed2_fail[c] -= 1; return js({'error': 'InternalServerError'}, 502)
                n = int(c or 0); nxt = n + 5
                return js({'feed': [{'post': p} for p in SCROLL_POSTS[n:nxt]], **({'cursor': str(nxt)} if nxt < len(SCROLL_POSTS) else {})})
            if q.get('feed') != FEED: return js({'error': 'UnknownFeed'}, 400)
            return js({'feed': [{'post': p} for p in POSTS] + THREAD_ITEMS})
        if u.path.endswith('getPosts'):
            want = parse_qs(u.query).get('uris', [])
            pin_asks.append(len(want))
            return js({'posts': [p for p in PINS if p['uri'] in want]})
    if u.hostname == 'appmosphe.re':
        if u.path == '/api/tiles':
            n = int(q.get('page', '1'))
            return js({'total': sum(len(v) for v in RECENT_PAGES.values()), 'page': n, 'pages': len(RECENT_PAGES), 'tiles': RECENT_PAGES.get(n, [])})
        if u.path.startswith('/img/'):
            # like the real appmosphe.re (Oct 22): /img/ answers carry no CORS header, so a page can't download
            # them, only show them as pictures (Q122)
            return r.fulfill(status=200, headers={'content-type': 'image/png'}, body=png((214, 160, 90), (320, 180)))
        return js(SEARCH_ANSWER)
    if u.hostname == 'typeahead.waow.tech':
        return js({'actors': []})
    if u.hostname == 'cdn.bsky.app':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'image/png'}, body=png((63, 184, 168), (64, 64)))
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=HIDE_LIST)
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('getRecord'):
            rec = records.get((q.get('repo'), q.get('rkey')))
            if not rec: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f"at://{q['repo']}/ing.dasl.masl/{q['rkey']}", 'cid': 'bafyreicurrentversion' + q['rkey'], 'value': rec})
        if u.path.endswith('listRecords'):
            repo = q.get('repo'); limit = int(q.get('limit', 50))
            keys = sorted([k for (d, k) in records if d == repo], key=lambda k: records[(repo, k)]['createdAt'], reverse=True)[:limit]
            return js({'records': [{'uri': f'at://{repo}/ing.dasl.masl/{k}', 'cid': 'bafyreirecord', 'value': records[(repo, k)]} for k in keys]})
        if u.path.endswith('getBlob'):
            b = blobs.get(q.get('cid'))
            return r.fulfill(status=200 if b else 404, headers={**cors, 'content-type': 'application/octet-stream'}, body=b or b'')
    if u.hostname in ('bsky.app', 'example.org', 'mu.social', 'atmosynth.at', 'treeline.world', 'foundry.thunderbird.cafe', 'dasl.ing', 'szzt.app') or (u.hostname == 'appmosphe.re' and u.path == '/publish'):
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

SHELF = json.dumps({'version': 1, 'tiles': [{'did': A, 'rkey': 'lantern1', 'name': 'Glass Lantern', 'by': A_H, 'keptAt': '2026-10-20T00:00:00.000Z'}],
                    'accounts': [{'did': A, 'handle': A_H, 'keptAt': '2026-10-20T00:00:00.000Z'}, {'did': P, 'handle': P_H, 'keptAt': '2026-10-20T00:00:01.000Z'}, {'did': B, 'handle': B_H, 'keptAt': '2026-10-20T00:00:02.000Z'}]})

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**',
                 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://bsky.app/**', 'https://example.org/**', 'https://mu.social/**', 'https://evil.example/**',
                 'https://atmosynth.at/**', 'https://treeline.world/**', 'https://foundry.thunderbird.cafe/**', 'https://dasl.ing/**', 'https://szzt.app/**']:
        ctx.route(host, route)
    ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-shelf', {json.dumps(SHELF)}); sessionStorage.setItem('seeded', '1'); }}")
    popups = []
    ctx.on('page', lambda pg: popups.append(pg))
    page = ctx.new_page()
    policy = []
    page.on('console', lambda m: policy.append(m.text) if 'Content Security Policy' in m.text or 'Refused' in m.text else None)

    # ---------- Discover, Following ----------
    # step 6b: the first screen's Tile news row
    page.goto(RAKU)
    page.wait_for_selector('.first-news:not([hidden]) .news-item')
    row = page.eval_on_selector_all('.first-news .news-item', 'bs => bs.map(b => [b.querySelector(".news-who").textContent, !!b.querySelector(".news-reply")])')
    check('first screen: a Tile news row with the latest three posts', len(row) == 3, str(row))
    check('...no old hand-picked post among them (mixed in by date)', not any('Robin' in r[0] for r in row), str(row))
    order = page.evaluate("() => [...document.querySelectorAll('.first > *')].map(e => e.className || e.tagName)")
    check('...after the picks, before Tables', order.index('first-news') > order.index('cards picks') and order.index('first-news') < order.index('cards tables'), str(order))
    page.eval_on_selector('.first-news', 'e => e.scrollIntoView()'); page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / 'd0-first-news.png'))
    page.click('.first-news .linkish')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Tile news'")
    check('...More opens Tile news on Discover', True)
    page.goto(RAKU + '#t=raku%3Adiscover%2Ffollowing&a=0')
    page.wait_for_selector('.discover')
    check('Discover opens as a page in a tab, titled Discover', 'Discover' in page.title() and texts(page, '.tab.on .tab-title') == ['Discover'])
    check('the Discover button in the top bar shows it is on', page.eval_on_selector('.bar .nav-btn[title="Discover"]', 'b => b.classList.contains("on")'))
    check('with the Web Tiles feed (step 6b) the sources are Tile news, Recent tiles (stage 6c) and Following', texts(page, '.dv-src:not(.dv-make)') == ['Tile news', 'Recent tiles', 'Following'], str(texts(page, '.dv-src')))
    check('Recent tiles has the clock icon', page.query_selector('.dv-src[data-source="recent"] .icon-clock') is not None)
    wait_for(lambda: page.eval_on_selector_all('.dv-centre .card-title', 'els => els.length >= 3 && els.every(e => e.textContent !== "…")'), page=page)
    names = texts(page, '.dv-centre .card-title')
    check('Following: the kept accounts\' tiles, newest first, all mixed', names == ['Coaster Two', 'Roller Coaster', 'Glass Lantern'], str(names))
    check('Following: hidden accounts and tiles on the hide list are left out', 'Bad coaster' not in names and 'Hidden coaster' not in names)
    check('Following: a first visit marks nothing new', page.query_selector('.dv-centre .card-badge') is None)
    check('Following: the banners come from the tiles\' own servers', wait_for(lambda: page.eval_on_selector_all('.dv-centre .card-pic img', 'is => is.length === 3 && is.every(i => i.src.startsWith("blob:"))'), page=page))
    check('Following: "by @handle" after the check both ways', wait_for(lambda: 'by @pyxorium.com' in texts(page, '.dv-centre .card-by'), page=page))
    lay = page.evaluate("""() => ['.dv-left', '.dv-centre', '.dv-right'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), getComputedStyle(document.querySelector(s)).display]; })""")
    check('wide window: three columns, the centre widest', lay[0][0] < lay[1][0] < lay[2][0] and lay[1][1] > lay[0][1] and lay[1][1] > lay[2][1] and lay[2][2] != 'none', str(lay))
    check('the right column says how search and opening work', 'appmosphe.re' in page.inner_text('.dv-about'))
    page.screenshot(path=str(OUT / 'd1-following-wide.png'))
    check('the address box is empty on Discover, no star', page.input_value('.addr') == '' and not page.is_visible('.star-btn'))

    # A new tile appears; the next visit (a new page load) marks it New.
    records[(P, 'newtile1')] = tile('Brand New Tile', (datetime.now(timezone.utc) + timedelta(seconds=2)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'Fresh', (230, 180, 60))
    time.sleep(3)
    page.reload(); page.wait_for_selector('.discover')
    wait_for(lambda: 'Brand New Tile' in texts(page, '.dv-centre .card-title'), page=page)
    badges = page.eval_on_selector_all('.dv-centre .card', 'cs => cs.filter(c => c.querySelector(".card-badge")).map(c => c.querySelector(".card-title").textContent)')
    check('Following: "New" on tiles since the last visit, only those', badges == ['Brand New Tile'], str(badges))
    check('Following: the line says how many are new', 'new since your last visit' in page.inner_text('.dv-status'))
    page.screenshot(path=str(OUT / 'd2-following-new.png'))

    # ---------- search from the address box ----------
    searched = lambda: [c for c in calls if 'appmosphe.re/api/search' in c]
    before = len(searched())
    page.click('.addr'); page.keyboard.type('coaster', delay=40)
    page.wait_for_timeout(600)
    check('typing sends nothing to appmosphe.re', len(searched()) == before)
    page.keyboard.press('Enter')
    page.wait_for_selector('.dv-centre h1')
    check('Enter on words opens search results in the tab', texts(page, '.dv-centre h1') == ['Results for “coaster”'] and 'Search: coaster' in texts(page, '.tab.on .tab-title')[0])
    asked = searched()[before:]
    check('one request to appmosphe.re, with only the words', asked == ['https://appmosphe.re/api/search?q=coaster'], str(asked))
    wait_for(lambda: page.eval_on_selector_all('.dv-part:not([hidden]) .card-title', 'els => els.length >= 2 && els.every(e => e.textContent !== "…")'), page=page)
    parts = page.evaluate("() => [...document.querySelectorAll('.dv-part')].filter(p => !p.hidden).map(p => [p.querySelector('h2').textContent, [...p.querySelectorAll('.card-title')].map(e => e.textContent)])")
    check('search: "Already in Raku" first, found here (Following\'s tiles)', parts and parts[0][0] == 'Already in Raku' and 'Coaster Two' in parts[0][1] and 'Roller Coaster' in parts[0][1], str(parts))
    wait_for(lambda: page.evaluate("() => [...document.querySelectorAll('.dv-part')].pop().querySelectorAll('.card').length === 1"), page=page)
    theirs = page.evaluate("() => [...[...document.querySelectorAll('.dv-part')].pop().querySelectorAll('.card-title')].map(e => e.textContent)")
    check('search: appmosphe.re\'s results looked up from the tiles\' servers; hidden and missing ones left out', theirs == ['Roller Coaster'], str(theirs))
    # Q129: appmosphe.re's own results draw their pictures from its copies; "Already in Raku" (your shelf, Following)
    # keeps loading from the authors' servers, so appmosphe.re never learns what you keep
    wait_for(lambda: page.evaluate("() => [...document.querySelectorAll('.dv-part')].every(p => p.hidden || [...p.querySelectorAll('.card-pic')].every(c => c.querySelector('img')))"), page=page)
    pics = page.evaluate("() => [...document.querySelectorAll('.dv-part')].filter(p => !p.hidden).map(p => [...p.querySelectorAll('.card-pic img')].map(i => i.src.split('/').slice(0, 4).join('/')))")
    check("search: appmosphe.re's results use its picture copies", pics and all(x.startswith('https://appmosphe.re/img') for x in pics[-1]) and len(pics[-1]) == 1, str(pics))
    check('search: "Already in Raku" pictures still come from the authors\' servers', pics and pics[0] and all(x.startswith('blob:') for x in pics[0]), str(pics))
    check('search: the line says what was sent where', 'Only the words you searched for were sent' in page.inner_text('.dv-foot'))
    check('search: the address box shows the words; the Discover box too', page.input_value('.addr') == 'coaster' and page.input_value('.dv-q') == 'coaster')
    check('search: Search results joins the sources', texts(page, '.dv-src:not(.dv-make)') == ['Tile news', 'Recent tiles', 'Following', 'Search results'] and page.eval_on_selector('.dv-src[data-source="search"]', 'b => b.classList.contains("on")'))
    check('search: the right column previews Following, with its new count', wait_for(lambda: '1 new' in page.inner_text('.dv-preview[data-source="following"]'), page=page))
    check('...and the previews\' small banners', wait_for(lambda: page.eval_on_selector_all('.dv-preview[data-source="following"] .dv-mini-pic img', 'is => is.length === 3 && is.every(i => i.src.startsWith("blob:"))'), page=page))
    page.screenshot(path=str(OUT / 'd3-search-wide.png'))
    page.click('.dv-preview[data-source="following"]')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Following'")
    check('a preview brings its source to the centre', texts(page, '.dv-src.on') == ['Following'])
    check('...and the search is previewed on the right', page.is_visible('.dv-preview[data-source="search"]'))
    page.click('.bar .nav-btn[title="Back"]')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Results for “coaster”'")
    check('Back returns to the search results', True)

    # the Discover box
    page.fill('.dv-q', 'lantern'); page.press('.dv-q', 'Enter')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Results for “lantern”'")
    wait_for(lambda: 'Glass Lantern' in texts(page, '.dv-part:not([hidden]) .card-title'), page=page)
    check('the Discover box searches too; your kept tile is found here', 'Glass Lantern' in texts(page, '.dv-part:not([hidden]) .card-title'))
    check('a kept account matches by handle', (page.fill('.dv-q', 'pyxorium'), page.press('.dv-q', 'Enter'), wait_for(lambda: '@pyxorium.com' in ' '.join(texts(page, '.dv-part .chip-name')), page=page))[2])

    # Q99: an emptied search box leaves search
    srcs = lambda: texts(page, '.dv-src')
    h1 = lambda t: page.wait_for_function(f"() => document.querySelector('.dv-centre h1')?.textContent === {json.dumps(t)}")
    page.fill('.dv-q', ''); page.press('.dv-q', 'Enter'); h1('Tile news')
    check('emptying the Discover box and Enter: back to Discover, "Search results" gone', 'Search results' not in srcs() and page.input_value('.dv-q') == '', str(srcs()))
    page.click('.bar .nav-btn[title="Back"]'); h1('Results for “pyxorium”')
    check('...Back still brings the search back', page.input_value('.dv-q') == 'pyxorium' and 'Search results' in srcs())
    page.fill('.dv-q', ''); page.dispatch_event('.dv-q', 'search'); h1('Tile news')
    check("the search box's own × leaves search too", 'Search results' not in srcs())
    page.click('.bar .nav-btn[title="Back"]'); h1('Results for “pyxorium”')
    page.fill('.addr', ''); page.press('.addr', 'Enter'); h1('Tile news')
    check('emptying the address box on a search page and Enter: back to Discover', 'Search results' not in srcs() and page.input_value('.addr') == '')
    page.reload(); page.wait_for_selector('.dv-centre h1')
    check('...and a reload stays there, the boxes empty', page.inner_text('.dv-centre h1') == 'Tile news' and page.input_value('.dv-q') == '' and page.input_value('.addr') == '' and 'Search results' not in srcs())
    page.fill('.addr', ''); page.press('.addr', 'Enter')
    check('...an empty address box elsewhere only shows the hint', page.inner_text('.dv-centre h1') == 'Tile news' and page.is_visible('.note'))

    # a word with a dot: a handle first; not found, offer search
    page.fill('.addr', 'nosuch.example'); page.press('.addr', 'Enter')
    btn = page.wait_for_selector('.tile-status button.primary')
    check('a word with a dot is tried as a handle; when there\'s none, search is offered', 'Search tiles for “nosuch.example”' in btn.inner_text())
    btn.click()
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Results for “nosuch.example”'")
    check('...and it searches', True)

    # ---------- Recent tiles (stage 6c) ----------
    page.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Adiscover%2Frecent&a=0'); page.wait_for_selector('.discover')
    seen_before = len(calls)
    page.reload(); page.wait_for_selector('.discover')            # a fresh page load: nothing kept from the previews earlier
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Recent tiles'")
    check('raku:discover/recent opens Recent tiles, highlighted among the sources', texts(page, '.dv-src.on') == ['Recent tiles'])
    check('...with its line', 'as listed by appmosphe.re' in page.inner_text('.dv-head .sub'))
    wait_for(lambda: len(texts(page, '.dv-centre .card-title')) >= 4, page=page)
    names = texts(page, '.dv-centre .card-title')
    check("Recent tiles: appmosphe.re's order, as it is", names == ['Pebble Garden', 'Late Night Tile', 'Nameless Maker Tile', 'Moon Lantern'], str(names))
    check('...a tile on the hide list and an account hidden by Bluesky are left out', 'Hidden coaster' not in names and 'From a hidden account' not in names)
    bys = texts(page, '.dv-centre .card-by')
    check('..."by @handle" (Bluesky\'s checked handle) and when it was made', bys[0] == f'by @{MK_H} · 3h ago', str(bys))
    check("...an account whose handle couldn't be checked shows its DID", bys[2] == f'by {NH} · 2d ago', str(bys))
    check('...the description when there is one', texts(page, '.dv-centre .card-desc')[0] == 'A garden of pebbles')
    check("...pictures from appmosphe.re's /img/ copies, drawn as ordinary pictures (no CORS there), no referrer", wait_for(lambda: page.eval_on_selector_all('.dv-centre .card-pic img',
          'is => is.length === 3 && is.every(i => i.src.startsWith("https://appmosphe.re/img/") && i.referrerPolicy === "no-referrer" && i.complete && i.naturalWidth > 0)'), page=page))
    check('...a picture from anywhere else is left out (the plain background)', page.eval_on_selector('.card:nth-child(4) .card-pic', 'p => !p.querySelector("img")'))
    check('...an icon-only tile shows its icon whole', page.eval_on_selector('.card:nth-child(3) .card-pic', 'p => p.classList.contains("is-icon")'))
    check('...an account labelled adult: its picture blurred', page.eval_on_selector('.card:nth-child(2) .card-pic', 'p => p.classList.contains("blurred") && getComputedStyle(p.querySelector("img")).filter.includes("blur")'))
    recent_calls = calls[seen_before:]
    check('...one request for the list, page 1', [c for c in recent_calls if '/api/tiles' in c] == ['https://appmosphe.re/api/tiles?page=1'], str([c for c in recent_calls if '/api/tiles' in c]))
    check('...authors checked in one Bluesky request', len([c for c in recent_calls if 'getProfiles' in c]) == 1)
    check("...nothing fetched from the tiles' own servers or elsewhere", not [c for c in recent_calls if 'evil.example' in c or ('getBlob' in c and any(quote(d, safe='') in c for d in (MK, AD, NH)))])   # (Following's preview on the right fetches its own banners)
    check('...a first visit marks nothing new', page.query_selector('.dv-centre .card-badge') is None)
    check('...More for the next page', page.is_visible('.dv-centre > .more') and page.inner_text('.dv-centre > .more') == 'More')
    check('..."Listed by appmosphe.re"', page.inner_text('.dv-foot') == 'Listed by appmosphe.re.')
    page.screenshot(path=str(OUT / 'd4a-recent-wide.png'))
    page.click('.dv-centre > .more')
    wait_for(lambda: 'Old Kiln' in texts(page, '.dv-centre .card-title'), page=page)
    check('More adds the next page below', texts(page, '.dv-centre .card-title')[-1] == 'Old Kiln' and [c for c in calls if '/api/tiles' in c][-1] == 'https://appmosphe.re/api/tiles?page=2')
    check("...after the last page: no More, and \"That's every tile appmosphe.re lists.\"", wait_for(lambda: not page.is_visible('.dv-centre > .more') and page.is_visible('.dv-end'), page=page) and "That's every tile appmosphe.re lists." in page.inner_text('.dv-end'))
    check('...an older tile shows its date', 'Oct 1' in texts(page, '.dv-centre .card-by')[-1])
    page.click('.dv-centre .card:nth-child(1) .card-main')
    wait_for(lambda: page.input_value('.addr').endswith('/ing.dasl.masl/rc1'), page=page)
    check('opening a card opens the tile in the tab (its latest version, from its own server)', page.input_value('.addr').endswith('/ing.dasl.masl/rc1'), page.input_value('.addr'))
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_selector('.dv-centre .card')
    # "New" since the last visit
    RECENT_PAGES[1].insert(0, rt(MK, 'rcnew', 'Fresh Glaze', iso(datetime.now(timezone.utc) + timedelta(seconds=2)), shots=[IMG(MK, 'bafkreifresh')]))
    time.sleep(3)
    page.reload(); page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Recent tiles'")
    wait_for(lambda: 'Fresh Glaze' in texts(page, '.dv-centre .card-title'), page=page)
    badges = page.eval_on_selector_all('.dv-centre .card', 'cs => cs.filter(c => c.querySelector(".card-badge")).map(c => c.querySelector(".card-title").textContent)')
    check('Recent tiles: "New" on tiles made since the last visit, only those', badges == ['Fresh Glaze'], str(badges))
    marks = page.evaluate("() => JSON.parse(localStorage.getItem('raku-marks'))")
    check("the last visits kept in one entry on this device (Following's older entry moved in)", marks and marks.get('format') == 'raku-marks' and set(marks['seen']) >= {'following', 'recent'} and page.evaluate("() => localStorage.getItem('raku-following-seen')") is None, str(marks))
    page.screenshot(path=str(OUT / 'd4b-recent-new.png'))
    page.click('.dv-src[data-source="following"]'); page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Following'")
    check('the right column previews Recent tiles: its new count and small pictures', wait_for(lambda: '1 new' in page.inner_text('.dv-preview[data-source="recent"]') and page.eval_on_selector_all('.dv-preview[data-source="recent"] .dv-mini-pic img', 'is => is.length >= 2'), page=page))
    check('...the latest three', page.eval_on_selector_all('.dv-preview[data-source="recent"] .dv-mini-title', 'es => es.map(e => e.textContent)') == ['Fresh Glaze', 'Pebble Garden', 'Late Night Tile'])
    page.screenshot(path=str(OUT / 'd4c-recent-preview.png'))
    page.fill('.dv-q', 'pebble'); page.press('.dv-q', 'Enter')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Results for “pebble”'")
    check('search: a tile already loaded in Recent tiles counts as "Already in Raku"', wait_for(lambda: 'Pebble Garden' in texts(page, '.dv-part:not([hidden]) .card-title'), page=page))

    # ---------- the About page (going public, Q134) ----------
    page.goto(RAKU + '?loader=' + LOADER + '#t=&a=0'); page.wait_for_selector('.first-about .linkish')
    check("the first screen's last line links to About Raku", 'About Raku: what it keeps, who it talks to' in page.inner_text('.first-about'))
    page.click('.first-about .linkish')
    page.wait_for_selector('.about h1')
    check('it opens raku:about in the tab, titled About Raku, the address box empty', texts(page, '.tab.on .tab-title') == ['About Raku'] and 'raku%3Aabout' in page.evaluate('location.hash') and page.input_value('.addr') == '')
    heads = texts(page, '.ab-part h2')
    check('...its sections', heads == ["You don't need an account", 'What stays in this browser', 'Who Raku talks to, and why', 'How tiles are kept in their box', 'Install Raku', 'Hidden tiles and reporting'], str(heads))   # Install Raku: stage 9
    who = texts(page, '.ab-who dt')
    check('...who Raku talks to', who == ["Each tile's own account", "Bluesky's public servers", 'plc.directory', 'appmosphe.re', 'lexicographer.space', 'typeahead.waow.tech', 'The tile loading server', "Daisy's relay",
        'The rooms relay (relay.rooms.thunderbird.cafe)', 'The people in your room', 'Google’s and Cloudflare’s connection helpers'], str(who))   # rooms step 1 (RR9)
    exc = page.inner_text('.ab-exception')
    check("...the exception, in the owner's words", exc == 'One exception: a tile can open a link in a new tab when you click it, and that link could carry information about what you did in the tile. It\u2019s the same as clicking a link on any web page, so use the same care.', exc)
    links = page.eval_on_selector_all('.about a', 'as => as.map(a => [a.textContent, a.href, a.target, a.rel])')
    check('...outside links open in a new tab with no opener: takedowns, the code, the blog post', links == [['Reporting and takedowns \u2197', 'https://lexicographer.space/takedowns', '_blank', 'noopener noreferrer'], ['github.com/pyxorium/raku', 'https://github.com/pyxorium/raku', '_blank', 'noopener noreferrer'], ['How Raku works, on the blog\u00a0\u2192', 'https://thunderbird.cafe/blog/raku/', '_blank', 'noopener noreferrer']], str(links))
    box = texts(page, '.ab-part:nth-of-type(4) li')
    check('...the Messages line: the button shows once a tile sends something; at a table, in its bar', any(t.startswith('A tile can only talk to Raku. If it sends anything, a Messages button appears on its tab') and 'At a table, the Messages button' in t for t in box), str(box))
    check('...nothing on the page asks anything of anyone', not [c for c in calls[-5:] if 'github.com' in c or 'takedowns' in c])
    page.screenshot(path=str(OUT / 'a1-about-wide.png'), full_page=True)
    page.click('.ab-foot .linkish')
    page.wait_for_function("() => document.querySelector('.tab.on .tab-title')?.textContent === \"@thunderbird.cafe's tiles\"")
    check('"made by @thunderbird.cafe" opens that account\'s tiles in Raku', True)
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_selector('.about h1')
    # the account menu
    page.click('.account-btn'); page.wait_for_selector('.account-menu:not([hidden]) .acct-about')
    check('the account menu ends with "About Raku: privacy and safety"', page.eval_on_selector('.account-menu', 'm => m.lastElementChild.classList.contains("acct-about")') and 'About Raku: privacy and safety' in page.inner_text('.acct-about'))
    page.screenshot(path=str(OUT / 'a2-menu.png'))
    tabs_before = len(texts(page, '.tab-title'))
    page.click('.acct-about')
    check('...from an About tab: it stays, no second one, the menu closes', len(texts(page, '.tab-title')) == tabs_before and page.is_hidden('.account-menu'))
    # Discover's right column
    page.goto(RAKU + '?loader=' + LOADER + '#t=raku%3Adiscover%2Ffollowing&a=0'); page.wait_for_selector('.dv-about .linkish')
    check("Discover's right column links to About Raku", page.inner_text('.dv-about .linkish') == 'About Raku \u2192')
    page.click('.dv-about .linkish'); page.wait_for_selector('.about h1')
    check('...and opens it in the tab', texts(page, '.tab.on .tab-title') == ['About Raku'])
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_selector('.dv-src[data-source="make"]')

    # ---------- Make a tile (stage 6c) ----------
    srcs_all = lambda pg: pg.eval_on_selector_all('.dv-sources > *', 'es => es.map(e => e.dataset.source || e.className)')
    check('Make a tile sits apart at the bottom of the sources, with the brush', srcs_all(page)[-2:] == ['dv-src-gap', 'make'] and page.query_selector('.dv-src[data-source="make"] .icon-brush') is not None, str(srcs_all(page)))
    before_make = len(calls)
    page.click('.dv-src[data-source="make"]')
    page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Make a tile'")
    check('it opens raku:discover/make in the centre, the tab titled Make a tile', texts(page, '.dv-src.on') == ['Make a tile'] and texts(page, '.tab.on .tab-title') == ['Make a tile'] and 'raku%3Adiscover%2Fmake' in page.evaluate('location.hash'))
    check('...the sentence on what a tile is, and "New to tiles?" (dasl.ing, a new tab)', page.inner_text('.mk-intro').startswith('A web tile is a small page or app stored in your own atproto account. Anyone can open it in a tile browser like Raku.')
          and page.eval_on_selector('.mk-learn', 'a => [a.textContent, a.href, a.target, a.rel].join("|")') == 'New to tiles? Read about them at dasl.ing|https://dasl.ing/|_blank|noopener noreferrer')
    groups = page.evaluate("() => [...document.querySelectorAll('.mk-group')].map(g => [g.querySelector('h2').textContent, [...g.querySelectorAll('.mk-name')].map(e => e.textContent)])")
    check('two groups: No code needed (alphabetical), then From your own files', groups == [['No code needed', ['ATMOSYNTH', 'Treeline', 'Web Tile Foundry']], ['From your own files', ['appmosphe.re publish', 'szzt']]], str(groups))
    check('each card: its site', texts(page, '.mk-site') == ['atmosynth.at', 'treeline.world', 'foundry.thunderbird.cafe', 'appmosphe.re/publish', 'szzt.app/publish'], str(texts(page, '.mk-site')))
    check('...a drawn mark in a glaze colour (no logos)', page.eval_on_selector_all('.mk-mark', 'ms => ms.map(m => m.textContent + ":" + m.className.split(" ")[1])') == ['A:mk-turquoise', 'T:mk-copper', 'F:mk-cream', 'a:mk-smoke', 's:mk-turquoise']
          and page.query_selector('.mk-card img') is None)
    check('...one line on what it makes and how', all(len(t) > 40 for t in texts(page, '.mk-line')) and 'Share as webtile' in texts(page, '.mk-line')[1])
    opens = page.eval_on_selector_all('.mk-open', 'as => as.map(a => [a.textContent.trim(), a.href, a.target, a.rel])')
    check('...Open, to the maker\'s site in a new tab, with no opener', opens == [['Open', u, '_blank', 'noopener noreferrer'] for u in ['https://atmosynth.at/', 'https://treeline.world/', 'https://foundry.thunderbird.cafe/', 'https://appmosphe.re/publish', 'https://szzt.app/publish/']], str(opens))
    check('nothing is asked of the makers\' sites until you open one', not [c for c in calls[before_make:] if any(h in c for h in ('atmosynth.at', 'treeline.world', 'foundry.thunderbird.cafe', 'appmosphe.re/publish', 'szzt.app', 'dasl.ing'))])
    pv = page.eval_on_selector_all('.dv-preview', 'ps => ps.map(p => p.dataset.source)')
    check('the right column previews the reading sources', pv[:3] == ['news', 'recent', 'following'] and 'make' not in pv, str(pv))
    page.screenshot(path=str(OUT / 'd4d-make-wide.png'))
    n0 = len(popups)
    page.click('.mk-card[data-maker="treeline"] .mk-open')
    pop = wait_for(lambda: popups[n0] if len(popups) > n0 else None, page=page)
    if pop: pop.wait_for_load_state()
    check('Open: the maker\'s site in a new tab, no link message (Raku\'s own list), no opener', pop is not None and pop.url == 'https://treeline.world/' and pop.evaluate('window.opener === null') and page.query_selector('.link-msg') is None, pop.url if pop else 'none')
    if pop: pop.close()
    page.set_viewport_size({'width': 1000, 'height': 800}); page.wait_for_timeout(300)
    check('narrower: Make a tile is an icon at the bottom too', page.eval_on_selector('.dv-src[data-source="make"] .dv-src-label', 'e => getComputedStyle(e).display') == 'none' and page.is_visible('.dv-src[data-source="make"] .icon-brush'))
    page.screenshot(path=str(OUT / 'd4e-make-1000.png'))
    page.set_viewport_size({'width': 1400, 'height': 900})
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent !== 'Make a tile'")
    check('Back leaves Make a tile', True)

    # ---------- widths ----------
    page.goto(RAKU + '#t=raku%3Adiscover%2Ffollowing&a=0'); page.wait_for_selector('.discover')
    page.set_viewport_size({'width': 1000, 'height': 800}); page.wait_for_timeout(300)
    mid = page.evaluate("() => [document.querySelector('.dv-left').getBoundingClientRect().width, getComputedStyle(document.querySelector('.dv-src-label')).display, getComputedStyle(document.querySelector('.dv-right')).display]")
    check('narrower: the sources become icons, the right column stays', mid[0] <= 64 and mid[1] == 'none' and mid[2] != 'none', str(mid))
    page.screenshot(path=str(OUT / 'd4-1000.png'))
    page.set_viewport_size({'width': 800, 'height': 800}); page.wait_for_timeout(300)
    check('narrower still: the right column drops', page.eval_on_selector('.dv-right', 'e => getComputedStyle(e).display') == 'none')
    page.screenshot(path=str(OUT / 'd5-800.png'))
    page.set_viewport_size({'width': 1400, 'height': 900})

    # ---------- Tile news (a stand-in feed, ?feed= on this computer) ----------
    page.goto(RAKU + '?loader=' + LOADER + '&feed=' + quote(FEED, safe='') + '#t=raku%3Adiscover&a=0'); page.wait_for_selector('.discover')
    check('with a feed, Tile news comes first among the sources', texts(page, '.dv-src:not(.dv-make)') == ['Tile news', 'Recent tiles', 'Following'] and texts(page, '.dv-src.on') == ['Tile news'])
    page.wait_for_selector('.post')
    uris = page.eval_on_selector_all('.posts > *', 'ps => ps.map(p => p.dataset.uri.split("/").pop())')[:4]
    check('posts drawn; hidden by moderation and from a hidden account left out', uris == ['3post1', '3post2', '3post3', '3post5'], str(uris))
    p1 = page.query_selector('.post[data-uri$="3post1"]')
    wait_for(lambda: p1.query_selector('.post-tile .card-title').inner_text() == 'Roller Coaster' and 'pyxorium' in p1.query_selector('.post-tile .card-by').inner_text(), page=page)
    check("a post whose link card is a tile: a tile card, looked up from the tile's own server", p1.query_selector('.post-tile .card-title').inner_text() == 'Roller Coaster')
    check('...with its banner from the tile\'s server', wait_for(lambda: p1.eval_on_selector('.post-tile .card-pic img', 'i => i.src.startsWith("blob:")'), page=page))
    check('...and no plain link card for it', p1.query_selector('.post-ext') is None)
    p2 = page.query_selector('.post[data-uri$="3post2"]')
    check('rich text: links and mentions as buttons, the hashtag plain', [e.inner_text() for e in p2.query_selector_all('.post-link')] == ['https://example.org/blog', '@thunderbird.cafe', 'lexicographer.space/@thunderbird.cafe/coaster2'] and p2.query_selector('.post-tag').inner_text() == '#webtiles')
    p3 = page.query_selector('.post[data-uri$="3post3"]')
    check('pictures only from Bluesky\'s picture server', p3.eval_on_selector_all('.post-pics img', 'is => is.map(i => i.src)') == ['https://cdn.bsky.app/img/feed_thumbnail/plain/x/p1@jpeg'])
    check('graphic pictures blurred behind "Show pictures"', p3.eval_on_selector('.post-pics', 'g => g.classList.contains("blurred")') and p3.query_selector('.post-show') is not None)
    p3.query_selector('.post-show').click()
    check('...shown on a click', not p3.eval_on_selector('.post-pics', 'g => g.classList.contains("blurred")'))
    p5 = page.query_selector('.post[data-uri$="3post5"]')
    check('a content warning hides the post until "Show post"', p5.query_selector('.post-text') is None and 'content warning' in p5.inner_text())
    p5.query_selector('.post-warn button').click()
    check('...then it shows', p5.query_selector('.post-text').inner_text() == 'Behind a warning')
    # Q97: a reply with its thread
    th = page.query_selector('.post-thread[data-uri$="/th3"]')
    check('a reply comes with its thread: the first post, the post it answers, then the reply', th is not None and th.eval_on_selector_all('.post', 'ps => ps.map(p => p.dataset.uri.split("/").pop())') == ['th1', 'th2', 'th3'])
    check('...the first two joined by the line (context), the reply last', th.eval_on_selector_all('.post', 'ps => ps.map(p => p.classList.contains("ctx"))') == [True, True, False])
    check('...no "…" when nothing was skipped', th.query_selector('.post-gap') is None)
    check('...only the reply has a footer: "Open thread in Bluesky"', th.eval_on_selector_all('.post-open', 'bs => bs.map(b => b.textContent.trim())') == ['Open thread in Bluesky'])
    check('a post already drawn as context isn\'t drawn again', page.eval_on_selector_all('.posts > *', 'ps => ps.map(p => p.dataset.uri.split("/").pop())').count('th2') == 0)
    # Q123: one card per thread
    drawn_ids = page.eval_on_selector_all('.posts > *', 'ps => ps.map(p => p.dataset.uri.split("/").pop())')
    roots = page.eval_on_selector_all('.post', 'ps => ps.map(p => p.dataset.uri.split("/").pop())')
    check("another reply in a thread already shown: no second card, the thread's first post drawn once", 'th4' not in drawn_ids and roots.count('th1') == 1, str(drawn_ids))
    check('...counted on the thread\'s card: "+1 more reply in this thread"', th.query_selector('.post-more-replies') is not None and th.query_selector('.post-more-replies').inner_text() == '+1 more reply in this thread')
    th.query_selector('.post-more-replies').click(); page.wait_for_selector('.link-msg')
    check("...which opens the thread's first post through the link message", page.inner_text('.link-msg-url') == f'https://bsky.app/profile/{P_H}/post/th1' and page.query_selector('.link-msg-app') is not None, page.inner_text('.link-msg-url'))
    page.keyboard.press('Escape')
    check('a thread with no other replies has no such note', page.query_selector('.post-thread[data-uri$="/dp3"] .post-more-replies') is None)
    dp = page.query_selector('.post-thread[data-uri$="/dp3"]')
    check('a blocked first post: "Post not available"; posts skipped: "More replies in between"', dp is not None and dp.query_selector('.post.gone').inner_text() == 'Post not available.' and dp.query_selector('.post-gap') is not None and dp.eval_on_selector_all('.post', 'ps => ps.map(p => p.dataset.uri.split("/").pop())') == ['dr1', 'dp2', 'dp3'])
    lone = page.query_selector('.posts > .post[data-uri$="/lone1"]')
    check('a reply sent without its thread says so', lone is not None and 'A reply. Open the thread' in lone.inner_text())
    th.query_selector('.post-open').click(); page.wait_for_selector('.link-msg')
    check('"Open thread" goes through the link message to the reply in the app for posts', page.inner_text('.link-msg-url') == f'https://bsky.app/profile/{MK_H}/post/th3')
    page.keyboard.press('Escape')
    th.scroll_into_view_if_needed(); page.wait_for_timeout(200)
    th.screenshot(path=str(OUT / 'd6b-thread.png'))
    check('the right column previews Following', page.is_visible('.dv-preview[data-source="following"]'))
    # Hand-picked posts (NEWS_PINS, Oct 24): mixed in by date, checked like the feed's own
    ids = page.eval_on_selector_all('.posts > *', 'ps => ps.map(p => p.dataset.uri.split("/").pop())')
    chunks = [min(25, len(PIN_URIS) - i) for i in range(0, len(PIN_URIS), 25)]
    check('hand-picked posts read together, 25 to a request', pin_asks[:len(chunks)] == chunks, str(pin_asks))
    check('hand-picked posts mixed in by date: one dated Oct 14 12:00 sits between the feed\'s Oct 15 and Oct 14 11:00 posts', '3mia346rdic2b' in ids and ids.index('th3') < ids.index('3mia346rdic2b') < ids.index('dp3'), str(ids))
    check('...the older ones after every feed post, newest first', ids[-2:] == ['3mej27i74zk2t', '3juhmexrpxd2m'], str(ids))
    check('...one hidden by moderation left out, missing ones dropped quietly', '3mjf6xuzgtk2t' not in ids and len([i for i in ids if i.startswith('3m') or i.startswith('3j')]) == 3, str(ids))
    old = page.query_selector('.post[data-uri$="3juhmexrpxd2m"]')
    check('...drawn like any post: the author, the year on an old date, its picture from Bluesky\'s picture server',
          'robin.berjon.com' in old.inner_text() and old.query_selector('.post-time').inner_text() == 'Apr 28 2023'
          and old.eval_on_selector_all('.post-pics img', 'is => is.map(i => i.src)') == ['https://cdn.bsky.app/img/feed_thumbnail/plain/x/rb@jpeg'], old.inner_text()[:200])
    launch = page.query_selector('.post[data-uri$="3mej27i74zk2t"]')
    check('...a link card as on feed posts, and "Open post in Bluesky"', launch.query_selector('.post-ext') is not None and launch.eval_on_selector('.post-open', 'b => b.textContent.trim()') == 'Open post in Bluesky', launch.inner_text()[:200])
    check('...no More (the feed has no more pages)', not page.is_visible('.discover .more'))
    old.scroll_into_view_if_needed(); page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / 'd6c-pins.png'))
    page.screenshot(path=str(OUT / 'd6-news-wide.png'), full_page=False)

    # the link message
    n0 = len(popups)
    p2.query_selector('.post-link').click()
    page.wait_for_selector('.link-msg')
    check('a link in a post: Raku says where it goes first (site in bold, the full address)', page.inner_text('.link-msg-site') == 'example.org' and page.inner_text('.link-msg-url') == 'https://example.org/blog')
    check('...says what asked, and to continue only if you trust the site', '@thunderbird.cafe in Tile news' in page.inner_text('.link-msg-from') and 'Only continue if you trust this site' in page.inner_text('.link-msg'))
    check('...nothing opened yet', len(popups) == n0)
    page.screenshot(path=str(OUT / 'd7-link-message.png'))
    page.click('.link-msg .actions button:not(.primary)')
    check('Cancel closes it, nothing opens', page.query_selector('.link-msg') is None and len(popups) == n0)
    p2.query_selector('.post-link').click(); page.wait_for_selector('.link-msg'); page.keyboard.press('Escape')
    check('Escape closes it too', page.query_selector('.link-msg') is None)
    p2.query_selector('.post-link').click(); page.wait_for_selector('.link-msg'); page.click('.link-msg .actions button.primary')
    pop = wait_for(lambda: popups[n0] if len(popups) > n0 else None, page=page)
    if pop: pop.wait_for_load_state()
    check('Open opens it in a new window, with no opener', pop is not None and pop.url == 'https://example.org/blog' and pop.evaluate('window.opener === null'), pop.url if pop else 'none')
    if pop: pop.close()
    page.query_selector('.post[data-uri$="3post2"] .post-open').click(); page.wait_for_selector('.link-msg')
    check('"Open post in Bluesky": the post\'s address in the app for posts', page.inner_text('.link-msg-url') == 'https://bsky.app/profile/thunderbird.cafe/post/3post2')
    # step 6b (Q98): "Open in" for posts, in the link message
    check('a post\'s link message offers "Open in", Bluesky first', page.eval_on_selector_all('.link-msg-app option', 'os => os.map(o => o.textContent)') == ['Bluesky', 'Blacksky', 'mu', 'Northsky'] and page.input_value('.link-msg-app') == 'bluesky')
    page.select_option('.link-msg-app', 'mu')
    page.screenshot(path=str(OUT / 'd7b-open-in.png'))
    check('...switching updates the site and the address shown', page.inner_text('.link-msg-site') == 'mu.social' and page.inner_text('.link-msg-url') == 'https://mu.social/profile/thunderbird.cafe/post/3post2')
    check('...and every "Open post in …" on the page', set(texts(page, '.post-app-name')) == {'mu'})
    page.select_option('.link-msg-app', 'northsky')
    check('Northsky: its post address on northsky.app', page.inner_text('.link-msg-site') == 'northsky.app' and page.inner_text('.link-msg-url') == 'https://northsky.app/profile/thunderbird.cafe/post/3post2')
    page.select_option('.link-msg-app', 'mu')
    n1 = len(popups)
    page.click('.link-msg .actions button.primary')
    pop = wait_for(lambda: popups[n1] if len(popups) > n1 else None, page=page)
    check('...Open goes to the chosen app', pop is not None and pop.url.startswith('https://mu.social/profile/thunderbird.cafe/post/3post2'), pop.url if pop else 'none')
    if pop: pop.close()
    page.reload(); page.wait_for_selector('.post .post-open')
    check('...remembered in this browser', set(texts(page, '.post-app-name')) == {'mu'})
    page.query_selector('.post[data-uri$="3post2"] .post-open').click(); page.wait_for_selector('.link-msg')
    check('...and chosen next time', page.input_value('.link-msg-app') == 'mu')
    page.select_option('.link-msg-app', 'bluesky'); page.keyboard.press('Escape')
    p2 = page.query_selector('.post[data-uri$="3post2"]')
    p2.query_selector('.post-link').click(); page.wait_for_selector('.link-msg')
    check('an ordinary link\'s message has no "Open in"', page.query_selector('.link-msg-app') is None)
    page.keyboard.press('Escape')
    page.query_selector('.post[data-uri$="3post2"] .post-link:nth-of-type(2)').click()
    page.wait_for_function("() => document.querySelector('.tab.on .tab-title')?.textContent === \"@thunderbird.cafe's tiles\"")
    check('a mention opens that account\'s tiles in Raku', True)
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_selector('.post')
    page.query_selector('.post[data-uri$="3post2"] .post-link:nth-of-type(3)').click()
    wait_for(lambda: page.input_value('.addr').endswith('/ing.dasl.masl/coaster2'), page=page)
    check('a link to a tile opens the tile in Raku, no message', page.query_selector('.link-msg') is None and page.input_value('.addr').endswith('/ing.dasl.masl/coaster2'), page.input_value('.addr'))
    page.click('.bar .nav-btn[title="Back"]'); page.wait_for_selector('.post-tile')
    page.query_selector('.post-tile .card-main').click()
    wait_for(lambda: page.input_value('.addr').endswith('/ing.dasl.masl/3mx6h2wjtgq2h'), page=page)
    check("the tile card in a post opens the tile in Raku", page.input_value('.addr').endswith('/ing.dasl.masl/3mx6h2wjtgq2h'), page.input_value('.addr'))

    # a post's address in the address box
    tabs_before = page.evaluate('location.hash')
    page.fill('.addr', f'https://bsky.app/profile/{MK_H}/post/3post1'); page.press('.addr', 'Enter')
    page.wait_for_selector('.link-msg')
    check("a post's address in the box: the link message, the tab stays", page.inner_text('.link-msg-url') == f'https://bsky.app/profile/{MK_H}/post/3post1' and page.evaluate('location.hash') == tabs_before)
    page.keyboard.press('Escape')

    check("Raku's own policy refused nothing", not policy, str(policy[:3]))

    # ---------- phone ----------
    m = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True)
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']:
        m.route(host, route)
    m.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('raku-shelf', {json.dumps(SHELF)}); sessionStorage.setItem('seeded', '1'); }}")
    mp = m.new_page()
    mp.goto(RAKU + '?feed=' + quote(FEED, safe='') + '#t=raku%3Adiscover&a=0'); mp.wait_for_selector('.post')
    tools = mp.eval_on_selector_all('.toolbar button', 'bs => bs.map(b => [b.title, Math.round(b.getBoundingClientRect().width), b.classList.contains("on")])')
    check('phone: six toolbar buttons of 44 px, Discover among them and on', [t[0] for t in tools] == ['Back', 'Forward', 'Reload this tile', 'Your shelf', 'Discover', 'Open tabs'] and all(t[1] >= 44 for t in tools) and tools[4][2], str(tools))
    chips = mp.evaluate("() => [getComputedStyle(document.querySelector('.dv-sources')).display, [...document.querySelectorAll('.dv-src')].map(b => b.textContent.trim()), getComputedStyle(document.querySelector('.dv-right')).display]")
    check('phone: one column, the sources as chips across the top (Make a tile last), no right column', chips[0] == 'flex' and chips[1] == ['Tile news', 'Recent tiles', 'Following', 'Make a tile'] and chips[2] == 'none', str(chips))
    check('phone: no sideways scroll', mp.evaluate('() => document.querySelector(".pane.front").scrollWidth <= document.querySelector(".pane.front").clientWidth + 1 && document.documentElement.scrollWidth <= 391'))
    mp.screenshot(path=str(OUT / 'd8-phone-news.png'))
    mp.click('.dv-src[data-source="following"]'); mp.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Following'")
    wait_for(lambda: mp.eval_on_selector_all('.dv-centre .card-title', 'els => els.length >= 3 && els.every(e => e.textContent !== "…")'), page=mp)
    check('phone: Following as one column of cards, no sideways scroll', mp.evaluate('() => document.querySelector(".pane.front").scrollWidth <= document.querySelector(".pane.front").clientWidth + 1'))
    mp.screenshot(path=str(OUT / 'd9-phone-following.png'))
    mp.click('.dv-src[data-source="recent"]'); mp.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Recent tiles'")
    wait_for(lambda: mp.eval_on_selector_all('.dv-centre .card-pic img', 'is => is.length >= 2'), page=mp)
    check('phone: Recent tiles as one column of cards, no sideways scroll', mp.evaluate('() => document.querySelector(".pane.front").scrollWidth <= document.querySelector(".pane.front").clientWidth + 1 && document.documentElement.scrollWidth <= 391'))
    mp.screenshot(path=str(OUT / 'd9b-phone-recent.png'))
    mp.click('.dv-src[data-source="make"]'); mp.wait_for_function("() => document.querySelector('.dv-centre h1')?.textContent === 'Make a tile'")
    check('phone: Make a tile, cards in one column, Open buttons of 40 px or more, no sideways scroll',
          mp.evaluate('() => document.querySelector(".pane.front").scrollWidth <= document.querySelector(".pane.front").clientWidth + 1 && document.documentElement.scrollWidth <= 391')
          and all(hh >= 40 for hh in mp.eval_on_selector_all('.mk-open', 'as => as.map(a => a.getBoundingClientRect().height)'))
          and mp.eval_on_selector('.mk-line', 'e => e.getBoundingClientRect().width') > 250)
    check('phone: the chosen chip (Make a tile, the last) scrolled into view', mp.eval_on_selector('.dv-src[data-source="make"]', 'b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; }'))
    mp.screenshot(path=str(OUT / 'd9c-phone-make.png'))
    mp.goto(RAKU + '#t=raku%3Aabout&a=0'); mp.wait_for_selector('.about h1')
    check('phone: the About page in one column, no sideways scroll',
          mp.evaluate('() => document.querySelector(".pane.front").scrollWidth <= document.querySelector(".pane.front").clientWidth + 1 && document.documentElement.scrollWidth <= 391')
          and mp.eval_on_selector('.ab-who', 'e => getComputedStyle(e).gridTemplateColumns.split(" ").length') == 1)
    mp.screenshot(path=str(OUT / 'a3-phone-about.png'), full_page=True)
    mp.click('.account-btn'); mp.wait_for_selector('.account-menu:not([hidden]) .acct-about')
    check('phone: the account menu has the About row too', mp.is_visible('.acct-about'))
    mp.keyboard.press('Escape')
    mp.goto(RAKU + '?feed=' + quote(FEED, safe='') + '#t=raku%3Adiscover%2Fnews&a=0'); mp.wait_for_selector('.post .post-open')
    mp.query_selector('.post .post-open').click(); mp.wait_for_selector('.link-msg')
    box = mp.eval_on_selector('.link-msg-box', 'b => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; }')
    check('phone: the link message as a sheet from the bottom, full width', box[0] == 0 and box[1] == 390 and box[2] == 800, str(box))
    mp.screenshot(path=str(OUT / 'd10-phone-link.png'))

    # ---------- Tile news loads on scroll (Oct 25: no More button) ----------
    sc = b.new_context(viewport={'width': 1400, 'height': 900})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']:
        sc.route(host, route)
    sp = sc.new_page()
    news_url = RAKU + '?feed=' + quote(FEED2, safe='') + '#t=raku%3Adiscover%2Fnews&a=0'
    sp.goto(news_url); sp.wait_for_selector('.posts .post')
    count = lambda: sp.eval_on_selector_all('.posts > .post', 'ps => ps.length')
    def settle():
        last = -1
        for _ in range(40):
            sp.wait_for_timeout(150)
            n = count()
            if n == last and not sp.is_visible('.news-loading'): return n
            last = n
        return count()
    n0 = settle()
    check('Tile news: no More button', not sp.is_visible('.discover .more'))
    check('...the first batches fill the window, not the whole feed at once', 5 <= n0 < 25 and len(feed2_asks) < 5, f'{n0} posts, asks {feed2_asks}')
    def to_bottom():
        sp.eval_on_selector('.news-sentinel', 'e => e.scrollIntoView({ block: "end" })'); return settle()
    for _ in range(10):
        if sp.is_visible('.news-failed') or count() >= 20: break
        to_bottom()
    to_bottom()
    check('scrolling near the bottom loads the next batch', count() == 20, str(count()))
    check('a batch that fails says so at the bottom, with Try again', wait_for(lambda: sp.is_visible('.news-failed'), page=sp) and 'Try again' in sp.inner_text('.news-failed'), sp.inner_text('.news-failed') if sp.query_selector('.news-failed') else '')
    to_bottom()
    check('...and doesn\'t keep asking while it waits', feed2_asks.count('20') == 1, str(feed2_asks))
    sp.click('.news-failed button'); settle()
    for _ in range(5): to_bottom()
    ids = sp.eval_on_selector_all('.posts > .post', 'ps => ps.map(p => p.dataset.uri.split("/").pop())')
    check('...Try again carries on to the end: every post once, in order', ids == [f'sc{i:02d}' for i in range(25)], str(ids))
    check('at the end: "That\'s everything in Tile news.", nothing more asked', sp.is_visible('.news-end') and sp.inner_text('.news-end') == "That's everything in Tile news." and feed2_asks == [None, '5', '10', '15', '20', '20'], str(feed2_asks))
    check('...still no More button', not sp.is_visible('.discover .more'))
    sp.screenshot(path=str(OUT / 'd11-news-end.png'))
    sc.close()
    # A browser without IntersectionObserver keeps the More button.
    feed2_asks.clear()
    sc = b.new_context(viewport={'width': 1400, 'height': 900})
    for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**']:
        sc.route(host, route)
    sc.add_init_script('delete window.IntersectionObserver')
    sp = sc.new_page()
    sp.goto(news_url); sp.wait_for_selector('.posts .post'); sp.wait_for_timeout(800)
    check('without IntersectionObserver: one batch, then More', count() == 5 and sp.is_visible('.discover .more'), f'{count()} posts')
    sp.click('.discover .more'); sp.wait_for_timeout(800)
    check('...More adds the next batch', count() == 10, str(count()))
    sc.close()
    b.close()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
