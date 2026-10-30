import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWebMIndex } from '../src/webm.js';
import { concat, ebml } from './fixtures.mjs';
import { uint, cues, segmentHeader } from './webm-fixture.mjs';

function fixture(points = [{time:0,offset:400},{time:2000,offset:600}]) {
  const duration = Buffer.alloc(8); duration.writeDoubleBE(5000);
  const header = ebml(0x1a45dfa3, []);
  const init = concat(header,segmentHeader,
    ebml(0x1549a966,concat(ebml(0x2ad7b1,uint(1000000)),ebml(0x4489,duration))),
    ebml(0x1654ae6b,ebml(0xae,concat(ebml(0xd7,[1]),ebml(0x83,[1])))));
  const origin = header.length+segmentHeader.length;
  const format = {indexRange:{start:init.length},contentLength:origin+900};
  return {init,index:cues(points),format,origin};
}

test('WebM cues use Segment-relative byte positions and nanosecond time scale', () => {
  const f=fixture();
  assert.deepEqual(readWebMIndex(f.index,f.init,f.format),[
    {start:f.origin+400,end:f.origin+599,time:0,duration:2},
    {start:f.origin+600,end:f.origin+899,time:2,duration:3}
  ]);
  f.format.indexRange.start=f.origin+800;
  assert.equal(readWebMIndex(f.index,f.init,f.format).at(-1).end,f.origin+799,'trailing Cues are excluded from media');
});

test('WebM cue parsing rejects truncated indices, missing tracks, reversed cues and unsafe offsets', () => {
  const f=fixture();
  assert.throws(()=>readWebMIndex(f.index.slice(0,-1),f.init,f.format),/no cue index/);
  assert.throws(()=>readWebMIndex(f.index,f.init.slice(0,-1),f.format),/track information/);
  for (const points of [[{time:2000,offset:400},{time:0,offset:600}], [{time:0,offset:600},{time:2000,offset:400}], [{time:0,offset:1000}], [{time:0,offset:Number.MAX_SAFE_INTEGER}]]) {
    const invalid=fixture(points);
    assert.throws(()=>readWebMIndex(invalid.index,invalid.init,invalid.format),/bounds/);
  }
});
