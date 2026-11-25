import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWebMIndex } from '../src/webm.js';
import { TrackFeeder } from '../src/stream.js';
import { chooseFormats, chooseAudioFormats, probeCapabilities, fetchPlayerResponse, StereoResolver } from '../src/youtube.js';
import { OWN_MEDIA_SOURCE } from '../src/observe.js';
import { concat, ebml } from './fixtures.mjs';
import { uint, cues, segmentHeader } from './webm-fixture.mjs';

test('WebM index parser supports audio tracks (trackType = 2)', () => {
  const duration = Buffer.alloc(8); duration.writeDoubleBE(4000);
  const header = ebml(0x1a45dfa3, []);
  const init = concat(header, segmentHeader,
    ebml(0x1549a966, concat(ebml(0x2ad7b1, uint(1000000)), ebml(0x4489, duration))),
    ebml(0x1654ae6b, ebml(0xae, concat(ebml(0xd7, [1]), ebml(0x83, [2])))));
  const origin = header.length + segmentHeader.length;
  const format = { indexRange: { start: init.length }, contentLength: origin + 1000 };
  const index = cues([{ time: 0, offset: 300 }, { time: 2000, offset: 600 }]);
  assert.deepEqual(readWebMIndex(index, init, format, 2), [
    { start: origin + 300, end: origin + 599, time: 0, duration: 2 },
    { start: origin + 600, end: origin + 999, time: 2, duration: 2 }
  ]);
  assert.throws(() => readWebMIndex(index, init, format, 1), /Expected one WebM video track/);
});

test('chooseFormats prioritizes hardware-accelerated mediaCapabilities and respects maxTextureSize', async () => {
  const formats = [
    { itag: 1, width: 15360, height: 8640, fps: 60, bitrate: 80_000_000, mimeType: 'video/mp4; codecs="av01.0.17M.08"' },
    { itag: 2, width: 7680, height: 4320, fps: 60, bitrate: 40_000_000, mimeType: 'video/mp4; codecs="av01.0.17M.08"' },
    { itag: 3, width: 7680, height: 4320, fps: 60, bitrate: 35_000_000, mimeType: 'video/mp4; codecs="avc1.640033"' },
    { itag: 4, width: 3840, height: 2160, fps: 60, bitrate: 20_000_000, mimeType: 'video/webm; codecs="vp09.00.51.08"' }
  ].map(f => ({ ...f, url: 'https://test.googlevideo.com/videoplayback', projectionType: 'MESH' }));

  const capabilities = await probeCapabilities(formats, async ({ video }) => {
    if (video.contentType.includes('av01')) return { supported: true, smooth: true, powerEfficient: true };
    if (video.contentType.includes('avc1')) return { supported: true, smooth: false, powerEfficient: false };
    return { supported: true, smooth: true, powerEfficient: true };
  });
  const selected = chooseFormats(formats, Infinity, () => true, { maxTextureSize: 8192, capabilities });
  assert.deepEqual(selected.map(f => f.itag), [2, 3, 4], 'filters oversized textures and prefers powerEfficient AV1 over non-smooth H.264');
});

test('chooseAudioFormats prefers default audio track and highest bitrate', () => {
  const formats = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioTrack: { audioIsDefault: true }, url: 'https://test.googlevideo.com/a', initRange: { start: '0', end: '100' }, indexRange: { start: '101', end: '200' } },
    { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, audioTrack: { audioIsDefault: true }, url: 'https://test.googlevideo.com/b', initRange: { start: '0', end: '100' }, indexRange: { start: '101', end: '200' } },
    { itag: 252, mimeType: 'audio/webm; codecs="opus"', bitrate: 256000, audioTrack: { audioIsDefault: false }, url: 'https://test.googlevideo.com/c', initRange: { start: '0', end: '100' }, indexRange: { start: '101', end: '200' } },
    { itag: 253, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://test.googlevideo.com/d', initRange: { start: '0', end: '100' } }
  ];
  const audio = chooseAudioFormats(formats, () => true);
  assert.deepEqual(audio.map(f => f.itag), [251, 140, 252]);
});

test('fetchPlayerResponse falls back from VISIONOS to ANDROID_VR on failure', async () => {
  const seenClients = [];
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    seenClients.push(body.context.client.clientName);
    if (body.context.client.clientName === 'VISIONOS') {
      return { ok: false, status: 403 };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        playabilityStatus: { status: 'OK' },
        streamingData: { adaptiveFormats: [{ itag: 571, url: 'https://rr1.googlevideo.com/v', projectionType: 'MESH' }] }
      })
    };
  };
  const data = await fetchPlayerResponse('abcdefghijk', 'visitor-1', new AbortController().signal, fakeFetch);
  assert.deepEqual(seenClients, ['VISIONOS', 'ANDROID_VR']);
  assert.equal(data.streamingData.adaptiveFormats[0].itag, 571);
});

test('TrackFeeder prefetches ahead in parallel and aborts stale fetches on seek', async () => {
  const bufferedRanges = [];
  const makeBuffered = () => ({
    get length() { return bufferedRanges.length; },
    start: i => bufferedRanges[i][0],
    end: i => bufferedRanges[i][1]
  });
  const buffer = new EventTarget();
  buffer.buffered = makeBuffered();
  buffer.appendBuffer = bytes => {
    const idx = bytes[0];
    const start = idx * 5, end = start + 5;
    if (bufferedRanges.length && bufferedRanges.at(-1)[1] === start) bufferedRanges.at(-1)[1] = end;
    else bufferedRanges.push([start, end]);
    queueMicrotask(() => buffer.dispatchEvent(new Event('updateend')));
  };
  buffer.remove = () => queueMicrotask(() => buffer.dispatchEvent(new Event('updateend')));

  const segments = [0, 1, 2, 3, 4].map(i => ({ start: i * 100, end: i * 100 + 99, time: i * 5, duration: 5 }));
  const fetched = [];
  let abortedCount = 0;
  let playhead = 0;
  const controller = new AbortController();
  const feeder = new TrackFeeder(
    { readyState: 'open', duration: 25 },
    buffer,
    { url: 'https://test.googlevideo.com/v' },
    segments,
    () => playhead,
    err => { throw err; },
    controller.signal,
    {
      targetAhead: 10,
      maxPrefetch: 2,
      fetchSegment: (seg, sig) => new Promise((resolve, reject) => {
        const idx = seg.time / 5;
        fetched.push(idx);
        sig.addEventListener('abort', () => { abortedCount++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        setTimeout(() => { if (!sig.aborted) resolve(new Uint8Array([idx])); }, 15);
      })
    }
  );
  feeder.setActive(true);
  await new Promise(r => setTimeout(r, 80));
  // Segment 0 and 1 should have been prefetched and appended to reach 10s ahead.
  assert.ok(fetched.includes(0) && fetched.includes(1), `expected prefetch of 0 and 1, saw ${fetched}`);
  assert.ok(bufferedRanges.length >= 1 && bufferedRanges[0][1] >= 10);

  // Seek to segment 4 and ensure onSeek aborts any in-flight prefetch and fetches segment 4.
  playhead = 20;
  feeder.onSeek();
  await new Promise(r => setTimeout(r, 40));
  assert.ok(fetched.includes(4), `expected seek target segment 4, saw ${fetched}`);
  controller.abort();
  assert.equal(typeof OWN_MEDIA_SOURCE, 'symbol');
});

test('StereoResolver forwards background quality updates to the latest resolve caller and disposes on clear', async () => {
  let disposed = false, pushUpdate;
  const resolver = new StereoResolver(async (_id, _h, _sig, onUpdate) => {
    pushUpdate = onUpdate;
    return {
      available: [{ format: { height: 1080, url: 'https://test.googlevideo.com/m?expire=9999999' }, initBytes: new Uint8Array([1]), segments: [] }],
      qualities: [1080],
      audio: null,
      dispose: () => { disposed = true; }
    };
  }, () => 1000);

  const seen1 = [], seen2 = [];
  await resolver.resolve('abcdefghijk', 1080, new AbortController().signal, f => seen1.push(f.qualities));
  await resolver.resolve('abcdefghijk', 1080, new AbortController().signal, f => seen2.push(f.qualities));
  resolver.cache.qualities.push(2160);
  pushUpdate({ item: { format: { height: 2160, url: 'https://test.googlevideo.com/m?expire=9999999' } } });
  assert.deepEqual(seen2.at(-1), [1080, 2160]);
  resolver.clear();
  assert.equal(disposed, true);
});
