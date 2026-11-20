# Tile files in a browser (claude/tile-files-plan.md, part 1): a .tile file opened with the button beside the address
# box, with Ctrl+O and by dropping it on Raku, runs in a tab through a replica of the tile loading server, its files from
# the file (nothing fetched for it); the note "Opened from a file · author not verified"; no star and no Post on its tab;
# the file read in a worker; a changed file and a file that isn't a tile refused with a note and no tab; after a reload
# the tab says to open the file again; the button on a phone.
#
# It sets everything up itself: a copy of this Raku folder bundled with esbuild and the stand-in sign-in (and the
# reader's worker beside it, as Vite builds it), then servers.mjs and loader-replica.mjs.
# Usage: python3 test/browser/check_tile_files.py <work folder> <tiles-loading-server folder> <a .tile file> [--break=hash|drop]
#   (the .tile file: one saved by the Web Tile Foundry's "Save as .tile", e.g. a Glass Lantern; --break builds a copy
#   with one safeguard removed, to show the check catches it)
#   (needs Playwright with Chromium, esbuild (NODE_PATH or /opt/npm-tools), node_modules with @dasl/tile-loader and
#   rooms-lab, and port 80 free for the loader replica)
import base64, os, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1]).resolve(); W.mkdir(parents=True, exist_ok=True)
LOADING_SERVER = Path(sys.argv[2]).resolve()
TILE_FILE = Path(sys.argv[3]).resolve()
BREAK = next((a.split('=', 1)[1] for a in sys.argv[4:] if a.startswith('--break=')), None)
RAKU_SRC = Path(__file__).resolve().parents[2]
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
LOADER = 'http://load.tiles.lex.localhost/.well-known/web-tiles/'

GOOD = TILE_FILE.read_bytes()
BAD = bytearray(GOOD); BAD[-40] ^= 0xFF; BAD = bytes(BAD)          # one byte changed inside the last file
(W / 'changed.tile').write_bytes(BAD)
(W / 'notes.txt').write_bytes(b'Just some notes, not a tile.\n')

# ---- a copy of Raku, bundled ----
COPY = W / 'raku'
if COPY.exists(): shutil.rmtree(COPY)
shutil.copytree(RAKU_SRC, COPY, ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'shots'), symlinks=True)
os.symlink(RAKU_SRC / 'node_modules', COPY / 'node_modules')
if BREAK == 'hash':
    p = COPY / 'src' / 'tile-file.js'; s = p.read_text()
    s2 = s.replace('for (let i = 0; i < SHA256_LEN; i++) if (got[i] !== digest[i]) refuse', 'for (let i = 0; i < 0; i++) if (got[i] !== digest[i]) refuse')
    assert s2 != s; p.write_text(s2)
if BREAK == 'drop':
    p = COPY / 'src' / 'app.js'; s = p.read_text()
    s2 = s.replace("if (f) openTileFile(f);\n  });", "void f;\n  });")
    assert s2 != s; p.write_text(s2)
site = W / 'site' / 'assets'
if site.exists(): shutil.rmtree(site)
site.mkdir(parents=True)
esbuild = shutil.which('esbuild') or '/opt/npm-tools/node_modules/.bin/esbuild'
env = {**os.environ, 'NODE_PATH': f"{RAKU_SRC / 'node_modules'}:/opt/npm-tools/node_modules"}
subprocess.run([esbuild, str(COPY / 'src' / 'main.js'), '--bundle', '--format=esm', f'--outdir={site}', '--log-level=error',
                f'--alias:@atproto/oauth-client-browser={COPY / "test" / "browser" / "oauth-standin.js"}', "--define:__RAKU_BUILD__=\"test-1\""],
               check=True, env=env, cwd=str(COPY))
# The reader's worker, where the page asks for it (new URL('./tile-file-worker.js', import.meta.url) beside main.js).
subprocess.run([esbuild, str(COPY / 'src' / 'tile-file-worker.js'), '--bundle', '--format=esm', f'--outfile={site / "tile-file-worker.js"}', '--log-level=error'],
               check=True, env=env, cwd=str(COPY))
servers = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'servers.mjs'), str(W), str(COPY)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
replica = subprocess.Popen(['node', str(COPY / 'test' / 'browser' / 'loader-replica.mjs'), str(LOADING_SERVER)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)

calls = []
def route(r):
    calls.append(r.request.url)
    r.fulfill(status=404, headers={'access-control-allow-origin': '*'}, body='')

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

def drop_js(name, data):
    b64 = base64.b64encode(data).decode()
    return '''([name, b64]) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], name, { type: '' }));
      const root = document.getElementById('raku');
      const at = document.querySelector('.stage') || root;
      at.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      at.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const covered = root.classList.contains('dropping-file');
      at.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { covered, after: root.classList.contains('dropping-file') };
    }''', [name, b64]

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--host-resolver-rules=MAP *.localhost 127.0.0.1', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='dark')
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://*.bsky.network/**', 'https://pds.fakepds.net/**', 'https://lexicographer.space/**',
                     'https://cdn.bsky.app/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://*.host.bsky.network/**', 'https://bsky.social/**']:
            ctx.route(host, route)
        page = ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        POKE['page'] = page
        page.goto(RAKU + '?loader=' + LOADER)
        page.wait_for_selector('.addr')

        def inner():
            for f in page.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url:
                    if f.parent_frame.parent_frame == page.main_frame and f.parent_frame.frame_element().evaluate('e => e.closest(".pane").classList.contains("front")'):
                        return f
            return None
        def tab_count(): return page.eval_on_selector_all('.tab', 'ts => ts.length')
        def note(): return page.eval_on_selector('.note', 'n => n.hidden ? "" : n.textContent')

        # 1. the button, beside the address box
        btn = page.query_selector('.bar .file-btn')
        check('a button beside the address box', btn and btn.is_visible())
        fb, ab = btn.bounding_box(), page.query_selector('.addr-form').bounding_box()
        check('...just to the right of the address box', 0 <= fb['x'] - (ab['x'] + ab['width']) <= 16, f"{fb} {ab}")
        check('...named "Open a tile file", Ctrl+O in its tooltip', btn.get_attribute('aria-label') == 'Open a tile file' and 'Ctrl+O' in (btn.get_attribute('title') or ''))

        # 2. open with the button: the file chooser, then the tile in this (empty) tab
        before = len(calls)
        with page.expect_file_chooser() as fc: btn.click()
        fc.value.set_files(str(TILE_FILE))
        f = wait_for(lambda: inner(), 20)
        check('the tile runs on its own random name under the loading server', f)
        check('...in this tab (it was empty), one tab still', tab_count() == 1, str(tab_count()))
        check('...its page is the lantern: its program and config arrived from the file',
              wait_for(lambda: inner().evaluate('() => !!document.getElementById("lantern-config") && !!document.querySelector("script[src=\'/lantern.js\']")'), 10))
        check('...and the program ran (a canvas is drawn)', wait_for(lambda: inner().evaluate('() => !!document.querySelector("canvas")'), 20))
        title = page.eval_on_selector('.tab.on .tab-title', 'e => e.textContent')
        check("the tab is named after the tile", 'glass lantern' in title.lower(), title)
        check('the address box shows the file name', page.input_value('.addr') == TILE_FILE.name, page.input_value('.addr'))
        check('the tab has the tile\'s own icon, from the file', wait_for(lambda: page.query_selector('.tab.on img.tab-icon'), 5))
        hint = page.query_selector('.pane.front .file-hint')
        check('the note: "Opened from a file (name) · author not verified"', hint and re.search(r'Opened from a file \(.*\.tile\) · author not verified', hint.inner_text()), hint and hint.inner_text())
        check('no star and no Post on a file\'s tab', page.eval_on_selector('.star-btn', 'e => e.hidden') and page.eval_on_selector('.post-btn', 'e => e.hidden'))
        fetched = [u for u in calls[before:] if 'getBlob' in u or 'getRecord' in u or 'plc.directory' in u]
        check('nothing about the tile was fetched from any account server', not fetched, str(fetched[:3]))
        check('the file was read in a worker', page.evaluate('() => performance.getEntriesByType("resource").some((e) => e.name.endsWith("/assets/tile-file-worker.js"))'))
        page.screenshot(path=str(OUT / 'tf1-opened.png'))
        hint.query_selector('.table-hint-x').click()
        check('the note can be put away', not page.query_selector('.pane.front .file-hint'))

        # 3. Ctrl+O: another chooser; a second file opens in a new tab (this one has a tile)
        page.evaluate('() => document.activeElement && document.activeElement.blur()')
        with page.expect_file_chooser() as fc: page.keyboard.press('Control+o')
        fc.value.set_files(str(TILE_FILE))
        check('Ctrl+O opens the picker; the file opens in a new tab', wait_for(lambda: tab_count() == 2, 10), str(tab_count()))
        check('...and runs there too', wait_for(lambda: inner(), 20))

        # 4. dropped on Raku (over the running tile: the cover takes the drop)
        got = page.evaluate(*drop_js(TILE_FILE.name, GOOD))
        check('while a file is dragged over Raku, the cover is up; it goes on the drop', got['covered'] and not got['after'], str(got))
        check('a dropped file opens in a new tab and runs', wait_for(lambda: tab_count() == 3, 10) and wait_for(lambda: inner(), 20), str(tab_count()))

        # 5. a changed file: refused, a note, no tab
        n = tab_count()
        page.evaluate(*drop_js('changed.tile', BAD))
        msg = wait_for(lambda: note() if "Couldn't open" in note() else None, 10)
        check('a changed file is refused: "doesn\'t match its address"', msg and "doesn't match its address" in msg, note())
        check('...and opens no tab', tab_count() == n, str(tab_count()))
        # 6. a file that isn't a tile
        page.evaluate(*drop_js('notes.txt', (W / 'notes.txt').read_bytes()))
        msg = wait_for(lambda: note() if "Couldn't open" in note() and 'notes.txt' in note() else None, 10)
        check('a file that isn\'t a tile: a plain note, no tab', msg and tab_count() == n, note())

        # 7. after a reload: the file tabs stay, saying to open the file again
        page.reload(); page.wait_for_selector('.addr')
        check('after a reload the tabs are still there', wait_for(lambda: tab_count() == n, 5), str(tab_count()))
        gone = wait_for(lambda: page.query_selector('.pane.front .tile-status[data-kind="file-gone"]'), 5)
        check('...a file\'s tab says to open the file again, with the button', gone and 'open the file again' in gone.inner_text() and gone.query_selector('button.primary'))
        page.screenshot(path=str(OUT / 'tf2-after-reload.png'))
        with page.expect_file_chooser() as fc: gone.query_selector('button.primary').click()
        fc.value.set_files(str(TILE_FILE))
        check('...and its button opens the picker again', wait_for(lambda: inner(), 20))

        # 8. on a phone
        ph = b.new_context(viewport={'width': 390, 'height': 780}, is_mobile=True, has_touch=True, color_scheme='light')
        for host in ['https://plc.directory/**', 'https://public.api.bsky.app/**', 'https://lexicographer.space/**', 'https://appmosphe.re/**', 'https://typeahead.waow.tech/**', 'https://cdn.bsky.app/**']:
            ph.route(host, route)
        pp = ph.new_page(); POKE['page'] = pp
        pp.goto(RAKU + '?loader=' + LOADER); pp.wait_for_selector('.addr')
        pb = pp.query_selector('.bar .file-btn')
        box = pb.bounding_box() if pb else None
        check('on a phone the button is in the top row, thumb-sized', pb and pb.is_visible() and box['height'] >= 36 and box['y'] < 60, str(box))
        pa = pp.query_selector('.addr-form').bounding_box()
        check('...right after the address box, as on a computer', box['x'] >= pa['x'] + pa['width'] - 1, f"{box} {pa}")
        with pp.expect_file_chooser() as fc: pb.tap()
        fc.value.set_files(str(TILE_FILE))
        def inner_p():
            for f in pp.frames:
                if f.url.endswith('.tiles.lex.localhost/') and f.parent_frame and '.tiles.lex.localhost' in f.parent_frame.url: return f
        check('...and the tile opens and runs there', wait_for(lambda: inner_p(), 20))
        pp.screenshot(path=str(OUT / 'tf3-phone.png'))
        # (expected: the stand-ins' 404s for the first screen's picks and the like, and the loading server's own policy
        # naming form-src, which browsers don't know: claude/tile-loading-findings.md)
        real = [e for e in errors if 'Failed to load resource' not in e and "directive 'form-src'" not in e]
        check('no errors on the page', not real, str(real[:4]))
        b.close()
finally:
    servers.terminate(); replica.terminate()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} of {len(results)} passed" + (f"; failed: {failed}" if failed else ''))
sys.exit(1 if failed else 0)
