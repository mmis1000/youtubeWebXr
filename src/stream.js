import { boxes } from './metadata.js';

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
  const response = await fetch(url, { credentials: 'omit', signal });
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

function event(target, name, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeEventListener(name, ok); target.removeEventListener('error', bad); signal.removeEventListener('abort', bad); };
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(signal.reason || new Error(`Media ${name} failed.`)); };
    if (signal.aborted) { bad(); return; }
    target.addEventListener(name, ok, { once: true }); target.addEventListener('error', bad, { once: true }); signal.addEventListener('abort', bad, { once: true });
  });
}

export class RangeStream {
  constructor(video, result, targetTime, onError, signal) {
    this.video = video; this.result = result; this.targetTime = targetTime; this.onError = onError;
    this.controller = new AbortController(); this.active = false; this.busy = false;
    this.parentSignal = signal; this.abortFromParent = () => this.dispose();
    signal?.addEventListener('abort', this.abortFromParent, { once: true });
    if (signal?.aborted) this.controller.abort(signal.reason);
    this.ready = this.initialize();
  }
  async initialize() {
    const { format, initBytes } = this.result, signal = this.controller.signal;
    if (!MediaSource.isTypeSupported(format.mimeType)) throw new Error('This browser cannot decode the selected stereo format.');
    if (!format.indexRange) throw new Error('This stereo format has no byte-range index.');
    const start = Number(format.indexRange.start), end = Number(format.indexRange.end);
    this.segments = readIndex(await fetchRange(format.url, start, end, signal), start);
    const media = this.media = new MediaSource();
    this.objectURL = URL.createObjectURL(media);
    const opened = event(media, 'sourceopen', signal);
    this.video.src = this.objectURL; await opened;
    signal.throwIfAborted();
    this.buffer = media.addSourceBuffer(format.mimeType);
    await this.append(initBytes);
    const last = this.segments.at(-1); media.duration = last.time + last.duration;
    this.video.currentTime = Math.min(this.targetTime(), media.duration - 0.01);
    this.timer = setInterval(() => this.pump(), 400);
    this.pump();
  }
  async append(bytes) {
    const done = event(this.buffer, 'updateend', this.controller.signal);
    this.buffer.appendBuffer(bytes); await done;
  }
  async pump() {
    if (!this.active || this.busy || this.controller.signal.aborted || !this.buffer || this.media.readyState !== 'open') return;
    this.busy = true;
    try {
      const target = this.targetTime(); let until = target;
      const ranges = this.buffer.buffered;
      for (let i = 0; i < ranges.length; i++) if (target >= ranges.start(i) - 0.05 && target < ranges.end(i)) until = ranges.end(i);
      if (until < target + 8) {
        const segment = this.segments.find(s => s.time + s.duration > until + 0.03);
        if (segment) {
          const bytes = await fetchRange(this.result.format.url, segment.start, segment.end, this.controller.signal);
          await this.append(bytes);
        }
      }
      if (ranges.length && ranges.start(0) < target - 25) {
        const done = event(this.buffer, 'updateend', this.controller.signal);
        this.buffer.remove(0, target - 15); await done;
      }
      if (this.buffer.buffered.length && this.buffer.buffered.end(this.buffer.buffered.length - 1) > target + 45) {
        const done = event(this.buffer, 'updateend', this.controller.signal);
        this.buffer.remove(target + 30, this.media.duration); await done;
      }
    } catch (error) {
      if (!this.controller.signal.aborted) { this.active = false; this.onError(error); }
    } finally { this.busy = false; }
  }
  setActive(value) { this.active = value; if (value) this.pump(); }
  dispose() {
    this.controller.abort(); clearInterval(this.timer);
    this.parentSignal?.removeEventListener('abort', this.abortFromParent);
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
  }
}
