import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const target = new URL(process.argv[2] || 'https://www.youtube.com/watch?v=6Sqx8i4oVfk');
if (target.protocol !== 'https:' || !['www.youtube.com', 'm.youtube.com'].includes(target.hostname)) {
  throw new Error('Supply an HTTPS YouTube watch URL.');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.addInitScript({ content: await readFile('dist/youtube-xr.js', 'utf8') });
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('video', { state: 'attached', timeout: 20000 });
  await page.evaluate(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(() => {}); });
  try { await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 20000 }); } catch {}
  await page.getByRole('button', { name: 'WebXR', exact: true }).click();
  await page.getByRole('button', { name: 'Show diagnostics', exact: true }).click();
  const report = JSON.parse(await page.getByRole('textbox', { name: 'Playback diagnostics' }).inputValue());
  report.pageTitle = await page.title();
  report.playerMessage = await page.locator('.ytp-error').innerText().catch(() => '');
  report.projectionFields = await page.evaluate(() => {
    const result = [];
    function visit(object, path = '', depth = 0) {
      if (!object || typeof object !== 'object' || depth > 12) return;
      for (const [key, value] of Object.entries(object)) {
        const next = `${path}.${key}`;
        if (/spher|stereo|mesh|projection/i.test(key)) result.push({ path: next,
          value: typeof value === 'object' ? Object.keys(value || {}) : String(value).slice(0, 120) });
        visit(value, next, depth + 1);
      }
    }
    visit(document.getElementById('movie_player')?.getPlayerResponse?.());
    return result;
  });
  report.originalHeaderProbe = await page.evaluate(async () => {
    const response = document.getElementById('movie_player')?.getPlayerResponse?.();
    const formats = response?.streamingData?.adaptiveFormats || [];
    const v = document.querySelector('video');
    const f = formats.find(f => f.width === v?.videoWidth && f.mimeType?.startsWith('video/webm'));
    if (!f) return { available: false };
    const summary = { itag: f.itag, keys: Object.keys(f), hasURL: !!f.url, initRange: f.initRange };
    if (!f.url) return summary;
    try {
      const url = new URL(f.url); url.searchParams.set('range', `${f.initRange?.start || 0}-${f.initRange?.end || 65535}`);
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      summary.status = r.status;
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        summary.bytes = bytes.length;
        window.originalHeader = [...bytes.subarray(0, 2 * 1024 * 1024)];
      }
    } catch (error) { summary.error = error.message; }
    return summary;
  });
  const header = await page.evaluate(() => window.originalHeader);
  if (header) {
    const { readMetadata } = await import('../src/metadata.js');
    try { report.originalHeaderProbe.metadata = readMetadata(new Uint8Array(header)); }
    catch (error) { report.originalHeaderProbe.parseError = error.message; }
  }
  await mkdir('test-output', { recursive: true });
  await writeFile('test-output/youtube-diagnostics.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
