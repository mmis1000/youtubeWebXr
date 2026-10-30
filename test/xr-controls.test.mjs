import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity, anchorMatrix, panelIntersection, seekTarget, thumbstickDirection, transform } from '../src/xr-math.js';
import { closestFormats } from '../src/youtube.js';
import { XRControls } from '../src/xr-ui.js';

test('resolution selection finds the nearest eligible height and breaks ties downward', () => {
  const f = height => ({ height, url: 'https://test.googlevideo.com/media', projectionType: 'MESH', mimeType: 'video/mp4; codecs="avc1"' });
  assert.deepEqual(closestFormats([f(2160), f(720), f(1080)], 1440, () => true).map(f => f.height), [1080,720,2160]);
  assert.equal(closestFormats([f(1440), f(720)], 1080, () => true)[0].height, 720);
  assert.equal(closestFormats([f(2160)], 1080, () => true)[0].height, 2160);
  assert.equal(closestFormats([{...f(2160), mimeType:'video/webm; codecs="vp9"'}, f(1080)], 2160, () => true)[0].height, 2160);
  assert.deepEqual(closestFormats([f(240),f(480),f(720),f(1080)],240,()=>true).map(f=>f.height),[720,1080]);
});
test('panel hit testing uses the anchored position and rejects rays from behind', () => {
  const viewer = identity(); viewer[13] = 1.6;
  const panel = anchorMatrix(viewer), ray = identity(); ray[13] = .95;
  const hit = panelIntersection(ray, panel);
  assert.ok(hit.inside); assert.ok(Math.abs(hit.x - 512) < .001); assert.ok(Math.abs(hit.y - 156) < .001);
  ray[14] = -2; assert.equal(panelIntersection(ray, panel), null);
  ray[14] = 0; ray[12] = 2; assert.equal(panelIntersection(ray, panel).inside, false);
});

test('tilted panel rays map to the same pixels as the rendered controls', () => {
  const viewer=identity(),heading=.7;viewer[8]=Math.sin(heading);viewer[10]=Math.cos(heading);viewer[13]=1.6;
  const panel=anchorMatrix(viewer);
  for(const [x,y] of [[128,150],[512,240],[938,68]]) {
    const origin=transform(panel,[(x/1024-.5)*1.28,(.5-y/312)*.39,1]);
    const ray=panel.slice();ray[12]=origin[0];ray[13]=origin[1];ray[14]=origin[2];
    const hit=panelIntersection(ray,panel);
    assert.ok(hit.inside);assert.ok(Math.abs(hit.x-x)<.001);assert.ok(Math.abs(hit.y-y)<.001);
  }
});
test('thumbstick seeks once per deflection and seeking clamps at video bounds', () => {
  assert.deepEqual(thumbstickDirection([0,0,1,0], false), {latched:true,step:10});
  assert.deepEqual(thumbstickDirection([0,0,1,0], true), {latched:true,step:0});
  assert.deepEqual(thumbstickDirection([0,0,-1,0], true), {latched:true,step:0});
  assert.deepEqual(thumbstickDirection([0,0,0,0], true), {latched:false,step:0});
  assert.deepEqual(thumbstickDirection([0,0,-1,0], false), {latched:true,step:-10});
  assert.equal(seekTarget(5,-10,30),0); assert.equal(seekTarget(29,10,30),29.99);
});

test('UI visibility consumes trigger input and cancels pending panel gestures', () => {
  const controls = Object.create(XRControls.prototype), source = {}, other = {}, actions = [];
  Object.assign(controls, {visible:true,menu:true,anchor:identity(),pointers:new Map([[source,{hit:null}]]),presses:new Map(),
    getState:()=>({duration:30}),action:(...args)=>actions.push(args)});
  const trigger = () => { for(const type of ['selectstart','selectend','select']) controls.input(type,source); };
  trigger(); assert.equal(controls.visible,false); assert.equal(controls.menu,false);
  assert.equal(controls.hit(identity()),null);
  trigger(); assert.equal(controls.visible,true); assert.deepEqual(actions,[]);
  controls.pointers.get(source).hit={id:'hide-ui'};
  controls.presses.set(other,{hit:{id:'seek',ratio:.5},down:true});
  trigger();
  controls.input('selectend',other); controls.input('select',other);
  assert.equal(controls.visible,false); assert.equal(controls.presses.size,0); assert.deepEqual(actions,[]);
});

test('new playback errors reveal hidden controls once', () => {
  const controls = Object.create(XRControls.prototype);
  const state = {busy:false,error:''}; let paints=0;
  Object.assign(controls,{visible:false,pointers:new Map(),presses:new Map(),sticks:new Map(),getState:()=>state,paint:()=>paints++});
  controls.update(null,null,[],0); assert.equal(paints,0);
  state.error='Media failed'; controls.update(null,null,[],1); assert.equal(controls.visible,true);
  controls.setVisible(false); controls.update(null,null,[],2); assert.equal(controls.visible,false);
  state.error=''; state.busy=true; controls.update(null,null,[],3); assert.equal(controls.visible,true);
});
