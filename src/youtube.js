import { readMetadata, MAX_INIT_BYTES } from './metadata.js';
import { RangeStream } from './stream.js';

export function mediaURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) throw new Error('Unexpected media host.');
  return url;
}

export function chooseFormats(formats, maxHeight, canPlay) {
  return formats.filter(f => f.url && f.projectionType === 'MESH' && f.mimeType?.startsWith('video/mp4') && f.height <= maxHeight
    && canPlay(f.mimeType) && !f.drmFamilies?.length)
    .sort((a, b) => b.height - a.height || codecScore(b.mimeType) - codecScore(a.mimeType) || (b.fps || 0) - (a.fps || 0));
}
function codecScore(mime) { return mime.includes('avc1') ? 3 : mime.includes('vp9') ? 2 : 1; }

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

export async function resolveStereo(videoId, maxHeight, signal) {
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
  const formats = chooseFormats(data.streamingData?.adaptiveFormats || [], maxHeight, mime => probe.canPlayType(mime));
  if (!formats.length) throw new Error('No directly playable VR stream is available at this resolution.');
  let lastError;
  for (const format of formats.slice(0, 6)) {
    signal.throwIfAborted();
    try {
      const url = mediaURL(format.url);
      const end = Math.min(Number(format.initRange?.end ?? 65535), MAX_INIT_BYTES - 1);
      if (!Number.isSafeInteger(end) || end < 0) throw new Error('Invalid stream initialization range.');
      url.searchParams.set('range', `0-${end}`);
      const header = await fetch(url, { credentials: 'omit', signal });
      const initBytes = await limitedBytes(header, signal);
      const metadata = readMetadata(initBytes);
      if (!metadata?.projection || ![1, 2, 3, 4].includes(metadata.stereoMode)) throw new Error('This representation does not contain stereo projection metadata.');
      return { format, metadata, initBytes };
    } catch (error) { if (signal.aborted) throw error; lastError = error; }
  }
  throw lastError || new Error('No stereo representation could be opened.');
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
      if (Math.abs(original.currentTime - video.currentTime) > 0.15) video.currentTime = original.currentTime;
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
  dispose() {
    this.disposed = true; this.active = false; clearInterval(this.timer);
    this.stream.dispose();
    for (const remove of this.listeners) remove();
    this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove();
  }
}
