import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { boxes } from '../src/metadata.js';
import { box, concat, spatialBoxes } from './fixtures.mjs';
import { indexedWebM } from './webm-fixture.mjs';

await mkdir('test-output', { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'color=black:s=1440x720:r=10,drawbox=x=0:y=0:w=720:h=360:c=red:t=fill,drawbox=x=0:y=360:w=720:h=360:c=yellow:t=fill,drawbox=x=720:y=0:w=720:h=360:c=blue:t=fill,drawbox=x=720:y=360:w=720:h=360:c=lime:t=fill',
  '-t', '30', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '4.0', '-g', '10',
  '-pix_fmt', 'yuv420p', '-movflags', 'empty_moov+frag_keyframe+default_base_moof', 'test-output/eyes.mp4']);
function inject(bytes) {
  const parents = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  return concat(...boxes(bytes).map(b => {
    const body = bytes.subarray(b.body, b.end);
    if (parents.has(b.type)) return box(b.type, inject(body));
    if (b.type === 'stsd') return box(b.type, body.subarray(0, 8), inject(body.subarray(8)));
    if (b.type === 'avc1') return box(b.type, body, spatialBoxes());
    return bytes.subarray(b.start, b.end);
  }));
}
const media = inject(new Uint8Array(await readFile('test-output/eyes.mp4')));
const stereoFixtures = new Map();
for (const height of [720, 1080]) {
  const file = `test-output/indexed-${height}.mp4`;
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i','test-output/eyes.mp4',
    '-vf',`scale=${height * 2}:${height}`,'-c:v','libx264','-profile:v','baseline','-level','4.0','-g','10',
    '-movflags','empty_moov+frag_keyframe+default_base_moof+global_sidx',file]);
  const bytes = inject(new Uint8Array(await readFile(file)));
  const index = boxes(bytes).find(b => b.type === 'sidx');
  assert.ok(index, 'fixture has a global segment index');
  stereoFixtures.set(height, { bytes, format: { itag:height, width:height * 2, height, fps:10, projectionType:'MESH',
    mimeType:'video/mp4; codecs="avc1.42c028"', url:`https://fixture.googlevideo.com/media?height=${height}`,
    initRange:{start:'0',end:String(index.start - 1)}, indexRange:{start:String(index.start),end:String(index.end - 1)} } });
}
execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i','test-output/eyes.mp4',
  '-vf','scale=2880:1440','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-g','10','-cluster_time_limit','1000','test-output/indexed-1440.webm']);
stereoFixtures.set(1440,indexedWebM(new Uint8Array(await readFile('test-output/indexed-1440.webm')),1440));
const emulation = await build({ stdin: { contents: `import { XRDevice, metaQuest3 } from 'iwer';
  window.testDevice = new XRDevice(metaQuest3, { stereoEnabled: true });
  window.testDevice.installRuntime({ forceInstall: true });`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const userscript = process.argv.includes('--userscript');
const extension = await readFile(userscript ? 'dist/youtube-webxr.user.js' : 'dist/youtube-xr.js', 'utf8');
const artifactPrefix = userscript ? 'userscript-' : '';
const fixture = `<!doctype html><html><head><title>WebXR stereo fixture</title></head>
  <body style="background:#202b3d;color:white;font:18px system-ui;padding:30px">
  <h1>VR180 stereo fixture</h1><p>Left eye: red above yellow. Right eye: blue above green.</p>
  <div id="movie_player" style="position:relative"><video class="html5-main-video" muted loop controls style="width:640px"></video>
  <div class="ytp-right-controls"><button class="ytp-fullscreen-button">Fullscreen</button></div></div>
  <script>
  (async()=>{const v=document.querySelector('video');const m=new MediaSource();v.src=URL.createObjectURL(m);
  await new Promise(r=>m.addEventListener('sourceopen',r,{once:true}));
  const s=m.addSourceBuffer('video/mp4; codecs="avc1.42c028"');
  const bytes=await(await fetch('/eyes.mp4')).arrayBuffer();
  const done=new Promise(r=>s.addEventListener('updateend',r,{once:true}));s.appendBuffer(bytes);await done;m.endOfStream();await v.play();})();
  </script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/eyes.mp4' || req.url === '/plain.mp4') { res.setHeader('Content-Type', 'video/mp4'); res.end(req.url === '/eyes.mp4' ? media : await readFile('test-output/eyes.mp4')); }
  else if (req.url?.startsWith('/src/')) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL(`..${req.url}`, import.meta.url))); }
    catch { res.writeHead(404); res.end(); }
  } else { res.setHeader('Content-Type', 'text/html'); res.end(req.url?.startsWith('/watch') ? fixture.replace('/eyes.mp4','/plain.mp4') : fixture); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ content: `${emulation.outputFiles[0].text}\n${extension}` });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'VR details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  await page.getByRole('button', { name: 'Eye preview', exact: true }).click();
  await page.locator('#youtube-webxr canvas').waitFor();
  await page.screenshot({ path: `test-output/${artifactPrefix}eye-preview.png` });
  // Check actual video decoding, texture orientation and eye crops through WebGL pixels.
  const readPixels = async selector => {
    const { VideoRenderer, sphere } = await import('/src/render.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const renderer = new VideoRenderer(canvas, { meshes: [sphere()], stereoMode: 2, pose: [0, 0, 0] });
    const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const projection = new Float32Array([1,0,0,0,0,1,0,0,0,0,-1.002,-1,0,0,-0.02002,0]);
    renderer.upload(document.querySelector(selector));
    const colors = [];
    for (const eye of ['left', 'right']) {
      renderer.clear(); renderer.draw(eye, {x:0,y:0,width:256,height:256}, projection, identity);
      for (const y of [192,64]) { const pixel = new Uint8Array(4); renderer.gl.readPixels(128,y,1,1,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,pixel); colors.push([...pixel]); }
    }
    renderer.dispose(); return colors;
  };
  const pixels = await page.evaluate(readPixels, 'video');
  assert.ok(pixels[0][0] > 200 && pixels[0][1] < 30 && pixels[0][2] < 30, `left top red: ${pixels[0]}`);
  assert.ok(pixels[1][0] > 200 && pixels[1][1] > 200 && pixels[1][2] < 30, `left bottom yellow: ${pixels[1]}`);
  assert.ok(pixels[2][2] > 200 && pixels[2][0] < 30, `right top blue: ${pixels[2]}`);
  assert.ok(pixels[3][1] > 200 && pixels[3][0] < 30 && pixels[3][2] < 30, `right bottom green: ${pixels[3]}`);
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await page.getByRole('button', { name: 'Exit VR', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#youtube-webxr').shadowRoot.querySelector('[aria-label="VR source resolution"]').disabled);
  assert.equal(await page.evaluate(() => !!window.testDevice.activeSession), true);
  await page.screenshot({ path: `test-output/${artifactPrefix}xr-session.png` });
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-start')));
  await page.waitForFunction(() => !window.testDevice.activeSession);
  await page.waitForFunction(() => document.querySelector('#youtube-webxr').shadowRoot.querySelectorAll('canvas').length === 0);
  await page.getByRole('button', { name: 'VR details', exact: true }).click();
  await page.getByRole('button', { name: 'Show diagnostics' }).click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Playback diagnostics' }).inputValue());
  assert.equal(report.webxr.immersiveVR, true);
  assert.equal(report.selectedMode, 'auto');
  assert.deepEqual(errors, []);
  await writeFile(`test-output/${artifactPrefix}browser-result.json`, JSON.stringify({ result: 'passed', pixels, diagnostics: report }, null, 2));
  await page.close();
  const ux = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const uxErrors = [];
  ux.on('pageerror', e => uxErrors.push(e.message));
  await ux.addInitScript({ content: `${emulation.outputFiles[0].text}\nlocalStorage.setItem('youtube-webxr:last-resolution','240');\n${extension}` });
  await ux.addInitScript(() => {
    window.ytcfg = { get: () => 'fixture-visitor' };
    localStorage.setItem('youtube-webxr:last-resolution','240');
    window.xrSessions = 0; window.xrText = []; window.xrProbe = {}; window.panelDraws = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(...args) {
      const ctx = getContext.apply(this,args);
      if(args[0] === '2d' && !ctx.__observed) {
        ctx.__observed = true;
        const fillText = ctx.fillText.bind(ctx), clearRect = ctx.clearRect.bind(ctx);
        ctx.clearRect = (...a) => { if(a[0]===0&&a[1]===0&&a[2]===1024) window.xrText=[]; return clearRect(...a); };
        ctx.fillText = (...a) => { window.xrText.push(String(a[0])); return fillText(...a); };
      }
      if ((args[0] === 'webgl' || args[0] === 'webgl2') && ctx && !ctx.__observed) {
        ctx.__observed = true;
        const draw = ctx.drawArrays.bind(ctx);
        ctx.drawArrays = (...args) => {
          const program = ctx.getParameter(ctx.CURRENT_PROGRAM);
          const textured = program && ctx.getUniformLocation(program, 'textured');
          if (textured && ctx.getUniform(program, textured)) window.panelDraws++;
          return draw(...args);
        };
      }
      return ctx;
    };
    const request = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = async(...args) => {
      if(window.rejectVR) throw new DOMException('VR permission was not granted.','NotAllowedError');
      const s = await request(...args);
      window.lastSession = s; window.xrSessions++;
      if(window.delayVR) await new Promise(r => window.releaseVR = r);
      const space = await s.requestReferenceSpace('local');
      const tick = (_,f) => {
        const viewer = f.getViewerPose(space);
        const input = [...s.inputSources].find(x=>x.handedness==='right');
        const ray = input && f.getPose(input.targetRaySpace,space);
        if(viewer) window.xrProbe.viewer=Array.from(viewer.transform.matrix);
        if(ray) window.xrProbe.ray=Array.from(ray.transform.matrix);
        s.requestAnimationFrame(tick);
      };
      s.requestAnimationFrame(tick); return s;
    };
  });
  let failSegments = false, mediaRedirects = 0, playerRequests = 0, headerRequests = 0;
  await ux.route('**/youtubei/v1/player?*', route => { playerRequests++; return route.fulfill({ json: { playabilityStatus:{status:'OK'},
    streamingData:{adaptiveFormats:[...[...stereoFixtures.values()].map(f=>f.format),
      {...stereoFixtures.get(720).format,height:240}, {...stereoFixtures.get(720).format,height:480},
      {...stereoFixtures.get(1080).format,height:2160,projectionType:'RECTANGULAR'},
      {...stereoFixtures.get(1080).format,height:2880,mimeType:'video/mp4; codecs="unsupported"'},
      {...stereoFixtures.get(1080).format,height:4320,url:'https://fixture.googlevideo.com/flat'},
      {...stereoFixtures.get(1080).format,height:5760,indexRange:undefined}]} } }); });
  await ux.route('https://fixture.googlevideo.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/flat') return route.fulfill({contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(box('ftyp',Buffer.from('isom'),new Uint8Array(4)))});
    assert.equal(url.searchParams.get('alr'), 'yes');
    url.hostname = 'destination.googlevideo.com'; mediaRedirects++;
    return route.fulfill({ contentType:'text/plain', headers:{'Access-Control-Allow-Origin':'*'}, body:url.href });
  });
  await ux.route('https://destination.googlevideo.com/**', route => {
    const url = new URL(route.request().url()), f = stereoFixtures.get(Number(url.searchParams.get('height')));
    const [start,end] = url.searchParams.get('range').split('-').map(Number);
    if (start <= Number(f.format.indexRange.end)) headerRequests++;
    const failed = failSegments && start > Number(f.format.indexRange.end);
    return route.fulfill({ status:failed?503:200, headers:{'Access-Control-Allow-Origin':'*'}, contentType:f.format.mimeType.split(';')[0], body:failed?'unavailable':Buffer.from(f.bytes.subarray(start,end+1)) });
  });
  await ux.goto(`http://127.0.0.1:${server.address().port}/watch?v=abcdefghijk`);
  await ux.waitForFunction(()=>document.querySelector('video').readyState>=2);
  await ux.evaluate(()=>{
    const settings=document.createElement('button');settings.className='ytp-settings-button';settings.textContent='YouTube settings';settings.setAttribute('aria-expanded','false');
    settings.onclick=()=>settings.setAttribute('aria-expanded',String(settings.getAttribute('aria-expanded')!=='true'));
    document.querySelector('.ytp-right-controls').append(settings);
  });
  await ux.getByRole('button',{name:'VR details',exact:true}).click();
  await ux.getByRole('button',{name:'YouTube settings',exact:true}).click();
  assert.equal(await ux.getByRole('button',{name:'Close details',exact:true}).isVisible(),false,'YouTube settings closes VR details');
  await ux.getByRole('button',{name:'VR details',exact:true}).click();
  assert.equal(await ux.locator('.ytp-settings-button').getAttribute('aria-expanded'),'false','VR details closes YouTube settings');
  await ux.evaluate(()=>{const root=document.querySelector('#movie_player');root.style.width='320px';root.querySelector('video').style.width='100%';root.querySelector('.ytp-right-controls').style.height='48px'});
  await ux.waitForFunction(()=>{
    const root=document.querySelector('#movie_player').getBoundingClientRect(),details=document.querySelector('#youtube-webxr').shadowRoot.querySelector('.details').getBoundingClientRect();
    return details.left>=root.left&&details.right<=root.right&&details.top>=root.top;
  });
  await ux.screenshot({path:`test-output/${artifactPrefix}page-narrow.png`});
  await ux.getByRole('button',{name:'Close details',exact:true}).click();
  await ux.evaluate(()=>{const root=document.querySelector('#movie_player');root.style.width='';root.querySelector('video').style.width='640px'});
  assert.equal(await ux.getByRole('button',{name:'WebXR',exact:true}).count(),0);
  assert.equal(await ux.getByLabel('VR source resolution').isVisible(),false);
  assert.equal(await ux.locator('.ytp-right-controls').getByRole('button',{name:'Enter VR',exact:true}).count(),1);
  await ux.evaluate(()=>window.rejectVR=true);
  await ux.getByRole('button',{name:'Enter VR',exact:true}).click();
  await ux.getByText('VR permission was not granted.',{exact:true}).waitFor();
  assert.equal(await ux.getByLabel('VR source resolution').isVisible(),false);
  await ux.evaluate(()=>{window.rejectVR=false;window.delayVR=true});
  await ux.getByRole('button',{name:'Enter VR',exact:true}).click();
  await ux.waitForFunction(()=>!!window.releaseVR);
  await ux.getByRole('button',{name:'Cancel VR',exact:true}).click();
  await ux.evaluate(()=>{window.delayVR=false;window.releaseVR()});
  await ux.waitForFunction(()=>!window.testDevice.activeSession);
  await ux.getByRole('button',{name:'Enter VR',exact:true}).click();
  const ready = height => ux.waitForFunction(h => {
    const v=document.querySelector('video[data-youtube-webxr-stereo]');
    return v?.videoHeight===h && !v.seeking && document.querySelector('#youtube-webxr').shadowRoot.querySelector('select').value===String(h);
  },height);
  await ready(720);
  const initialPlayerRequests = playerRequests, initialHeaderRequests = headerRequests;
  assert.deepEqual(await ux.getByLabel('VR source resolution').locator('option').evaluateAll(options=>options.map(o=>o.value)),['720','1080','1440'],'only validated VR sources appear');
  assert.equal(await ux.evaluate(()=>localStorage.getItem('youtube-webxr:last-resolution')),'720');
  await ux.waitForFunction(()=>window.xrProbe.ray && window.xrText.some(t=>t.includes('720p · Stereo 180°')));
  const sessionCount = await ux.evaluate(()=>window.xrSessions);
  const aim = async(x,y) => {
    await ux.evaluate(async({x,y})=>{
      const m=window.xrProbe.viewer, r=window.xrProbe.ray, c=window.testDevice.controllers.right;
      const {anchorMatrix,transform}=await import('/src/xr-math.js');
      const heading=Math.atan2(m[8],m[10]), tilt=20*Math.PI/180;
      const desired=transform(anchorMatrix(m),[(x/1024-.5)*1.28,(.5-y/312)*.39,1.4]);
      c.position.set(c.position.x+desired[0]-r[12],c.position.y+desired[1]-r[13],c.position.z+desired[2]-r[14]);
      c.quaternion.set(-Math.cos(heading/2)*Math.sin(tilt/2),Math.sin(heading/2)*Math.cos(tilt/2),Math.sin(heading/2)*Math.sin(tilt/2),Math.cos(heading/2)*Math.cos(tilt/2));
    },{x,y});
    await ux.waitForTimeout(120);
  };
  const trigger = async value => { await ux.evaluate(v=>window.testDevice.controllers.right.updateButtonValue('trigger',v),value); await ux.waitForTimeout(120); };
  const clickVR = async(x,y) => {await aim(x,y);await trigger(1);await trigger(0)};
  const expectHidden = async () => {
    const count = await ux.evaluate(()=>window.panelDraws);
    await ux.waitForTimeout(350);
    assert.equal(await ux.evaluate(()=>window.panelDraws),count,'hidden panel is not drawn');
  };
  await clickVR(1100,100);
  await expectHidden();
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),false,'hiding UI preserves playback');
  await ux.screenshot({path:`test-output/${artifactPrefix}xr-ui-hidden.png`});
  const hiddenDraws = await ux.evaluate(()=>window.panelDraws);
  await clickVR(512,240);
  await ux.waitForFunction(n=>window.panelDraws>n,hiddenDraws);
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),false,'showing UI over Play/Pause does not activate it');
  await clickVR(938,68);
  await expectHidden();
  await clickVR(1100,100);
  await clickVR(512,240);
  await ux.waitForFunction(()=>document.querySelector('video').paused);
  await ux.evaluate(()=>{document.querySelector('video').currentTime=5});
  await ux.waitForFunction(()=>!document.querySelector('video').seeking);
  await ux.getByLabel('VR source resolution').selectOption('1080');
  await ready(1080);
  assert.equal(await ux.evaluate(()=>window.xrSessions),sessionCount);
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),true);
  assert.ok(Math.abs(await ux.evaluate(()=>document.querySelector('video').currentTime)-5)<.1);
  await ux.getByLabel('VR source resolution').selectOption('1440');
  await ready(1440);
  const webmPixels = await ux.evaluate(readPixels, 'video[data-youtube-webxr-stereo]');
  assert.ok(webmPixels[0][0]>200 && webmPixels[0][2]<30 && webmPixels[2][2]>200 && webmPixels[2][0]<30,'WebM decodes distinct left/right eye colors');
  assert.ok(webmPixels[1][0]>200 && webmPixels[1][1]>200 && webmPixels[3][1]>200 && webmPixels[3][0]<30,'WebM preserves vertical orientation');
  assert.equal(await ux.evaluate(()=>window.xrSessions),sessionCount,'MP4 to WebM retains the XR session');
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),true);
  await clickVR(620,240);
  await ux.waitForFunction(()=>document.querySelector('video').currentTime>14.9 && !document.querySelector('video[data-youtube-webxr-stereo]').seeking);
  await clickVR(404,240);
  await ux.waitForFunction(()=>document.querySelector('video').currentTime<5.1 && !document.querySelector('video[data-youtube-webxr-stereo]').seeking);
  await clickVR(775,240);
  await ux.waitForFunction(()=>window.xrText.includes('720p'));
  await clickVR(312,240);
  await ready(720);
  await clickVR(104,240);
  assert.equal(await ux.evaluate(()=>window.xrSessions),sessionCount);
  await ux.evaluate(()=>window.testDevice.controllers.right.updateAxes('thumbstick',1,0));
  await ux.waitForFunction(()=>document.querySelector('video').currentTime>14.9);
  await ux.waitForTimeout(450);
  assert.ok(await ux.evaluate(()=>document.querySelector('video').currentTime<15.1),'held stick seeks only once');
  await ux.evaluate(()=>window.testDevice.controllers.right.updateAxes('thumbstick',0,0));
  await ux.waitForFunction(()=>!window.xrText.includes('Seeking…') && !document.querySelector('video[data-youtube-webxr-stereo]').seeking);
  await ux.evaluate(()=>{window.seekCount=0;document.querySelector('video').addEventListener('seeking',()=>window.seekCount++)});
  await aim(200,120); await trigger(1); await aim(600,120);
  assert.equal(await ux.evaluate(()=>window.seekCount),0,'dragging does not seek until release');
  await trigger(0);
  await ux.waitForFunction(()=>window.seekCount===1 && !document.querySelector('video').seeking);
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),true);
  await clickVR(148,240);
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),true,'recenter does not trigger background play');
  await clickVR(938,68);
  await expectHidden();
  const failureDraws = await ux.evaluate(()=>window.panelDraws);
  assert.equal(playerRequests,initialPlayerRequests,'quality changes reuse the player response');
  assert.equal(headerRequests,initialHeaderRequests,'quality changes reuse validated headers and indexes');
  failSegments=true;
  await ux.getByLabel('VR source resolution').selectOption('1080');
  await ux.waitForFunction(()=>window.xrText.includes('Retry'));
  assert.ok(await ux.evaluate(()=>window.xrText.includes('1080p ▾')),'failure names the retry resolution');
  await ux.waitForFunction(n=>window.panelDraws>n,failureDraws);
  assert.equal(await ux.evaluate(()=>window.xrSessions),sessionCount);
  assert.equal(await ux.evaluate(()=>localStorage.getItem('youtube-webxr:last-resolution')),'720','failed quality is not persisted');
  failSegments=false;
  await clickVR(512,240);
  await ready(1080);
  assert.ok(playerRequests>initialPlayerRequests,'retry refreshes formats after a media failure');
  assert.equal(await ux.evaluate(()=>document.querySelector('video').paused),true);
  await ux.screenshot({path:`test-output/${artifactPrefix}xr-controls.png`});
  await clickVR(921,240);
  await ux.waitForFunction(()=>!window.testDevice.activeSession);
  assert.equal(await ux.locator('video[data-youtube-webxr-stereo]').count(),0);
  assert.equal(await ux.getByLabel('VR source resolution').isVisible(),false);
  // Replacing YouTube's control bar must reattach exactly one entry.
  await ux.evaluate(()=>document.querySelector('.ytp-right-controls').innerHTML='<div><button class="ytp-fullscreen-button">Fullscreen</button></div>');
  await ux.locator('.ytp-right-controls').getByRole('button',{name:'Enter VR',exact:true}).waitFor();
  assert.equal(await ux.locator('.youtube-webxr-entry').count(),1);
  assert.deepEqual(uxErrors,[]);
  assert.ok(mediaRedirects > 0, 'stereo playback follows CDN text redirects');
  await writeFile(`test-output/${artifactPrefix}ux-browser-result.json`,JSON.stringify({result:'passed',sessionCount,webmPixels,checks:['permission refusal','cancelled late session','closest resolution','validated VR quality list','MP4/WebM switching and seeking','page quality switch','headset quality switch','controller pause','thumbstick latch','scrub on release','recenter consumption','error/retry','clean exit','control reattachment']},null,2));
  await ux.close();
  const unsupported = await browser.newPage();
  await unsupported.addInitScript({content:`Object.defineProperty(navigator,'xr',{value:{isSessionSupported:async()=>false},configurable:true});\n${extension}`});
  await unsupported.goto(`http://127.0.0.1:${server.address().port}`);
  await unsupported.getByRole('button',{name:'VR details',exact:true}).click();
  await unsupported.getByText('Immersive VR is unavailable in this browser. Eye preview is available below.',{exact:true}).waitFor();
  assert.equal(await unsupported.getByRole('button',{name:'Enter VR',exact:true}).isDisabled(),true);
  await unsupported.close();
  console.log(`${userscript ? 'Userscript' : 'Extension'} bundle checks passed: real MSE playback, metadata detection, eye colors/orientation, IWER immersive session, navigation cleanup.`);
} catch (error) {
  const p = browser.contexts().at(-1)?.pages()[0];
  if (p) {
    console.error(await p.evaluate(() => ({ text: document.querySelector('#youtube-webxr')?.shadowRoot?.textContent,
      xr: window.xrText, videos:[...document.querySelectorAll('video')].map(v=>({t:v.currentTime,paused:v.paused,seeking:v.seeking,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,error:v.error?.message,buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)])})) })).catch(()=>null));
    await p.screenshot({path:`test-output/${artifactPrefix}browser-failure.png`}).catch(()=>{});
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
