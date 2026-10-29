# Raku stage 9 browser checks: Raku as an installable web app (claude/raku-stage9-plan.md), in the chat sandbox.
# The manifest as Chromium reads it, the app icons, no service worker in an ordinary tab, the worker when Raku
# runs installed (display-mode: standalone, emulated), its ground rule (only Raku's own page goes through it),
# the offline page and coming back online, the update note (and the one start-up reload, never a loop), the
# "Install Raku" row in the account menu, the About page's Install section, the phone width.
# Everything outside Raku is a Playwright route answering 404, so nothing here reaches the internet.
# Usage: python3 test/browser/check_app.py <work folder>
#        (servers.mjs and the replica already running; the bundle made with --define:__RAKU_BUILD__='"test-1"')
import json, re, sys, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
OVERRIDE = W / 'override'; OVERRIDE.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
VERSION = OVERRIDE / 'version.json'
NOTE = 'A new version of Raku is ready. Your tabs come back after a reload, but tiles and games that are running start over.'

results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or not detail else f'  [{detail}]'))
    sys.stdout.flush()
def wait_for(fn, secs=8):
    end = time.time() + secs
    while time.time() < end:
        try:
            if fn(): return True
        except Exception:
            pass
        time.sleep(0.15)
    return False
def settle(page, secs):
    # Playwright passes on a page's events (here: page loads) only while the script is calling it, so wait by calling.
    end = time.time() + secs
    while time.time() < end:
        try: page.evaluate('1')
        except Exception: pass
        time.sleep(0.2)
def set_version(build):
    if build is None:
        VERSION.unlink(missing_ok=True)
    else:
        VERSION.write_text(json.dumps({'build': build}))

def outside(route):
    # Nothing outside Raku is reachable: every other server answers 404 (with CORS, so pages see a plain "no").
    u = urlparse(route.request.url)
    if u.hostname in ('127.0.0.1',) or (u.hostname or '').endswith('localhost'):
        return route.continue_()
    route.fulfill(status=404, headers={'access-control-allow-origin': '*', 'content-type': 'application/json'}, body='{}')

WATCH = """
  window.__csp = [];
  addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
"""
STANDALONE = """
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
"""
FAKE_OFFER = """() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}"""

set_version(None)
with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------------- an ordinary tab ----------------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
    ctx.route('**/*', outside)
    ctx.add_init_script(WATCH)
    page = ctx.new_page()
    navs = []
    page.on('load', lambda _p: navs.append(page.url))      # full page loads only (not the address's #tabs changing)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(RAKU)
    page.wait_for_selector('.first', timeout=10000)

    check('the page links its manifest', page.eval_on_selector('link[rel=manifest]', 'l => l.getAttribute("href")') == '/manifest.webmanifest')
    cdp = ctx.new_cdp_session(page)
    man = cdp.send('Page.getAppManifest')
    check('Chromium reads the manifest with no errors', man.get('url', '').endswith('/manifest.webmanifest') and man.get('errors') == [], str(man.get('errors')))
    data = json.loads(man.get('data') or '{}')
    check('...name Raku, its own window, start and scope at Raku\'s address', data.get('name') == 'Raku' and data.get('display') == 'standalone' and data.get('start_url') == '/' and data.get('scope') == '/')
    icon_ok = []
    for i in data.get('icons', []):
        r = page.request.get(RAKU.rstrip('/') + i['src'])
        icon_ok.append(r.ok and r.headers.get('content-type') == 'image/png')
    check('...its four icons are served as PNGs', len(icon_ok) == 4 and all(icon_ok), str(icon_ok))
    svg = page.request.get(RAKU + 'icon.svg').text()
    check('the favicon is the pot alone (no tile), with both cracks', '<rect' not in svg and 'M22 30l6 6-3 7M38 27l-4 8 7 5' in svg)
    check('in an ordinary tab no service worker is registered', wait_for(lambda: page.evaluate('navigator.serviceWorker.getRegistrations().then(r => r.length)') == 0, 2) and (time.sleep(2) or page.evaluate('navigator.serviceWorker.getRegistrations().then(r => r.length)') == 0))
    pot = page.evaluate("(() => { const b = document.querySelector('.strip-row .brand'); const i = b.querySelector('img.brand-pot'); if (!i) return null; const r = i.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(b); const t = [...b.childNodes].find(n => n.nodeType === 3); const tr = document.createRange(); tr.selectNodeContents(t); const tb = tr.getBoundingClientRect(); return { w: r.width, h: r.height, loaded: i.complete && i.naturalWidth > 0, left: r.right <= tb.left + 0.5, mid: Math.abs((r.top + r.bottom) / 2 - (tb.top + tb.bottom) / 2), text: t.textContent, alt: i.alt }; })()")
    check('the pot sits just left of the Raku label (S8), drawn, 18 px, level with the word', pot and pot['loaded'] and pot['w'] == 18 and pot['left'] and pot['mid'] <= 3 and pot['text'] == 'Raku' and pot['alt'] == '', str(pot))
    check("Raku's policy allows the worker and the manifest", "worker-src 'self'" in page.eval_on_selector('meta[http-equiv="Content-Security-Policy"]', 'm => m.content'))

    # the update rule, while open (past the start-up window)
    time.sleep(5.5)
    page.route('**/version.json', lambda r: r.fulfill(status=503, body='down'))
    check('version.json not answering: no note', page.evaluate('__raku.updates.check()') == 'unknown' and page.is_hidden('.update-line'))
    page.unroute('**/version.json')
    set_version('test-1')
    check('the same version: no note', page.evaluate('__raku.updates.check()') == 'same' and page.is_hidden('.update-line'))
    set_version('test-2')
    n0 = len(navs)
    check('a newer version while open: a note, not a reload', page.evaluate('__raku.updates.check()') == 'newer' and wait_for(lambda: page.is_visible('.update-line'), 3))
    check('...the agreed words', page.inner_text('.update-text') == NOTE, page.inner_text('.update-text'))
    check('...Reload and a close button', page.is_visible('.update-reload') and page.inner_text('.update-reload') == 'Reload' and page.is_visible('.update-close') and page.get_attribute('.update-close', 'aria-label') == 'Hide this note')
    page.screenshot(path=str(OUT / 'app-note.png'))
    settle(page, 3)
    check('...nothing reloads by itself (S2: never interrupt)', len(navs) == n0 and page.is_visible('.update-line'))
    page.click('.update-close')
    check('× hides the note', page.is_hidden('.update-line'))
    page.evaluate('__raku.updates.check()')
    check('...and it stays hidden for that version', (time.sleep(0.5) or True) and page.is_hidden('.update-line'))
    set_version('test-3')
    page.evaluate('__raku.updates.check()')
    check('...a newer version shows it again', wait_for(lambda: page.is_visible('.update-line'), 3))
    page.evaluate("location.hash = '#t=raku%3Aabout&a=0'")
    page.wait_for_selector('.about h1', timeout=5000)
    n1 = len(navs)
    page.click('.update-reload')
    # the clicked reload, then (this test page is still "test-1") exactly one start-up reload for test-3, then the note
    check('Reload reloads; the stale copy reloads once more on start, then shows the note (never a loop)',
          wait_for(lambda: (settle(page, 0.3) or True) and len(navs) >= n1 + 2 and page.is_visible('.update-line'), 12) and (settle(page, 3) or True) and len(navs) == n1 + 2, f'{len(navs) - n1} loads')
    check('...the tabs came back (the About tab)', wait_for(lambda: page.is_visible('.about h1'), 5) and '#t=raku%3Aabout' in page.url)

    # the About page's Install section
    about = page.inner_text('.about')
    check("About: an Install Raku section with each browser's steps", 'INSTALL RAKU' in about.upper() and all(w in about for w in ['Chrome or Edge', 'iPhone or iPad', 'Safari on a Mac', 'Firefox']))
    check('...the iPhone heads-up about its own shelf', 'keeps its own shelf and sign-ins, separate from Safari’s' in about)
    check('...what installed Raku keeps', 'never tiles or anything you open' in about and 'If you install Raku: its “Raku needs the internet” screen' in about)

    # the install row
    page.click('.account-btn')
    page.wait_for_selector('.account-menu:not([hidden])')
    check('no install offer from the browser: no Install row', page.query_selector('.acct-install') is None)
    page.keyboard.press('Escape')
    check('the browser offers installing: Raku keeps the offer for its menu (no browser mini-bar)', page.evaluate(FAKE_OFFER) is True)
    page.click('.account-btn')
    page.wait_for_selector('.acct-install', timeout=3000)
    check('...the menu shows "Install Raku: its own window and icon", just above About', page.inner_text('.acct-install') == 'Install Raku: its own window and icon'
          and page.evaluate("document.querySelector('.acct-install').nextElementSibling.classList.contains('acct-about')") and page.query_selector('.acct-install svg.icon-install') is not None)
    page.screenshot(path=str(OUT / 'app-menu.png'))
    page.click('.acct-install')
    check("...it opens the browser's own install box", wait_for(lambda: page.evaluate('window.__prompted') == 1, 3))
    check('...installed: the menu closes and says so', page.is_hidden('.account-menu') and wait_for(lambda: 'Raku is installed' in page.inner_text('.note'), 3))
    page.click('.account-btn')
    check('...and the row is gone (each offer is used once)', (time.sleep(0.3) or True) and page.query_selector('.acct-install') is None)
    page.keyboard.press('Escape')
    page.evaluate(FAKE_OFFER)
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
    page.click('.account-btn')
    check('appinstalled: no row', (time.sleep(0.3) or True) and page.query_selector('.acct-install') is None)
    page.keyboard.press('Escape')

    # the phone
    page.set_viewport_size({'width': 390, 'height': 800})
    time.sleep(0.4)
    small = page.evaluate("(() => { const i = document.querySelector('.bar .brand-small img.brand-pot'); if (!i) return null; const r = i.getBoundingClientRect(); return { w: r.width, shown: r.width > 0 && getComputedStyle(i).visibility !== 'hidden', loaded: i.naturalWidth > 0 }; })()")
    check('phone: the pot beside the small Raku label too', small and small['shown'] and small['loaded'] and small['w'] == 16, str(small))
    check('phone: the note wraps, no sideways scroll', page.is_visible('.update-line') and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    check('phone: Reload stays a real target', page.evaluate("document.querySelector('.update-reload').getBoundingClientRect().height") >= 30)
    page.screenshot(path=str(OUT / 'app-note-phone.png'))
    check('tab: no errors, and the page policy refused nothing', not errors and page.evaluate('window.__csp') == [], f'{errors} {page.evaluate("window.__csp")}')
    ctx.close()

    # ---------------- installed ----------------
    set_version('test-1')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 760})
    ctx.route('**/*', outside)
    ctx.add_init_script(WATCH)
    ctx.add_init_script(STANDALONE)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(RAKU + '#t=raku%3Aabout&a=0')
    page.wait_for_selector('.about h1', timeout=10000)
    reg = page.evaluate("navigator.serviceWorker.ready.then(r => ({ scope: r.scope, url: r.active && r.active.scriptURL, via: r.updateViaCache }))")
    check("installed: the worker is registered for Raku's address", reg['scope'] == RAKU and reg['url'] == RAKU + 'sw.js', str(reg))
    check('...asking the network for sw.js itself each time (updateViaCache none)', reg['via'] == 'none')
    page.reload()
    page.wait_for_selector('.about h1', timeout=10000)
    check('...and it looks after the page once reloaded', page.evaluate('!!navigator.serviceWorker.controller'))
    kept = page.evaluate("caches.keys().then(async (ks) => Promise.all(ks.map(async (k) => [k, (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname)])))")
    check('...it keeps only the offline page', kept == [['raku-offline-v1', ['/offline.html']]], str(kept))

    # the ground rule: only the navigation goes through the worker
    with page.expect_response(lambda r: r.url.endswith('/version.json')) as vr:
        page.evaluate('__raku.updates.check()')
    with page.expect_response(lambda r: 'plc.directory' in r.url) as pr:
        page.evaluate("fetch('https://plc.directory/did:plc:aaaa').catch(() => {})")
    with page.expect_response(lambda r: r.url.rstrip('/') == RAKU.rstrip('/') or r.url.startswith(RAKU + '#')) as nav:
        page.reload()
    page.wait_for_selector('.about h1', timeout=10000)
    script = page.request.get(page.eval_on_selector('script[type=module]', 's => s.src'))
    check("ground rule: opening Raku goes through the worker (network first)", nav.value.from_service_worker)
    check("...version.json doesn't", not vr.value.from_service_worker)
    check("...nor another server (plc.directory here)", not pr.value.from_service_worker)
    kept2 = page.evaluate("caches.keys().then(async (ks) => Promise.all(ks.map(async (k) => [k, (await (await caches.open(k)).keys()).length])))")
    check('...and still nothing else kept after using Raku', kept2 == [['raku-offline-v1', 1]], str(kept2))

    # no install offer when installed
    page.evaluate(FAKE_OFFER)
    page.click('.account-btn')
    check('installed: never an Install row', (time.sleep(0.3) or True) and page.query_selector('.acct-install') is None)
    page.keyboard.press('Escape')
    check('installed: no errors, and the page policy refused nothing', not errors and page.evaluate('window.__csp') == [], f'{errors} {page.evaluate("window.__csp")}')

    # the tabs in the title bar (S7: window controls overlay). Headless Chromium can't fold a title bar away, so this
    # context gives the page a stand-in navigator.windowControlsOverlay (visible, as Chrome's is in that mode); the
    # browser's title-bar measurements then fall back as written in style.css.
    check('...and the manifest asks for the tabs in the title bar', page.request.get(RAKU + 'manifest.webmanifest').json().get('display_override') == ['window-controls-overlay'])
    check('...not in an ordinary installed window: no grip, no drag region', page.is_hidden('.wco-grip') and page.evaluate("getComputedStyle(document.querySelector('.strip-row')).webkitAppRegion") in ('none', ''))
    wctx = browser.new_context(viewport={'width': 1000, 'height': 700})
    wctx.route('**/*', outside)
    wctx.add_init_script(WATCH)
    wctx.add_init_script(STANDALONE)
    wctx.add_init_script("""
      const overlay = new EventTarget(); overlay.visible = true;
      overlay.getTitlebarAreaRect = () => new DOMRect(0, 0, innerWidth - 140, 33);
      Object.defineProperty(navigator, 'windowControlsOverlay', { value: overlay });
      window.__overlay = overlay;
    """)
    wp = wctx.new_page()
    wp.goto(RAKU)
    wp.wait_for_selector('.first', timeout=10000)
    check('title-bar mode: Raku knows (the class on the page)', wp.evaluate("document.documentElement.classList.contains('wco')"))
    region = lambda sel: wp.evaluate(f"getComputedStyle(document.querySelector('{sel}')).webkitAppRegion")
    check('title-bar mode: the tab row is the place to grab the window', region('.strip-row') == 'drag')
    check('...the tabs, + and a tab\'s × still click (not part of it)', region('.strip-row .tab') == 'no-drag' and region('.strip-row .newtab') == 'no-drag' and region('.strip-row .tab-x') == 'no-drag')
    check('...the Raku label is part of it (a handle that never moves)', wp.evaluate("getComputedStyle(document.querySelector('.strip-row .brand')).webkitAppRegion") in ('none', '', 'drag') and wp.evaluate("document.querySelector('.strip-row .brand').closest('.strip-row') !== null"))
    check('...the address bar is not', region('.bar') in ('none', ''))
    check('...the pot is part of the handle too (not a click target)', wp.evaluate("getComputedStyle(document.querySelector('.strip-row .brand-pot')).webkitAppRegion") in ('none', '', 'drag') and wp.evaluate("document.querySelector('.strip-row .brand-pot').draggable") is False)
    grip = lambda: wp.evaluate("(() => { const g = document.querySelector('.wco-grip').getBoundingClientRect(); const r = document.querySelector('.strip-row').getBoundingClientRect(); return { w: g.width, right: g.right, rowRight: r.right, h: r.height }; })()")
    g = grip()
    check('...the free grip after + is there, at least 40 px', g['w'] >= 40 and g['right'] <= g['rowRight'] + 0.5, str(g))
    check('...the row fits a title bar', g['h'] <= 40, str(g))
    wp.screenshot(path=str(OUT / 'app-titlebar.png'), clip={'x': 0, 'y': 0, 'width': 1000, 'height': 120})
    for _ in range(12):
        if wp.is_disabled('.newtab'): break
        wp.click('.newtab')
    g = grip()
    n = wp.evaluate("document.querySelectorAll('.strip-row .tab').length")
    check(f'...with every tab open ({n}), the grip keeps its 40 px and nothing runs past the row', n >= 8 and g['w'] >= 40 and g['right'] <= g['rowRight'] + 0.5
          and wp.evaluate("[...document.querySelectorAll('.strip-row .tab')].every(t => t.getBoundingClientRect().right <= document.querySelector('.wco-grip').getBoundingClientRect().left + 0.5)"), str(g))
    wp.click('.strip-row .tab >> nth=1')
    check('...a tab still opens when clicked', wp.evaluate("document.querySelectorAll('.strip-row .tab')[1].classList.contains('on')"))
    wp.screenshot(path=str(OUT / 'app-titlebar-full.png'), clip={'x': 0, 'y': 0, 'width': 1000, 'height': 120})
    wp.evaluate("window.__overlay.visible = false; window.__overlay.dispatchEvent(new Event('geometrychange'))")
    check('the title bar back (the browser\'s own button): the ordinary layout again', not wp.evaluate("document.documentElement.classList.contains('wco')") and wp.is_hidden('.wco-grip')
          and wp.evaluate("getComputedStyle(document.querySelector('.strip-row')).webkitAppRegion") in ('none', ''))
    check('title-bar mode: the page policy refused nothing', wp.evaluate('window.__csp') == [], str(wp.evaluate('window.__csp')))
    wctx.close()

    # offline
    ctx.set_offline(True)
    page.reload()
    check('offline: Raku\'s own page, "Raku needs the internet"', wait_for(lambda: page.inner_text('h1') == 'Raku needs the internet', 8))
    check('...with the agreed words and Try now', 'Raku will carry on by itself when you’re back online.' in page.inner_text('body') and page.inner_text('#again') == 'Try now')
    check('...the address (your tabs) kept', '#t=raku%3Aabout&a=0' in page.url, page.url)
    check('...its own policy refused nothing (style and script by hash)', page.evaluate('window.__csp') == [], str(page.evaluate('window.__csp')))
    check('...dark like Raku', page.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(23, 20, 17)')
    page.screenshot(path=str(OUT / 'app-offline.png'))
    page.click('#again')
    check('Try now while still offline: the same page', (time.sleep(1) or True) and wait_for(lambda: page.inner_text('h1') == 'Raku needs the internet', 5))
    page.set_viewport_size({'width': 390, 'height': 760})
    check('offline, phone: no sideways scroll', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.screenshot(path=str(OUT / 'app-offline-phone.png'))
    ctx.set_offline(False)
    check('back online: Raku carries on by itself, tabs and all', wait_for(lambda: page.query_selector('.about h1') is not None, 20))
    check('...no errors', not errors, str(errors))
    ctx.close()
    browser.close()

set_version(None)
print(f'\n{sum(results)} passed, {len(results) - sum(results)} failed')
sys.exit(0 if all(results) else 1)
