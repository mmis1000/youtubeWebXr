import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMedia } from '../src/media.js';

test('media redirects preserve the requested range and use separate origin requests', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url: new URL(url), options });
    return seen.length === 1 ? new Response('https://destination.googlevideo.com/media?range=1-2', { headers:{'Content-Type':'text/plain; charset=utf-8'} }) : new Response(new Uint8Array([1,2]), { headers:{'Content-Type':'video/mp4'} });
  });
  const signal = new AbortController().signal;
  const response = await fetchMedia('https://source.googlevideo.com/media?range=10-11', signal);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1,2]);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url.hostname, 'destination.googlevideo.com');
  for (const call of seen) {
    assert.equal(call.url.searchParams.get('range'), '10-11');
    assert.equal(call.url.searchParams.get('alr'), 'yes');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.signal, signal);
  }
});

test('media redirects reject unexpected destinations, oversized bodies and redirect loops', async t => {
  let body = 'https://example.com/media'; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(body, { headers:{'Content-Type':'text/plain'} }); });
  const url = 'https://source.googlevideo.com/media?range=0-1';
  await assert.rejects(fetchMedia(url), /Unexpected media host/);
  assert.equal(calls, 1);
  body = 'x'.repeat(16385);
  await assert.rejects(fetchMedia(url), /size limit/);
  body = url; calls = 0;
  await assert.rejects(fetchMedia(url), /Too many media server redirects/);
  assert.equal(calls, 4);
});
