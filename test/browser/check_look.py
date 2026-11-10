# Raku's light mode, the second push (claude/raku-light-mode-plan.md, LM1 to LM17), in the chat sandbox: the look follows
# the device (and changes with it), the Look row and the Light style row in the account menu, the choice remembered and
# on the page before the first paint (public/look.js, with Raku's own script held back), Smoke and clay's dark top bar
# with its menu light, the bowl's colours, the phone width, the offline page, the theme-color lines, and no refusals by
# the page policy. Everything outside Raku is a Playwright route answering 404.
# Usage: python3 test/browser/check_look.py <work folder>   (servers.mjs already running)
import re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

W = Path(sys.argv[1])
OUT = W / 'shots'; OUT.mkdir(exist_ok=True)
RAKU = 'http://127.0.0.1:5180/'
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
def hexrgb(h): return f'rgb({int(h[1:3], 16)}, {int(h[3:5], 16)}, {int(h[5:7], 16)})'

# the page's own colours for each look (src/style.css): the stage behind everything, the strip behind the tabs
STAGE = {'dark': '#171411', 'clear': '#f4f4f3', 'bisque': '#ece5d9', 'porcelain': '#eceef1', 'celadon': '#e8edeb', 'washi': '#f5f0e2', 'smoke': '#efebe7'}
KILN = {'dark': '#26211d', 'clear': '#e7e6e4', 'bisque': '#e4dccf', 'porcelain': '#dee1e6', 'celadon': '#dae2de', 'washi': '#efe6cf', 'smoke': '#26211d'}
NAMES = {'bisque': 'Bisque', 'porcelain': 'Porcelain', 'celadon': 'Celadon', 'washi': 'Washi', 'smoke': 'Smoke and clay', 'clear': 'Clear'}
COLLECT = """window.__refused = []; document.addEventListener('securitypolicyviolation', (e) => window.__refused.push(e.violatedDirective + ' ' + e.blockedURI));"""

def state(page):
    return page.evaluate("""() => ({ look: document.documentElement.dataset.look, light: document.documentElement.dataset.light,
      stage: getComputedStyle(document.body).backgroundColor, kiln: document.querySelector('.chrome') ? getComputedStyle(document.querySelector('.chrome')).backgroundColor : null,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
      meta: document.querySelector('meta[name="color-scheme"]').content })""")

def new_page(browser, scheme='dark', width=1280, height=820, saved=None):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=scheme)
    ctx.route(re.compile(r'^https?://(?!127\.0\.0\.1:5180/).*'), lambda r: r.fulfill(status=404, body=''))
    ctx.add_init_script(COLLECT)
    if saved:
        # only into an empty browser, so a choice made on the page survives a reload
        ctx.add_init_script('try {' + ''.join(f"if (localStorage.getItem({k!r}) === null) localStorage.setItem({k!r}, {v!r});" for k, v in saved.items()) + '} catch (e) {}')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, page, errors

def label(page):   # "Light style: <name>" as read on screen (the palette bar between them has no words)
    return ' '.join(page.locator('.acct-style-words').inner_text().split())

def open_menu(page):
    if page.locator('.account-menu').is_hidden(): page.click('.account-btn')
    page.wait_for_selector('.account-menu .acct-look')

with sync_playwright() as p:
    browser = p.chromium.launch()

    # 1. A dark device, nothing chosen: Raku is dark, exactly as before; the menu offers Match device, Light, Dark.
    ctx, page, errors = new_page(browser, 'dark')
    page.goto(RAKU); page.wait_for_selector('.chrome .brand')
    s = state(page)
    check('dark device, nothing saved: dark look', s['look'] == 'dark' and s['stage'] == hexrgb(STAGE['dark']) and s['kiln'] == hexrgb(KILN['dark']), s)
    check('dark: color-scheme dark; both theme-color lines keep their own colour (Match device)', s['scheme'] == 'dark' and s['meta'] == 'dark' and s['themes'] == ['#e7e6e4', '#26211d'], s)
    open_menu(page)
    seg = page.locator('.acct-look .rk-seg-btn')
    check('the Look row: Match device, Light, Dark; Match device chosen', seg.all_inner_texts() == ['Match device', 'Light', 'Dark']
          and page.locator('.acct-look .rk-seg-btn[aria-pressed="true"]').inner_text() == 'Match device')
    order = page.evaluate("() => [...document.querySelector('.account-menu').children].map((e) => e.className)")
    check('the rows sit directly above Autoplay (signed out)', 'acct-looks' in order and order.index('acct-looks') + 1 == order.index('acct-autoplay'), order)
    check('the Light style row shows (light can appear), with Clear chosen and the note for a dark device',
          label(page) == 'Light style: Clear'
          and page.locator('.rk-swatch[aria-pressed="true"]').get_attribute('aria-label') == 'Clear'
          and page.locator('.acct-style-note').inner_text() == 'Used when your device is light.')
    labels = page.locator('.rk-swatch').evaluate_all('(els) => els.map((e) => e.getAttribute("aria-label"))')
    check('six swatches, each a button named for its style', labels == ['Bisque', 'Porcelain', 'Celadon', 'Washi', 'Smoke and clay', 'Clear']
          and page.locator('.rk-swatch').evaluate_all('(els) => els.every((e) => e.tagName === "BUTTON" && e.type === "button")'), labels)
    page.screenshot(path=str(OUT / 'look-01-dark-menu.png'))

    # 2. The device turns light while Raku is open: it follows at once (Clear), and the note goes.
    page.emulate_media(color_scheme='light')
    check('the device turns light: Raku follows (Clear)', wait_for(lambda: state(page)['look'] == 'light'))
    s = state(page)
    check('light: Clear\'s stage and strip, color-scheme light', s['light'] == 'clear' and s['stage'] == hexrgb(STAGE['clear']) and s['kiln'] == hexrgb(KILN['clear'])
          and s['scheme'] == 'light' and s['meta'] == 'light', s)
    check('the note goes once the device is light', wait_for(lambda: page.locator('.acct-style-note').count() == 0))
    page.screenshot(path=str(OUT / 'look-02-clear-menu.png'))
    page.emulate_media(color_scheme='dark')
    check('and back to dark with the device', wait_for(lambda: state(page)['look'] == 'dark'))

    # 3. Choosing Light on a dark device: at once, both theme-color lines Clear's, remembered over a reload.
    page.click('.acct-look .rk-seg-btn:has-text("Light")')
    s = state(page)
    check('Light chosen on a dark device: light at once', s['look'] == 'light' and s['stage'] == hexrgb(STAGE['clear']), s)
    check('a choice holds both theme-color lines to what shows', s['themes'] == ['#e7e6e4', '#e7e6e4'], s['themes'])
    check('the Light button keeps the focus after the menu redraws', page.evaluate("() => document.activeElement?.textContent") == 'Light')
    check('remembered in this browser', page.evaluate("() => localStorage.getItem('raku-look')") == 'light')
    for sid in ['bisque', 'porcelain', 'celadon', 'washi', 'clear']:
        page.click(f'.rk-swatch[aria-label="{NAMES[sid]}"]')
        s = state(page)
        check(f'{NAMES[sid]}: a tap changes Raku at once (stage, strip, theme-color, label)', s['light'] == sid and s['stage'] == hexrgb(STAGE[sid]) and s['kiln'] == hexrgb(KILN[sid])
              and s['themes'] == [KILN[sid]] * 2 and label(page) == f'Light style: {NAMES[sid]}', s)
        page.screenshot(path=str(OUT / f'look-03-{sid}-menu.png'))
    page.click('.rk-swatch[aria-label="Washi"]')
    check('the swatch keeps the focus, and is ringed', page.evaluate("() => document.activeElement?.getAttribute('aria-label')") == 'Washi'
          and page.locator('.rk-swatch[aria-pressed="true"]').get_attribute('aria-label') == 'Washi')
    page.keyboard.press('Shift+Tab'); page.keyboard.press('Enter')
    check('by keyboard: Shift+Tab to Celadon, Enter chooses it', state(page)['light'] == 'celadon')
    page.reload(); page.wait_for_selector('.chrome .brand')
    s = state(page)
    check('a reload keeps Light and Celadon', s['look'] == 'light' and s['light'] == 'celadon' and s['stage'] == hexrgb(STAGE['celadon']), s)

    # 4. Dark chosen on a light device: dark, and the Light style row goes.
    page.emulate_media(color_scheme='light')
    open_menu(page)
    page.click('.acct-look .rk-seg-btn:has-text("Dark")')
    s = state(page)
    check('Dark chosen on a light device: dark, both lines dark', s['look'] == 'dark' and s['stage'] == hexrgb(STAGE['dark']) and s['themes'] == ['#26211d'] * 2, s)
    check('with Dark the Light style row is hidden', page.locator('.acct-style').count() == 0)
    page.click('.acct-look .rk-seg-btn:has-text("Match device")')
    check('Match device again: light (the device), Celadon kept, both lines their own', state(page)['look'] == 'light' and state(page)['light'] == 'celadon'
          and state(page)['themes'] == [KILN['celadon'], '#26211d'])
    check('no page errors; nothing refused by the page policy', not errors and page.evaluate('window.__refused') == [], errors + page.evaluate('window.__refused'))
    ctx.close()

    # 4b. Signed in (an account already on this browser, the stand-in's sign-in): the rows sit above Autoplay there too.
    did = 'did:plc:6vxjigxrqizmbo56gojxico3'
    ctx, page, errors = new_page(browser, 'light', saved={'raku-accounts': f'[{{"did":"{did}","handle":"thunderbird.cafe"}}]', 'raku-account': f'"{did}"',
                                                          'standin-sessions': f'{{"{did}":{{"scope":"atproto include:cafe.thunderbird.authRaku"}}}}', 'raku-light-style': 'porcelain'})
    page.goto(RAKU); page.wait_for_selector('.chrome .brand')
    open_menu(page)
    order = page.evaluate("() => [...document.querySelector('.account-menu').children].map((e) => e.className)")
    check('signed in: Sign out, then the Look rows, directly above Autoplay', page.locator('.acct-out').count() == 1
          and order.index('acct-out') < order.index('acct-looks') and order.index('acct-looks') + 1 == order.index('acct-autoplay'), order)
    page.click('.rk-swatch[aria-label="Bisque"]')
    check('signed in: a swatch works the same', state(page)['light'] == 'bisque' and page.locator('.acct-row').count() == 1)
    page.screenshot(path=str(OUT / 'look-04-signed-in-bisque.png'))
    check('no page errors (signed in)', not errors, errors)
    ctx.close()

    # 5. Before the first paint: with Raku's own script held back, the page is already in the saved look (public/look.js).
    for saved, sid, mode, scheme in [({'raku-look': 'light', 'raku-light-style': 'bisque'}, 'bisque', 'light', 'dark'),
                                     ({}, 'clear', 'light', 'light'), ({'raku-look': 'dark'}, 'clear', 'dark', 'light'),
                                     ({'raku-light-style': 'washi'}, 'washi', 'dark', 'dark')]:
        ctx, page, errors = new_page(browser, scheme, saved=saved)
        held = []
        page.route('**/assets/main.js', lambda r: held.append(r))
        page.goto(RAKU, wait_until='commit')   # (DOMContentLoaded waits for the held module script)
        wait_for(lambda: held and page.evaluate("() => !!document.body && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'"), 6)
        s = page.evaluate("""() => ({ look: document.documentElement.dataset.look, light: document.documentElement.dataset.light,
          stage: getComputedStyle(document.body).backgroundColor, themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
          raku: !!document.querySelector('.chrome') })""")
        want = STAGE[sid] if mode == 'light' else STAGE['dark']
        check(f'first paint, saved {saved or "nothing"} on a {scheme} device: {mode} ({sid}) before Raku\'s script runs',
              not s['raku'] and s['look'] == mode and s['light'] == sid and s['stage'] == hexrgb(want), s)
        if saved.get('raku-look') == 'light' and sid == 'bisque':
            page.screenshot(path=str(OUT / 'look-05-first-paint-bisque.png'))
            check('…and its theme-color lines', s['themes'] == ['#e4dccf', '#e4dccf'], s['themes'])
        for r in held: r.continue_()
        ctx.close()

    # 6. Smoke and clay: the top bar stays dark (and its bowl), the pages and the menu in the bar are light.
    ctx, page, errors = new_page(browser, 'light', saved={'raku-light-style': 'bisque'})
    page.goto(RAKU); page.wait_for_selector('.chrome .brand')
    bisque_pot = page.locator('.brand:not(.brand-small) img.brand-pot').get_attribute('src')
    open_menu(page)
    page.click('.rk-swatch[aria-label="Smoke and clay"]')
    s = state(page)
    check('Smoke and clay: light pages, dark top bar', s['light'] == 'smoke' and s['stage'] == hexrgb(STAGE['smoke']) and s['kiln'] == hexrgb('#26211d'), s)
    check('Smoke and clay: theme-color dark (LM17)', s['themes'] == ['#26211d', '#26211d'], s['themes'])
    menu_bg = page.evaluate("() => getComputedStyle(document.querySelector('.account-menu')).backgroundColor")
    words = page.evaluate("() => getComputedStyle(document.querySelector('.acct-look')).color")
    check('its account menu (in the bar) is light, with dark words', menu_bg == hexrgb('#ffffff') and words == hexrgb('#2a231d'), (menu_bg, words))
    smoke_pot = page.locator('.brand:not(.brand-small) img.brand-pot').get_attribute('src')
    dark_pot = 'data:image/svg+xml,' in smoke_pot and '%2326211d' in smoke_pot and '%231f1a16' in smoke_pot
    check('the bowl in the dark bar is drawn in the dark colours (and differs from Bisque\'s)', dark_pot and smoke_pot != bisque_pot)
    address = page.evaluate("() => getComputedStyle(document.querySelector('.addr')).backgroundColor")
    check('the address box keeps today\'s dark well', address == hexrgb('#1f1a16'), address)
    page.screenshot(path=str(OUT / 'look-06-smoke-menu.png'))
    page.keyboard.press('Escape')
    page.screenshot(path=str(OUT / 'look-06-smoke.png'))
    page.reload(); page.wait_for_selector('.chrome .brand')
    reload_pot = page.locator('.brand:not(.brand-small) img.brand-pot').get_attribute('src')
    check('after a reload the bowl is still drawn dark in the bar (refreshBrandPots once in place)', reload_pot == smoke_pot)
    open_menu(page)
    page.click('.rk-swatch[aria-label="Porcelain"]')
    check('leaving Smoke and clay: the bar follows the light style again, and the bowl', state(page)['kiln'] == hexrgb(KILN['porcelain'])
          and page.locator('.brand:not(.brand-small) img.brand-pot').get_attribute('src') not in (smoke_pot, bisque_pot))
    check('no page errors; nothing refused (Smoke and clay)', not errors and page.evaluate('window.__refused') == [], errors)
    ctx.close()

    # 7. The phone width: the sheet from the bottom; the Look row and the swatches each on one line.
    for scheme, saved, tag in [('dark', None, 'dark'), ('light', {'raku-light-style': 'washi'}, 'washi')]:
        ctx, page, errors = new_page(browser, scheme, width=360, height=740, saved=saved)
        page.goto(RAKU); page.wait_for_selector('.bar .brand-small')
        open_menu(page)
        page.locator('.acct-looks').scroll_into_view_if_needed()
        g = page.evaluate("""() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const btns = [...document.querySelectorAll('.rk-seg-btn')].map((b) => b.getBoundingClientRect());
          const sw = [...document.querySelectorAll('.rk-swatch')].map((b) => b.getBoundingClientRect());
          return { panel: r('.account-menu'), label: r('.acct-look-label'), seg: r('.rk-seg'), btnTops: btns.map((b) => Math.round(b.top)), btnH: btns.map((b) => Math.round(b.height)),
                   swTops: sw.map((b) => Math.round(b.top)), swRight: Math.max(...sw.map((b) => b.right)), scrollW: document.documentElement.scrollWidth };
        }""")
        one_line = len(set(g['btnTops'])) == 1 and max(g['btnH']) <= 36 and abs(g['label']['top'] + g['label']['height'] / 2 - (g['seg']['top'] + g['seg']['height'] / 2)) < 4
        check(f'phone ({tag}): "Match device · Light · Dark" fits on one line beside "Look"', one_line and g['seg']['right'] <= g['panel']['right'] - 10, g)
        check(f'phone ({tag}): the six swatches on one line, inside the sheet', len(set(g['swTops'])) == 1 and g['swRight'] <= g['panel']['right'] - 10, g)
        check(f'phone ({tag}): no sideways scrolling', g['scrollW'] <= 360, g['scrollW'])
        page.screenshot(path=str(OUT / f'look-07-phone-{tag}.png'))
        ctx.close()

    # 8. The offline page follows the saved look and style (LM9), and the device when nothing is chosen.
    for scheme, saved, sid, mode in [('dark', None, 'clear', 'dark'), ('light', None, 'clear', 'light'), ('dark', {'raku-look': 'light', 'raku-light-style': 'porcelain'}, 'porcelain', 'light'),
                                     ('light', {'raku-look': 'dark'}, 'clear', 'dark'), ('light', {'raku-light-style': 'smoke'}, 'smoke', 'light')]:
        ctx, page, errors = new_page(browser, scheme, width=800, height=600, saved=saved)
        page.goto(RAKU + 'offline.html')
        s = page.evaluate("""() => ({ look: document.documentElement.dataset.look, bg: getComputedStyle(document.body).backgroundColor,
          h1: getComputedStyle(document.querySelector('h1')).color, themes: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content) })""")
        want = STAGE[sid] if mode == 'light' else STAGE['dark']
        check(f'offline page, {saved or "nothing saved"} on a {scheme} device: {mode} ({sid})', s['look'] == mode and s['bg'] == hexrgb(want), s)
        check(f'offline page ({sid}, {mode}): its own policy refuses nothing', page.evaluate('window.__refused') == [] and not errors, page.evaluate('window.__refused'))
        page.screenshot(path=str(OUT / f'look-08-offline-{mode}-{sid}.png'))
        if scheme == 'dark' and not saved:
            page.emulate_media(color_scheme='light')
            check('offline page follows the device live', wait_for(lambda: page.evaluate('document.documentElement.dataset.look') == 'light'))
        ctx.close()

    # 9. LM18: the Light style row never moves: two lines, the palette bar before the name, a preview while pointing.
    BAR = {'bisque': ['#e4dccf', '#ece5d9', '#fbf8f2', '#2a231d', '#1a6b62'], 'porcelain': ['#dee1e6', '#eceef1', '#fbfbfc', '#1e2329', '#106f65'],
           'celadon': ['#dae2de', '#e8edeb', '#f8f9f9', '#1d2b27', '#17705f'], 'washi': ['#efe6cf', '#f5f0e2', '#fbf9f4', '#402e21', '#217166'],
           'smoke': ['#26211d', '#efebe7', '#faf9f7', '#2a231d', '#196c61'], 'clear': ['#e7e6e4', '#f4f4f3', '#ffffff', '#161413', '#0d665b']}
    GEO = """() => { const r = (e) => e.getBoundingClientRect();
      return { row: Math.round(r(document.querySelector('.acct-style')).height),
               sw: [...document.querySelectorAll('.rk-swatch')].map((e) => [Math.round(r(e).left), Math.round(r(e).top)]),
               bar: Math.round(r(document.querySelector('.rk-bar')).left),
               bands: [...document.querySelectorAll('.rk-bar-band')].map((e) => getComputedStyle(e).backgroundColor) }; }"""
    for width, tag in [(1280, 'computer'), (360, 'phone')]:
        ctx, page, errors = new_page(browser, 'light', width=width, height=820 if width > 400 else 740)
        page.goto(RAKU); page.wait_for_selector('.account-btn')
        open_menu(page)
        page.locator('.acct-looks').scroll_into_view_if_needed()
        geos = {}
        for sid in ['bisque', 'porcelain', 'celadon', 'washi', 'smoke', 'clear']:
            page.click(f'.rk-swatch[aria-label="{NAMES[sid]}"]')
            page.mouse.move(2, 2)   # away from the swatches, so nothing is previewed
            geos[sid] = page.evaluate(GEO)
            check(f'{tag}, {NAMES[sid]}: the palette bar shows its strip, page, card, words and turquoise words', geos[sid]['bands'] == [hexrgb(c) for c in BAR[sid]], geos[sid]['bands'])
            if sid in ('porcelain', 'smoke'): page.screenshot(path=str(OUT / f'look-09-{tag}-{sid}.png'))
        same = {(g['row'], tuple(map(tuple, g['sw']))) for g in geos.values()}
        check(f'{tag}: tapping all six styles, the swatches never move (and stay on one line)', len(same) == 1
              and len({t for _, t in geos['clear']['sw']}) == 1, geos)
        check(f'{tag}: the palette bar stays in one place for every style', len({g['bar'] for g in geos.values()}) == 1, [g['bar'] for g in geos.values()])
        lab = page.locator('.acct-style-words').bounding_box(); sw0 = page.locator('.rk-swatch').first.bounding_box()
        check(f'{tag}: two lines: the swatches below the label', sw0['y'] >= lab['y'] + lab['height'] - 1, (lab, sw0))
        if width > 400:
            page.hover('.rk-swatch[aria-label="Washi"]')
            pre = page.evaluate(GEO)
            check('pointing at Washi (Clear chosen): its name, lighter, and its bar', label(page) == 'Light style: Washi'
                  and page.locator('.acct-style-name.preview').count() == 1 and pre['bands'] == [hexrgb(c) for c in BAR['washi']], (label(page), pre['bands']))
            check('…and nothing moves while previewing', (pre['row'], pre['sw'], pre['bar']) == (geos['clear']['row'], geos['clear']['sw'], geos['clear']['bar']))
            page.screenshot(path=str(OUT / 'look-09-preview-washi.png'))
            page.mouse.move(2, 2)
            check('moving away brings back the chosen style', label(page) == 'Light style: Clear' and page.locator('.acct-style-name.preview').count() == 0
                  and page.evaluate(GEO)['bands'] == [hexrgb(c) for c in BAR['clear']])
            page.focus('.rk-swatch[aria-label="Porcelain"]')
            check('tabbing to Porcelain previews it too', label(page) == 'Light style: Porcelain' and page.locator('.acct-style-name.preview').count() == 1)
            page.keyboard.press('Shift+Tab')
            check('…and tabbing on to Bisque previews Bisque', label(page) == 'Light style: Bisque')
            page.keyboard.press('Enter')
            check('Enter chooses it: not a preview any more', state(page)['light'] == 'bisque' and label(page) == 'Light style: Bisque'
                  and page.locator('.acct-style-name.preview').count() == 0)
            check('the bar is hidden from screen readers; the swatches are a group named "Light style"',
                  page.locator('.rk-bar').get_attribute('aria-hidden') == 'true' and page.locator('.rk-swatches').get_attribute('aria-label') == 'Light style'
                  and page.locator('.rk-swatch[title]').count() == 0)
        check(f'no page errors ({tag}, the row)', not errors, errors)
        ctx.close()
    browser.close()

print(f'\n{sum(results)} of {len(results)} pass')
sys.exit(0 if all(results) else 1)
