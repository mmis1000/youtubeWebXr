import { deflateRawSync } from 'node:zlib';
export const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map(x => Buffer.from(x))));
export const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export const box = (type, ...parts) => {
  const body = concat(...parts);
  return concat(u32(body.length + 8), Buffer.from(type), body);
};
export function equiBox(bounds = [0, 0, 0.25, 0.25]) {
  return box('equi', new Uint8Array(4), ...bounds.map(x => u32(x * 2 ** 32)));
}
export function spatialBoxes(stereo = 2, projection = equiBox()) {
  return concat(box('st3d', new Uint8Array(4), [stereo]),
    box('sv3d', box('svhd', new Uint8Array(4), Buffer.from('test\0')),
      box('proj', box('prhd', new Uint8Array(16)), projection)));
}
export function mp4(stereo = 2, projection = equiBox()) {
  return concat(box('ftyp', Buffer.from('isom'), new Uint8Array(4)),
    box('moov', box('trak', box('mdia', box('minf', box('stbl',
      box('stsd', new Uint8Array(4), u32(1), box('avc1', new Uint8Array(78), spatialBoxes(stereo, projection)))))))));
}
class Writer {
  bits = [];
  write(n, count) { for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(n / 2 ** i) % 2); }
  align() { while (this.bits.length % 8) this.bits.push(0); }
  bytes() { this.align(); const b = new Uint8Array(this.bits.length / 8); this.bits.forEach((v, i) => b[i >> 3] |= v << (7 - (i & 7))); return b; }
}
export function meshBox(u0 = 0, u1 = 1) {
  const coords = [-1, 0, 1, u0, u1];
  const vertices = [[-1, -1, -1, u0, 0], [1, -1, -1, u1, 0], [-1, 1, -1, u0, 1], [1, 1, -1, u1, 1]];
  const floats = Buffer.alloc(coords.length * 4); coords.forEach((x, i) => floats.writeFloatBE(x, i * 4));
  const b = new Writer(), last = [0, 0, 0, 0, 0];
  for (const vertex of vertices) vertex.forEach((v, axis) => {
    const index = coords.indexOf(v), delta = index - last[axis]; last[axis] = index;
    b.write(delta < 0 ? -delta * 2 - 1 : delta * 2, 4);
  });
  b.align(); b.write(1, 32); b.write(0, 8); b.write(0, 8); b.write(6, 32);
  let previous = 0;
  for (const index of [0, 1, 2, 1, 3, 2]) {
    const delta = index - previous; previous = index; b.write(delta < 0 ? -delta * 2 - 1 : delta * 2, 3);
  }
  return box('mesh', u32(coords.length), floats, u32(vertices.length), b.bytes());
}
export function meshProjection(compressed = false, custom = false) {
  const raw = custom ? concat(meshBox(0, 0.5), meshBox(0.5, 1)) : meshBox();
  return box('mshp', new Uint8Array(8), Buffer.from(compressed ? 'dfl8' : 'raw '), compressed ? deflateRawSync(raw) : raw);
}
export const ebml = (id, data) => {
  const hex = id.toString(16); const key = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  const size = data.length < 127 ? [0x80 | data.length] : [0x40 | (data.length >> 8), data.length & 255];
  return concat(key, size, data);
};
export function webm() {
  return concat(ebml(0x1a45dfa3, []), ebml(0x18538067, ebml(0x1654ae6b, ebml(0xae,
    ebml(0xe0, concat(ebml(0x53b8, [1]), ebml(0x7670, concat(ebml(0x7671, [1]),
      ebml(0x7672, equiBox().subarray(8))))))))));
}
