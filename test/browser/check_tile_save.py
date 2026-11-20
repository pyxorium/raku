# Saving a published tile as a file, in a browser (claude/tile-files-plan.md, part 2a): on a tile's tab, the button after
# "Open a tile file" (D1; not on the first screen or a file's tab) saves anyone's tile (D2) as a .tile, its files from
# Raku's kept files (none fetched twice), each checked against its address, the record's signed proof from the author's
# server carried inside (a stand-in for com.atproto.sync.getRecord's CAR); the line names the author and says what won't
# work from the file (D3: a game Raku knows, a tile with ways). The file opens again with "Open a tile file": it runs, a
# game in it still gets Raku's answer to its hello (the character's path; signed out: "ready"), never "can-save". A
# server whose file doesn't match its address: nothing saved. A server without the proof: saved without it. The phone.
#
# A probe tile stands in for a game (it says the sprite games' hello on the data channel and shows what Raku answers),
# at Cosmic Junkyard's own address (config GAME_SAVES), so Raku treats it as that game in a tab.
#
# Usage: python3 test/browser/check_tile_save.py <work folder> <tiles-loading-server folder> [--break=hash]
#   (--break=hash builds a copy whose saving skips checking each file against its address, to show the check catches it)
#   (needs Playwright with Chromium, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader, @atcute/*
#   and rooms-lab, and port 80 free for the loader replica)
import base64, hashlib, json, os, re, shutil, struct, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
BREAK = next((a.split('=', 1)[1] for a in sys.argv[3:] if a.startswith('--break=')), None)
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
DL = W / 'downloads'; DL.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'
PDS = 'https://pds.fakepds.net'
A = 'did:plc:6vxjigxrqizmbo56gojxico3'; A_HANDLE = 'thunderbird.cafe'
TILE = 'ing.dasl.masl'
CJ_RKEY = '3mwvoqidyqd24'            # Cosmic Junkyard's address (config GAME_SAVES)

# ---- a little DAG-CBOR, enough for the stand-in proof ----
def b32(b): return base64.b32encode(b).decode().lower().rstrip('=')
def unb32(s): return base64.b32decode(s.upper() + '=' * (-len(s) % 8))
def raw_cid(data): return 'b' + b32(bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest())
def cb_cid_bytes(data): return bytes([0x01, 0x71, 0x12, 0x20]) + hashlib.sha256(data).digest()
def head(major, n):
    if n < 24: return bytes([(major << 5) | n])
    if n < 256: return bytes([(major << 5) | 24, n])
    if n < 65536: return bytes([(major << 5) | 25]) + struct.pack('>H', n)
    return bytes([(major << 5) | 26]) + struct.pack('>I', n)
def cbor(v):
    if isinstance(v, bool): return b'\xf5' if v else b'\xf4'
    if isinstance(v, int): return head(0, v)
    if isinstance(v, str): b = v.encode(); return head(3, len(b)) + b
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, list): return head(4, len(v)) + b''.join(cbor(x) for x in v)
    if isinstance(v, dict):
        if list(v.keys()) == ['$link']: c = b'\x00' + unb32(v['$link'][1:]); return b'\xd8\x2a' + head(2, len(c)) + c
        ks = sorted(v.keys(), key=lambda k: (len(k.encode()), k.encode()))
        return head(5, len(ks)) + b''.join(cbor(k) + cbor(v[k]) for k in ks)
    raise TypeError(v)
def varint(n):
    out = b''
    while n >= 0x80: out += bytes([(n & 0x7f) | 0x80]); n >>= 7
    return out + bytes([n])
def car(root, blocks):
    h = cbor({'roots': [{'$link': 'b' + b32(root)}], 'version': 1})
    return varint(len(h)) + h + b''.join(varint(len(c) + len(d)) + c + d for c, d in blocks)

# ---- the stand-in account server: tiles, their files, their proofs ----
blobs = {}
def res(data, ctype):
    c = raw_cid(data); blobs[c] = data
    return {'src': {'$type': 'blob', 'ref': {'$link': c}, 'mimeType': ctype, 'size': len(data)}, 'content-type': ctype}
ICON = (RAKU_SRC / 'public' / 'favicon-32.png').read_bytes()
PROBE_JS = b'''const dp = await import('/.well-known/web-tiles/data.js');
const got = [];
dp.addDataHandler((p) => { got.push(p && p.kind === 'sprite-status' ? 'status:' + p.state : (p && p.kind) || 'other'); document.getElementById('n').textContent = got.join(','); });
dp.listen();
dp.sendData({ kind: 'hello', v: 1 });
'''
PROBE_HTML = b'''<!doctype html><meta charset=utf-8><body style="font:20px sans-serif;background:#fffdf7;padding:24px"><h1 id=h>Probe game</h1><p id=n></p><script type=module src=./probe.js></script>'''
def tile(name, extra=None):
    r = {'/': res(PROBE_HTML, 'text/html'), '/probe.js': res(PROBE_JS, 'text/javascript'), '/icon.png': res(ICON, 'image/png')}
    r.update(extra or {})
    return {'$type': TILE, 'cid': 'bafyreimanifest', 'createdAt': '2026-11-20T10:00:00Z', 'tile': {'name': name, 'description': 'A probe.', 'icons': [{'src': '/icon.png'}], 'resources': r}}
WAYS = json.dumps({'v': 1, 'entrances': [{'name': 'gate'}], 'exits': []}).encode()
BADFILE = b'<!doctype html><h1>this one is served wrong</h1>'
records = {
    CJ_RKEY: tile('Probe game'),
    '3mzwaystile': tile('A tile with ways', {'/ways.json': res(WAYS, 'application/json')}),
    '3mzbadfile': tile('A broken server', {'/extra.txt': res(BADFILE, 'text/plain')}),
    '3mznoproof': tile('No proof here'),
}
WRONG_FOR = {records['3mzbadfile']['tile']['resources']['/extra.txt']['src']['ref']['$link']}
record_bytes = {k: cbor({'name': v['tile']['name'], 'k': k}) for k, v in records.items()}      # the record "as the PDS holds it"
record_cid = {k: 'b' + b32(cb_cid_bytes(b)) for k, b in record_bytes.items()}
def proof_for(rkey):
    commit = cbor({'did': A, 'version': 3, 'rev': '3mzrev', 'data': {'$link': record_cid[rkey]}, 'sig': b'\x01\x02\x03'})
    return car(cb_cid_bytes(commit), [(cb_cid_bytes(commit), commit), (cb_cid_bytes(record_bytes[rkey]), record_bytes[rkey])])
calls = []

# ---- a copy of Raku, bundled ----
COPY = W / 'raku'
if COPY.exists(): shutil.rmtree(COPY)
shutil.copytree(RAKU_SRC, COPY, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'shots'), symlinks=True)
os.symlink(RAKU_SRC / 'node_modules', COPY / 'node_modules')
if BREAK == 'hash':
    p = COPY / 'src' / 'tile-save.js'; s = p.read_text()
    s2 = s.replace('if ((await rawCid(bytes)) !== cid) return', 'if (false) return'); assert s2 != s; p.write_text(s2)
site = W / 'site' / 'assets'
if site.exists(): shutil.rmtree(site)
site.mkdir(parents=True)
esbuild = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'
env = {**os.environ, 'NODE_PATH': f"{RAKU_SRC / 'node_modules'}:/opt/npm-tools/node_modules"}
subprocess.run([esbuild, str(COPY / 'src' / 'main.js'), '--bundle', '--format=esm', f'--outdir={site}', '--log-level=error',
                f'--alias:@atproto/oauth-client-browser={COPY / "test" / "browser" / "oauth-standin.js"}', "--define:__RAKU_BUILD__=\"test-1\""], check=True, env=env, cwd=str(COPY))
subprocess.run([esbuild, str(COPY / 'src' / 'tile-file-worker.js'), '--bundle', '--format=esm', f'--outfile={site / "tile-file-worker.js"}', '--log-level=error'], check=True, env=env, cwd=str(COPY))
servers = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'servers.mjs'), str(W), str(COPY)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
replica = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'loader-replica.mjs'), str(LOADING_SERVER)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)

def route(r):
    url = r.request.url; calls.append(url)
    u = urlparse(url); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    cors = {'access-control-allow-origin': '*'}
    def js(obj, status=200): r.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(obj))
    if u.hostname == 'plc.directory':
        if u.path.strip('/') != A: return js({'message': 'not found'}, 404)
        return js({'id': A, 'alsoKnownAs': [f'at://{A_HANDLE}'], 'service': [{'id': '#atproto_pds', 'type': 'AtprotoPersonalDataServer', 'serviceEndpoint': PDS}]})
    if u.hostname == 'public.api.bsky.app':
        if u.path.endswith('resolveHandle'): return js({'did': A}) if q.get('handle') == A_HANDLE else js({'error': 'InvalidRequest'}, 400)
        if u.path.endswith('getProfile') or u.path.endswith('getProfiles'): return js({'did': q.get('actor') or q.get('actors'), 'labels': []})
        return js({})
    if u.hostname == 'lexicographer.space' and u.path == '/hidden-tiles.json':
        return js({'version': 1, 'salt': 'lexicographer.space hide list v1', 'accounts': [], 'tiles': []})
    if u.hostname == 'pds.fakepds.net':
        if u.path.endswith('com.atproto.repo.getRecord'):
            k = q.get('rkey')
            if q.get('repo') not in (A, A_HANDLE) or k not in records: return js({'error': 'RecordNotFound'}, 400)
            return js({'uri': f'at://{A}/{TILE}/{k}', 'cid': record_cid[k], 'value': records[k]})
        if u.path.endswith('com.atproto.sync.getBlob'):
            c = q.get('cid'); b = blobs.get(c)
            if b is None: return r.fulfill(status=404, headers=cors, body='')
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/octet-stream'}, body=(b'not the right bytes' if c in WRONG_FOR else b))
        if u.path.endswith('com.atproto.sync.getRecord'):
            k = q.get('rkey')
            if k == '3mznoproof' or k not in records: return js({'error': 'RecordNotFound'}, 400)
            return r.fulfill(status=200, headers={**cors, 'content-type': 'application/vnd.ipld.car'}, body=proof_for(k))
        if u.path.endswith('listRecords'): return js({'records': []})
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
def node_read(path):
    out = subprocess.run(['node', '-e', f'''import("{RAKU_SRC}/src/tile-file.js").then(async ({{readTileFile}}) => {{
      const r = await readTileFile((await import("node:fs")).readFileSync("{path}"));
      console.log(JSON.stringify(r.ok ? {{ ok: true, name: r.name, paths: [...r.files.keys()].sort(), sizes: Object.fromEntries([...r.files].map(([p, d]) => [p, d.length])), savedFrom: r.manifest.savedFrom, said: r.savedFrom }} : r)); }})'''], capture_output=True, text=True)
    return json.loads(out.stdout or '{}')

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark', accept_downloads=True)
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://cdn.bsky.app/**',
                     'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://rpg.actor/**', 'https://*.bsky.network/**']:
            ctx.route(host, route)
        page = ctx.new_page(); POKE['page'] = page
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(RAKU + '?loader=' + LOADER); page.wait_for_selector('.addr')
        def inner():
            for f in page.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url:
                    if f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def probe(): f = inner(); return f.locator('#n').inner_text() if f else None
        def note(): return page.eval_on_selector('.note', 'n => n.hidden ? "" : n.textContent')
        save = lambda: page.query_selector('.bar .save-file-btn')

        # 1. not on the first screen
        check('no save button on the first screen', save() and not save().is_visible())

        # 2. a tile's tab: the button after "Open a tile file"
        page.fill('.addr', f'at://{A_HANDLE}/{TILE}/{CJ_RKEY}'); page.press('.addr', 'Enter')
        check('the probe game runs in its tab', wait_for(lambda: inner(), 20))
        check('...and Raku answers its hello (signed out: "ready"), and says it can save, as Cosmic Junkyard', wait_for(lambda: (probe() or '').startswith('status:ready') and 'can-save' in probe(), 10), str(probe()))
        check('on a tile\'s tab the save button shows', wait_for(lambda: save().is_visible(), 5))
        fb, sb = page.query_selector('.bar .file-btn').bounding_box(), save().bounding_box()
        check('...right after "Open a tile file"', 0 <= sb['x'] - (fb['x'] + fb['width']) <= 12, f'{fb} {sb}')
        check('...named "Save this tile as a file"', save().get_attribute('aria-label') == 'Save this tile as a file')
        page.screenshot(path=str(OUT / 'ts1-tile-tab.png'))
        before_blobs = [c for c in calls if 'getBlob' in c]

        # 3. save it
        with page.expect_download() as d: save().click()
        dl = d.value; out = DL / dl.suggested_filename; dl.save_as(out)
        check('a click downloads it, named from the tile: probe-game.tile', dl.suggested_filename == 'probe-game.tile', dl.suggested_filename)
        msg = wait_for(lambda: note() if 'Saved' in note() else None, 10)
        check('the line names the author: "It\'s @thunderbird.cafe\'s tile; it records where it came from."', msg and "It's @thunderbird.cafe's tile; it records where it came from." in msg, msg)
        check('...and says saving runs won\'t work from the file (a game Raku knows, D3)', msg and "Saving runs won't work from the file." in msg, msg)
        after_blobs = [c for c in calls if 'getBlob' in c]
        per = {}
        for c in after_blobs: k = parse_qs(urlparse(c).query)['cid'][0]; per[k] = per.get(k, 0) + 1
        check("no file fetched twice: saving used Raku's kept files", all(v == 1 for v in per.values()), str(per))
        check("the proof was asked of the author's own server, once", sum(1 for c in calls if 'com.atproto.sync.getRecord' in c and CJ_RKEY in c) == 1)
        got = node_read(out)
        check("Raku's reader opens the saved file: page, program, icon", got.get('ok') and got.get('paths') == ['/', '/icon.png', '/probe.js'], str(got)[:300])
        sf = got.get('savedFrom') or {}
        check('...it records where it came from: the address, the author, the version read', sf.get('uri') == f'at://{A}/{TILE}/{CJ_RKEY}' and sf.get('did') == A and sf.get('record', {}).get('$link') == record_cid[CJ_RKEY] and sf.get('savedBy') == 'Raku', str(sf))
        check('...and carries the proof (the commit\'s address)', (sf.get('proof') or {}).get('$link', '').startswith('bafyrei') and (got.get('said') or {}).get('proof') is True, str(sf))
        exp = json.dumps([{'path': p, 'cid': records[CJ_RKEY]['tile']['resources'][p]['src']['ref']['$link'], 'contentType': records[CJ_RKEY]['tile']['resources'][p]['content-type'], 'size': got['sizes'][p]} for p in got['paths']])
        (Path(str(out) + '.json')).write_text(exp)
        robin = Path('/home/claude/interop/robin-reads.mjs')
        if robin.exists():
            rr = subprocess.run(['node', str(robin), str(out)], capture_output=True, text=True, cwd=str(robin.parent))
            # (the probe tile declares no page policy, so only the files are looked at: robin-reads.mjs's PASS needs one)
            check("Robin's CARTileLoader serves every file of it (the proof blocks don't trouble it)", rr.stdout.count(' OK') == 3 and 'WRONG' not in rr.stdout and '/nope 404' in rr.stdout, rr.stdout[-300:] + rr.stderr[-200:])

        # 4. open the saved file: it runs; the game still gets Raku's answer to its hello, never "can-save"
        with page.expect_file_chooser() as fc: page.click('.bar .file-btn')
        fc.value.set_files(str(out))
        check('the saved file opens in a new tab and runs', wait_for(lambda: page.eval_on_selector_all('.tab', 'ts => ts.length') == 2 and inner(), 20))
        check('...the game in it still gets Raku\'s answer to its hello ("ready")', wait_for(lambda: (probe() or '').startswith('status:ready'), 10), str(probe()))
        time.sleep(1)
        check('...but never "can-save" (saving waits for 2b)', 'can-save' not in (probe() or ''), str(probe()))
        check('...it says "author not verified"', 'author not verified' in (page.inner_text('.pane.front .file-hint') if page.query_selector('.pane.front .file-hint') else ''))
        check('...and there\'s no save button on a file\'s tab', not save().is_visible())

        # 5. a tile with ways: the note says so
        page.click('.newtab'); page.fill('.addr', f'at://{A}/{TILE}/3mzwaystile'); page.press('.addr', 'Enter')
        wait_for(lambda: inner() and save().is_visible(), 20)
        with page.expect_download() as d: save().click()
        msg = wait_for(lambda: note() if 'Saved' in note() else None, 10)
        check('a tile with ways: "Its ways to other places won\'t work from the file."', msg and "Its ways to other places won't work from the file." in msg and 'Saving runs' not in msg, msg)

        # 6. a server whose file doesn't match its address: nothing saved
        page.click('.newtab'); page.fill('.addr', f'at://{A}/{TILE}/3mzbadfile'); page.press('.addr', 'Enter')
        wait_for(lambda: inner() and save().is_visible(), 20)
        downloads = []
        page.on('download', lambda dd: downloads.append(dd))
        save().click()
        msg = wait_for(lambda: note() if "Couldn't save" in note() else None, 10)
        check("a file that doesn't match its address: not saved, said plainly", msg and "didn't match its address" in msg, note())
        time.sleep(1)
        check('...and nothing downloaded', not downloads)

        # 7. a server without the proof: saved without it
        page.click('.newtab'); page.fill('.addr', f'at://{A}/{TILE}/3mznoproof'); page.press('.addr', 'Enter')
        wait_for(lambda: inner() and save().is_visible(), 20)
        with page.expect_download() as d: save().click()
        out2 = DL / 'noproof.tile'; d.value.save_as(out2)
        got2 = node_read(out2)
        check('no proof from the server: still saved, and opens; it just has none', got2.get('ok') and 'proof' not in (got2.get('savedFrom') or {}) and (got2.get('said') or {}).get('proof') is False, str(got2)[:300])

        # 8. the phone: both buttons after the address box
        ph = b.new_context(viewport={'width': 390, 'height': 780}, is_mobile=True, has_touch=True, color_scheme='light', accept_downloads=True)
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://cdn.bsky.app/**', 'https://rpg.actor/**']:
            ph.route(host, route)
        pp = ph.new_page(); POKE['page'] = pp
        pp.goto(RAKU + '?loader=' + LOADER + '#t=' + f'at%3A%2F%2F{A}%2Fing.dasl.masl%2F{CJ_RKEY}&a=0'); pp.wait_for_selector('.addr')
        wait_for(lambda: pp.query_selector('.bar .save-file-btn').is_visible(), 20)
        a_, o_, s_ = (pp.query_selector(x).bounding_box() for x in ('.addr-form', '.bar .file-btn', '.bar .save-file-btn'))
        check('phone: open then save, after the address box, in the top row, thumb-sized', a_['x'] + a_['width'] <= o_['x'] < s_['x'] and s_['y'] < 60 and s_['height'] >= 36, f'{a_} {o_} {s_}')
        check('phone: the address box still over 170 px wide', a_['width'] > 170, str(a_['width']))
        with pp.expect_download() as d: pp.tap('.bar .save-file-btn')
        check('phone: saving works there too', d.value.suggested_filename == 'probe-game.tile')
        pp.screenshot(path=str(OUT / 'ts2-phone.png'))
        check('no errors on the page', not errors, str(errors[:3]))
        b.close()
finally:
    servers.terminate(); replica.terminate()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} of {len(results)} passed" + (f"; failed: {failed}" if failed else ''))
sys.exit(1 if failed else 0)
