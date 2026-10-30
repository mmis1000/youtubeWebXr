import { elements } from '../src/metadata.js';
import { concat, ebml, equiBox } from './fixtures.mjs';

export const uint = value => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; };
export const segmentHeader = new Uint8Array([0x18,0x53,0x80,0x67,1,255,255,255,255,255,255,255]);
export const cues = points => ebml(0x1c53bb6b, concat(...points.map(p => ebml(0xbb, concat(
  ebml(0xb3, uint(p.time)), ebml(0xb7, concat(ebml(0xf7, [1]), ebml(0xf1, uint(p.offset)))))))));

export function indexedWebM(bytes, height) {
  const top = elements(bytes), segment = top.find(e => e.id === 0x18538067);
  const children = elements(bytes, segment.body, segment.end);
  const copy = e => bytes.slice(e.start, e.end);
  function tracks(start, end) {
    return concat(...elements(bytes, start, end).map(e => {
      if ([0x1654ae6b,0xae].includes(e.id)) return ebml(e.id, tracks(e.body,e.end));
      if (e.id !== 0xe0) return copy(e);
      return ebml(e.id, concat(...elements(bytes,e.body,e.end).filter(e=>![0x53b8,0x7670].includes(e.id)).map(copy),
        ebml(0x53b8,[1]), ebml(0x7670,concat(ebml(0x7671,[1]),ebml(0x7672,equiBox().subarray(8))))));
    }));
  }
  const header = copy(top.find(e=>e.id===0x1a45dfa3));
  const info = copy(children.find(e=>e.id===0x1549a966));
  const track = children.find(e=>e.id===0x1654ae6b);
  const init = concat(header,segmentHeader,info,tracks(track.start,track.end));
  const clusters = children.filter(e=>e.id===0x1f43b675);
  const points = clusters.map(e=>{
    const t=elements(bytes,e.body,e.end).find(e=>e.id===0xe7);
    let time=0; for(let p=t.body;p<t.end;p++) time=time*256+bytes[p];
    return {time,offset:0};
  });
  let offset=init.length-header.length-segmentHeader.length+cues(points).length;
  clusters.forEach((e,i)=>{points[i].offset=offset;offset+=e.end-e.start});
  const index=cues(points), output=concat(init,index,...clusters.map(copy));
  return {bytes:output,format:{itag:height,width:height*2,height,fps:10,projectionType:'MESH',mimeType:'video/webm; codecs="vp9"',
    url:`https://fixture.googlevideo.com/media?height=${height}`,initRange:{start:'0',end:String(init.length-1)},
    indexRange:{start:String(init.length),end:String(init.length+index.length-1)},contentLength:String(output.length),approxDurationMs:'30000'}};
}
