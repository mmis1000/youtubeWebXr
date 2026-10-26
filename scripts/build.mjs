import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], outfile: 'dist/youtube-xr.js', bundle: true,
  format: 'iife', target: 'chrome111', sourcemap: true });
await copyFile('extension/manifest.json', 'dist/manifest.json');
console.log('Unpacked extension ready in dist/');
