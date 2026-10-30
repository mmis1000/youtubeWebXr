import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaURL, chooseFormats } from '../src/youtube.js';
test('VR format selection respects resolution, codec support and direct URLs', () => {
  const formats = [
    {itag:1,height:2160,mimeType:'video/webm; codecs="vp9"'},
    {itag:2,height:1080,mimeType:'video/mp4; codecs="avc1.640028"'},
    {itag:3,height:1080,mimeType:'video/mp4; codecs="av01.0.08M.08"'},
    {itag:4,height:720,mimeType:'video/mp4; codecs="avc1.640028"'},
    {itag:5,height:480,mimeType:'video/mp4; codecs="avc1.640028"'},
    {itag:6,height:240,mimeType:'video/webm; codecs="vp9"'}
  ].map(f=>({...f,url:'https://test.googlevideo.com/videoplayback',projectionType:'MESH'}));
  assert.deepEqual(chooseFormats(formats,1080,()=>true).map(x=>x.itag),[2,3,4]);
  assert.deepEqual(chooseFormats(formats,1080,m=>!m.includes('av01')).map(x=>x.itag),[2,4]);
  assert.deepEqual(chooseFormats(formats,2160,()=>true).map(x=>x.itag),[1,2,3,4]);
  assert.deepEqual(chooseFormats([{...formats[0],projectionType:'RECTANGULAR'},{...formats[0],drmFamilies:['test']}],2160,()=>true),[]);
  assert.equal(chooseFormats([{...formats[0],url:undefined}],4320,()=>true).length,0);
  assert.deepEqual(chooseFormats(formats,480,()=>true),[]);
});
test('stream URLs are restricted to HTTPS Google video hosts', () => {
  assert.equal(mediaURL('https://rr1.googlevideo.com/videoplayback').hostname,'rr1.googlevideo.com');
  for(const url of ['http://rr1.googlevideo.com/videoplayback','https://googlevideo.com.evil.example/','javascript:alert(1)']) assert.throws(()=>mediaURL(url));
});
