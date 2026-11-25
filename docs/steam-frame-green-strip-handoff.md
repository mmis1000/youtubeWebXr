# Steam Frame handoff — intermittent green strip in one eye

**2026-11-25, Asia/Taipei.** The user sees a narrow green vertical strip flash in one eye on two VR videos. The affected eye, screen position and a repeatable timestamp are unknown. **No user-observed flash has been paired with a capture of that same headset frame.** The evidence leaves the video texture, projection, SteamVR compositor and display as possible stages. A separate SteamVR assertion can prevent VR entry.

**Last verified headset state.** At the user's request I stopped the test, closed all four tabs in the Steam-launched Chromium, and verified one blank tab with zero media elements. I restored the launcher after temporarily enabling a diagnostic port. No green-strip fix was deployed.

## Tested setup

| Component | Configuration |
| --- | --- |
| Headset | Valve Steam Frame, Snapdragon 8 Gen 3, Adreno 750 |
| OS and decoder | SteamOS 0.5.10 preview, kernel `7.2.0-g04c7e99cb73a`, stock updated Qualcomm Iris driver, Chromium `V4L2VideoDecoder` |
| Browser | Custom arm64 Chromium **157.0.8103.15**, executable `~/chromium-xr/chrome`, normal profile `~/.config/chromium-xr` |
| Viewer | YouTube WebXR **0.3.1** installed via Violentmonkey. It uploads video to WebGL and renders both eyes through XRWebGLLayer. WebGPU was an earlier prototype. |
| Videos | [NIO-zSgWkgQ](https://www.youtube.com/watch?v=NIO-zSgWkgQ), tested at 7680 × 4320, 60 fps, AV1 itag 571. [ckoV0SmomDI](https://www.youtube.com/watch?v=ckoV0SmomDI), Minato Aqua, viewer set to 2160p, ordinary player at 1080p. The latter was **paused** around 1:38 when inspected. That was not a user-reported flash timestamp. |

Installed launcher: `~/.local/bin/chromium-xr`. Relevant flags:

```sh
--enable-features=OpenXR,AcceleratedVideoDecoder,Vulkan
--enable-blink-features=AudioVideoTracks
--use-gl=angle --use-angle=vulkan
--disable-features=VulkanFromANGLE,DefaultANGLEVulkan
--ozone-platform=x11
```

These flags fixed an earlier half-speed playback issue. The former GL configuration converted NV12 to AR24 on the CPU. The deployed Vulkan configuration allowed direct texture import and sustained 59.95 presented fps offline. Live YouTube advanced at 1× with maximum sampled audio/video drift of 18.85 ms, dropping 362 of 2,418 video frames. The viewer suspends the original YouTube video track during VR and retains its audio clock. The user confirmed stereo and head tracking in that earlier offline test. That confirmation predates the strip investigation. [Playback measurements](steam-frame-8k-validation.md) · [Launcher commit](https://github.com/mmis1000/chromium-webxr-steam-frame/commit/f4305e1) · [Viewer release](https://github.com/mmis1000/youtubeWebXr/releases/tag/v0.3.1)

## What the probes established

| Test | Observation and limit |
| --- | --- |
| Offline 8K clip, before VR projection | Sampled a 32 × 18 WebGL draw of the video texture on 3,119 video callbacks. No sampled point met the green threshold. A narrow strip can fall between sampled columns. This measured texture output, downstream of the decoder. |
| 2160p Minato Aqua, eye preview | Sampled five rows across the preview framebuffer through the passage around 1:38. All 3,946 sampled draws had nonzero image data, zero GL errors and zero matching green columns. |
| 2160p Minato Aqua, native XR in a fresh isolated profile | 4,218 framebuffer reads, 3,978 with nonzero data, zero GL errors and zero matching columns. Final session state was `visible-blurred`. **The user reported this scene was never foregrounded and had no menu entry.** This run cannot establish what reached the headset. |
| Steam-launched Chromium, normal profile | Steam tracked the shortcut and reported VR mode. The viewer then reported “The specified session configuration is not supported.” The instrumented tab recorded zero XR frames. This attempt supplies no visual evidence. |

The strip detector sampled rows at 20%, 35%, 50%, 65% and 80% of framebuffer height. A column qualified if green exceeded both red and blue by more than 40 on at least four rows. A shorter or dimmer strip could escape the detector. Synchronous readback also changes GPU timing. Neither probe captures the final display image. An earlier direct-Iris comparison sampled pixels in the first 120 frames of the 8K clip on repeat. It cannot exclude corruption elsewhere.

## Separate XR entry failure

At **02:48:31 local time**, SteamVR's client log reported this immediately after acquiring scene focus:

```text
ASSERT: "pVulkanDevice->m_pDevice == m_pExportDevice" at /data/src/common/vrcommon/vrrenderer/sharedresource_linux.cpp:1693.
Aborting due to fatal assertion failure.
```

Chromium recorded signal 6 with `xrBeginFrame` and `device::OpenXrApiWrapper::BeginFrame()` on the stack. The same assertion occurred before this probe at 02:40, 02:42, 02:43 and 02:45. It explains a failed capture attempt. Its relationship to the visible strip during playback remains unknown. Earlier, a stuck passthrough view recovered after `systemctl --user restart steamvr.service`. The user confirmed normal tracking without a reboot.

## Access and evidence

- Windows workspace: `C:\Playground\YoutubeWebVr`. Launcher checkout: `C:\Playground\chromium-webxr-steam-frame`. Headset: `ssh steamos@frame`. Earlier build host: `ssh -p 2222 root@nas`, checkout `/root/chromium-xr/src`. That cached source is older than the installed 157 binary.
- Local evidence: `test-output/av1-offline-20261125/`. The script/result pairs are `green-test.mjs` / `green-samples.json`, `preview-strips.mjs` / `preview-strips.json`, and `eye-isolated.mjs` / `eye-strips.json`. The last JSON is from the isolated run. These scripts open new tabs and some set a saved resolution. Adapt them to reuse the single visible tab. The directory also contains private signed media URLs. Share the handoff and selected result files only.
- Headset evidence: `~/av1-offline-20261125/`, including the offline clip, `browser.log` and `normal-browser.log`. SteamVR logs: `~/.local/share/Steam/logs/vrclient_.txt` and `vrcompositor.txt`. The offline HTTP server used headset loopback port 8766.
- Normal-browser CDP tunnel: `ssh -N -L 19225:127.0.0.1:9225 steamos@frame`. The isolated browser used 9226 forwarded to 19226. Verify what is already listening before opening another instance.
- Steam shortcut **Chromium XR**: app ID `3504832870`, full game ID `15053142554629373952`. On the headset, `DISPLAY=:0 steam steam://rungameid/15053142554629373952` launched a Steam-tracked process. Its default launch URL is the WebXR samples page, and Steam/Chromium can also restore prior tabs. Launching the executable directly over SSH produced XR callbacks without a visible headset scene.

## Next discriminating test

Start with one tab and one audio source. Verify the tab inventory after launch, bring the intended video forward, and have the user confirm they see that exact scene before recording. Ask the user to mark the next flash and identify the eye and screen position. Correlate that event with both application eye buffers and, if available, a compositor capture. A strip already present in the eye buffer points back toward the texture or projection. A user-visible flash with clean eye buffers at that instant shifts the investigation downstream to SteamVR and the display. If XR entry aborts first, resolve entry before interpreting frame counts.

## Headset capture result (2026-11-25, 03:03–03:14)

**The strip is in what the headset displays, and it comes from the video texture, before the viewer's projection.** The Steam Remote Play client window (`Steam [Streaming]`, one eye) was recorded on Windows with ffmpeg's Windows Graphics Capture source, which works while the window is covered:

```sh
ffmpeg -f lavfi -i "gfxcapture=window_exe=streaming_client:capture_cursor=0:max_framerate=60" \
  -c:v hevc_amf -rc cqp -qp_i 16 -qp_p 16 rec.mkv
```

Each frame was scanned at full width for columns where at least 20% of rows are strongly green (`scan.py`). The user reported a flash at 03:13:2x. The recording shows a full-height green strip at 03:13:11.2 (181.7 s into the second recording), and another hit at 192.0 s. The first, 6½-minute recording had 8 hit frames, each lasting one or two capture frames. Evidence: `test-output/green-strip-capture-20261125/`.

What the frames show:

- **Color.** The median strip pixel is about RGB (13, 130–187, 13). That is the color of an NV12 region with Y≈0 and UV≈0, meaning video memory that holds no decoded data. It is not a WebGL clear color or a shader artifact.
- **Video-space geometry.** Strips tilt with head roll and follow the projection. They start at the top of the image and stop at different heights, ending in a short black tip with horizontal steps. So a column of the decoded frame is unwritten from the top down to some row.
- **Position and width vary.** They are 16–85 stream pixels wide (1920-wide stream) and appear at different x positions. The user reports the strip in the left eye only. For side-by-side VR180, that is the left half of the decoded frame.

Taken together, the decoded video frame is incomplete when it is sampled, or the buffer was recycled while a sample was in flight. The compositor and display reproduce the corruption faithfully. The 32×18 texture probe missed it because the strips are narrow, appear in single frames, and its synchronous readback changes timing.

**Next discriminating test.** Run the same playback with hardware decode disabled (`--disable-accelerated-video-decode`, software dav1d at 2160p) and record again. If strips disappear, the fault is in the V4L2/Iris decode path or in Chromium's buffer lifetime around it, not in the viewer. Playing the same video in the ordinary 2D player with the capture running separates decoder corruption from the WebGL import path.

### Frame comparison and 2D result (03:13–03:33)

- In the 03:13:11 hit frame, the content left of the strip best matches capture frames 3–5 later (mean abs diff 1.5). The content right of it best matches the previous frame (5.2). The strip is the decoder's write front: the buffer on display is already being overwritten with a frame about two video frames ahead.
- The user also saw the flash in YouTube's own player for the VR180 video. That player still renders through YouTube's WebGL spherical viewer, so it uses the same WebGL video upload path. It is not a compositor-only test.
- **Flat 8K AV1** (itag 571, `av01.0.17M.08`, same codec and itag) in YouTube's ordinary player goes through the compositor without WebGL. The user saw no strips there, while VR showed them often. The decoder does not corrupt frames on its own. The failure is specific to WebGL uploads.

## Root cause and fix (verified 2026-11-25, 04:39–04:58)

On this configuration (V4L2 stateful decoder, MMAP CAPTURE queue with 10 buffers, `MailboxVideoFrameConverter`), a decoded buffer returns to the decoder as soon as the last reference to its frame is dropped. The compositor holds frames until its GPU reads finish (read-lock fences), so it is safe. A WebGL `texImage2D(video)` copy releases the frame too early, and the decoder writes the next frame into a buffer the copy still reads.

Neither upstream Chromium `main` (2026-11-24) nor the upstream Iris driver (through 2026-11) changes this lifetime or release logic. The Qualcomm PR merged 2026-11-24 that uses the firmware output count for AV1/VP9 split mode fixes seek failures, not this.

Viewer fix (`src/render.js`): upload each new frame through a WebCodecs `VideoFrame` and keep the latest one open until the next upload, which holds the decoded buffer for one frame interval. Held frames are released on `seeking`, `emptied`, `loadstart`, `ended`, `waiting`, `resize` and source changes, so they never block a decoder flush. Holding 3 frames starved the 10-buffer decoder and made playback stall and blink. One frame does not.

A/B test: a single looping 2160p VR180 video in VR, with each run recorded from the Steam Remote Play window and scanned frame by frame.

| Build | Frames scanned | Strip frames | Events |
| --- | --- | --- | --- |
| Hold 1 frame | 28,800 | 0 | 0 |
| No hold (one-line change) | 28,800 | 15 | about 10 |

## Loop and next-video stall — fixed

The stereo video follows the original's playhead. After a loop, seek or playlist advance, its seek target was often outside what `RangeStream` had fetched. The original kept playing from its own buffer, so the stream chased a moving target one segment at a time. The result was about 14 s of black after a loop, and sometimes a seek that never finished because sync skipped correction while `seeking`. Fixes in `src/youtube.js`:

- While the stereo video is not ready, the original is paused, audio included, and resumes when the stereo video catches up. The end of the stream counts as ready. Hold pauses do not change the user's play intent (`src/main.js`).
- A seek stuck longer than 1.5 s is retargeted to the original's current time.

Verified in VR: at the loop point the original was held for under 2 s, then both ran in sync (about 0.1 s apart).

## Still open

- **First VR entry after a page reload** aborts the Chromium XR process with SteamVR `ASSERT: "pVulkanDevice->m_pDevice == m_pExportDevice"` (`sharedresource_linux.cpp:1693`). Seen at 04:19:53, 04:25:04, 04:26:29, 04:38:02 and 04:49:45. A second press works, and a freshly started browser enters fine.
- After `systemctl --user restart steamvr.service`, every WebGL upload of hardware-decoded video failed with `GL_INVALID_VALUE` ("Couldn't create SkImage from source shared image"), even across Chromium restarts. A reboot cleared it.
- Root fix in Chromium: keep the V4L2 buffer until consumers' release sync tokens or fences signal, or make the WebGL upload path hold frames as the compositor does.

## First "Enter VR" always failing — fixed

Cause: Steam's `steam-launch-wrapper` exports `TU_DEBUG_FILE=/tmp/tu_debug_file.txt` to every app it launches. With that set, Mesa's turnip Vulkan driver (`libvulkan_freedreno.so`, `os_file_notifier_create`) calls `inotify_init1(IN_NONBLOCK)`. The XR service's seccomp policy (`xr_compositing`) blocks that syscall. The first XR utility process dies with SIGSYS: minidump crash key `seccomp-sigsys nr=0x1a`, coredump at 03:29. The page gets `NotSupportedError: The specified session configuration is not supported.` Chromium respawns the service, and the second press works.

Fixes:
- Launcher (`chromium-webxr-steam-frame/frame/chromium-xr`): `unset TU_DEBUG_FILE TU_DEBUG` before `exec`. After the change, the first press entered VR (session in 421 ms) and no new crash was recorded.
- Viewer (`src/main.js`): `isSessionSupported` ran once at page load. Right after a browser start it can return false before the XR service is ready, which left the Enter VR button disabled for good. The viewer now re-checks on `devicechange` and every 2 s while VR is reported unavailable.
