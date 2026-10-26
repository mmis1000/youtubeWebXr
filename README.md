# YouTube WebXR VR180

An unpacked Chromium Manifest V3 extension that adds a WebXR viewer to YouTube. The initial target is Steam Frame's standalone Chromium browser, treated as a standard WebXR environment.

**Status: stereo streaming and native WebXR verified on Steam Frame.** The reference video `yVLssFEqKmo` plays at 1080p with two projection meshes and native left/right WebXR views. The user confirmed correct orientation, stereo depth, and head tracking in the headset. Device testing reached 122 seconds and also replayed across the earlier 48-second failure point after switching the YouTube client to `VISIONOS`. Resolution testing found 1080p performed best in this browser setup; 1440p stuttered, while 4K and 8K stalled. Controller actions on hardware still need testing.

## Try it

The built extension is in `dist/`.

1. Open your browser's extension manager and enable developer mode.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Reload a YouTube watch page and start playback. Reloading lets the extension observe the stream's initialization metadata.
4. Open **WebXR** at the lower right. Select a resolution and click **Load stereo stream**. Start with 1080p.
5. Leave **Projection** on **Automatic**. Use **Eye preview** to inspect both eyes. Stop the preview, then click **Enter VR**.

In VR, a controller's **select** action pauses or resumes playback. **Squeeze** recenters the video horizontally. The headset's normal system action exits immersive mode. YouTube's controls handle audio, seeking, and playback speed. The extension's resolution selector controls stereo quality; click **Load stereo stream** again after changing it.

Manual VR180 layouts are available for streams whose packing you have independently identified. A monoscopic source provides one captured view; selecting a stereo layout cannot supply the missing eye.

**Show diagnostics** provides frame dimensions, detected container/projection/stereo mode, WebXR availability, and advertised format summaries. It omits stream URLs, cookies, and tokens. The video ID is included.

## Requirements and current coverage

The intended outcome is stereoscopic VR180 playback from a YouTube watch page, with the correct projection for each eye and headset-controlled viewing direction.

This prototype implements:

- YouTube `VISIONOS` player requests using the page's visitor identifier, with account cookies omitted.
- Stereo metadata verification before accepting a stream.
- MP4 byte-range streaming through MediaSource, using `sidx` segment indices and a bounded playback buffer.
- MP4 `st3d` / `sv3d` and WebM stereo / projection metadata discovery.
- Raw and raw-deflate mesh projections, with one or two eye meshes.
- Equirectangular projections with crop bounds, including 180° content.
- Mono, left-right, right-left, top-bottom, and custom-mesh stereo layouts.
- Static yaw, pitch, and roll metadata.
- Eye preview, WebXR session lifecycle, select/pause, squeeze/recenter, and cleanup when the observed stream changes.

Loading stereo requests a separate VR representation even when the ordinary web player receives a monoscopic representation. Without loading stereo, automatic mode can also render the current web stream when its metadata is available.

Current limits:

- VR extraction uses an undocumented YouTube client API. Availability can vary by video, session, and future YouTube changes. A failed request is shown in the panel. The earlier `ANDROID_VR` approach fetched metadata and early segments but repeatedly returned HTTP 403 for later segments; renewing that URL did not solve the failure. The current `VISIONOS` path served those later segments successfully.
- Stereo streaming currently selects MP4 representations with direct URLs and a flat `sidx` index. The API offers up to 7680 × 4320 for the reference video. Higher resolutions load, but the current Steam Frame Chromium build uses software video decoders and could not sustain 4K or 8K playback in the tests below.
- The original YouTube video keeps running for audio and controls. The separate stereo video follows its clock, correcting drift above 150 ms. This uses two decoders and extra bandwidth; buffering can temporarily disrupt synchronization.
- Metadata observation covers main-thread MediaSource playback. Worker-owned MediaSource, direct media URLs, or initialization data absent from the observed stream require another acquisition path.
- The initialization capture is capped at 2 MiB. Mesh decompression is capped at 4 MiB.
- Explicit cubemap projection boxes, camera-motion (`camm`) stabilization tracks, and spherical V1 XML are not implemented.
- Protected or cross-origin video frames that the browser refuses to upload to WebGL produce a playback error.
- Mesh CRC fields are not validated; structural sizes, indices, and allocation limits are checked.
- Navigation releases the stereo stream and exits VR. For direct rendering of YouTube's original stream, a stream change also stops the viewer.

## Implementation

The extension runs one bundled script in YouTube's main JavaScript world at `document_start`. It observes `MediaSource.addSourceBuffer`, `SourceBuffer.appendBuffer`, and object-URL creation while forwarding the original calls. Parsed metadata is associated with the specific media source behind the selected video element.

The VR acquisition path reads an initialization range and segment index from the selected CDN URL. It appends requested segments into a separate MediaSource, fetching approximately eight seconds ahead and evicting distant buffered data. Explicit range requests are necessary for the tested URLs: assigning the raw URL directly to a video element returned HTTP 403.

The renderer uploads the selected decoded video element as a WebGL texture. It applies the metadata's eye-specific mesh and texture crop for each WebXR view. Headset translation is removed because the recorded image has a fixed camera origin; headset rotation controls the viewing direction.

All extension code is bundled locally. Stereo requests go directly from the YouTube page to YouTube and its Google Video CDN. There is no background service, external server, or download helper. IWER and Playwright are development dependencies and are excluded from the extension bundle.

## Development and validation

```sh
npm install
npm run build
npm test
npm run test:browser
npm run test:youtube
```

Browser tests currently use installed Microsoft Edge and `ffmpeg` on PATH. They generate a stereo color fixture, add spherical metadata to its fragmented MP4, and play it through a real MediaSource. Pixel checks verify left/right selection and vertical orientation. IWER checks the immersive session path. Screenshots and results are written to `test-output/`.

The separate `test:youtube` command accesses the reference video and checks stereo streaming, decoded dimensions, seeking beyond 90 seconds, pausing, emulated VR entry, and navigation cleanup. It uses a fresh browser profile. The latest fresh-profile run received stereo segments successfully, but YouTube's original player failed after seeking; the same failure reproduced without the extension. Because the original player supplies audio and the playback clock, that live test currently fails in that environment. Earlier short-playback integration tests passed. Unpacked Manifest V3 injection was also verified in Edge.

### Steam Frame device test

The extension is installed for testing at `/home/steamos/chromium-xr/extensions/youtube-webxr`, in a separate Chromium profile at `/home/steamos/.config/youtube-webxr-test`. The existing Chromium launcher and normal profile are preserved.

The running test browser uses the user service `youtube-webxr-test` and a loopback debugging port of 9222. To reconnect from this workstation, keep this tunnel open in a separate terminal:

```sh
ssh -N -L 127.0.0.1:19222:127.0.0.1:9222 steamos@frame
```

Then run `npm run test:frame`. This reloads the reference video, seeks past 90 seconds, checks decoded stereo frames, enters native VR, and verifies that headset poses contain left and right views. Allow the browser's VR permission prompt if requested. It leaves the viewer open for visual inspection. `FRAME_CDP_URL` can override the debugging address.

Device observations on 2026-10-26: native XR frames and both eye views were delivered. The final packaged build passed `test:frame` at 98.48 seconds with 25 tracked XR frames, both eye views, and zero dropped video frames out of 1,250. An earlier longer sample recorded 3 dropped frames out of 5,065 across playback and seeking, with about 68 ms of clock drift. The user confirmed correct stereo and head tracking. The runtime reported `visible-blurred` during automated monitoring, so performance measurements remain preliminary.

### Maximum-resolution test

Further tests on 2026-10-26 used native immersive VR with runtime visibility `visible`, the same reference video, and its 60 fps stereo representations. Dimensions below describe the complete frame containing both eyes. Each run started near 30 seconds into the video; measurements include startup and synchronization recovery.

| Actual decoded resolution | Codec | Sample | Presented video callbacks / second | Observed result |
| --- | --- | --- | --- | --- |
| 7680 × 4320 (8K) | AV1 | 20 seconds | 0 | Loaded the stream and entered VR, but presented no new video frames during the sample. |
| 3840 × 2160 (4K) | AV1 | 30 seconds | 0.63 | Occasional frames, about 4.35 seconds behind the video clock at the end, despite roughly 10 seconds buffered ahead. |
| 2560 × 1440 | AV1 | 30 seconds | 29.94 | Startup stalls followed by roughly 45–48 callbacks/second; 12.4% of reported video frames dropped over the full sample. |
| 1920 × 1080 | H.264 | 30 seconds | 55.47 | Best measured result; 7.1% dropped frames, about 20 ms final presentation lag. Several five-second intervals reached about 60 callbacks/second. |

These callback rates measure new video presentations, separately from the headset's XR animation rate. At 4K and 8K the video clock continued advancing through synchronization seeks while the picture stalled, so the dropped-frame counter alone understated the problem. The browser reported the software `Dav1dVideoDecoder` for AV1 and `kIsPlatformVideoDecoder: false`. Hardware decode integration and the player's synchronization behavior need investigation before claiming smooth higher-resolution playback on this setup.

The first 2160p request fell back to 1440p; a subsequent run selected and tested actual 2160p. The player chooses the next eligible representation if a higher one cannot be opened. Check decoded dimensions rather than relying on the requested resolution alone.

To repeat a measurement with the SSH tunnel open:

```sh
npm run test:resolution -- 4320
npm run test:resolution -- 2160
npm run test:resolution -- 1440
npm run test:resolution -- 1080
```

This reloads the reference page, selects the requested maximum, enters native VR, and records actual dimensions, codec, decoder, buffering, presentation callbacks, and XR frames. The 1440p test adds a temporary selector option to that page. `FRAME_SAMPLE_SECONDS` changes the default 30-second sample. Reports are saved under `test-output/frame-HEIGHTp.json`; the initial 1440p fallback measurement is `frame-2160p-fallback.json`. The viewer was restored to 1080p after testing.

### Decoder investigation

The 2026-10-26 follow-up found a browser/driver integration gap and a separate synchronization problem:

1. **The installed browser has no usable hardware decode backend for this device.** Chromium's `SystemInfo.getInfo` reports an empty `videoDecoding` list, even though its general `video_decode` feature status says enabled. Rendering uses Adreno 750 through Mesa/ANGLE/Zink. Symbol inspection of the installed, symbol-bearing Chromium binary found `VaapiVideoDecoder::Create`, but no V4L2 decoder implementation. Steam Frame exposes its Qualcomm Iris decoder through V4L2 at `/dev/video-dec0` (`/dev/video22`). The `steamos` account belongs to the video group and successfully queries that node. No VA-API driver library was found in the checked system driver directories. This evidence points to a build/backend mismatch rather than a device-node permission failure.
2. **The installed kernel interface does not expose AV1 decoding.** `VIDIOC_ENUM_FMT` lists H.264, HEVC, and VP9 as compressed input formats; AV1 is absent. The supported formats advertise frame dimensions up to 8192 × 8192. Qualcomm's [Snapdragon 8 Gen 3 product brief](https://docs.qualcomm.com/bundle/publicresource/87-71408-1_REV_D_Snapdragon_8_gen_3_Mobile_Platform_Product_Brief.pdf) lists hardware H.265, VP9, and AV1 decoding, so the observed Linux interface exposes a subset of the silicon's documented capabilities. The reference video's 8K representation is AV1. Enabling a browser V4L2 backend would still leave that AV1 driver gap to resolve.
3. **Repeated synchronization seeks amplify slow decoding.** `LinkedVideo` corrects drift above 150 ms every 100 ms. During the 4K experiment, suppressing those corrections in the test page allowed roughly 33.23 new video presentations per second over 20 seconds, compared with 0.63 in the earlier synchronized run. The experiment suppressed 208 seek requests and ended about 1.69 seconds behind the original video's audio clock, with 43.9% dropped video frames. This is evidence that frequent decoder resets worsen playback, and that simply disabling synchronization is insufficient. A follow-up synchronized run recorded 39 seek requests and only three video callbacks before a network failure ended that run; it is not a completed performance sample.

These tests isolate concrete gaps without establishing full hardware-decoder throughput. A separate FFmpeg V4L2 H.264 probe opened Iris and produced one frame, then stalled and was terminated. Browser V4L2 integration therefore also needs an actual sustained decode and buffer-import test; advertised dimensions alone do not establish 8K60 performance.

The next implementation work is to build Chromium with a working V4L2 stateful decode path and compatible output-buffer import, verify H.264/VP9 acceleration, and change synchronization so buffering does not repeatedly restart decoding. Chromium's [build configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/media/gpu/args.gni) defaults `use_v4l2_codec` to false and configures VA-API separately. Its [Linux decoder features](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc) control runtime selection of compiled backends. The extension currently selects MP4, so using this video's hardware-supported 4K VP9 representation also requires a WebM streaming path. Hardware AV1 requires a driver/API path that actually exposes it.

Evidence is saved in `test-output/frame-gpu-info.json`, `frame-decoder-platform.txt`, `frame-2160p-without-sync-seeks.json`, and `frame-2160p-resolution-test.json`. The benchmark supports `FRAME_START_TIME` and `FRAME_SUPPRESS_SYNC_SEEKS=1` for temporary page-local experiments. Reloading removes the experimental setter override; production playback code and the installed browser were not modified by this investigation.

To inspect a live YouTube page in a clean, headless Edge session:

```sh
node scripts/inspect-youtube.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
```

That diagnostic uses a fresh browser profile. Its available formats and playback access may differ from your normal headset browser session.

## Evidence behind the approach

- [Google's VR180 specification](https://github.com/google/spatial-media/blob/master/docs/vr180.md) describes projection meshes and optional camera-motion metadata.
- [Spherical Video V2](https://github.com/google/spatial-media/blob/master/docs/spherical-video-v2-rfc.md) defines the MP4/WebM projection and stereo metadata parsed here.
- [yt-dlp's YouTube format processing](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py) reads `projectionType` from stream responses.
- [yt-dlp's client configuration](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py) supplies the `VISIONOS` client identity used here. Direct device testing on 2026-10-26 confirmed stereo metadata and media beyond the first minute for the reference video.
- [WebXR](https://www.w3.org/TR/webxr/) supplies per-eye views and immersive presentation.
