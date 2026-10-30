# YouTube WebXR VR180

[![Build and test](https://github.com/mmis1000/youtubeWebXr/actions/workflows/build.yml/badge.svg)](https://github.com/mmis1000/youtubeWebXr/actions/workflows/build.yml)

A Chromium extension and userscript that load YouTube VR180 stereo streams and render their projection metadata in WebXR. Both builds use the same source and provide the same controls.

Stereo depth, orientation, head tracking, and native immersive playback have been verified on Steam Frame. The userscript has also been tested there through Violentmonkey. Other headsets need a browser with immersive WebXR and either extension or userscript support.

## Install

Download a build from [Releases](https://github.com/mmis1000/youtubeWebXr/releases/latest).

### Userscript

1. Install a userscript manager that supports injection into the page's JavaScript context, such as Violentmonkey or Tampermonkey.
2. Open [youtube-webxr.user.js](https://github.com/mmis1000/youtubeWebXr/releases/latest/download/youtube-webxr.user.js) and accept the manager's installation prompt. You can also create a script in its editor and paste the entire downloaded file.
3. Enable the script and reload YouTube. If Chromium requests permission to run user scripts, enable it for your manager.

The script is self-contained and uses `@grant none`. It requests page-context injection at document start. The release download and update URLs are included in its header for managers that support automatic updates.

### Extension

1. Download `youtube-webxr-extension-VERSION.zip` from the release and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted directory containing `manifest.json`, then reload YouTube.

This is an unpacked Manifest V3 extension. To update it, extract a newer release into its installation directory and click **Reload** in the extension manager.

Enable one installation at a time. A duplicate-load guard makes the first loaded copy supply the viewer.

## Play a VR180 video

Version 0.2.0 introduces the interface below, WebM VR sources, and source caching. Version 0.1.0 uses the earlier Load stereo / Enter VR flow.

1. Open a YouTube watch page and click **Enter VR** in YouTube's player controls.
2. Allow the browser's VR permission prompt. Stereo preparation happens inside the session, with visible controllers, loading status, and Exit.
3. Use the headset panel for play/pause, seeking, source resolution, recentering, and exit. Point at a control and select it.
4. The small **VR source** selector on the YouTube page mirrors the headset selector while VR is active. Either changes quality within the running session.
5. The arrow beside **Enter VR** opens **VR details** for Eye preview, manual projection, and diagnostics. An active preview can enter VR directly.

YouTube supplies audio and the playback clock. In VR, **select/trigger** on a control activates it. Press the trigger away from the panel to hide the interface, or use **Hide UI**. While hidden, press the trigger anywhere to show it again. This preserves playback; use the panel's **Play/Pause** button to control playback. Controller outlines stay visible while the panel and pointing rays are hidden. Preparing a source, seeking, or a new playback error reveals the panel. **Squeeze** recenters horizontally. A thumbstick deflection seeks ten seconds once; return it to neutral before seeking again. The timeline commits a seek on release. Exit through the headset panel, the page's Exit VR button, or the system action.

Entry uses the last successfully used VR resolution, or the closest eligible resolution; ties choose the lower one. First use targets 1080p. Both selectors show the actual source resolution, including fallback. Failed switches leave the saved resolution unchanged. Dimensions describe the complete frame containing both eyes. Video is paused during preparation, quality changes, and controller seeks so audio and stereo resume together.

**Show diagnostics** in VR details reports dimensions, projection, stereo layout, synchronization drift, and WebXR support. It includes the video ID and selected format identifier, while omitting stream URLs, cookies, and tokens. [The UX design](docs/ux-design.md) describes the interaction and acceptance criteria.

The headset panel uses a fixed-height graphite card with rounded controls. Its quality menu replaces the control row, highlights the active resolution, and marks a pending choice with a spinner. Preparation failures retain the target resolution and put Retry in the primary-control position. The slashed-eye icon hides the panel. VR details and YouTube's settings menu close each other when opened. Browsers without immersive VR support show an explanation in Details.

## Supported playback and limits

- Loads a separate stereo representation through YouTube's `VISIONOS` player API, using the page's visitor identifier with account cookies omitted.
- Streams MP4 and WebM byte ranges through MediaSource using MP4 `sidx` or WebM cue indices and a bounded buffer.
- Follows the media CDN's text redirects (`alr=yes`) with separate browser requests, preserving the page origin for CORS. This uses the same page permissions in both builds.
- Reads MP4 and WebM stereo/projection metadata from the original web player and separate stereo streams.
- Renders raw or deflated projection meshes, cropped equirectangular projections, eye-specific layouts, and static orientation metadata.
- Uses headset rotation for viewing direction; recorded video has a fixed camera origin.

The resolution menus include MP4 and WebM VR sources **at 720p or higher** that the browser reports as decodable through MediaSource. Each listed height has a checked stereo layout, supported projection, and valid segment index. Flat video, unsupported codecs/projections, protected formats, and sources whose headers or indexes cannot be read are excluded. A saved resolution below 720p selects the closest eligible source at or above 720p. For example, `38jcxsq8EBU` offers 720p/1080p H.264 and 1440p/2160p VP9 WebM; its actual 3840 × 2160 WebM source has been decoded on Frame. Codec support does not guarantee smooth playback at every resolution.

YouTube's client API is undocumented and can change. Some videos or sessions may lack directly playable stereo streams. During VR, failures appear in the headset and on the page, with retry and exit available. The browser must support the selected codec and permit video texture uploads.

Validated source headers and indexes are cached within the active preview/VR session, so quality changes reuse discovery results. The cache expires within five minutes or before a signed stream URL expires. Exit, navigation, and playback/preparation errors clear it; Retry refreshes discovery.

The original YouTube video keeps running for audio and controls. A separate muted stereo video follows its clock, correcting drift above 150 ms. This uses two decoders and extra bandwidth. Slow decoding or buffering can trigger repeated synchronization seeks.

Metadata observation covers main-thread MediaSource playback. When the original video has no usable stereo projection metadata, entry and preview request a separate stereo stream. Explicit cubemap projections, camera-motion stabilization tracks, spherical V1 XML, and mesh CRC validation are not implemented. Metadata capture and mesh decompression have size limits.

Manual VR180 layouts are available when you know the source packing. A monoscopic recording provides one captured eye view.

## Steam Frame decoding

Hardware decoding depends on the browser and operating-system driver. Related projects:

- [Chromium WebXR for Steam Frame](https://github.com/mmis1000/chromium-webxr-steam-frame): WebXR and V4L2 decoding integration, including the empty capture-buffer fix.
- [Steam Frame Iris AV1 driver PoC](https://github.com/mmis1000/steamframe-iris-av1-poc): experimental AV1 driver support and builds.

With those fixes, testing on October 30–31, 2026 confirmed hardware AV1 playback and correct 4K VR stereo/tracking. Separate local-file tests sustained 4K60 and synthetic 8K30; the tested real 8K60 stream advanced at roughly half speed. These are device/build-specific measurements, not guarantees for every video or the two-video userscript path.

The earlier installed Violentmonkey userscript was tested with `38jcxsq8EBU` on October 31. Its 1080p and 2160p settings both selected the 1080p MP4 source and played smoothly in native VR after restarting Chromium. Reported motion jumps around scene transitions were subsequently identified by the user as present in the source video; a local hardware-decoding test over 12–25 seconds recorded zero dropped frames. Version 0.2.0 adds the higher-resolution WebM representations.

[Earlier investigation notes](docs/steam-frame-investigation.md) preserve the original software-decoding limits and the first V4L2 deployment. They describe historical builds and test profiles.

## Build and test

Use Node.js 22 and npm:

```sh
npm ci
npm run build
npm test
```

The unpacked extension is generated in `dist/`; the userscript is `dist/youtube-webxr.user.js`.

Browser tests require FFmpeg on `PATH`. They default to installed Microsoft Edge. To use Playwright's Chromium, install it and set `BROWSER_CHANNEL=chromium` in your shell:

```sh
npx playwright install chromium
npm run test:browser
npm run test:userscript
npm run test:panel
```

Tests generate indexed MP4 and VP9 WebM stereo fixtures, play them through MediaSource, and verify eye colors and orientation through WebGL pixels. IWER tests exercise VR format filtering, switching and seeking across containers, permission refusal, cancellation, nearest-resolution selection, page/headset source switching, controller pause/recenter, thumbstick latching, timeline release, media failure/retry, cleanup, and YouTube control-bar replacement. Both generated bundles run in the page context. A real headset is still needed to judge physical controller alignment and panel readability.

`npm run test:youtube` is an optional live integration test. It depends on YouTube availability and is excluded from CI. The latest earlier fresh-profile run encountered an original-player failure after seeking that also reproduced without this project.

To package a local build, run `python scripts/package.py` after `npm run build`. It writes an extension ZIP, the userscript, and `SHA256SUMS.txt` to `release/`. Node modules, recordings, private stream URLs, and test outputs are excluded from the downloads.

## CI and releases

GitHub Actions builds and tests pushes to `main`, pull requests, version tags, and manual runs. Successful runs upload `youtube-webxr-packages` and browser test evidence as workflow artifacts.

To publish a release, update the version in `extension/manifest.json` and `package.json`/`package-lock.json`, commit, and push a matching `vVERSION` tag. Tag builds verify the manifest version, run the same tests, and publish both packages with checksums to GitHub Releases. The workflow's release job has repository write permission; tests run with read permission.

## Implementation references

- [Google VR180 specification](https://github.com/google/spatial-media/blob/master/docs/vr180.md)
- [Spherical Video V2 metadata](https://github.com/google/spatial-media/blob/master/docs/spherical-video-v2-rfc.md)
- [yt-dlp YouTube client configuration](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py)
- [WebXR Device API](https://www.w3.org/TR/webxr/)
- [WebM container and cue index](https://www.webmproject.org/docs/container/)
- [WebM MediaSource byte stream format](https://www.w3.org/TR/mse-byte-stream-format-webm/)

All runtime code is bundled locally. Requests go directly from the YouTube page to YouTube and its media CDN. There is no background service or download helper. Playwright and IWER are development dependencies.
