# Steam Frame Hardware & Browser Notes

Factual environment details, driver configurations, and measured results for running WebXR YouTube playback on **Valve Steam Frame**.

## Target Hardware & Software Stack

| Component | Details |
| :--- | :--- |
| **Headset / SoC** | Valve Steam Frame — Qualcomm Snapdragon 8 Gen 3, Adreno 750 GPU |
| **Hardware Decoder** | Qualcomm Iris stateful V4L2 decoder (`/dev/video-dec0` / `/dev/video22`), `V4L2VideoDecoder` |
| **OS Tested** | SteamOS 0.5.10 preview (`7.2.0-g04c7e99cb73a`), stock Iris driver with H.264, HEVC, VP9, and AV1 support |
| **Browser** | Custom ARM64 Chromium (`157.0.8103.15`) at `/home/steamos/chromium-xr/chrome` |
| **Related Repos** | [`mmis1000/chromium-webxr-steam-frame`](https://github.com/mmis1000/chromium-webxr-steam-frame) (Chromium + V4L2 + OpenXR build/launcher), [`mmis1000/steamframe-iris-av1-poc`](https://github.com/mmis1000/steamframe-iris-av1-poc) (earlier Iris AV1 driver PoC) |

## Device Access & Debugging Setup

- **Headset SSH:** `ssh steamos@frame`
- **Browser profiles:** `~/.config/chromium-xr` (normal), `~/.config/youtube-webxr-test` (isolated test profile)
- **Launcher script:** `~/.local/bin/chromium-xr`
- **Steam shortcut (`Chromium XR`):** App ID `3504832870`, game ID `15053142554629373952`
  - Launch from SSH under Steam tracking: `DISPLAY=:0 steam steam://rungameid/15053142554629373952`
  - *Note:* Launching `/home/steamos/chromium-xr/chrome` directly over SSH without Steam's game launch produces OpenXR frame callbacks in `visible-blurred` state without foregrounding a visible scene in the headset.
- **CDP port forwarding (used by `scripts/test-frame.mjs` and `scripts/test-frame-resolution.mjs`):**
  ```sh
  ssh -N -L 127.0.0.1:19222:127.0.0.1:9222 steamos@frame
  ```
- **SteamVR logs:** `~/.local/share/Steam/logs/vrclient_.txt` and `vrcompositor.txt`

## Verified Chromium Launcher Configuration

```sh
unset TU_DEBUG_FILE TU_DEBUG
exec /home/steamos/chromium-xr/chrome \
  --enable-features=OpenXR,AcceleratedVideoDecoder,Vulkan \
  --use-gl=angle --use-angle=vulkan \
  --disable-features=VulkanFromANGLE,DefaultANGLEVulkan \
  --enable-blink-features=AudioVideoTracks \
  --ozone-platform=x11 \
  "$@"
```

### Why These Flags Matter

1. **GPU NV12 Import (`--use-gl=angle --use-angle=vulkan` + `--disable-features=VulkanFromANGLE,DefaultANGLEVulkan`):**
   - Earlier OpenGL configurations fell back to `LibYUVImageProcessorBackend` on the CPU to convert NV12 to AR24, pegging a CPU core and cutting 8K60 playback to ~0.47× speed (18.72 media seconds in 40.16 wall seconds).
   - Keeping Skia and ANGLE on Vulkan with separate Vulkan devices keeps decoded NV12 buffers on the GPU and avoids `Importing textures with external sampling into GL is not possible` errors seen when `VulkanFromANGLE` is enabled.
2. **Preventing First-Entry `SIGSYS` Crash (`unset TU_DEBUG_FILE TU_DEBUG`):**
   - Steam's `steam-launch-wrapper` sets `TU_DEBUG_FILE=/tmp/tu_debug_file.txt`. Mesa's Turnip driver (`libvulkan_freedreno.so`) then calls `inotify_init1(IN_NONBLOCK)`, which Chromium's `xr_compositing` seccomp policy blocks (`SIGSYS`, syscall `0x1a`), causing the first `navigator.xr.requestSession('immersive-vr')` call to fail with `NotSupportedError` before the XR utility process respawns. Unsetting `TU_DEBUG_FILE` and `TU_DEBUG` eliminates the crash.
3. **Iris V4L2 Coded-Size Patch (`0002-v4l2-stateful-set-coded-size.patch` in `chromium-webxr-steam-frame`):**
   - Chromium's stateful V4L2 backend originally passed an empty coded size on input format setup, causing Qualcomm Iris to fail `VIDIOC_REQBUFS` with `EINVAL`. Passing `config.coded_size()` fixes hardware buffer allocation.

## V4L2 Buffer Lifetime & "Green Strip" Workaround (`src/render.js`)

- **Symptom:** Intermittent narrow vertical green strips (`RGB ≈ (13, 130–187, 13)`, corresponding to unwritten NV12 memory with `Y≈0, UV≈0`) flashing for 1–2 frames during hardware-decoded WebGL video playback, while non-WebGL compositor playback of flat 8K AV1 showed no corruption.
- **Root cause:** With V4L2 stateful `MMAP` capture queues (10 buffers on Iris AV1) and `MailboxVideoFrameConverter`, `gl.texImage2D(..., video)` releases Chromium's reference to the decoded frame before the asynchronous GPU copy finishes reading it, allowing Iris to start overwriting the buffer with a frame 2–3 frames ahead.
- **Viewer workaround:** `VideoRenderer.upload()` wraps `video` in `new VideoFrame(video)` for `gl.texImage2D` and keeps `HELD_FRAMES = 1` frame open until the next upload (immediately closing held frames on `seeking`, `emptied`, `loadstart`, `ended`, `waiting`, `resize`, and disposal so decoder flushes never deadlock).
  - A/B capture scan (2160p VR180 loop via Steam Remote Play WGC capture): **0 strip frames / 28,800** with `HELD_FRAMES = 1` vs. **15 strip frames / 28,800** without holding. Holding 3 frames starves the 10-buffer V4L2 queue and causes stalls.

## 8K60 AV1 Benchmark Baseline (2026-11-25)

Test clip: `NIO-zSgWkgQ`, `VISIONOS` format `571` (`av01.0.17M.08`, 7680 × 4320 @ 60 fps, stereo mesh projection), Chromium `157.0.8103.15` on SteamOS `0.5.10 preview`:

| Scenario | Wall Time | Media Time | Total Video Frames | Dropped Video Frames | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Offline local file in native WebXR** | 40.17 s | 40.17 s | 2,412 | **2 (0.08%)** | 59.95 presented fps, ~72 XR callbacks/s; confirms hardware + Vulkan path can sustain 8K60 AV1 |
| **Live YouTube in v0.3.1 prototype** | 40.24 s | 40.23 s | 2,418 | **362 (15.0%)** | ~60.7 XR callbacks/s, 18.85 ms max sampled drift; live streaming/upload path still drops frames |

## Open Platform / Runtime Issues

1. **SteamVR Vulkan Assertion on First VR Entry After Page Reload:**
   - SteamVR client log (`vrclient_.txt`) intermittently aborts with:
     `ASSERT: "pVulkanDevice->m_pDevice == m_pExportDevice" at /data/src/common/vrcommon/vrrenderer/sharedresource_linux.cpp:1693`
     during `xrBeginFrame` (`device::OpenXrApiWrapper::BeginFrame()`) on the first `requestSession` after reloading a tab. Avoiding unnecessary `XRSession` teardowns across YouTube SPA navigations mitigates exposure from the extension side.
2. **`steamvr.service` Restart State Corruption:**
   - Restarting `systemctl --user restart steamvr.service` without rebooting can leave subsequent WebGL uploads of hardware-decoded video failing with `GL_INVALID_VALUE` (`Couldn't create SkImage from source shared image`) until a full headset reboot.
