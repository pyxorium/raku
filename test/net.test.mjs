import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicHost, checkUrl, fetchLimited, formatBytes, NetError } from '../src/net.js';

test('private and local hosts are refused', () => {
  for (const h of ['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fdaa:0:1::3]', '[fe80::1]', 'printer.local',
    'app.internal', 'nas', 'router.home.arpa', 'x.test', '300.1.1.1']) {
    assert.equal(isPublicHost(h), false, h);
  }
  for (const h of ['bsky.social', 'fibercap.us-west.host.bsky.network', 'plc.directory', '8.8.8.8', '172.32.0.1', '[2606:4700::1]']) {
    assert.equal(isPublicHost(h), true, h);
  }
});

test('only https addresses to public hosts are fetched', () => {
  assert.equal(checkUrl('https://pds.example.com/xrpc/x').hostname, 'pds.example.com');
  assert.throws(() => checkUrl('http://pds.example.com/'), (e) => e.code === 'not-https');
  assert.throws(() => checkUrl('https://192.168.1.1/'), (e) => e.code === 'private');
  assert.throws(() => checkUrl('https://user:pw@pds.example.com/'), (e) => e.code === 'bad-url');
  assert.throws(() => checkUrl('nonsense'), (e) => e.code === 'bad-url');
});

const respond = (body, init = {}) => async () => new Response(body, init);

test('downloads stop once over their size limit', async () => {
  const r = await fetchLimited('https://a.example.com/', { timeoutMs: 1000, maxBytes: 10, fetchImpl: respond('0123456789') });
  assert.equal(r.bytes.byteLength, 10);
  await assert.rejects(fetchLimited('https://a.example.com/', { timeoutMs: 1000, maxBytes: 9, fetchImpl: respond('0123456789') }), (e) => e.code === 'too-large');
  // a stream that never ends is cut off at the limit
  const endless = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); } }));
  await assert.rejects(fetchLimited('https://a.example.com/', { timeoutMs: 5000, maxBytes: 5000, fetchImpl: endless }), (e) => e.code === 'too-large');
});

test('downloads stop at their time limit', async () => {
  const slow = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(fetchLimited('https://a.example.com/', { timeoutMs: 50, maxBytes: 10, fetchImpl: slow }), (e) => e instanceof NetError && e.code === 'timeout');
});

test('no cookies, no referrer', async () => {
  let seen;
  await fetchLimited('https://a.example.com/', { timeoutMs: 1000, maxBytes: 10, fetchImpl: async (u, o) => { seen = o; return new Response('x'); } });
  assert.equal(seen.credentials, 'omit');
  assert.equal(seen.referrerPolicy, 'no-referrer');
});

test('sizes in words', () => {
  assert.equal(formatBytes(60 * 1024 * 1024), '60 MB');
  assert.equal(formatBytes(820 * 1024), '820 KB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});
