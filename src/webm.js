import { elements } from './metadata.js';

function uint(bytes, element) {
  if (!element || element.end <= element.body || element.end - element.body > 8) throw new Error('Missing or invalid WebM index value.');
  let value = 0;
  for (let p = element.body; p < element.end; p++) value = value * 256 + bytes[p];
  if (!Number.isSafeInteger(value)) throw new Error('WebM index value exceeds supported range.');
  return value;
}

export function readWebMIndex(bytes, initBytes, format) {
  const segment = elements(initBytes).find(e => e.id === 0x18538067);
  if (!segment) throw new Error('The WebM stream has no segment header.');
  const children = elements(initBytes, segment.body, segment.end);
  const info = children.find(e => e.id === 0x1549a966), tracks = children.find(e => e.id === 0x1654ae6b);
  if (!info || !tracks) throw new Error('The WebM stream is missing timing or track information.');
  const timing = elements(initBytes, info.body, info.end);
  const scaleElement = timing.find(e => e.id === 0x2ad7b1);
  const scale = (scaleElement ? uint(initBytes, scaleElement) : 1000000) / 1e9;
  const durationElement = timing.find(e => e.id === 0x4489);
  let duration = Number(format.approxDurationMs) / 1000;
  if (durationElement) {
    const d = new DataView(initBytes.buffer, initBytes.byteOffset, initBytes.byteLength);
    const length = durationElement.end - durationElement.body;
    duration = (length === 4 ? d.getFloat32(durationElement.body) : length === 8 ? d.getFloat64(durationElement.body) : NaN) * scale;
  }
  const contentLength = Number(format.contentLength);
  if (!(scale > 0) || !Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error('Invalid WebM timing or file size.');
  const videoTracks = elements(initBytes, tracks.body, tracks.end).filter(e => e.id === 0xae).map(e => elements(initBytes, e.body, e.end))
    .filter(items => uint(initBytes, items.find(e => e.id === 0x83)) === 1);
  if (videoTracks.length !== 1) throw new Error('Expected one WebM video track.');
  const track = uint(initBytes, videoTracks[0].find(e => e.id === 0xd7));
  const cues = elements(bytes).find(e => e.id === 0x1c53bb6b);
  if (!cues) throw new Error('The WebM stream has no cue index.');
  const points = elements(bytes, cues.body, cues.end).filter(e => e.id === 0xbb).map(point => {
    const items = elements(bytes, point.body, point.end);
    const position = items.filter(e => e.id === 0xb7).map(e => elements(bytes, e.body, e.end))
      .find(items => uint(bytes, items.find(e => e.id === 0xf7)) === track);
    if (!position) return null;
    return { time: uint(bytes, items.find(e => e.id === 0xb3)) * scale,
      start: segment.body + uint(bytes, position.find(e => e.id === 0xf1)) };
  }).filter(Boolean);
  if (!points.length) throw new Error('The WebM index has no video cues.');
  const indexStart = Number(format.indexRange.start);
  // Cues may precede all clusters (YouTube) or follow them (ordinary WebM files).
  const mediaEnd = indexStart > points.at(-1).start ? indexStart : contentLength;
  return points.map((point, i) => {
    const next = points[i + 1] || { start: mediaEnd, time: duration };
    if (!Number.isSafeInteger(point.start) || point.start < segment.body || next.start > contentLength || next.start <= point.start
      || !Number.isFinite(point.time) || point.time < 0 || next.time <= point.time) throw new Error('Invalid WebM cue order or bounds.');
    return { start: point.start, end: next.start - 1, time: point.time, duration: next.time - point.time };
  });
}
