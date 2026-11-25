# YouTube WebXR

[![Build and test](https://github.com/mmis1000/youtubeWebXr/actions/workflows/build.yml/badge.svg)](https://github.com/mmis1000/youtubeWebXr/actions/workflows/build.yml)

Browser-based WebXR YouTube player targeting **Valve Steam Frame** (and other WebXR-capable Chromium browsers), aimed at comfortable headset use with full video resolution and full YouTube capability.

> See [AGENTS.md](AGENTS.md) for project goals and architectural notes, and [docs/steam-frame-notes.md](docs/steam-frame-notes.md) for Steam Frame Chromium/V4L2/Vulkan setup and benchmarks.

## Current Prototype Status (v0.3.1)

What the current codebase implements:
- **VR180 & 360° stream discovery:** Queries YouTube's `VISIONOS` player endpoint (`src/youtube.js`) to obtain unencrypted `MESH` and `EQUIRECTANGULAR` MP4/WebM representations from 720p up to 4320p (8K).
- **MSE byte-range streaming:** Parses MP4 `sidx` boxes (`src/stream.js`) and WebM `Cues` (`src/webm.js`) and follows `.googlevideo.com` text redirects (`?alr=yes`, `src/media.js`) to stream into `MediaSource` while preserving CORS origin.
- **Spherical V2 & mesh rendering:** Parses MP4 `sv3d`/`st3d` and WebM `Projection` metadata (`src/metadata.js`), including raw and `dfl8`-compressed `mshp`/`ytmp` fisheye projection meshes, and renders stereo/mono views in WebGL (`src/render.js`).
- **In-VR playback panel:** Provides a ray-pointed WebXR panel (`src/xr-ui.js`, `src/panel.js`) for play/pause, timeline scrubbing, ±10 s seek (left stick), 30° snap turn (right stick), horizontal recenter (squeeze), and resolution switching, plus an on-page Eye preview and diagnostics view (`src/main.js`).
- **Steam Frame V4L2 buffer-hold workaround:** Uploads video textures through WebCodecs `VideoFrame` keeping the latest frame open for one upload cycle to prevent Qualcomm Iris V4L2 buffer overwrite ("green strip" artifact).

### Known Prototype Limitations (To Be Improved)

- **VR180 / equirectangular 360° only:** Regular 2D flat videos do not yet have a virtual cinema screen mode (clicking **Enter VR** on a flat video currently errors out), and Equi-Angular Cubemap (`cbmp` / EAC) 360° streams are not yet supported.
- **Live 8K60 frame drops & dual-video overhead:** While offline 8K60 AV1 sustains 59.95 fps on Steam Frame, live 8K60 playback in v0.3.1 dropped ~15% of video frames (362 / 2,418) due to single-segment 400 ms range polling, `UNPACK_FLIP_Y_WEBGL` RGB texture blits, and YouTube's background player continuing to download video segments alongside the muted VR `<video>`.
- **Session teardown on navigation:** Navigating to another YouTube video currently exits the `XRSession` instead of transitioning in-VR, and there is no in-VR video browser, caption renderer, spatial audio rotation, or vertical pitch recentering (recliner/lying-down mode) yet.
- **Unauthenticated `VISIONOS`-only discovery:** Requests currently omit cookies (`credentials: 'omit'`) without fallback to `ANDROID_VR` or page `playerResponse`, so age-restricted or members-only videos fail, and all resolution headers/indices are probed eagerly before first frame.

## Install

Download a build from [Releases](https://github.com/mmis1000/youtubeWebXr/releases/latest), or build locally into `dist/`. Enable either the extension or the userscript (not both at once).

### Unpacked Chromium Extension

1. Extract `youtube-webxr-extension-VERSION.zip` (or run `npm run build` to populate `dist/`).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the directory containing `manifest.json`.
3. Reload YouTube.

### Userscript

1. Install a userscript manager supporting page-context injection (e.g., Violentmonkey).
2. Open `youtube-webxr.user.js` from Releases (or `dist/youtube-webxr.user.js`) and confirm installation.

## Build and Test

Requires Node.js 22+ and npm (plus `ffmpeg` on `PATH` for browser media tests):

```sh
npm ci
npm run build
npm test
```

Headless Playwright + IWER WebXR tests (defaults to Microsoft Edge; set `BROWSER_CHANNEL=chromium` after `npx playwright install chromium` to use Chromium):

```sh
npm run test:browser
npm run test:userscript
npm run test:panel
```

Package release archives (`release/`):

```sh
python scripts/package.py
```

## References

- [Google VR180 specification](https://github.com/google/spatial-media/blob/master/docs/vr180.md)
- [Spherical Video V2 RFC](https://github.com/google/spatial-media/blob/master/docs/spherical-video-v2-rfc.md)
- [WebXR Device API](https://www.w3.org/TR/webxr/)
- [WebM Container Guidelines](https://www.webmproject.org/docs/container/)
