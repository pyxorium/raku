// Going public (Q134): the About page's facts. Plain data, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget } from '../src/address.js';
import { TALKS_TO, EXCEPTION, MESSAGES_LINE } from '../src/about-page.js';
import { TYPEAHEAD_URL } from '../src/typeahead.js';
import { PLC_DIRECTORY, HIDE_LIST_URL, SEARCH, RECENT, TILE_LOAD_DOMAIN, TABLES, MADE_BY, SOURCE_CODE, BLOG_POST, TILE_POPUPS } from '../src/config.js';

test('the About page has its own address', () => {
  assert.deepEqual(parseTarget('raku:about'), { ok: true, kind: 'about', uri: 'raku:about' });
});

test('"Who Raku talks to" names every outside server Raku is set up to reach (keep the page true)', () => {
  const text = TALKS_TO.map(([who, what]) => `${who} ${what}`).join(' ');
  const host = (u) => new URL(u).hostname;
  for (const h of [host(PLC_DIRECTORY), host(HIDE_LIST_URL), host(SEARCH.url), host(RECENT.url), TILE_LOAD_DOMAIN, host(TYPEAHEAD_URL)]) {
    assert.ok(text.includes(h), `${h} is on the About page`);
  }
  assert.ok(/Bluesky/.test(text), "Bluesky's public servers");
  assert.ok(Object.values(TABLES).some((t) => t.relay) && /Daisy's relay/.test(text), "Daisy's relay");
  assert.ok(/just the words you typed/.test(text), 'search sends only the words');
});

test("the exception (owner's wording, Oct 22) matches the decision on tiles' new windows", () => {
  assert.equal(EXCEPTION, 'a tile can open a link in a new tab when you click it, and that link could carry information about what you did in the tile. It’s the same as clicking a link on any web page, so use the same care.');
  assert.equal(TILE_POPUPS, true, 'if new windows are ever blocked, the About page must change too');
  assert.equal(MADE_BY, 'thunderbird.cafe');
  assert.equal(SOURCE_CODE, 'https://github.com/pyxorium/raku');
});

test('the Messages line says when the button shows, and the page links to the blog post (Oct 23)', () => {
  assert.match(MESSAGES_LINE, /If it sends anything, a Messages button appears on its tab/);
  assert.match(MESSAGES_LINE, /At a table, the Messages button in the table’s bar/);
  assert.equal(BLOG_POST, 'https://thunderbird.cafe/blog/raku/');
});
