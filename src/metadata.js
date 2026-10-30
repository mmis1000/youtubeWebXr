// Spherical Video V2: https://github.com/google/spatial-media/blob/master/docs/spherical-video-v2-rfc.md
const ascii = (b, p, n = 4) => String.fromCharCode(...b.subarray(p, p + n));
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const MAX_INIT_BYTES = 2 * 1024 * 1024;
const MAX_MESH_BYTES = 4 * 1024 * 1024;

export function boxes(bytes, start = 0, end = bytes.length) {
  const out = [], d = view(bytes);
  for (let p = start; p + 8 <= end;) {
    let size = d.getUint32(p), header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = Number(d.getBigUint64(p + 8)); header = 16;
    } else if (size === 0) size = end - p;
    if (!Number.isSafeInteger(size) || size < header) throw new Error('Invalid MP4 box size.');
    if (p + size > end) break;
    out.push({ type: ascii(bytes, p + 4), start: p, body: p + header, end: p + size });
    p += size;
  }
  return out;
}

function equi(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0) throw new Error('Unsupported equirectangular metadata.');
  const d = view(bytes);
  const bounds = Array.from({ length: 4 }, (_, i) => d.getUint32(4 + i * 4) / 2 ** 32);
  if (bounds[0] + bounds[1] >= 1 || bounds[2] + bounds[3] >= 1) throw new Error('Invalid projection bounds.');
  return { type: 'equirectangular', bounds };
}

function mp4Metadata(bytes) {
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const entries = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01']);
  function descend(start, end, depth = 0) {
    if (depth > 10) throw new Error('MP4 nesting limit exceeded.');
    for (const box of boxes(bytes, start, end)) {
      if (containers.has(box.type) || box.type === 'stsd') {
        const result = descend(box.body + (box.type === 'stsd' ? 8 : 0), box.end, depth + 1);
        if (result) return result;
      }
      if (!entries.has(box.type)) continue;
      const children = boxes(bytes, box.body + 78, box.end);
      const stereo = children.find(x => x.type === 'st3d');
      let stereoMode = 0;
      if (stereo) {
        if (stereo.end - stereo.body < 5 || bytes[stereo.body] !== 0) throw new Error('Unsupported stereo metadata.');
        stereoMode = bytes[stereo.body + 4];
      }
      const sv3d = children.find(x => x.type === 'sv3d');
      if (!sv3d) return { container: 'MP4', stereoMode, projection: null, pose: [0, 0, 0] };
      const proj = boxes(bytes, sv3d.body, sv3d.end).find(x => x.type === 'proj');
      if (!proj) throw new Error('Projection box is missing.');
      const items = boxes(bytes, proj.body, proj.end);
      const pose = [0, 0, 0];
      const prhd = items.find(x => x.type === 'prhd');
      if (prhd) {
        if (prhd.end - prhd.body < 16 || bytes[prhd.body] !== 0) throw new Error('Unsupported projection pose.');
        for (let i = 0; i < 3; i++) pose[i] = view(bytes).getInt32(prhd.body + 4 + i * 4) / 65536;
      }
      const data = items.find(x => ['equi', 'mshp', 'ytmp', 'cbmp'].includes(x.type));
      const payload = data && bytes.slice(data.body, data.end);
      const projection = !data ? null : data.type === 'equi' ? equi(payload)
        : data.type === 'cbmp' ? { type: 'unsupported-cubemap' } : { type: 'mesh', payload };
      return { container: 'MP4', stereoMode, projection, pose };
    }
    return null;
  }
  return descend(0, bytes.length);
}

function vint(bytes, p, keepMarker = false) {
  if (p >= bytes.length || !bytes[p]) return null;
  const length = Math.clz32(bytes[p]) - 23;
  if (length > 8 || p + length > bytes.length) return null;
  let value = keepMarker ? bytes[p] : bytes[p] & (255 >> length);
  let unknown = !keepMarker && value === (255 >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[p + i];
    unknown = unknown && bytes[p + i] === 255;
  }
  return { length, value, unknown };
}

export function elements(bytes, start = 0, end = bytes.length) {
  const out = [];
  for (let p = start; p < end;) {
    const id = vint(bytes, p, true);
    if (!id || id.length > 4) break;
    const size = vint(bytes, p + id.length);
    if (!size) break;
    const body = p + id.length + size.length;
    const stop = size.unknown ? end : body + size.value;
    // Segment may contain media bytes beyond the captured initialization prefix.
    if (stop > end && id.value !== 0x18538067) break;
    out.push({ id: id.value, start: p, body, end: Math.min(stop, end) });
    p = stop;
  }
  return out;
}

function webmMetadata(bytes) {
  const masters = new Set([0x18538067, 0x1654ae6b, 0xae]);
  const uint = x => {
    let n = 0;
    for (let p = x.body; p < x.end; p++) n = n * 256 + bytes[p];
    return n;
  };
  function descend(start, end, depth = 0) {
    if (depth > 8) throw new Error('WebM nesting limit exceeded.');
    for (const el of elements(bytes, start, end)) {
      if (masters.has(el.id)) {
        const result = descend(el.body, el.end, depth + 1);
        if (result) return result;
      }
      if (el.id !== 0xe0) continue;
      const children = elements(bytes, el.body, el.end);
      const stereo = children.find(x => x.id === 0x53b8);
      const stereoMode = stereo ? ({ 0: 0, 1: 2, 3: 1, 11: 4, 15: 3 }[uint(stereo)] ?? -1) : 0;
      const proj = children.find(x => x.id === 0x7670);
      if (!proj) return { container: 'WebM', stereoMode, projection: null, pose: [0, 0, 0] };
      const items = elements(bytes, proj.body, proj.end);
      const type = items.find(x => x.id === 0x7671);
      const data = items.find(x => x.id === 0x7672);
      const payload = data ? bytes.slice(data.body, data.end) : new Uint8Array(20);
      const kind = type ? uint(type) : 0;
      const projection = kind === 1 ? equi(payload) : kind === 3 ? { type: 'mesh', payload }
        : kind === 2 ? { type: 'unsupported-cubemap' } : null;
      const pose = [0x7673, 0x7674, 0x7675].map(id => {
        const x = items.find(item => item.id === id);
        if (!x) return 0;
        const d = view(bytes);
        const n = x.end - x.body === 4 ? d.getFloat32(x.body) : x.end - x.body === 8 ? d.getFloat64(x.body) : NaN;
        if (!Number.isFinite(n)) throw new Error('Invalid projection pose.');
        return n;
      });
      return { container: 'WebM', stereoMode, projection, pose };
    }
    return null;
  }
  return descend(0, bytes.length);
}

export function isInitStart(bytes) {
  return (bytes.length >= 4 && view(bytes).getUint32(0) === 0x1a45dfa3)
    || (bytes.length >= 8 && ['ftyp', 'moov'].includes(ascii(bytes, 4)));
}

export function readMetadata(bytes) {
  if (bytes.length < 8) return null;
  return view(bytes).getUint32(0) === 0x1a45dfa3 ? webmMetadata(bytes) : mp4Metadata(bytes);
}

export class InitCollector {
  bytes = new Uint8Array();
  done = false;
  push(chunk) {
    if (isInitStart(chunk)) { this.bytes = new Uint8Array(); this.done = false; }
    if (this.done) return null;
    const count = Math.min(chunk.length, MAX_INIT_BYTES - this.bytes.length);
    const combined = new Uint8Array(this.bytes.length + count);
    combined.set(this.bytes); combined.set(chunk.subarray(0, count), this.bytes.length);
    this.bytes = combined;
    const metadata = readMetadata(combined);
    if (metadata || combined.length === MAX_INIT_BYTES) { this.done = true; this.bytes = new Uint8Array(); }
    return metadata;
  }
}

class Bits {
  constructor(bytes, bit = 0) { this.bytes = bytes; this.bit = bit; }
  read(count) {
    if (this.bit + count > this.bytes.length * 8) throw new Error('Truncated mesh.');
    let n = 0;
    for (let i = 0; i < count; i++, this.bit++) n = n * 2 + ((this.bytes[this.bit >> 3] >> (7 - (this.bit & 7))) & 1);
    return n;
  }
  align() { this.bit = Math.ceil(this.bit / 8) * 8; }
}
const signed = n => n % 2 ? -(n + 1) / 2 : n / 2;
function mesh(bytes) {
  const d = view(bytes);
  const coordinateCount = d.getUint32(0);
  if (!coordinateCount || coordinateCount > 10000) throw new Error('Invalid mesh coordinate count.');
  const coordinates = Array.from({ length: coordinateCount }, (_, i) => d.getFloat32(4 + i * 4));
  if (coordinates.some(x => !Number.isFinite(x))) throw new Error('Invalid mesh coordinate.');
  const vertexCount = d.getUint32(4 + coordinateCount * 4);
  if (!vertexCount || vertexCount > 32000) throw new Error('Invalid mesh vertex count.');
  const bits = new Bits(bytes, (8 + coordinateCount * 4) * 8);
  const vertices = new Float32Array(vertexCount * 5), last = [0, 0, 0, 0, 0];
  const width = Math.ceil(Math.log2(coordinateCount * 2));
  for (let i = 0; i < vertices.length; i++) {
    const axis = i % 5;
    last[axis] += signed(bits.read(width));
    if (last[axis] < 0 || last[axis] >= coordinateCount) throw new Error('Invalid mesh coordinate index.');
    vertices[i] = coordinates[last[axis]];
  }
  bits.align();
  const count = bits.read(32), parts = [];
  if (!count || count > 32) throw new Error('Invalid mesh part count.');
  let total = 0;
  for (let part = 0; part < count; part++) {
    const texture = bits.read(8), mode = bits.read(8), length = bits.read(32);
    total += length;
    if (texture !== 0 || mode > 2 || !length || total > 128000) throw new Error('Unsupported mesh part.');
    const data = new Float32Array(length * 5);
    let index = 0;
    for (let i = 0; i < length; i++) {
      index += signed(bits.read(Math.ceil(Math.log2(vertexCount * 2))));
      if (index < 0 || index >= vertexCount) throw new Error('Invalid mesh vertex index.');
      data.set(vertices.subarray(index * 5, index * 5 + 5), i * 5);
    }
    bits.align(); parts.push({ mode, data });
  }
  return parts;
}

export async function decodeMesh(payload) {
  if (payload.length < 12 || payload[0] !== 0) throw new Error('Unsupported mesh metadata.');
  const encoding = ascii(payload, 8);
  let raw = payload.subarray(12);
  if (encoding === 'dfl8') {
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_MESH_BYTES) throw new Error('Mesh exceeds size limit.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    raw = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { raw.set(c, offset); offset += c.length; }
  } else if (encoding !== 'raw ') throw new Error('Unknown mesh compression.');
  if (raw.length > MAX_MESH_BYTES) throw new Error('Mesh exceeds size limit.');
  const meshes = boxes(raw).filter(x => x.type === 'mesh').map(x => mesh(raw.subarray(x.body, x.end)));
  if (meshes.length < 1 || meshes.length > 2) throw new Error('Expected one or two projection meshes.');
  return meshes;
}
