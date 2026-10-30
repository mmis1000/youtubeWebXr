import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { readMetadata } from '../src/metadata.js';

const height = Number(process.argv[2] || 4320);
const duration = Number(process.env.FRAME_SAMPLE_SECONDS || 30);
const suppressSyncSeeks = process.env.FRAME_SUPPRESS_SYNC_SEEKS === '1';
const startTime = Number(process.env.FRAME_START_TIME || 30);
const outputSuffix = suppressSyncSeeks ? '-without-sync-seeks' : '';
if (![720, 1080, 1440, 2160, 4320].includes(height) || !Number.isFinite(duration) || duration < 5 || duration > 120) throw new Error('Use an available resolution and a sample duration of 5–120 seconds.');
const browser = await chromium.connectOverCDP(process.env.FRAME_CDP_URL || 'http://127.0.0.1:19222');
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('youtube.com/watch')) || await context.newPage();
const report = { requestedHeight: height, sampleSeconds: duration, startTime, suppressSyncSeeks, samples: [], decoderPlayers: {}, networkErrors: [], streamHeaders: [] };
const cdp = await context.newCDPSession(page);
cdp.on('Media.playerPropertiesChanged', ({ playerId, properties }) => {
  const selected = properties.filter(p => /Decoder|Resolution|FrameRate|VideoTracks|IsVideo|RendererName/.test(p.name));
  if (selected.length) Object.assign(report.decoderPlayers[playerId] ||= {}, Object.fromEntries(selected.map(p => [p.name, p.value])));
});
await cdp.send('Media.enable');
page.on('response', async response => {
  const url = new URL(response.url());
  if (url.hostname.endsWith('.googlevideo.com') && url.searchParams.get('c') === 'VISIONOS' && response.status() >= 400) {
    report.networkErrors.push({ status: response.status(), range: url.searchParams.get('range') });
  }
  if (url.hostname.endsWith('.googlevideo.com') && url.searchParams.get('c') === 'VISIONOS' && url.searchParams.get('range')?.startsWith('0-') && response.ok()) {
    try {
      const metadata = readMetadata(new Uint8Array(await response.body()));
      report.streamHeaders.push({ itag: url.searchParams.get('itag'), stereoMode: metadata?.stereoMode, projection: metadata?.projection?.type });
    } catch (error) { report.streamHeaders.push({ itag: url.searchParams.get('itag'), error: error.message }); }
  }
});
await mkdir('test-output', { recursive: true });
const snapshot = () => page.evaluate(() => {
  const v = document.querySelector('video[data-youtube-webxr-stereo]'), original = document.querySelector('video.html5-main-video');
  const quality = v?.getVideoPlaybackQuality();
  let bufferedAhead = 0;
  if (v) for (let i = 0; i < v.buffered.length; i++) if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) bufferedAhead = v.buffered.end(i) - v.currentTime;
  return { wallTime: performance.now() / 1000, time: v?.currentTime, originalTime: original?.currentTime,
    width: v?.videoWidth, height: v?.videoHeight, readyState: v?.readyState, paused: v?.paused,
    totalFrames: quality?.totalVideoFrames, droppedFrames: quality?.droppedVideoFrames, bufferedAhead,
    drift: v && original ? v.currentTime - original.currentTime : null, ...window.frameResolutionTest,
    originalPlayerError: document.querySelector('.ytp-error-content-wrap')?.textContent,
    status: document.querySelector('#youtube-webxr')?.shadowRoot.querySelector('p')?.textContent };
});
try {
  await page.addInitScript(height => localStorage.setItem('youtube-webxr:last-resolution', String(height)), height);
  await page.goto('https://www.youtube.com/watch?v=yVLssFEqKmo', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__youtubeWebXRLoaded && document.querySelector('video.html5-main-video')?.readyState >= 1);
  await page.evaluate(startTime => {
    const v = document.querySelector('video.html5-main-video'); v.pause(); v.currentTime = startTime;
    window.frameResolutionTest = { xrFrames: 0, poseFrames: 0, videoCallbacks: 0, stereoSeekRequests: 0, suppressedSeeks: 0 };
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...time, set(value) {
      if (this.dataset.youtubeWebxrStereo) {
        window.frameResolutionTest.stereoSeekRequests++;
        if (window.suppressStereoSyncSeeks) { window.frameResolutionTest.suppressedSeeks++; return; }
      }
      return time.set.call(this, value);
    } });
    const requestFrame = XRSession.prototype.requestAnimationFrame;
    XRSession.prototype.requestAnimationFrame = function(callback) {
      return requestFrame.call(this, (time, frame) => {
        window.frameResolutionTest.xrFrames++; window.frameResolutionTest.visibility = this.visibilityState;
        callback(time, frame);
      });
    };
    const getPose = XRFrame.prototype.getViewerPose;
    XRFrame.prototype.getViewerPose = function(space) {
      const pose = getPose.call(this, space);
      window.frameResolutionTest.views = pose?.views.map(view => view.eye) || [];
      if (pose) window.frameResolutionTest.poseFrames++;
      return pose;
    };
  }, startTime);
  const responsePromise = page.waitForResponse(r => r.url().includes('/youtubei/v1/player') && r.request().postDataJSON()?.context?.client?.clientName === 'VISIONOS');
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  const data = await (await responsePromise).json();
  report.offeredFormats = (data.streamingData?.adaptiveFormats || []).filter(f => f.mimeType?.startsWith('video/')).map(f => ({ itag: f.itag, width: f.width, height: f.height, fps: f.fps, bitrate: f.bitrate, mimeType: f.mimeType, projectionType: f.projectionType }));
  await page.waitForFunction(() => document.querySelector('video[data-youtube-webxr-stereo]')?.readyState >= 2, null, { timeout: 35000 });
  await page.getByRole('button', { name: 'VR details', exact: true }).evaluate(b=>b.click());
  await page.getByRole('button', { name: 'Show diagnostics', exact: true }).click();
  report.diagnostics = JSON.parse(await page.getByRole('textbox', { name: 'Playback diagnostics' }).inputValue());
  report.selectedFormat = report.offeredFormats.find(f => f.itag === report.diagnostics.stereoStream?.itag);
  report.capability = await page.evaluate(async f => {
    const c = document.createElement('canvas'), gl = c.getContext('webgl');
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE); gl.getExtension('WEBGL_lose_context')?.loseContext();
    const decoding = await navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: {
      contentType: f.mimeType, width: f.width, height: f.height, bitrate: f.bitrate, framerate: f.fps
    } });
    return { maxTextureSize, supported: decoding.supported, smooth: decoding.smooth, powerEfficient: decoding.powerEfficient };
  }, report.selectedFormat);
  console.log(JSON.stringify({ requestedHeight: height, selectedFormat: report.selectedFormat, capability: report.capability }));
  await page.evaluate(() => {
    const v = document.querySelector('video[data-youtube-webxr-stereo]');
    const callback = (_, metadata) => { window.frameResolutionTest.videoCallbacks++; window.frameResolutionTest.lastPresentedTime = metadata.mediaTime; v.requestVideoFrameCallback(callback); };
    v.requestVideoFrameCallback(callback);
  });
  await page.evaluate(suppress => { window.suppressStereoSyncSeeks = suppress; }, suppressSyncSeeks);
  await page.waitForFunction(() => window.frameResolutionTest.poseFrames >= 20, null, { timeout: 20000 });
  report.samples.push(await snapshot());
  for (let elapsed = 0; elapsed < duration; elapsed += 5) {
    await new Promise(resolve => setTimeout(resolve, Math.min(5, duration - elapsed) * 1000));
    const sample = await snapshot(); report.samples.push(sample);
    console.log(JSON.stringify(sample));
    if (!sample.status?.startsWith('Playing ')) throw new Error(sample.status || 'VR session ended.');
  }
  const first = report.samples[0], last = report.samples.at(-1), wall = last.wallTime - first.wallTime;
  report.measurement = { wallSeconds: wall, mediaSeconds: last.time - first.time, decodedWidth: last.width, decodedHeight: last.height,
    totalFrames: last.totalFrames - first.totalFrames, droppedFrames: last.droppedFrames - first.droppedFrames,
    presentedCallbacksPerSecond: (last.videoCallbacks - first.videoCallbacks) / wall, xrCallbacksPerSecond: (last.xrFrames - first.xrFrames) / wall,
    dropPercent: 100 * (last.droppedFrames - first.droppedFrames) / (last.totalFrames - first.totalFrames),
    maxAbsoluteSampledDriftSeconds: Math.max(...report.samples.map(s => Math.abs(s.drift))),
    finalPresentationLagSeconds: last.lastPresentedTime === undefined ? null : last.time - last.lastPresentedTime,
    readySamples: report.samples.filter(s => s.readyState >= 3).length };
  report.result = last.height === height && last.time - first.time >= wall * 0.9
    && report.measurement.presentedCallbacksPerSecond >= report.selectedFormat.fps * 0.9
    && last.readyState >= 3 ? 'played' : 'limited';
  console.log(JSON.stringify({ result: report.result, measurement: report.measurement }));
} catch (error) {
  report.result = 'failed'; report.error = error.message; report.finalState = await snapshot().catch(() => null);
  console.error(JSON.stringify({ error: report.error, finalState: report.finalState }));
}
await writeFile(`test-output/frame-${height}p${outputSuffix}.json`, JSON.stringify(report, null, 2));
await cdp.detach();
process.exit(report.result === 'failed' ? 1 : 0);
