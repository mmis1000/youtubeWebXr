import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const emulator = await build({ stdin: { contents: `import { XRDevice, metaQuest3 } from 'iwer';
window.testDevice = new XRDevice(metaQuest3, {stereoEnabled:true}); window.testDevice.installRuntime({forceInstall:true});`,
  resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
try {
  await mkdir('test-output', {recursive:true});
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('response', r => { const u = new URL(r.url()); if (u.hostname.endsWith('.googlevideo.com') && u.searchParams.get('c') === 'VISIONOS') console.log('VR response',r.status(),r.headers()['content-type'],r.headers()['content-length'],u.searchParams.get('range')); });
  await page.addInitScript({content: emulator.outputFiles[0].text + '\n' + await readFile('dist/youtube-xr.js','utf8')});
  await page.goto('https://www.youtube.com/watch?v=yVLssFEqKmo', {waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForSelector('video.html5-main-video', {state:'attached'});
  await page.evaluate(()=>{const v=document.querySelector('video.html5-main-video');v.muted=true;v.play().catch(()=>{});});
  await page.waitForFunction(()=>document.querySelector('video.html5-main-video')?.videoWidth > 0,null,{timeout:30000});
  await page.getByRole('button',{name:'WebXR',exact:true}).click();
  await page.getByRole('button',{name:'Load stereo stream',exact:true}).click();
  await page.getByText('VR stream — MP4: mesh, left-right stereo.',{exact:true}).waitFor({timeout:35000});
  await page.getByRole('button',{name:'Eye preview',exact:true}).click();
  await page.getByText('Eye preview: left eye on the left, right eye on the right.').waitFor();
  await page.waitForFunction(()=>document.querySelector('video[data-youtube-webxr-stereo]')?.readyState >= 2,null,{timeout:30000});
  await page.screenshot({path:'test-output/youtube-stereo-preview.png'});
  await page.evaluate(()=>{document.querySelector('video.html5-main-video').currentTime=90;});
  await page.waitForFunction(()=>{
    const v=document.querySelector('video[data-youtube-webxr-stereo]');
    return v?.readyState>=3 && v.currentTime>91 && Math.abs(document.querySelector('video.html5-main-video').currentTime-v.currentTime)<0.2;
  },null,{timeout:30000});
  await page.evaluate(()=>document.querySelector('video.html5-main-video').pause());
  await page.waitForFunction(()=>document.querySelector('video[data-youtube-webxr-stereo]').paused);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('button',{name:'Enter VR',exact:true}).click();
  await page.getByText('VR active. Select to pause or play; squeeze to recenter.').waitFor({timeout:30000});
  assert.equal(await page.evaluate(()=>!!window.testDevice.activeSession),true);
  await page.waitForFunction(()=>document.querySelector('video[data-youtube-webxr-stereo]')?.readyState >= 2);
  await page.evaluate(() => new Promise(resolve => {
    const session = window.testDevice.activeSession;
    session.requestAnimationFrame(() => session.requestAnimationFrame(resolve));
  }));
  await page.screenshot({path:'test-output/youtube-xr.png'});
  await page.getByRole('button',{name:'Show diagnostics',exact:true}).click();
  const report=JSON.parse(await page.getByRole('textbox',{name:'Playback diagnostics'}).inputValue());
  assert.equal(report.stereoStream.stereoMode,2);
  assert.equal(report.stereoStream.meshCount,2);
  assert.equal(report.stereoStream.width,1920);
  assert.equal(report.stereoStream.height,1080);
  await page.evaluate(()=>document.dispatchEvent(new Event('yt-navigate-start')));
  await page.waitForFunction(()=>!window.testDevice.activeSession && !document.querySelector('[data-youtube-webxr-stereo]'));
  await writeFile('test-output/youtube-result.json',JSON.stringify({result:'passed',report},null,2));
  console.log('Live reference passed: VR API request, stereo header, 1080p decode, two meshes, playback beyond 90 seconds, seek/pause synchronization, emulated WebXR, cleanup.');
} catch(error) {
  const page=browser.contexts()[0]?.pages()[0];
  if(page) { await page.screenshot({path:'test-output/youtube-failure.png'}).catch(()=>{});
    console.error(await page.locator('#youtube-webxr p').allTextContents().catch(()=>[]));
    console.error('Original YouTube player:', await page.locator('.ytp-error-content-wrap').allTextContents().catch(()=>[])); }
  throw error;
} finally { await browser.close(); }
