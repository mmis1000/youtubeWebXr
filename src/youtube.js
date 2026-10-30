import { readMetadata, decodeMesh, MAX_INIT_BYTES } from './metadata.js';
import { RangeStream, loadIndex } from './stream.js';
import { mediaURL, fetchMedia } from './media.js';
export { mediaURL } from './media.js';
export const MIN_VR_HEIGHT = 720;

export function chooseFormats(formats, maxHeight, canPlay) {
  return formats.filter(f => f.url && f.projectionType === 'MESH' && /^video\/(mp4|webm)(;|$)/.test(f.mimeType) && Number.isInteger(f.height) && f.height >= MIN_VR_HEIGHT && f.height <= maxHeight
    && canPlay(f.mimeType) && !f.drmFamilies?.length)
    .sort((a, b) => b.height - a.height || codecScore(b.mimeType) - codecScore(a.mimeType) || (b.fps || 0) - (a.fps || 0));
}
function codecScore(mime) { return mime.includes('avc1') ? 3 : /vp0?9/.test(mime) ? 2 : 1; }

export function closestFormats(formats, height, canPlay) {
  return chooseFormats(formats, Infinity, canPlay).sort((a, b) =>
    Math.abs(a.height - height) - Math.abs(b.height - height) || a.height - b.height
    || codecScore(b.mimeType) - codecScore(a.mimeType) || (b.fps || 0) - (a.fps || 0));
}

async function limitedBytes(response, signal) {
  if (!response.ok) throw new Error(`Stereo header request failed (${response.status}).`);
  if (!response.body) throw new Error('The stream header response is empty.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_INIT_BYTES) throw new Error('The stream header exceeded the metadata size limit.');
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function discoverStereo(videoId, height, signal) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Open a YouTube watch page first.');
  const visitor = window.ytcfg?.get('VISITOR_DATA') || window.ytInitialPlayerResponse?.responseContext?.visitorData;
  if (!visitor) throw new Error('YouTube visitor information is unavailable. Reload this tab and try again.');
  const response = await fetch('/youtubei/v1/player?prettyPrint=false', {
    method: 'POST', credentials: 'omit', signal,
    headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '101',
      'X-YouTube-Client-Version': '1.02', 'X-Goog-Visitor-Id': visitor },
    body: JSON.stringify({ videoId, context: { client: {
      clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
      osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
    } }, playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
    contentCheckOk: true, racyCheckOk: true })
  });
  if (!response.ok) throw new Error(`YouTube player request failed (${response.status}).`);
  const data = await response.json();
  if (data.playabilityStatus?.status !== 'OK') throw new Error(data.playabilityStatus?.reason || 'YouTube did not make this video available to the VR client.');
  const probe = document.createElement('video');
  const advertised = data.streamingData?.adaptiveFormats || [];
  const formats = closestFormats(advertised, height, mime => probe.canPlayType(mime) && MediaSource.isTypeSupported(mime));
  if (!formats.length) throw new Error('No compatible VR source at 720p or higher is available for this video.');
  // Validate one usable representation per height before exposing it in either selector.
  const groups = [...new Set(formats.map(f => f.height))].map(h => formats.filter(f => f.height === h));
  const results = new Array(groups.length); let cursor = 0, lastError;
  await Promise.all(Array.from({ length: Math.min(4, groups.length) }, async () => {
    for (;;) {
      const i = cursor++; if (i >= groups.length) return;
      for (const format of groups[i]) {
        signal.throwIfAborted();
        try {
          const url = mediaURL(format.url);
          const end = Number(format.initRange?.end);
          if (Number(format.initRange?.start) !== 0 || !Number.isSafeInteger(end) || end < 0 || end >= MAX_INIT_BYTES) throw new Error('Invalid stream initialization range.');
          url.searchParams.set('range', `0-${end}`);
          const header = await fetchMedia(url, signal);
          const initBytes = await limitedBytes(header, signal);
          const metadata = readMetadata(initBytes);
          if (!metadata?.projection || ![1, 2, 3, 4].includes(metadata.stereoMode)) throw new Error('This representation does not contain stereo projection metadata.');
          if (metadata.projection.type === 'mesh') {
            const meshes = await decodeMesh(metadata.projection.payload);
            if (metadata.stereoMode === 3 && meshes.length !== 2) throw new Error('Custom stereo requires two eye meshes.');
          } else if (metadata.projection.type !== 'equirectangular' || metadata.stereoMode === 3) throw new Error('This stereo projection is unsupported.');
          const resolved = { ...format, url: header.url || format.url };
          const segments = await loadIndex(resolved, initBytes, signal);
          results[i] = { format: resolved, metadata, initBytes, segments }; break;
        } catch (error) { if (signal.aborted) throw error; lastError = error; }
      }
    }
  }));
  const available = results.filter(Boolean);
  const qualities = available.map(r => r.format.height).sort((a, b) => a - b);
  if (!available.length) throw lastError || new Error('No stereo representation could be opened.');
  return { available, qualities };
}

export class StereoResolver {
  constructor(discover = discoverStereo, now = Date.now) {
    this.discover = discover; this.now = now; this.generation = 0;
  }
  clear() { this.cache = null; ++this.generation; }
  async resolve(videoId, height, signal, onFormats = () => {}) {
    signal.throwIfAborted();
    let cached = this.cache;
    if (!cached || cached.videoId !== videoId || cached.expires <= this.now()) {
      this.clear(); const generation = this.generation;
      const result = await this.discover(videoId, height, signal);
      signal.throwIfAborted();
      let expires = this.now() + 5 * 60 * 1000;
      for (const item of result.available) {
        const signedExpiry = Number(new URL(item.format.url).searchParams.get('expire'));
        if (signedExpiry > 0) expires = Math.min(expires, signedExpiry * 1000 - 30000);
      }
      cached = { ...result, videoId, expires };
      if (generation === this.generation) this.cache = cached;
    }
    signal.throwIfAborted();
    const selected = [...cached.available].sort((a, b) => Math.abs(a.format.height - height) - Math.abs(b.format.height - height)
      || a.format.height - b.format.height)[0];
    onFormats({ qualities: cached.qualities });
    return { ...selected, qualities: cached.qualities };
  }
}

// Standalone callers get a fresh discovery; the player owns a resolver for its active session.
export function resolveStereo(videoId, height, signal, onFormats) {
  return new StereoResolver().resolve(videoId, height, signal, onFormats);
}

export class LinkedVideo {
  constructor(original, result, onError, signal) {
    this.original = original; this.result = result; this.active = false; this.disposed = false;
    this.listeners = [];
    const video = this.video = document.createElement('video');
    video.dataset.youtubeWebxrStereo = 'true';
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'metadata';
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:0;pointer-events:none;opacity:0';
    mediaURL(result.format.url);
    document.body.append(video);
    const listen = (target, type, callback) => { target.addEventListener(type, callback); this.listeners.push(() => target.removeEventListener(type, callback)); };
    const sync = () => {
      if (this.disposed || !this.active || video.readyState < 1) return;
      if (!video.seeking && Math.abs(original.currentTime - video.currentTime) > 0.15) video.currentTime = Math.min(original.currentTime, video.duration - 0.01);
      video.playbackRate = original.playbackRate;
      if (original.paused || original.ended || original.readyState < 3) video.pause();
      else if (video.paused) video.play().catch(error => { if (this.active && error.name !== 'AbortError') onError(error); });
    };
    this.sync = sync;
    for (const event of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'waiting', 'playing', 'ended']) listen(original, event, sync);
    listen(video, 'loadedmetadata', sync);
    listen(video, 'error', () => { if (!this.disposed) onError(new Error(`Stereo video loading failed (${video.error?.message || video.error?.code || 'unknown error'}). Try loading the stream again.`)); });
    this.timer = setInterval(sync, 100);
    this.stream = new RangeStream(video, result, () => original.currentTime, onError, signal);
    this.ready = this.stream.ready;
  }
  setActive(active) {
    this.active = active;
    this.stream.setActive(active);
    if (active) { this.video.preload = 'auto'; this.sync(); }
    else { this.video.pause(); this.video.preload = 'metadata'; }
  }
  async prepare(signal) {
    await this.ready;
    signal.throwIfAborted();
    this.setActive(true);
    await waitForFrame(this.video, signal);
  }
  dispose() {
    this.disposed = true; this.active = false; clearInterval(this.timer);
    this.stream.dispose();
    for (const remove of this.listeners) remove();
    this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove();
  }
}

export function waitForFrame(video, signal) {
  return new Promise((resolve, reject) => {
    const events = ['loadeddata', 'canplay', 'seeked', 'error'];
    const cleanup = () => { for (const e of events) video.removeEventListener(e, check); signal.removeEventListener('abort', check); };
    const check = () => {
      if (signal.aborted || video.error) { cleanup(); reject(signal.reason || new Error(video.error.message || 'Video decoding failed.')); }
      else if (video.readyState >= 2 && !video.seeking) { cleanup(); resolve(); }
    };
    for (const e of events) video.addEventListener(e, check);
    signal.addEventListener('abort', check, { once: true }); check();
  });
}
