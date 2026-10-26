import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InitCollector, decodeMesh, readMetadata } from '../src/metadata.js';
import { sphere, uvTransform } from '../src/render.js';
import { mp4, webm, meshProjection, concat } from './fixtures.mjs';

test('MP4 and WebM agree on stereo packing and cropped VR180 bounds', () => {
  for (const bytes of [mp4(), webm()]) {
    const m = readMetadata(bytes);
    assert.equal(m.stereoMode, 2);
    assert.deepEqual(m.projection.bounds, [0, 0, 0.25, 0.25]);
    assert.deepEqual(m.pose, [0, 0, 0]);
  }
});
test('initialization data survives every possible two-chunk split', () => {
  for (const bytes of [mp4(), webm()]) for (let i = 1; i < bytes.length; i++) {
    const collector = new InitCollector();
    const a = collector.push(bytes.subarray(0, i));
    const b = collector.push(bytes.subarray(i));
    assert.equal((b || a)?.stereoMode, 2, `split ${i}`);
  }
});
test('a new initialization segment replaces prior stereo metadata', () => {
  const c = new InitCollector();
  assert.equal(c.push(mp4()).stereoMode, 2);
  assert.equal(c.push(new Uint8Array(100)), null);
  assert.equal(c.push(mp4(0)).stereoMode, 0);
});
test('raw and deflated mesh decoding preserve both custom eye UVs', async () => {
  for (const compressed of [false, true]) {
    const p = meshProjection(compressed, true);
    const meshes = await decodeMesh(p.subarray(8));
    assert.equal(meshes.length, 2);
    assert.deepEqual(Array.from(meshes[0][0].data.slice(0, 5)), [-1, -1, -1, 0, 0]);
    assert.deepEqual(Array.from(meshes[1][0].data.slice(0, 5)), [-1, -1, -1, 0.5, 0]);
    assert.equal(meshes[0][0].data.length, 30);
  }
});
test('invalid mesh indices and oversized tables fail instead of allocating freely', async () => {
  const p = meshProjection().subarray(8);
  const broken = p.slice(); broken.fill(255, 20, 24);
  await assert.rejects(decodeMesh(broken), /coordinate count/);
  await assert.rejects(decodeMesh(p.subarray(0, 10)), /metadata/);
  await assert.rejects(decodeMesh(concat(new Uint8Array(8), Buffer.from('bad!'))), /compression/);
});
test('eye crop transforms preserve top-bottom orientation and right-left order', () => {
  assert.deepEqual(uvTransform(1, 'left'), [1, 0.5, 0, 0.5]);
  assert.deepEqual(uvTransform(1, 'right'), [1, 0.5, 0, 0]);
  assert.deepEqual(uvTransform(2, 'right'), [0.5, 1, 0.5, 0]);
  assert.deepEqual(uvTransform(4, 'left'), [0.5, 1, 0.5, 0]);
  assert.deepEqual(uvTransform(3, 'right'), [1, 1, 0, 0]);
});
test('VR180 geometry covers the front hemisphere with the top of the frame above', () => {
  const data = sphere()[0].data;
  for (let i = 0; i < data.length; i += 5) {
    assert.ok(data[i + 2] <= 0.00001);
    if (data[i + 4] === 1) assert.ok(data[i + 1] > 0.99);
  }
});
