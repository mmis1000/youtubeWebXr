import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { readMetadata, decodeMesh } from '../src/metadata.js';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const r = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '28', 'X-YouTube-Client-Version': '1.65.10',
        'X-Goog-Visitor-Id': window.ytcfg?.get('VISITOR_DATA') || '' },
      body: JSON.stringify({ videoId: 'yVLssFEqKmo', context: { client: {
        clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3',
        androidSdkVersion: 32, userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        osName: 'Android', osVersion: '12L', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0 } },
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } }, contentCheckOk: true, racyCheckOk: true }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json();
    const formats = data.streamingData?.adaptiveFormats || [];
    const f = formats.find(x => x.itag === 397);
    let header, streamStatus, streamError;
    if (f?.url) {
      try {
        const u = new URL(f.url); u.searchParams.set('range', '0-16383');
        const h = await fetch(u, { credentials: 'omit', signal: AbortSignal.timeout(15000) }); streamStatus = h.status;
        if (h.ok) header = [...new Uint8Array(await h.arrayBuffer())];
      } catch (e) { streamError = e.message; }
    }
    return { status: r.status, playability: data.playabilityStatus, formatCount: formats.length,
      formats: formats.filter(x=>x.mimeType?.startsWith('video/')).map(x=>({itag:x.itag,width:x.width,height:x.height,mimeType:x.mimeType,url:!!x.url,projectionType:x.projectionType})),
      streamStatus, streamError, header };
  });
  await mkdir('test-output', {recursive:true});
  if (result.header) {
    const m = readMetadata(new Uint8Array(result.header));
    result.metadata = { stereoMode: m?.stereoMode, type: m?.projection?.type, meshCount: m?.projection?.type === 'mesh' ? (await decodeMesh(m.projection.payload)).length : undefined };
    await writeFile('test-output/api-header.mp4', new Uint8Array(result.header));
    delete result.header;
  }
  await writeFile('test-output/api-probe.json', JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
