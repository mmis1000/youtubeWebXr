import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { boxes } from '../src/metadata.js';
import { box, concat, spatialBoxes } from './fixtures.mjs';

await mkdir('test-output', { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'color=black:s=640x320:r=10,drawbox=x=0:y=0:w=320:h=160:c=red:t=fill,drawbox=x=0:y=160:w=320:h=160:c=yellow:t=fill,drawbox=x=320:y=0:w=320:h=160:c=blue:t=fill,drawbox=x=320:y=160:w=320:h=160:c=lime:t=fill',
  '-t', '30', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-g', '10',
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
const emulation = await build({ stdin: { contents: `import { XRDevice, metaQuest3 } from 'iwer';
  window.testDevice = new XRDevice(metaQuest3, { stereoEnabled: true });
  window.testDevice.installRuntime({ forceInstall: true });`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const userscript = process.argv.includes('--userscript');
const extension = await readFile(userscript ? 'dist/youtube-webxr.user.js' : 'dist/youtube-xr.js', 'utf8');
const artifactPrefix = userscript ? 'userscript-' : '';
const fixture = `<!doctype html><html><head><title>WebXR stereo fixture</title></head>
  <body style="background:#202b3d;color:white;font:18px system-ui;padding:30px">
  <h1>VR180 stereo fixture</h1><p>Left eye: red above yellow. Right eye: blue above green.</p>
  <video class="html5-main-video" muted loop controls style="width:640px"></video>
  <script>
  (async()=>{const v=document.querySelector('video');const m=new MediaSource();v.src=URL.createObjectURL(m);
  await new Promise(r=>m.addEventListener('sourceopen',r,{once:true}));
  const s=m.addSourceBuffer('video/mp4; codecs="avc1.42c01e"');
  const bytes=await(await fetch('/eyes.mp4')).arrayBuffer();
  const done=new Promise(r=>s.addEventListener('updateend',r,{once:true}));s.appendBuffer(bytes);await done;m.endOfStream();await v.play();})();
  </script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/eyes.mp4') { res.setHeader('Content-Type', 'video/mp4'); res.end(media); }
  else if (req.url?.startsWith('/src/')) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL(`..${req.url}`, import.meta.url))); }
    catch { res.writeHead(404); res.end(); }
  } else { res.setHeader('Content-Type', 'text/html'); res.end(fixture); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ content: `${emulation.outputFiles[0].text}\n${extension}` });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'WebXR', exact: true }).click();
  await page.getByText('MP4: equirectangular, left-right stereo.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Eye preview', exact: true }).click();
  await page.getByText('Eye preview: left eye on the left, right eye on the right.').waitFor();
  await page.screenshot({ path: `test-output/${artifactPrefix}eye-preview.png` });
  // Check actual video decoding, texture orientation and eye crops through WebGL pixels.
  const pixels = await page.evaluate(async () => {
    const { VideoRenderer, sphere } = await import('/src/render.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const renderer = new VideoRenderer(canvas, { meshes: [sphere()], stereoMode: 2, pose: [0, 0, 0] });
    const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const projection = new Float32Array([1,0,0,0,0,1,0,0,0,0,-1.002,-1,0,0,-0.02002,0]);
    renderer.upload(document.querySelector('video'));
    const colors = [];
    for (const eye of ['left', 'right']) {
      renderer.clear(); renderer.draw(eye, {x:0,y:0,width:256,height:256}, projection, identity);
      for (const y of [192,64]) { const pixel = new Uint8Array(4); renderer.gl.readPixels(128,y,1,1,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,pixel); colors.push([...pixel]); }
    }
    renderer.dispose(); return colors;
  });
  assert.ok(pixels[0][0] > 200 && pixels[0][1] < 30 && pixels[0][2] < 30, `left top red: ${pixels[0]}`);
  assert.ok(pixels[1][0] > 200 && pixels[1][1] > 200 && pixels[1][2] < 30, `left bottom yellow: ${pixels[1]}`);
  assert.ok(pixels[2][2] > 200 && pixels[2][0] < 30, `right top blue: ${pixels[2]}`);
  assert.ok(pixels[3][1] > 200 && pixels[3][0] < 30 && pixels[3][2] < 30, `right bottom green: ${pixels[3]}`);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await page.getByText('VR active. Select to pause or play; squeeze to recenter.').waitFor();
  assert.equal(await page.evaluate(() => !!window.testDevice.activeSession), true);
  await page.screenshot({ path: `test-output/${artifactPrefix}xr-session.png` });
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-start')));
  await page.waitForFunction(() => !window.testDevice.activeSession);
  await page.waitForFunction(() => document.querySelector('#youtube-webxr').shadowRoot.querySelectorAll('canvas').length === 0);
  await page.getByRole('button', { name: 'Show diagnostics' }).click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Playback diagnostics' }).inputValue());
  assert.equal(report.webxr.immersiveVR, true);
  assert.equal(report.selectedMode, 'auto');
  assert.deepEqual(errors, []);
  await writeFile(`test-output/${artifactPrefix}browser-result.json`, JSON.stringify({ result: 'passed', pixels, diagnostics: report }, null, 2));
  console.log(`${userscript ? 'Userscript' : 'Extension'} bundle checks passed: real MSE playback, metadata detection, eye colors/orientation, IWER immersive session, navigation cleanup.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
