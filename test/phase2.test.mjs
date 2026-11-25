import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMetadata } from '../src/metadata.js';
import { cinemaScreen, eacDirectionToUV, cbmpDirectionToUV, layoutLabel } from '../src/render.js';
import { gazeAngles, anchorMatrix, panelIntersection, identity, thumbstickVertical } from '../src/xr-math.js';
import { chooseFormats, chooseFlatFormats } from '../src/youtube.js';
import { box, u32, concat, mp4, ebml } from './fixtures.mjs';

test('MP4 cbmp and WebM ProjectionType=2 parse as cubemap metadata and distinguish EAC vs standard cbmp', () => {
  const cbmpBox = box('cbmp', [0, 0, 0, 0], u32(0), u32(4));
  const m = readMetadata(mp4(0, cbmpBox));
  assert.deepEqual(m.projection, { type: 'cubemap', layout: 0, padding: 4 });
  assert.equal(layoutLabel(m), 'Monoscopic 360° Cubemap');
  m.projection.eac = true;
  assert.equal(layoutLabel(m), 'Monoscopic 360° EAC');

  const stereoM = readMetadata(mp4(1, cbmpBox));
  stereoM.projection.eac = true;
  assert.equal(layoutLabel(stereoM), 'Stereo 360° EAC');

  // Verify standard cbmp layout 0 maps Front (-Z) to bottom-center (col 1, row 0) and Right (+X) to top-left (col 0, row 1)
  const [cfU, cfV] = cbmpDirectionToUV(0, 0, -1);
  assert.ok(Math.abs(cfU - 0.5) < 1e-4 && Math.abs(cfV - 0.25) < 1e-4);
  const [crU, crV] = cbmpDirectionToUV(1, 0, 0);
  assert.ok(Math.abs(crU - 1 / 6) < 1e-4 && Math.abs(crV - 0.75) < 1e-4);

  const badLayout = box('cbmp', [0, 0, 0, 0], u32(1), u32(0));
  assert.throws(() => readMetadata(mp4(0, badLayout)), /Unsupported cubemap layout/);

  const webmCbmp = concat(
    ebml(0x1a45dfa3, []),
    ebml(0x18538067, ebml(0x1654ae6b, ebml(0xae, ebml(0xe0, concat(
      ebml(0x53b8, [0]),
      ebml(0x7670, ebml(0x7671, [2]))
    )))))
  );
  const wm = readMetadata(webmCbmp);
  assert.deepEqual(wm.projection, { type: 'cubemap', layout: 0, padding: 0 });
});

test('EAC 3x2 cubemap maps all 6 cardinal directions to expected atlas cells with continuous seams', () => {
  const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
  // Top row (v = 0.75 in bottom-up UV): Left (col 0), Front (col 1), Right (col 2)
  const [lu, lv] = eacDirectionToUV(-1, 0, 0);
  assert.ok(near(lu, 1 / 6) && near(lv, 0.75), `Left: ${lu}, ${lv}`);
  const [fu, fv] = eacDirectionToUV(0, 0, -1);
  assert.ok(near(fu, 0.5) && near(fv, 0.75), `Front: ${fu}, ${fv}`);
  const [ru, rv] = eacDirectionToUV(1, 0, 0);
  assert.ok(near(ru, 5 / 6) && near(rv, 0.75), `Right: ${ru}, ${rv}`);
  // Bottom row (v = 0.25): Bottom (col 0), Back (col 1), Top (col 2)
  const [bu, bv] = eacDirectionToUV(0, -1, 0);
  assert.ok(near(bu, 1 / 6) && near(bv, 0.25), `Bottom: ${bu}, ${bv}`);
  const [ku, kv] = eacDirectionToUV(0, 0, 1);
  assert.ok(near(ku, 0.5) && near(kv, 0.25), `Back: ${ku}, ${kv}`);
  const [tu, tv] = eacDirectionToUV(0, 1, 0);
  assert.ok(near(tu, 5 / 6) && near(tv, 0.25), `Top: ${tu}, ${tv}`);

  // Verify seam continuity between Bottom (-Y, col 0 right edge) and Back (+Z, col 1 left edge) at (0, -1, +1)
  const [bSeamU, bSeamV] = eacDirectionToUV(0, -1.0001, 1);
  const [kSeamU, kSeamV] = eacDirectionToUV(0, -1, 1.0001);
  assert.ok(near(bSeamU, 1 / 3, 1e-3) && near(kSeamU, 1 / 3, 1e-3), `Bottom-Back U seam: ${bSeamU} vs ${kSeamU}`);
  assert.ok(near(bSeamV, kSeamV, 1e-3), `Bottom-Back V seam: ${bSeamV} vs ${kSeamV}`);

  // Verify seam continuity between Back (+Z, col 1 right edge) and Top (+Y, col 2 left edge) at (0, +1, +1)
  const [kTopU, kTopV] = eacDirectionToUV(0, 1, 1.0001);
  const [tBackU, tBackV] = eacDirectionToUV(0, 1.0001, 1);
  assert.ok(near(kTopU, 2 / 3, 1e-3) && near(tBackU, 2 / 3, 1e-3), `Back-Top U seam: ${kTopU} vs ${tBackU}`);
  assert.ok(near(kTopV, tBackV, 1e-3), `Back-Top V seam: ${kTopV} vs ${tBackV}`);
});

test('cinemaScreen generates curved 3D geometry for 16:9, 21:9, and 9:16 Shorts', () => {
  const wide = cinemaScreen(16 / 9, 1)[0].data;
  const tall = cinemaScreen(9 / 16, 1)[0].data;
  assert.ok(wide.length > 0 && wide.length % 5 === 0);
  // Center of screen sits at z = -3.0 m; edges curve forward (z > -3.0)
  let minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (let i = 0; i < wide.length; i += 5) {
    minZ = Math.min(minZ, wide[i + 2]);
    maxZ = Math.max(maxZ, wide[i + 2]);
    maxY = Math.max(maxY, Math.abs(wide[i + 1]));
  }
  assert.ok(Math.abs(minZ - (-3.0)) < 0.01, `center z is -3.0: ${minZ}`);
  assert.ok(maxZ > minZ + 0.2, `screen curves toward viewer: ${minZ} -> ${maxZ}`);
  // Shorts vertical height is capped comfortably
  let tallMaxY = 0;
  for (let i = 0; i < tall.length; i += 5) tallMaxY = Math.max(tallMaxY, Math.abs(tall[i + 1]));
  assert.ok(tallMaxY <= 1.35, `9:16 Shorts half-height capped: ${tallMaxY}`);
  assert.equal(layoutLabel({ stereoMode: 0, projection: { type: 'cinema' } }), 'Virtual Cinema');
  assert.equal(layoutLabel({ stereoMode: 2, projection: { type: 'cinema' } }), '3D Cinema');
});

test('gazeAngles and anchorMatrix support upright horizon-lock and lying-down ceiling recenter', () => {
  // Upright within +/-15 deg deadzone stays horizon-locked (pitch === 0)
  const slightTilt = 10 * Math.PI / 180;
  const upright = identity();
  upright[5] = Math.cos(slightTilt); upright[6] = Math.sin(slightTilt);
  upright[9] = -Math.sin(slightTilt); upright[10] = Math.cos(slightTilt);
  assert.equal(gazeAngles(upright).pitch, 0);

  // Lying down looking +75 deg up toward ceiling tilts panel overhead and preserves ray hit-testing
  const bedPitch = 75 * Math.PI / 180;
  const bedPose = identity();
  bedPose[5] = Math.cos(bedPitch); bedPose[6] = Math.sin(bedPitch);
  bedPose[9] = -Math.sin(bedPitch); bedPose[10] = Math.cos(bedPitch);
  bedPose[13] = 0.8;
  const angles = gazeAngles(bedPose);
  assert.ok(Math.abs(angles.pitch - bedPitch) < 1e-4, `bed pitch preserved: ${angles.pitch}`);
  const panel = anchorMatrix(bedPose);
  // Panel should be ABOVE the lying viewer (y > 0.8), facing DOWN toward the viewer!
  assert.ok(panel[13] > bedPose[13] + 1.0, `panel floats overhead when lying down: y=${panel[13]}`);
  // Cast a ray directly FROM the lying viewer's actual eye position toward the panel center.
  const dx = panel[12] - bedPose[12], dy = panel[13] - bedPose[13], dz = panel[14] - bedPose[14];
  const dist = Math.hypot(dx, dy, dz);
  const ray = identity();
  ray[8] = -dx / dist; ray[9] = -dy / dist; ray[10] = -dz / dist;
  ray[12] = bedPose[12]; ray[13] = bedPose[13]; ray[14] = bedPose[14];
  const hit = panelIntersection(ray, panel);
  assert.ok(hit && hit.inside && Math.abs(hit.x - 512) < 1e-3 && Math.abs(hit.y - 156) < 1e-3, `ray from lying viewer hits panel center: ${JSON.stringify(hit)}`);
});

test('chooseFormats accepts CUBEMAP/EAC and chooseFlatFormats selects flat cinema formats', () => {
  const base = { url: 'https://rr1.googlevideo.com/v', mimeType: 'video/mp4; codecs="avc1.640028"', initRange: { start: '0', end: '100' }, indexRange: { start: '101', end: '200' } };
  const formats = [
    { ...base, itag: 1, height: 2160, projectionType: 'CUBEMAP' },
    { ...base, itag: 2, height: 1080, projectionType: 'EQUIANGULAR_CUBEMAP' },
    { ...base, itag: 3, height: 1080, projectionType: 'RECTANGULAR' },
    { ...base, itag: 4, height: 480, projectionType: 'RECTANGULAR' }
  ];
  assert.deepEqual(chooseFormats(formats, Infinity, () => true).map(f => f.itag), [1, 2]);
  assert.deepEqual(chooseFlatFormats(formats, Infinity, () => true).map(f => f.itag), [3, 4]);
});

test('thumbstickVertical latches up and down steps cleanly', () => {
  assert.deepEqual(thumbstickVertical([0, 0, 0, -0.9], false), { latched: true, step: 1 });
  assert.deepEqual(thumbstickVertical([0, 0, 0, -0.9], true), { latched: true, step: 0 });
  assert.deepEqual(thumbstickVertical([0, 0, 0, 0], true), { latched: false, step: 0 });
  assert.deepEqual(thumbstickVertical([0, 0, 0, 0.9], false), { latched: true, step: -1 });
});
