import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIndex, fetchRange } from '../src/stream.js';
import { box, u32, concat } from './fixtures.mjs';
function index(version = 0) {
  const integer = n => version ? concat(u32(0),u32(n)) : u32(n);
  return box('sidx', [version,0,0,0], u32(1), u32(1000), integer(2000), integer(16),
    [0,0,0,2], u32(100),u32(1500),u32(0),u32(200),u32(2000),u32(0));
}
test('segment indices use absolute byte offsets and their own presentation timescale', () => {
  for (const version of [0,1]) {
    const bytes = index(version);
    assert.deepEqual(readIndex(bytes,100),[
      {start:100+bytes.length+16,end:100+bytes.length+115,time:2,duration:1.5},
      {start:100+bytes.length+116,end:100+bytes.length+315,time:3.5,duration:2}
    ]);
  }
});
test('nested indices and incomplete indices are rejected', () => {
  const bytes=index(); new DataView(bytes.buffer).setUint32(32,2**31+100);
  assert.throws(()=>readIndex(bytes,0),/Nested/);
  assert.throws(()=>readIndex(bytes.subarray(0,20),0),/no segment index/);
});
test('media requests reject invalid ranges before making network calls', async () => {
  await assert.rejects(fetchRange('https://test.googlevideo.com',-1,20),/Invalid/);
  await assert.rejects(fetchRange('https://test.googlevideo.com',0,100*1024*1024),/Invalid/);
});
