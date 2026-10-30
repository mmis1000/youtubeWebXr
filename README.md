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

1. Open a YouTube watch page and start playback.
2. Open **WebXR** at the lower right.
3. Choose a stereo stream resolution and click **Load stereo stream**. Start with 1080p.
4. Leave **Projection** on **Automatic**. **Eye preview** displays both eyes in the browser window.
5. Stop the preview, click **Enter VR**, and allow the browser's VR permission prompt.

YouTube controls audio, seeking, and playback speed. In VR, controller **select** pauses or resumes playback, and **squeeze** recenters horizontally. Use the headset's normal system action to exit VR. Controller actions still need full on-device validation.

The resolution selector sets a maximum. The loader can select a lower eligible stream; check the displayed decoded dimensions. Changing the selector requires clicking **Load stereo stream** again. Dimensions describe the complete frame containing both eyes.

**Show diagnostics** reports dimensions, projection, stereo layout, synchronization drift, and WebXR support. It includes the video ID and format summaries, while omitting stream URLs, cookies, and tokens.

## Supported playback and limits

- Loads a separate stereo representation through YouTube's `VISIONOS` player API, using the page's visitor identifier with account cookies omitted.
- Streams MP4 byte ranges through MediaSource using `sidx` segment indices and a bounded buffer.
- Reads MP4 and WebM stereo/projection metadata from the original web player, plus MP4 metadata from the separate stereo stream.
- Renders raw or deflated projection meshes, cropped equirectangular projections, eye-specific layouts, and static orientation metadata.
- Uses headset rotation for viewing direction; recorded video has a fixed camera origin.

The separate stereo loader currently accepts **MP4 only**. A video's higher-resolution WebM/VP9 streams are skipped. For example, `38jcxsq8EBU` selects its 1920 × 1080 H.264 stream at both the 1080p and 2160p settings; its actual 4K stereo representation is WebM/VP9.

YouTube's client API is undocumented and can change. Some videos or sessions may lack directly playable stereo streams. Failures appear in the WebXR panel. The browser must support the selected codec and permit video texture uploads.

The original YouTube video keeps running for audio and controls. A separate muted stereo video follows its clock, correcting drift above 150 ms. This uses two decoders and extra bandwidth. Slow decoding or buffering can trigger repeated synchronization seeks.

Metadata observation covers main-thread MediaSource playback. Initialization data missed before injection, worker-owned MediaSource, and other playback paths may require **Load stereo stream**. Explicit cubemap projections, camera-motion stabilization tracks, spherical V1 XML, and mesh CRC validation are not implemented. Metadata capture and mesh decompression have size limits.

Manual VR180 layouts are available when you know the source packing. A monoscopic recording provides one captured eye view.

## Steam Frame decoding

Hardware decoding depends on the browser and operating-system driver. Related projects:

- [Chromium WebXR for Steam Frame](https://github.com/mmis1000/chromium-webxr-steam-frame): WebXR and V4L2 decoding integration, including the empty capture-buffer fix.
- [Steam Frame Iris AV1 driver PoC](https://github.com/mmis1000/steamframe-iris-av1-poc): experimental AV1 driver support and builds.

With those fixes, testing on October 30–31, 2026 confirmed hardware AV1 playback and correct 4K VR stereo/tracking. Separate local-file tests sustained 4K60 and synthetic 8K30; the tested real 8K60 stream advanced at roughly half speed. These are device/build-specific measurements, not guarantees for every video or the two-video userscript path.

The installed Violentmonkey userscript was tested with `38jcxsq8EBU` on October 31. Both resolution settings above played smoothly in native VR after restarting Chromium. Reported motion jumps around scene transitions were subsequently identified by the user as present in the source video; a local hardware-decoding test over 12–25 seconds recorded zero dropped frames.

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
```

Tests generate a stereo color fixture, play it through MediaSource, verify eye colors and orientation through WebGL pixels, exercise immersive sessions through IWER, and check navigation cleanup. They run each generated bundle in the page context. Real userscript-manager installation and native headset behavior are covered by the device checks described above.

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

All runtime code is bundled locally. Requests go directly from the YouTube page to YouTube and its media CDN. There is no background service or download helper. Playwright and IWER are development dependencies.
