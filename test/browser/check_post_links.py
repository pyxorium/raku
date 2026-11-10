# A tile post's own page, Copy link and Share (claude/raku-post-links-plan.md, SL1 to SL8) browser checks, in the chat
# sandbox: the time and "Open post" opening a post's page in the same tab (Back returns); the page (heading, "All tile
# posts", the card with no ways in, the tab title "@handle's post"); a shared link opening one tab; a pasted PDSls link;
# the deleted, hidden (author, tile) and tile-gone states; the Share menu (Copy link copying the one-tab link and
# "Link copied", the clipboard refused showing the link to copy, Share via… only with a share sheet and what it hands
# over, a cancelled share quiet, the keyboard: arrows, Escape, one menu at a time, a click outside); the Discover
# button from a post's page staying in the tab; the light look and the phone.
# Everything outside is a Playwright route (the account directory, the relay, account servers, Bluesky's public API and
# its picture server, the hide list). Tiles don't run here (screens only: a stand-in loader is enough).
# Usage: python3 test/browser/check_post_links.py <work folder>   (servers.mjs already running on 127.0.0.1:5180)
import hashlib, io, json, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
COLL = 'cafe.thunderbird.tile.post'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_H = 'thunderbird.cafe'       # always read (config.js TILE_POSTS.always)
P = 'did:plc:rqbqpaaluty5v47jwciowpik'; P_H = 'pyxorium.com'           # always read
R = 'did:plc:relayaaaaaaaaaaaaaaaaaaa'; R_H = 'relay.fakepds.net'      # found by the relay
H = 'did:plc:hiddenaaaaaaaaaaaaaaaaaa'; H_H = 'hidden.fakepds.net'     # an account on the hide list
SALT = 'lexicographer.space hide list v1'
HANDLES = {A: A_H, P: P_H, R: R_H, H: H_H}
PDS = 'https://pds.fakepds.net'

blobs = {}
def cid_for(data):
    c = 'bafkrei' + hashlib.sha256(data).hexdigest()[:52]; blobs[c] = data; return c
def png(color, size=(1280, 720)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def tile(name, desc, color):
    page = f'<!doctype html><h1>{name}</h1>'.encode(); banner = png(color)
    res = {'/': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(page)}, 'mimeType': 'text/html', 'size': len(page)}, 'content-type': 'text/html'},
           '/banner.png': {'src': {'$type': 'blob', 'ref': {'$link': cid_for(banner)}, 'mimeType': 'image/png', 'size': len(banner)}, 'content-type': 'image/png'}}
    return {'$type': 'ing.dasl.masl', 'cid': 'bafyreimanifest', 'tile': {'name': name, 'description': desc, 'resources': res, 'screenshots': [{'src': '/banner.png'}]}, 'createdAt': '2026-11-01T10:00:00Z'}
TCID = lambda rkey: 'bafyreitile' + hashlib.sha256(rkey.encode()).hexdigest()[:40].replace('0', 'a').replace('1', 'b').replace('8', 'c').replace('9', 'd')
TILES = {(A, 'maze'): tile('The Escher maze', 'Wander an impossible maze', (60, 160, 150)),
         (P, 'coaster'): tile('Roller Coaster', 'Take your sprite to the amusement park', (90, 60, 160)),
         (R, 'hiddentile'): tile('A hidden tile', '', (120, 120, 120)),
         (R, 'changed'): tile('Changed since', 'This one changed', (160, 60, 60))}
NOW = time.time()
def iso(h): return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(NOW - h * 3600))
def tpost(did, rkey, text, h, tdid, trkey, cid=None):
    v = {'$type': COLL, 'tile': {'uri': f'at://{tdid}/ing.dasl.masl/{trkey}', 'cid': cid or TCID(trkey)}, 'createdAt': iso(h)}
    if text is not None: v['text'] = text
    return {'uri': f'at://{did}/{COLL}/{rkey}', 'cid': 'bafyreipost' + rkey, 'value': v}
POSTS = {R: [tpost(R, '3mzr1', 'Found by the relay: the maze', 1, A, 'maze'),
             tpost(R, '3mzr2', 'A post about a hidden tile', 2, R, 'hiddentile'),
             tpost(R, '3mzr3', 'A tile that changed since', 30, R, 'changed', cid=TCID('the-old-version'))],
         A: [tpost(A, '3mza1', 'From thunderbird.cafe, my coaster', 3, P, 'coaster')],
         P: [tpost(P, '3mzp1', None, 5, P, 'coaster')],
         H: [tpost(H, '3mzh1', 'From a hidden account', 0.5, A, 'maze')]}
HIDE_LIST = json.dumps({'version': 1, 'salt': SALT, 'accounts': [hashlib.sha256(f'{SALT}\n{H}'.encode()).hexdigest()],
                        'tiles': [hashlib.sha256(f'{SALT}\n{R}\nhiddentile'.encode()).hexdigest()]})
state = {'pds': 'ok'}
calls = []
def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'relay1.us-east.bsky.network':
        return js({'repos': [{'did': R}, {'did': A}, {'did': H}] if q.get('collection') == COLL else []})
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
        if state['pds'] == 'down' and q.get('collection') == COLL and u.path.endswith('getRecord'): return r.abort()
        repo = q.get('repo')
        if u.path.endswith('listRecords'):
            return js({'records': POSTS.get(repo, []) if q.get('collection') == COLL else []})
        if u.path.endswith('getRecord'):
            if q.get('collection') == COLL:
                rec = next((x for x in POSTS.get(repo, []) if x['uri'].endswith('/' + q.get('rkey', ''))), None)
                return js(rec) if rec else js({'error': 'RecordNotFound'}, 400)
            rec = TILES.get((repo, q.get('rkey')))
            if not rec or q.get('collection') != 'ing.dasl.masl': return js({'error': 'RecordNotFound'}, 400)
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
enc = lambda s: quote(s, safe='')
PURI = lambda did, rkey: f'at://{did}/{COLL}/{rkey}'
ONE = PURI(R, '3mzr1')
link_for = lambda uri: f'https://raku.lexicographer.space/#t={enc(uri)}&a=0'
POSTS_URL = RAKU + '#t=raku%3Adiscover%2Fposts&a=0'
# a stand-in share sheet: records what it was handed; 'cancel' answers as a closed sheet does
SHARE = "window.__shared = []; window.__shareMode = 'ok'; navigator.share = async (d) => { window.__shared.push(d); if (window.__shareMode === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } };"
NOSHARE = "try { delete Navigator.prototype.share; } catch {} try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {}"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    def new_ctx(share=True, clip=True, **kw):
        ctx = b.new_context(**({'viewport': {'width': 1400, 'height': 900}, 'color_scheme': 'dark'} | kw))
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://relay1.us-east.bsky.network/**', 'https://typeahead.waow.tech/**', 'https://appmosphe.re/**']:
            ctx.route(host, route)
        if clip: ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=RAKU.rstrip('/'))
        else: ctx.add_init_script("navigator.clipboard.writeText = async () => { throw new Error('refused'); };")
        ctx.add_init_script(SHARE if share else NOSHARE)
        return ctx
    ctx = new_ctx()
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ---- Tile posts: the time link, the Share button ----
    page.goto(POSTS_URL); page.wait_for_selector('.discover')
    wait_for(lambda: len(page.query_selector_all('.tile-post')) >= 4, page=page)
    first = '.tile-post:nth-child(1)'
    check('Tile posts: each post has a Share button (curved arrow) in a row at its foot', len(page.query_selector_all('.tile-post .post-actions .ps-btn')) == len(page.query_selector_all('.tile-post'))
          and page.eval_on_selector(f'{first} .ps-btn svg', 's => s.classList.contains("icon-share")'))
    check('...the time is a link (a button) with the full date as its tooltip', page.eval_on_selector(f'{first} .post-time', 'e => e.tagName === "BUTTON" && e.classList.contains("post-time-link") && /^\\d{4}-/.test(e.title) && e.textContent === "1h"'))
    page.click(f'{first} .ps-btn')
    items = texts(page, f'{first} .ps-menu [role=menuitem]')
    check('the menu: Open post, Copy link, Share via… (a share sheet here)', items == ['Open post', 'Copy link', 'Share via…'], str(items))
    check('...the first item has the keys; the button says the menu is open', page.evaluate('document.activeElement.textContent') == 'Open post' and page.get_attribute(f'{first} .ps-btn', 'aria-expanded') == 'true')
    page.keyboard.press('ArrowDown'); a1 = page.evaluate('document.activeElement.textContent')
    page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown'); a2 = page.evaluate('document.activeElement.textContent')
    page.keyboard.press('ArrowUp'); a3 = page.evaluate('document.activeElement.textContent')
    check('...the arrow keys move through it, round and round', [a1, a2, a3] == ['Copy link', 'Open post', 'Share via…'], str([a1, a2, a3]))
    page.screenshot(path=str(OUT / 'menu-open-dark.png'))
    page.keyboard.press('Escape')
    check('...Escape closes it and the keys go back to the Share button', page.is_hidden(f'{first} .ps-menu') and page.evaluate('document.activeElement.classList.contains("ps-btn")'))
    page.click(f'{first} .ps-btn'); page.click('.tile-post:nth-child(2) .ps-btn')
    check('one menu open at a time', len([1 for el in page.query_selector_all('.ps-menu') if el.is_visible()]) == 1 and page.is_visible('.tile-post:nth-child(2) .ps-menu'))
    page.mouse.click(5, 880)
    check('...a click outside closes it', page.is_hidden('.tile-post:nth-child(2) .ps-menu'))

    # ---- Copy link ----
    page.click(f'{first} .ps-btn'); page.click(f'{first} .ps-menu >> text=Copy link')
    got = wait_for(lambda: page.evaluate('navigator.clipboard.readText()'), page=page)
    check('Copy link copies Raku\'s address with just that post (its DID), not the page\'s own address', got == link_for(ONE), str(got))
    check('..."Link copied" beside the button, the menu closed', page.inner_text(f'{first} .ps-done') == 'Link copied' and page.is_hidden(f'{first} .ps-menu'))
    check('...and it goes after a moment', wait_for(lambda: page.inner_text(f'{first} .ps-done') == '', timeout=4, page=page))

    # ---- Share via… ----
    page.evaluate("window.__shared = []")
    page.click(f'{first} .ps-btn'); page.click(f'{first} .ps-menu >> text=Share via')
    wait_for(lambda: page.evaluate('window.__shared.length'), page=page)
    sh = page.evaluate('window.__shared')
    check("Share via… hands the share sheet the title \"@handle's tile post\", the post's words and the link (SL8)",
          sh == [{'title': f"@{R_H}'s tile post", 'text': 'Found by the relay: the maze', 'url': link_for(ONE)}], str(sh))
    nt = page.eval_on_selector_all('.tile-post', 'ps => ps.findIndex(p => !p.querySelector(".post-text"))')
    page.evaluate("window.__shared = []")
    page.click(f'.tile-post:nth-child({nt + 1}) .ps-btn'); page.click(f'.tile-post:nth-child({nt + 1}) .ps-menu >> text=Share via')
    wait_for(lambda: page.evaluate('window.__shared.length'), page=page)
    sh = page.evaluate('window.__shared')
    check('...a post with no words: the title and the link only', sh == [{'title': f"@{P_H}'s tile post", 'url': link_for(PURI(P, '3mzp1'))}], str(sh))
    page.evaluate("window.__shared = []; window.__shareMode = 'cancel'")
    page.click(f'{first} .ps-btn'); page.click(f'{first} .ps-menu >> text=Share via')
    wait_for(lambda: page.evaluate('window.__shared.length'), page=page); page.wait_for_timeout(300)
    check('...a share sheet closed without sharing: nothing shown', page.is_hidden(f'{first} .ps-menu') and page.inner_text(f'{first} .ps-done') == '')
    page.evaluate("window.__shareMode = 'ok'")

    # ---- the time and Open post: the post's page in this tab ----
    page.click(f'{first} .post-time')
    check('the time opens the post\'s page in this tab (no new tab)', wait_for(lambda: page.inner_text('.tpp-head h1') == 'Tile post' and len(page.query_selector_all('.tab')) == 1, page=page))
    check('...the address box shows the post\'s AT URI; the page address holds it', page.input_value('.addr') == ONE and enc(ONE) in page.evaluate('location.hash'), page.input_value('.addr'))
    wait_for(lambda: page.title() == f"@{R_H}'s post · Raku", page=page)
    check("...the tab's title \"@handle's post\", and the browser's", page.title() == f"@{R_H}'s post · Raku" and texts(page, '.tab .tab-title') == [f"@{R_H}'s post"], page.title())
    check('...the heading "Tile post" and "All tile posts" beside it', texts(page, '.tpp-head h1') == ['Tile post'] and texts(page, '.tpp-head .linkish') == ['All tile posts'])
    wait_for(lambda: page.inner_text('.tp-page .card-title') == 'The Escher maze', page=page)
    check('...the post\'s card as in the list: author, words, the tile with Play here', page.inner_text('.tp-page .post-handle') == f'@{R_H}' and page.inner_text('.tp-page .post-text') == 'Found by the relay: the maze'
          and wait_for(lambda: page.is_visible('.tp-page .tp-play'), page=page))
    check('...on its own page the time is plain text (the full date as tooltip)', page.eval_on_selector('.tp-page .post-time', 'e => e.tagName === "SPAN" && /^\\d{4}-/.test(e.title)'))
    page.click('.tp-page .ps-btn')
    check('...and the menu has no "Open post"', texts(page, '.tp-page .ps-menu [role=menuitem]') == ['Copy link', 'Share via…'], str(texts(page, '.tp-page .ps-menu [role=menuitem]')))
    page.keyboard.press('Escape')
    page.screenshot(path=str(OUT / 'page-dark.png'))
    page.click('.nav-btn[aria-label="Back"]')
    check("Raku's Back returns to Tile posts", wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'], page=page))
    wait_for(lambda: len(page.query_selector_all('.tile-post')) >= 4, page=page)
    page.click('.tile-post:nth-child(2) .ps-btn'); page.click('.tile-post:nth-child(2) .ps-menu >> text=Open post')
    check('"Open post" in the menu opens the post\'s page too', wait_for(lambda: page.input_value('.addr') == PURI(A, '3mza1') and page.inner_text('.tpp-head h1') == 'Tile post', page=page), page.input_value('.addr'))
    page.click('.tpp-head .linkish')
    check('"All tile posts" opens Tile posts in the same tab', wait_for(lambda: texts(page, '.dv-centre h1') == ['Tile posts'] and len(page.query_selector_all('.tab')) == 1, page=page))
    check('no page errors so far', not errors, str(errors))

    # ---- a shared link: one tab, no Back ----
    p2 = ctx.new_page(); e2 = []; p2.on('pageerror', lambda e: e2.append(str(e)))
    p2.goto(RAKU + f'#t={enc(ONE)}&a=0')
    check('a shared link opens Raku with one tab: the post\'s page', wait_for(lambda: p2.inner_text('.tpp-head h1') == 'Tile post' and len(p2.query_selector_all('.tab')) == 1, page=p2))
    check('...Back has nowhere to go; "All tile posts" is the way on', p2.is_disabled('.nav-btn[aria-label="Back"]') and p2.is_visible('.tpp-head .linkish'))
    wait_for(lambda: p2.inner_text('.tp-page .card-title') == 'The Escher maze', page=p2)
    p2.click('.nav-btn[aria-label="Discover"]')
    check('the Discover button on a post\'s page stays in the tab (a page of Raku\'s own)', wait_for(lambda: p2.query_selector('.discover') and len(p2.query_selector_all('.tab')) == 1, page=p2))
    # pasted into the address box: a PDSls link, a handle address
    p2.fill('.addr', f'https://pdsls.dev/{PURI(A, "3mza1")}'); p2.press('.addr', 'Enter')
    check('a PDSls link to a post, pasted, opens its page', wait_for(lambda: p2.input_value('.addr') == PURI(A, '3mza1') and p2.is_visible('.tpp-head'), page=p2), p2.input_value('.addr'))
    p2.fill('.addr', f'at://{A_H}/{COLL}/3mza1'); p2.press('.addr', 'Enter')
    check('...an address by handle too', wait_for(lambda: p2.input_value('.addr') == f'at://{A_H}/{COLL}/3mza1' and wait_for(lambda: p2.inner_text('.tp-page .post-text') == 'From thunderbird.cafe, my coaster', page=p2), page=p2))
    p2.fill('.addr', f'at://{A}/{COLL}'); p2.press('.addr', 'Enter')
    check('...the whole collection still opens the link message, not a tab', wait_for(lambda: p2.is_visible('.link-msg'), page=p2) and p2.input_value('.addr') == f'at://{A_H}/{COLL}/3mza1')
    p2.keyboard.press('Escape')
    check('no page errors on the shared-link tab', not e2, str(e2))

    # ---- states (SL6) ----
    def open_post(uri, pg=None):
        pg = pg or page
        pg.goto(RAKU + f'#t={enc(uri)}&a=0'); pg.wait_for_selector('.tpp-head')
    open_post(PURI(A, 'nosuchpost'))
    msg = wait_for(lambda: page.inner_text('.tpp-note'), page=page)
    check('a deleted post: "There\'s no tile post at that address (it may have been deleted)."; tab "No such post"', msg == "There's no tile post at that address (it may have been deleted)." and page.title() == 'No such post · Raku', f'{msg} | {page.title()}')
    check('...the heading and "All tile posts" stay', page.is_visible('.tpp-head h1') and page.is_visible('.tpp-head .linkish'))
    page.screenshot(path=str(OUT / 'page-deleted.png'))
    open_post(PURI(H, '3mzh1'))
    msg = wait_for(lambda: page.inner_text('.tpp-note'), page=page)
    check('a hidden author: "This tile post isn\'t shown in Raku." with Reporting and takedowns; tab "Not shown"', msg and msg.startswith("This tile post isn't shown in Raku.") and 'Reporting and takedowns' in msg and page.title() == 'Not shown · Raku', f'{msg} | {page.title()}')
    check("...the hidden account's post record isn't even asked for", not any(f'repo={enc(H)}' in c and 'getRecord' in c for c in calls) and not any(f'repo={H}' in c and 'getRecord' in c for c in calls))
    check('...the link opens in a new tab with no opener', page.eval_on_selector('.tpp-note a', 'a => [a.href, a.target, a.rel]') == ['https://lexicographer.space/takedowns', '_blank', 'noopener noreferrer'])
    page.screenshot(path=str(OUT / 'page-hidden.png'))
    open_post(PURI(R, '3mzr2'))
    msg = wait_for(lambda: page.inner_text('.tpp-note'), page=page)
    check('a post about a hidden tile: not shown either (never which list or why)', msg and msg.startswith("This tile post isn't shown in Raku.") and page.title() == 'Not shown · Raku', str(msg))
    open_post(PURI(R, '3mzr3'))
    gone = wait_for(lambda: page.inner_text('.tp-page .tp-gone'), page=page)
    check('a post whose tile changed since: the post, with "This tile can\'t be shown." as in the list', gone == "This tile can't be shown." and page.inner_text('.tp-page .post-text') == 'A tile that changed since' and page.is_visible('.tp-page .ps-btn'), str(gone))
    state['pds'] = 'down'
    open_post(PURI(A, '3mza1'))
    msg = wait_for(lambda: page.inner_text('.tpp-note'), page=page, timeout=20)
    check("the post's server unreachable: a note with Try again", msg and msg.startswith("Couldn't reach the post's server just now.") and page.is_visible('.tpp-note .linkish'), str(msg))
    state['pds'] = 'ok'
    page.click('.tpp-note .linkish')
    check('...Try again reads it again', wait_for(lambda: page.query_selector('.tp-page .post-text') and page.inner_text('.tp-page .post-text') == 'From thunderbird.cafe, my coaster', page=page, timeout=20))
    check('no page errors', not errors, str(errors))

    # ---- no share sheet (Firefox on a computer), and the clipboard refused ----
    c3 = new_ctx(share=False, clip=False); p3 = c3.new_page()
    p3.goto(POSTS_URL); p3.wait_for_selector('.discover')
    wait_for(lambda: len(p3.query_selector_all('.tile-post')) >= 4, page=p3)
    p3.click('.tile-post:nth-child(1) .ps-btn')
    check('no share sheet: the menu is Open post and Copy link only', texts(p3, '.tile-post:nth-child(1) .ps-menu [role=menuitem]') == ['Open post', 'Copy link'], str(texts(p3, '.tile-post:nth-child(1) .ps-menu [role=menuitem]')))
    p3.click('.tile-post:nth-child(1) .ps-menu >> text=Copy link')
    sel = wait_for(lambda: p3.evaluate('(() => { const i = document.activeElement; return i && i.classList.contains("ps-link") && i.value === i.value.slice(i.selectionStart, i.selectionEnd) && i.value; })()'), page=p3)
    check('the clipboard refused: the link shown selected, to copy by hand', sel == link_for(ONE) and 'Select and copy' in p3.inner_text('.tile-post:nth-child(1) .ps-menu'), str(sel))
    p3.keyboard.press('Escape')
    check('...Escape closes it', p3.is_hidden('.tile-post:nth-child(1) .ps-menu'))
    c3.close()

    # ---- the light look and the phone ----
    c4 = new_ctx(color_scheme='light'); p4 = c4.new_page()
    p4.goto(POSTS_URL); p4.wait_for_selector('.discover')
    wait_for(lambda: len(p4.query_selector_all('.tile-post')) >= 4 and p4.inner_text('.tile-post:nth-child(1) .card-title') == 'The Escher maze', page=p4)
    p4.click('.tile-post:nth-child(1) .ps-btn')
    look = p4.evaluate('''() => { const m = getComputedStyle(document.querySelector('.tile-post .ps-menu')), it = getComputedStyle(document.querySelector('.tile-post .ps-item'));
      return [document.documentElement.dataset.look || matchMedia('(prefers-color-scheme: light)').matches, m.backgroundColor, it.color]; }''')
    check('light look: the menu drawn in the light colours (from :root names)', look[1] != 'rgba(0, 0, 0, 0)' and look[2] != look[1], str(look))
    p4.screenshot(path=str(OUT / 'menu-open-light.png'))
    p4.keyboard.press('Escape')
    p4.click('.tile-post:nth-child(1) .post-time')
    wait_for(lambda: p4.inner_text('.tp-page .card-title') == 'The Escher maze', page=p4)
    p4.screenshot(path=str(OUT / 'page-light.png'))
    c4.close()
    c5 = new_ctx(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2); p5 = c5.new_page()
    p5.goto(RAKU + f'#t={enc(ONE)}&a=0'); p5.wait_for_selector('.tpp-head')
    wait_for(lambda: p5.inner_text('.tp-page .card-title') == 'The Escher maze', page=p5)
    p5.tap('.tp-page .ps-btn')
    lay = p5.evaluate('''() => { const m = document.querySelector('.tp-page .ps-menu').getBoundingClientRect(), c = document.querySelector('.tp-page .post').getBoundingClientRect();
      return { wide: document.documentElement.scrollWidth <= innerWidth, menu: m.left >= 0 && m.right <= innerWidth, card: c.right <= innerWidth }; }''')
    check('phone: the page fits, no sideways scrolling; the open menu stays on screen', all(lay.values()), str(lay))
    p5.screenshot(path=str(OUT / 'page-phone.png'))
    c5.close()

    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)} passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
