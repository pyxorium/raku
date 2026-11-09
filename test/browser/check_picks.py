# The first screen's picks, baked in (claude/raku-baked-picks-plan.md, BP1 to BP3): a baked pick's whole card (name,
# description, checked handle, banner from Raku's own /picks/ files) shows at once, before any record or picture comes
# from elsewhere; then the quiet checks: a pick hidden since the bake is removed, a record that changed swaps its words
# and banner (appmosphe.re's copy of the new one), an unchanged one keeps Raku's own picture and asks appmosphe.re for
# nothing, a record that can't be read leaves the baked card as it is, a missing baked file falls back to appmosphe.re's
# copy, and a pick with no baked copy loads as before.
#
# It sets everything up itself: a copy of this Raku folder with a test bake (src/picks.baked.js and public/picks/*.webp
# for the real PICKS, written here), bundled with esbuild, then servers.mjs. No loader replica (no tile is run).
# Usage: python3 test/browser/check_picks.py <work folder>
#   (needs Playwright with Chromium, Pillow, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader
#   and rooms-lab)
import io, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
PDS = 'https://pds.fakepds.net'
LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'

cfg_text = (RAKU_SRC / 'src' / 'config.js').read_text()
PICKS = re.findall(r"'(at://did:plc:[a-z2-7]{24}/ing\.dasl\.masl/[a-z0-9]+)'", cfg_text[cfg_text.index('export const PICKS'):cfg_text.index(']);', cfg_text.index('export const PICKS'))])
assert len(PICKS) == 6, PICKS
def parts(uri): _, _, did, _, rkey = uri.split('/'); return did, rkey
def png(color, size):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, 'PNG'); return b.getvalue()
def webp(color):
    b = io.BytesIO(); Image.new('RGB', (640, 360), color).save(b, 'WEBP', quality=80); return b.getvalue()
COLORS = [(230, 120, 40), (60, 160, 120), (40, 60, 200), (200, 40, 150), (120, 120, 120), (250, 220, 60)]

# The roles, in PICKS order:
#   1 unchanged  2 record read fails (500)  3 unchanged, its baked file missing  4 changed since the bake (name, banner)
#   5 hidden since the bake (Bluesky's !hide on the account)  6 not baked (loads as before)
picks = []
for i, uri in enumerate(PICKS):
    did, rkey = parts(uri)
    picks.append({'uri': uri, 'did': did, 'rkey': rkey, 'handle': f'pick{i + 1}.example.com', 'baked_name': f'Baked {i + 1}',
                  'banner_cid': f'bafkreibakedbanner{i + 1}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})
NEW_BANNER_4 = 'bafkreichangedbannerfouraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
NOT_BAKED_6 = 'bafkreinotbakedbannersixaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
def record_for(i):
    p = picks[i]
    name = 'Changed 4' if i == 3 else ('Record 6' if i == 5 else p['baked_name'])
    banner = NEW_BANNER_4 if i == 3 else (NOT_BAKED_6 if i == 5 else p['banner_cid'])
    return {'uri': p['uri'], 'cid': 'bafyreirec', 'value': {'$type': 'ing.dasl.masl', 'tile': {'name': name, 'description': f'Description {i + 1}',
        'screenshots': [{'src': '/banner.png'}], 'resources': {'/': {'src': {'$type': 'blob', 'ref': {'$link': 'bafkreipageaaaaaaaaaaaaaaaaaaaaaa'}, 'mimeType': 'text/html', 'size': 10}},
        '/banner.png': {'src': {'$type': 'blob', 'ref': {'$link': banner}, 'mimeType': 'image/png', 'size': 1000}}}}}}
APPMOS = {NEW_BANNER_4: png((10, 200, 10), (1280, 720)), NOT_BAKED_6: png((10, 10, 200), (1280, 720)), picks[2]['banner_cid']: png((40, 60, 200), (1280, 720))}

# ---- a copy of Raku with the test bake, bundled ----
COPY = W / 'raku'
if COPY.exists(): shutil.rmtree(COPY)
shutil.copytree(RAKU_SRC, COPY, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'shots'), symlinks=True)
os.symlink(RAKU_SRC / 'node_modules', COPY / 'node_modules')
pics = COPY / 'public' / 'picks'; pics.mkdir(parents=True, exist_ok=True)
for f in pics.glob('*.webp'): f.unlink()
entries = []
for i, p in enumerate(picks[:5]):
    entries.append({'uri': p['uri'], 'did': p['did'], 'rkey': p['rkey'], 'cid': 'bafyreirec', 'name': p['baked_name'], 'description': f'Baked description {i + 1}',
                    'handle': p['handle'], 'banner': {'cid': p['banner_cid'], 'file': f"picks/{p['rkey']}.webp", 'width': 640, 'height': 360}})
    if i != 2: (pics / f"{p['rkey']}.webp").write_bytes(webp(COLORS[i]))
(COPY / 'src' / 'picks.baked.js').write_text('export const BAKED_PICKS = Object.freeze(' + json.dumps({'bakedAt': '2026-11-09T12:00:00.000Z', 'picks': entries}) + ');\n')
site = W / 'site' / 'assets'; site.mkdir(parents=True, exist_ok=True)
esbuild = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'
env = {**os.environ, 'NODE_PATH': f"{RAKU_SRC / 'node_modules'}:/opt/npm-tools/node_modules"}
subprocess.run([esbuild, str(COPY / 'src' / 'main.js'), '--bundle', '--format=esm', f'--outdir={site}', '--log-level=error',
                f'--alias:@atproto/oauth-client-browser={COPY / "test" / "browser" / "oauth-standin.js"}', "--define:__RAKU_BUILD__=\"test-1\""],
               check=True, env=env, cwd=str(COPY))
servers = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'servers.mjs'), str(W), str(COPY)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)

calls = []
held = []                     # record reads and moderation lookups held back until step 2 (step 1: what the page draws on its own)
state = {'hold': True}
by_did = {p['did']: p for p in picks}
def route(r):
    url = r.request.url
    calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        did = u.path.strip('/'); p = by_did.get(did)
        if not p: return js({'message': 'not found'}, 404)
        return js({'id': did, 'alsoKnownAs': [f"at://{p['handle']}"], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'):
            p = next((x for x in picks if x['handle'] == q.get('handle')), None)
            return js({'did': p['did']}) if p else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile') and state['hold']: held.append(lambda r=r: route(r)); return
        if u.path.endswith('getProfiles') and state['hold']: held.append(lambda r=r: route(r)); return
        if u.path.endswith('getProfile'):
            actor = q.get('actor')
            labels = [{'src': LABELER, 'uri': f'at://{actor}', 'val': '!hide', 'cts': '2026-11-01T00:00:00Z'}] if actor == picks[4]['did'] else []
            return js({'did': actor, 'labels': labels})
        if u.path.endswith('getProfiles'):
            return js({'profiles': [{'did': a, 'labels': [{'src': LABELER, 'uri': f'at://{a}', 'val': '!hide', 'cts': '2026-11-01T00:00:00Z'}] if a == picks[4]['did'] else []} for a in parse_qs(u.query).get('actors', [])]})
        return js({})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        if state['hold']: held.append(lambda r=r: route(r)); return
        return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname == 'appmosphere.re' or u.hostname == 'appmosphe.re':
        cid = u.path.rsplit('/', 1)[-1]
        if cid in APPMOS: return r.fulfill(status=200, headers={'content-type': 'image/png'}, body=APPMOS[cid])
        return r.fulfill(status=404, body='')
    if u.hostname == 'pds.fakepds.net' and u.path.endswith('getRecord') and q.get('collection') == 'ing.dasl.masl':
        def answer(r=r, q=q):
            p = by_did.get(q.get('repo'))
            if not p or p['rkey'] != q.get('rkey'): return r.fulfill(status=400, headers={**cors, 'content-type': 'application/json'}, body=json.dumps({'error': 'RecordNotFound'}))
            i = picks.index(p)
            if i == 1: return r.fulfill(status=500, headers=cors, body='')
            r.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(record_for(i)))
        if state['hold']: held.append(answer); return
        return answer()
    r.fulfill(status=404, headers=cors, body='')

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''), flush=True)
POKE = {'page': None}
def wait_for(fn, timeout=10.0, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        try:
            if POKE['page']: POKE['page'].evaluate('1')
        except Exception: pass
        time.sleep(step)
    return None

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://*.bsky.network/**', 'https://api.graze.social/**']:
            ctx.route(host, route)
        page = ctx.new_page()
        console = []
        page.on('console', lambda m: console.append((m.type, m.text, (m.location or {}).get('url', ''))) if m.type == 'error' else None)
        page.on('pageerror', lambda e: console.append(('pageerror', str(e), '')))
        POKE['page'] = page
        cards = lambda: page.eval_on_selector_all('.picks .card', '''cs => cs.map(c => ({ name: c.querySelector('.card-title').textContent, desc: c.querySelector('.card-desc').textContent,
            by: c.querySelector('.card-by').textContent, greyed: c.classList.contains('greyed'),
            imgs: [...c.querySelectorAll('.card-pic img')].map(i => ({ src: i.src, w: i.complete ? i.naturalWidth : 0 })) }))''')
        page.goto(RAKU)
        page.wait_for_selector('.picks .card')

        # 1. before any record arrives (they're held back): the five baked cards, whole
        ok = wait_for(lambda: [c['name'] for c in cards()][:5] == [p['baked_name'] for p in picks[:5]] and all(c['imgs'] and c['imgs'][0]['w'] for i, c in enumerate(cards()[:5]) if i != 2), 5)
        cs = cards()
        check('BP1: the baked picks show their names at once, while every record read and moderation lookup is held back', ok, f'{[c["name"] for c in cs]}')
        check('...(and those were asked for: the quiet checks are running)', wait_for(lambda: len(held) >= 5, 5), str(len(held)))
        check('...their descriptions and checked handles, from the bake', [c['desc'] for c in cs[:5]] == [f'Baked description {i + 1}' for i in range(5)] and [c['by'] for c in cs[:5]] == [f'by @pick{i + 1}.example.com' for i in range(5)], str([(c['desc'], c['by']) for c in cs[:5]]))
        own = [c for i, c in enumerate(cs[:5]) if i != 2]
        check('...their banners from Raku\'s own /picks/ files (640 px)', all(len(c['imgs']) == 1 and re.match(r'http://127\.0\.0\.1:5180/picks/[a-z0-9]+\.webp$', c['imgs'][0]['src']) and c['imgs'][0]['w'] == 640 for c in own), str([c['imgs'] for c in own]))
        check('...a baked file that\'s missing falls back to appmosphe.re\'s copy of the baked banner', wait_for(lambda: (lambda c: len(c['imgs']) == 1 and c['imgs'][0]['src'].startswith('https://appmosphe.re/img/') and picks[2]['banner_cid'] in c['imgs'][0]['src'] and c['imgs'][0]['w'] == 1280)(cards()[2]), 5), str(cards()[2]['imgs']))
        check('...the pick with no baked copy waits, as before ("…")', cs[5]['name'] == '…', cs[5]['name'])
        check('...and appmosphe.re was asked for nothing but the missing file', [c for c in calls if 'appmosphe.re/img/' in c and picks[2]['banner_cid'] not in c] == [], str([c for c in calls if 'appmosphe.re' in c]))
        page.screenshot(path=str(OUT / 'picks-baked-at-once.png'))

        # 2. the quiet checks, once the records come
        state['hold'] = False
        for f in list(held): f()
        held.clear()
        check('a pick hidden since the bake is removed', wait_for(lambda: picks[4]['baked_name'] not in [c['name'] for c in cards()], 10), str([c['name'] for c in cards()]))
        check('a pick whose record changed: its new name and description', wait_for(lambda: any(c['name'] == 'Changed 4' and c['desc'] == 'Description 4' for c in cards()), 10), str([c['name'] for c in cards()]))
        c4 = wait_for(lambda: next((c for c in cards() if c['name'] == 'Changed 4' and c['imgs'] and c['imgs'][0]['w']), None), 10)
        check('...and its new banner, appmosphe.re\'s copy, in place of the baked one (one picture)', c4 and len(c4['imgs']) == 1 and NEW_BANNER_4 in c4['imgs'][0]['src'] and c4['imgs'][0]['w'] == 1280, str(c4 and c4['imgs']))
        time.sleep(1.0)
        c1 = next((c for c in cards() if c['name'] == 'Baked 1'), None)
        check('an unchanged pick keeps Raku\'s own picture', c1 and len(c1['imgs']) == 1 and '/picks/' in c1['imgs'][0]['src'], str(c1))
        check('...and appmosphe.re was never asked for its banner', not any(picks[0]['banner_cid'] in c for c in calls))
        c2 = next((c for c in cards() if c['name'] == 'Baked 2'), None)
        check('a pick whose record can\'t be read stays as baked (not greyed)', c2 and not c2['greyed'] and c2['desc'] == 'Baked description 2' and '/picks/' in c2['imgs'][0]['src'], str(c2))
        c6 = wait_for(lambda: next((c for c in cards() if c['name'] == 'Record 6' and c['imgs'] and c['imgs'][0]['w']), None), 10)
        check('the pick with no baked copy loads as before: its record\'s name, appmosphe.re\'s banner', c6 and NOT_BAKED_6 in c6['imgs'][0]['src'], str(c6))
        check('...and its checked handle', wait_for(lambda: next((c for c in cards() if c['name'] == 'Record 6'), {}).get('by') == 'by @pick6.example.com', 5))
        page.screenshot(path=str(OUT / 'picks-after-checks.png'))

        STANDINS = ('https://pds.fakepds.net/', 'https://plc.directory/', 'https://appmosphe.re/', 'http://127.0.0.1:5180/picks/', 'https://lexicographer.space/', 'https://public.api.bsky.app/')
        errors = [c for c in console if not (c[1].startswith('Failed to load resource') and str(c[2]).startswith(STANDINS))]
        check('no errors on Raku\'s first screen (besides the stand-ins\' "not found")', not errors, str(errors[:3]))
        # 3. a baked card opens its tile, as before (no loader runs here: only the address is checked)
        page.click(".picks .card:has-text('Baked 1') .card-main")
        check('a baked card opens its tile (the address box shows it)', wait_for(lambda: page.input_value('.addr') == picks[0]['uri'] or page.input_value('.addr').endswith(f"/ing.dasl.masl/{picks[0]['rkey']}"), 10), page.input_value('.addr'))

        b.close()
finally:
    servers.terminate()

passed = sum(1 for _, ok in results if ok)
print(f'\n{passed} passed, {len(results) - passed} failed')
sys.exit(0 if passed == len(results) else 1)
