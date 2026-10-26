import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  await mkdir('test-output/network', { recursive: true });
  const page = await browser.newPage();
  const media = [], pending = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.hostname.endsWith('.googlevideo.com') || url.pathname !== '/videoplayback' || media.length >= 5) return;
    const entry = { index: media.length, status: response.status(), itag: url.searchParams.get('itag'),
      mime: response.headers()['content-type'], queryKeys: [...url.searchParams.keys()] };
    media.push(entry);
    pending.push((async () => {
      try {
        const body = await response.body(); entry.length = body.length;
        await writeFile(`test-output/network/${entry.index}.bin`, body.subarray(0, 4 * 1024 * 1024));
      } catch (e) { entry.error = e.message; }
    })());
  });
  await page.addInitScript({ content: await readFile('dist/youtube-xr.js', 'utf8') });
  await page.goto('https://www.youtube.com/watch?v=yVLssFEqKmo', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('video', { state: 'attached' });
  await page.evaluate(() => {const v=document.querySelector('video');v.muted=true;v.play().catch(()=>{});});
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 30000 }).catch(()=>{});
  const info = await page.evaluate(() => {
    const p = document.getElementById('movie_player'); const r = p?.getPlayerResponse?.();
    return { vr: r?.playerConfig?.vrConfig, videoData: { isVr: p?.getVideoData?.().isVr },
      streamingKeys: Object.keys(r?.streamingData || {}), stats: p?.getVideoStats?.(),
      width: document.querySelector('video')?.videoWidth };
  });
  // Statistics may contain ephemeral stream identifiers; keep only the format identifier.
  info.stats = { fmt: info.stats?.fmt };
  if (info.vr) info.vr = Object.fromEntries(Object.entries(info.vr).map(([k,v])=>[k, typeof v === 'string' && v.startsWith('http') ? new URL(v).pathname : v]));
  await Promise.allSettled(pending);
  await writeFile('test-output/network/report.json', JSON.stringify({ media, info }, null, 2));
  console.log(JSON.stringify({ media, info }, null, 2));
} finally { await browser.close(); }
