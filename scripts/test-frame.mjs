import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.connectOverCDP(process.env.FRAME_CDP_URL || 'http://127.0.0.1:19222');
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes('youtube.com/watch')) || await context.newPage();
await mkdir('test-output', { recursive: true });
try {
  await page.goto('https://www.youtube.com/watch?v=yVLssFEqKmo', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__youtubeWebXRLoaded && document.querySelector('video.html5-main-video')?.readyState >= 1);
  await page.evaluate(() => {
    const video = document.querySelector('video.html5-main-video'); video.currentTime = 90; video.play().catch(()=>{});
    window.frameTest = { frames: 0, poseFrames: 0 };
    const requestFrame = XRSession.prototype.requestAnimationFrame;
    XRSession.prototype.requestAnimationFrame = function(callback) {
      return requestFrame.call(this, (time, frame) => {
        window.frameTest.frames++; window.frameTest.visibility = this.visibilityState;
        callback(time, frame);
      });
    };
    const getPose = XRFrame.prototype.getViewerPose;
    XRFrame.prototype.getViewerPose = function(space) {
      const pose = getPose.call(this, space);
      window.frameTest.views = pose?.views.map(view => view.eye) || [];
      if (pose) window.frameTest.poseFrames++;
      return pose;
    };
  });
  await page.getByRole('button', { name: 'VR details', exact: true }).click();
  await page.getByRole('button', { name: 'Eye preview', exact: true }).click();
  await page.waitForFunction(() => {
    const v = document.querySelector('video[data-youtube-webxr-stereo]');
    return v?.readyState >= 3 && v.currentTime > 91;
  }, null, { timeout: 25000 });
  await page.screenshot({ path: 'test-output/frame-preview.png' });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await page.getByRole('button', { name: 'Exit VR', exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => window.frameTest.poseFrames > 10, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Show diagnostics', exact: true }).click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Playback diagnostics' }).inputValue());
  report.device = await page.evaluate(() => {
    const video = document.querySelector('video[data-youtube-webxr-stereo]');
    const quality = video.getVideoPlaybackQuality();
    return { userAgent: navigator.userAgent, currentTime: video.currentTime, ...window.frameTest,
      totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames };
  });
  assert.equal(report.stereoStream.width, 1920);
  assert.equal(report.stereoStream.height, 1080);
  assert.equal(report.stereoStream.stereoMode, 2);
  assert.equal(report.stereoStream.meshCount, 2);
  assert.deepEqual(report.device.views, ['left', 'right']);
  await writeFile('test-output/frame-result.json', JSON.stringify(report, null, 2));
  console.log('Steam Frame passed: 1080p stereo beyond 90 seconds, two meshes, native WebXR frames and both eye views.');
  console.log(JSON.stringify(report.device, null, 2));
  // Disconnect without closing the headset browser; leave the viewer available for visual inspection.
  process.exit(0);
} catch (error) {
  console.error(await page.locator('#youtube-webxr p').allTextContents().catch(() => []));
  await page.screenshot({ path: 'test-output/frame-failure.png' }).catch(() => {});
  console.error(error.message); process.exit(1);
}
