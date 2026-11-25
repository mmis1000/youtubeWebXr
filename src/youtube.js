import { readMetadata, decodeMesh, MAX_INIT_BYTES } from './metadata.js';
import { RangeStream, loadIndex } from './stream.js';
import { mediaURL, fetchMedia } from './media.js';
export { mediaURL } from './media.js';
export const MIN_VR_HEIGHT = 720;

export const INNERTUBE_CLIENTS = [
  {
    name: 'VISIONOS',
    headers: { 'X-YouTube-Client-Name': '101', 'X-YouTube-Client-Version': '1.02' },
    client: {
      clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
      osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
    }
  },
  {
    name: 'ANDROID_VR',
    headers: { 'X-YouTube-Client-Name': '28', 'X-YouTube-Client-Version': '1.65.10' },
    client: {
      clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3',
      androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
      userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'
    }
  }
];

let cachedMaxTextureSize;
export function getMaxTextureSize() {
  if (cachedMaxTextureSize !== undefined) return cachedMaxTextureSize;
  if (typeof document === 'undefined') return Infinity;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    cachedMaxTextureSize = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : Infinity;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { cachedMaxTextureSize = Infinity; }
  return cachedMaxTextureSize;
}

export async function probeCapabilities(formats, decodingInfo) {
  const map = new Map();
  const fn = decodingInfo || (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.decodingInfo?.bind(navigator.mediaCapabilities));
  if (!fn || !formats.length) return map;
  await Promise.all(formats.map(async f => {
    try {
      const info = await fn({
        type: 'media-source',
        video: {
          contentType: f.mimeType,
          width: f.width || f.height * 2,
          height: f.height,
          bitrate: f.bitrate || 10_000_000,
          framerate: f.fps || 30
        }
      });
      map.set(f, { supported: !!info?.supported, smooth: !!info?.smooth, powerEfficient: !!info?.powerEfficient });
    } catch {}
  }));
  return map;
}

function capabilityScore(format, capabilities) {
  const cap = capabilities?.get(format);
  if (!cap || !cap.supported) return 0;
  return (cap.powerEfficient ? 2 : 0) + (cap.smooth ? 1 : 0);
}

function codecScore(mime) { return mime.includes('avc1') ? 3 : /vp0?9/.test(mime) ? 2 : 1; }

export function chooseFormats(formats, maxHeight, canPlay, options = {}) {
  const { maxTextureSize = Infinity, capabilities } = options;
  return formats.filter(f => f.url && ['MESH', 'EQUIRECTANGULAR'].includes(f.projectionType)
    && /^video\/(mp4|webm)(;|$)/.test(f.mimeType)
    && Number.isInteger(f.height) && f.height >= MIN_VR_HEIGHT && f.height <= maxHeight
    && (!f.width || f.width <= maxTextureSize) && f.height <= maxTextureSize
    && canPlay(f.mimeType) && !f.drmFamilies?.length
    && capabilityScore(f, capabilities) >= 0)
    .sort((a, b) => b.height - a.height
      || capabilityScore(b, capabilities) - capabilityScore(a, capabilities)
      || codecScore(b.mimeType) - codecScore(a.mimeType)
      || (b.fps || 0) - (a.fps || 0)
      || (b.bitrate || 0) - (a.bitrate || 0));
}

export function closestFormats(formats, height, canPlay, options = {}) {
  const { capabilities } = options;
  return chooseFormats(formats, Infinity, canPlay, options).sort((a, b) =>
    Math.abs(a.height - height) - Math.abs(b.height - height) || a.height - b.height
    || capabilityScore(b, capabilities) - capabilityScore(a, capabilities)
    || codecScore(b.mimeType) - codecScore(a.mimeType)
    || (b.fps || 0) - (a.fps || 0)
    || (b.bitrate || 0) - (a.bitrate || 0));
}

export function chooseAudioFormats(formats, canPlay) {
  return formats.filter(f => f.url && /^audio\/(webm|mp4)(;|$)/.test(f.mimeType)
    && f.initRange && f.indexRange && !f.drmFamilies?.length && canPlay(f.mimeType))
    .sort((a, b) => {
      const aDef = !a.audioTrack || a.audioTrack.audioIsDefault ? 1 : 0;
      const bDef = !b.audioTrack || b.audioTrack.audioIsDefault ? 1 : 0;
      return bDef - aDef || (b.bitrate || 0) - (a.bitrate || 0);
    });
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

export async function fetchPlayerResponse(videoId, visitor, signal, fetchFn = fetch) {
  let lastError;
  for (const profile of INNERTUBE_CLIENTS) {
    signal?.throwIfAborted();
    try {
      const response = await fetchFn('/youtubei/v1/player?prettyPrint=false', {
        method: 'POST', credentials: 'omit', signal,
        headers: { 'Content-Type': 'application/json', ...profile.headers, 'X-Goog-Visitor-Id': visitor },
        body: JSON.stringify({
          videoId,
          context: { client: profile.client },
          playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
          contentCheckOk: true, racyCheckOk: true
        })
      });
      if (!response.ok) { lastError = new Error(`YouTube player request failed (${response.status}).`); continue; }
      const data = await response.json();
      if (data.playabilityStatus?.status !== 'OK') {
        lastError = new Error(data.playabilityStatus?.reason || 'YouTube did not make this video available to the VR client.');
        continue;
      }
      const advertised = data.streamingData?.adaptiveFormats || [];
      if (advertised.some(f => f.url && ['MESH', 'EQUIRECTANGULAR'].includes(f.projectionType))) return data;
      lastError = new Error('No compatible VR source at 720p or higher is available for this video.');
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('YouTube did not make this video available to the VR client.');
}

async function validateVideoFormat(format, signal) {
  const url = mediaURL(format.url);
  const end = Number(format.initRange?.end);
  if (Number(format.initRange?.start) !== 0 || !Number.isSafeInteger(end) || end < 0 || end >= MAX_INIT_BYTES) {
    throw new Error('Invalid stream initialization range.');
  }
  url.searchParams.set('range', `0-${end}`);
  const header = await fetchMedia(url, signal);
  const initBytes = await limitedBytes(header, signal);
  const metadata = readMetadata(initBytes);
  if (!metadata?.projection || ![0, 1, 2, 3, 4].includes(metadata.stereoMode)) {
    throw new Error('This representation does not contain supported VR projection metadata.');
  }
  if (metadata.projection.type === 'mesh') {
    const meshes = await decodeMesh(metadata.projection.payload);
    if (metadata.stereoMode === 3 && meshes.length !== 2) throw new Error('Custom stereo requires two eye meshes.');
  } else if (metadata.projection.type !== 'equirectangular' || metadata.stereoMode === 3) {
    throw new Error('This VR projection is unsupported.');
  }
  const resolved = { ...format, url: header.url || format.url };
  const segments = await loadIndex(resolved, initBytes, signal);
  return { format: resolved, metadata, initBytes, segments };
}

async function validateAudioCandidates(candidates, signal) {
  for (const format of candidates) {
    if (signal?.aborted) return null;
    try {
      const url = mediaURL(format.url);
      const end = Number(format.initRange?.end);
      if (Number(format.initRange?.start) !== 0 || !Number.isSafeInteger(end) || end < 0 || end >= MAX_INIT_BYTES) continue;
      url.searchParams.set('range', `0-${end}`);
      const header = await fetchMedia(url, signal);
      const initBytes = await limitedBytes(header, signal);
      const resolved = { ...format, url: header.url || format.url };
      const segments = await loadIndex(resolved, initBytes, signal);
      return { format: resolved, initBytes, segments };
    } catch {
      if (signal?.aborted) return null;
    }
  }
  return null;
}

async function discoverStereo(videoId, height, signal, onUpdate = () => {}) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Open a YouTube watch page first.');
  const visitor = window.ytcfg?.get('VISITOR_DATA') || window.ytInitialPlayerResponse?.responseContext?.visitorData;
  if (!visitor) throw new Error('YouTube visitor information is unavailable. Reload this tab and try again.');
  const data = await fetchPlayerResponse(videoId, visitor, signal);
  const probe = document.createElement('video');
  const canPlay = mime => probe.canPlayType(mime) && MediaSource.isTypeSupported(mime);
  const advertised = data.streamingData?.adaptiveFormats || [];
  const maxTextureSize = getMaxTextureSize();
  const baseFormats = chooseFormats(advertised, Infinity, canPlay, { maxTextureSize });
  if (!baseFormats.length) throw new Error('No compatible VR source at 720p or higher is available for this video.');
  const capabilities = await probeCapabilities(baseFormats);
  const formats = closestFormats(baseFormats, height, canPlay, { maxTextureSize, capabilities });
  if (!formats.length) throw new Error('No compatible VR source at 720p or higher is available for this video.');

  const audioCandidates = chooseAudioFormats(advertised, canPlay);
  const audioPromise = validateAudioCandidates(audioCandidates, signal);

  const heightOrder = [...new Set(formats.map(f => f.height))];
  const groups = new Map(heightOrder.map(h => [h, formats.filter(f => f.height === h)]));
  const validated = new Map();
  const inFlight = new Map();
  const bgController = new AbortController();

  const validateHeight = (h, reqSignal) => {
    if (validated.has(h)) return Promise.resolve(validated.get(h));
    if (inFlight.has(h)) return inFlight.get(h);
    const candidates = groups.get(h) || [];
    const run = (async () => {
      let lastErr;
      for (const format of candidates) {
        reqSignal?.throwIfAborted();
        try {
          const item = await validateVideoFormat(format, reqSignal);
          validated.set(h, item);
          return item;
        } catch (err) {
          if (reqSignal?.aborted) throw err;
          lastErr = err;
        }
      }
      validated.set(h, null);
      if (lastErr) throw lastErr;
      return null;
    })().finally(() => { inFlight.delete(h); });
    inFlight.set(h, run);
    return run;
  };

  // Validate target resolution first (falling through to next closest if all candidates fail)
  // so playback starts in a single round-trip instead of blocking on every resolution group.
  let firstItem = null, lastError;
  for (const h of heightOrder) {
    signal.throwIfAborted();
    try {
      const item = await validateHeight(h, signal);
      if (item) { firstItem = item; break; }
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  if (!firstItem) throw lastError || new Error('No VR representation could be opened.');

  const audio = await audioPromise;
  signal.throwIfAborted();

  const available = [firstItem];
  const qualities = [firstItem.format.height];

  // Validate remaining resolutions in the background so the quality menu populates with only
  // verified VR sources and later switches reuse cached headers/indices with zero extra requests.
  const remaining = heightOrder.filter(h => !validated.has(h));
  const bgSignal = bgController.signal;
  let cursor = 0;
  const backgroundPromise = remaining.length ? Promise.all(Array.from({ length: Math.min(3, remaining.length) }, async () => {
    for (;;) {
      if (bgSignal.aborted) return;
      const i = cursor++; if (i >= remaining.length) return;
      const h = remaining[i];
      try {
        const item = await validateHeight(h, bgSignal);
        if (item && !bgSignal.aborted) {
          available.push(item);
          qualities.push(item.format.height);
          qualities.sort((a, b) => a - b);
          onUpdate({ available, qualities: [...qualities], item });
        }
      } catch {}
    }
  })) : Promise.resolve();

  return {
    available,
    qualities,
    audio,
    ensureHeight: async (targetHeight, reqSignal) => {
      if (validated.has(targetHeight)) return validated.get(targetHeight);
      if (!groups.has(targetHeight)) return null;
      try {
        const item = await validateHeight(targetHeight, reqSignal);
        if (item && !available.includes(item)) {
          available.push(item);
          if (!qualities.includes(item.format.height)) {
            qualities.push(item.format.height);
            qualities.sort((a, b) => a - b);
          }
        }
        return item;
      } catch {
        return null;
      }
    },
    backgroundPromise,
    dispose: () => bgController.abort()
  };
}

function minExpiry(items, baseExpires) {
  let expires = baseExpires;
  for (const item of items) {
    if (!item?.format?.url) continue;
    try {
      const signedExpiry = Number(new URL(item.format.url).searchParams.get('expire'));
      if (signedExpiry > 0) expires = Math.min(expires, signedExpiry * 1000 - 30000);
    } catch {}
  }
  return expires;
}

export class StereoResolver {
  constructor(discover = discoverStereo, now = Date.now) {
    this.discover = discover; this.now = now; this.generation = 0;
  }
  clear() {
    this.cache?.dispose?.();
    this.cache = null;
    this.onFormats = null;
    ++this.generation;
  }
  async resolve(videoId, height, signal, onFormats = () => {}) {
    signal.throwIfAborted();
    this.onFormats = onFormats;
    let cached = this.cache;
    if (!cached || cached.videoId !== videoId || cached.expires <= this.now()) {
      this.clear(); this.onFormats = onFormats; const generation = this.generation;
      const onUpdate = update => {
        if (generation !== this.generation || !this.cache) return;
        this.cache.expires = minExpiry([update.item], this.cache.expires);
        this.onFormats?.({ qualities: [...this.cache.qualities] });
      };
      const result = await this.discover(videoId, height, signal, onUpdate);
      signal.throwIfAborted();
      const baseExpires = this.now() + 5 * 60 * 1000;
      const expires = minExpiry([...result.available, result.audio], baseExpires);
      cached = { ...result, videoId, expires };
      if (generation === this.generation) this.cache = cached;
      else result.dispose?.();
    }
    signal.throwIfAborted();
    if (cached.ensureHeight) await cached.ensureHeight(height, signal);
    signal.throwIfAborted();
    const selected = [...cached.available].sort((a, b) => Math.abs(a.format.height - height) - Math.abs(b.format.height - height)
      || a.format.height - b.format.height)[0];
    onFormats({ qualities: [...cached.qualities] });
    return { ...selected, audio: cached.audio || null, qualities: [...cached.qualities] };
  }
}

// Standalone callers get a fresh discovery; the player owns a resolver for its active session.
export function resolveStereo(videoId, height, signal, onFormats) {
  return new StereoResolver().resolve(videoId, height, signal, onFormats);
}

export function suspendVideoTracks(video) {
  const tracks = video.videoTracks;
  if (!tracks || !Array.from(video.audioTracks || []).some(track => track.enabled)) return () => {};
  let selected;
  const suspend = () => {
    for (const track of tracks) if (track.selected) {
      selected = track;
      track.selected = false;
    }
  };
  tracks.addEventListener('addtrack', suspend);
  tracks.addEventListener('change', suspend);
  suspend();
  return () => {
    tracks.removeEventListener('addtrack', suspend);
    tracks.removeEventListener('change', suspend);
    if (selected && Array.from(tracks).includes(selected)) selected.selected = true;
  };
}

export class LinkedVideo {
  constructor(original, result, onError, signal) {
    this.original = original; this.result = result; this.active = false; this.disposed = false;
    this.unified = false; this.listeners = [];
    const video = this.video = document.createElement('video');
    video.dataset.youtubeWebxrStereo = 'true';
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'metadata';
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:0;pointer-events:none;opacity:0';
    mediaURL(result.format.url);
    document.body.append(video);
    const listen = (target, type, callback) => { target.addEventListener(type, callback); this.listeners.push(() => target.removeEventListener(type, callback)); };
    let seekStarted = 0;
    const sync = () => {
      if (this.disposed || !this.active || this.unified || video.readyState < 1) return;
      const drift = Math.abs(original.currentTime - video.currentTime);
      // The range stream follows the original's playhead, so a seek target the original has since
      // moved away from may never be buffered and the seek would wait forever. Retarget it.
      const stuck = video.seeking && performance.now() - seekStarted > 1500 && drift > 0.5;
      if ((!video.seeking && drift > 0.15) || stuck) {
        seekStarted = performance.now();
        video.currentTime = Math.min(original.currentTime, video.duration - 0.01);
      }
      video.playbackRate = original.playbackRate;
      // While the stereo stream is still fetching (after a seek, loop or new video), hold the original
      // so it doesn't run ahead: chasing a moving playhead one segment at a time can take many seconds.
      const wantsPlay = this.holding || !(original.paused || original.ended);
      // At the end of the stream there is no future data, so readyState stays at 2; treat it as ready
      // or the original would be held just before it ends or loops.
      const atEnd = video.ended || video.currentTime >= video.duration - 0.25;
      const stereoReady = !video.seeking && (video.readyState >= 3 || (atEnd && video.readyState >= 2));
      if (wantsPlay && !stereoReady) {
        if (!original.paused) { this.holding = true; original.pause(); }
        video.pause();
        return;
      }
      if (this.holding) { this.releaseHold(); return; }
      if (!wantsPlay || original.readyState < 3) video.pause();
      else if (video.paused) video.play().catch(error => { if (this.active && error.name !== 'AbortError') onError(error); });
    };
    this.sync = sync;
    for (const event of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'waiting', 'playing', 'ended']) listen(original, event, sync);
    listen(video, 'loadedmetadata', sync);
    listen(video, 'error', () => { if (!this.disposed) onError(new Error(`Stereo video loading failed (${video.error?.message || video.error?.code || 'unknown error'}). Try loading the stream again.`)); });
    this.timer = setInterval(sync, 100);
    this.stream = new RangeStream(video, result, () => this.unified ? video.currentTime : original.currentTime, onError, signal);
    this.ready = this.stream.ready.then(() => {
      if (this.disposed) return;
      if (this.stream.hasAudio) {
        this.unified = true;
        clearInterval(this.timer);
        this.timer = null;
        video.muted = original.muted;
        video.volume = original.volume;
        video.playbackRate = original.playbackRate;
        const mirrorAudio = () => {
          if (this.disposed) return;
          video.muted = original.muted;
          video.volume = original.volume;
          video.playbackRate = original.playbackRate;
        };
        listen(original, 'volumechange', mirrorAudio);
        listen(original, 'ratechange', mirrorAudio);
      }
    });
  }
  releaseHold() {
    if (!this.holding) return;
    this.holding = false;
    this.original.play().catch(() => {});
  }
  setActive(active) {
    if (!active) this.releaseHold();
    this.active = active;
    if (this.unified) {
      if (active) {
        this.original.pause();
        this.stream.setActive(true);
        this.video.preload = 'auto';
      } else {
        this.stream.setActive(false);
        this.video.pause();
        this.video.preload = 'metadata';
      }
      return;
    }
    if (active && !this.restoreVideoTracks) this.restoreVideoTracks = suspendVideoTracks(this.original);
    if (!active) { this.restoreVideoTracks?.(); this.restoreVideoTracks = null; }
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
    this.releaseHold();
    this.disposed = true; this.active = false; clearInterval(this.timer);
    this.stream.dispose();
    for (const remove of this.listeners) remove();
    this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove();
    this.restoreVideoTracks?.(); this.restoreVideoTracks = null;
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
