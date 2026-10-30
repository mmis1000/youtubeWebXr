import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const common = { entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: 'chrome111' };
const userscriptHeader = [
  '// ==UserScript==',
  '// @name         YouTube WebXR VR180',
  '// @namespace    youtube-webxr-vr180',
  `// @version      ${manifest.version}`,
  `// @description  ${manifest.description}`,
  '// @homepageURL  https://github.com/mmis1000/youtubeWebXr',
  '// @supportURL   https://github.com/mmis1000/youtubeWebXr/issues',
  '// @downloadURL  https://github.com/mmis1000/youtubeWebXr/releases/latest/download/youtube-webxr.user.js',
  '// @updateURL    https://github.com/mmis1000/youtubeWebXr/releases/latest/download/youtube-webxr.user.js',
  ...manifest.content_scripts[0].matches.map(match => `// @match        ${match}`),
  '// @run-at       document-start',
  '// @grant        none',
  '// @sandbox      raw',
  '// @inject-into  page',
  '// @noframes',
  '// ==/UserScript=='
].join('\n');
await mkdir('dist', { recursive: true });
await build({ ...common, outfile: 'dist/youtube-xr.js', sourcemap: true });
await build({ ...common, outfile: 'dist/youtube-webxr.user.js', banner: { js: userscriptHeader } });
await copyFile('extension/manifest.json', 'dist/manifest.json');
console.log('Unpacked extension ready in dist/; userscript ready at dist/youtube-webxr.user.js');
