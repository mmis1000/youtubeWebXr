# Steam Frame investigation history

These observations describe the builds and test setups used on 2026-10-26. Current installation and validation notes are in the [README](../README.md). Later Chromium and driver fixes supersede the software-decoding limits recorded here.

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

### Decoder investigation before the V4L2 deployment

The initial 2026-10-26 follow-up found a browser/driver integration gap and a separate synchronization problem. These observations describe the browser before the rebuild documented below:

1. **The installed browser has no usable hardware decode backend for this device.** Chromium's `SystemInfo.getInfo` reports an empty `videoDecoding` list, even though its general `video_decode` feature status says enabled. Rendering uses Adreno 750 through Mesa/ANGLE/Zink. Symbol inspection of the installed, symbol-bearing Chromium binary found `VaapiVideoDecoder::Create`, but no V4L2 decoder implementation. Steam Frame exposes its Qualcomm Iris decoder through V4L2 at `/dev/video-dec0` (`/dev/video22`). The `steamos` account belongs to the video group and successfully queries that node. No VA-API driver library was found in the checked system driver directories. This evidence points to a build/backend mismatch rather than a device-node permission failure.
2. **The installed kernel interface does not expose AV1 decoding.** `VIDIOC_ENUM_FMT` lists H.264, HEVC, and VP9 as compressed input formats; AV1 is absent. The supported formats advertise frame dimensions up to 8192 × 8192. Qualcomm's [Snapdragon 8 Gen 3 product brief](https://docs.qualcomm.com/bundle/publicresource/87-71408-1_REV_D_Snapdragon_8_gen_3_Mobile_Platform_Product_Brief.pdf) lists hardware H.265, VP9, and AV1 decoding, so the observed Linux interface exposes a subset of the silicon's documented capabilities. The reference video's 8K representation is AV1. Enabling a browser V4L2 backend would still leave that AV1 driver gap to resolve.
3. **Repeated synchronization seeks amplify slow decoding.** `LinkedVideo` corrects drift above 150 ms every 100 ms. During the 4K experiment, suppressing those corrections in the test page allowed roughly 33.23 new video presentations per second over 20 seconds, compared with 0.63 in the earlier synchronized run. The experiment suppressed 208 seek requests and ended about 1.69 seconds behind the original video's audio clock, with 43.9% dropped video frames. This is evidence that frequent decoder resets worsen playback, and that simply disabling synchronization is insufficient. A follow-up synchronized run recorded 39 seek requests and only three video callbacks before a network failure ended that run; it is not a completed performance sample.

These tests isolate concrete gaps without establishing full hardware-decoder throughput. A separate FFmpeg V4L2 H.264 probe opened Iris and produced one frame, then stalled and was terminated. Browser V4L2 integration therefore also needs an actual sustained decode and buffer-import test; advertised dimensions alone do not establish 8K60 performance.

The V4L2 rebuild and H.264 validation are completed below. VP9 validation and synchronization changes remain separate follow-up work. Chromium's [build configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/media/gpu/args.gni) defaults `use_v4l2_codec` to false and configures VA-API separately. Its [Linux decoder features](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc) control runtime selection of compiled backends. The extension currently selects MP4, so using this video's hardware-supported 4K VP9 representation also requires a WebM streaming path. Hardware AV1 requires a driver/API path that actually exposes it.

Evidence is saved in `test-output/frame-gpu-info.json`, `frame-decoder-platform.txt`, `frame-2160p-without-sync-seeks.json`, and `frame-2160p-resolution-test.json`. The benchmark supports `FRAME_START_TIME` and `FRAME_SUPPRESS_SYNC_SEEKS=1` for temporary page-local experiments. Reloading removes the experimental setter override; production playback code and the installed browser were not modified by this investigation.

To inspect a live YouTube page in a clean, headless Edge session:

```sh
node scripts/inspect-youtube.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
```

That diagnostic uses a fresh browser profile. Its available formats and playback access may differ from your normal headset browser session.

### V4L2 browser deployment (2026-10-26)

Chromium 156.0.8071.0 was rebuilt in the existing NAS container and deployed to `/home/steamos/chromium-xr`. The existing WebXR sandbox patch, browser profiles, extension and Steam shortcut were retained.

- Build access: `ssh -p 2222 root@nas`; workspace `/root/chromium-xr`, source `/root/chromium-xr/src`, recipe `/root/chromium-xr/recipe`.
- Headset access: `ssh steamos@frame`.
- Build settings in both `recipe/build/build.sh` and `recipe/build/build-nas.sh`: `use_v4l2_codec = true`, `use_vaapi = false`, `use_av1_hw_decoder = false`. The bundled sysroot lacks the V4L2 AV1 definitions; the Frame's Iris interface also lacks AV1. Software AV1 remains available.
- Iris compatibility patch: `recipe/patches/0002-v4l2-stateful-set-coded-size.patch` passes `config.coded_size()` instead of an empty size to the stateful decoder's input format. Iris accepts the empty format but rejects subsequent `VIDIOC_REQBUFS` with `EINVAL`. A direct comparison allocated 16 buffers successfully when the coded size was supplied.
- Launcher features: `OpenXR,AcceleratedVideoDecoder,PreferV4L2VideoAcceleration`.
- Installed executable SHA-256: `16afc346eb9fe7106999ef5bed03d5a636fda1b1c21c062ccffedacb1b5d6565`.

Validation on the headset:

- A local 1080p60 H.264 clip selected `V4L2VideoDecoder`, reported `kIsPlatformVideoDecoder: true`, and reached 682 frames with zero reported drops and no media errors. Browser logs confirmed NV12 output from Iris; a screenshot confirmed rendered video.
- The YouTube stereo H.264 stream also selected `V4L2VideoDecoder`. Native WebXR returned left/right eye poses over 626 XR callbacks. Across the recorded sample interval, video advanced 6.02 seconds and 361 frames with zero reported drops. Runtime visibility was `visible-blurred`.
- The existing end-to-end script timed out waiting for a timestamp beyond 91 seconds after YouTube restarted playback near the beginning. Direct playback and native VR checks then passed from that state. The script itself was not changed.
- `SystemInfo.getInfo().gpu.videoDecoding` remained empty even during successful hardware playback. Per-player decoder properties and actual frame output provide the validation for this build.
- VP9, HEVC and higher-resolution performance were not validated in this deployment. AV1 continues to use `Dav1dVideoDecoder`.

The previous installation is retained at `/home/steamos/chromium-xr-before-v4l2-20261026`; its launcher is `/home/steamos/chromium-v4l2-test-20261026/launcher-before`. After closing Chromium, rollback consists of moving the current installation aside, restoring that directory to `/home/steamos/chromium-xr`, and copying the saved launcher to `~/.local/bin/chromium-xr`.

Build status and logs remain at `/root/chromium-xr/status.json` and `/root/chromium-xr/build.log`. Local evidence, the exact patch, build settings, deployment manifest and playback reports are in `test-output/v4l2-deployment/`.

## Evidence behind the approach

- [Google's VR180 specification](https://github.com/google/spatial-media/blob/master/docs/vr180.md) describes projection meshes and optional camera-motion metadata.
- [Spherical Video V2](https://github.com/google/spatial-media/blob/master/docs/spherical-video-v2-rfc.md) defines the MP4/WebM projection and stereo metadata parsed here.
- [yt-dlp's YouTube format processing](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py) reads `projectionType` from stream responses.
- [yt-dlp's client configuration](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py) supplies the `VISIONOS` client identity used here. Direct device testing on 2026-10-26 confirmed stereo metadata and media beyond the first minute for the reference video.
- [WebXR](https://www.w3.org/TR/webxr/) supplies per-eye views and immersive presentation.

