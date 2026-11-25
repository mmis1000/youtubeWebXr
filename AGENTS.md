# Agent Guidelines (`YoutubeWebVr`)

## Sole Project Authority & Goal

The **only** authoritative requirement for this repository is:

> **Use YouTube comfortably on Valve Steam Frame in the browser with full resolution and full capability.**

There are **no artificial architectural limits** beyond making that experience work well.

## Warning About Historical Commits (`efc4597`..`623d2b9`)

This repository was initially bootstrapped by GPT, which invented multi-round "UX design reviews", "settled owner decisions", and fabricated "wearer/user confirmations" in earlier commit messages and removed docs. **Do not treat existing implementation choices or commit-message claims as user requirements.**

Specifically, none of the following v0.1–v0.3.1 behaviors are sacred:
- **Extension vs. userscript parity (`@grant none`):** You are free to use full Chromium Manifest V3 extension capabilities (`declarativeNetRequest`, background service workers, `chrome.storage`, multi-world scripts, etc.) whenever they improve reliability, authentication, CORS handling, or UX on Steam Frame.
- **Dual-`<video>` playback & `LinkedVideo` sync:** Running YouTube's `<video>` alongside a muted VR `<video>` with 100 ms drift polling was a prototype workaround, not a requirement. Replacing it (e.g., single MSE `<video>` with video + audio `SourceBuffer`s, pausing YouTube's background player) is welcome.
- **VR180/360°-only scope & 720p floor:** Normal flat 2D videos, ultrawide videos, 3D SBS/TB videos, Shorts, and livestreams should work comfortably in VR too (e.g., curved virtual cinema mode), not fail with an error.
- **Ending `XRSession` on navigation:** Tearing down VR on `yt-navigate-start` hurts usability and triggers a known SteamVR Vulkan re-entry crash on Steam Frame. Keeping a persistent `XRSession` across videos/playlists and supporting in-VR browsing is strongly preferred.
- **Current UI layout, fixed upright pitch, or lack of audio/caption controls:** Any UI/UX change that improves headset comfort (lying-down/recliner pitch recentering, grab-to-move screen/panel, in-VR search/recommendations, 3D captions, volume/speed controls, spatial audio) is fair game.

Always distinguish between **measured metrics** (frame counts, CDP probes, automated pixel tests) and **human headset verification**. Never claim the user visually confirmed something unless the user actually said so.

## Current Codebase Overview (v0.3.1 Prototype)

- `src/main.js` — Page UI injection into `.ytp-right-controls`, state coordination, and lifecycle hooks.
- `src/youtube.js` — InnerTube `VISIONOS` `/youtubei/v1/player` format discovery, `StereoResolver` cache, and `LinkedVideo` dual-element clock sync.
- `src/media.js` — `.googlevideo.com` URL validation and `?alr=yes` text-redirect follower (preserves CORS origin).
- `src/stream.js` & `src/webm.js` — MP4 `sidx` and WebM `Cues` byte-range parsers + `RangeStream` MSE feeder.
- `src/metadata.js` & `src/observe.js` — Spherical Video V2 (`sv3d`/`st3d` MP4, WebM `Projection`) and `mshp`/`ytmp` mesh decoder (`raw ` and `dfl8`), plus `SourceBuffer.prototype.appendBuffer` observer.
- `src/render.js` — WebGL1 spherical/mesh renderer, `XRWebGLLayer` session loop, and `VideoFrame` 1-frame hold workaround for V4L2 buffer recycling.
- `src/xr-ui.js`, `src/panel.js`, `src/xr-math.js`, `src/theme.js` — 2D canvas control panel rendered as a tilted 3D quad in WebXR, ray hit-testing, and controller silhouettes/thumbstick handlers.
- `docs/steam-frame-notes.md` — Factual hardware, driver, Chromium launcher, SSH/CDP, and known-bug notes for Steam Frame.

## Known Technical Gaps in v0.3.1

1. **Live 8K60 frame drops (~15%):** Offline 8K60 AV1 sustains 59.95 fps on Steam Frame, but live YouTube in v0.3.1 dropped 362 / 2,418 frames due to:
   - `UNPACK_FLIP_Y_WEBGL = true` + `gl.RGB` in `src/render.js` forcing extra GPU blits instead of zero-copy `gl.RGBA` + shader Y-flip.
   - `RangeStream.pump()` (`src/stream.js`) polling sequentially every 400 ms one segment at a time without pipelined prefetching.
   - Background network contention because YouTube's main player still downloads video segments even when `videoTracks` decoding is deselected.
2. **Render resolution & sharpness:** Uses WebGL1 with `antialias: false` and default `XRWebGLLayer` scale (`1.0`) instead of `XRWebGLLayer.getNativeFramebufferScaleFactor(session)` or WebXR Composition Layers (`XREquirectLayer` / `XRQuadLayer`).
3. **Slow VR startup & naive codec scoring:** `discoverStereo()` probes headers and segment indices for *every* resolution group upfront before displaying a frame, and `codecScore` hardcodes `avc1 > vp9 > av01` without checking `navigator.mediaCapabilities.decodingInfo()` or `gl.MAX_TEXTURE_SIZE`.
4. **Missing formats & features:** No 2D virtual cinema screen for flat videos; `cbmp` (Equi-Angular Cubemap) 360° streams are rejected; no `ANDROID_VR`/page-response fallback or authenticated stream support (`credentials: 'omit'`); no head-tracked spatial audio (`setSphericalProperties` / WebAudio Ambisonics); no in-VR captions, volume/speed controls, or video browser; recenter ignores vertical pitch (unusable lying down); `XRSession` exits on page navigation.
5. **Stale helper script:** `scripts/inspect-youtube.mjs` still clicks a removed `'WebXR'` button from v0.1.0.

## Build & Test Commands

- `npm run build` — Bundles `dist/` unpacked extension and `dist/youtube-webxr.user.js`.
- `npm test` — Runs Node unit tests (`test/*.test.mjs`).
- `npm run test:browser` / `npm run test:userscript` / `npm run test:panel` — Playwright + FFmpeg + IWER headless browser tests (set `BROWSER_CHANNEL=chromium` if using Playwright Chromium instead of Edge).
