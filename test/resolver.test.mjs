import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StereoResolver } from '../src/youtube.js';

const result = expiry => ({ qualities: [720,1080], available: [720,1080].map(height => ({
  format: { height, url:`https://test.googlevideo.com/media?expire=${expiry}` }, initBytes:new Uint8Array([1]), segments:[]
})) });

test('session resolver reuses validated formats across resolutions and refreshes expired URLs', async () => {
  let requests=0, now=100000;
  const resolver=new StereoResolver(async()=>{requests++;return result(200)},()=>now);
  const signal=new AbortController().signal;
  assert.equal((await resolver.resolve('abcdefghijk',1080,signal)).format.height,1080);
  assert.equal((await resolver.resolve('abcdefghijk',720,signal)).format.height,720);
  assert.equal(requests,1);
  now=170001; await resolver.resolve('abcdefghijk',720,signal); assert.equal(requests,2);
  resolver.clear(); await resolver.resolve('abcdefghijk',720,signal); assert.equal(requests,3);
  await resolver.resolve('lmnopqrstuv',720,signal); assert.equal(requests,4);
});

test('cancelled or cleared discoveries cannot repopulate the session cache', async () => {
  let complete, requests=0;
  const resolver=new StereoResolver(()=>{requests++;return new Promise(r=>complete=r)},()=>0);
  const controller=new AbortController();
  const pending=resolver.resolve('abcdefghijk',720,controller.signal);
  controller.abort(); complete(result(1000));
  await assert.rejects(pending,{name:'AbortError'}); assert.equal(resolver.cache,null);
  const next=resolver.resolve('abcdefghijk',720,new AbortController().signal);
  resolver.clear(); complete(result(1000)); await next;
  assert.equal(resolver.cache,null); assert.equal(requests,2);
});
