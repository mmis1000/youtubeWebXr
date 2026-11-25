import { boxes } from './metadata.js';
import { fetchMedia } from './media.js';
import { readWebMIndex } from './webm.js';
import { OWN_MEDIA_SOURCE } from './observe.js';

export function readIndex(bytes, absoluteOffset) {
  const box = boxes(bytes).find(x => x.type === 'sidx');
  if (!box) throw new Error('The MP4 stream has no segment index.');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), version = bytes[box.body];
  if (version > 1) throw new Error('Unsupported segment index version.');
  const timescale = d.getUint32(box.body + 8);
  if (!timescale) throw new Error('Invalid segment timescale.');
  let p = box.body + 12;
  const integer = () => {
    const n = version ? Number(d.getBigUint64(p)) : d.getUint32(p); p += version ? 8 : 4;
    if (!Number.isSafeInteger(n)) throw new Error('Segment offset exceeds supported range.');
    return n;
  };
  let time = integer() / timescale, offset = absoluteOffset + box.end + integer();
  const count = d.getUint16(p + 2); p += 4;
  if (!count || p + count * 12 > box.end) throw new Error('Invalid segment index length.');
  const segments = [];
  for (let i = 0; i < count; i++, p += 12) {
    const reference = d.getUint32(p), duration = d.getUint32(p + 4) / timescale;
    if (reference >= 2 ** 31 || !reference || !duration) throw new Error('Nested or empty segment references are unsupported.');
    segments.push({ start: offset, end: offset + reference - 1, time, duration });
    offset += reference; time += duration;
  }
  return segments;
}

export async function fetchRange(rawURL, start, end, signal) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > 64 * 1024 * 1024) throw new Error('Invalid media byte range.');
  const url = new URL(rawURL); url.searchParams.set('range', `${start}-${end}`);
  const response = await fetchMedia(url, signal);
  if (!response.ok) throw new Error(`Stereo media request failed (${response.status}). YouTube rejected this segment; try loading the stereo stream again.`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > end - start + 1) throw new Error('The media server returned more data than the requested range.');
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  if (size !== end - start + 1) throw new Error('The media server returned an incomplete range.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function loadIndex(format, initBytes, signal) {
  if (!format.indexRange) throw new Error('This stereo format has no byte-range index.');
  const start = Number(format.indexRange.start), end = Number(format.indexRange.end);
  const bytes = await fetchRange(format.url, start, end, signal);
  const isWebM = /^(video|audio)\/webm(;|$)/.test(format.mimeType);
  const trackType = format.mimeType.startsWith('audio/') ? 2 : 1;
  return isWebM ? readWebMIndex(bytes, initBytes, format, trackType) : readIndex(bytes, start);
}

function event(target, name, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeEventListener(name, ok); target.removeEventListener('error', bad); signal.removeEventListener('abort', bad); };
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(signal.reason || new Error(`Media ${name} failed.`)); };
    if (signal.aborted) { bad(); return; }
    target.addEventListener(name, ok, { once: true }); target.addEventListener('error', bad, { once: true }); signal.addEventListener('abort', bad, { once: true });
  });
}

export class TrackFeeder {
  constructor(media, buffer, format, segments, targetTime, onError, signal, options = {}) {
    this.media = media; this.buffer = buffer; this.format = format; this.segments = segments;
    this.targetTime = targetTime; this.onError = onError; this.signal = signal;
    this.fetchSegment = options.fetchSegment || ((seg, sig) => fetchRange(this.format.url, seg.start, seg.end, sig));
    this.targetAhead = options.targetAhead ?? 18;
    this.maxPrefetch = options.maxPrefetch ?? 2;
    this.active = false; this.busy = false;
    this.prefetchMap = new Map(); // index -> { controller, promise }
  }
  bufferedUntil(target) {
    const ranges = this.buffer.buffered;
    let until = target;
    for (let i = 0; i < ranges.length; i++) {
      if (target >= ranges.start(i) - 0.1 && target < ranges.end(i)) { until = ranges.end(i); break; }
    }
    return until;
  }
  nextIndex(until) {
    return this.segments.findIndex(s => s.time + s.duration > until + 0.03);
  }
  startPrefetch(fromIndex, target) {
    if (fromIndex < 0) return;
    const keepEnd = Math.min(this.segments.length - 1, fromIndex + this.maxPrefetch);
    this.abortOutside(fromIndex, keepEnd);
    for (let i = fromIndex; i < this.segments.length && i < fromIndex + this.maxPrefetch; i++) {
      const seg = this.segments[i];
      if (i > fromIndex && seg.time >= target + this.targetAhead) break;
      if (this.prefetchMap.has(i)) continue;
      const controller = new AbortController();
      const onParentAbort = () => controller.abort(this.signal.reason);
      this.signal.addEventListener('abort', onParentAbort, { once: true });
      const promise = this.fetchSegment(seg, controller.signal).finally(() => {
        this.signal.removeEventListener('abort', onParentAbort);
      });
      // Prevent unhandled rejections if this prefetch is later aborted or dropped before being awaited.
      promise.catch(() => {});
      this.prefetchMap.set(i, { controller, promise });
    }
  }
  abortOutside(minIndex, maxIndex) {
    for (const [idx, entry] of this.prefetchMap) {
      if (idx < minIndex || idx > maxIndex) {
        entry.controller.abort();
        this.prefetchMap.delete(idx);
      }
    }
  }
  clearPrefetch() {
    for (const entry of this.prefetchMap.values()) entry.controller.abort();
    this.prefetchMap.clear();
  }
  async append(bytes) {
    const done = event(this.buffer, 'updateend', this.signal);
    this.buffer.appendBuffer(bytes);
    await done;
  }
  async remove(start, end) {
    if (end <= start) return;
    const done = event(this.buffer, 'updateend', this.signal);
    this.buffer.remove(start, end);
    await done;
  }
  async pump() {
    if (!this.active || this.busy || this.signal.aborted || !this.buffer || this.media.readyState !== 'open') return;
    this.busy = true;
    let shouldContinue = false;
    try {
      const target = this.targetTime();
      const ranges = this.buffer.buffered;
      if (ranges.length && ranges.start(0) < target - 20) {
        await this.remove(0, target - 12);
        shouldContinue = true;
        return;
      }
      if (ranges.length && ranges.end(ranges.length - 1) > target + 45) {
        await this.remove(target + 30, this.media.duration);
        shouldContinue = true;
        return;
      }
      const until = this.bufferedUntil(target);
      if (until < target + this.targetAhead) {
        const idx = this.nextIndex(until);
        if (idx >= 0) {
          this.startPrefetch(idx, target);
          const entry = this.prefetchMap.get(idx);
          const bytes = await entry.promise;
          this.prefetchMap.delete(idx);
          if (this.signal.aborted || !this.active || this.media.readyState !== 'open') return;
          const nowTarget = this.targetTime();
          const seg = this.segments[idx];
          // If the playhead jumped away while fetching, skip appending the stale segment and re-pump.
          if (seg.time + seg.duration < nowTarget - 1 || seg.time > nowTarget + this.targetAhead + 5) {
            shouldContinue = true;
            return;
          }
          try {
            await this.append(bytes);
          } catch (err) {
            if (err?.name !== 'QuotaExceededError') throw err;
            if (this.buffer.buffered.length) {
              await this.remove(0, Math.max(0, nowTarget - 4));
              if (this.buffer.buffered.length && this.buffer.buffered.end(this.buffer.buffered.length - 1) > nowTarget + 16) {
                await this.remove(nowTarget + 12, this.media.duration);
              }
            }
            await this.append(bytes);
          }
          const afterUntil = this.bufferedUntil(this.targetTime());
          if (afterUntil < this.targetTime() + this.targetAhead && this.nextIndex(afterUntil) >= 0) {
            this.startPrefetch(this.nextIndex(afterUntil), this.targetTime());
            shouldContinue = true;
          }
        }
      }
    } catch (error) {
      if (!this.signal.aborted && error?.name !== 'AbortError') {
        this.active = false;
        this.onError(error);
      }
    } finally {
      this.busy = false;
      if (shouldContinue && this.active && !this.signal.aborted) {
        queueMicrotask(() => this.pump());
      }
    }
  }
  setActive(value) {
    this.active = value;
    if (value) this.pump();
    else this.clearPrefetch();
  }
  onSeek() {
    this.clearPrefetch();
    if (this.active) this.pump();
  }
}

export class RangeStream {
  constructor(video, result, targetTime, onError, signal) {
    this.video = video; this.result = result; this.targetTime = targetTime; this.onError = onError;
    this.controller = new AbortController(); this.active = false; this.hasAudio = false;
    this.feeders = []; this.listeners = [];
    this.parentSignal = signal; this.abortFromParent = () => this.dispose();
    signal?.addEventListener('abort', this.abortFromParent, { once: true });
    if (signal?.aborted) this.controller.abort(signal.reason);
    this.ready = this.initialize();
  }
  async initialize() {
    const { format, initBytes, audio } = this.result, signal = this.controller.signal;
    if (!MediaSource.isTypeSupported(format.mimeType)) throw new Error('This browser cannot decode the selected stereo format.');
    this.segments = this.result.segments || await loadIndex(format, initBytes, signal);
    let audioSegments = null;
    if (audio?.format && audio.initBytes && MediaSource.isTypeSupported(audio.format.mimeType)) {
      try {
        audioSegments = audio.segments || await loadIndex(audio.format, audio.initBytes, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        audioSegments = null;
      }
    }
    signal.throwIfAborted();

    const media = this.media = new MediaSource();
    media[OWN_MEDIA_SOURCE] = true;
    this.objectURL = URL.createObjectURL(media);
    const opened = event(media, 'sourceopen', signal);
    this.video.src = this.objectURL; await opened;
    signal.throwIfAborted();

    // Create all SourceBuffers before appending any initialization segment; Chromium rejects
    // addSourceBuffer() with QuotaExceededError once another SourceBuffer has initialized.
    this.buffer = media.addSourceBuffer(format.mimeType);
    let audioBuffer = null;
    if (audioSegments) {
      try {
        audioBuffer = media.addSourceBuffer(audio.format.mimeType);
      } catch {
        audioBuffer = null;
      }
    }

    const initAppends = [
      (async () => {
        const done = event(this.buffer, 'updateend', signal);
        this.buffer.appendBuffer(initBytes);
        await done;
      })()
    ];
    if (audioBuffer) {
      initAppends.push((async () => {
        try {
          const audioDone = event(audioBuffer, 'updateend', signal);
          audioBuffer.appendBuffer(audio.initBytes);
          await audioDone;
        } catch (err) {
          if (signal.aborted) throw err;
          try { media.removeSourceBuffer(audioBuffer); } catch {}
          audioBuffer = null;
        }
      })());
    }
    await Promise.all(initAppends);
    signal.throwIfAborted();

    let duration = this.segments.at(-1).time + this.segments.at(-1).duration;
    const videoFeeder = new TrackFeeder(media, this.buffer, format, this.segments, this.targetTime, this.onError, signal);
    this.feeders.push(videoFeeder);

    if (audioBuffer && audioSegments) {
      this.audioBuffer = audioBuffer;
      this.hasAudio = true;
      duration = Math.max(duration, audioSegments.at(-1).time + audioSegments.at(-1).duration);
      this.feeders.push(new TrackFeeder(media, audioBuffer, audio.format, audioSegments, this.targetTime, this.onError, signal));
    }

    media.duration = duration;
    this.video.currentTime = Math.min(this.targetTime(), media.duration - 0.01);
    const onPump = () => this.pump();
    const onSeek = () => { for (const f of this.feeders) f.onSeek(); };
    for (const type of ['timeupdate', 'waiting']) {
      this.video.addEventListener(type, onPump);
      this.listeners.push(() => this.video.removeEventListener(type, onPump));
    }
    this.video.addEventListener('seeking', onSeek);
    this.listeners.push(() => this.video.removeEventListener('seeking', onSeek));
    this.timer = setInterval(onPump, 1000);
    if (this.active) {
      for (const f of this.feeders) f.setActive(true);
    }
  }
  pump() {
    for (const f of this.feeders) f.pump();
  }
  setActive(value) {
    this.active = value;
    for (const f of this.feeders) f.setActive(value);
  }
  dispose() {
    this.controller.abort(); clearInterval(this.timer);
    for (const f of this.feeders) f.clearPrefetch();
    for (const remove of this.listeners) remove();
    this.listeners = [];
    this.parentSignal?.removeEventListener('abort', this.abortFromParent);
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
  }
}
