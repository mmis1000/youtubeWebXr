# Steam Frame 8K AV1 validation — November 25, 2026

Test video: [NIO-zSgWkgQ](https://www.youtube.com/watch?v=NIO-zSgWkgQ), VISIONOS format 571, AV1 Main, 7680 × 4320 at 60 fps, stereo mesh projection. The offline copy used the same compressed video packets, without re-encoding.

The headset ran SteamOS 0.5.10 preview, kernel `7.2.0-g04c7e99cb73a`, the stock updated Iris driver and Chromium `157.0.8103.15`. Existing Chromium V4L2/AV1 patches remained installed. This change requires no new kernel module, firmware or Chromium binary.

## Cause and configuration

The former ANGLE OpenGL configuration selected `LibYUVImageProcessorBackend` to convert decoded NV12 into AR24 on the CPU. Its image-processor thread occupied approximately one CPU core. The offline 8K clip advanced only 18.72 seconds in 40.16 seconds with that configuration.

The tested launcher flags are:

```sh
--enable-features=OpenXR,AcceleratedVideoDecoder,Vulkan
--use-gl=angle --use-angle=vulkan
--disable-features=VulkanFromANGLE,DefaultANGLEVulkan
--enable-blink-features=AudioVideoTracks
--ozone-platform=x11
```

Skia and ANGLE both use Vulkan, with separate devices. NV12 remains on the GPU and direct video texture uploads succeed. Enabling `VulkanFromANGLE` instead produced `Importing textures with external sampling into GL is not possible` errors. Canvas conversion and WebGPU projection prototypes were evaluated; they are not part of the shipped viewer.

The AudioVideoTracks API lets version 0.3.1 deselect YouTube's background video track while retaining its audio and media clock. The original selected track is restored when the separate VR stream is disposed, including failed preparation. Track replacements are handled while playback is active. Browsers without this API retain the previous behavior, and video-only originals retain their track so their clock keeps running.

## Results

| Test | Result |
| --- | --- |
| Offline 8K60, native VR | 40.1684 media seconds / 40.1685 wall seconds; 59.95 presented fps; 2 dropped frames; no buffering or seeks during measurement |
| Offline headset presentation | Both eye views and head tracking confirmed visually by the user; approximately 72 XR callbacks/s |
| Live YouTube, installed userscript 0.3.1 | 40.2254 media seconds / 40.2398 wall seconds; 0.99964× speed |
| Live synchronization | Maximum sampled absolute audio/video drift 18.85 ms |
| Live frames | 2,418 total video frames, 362 dropped; 60.71 XR callbacks/s |
| Background video during VR | Zero additional original-player video frames; its selected video-track count stayed zero |
| Exit | Original video track selected again; decoding resumed; separate muted stream removed |

The half-speed behavior is fixed. Live YouTube still drops frames and is not frame-perfect 8K60. Video-frame counts and XR callback counts measure different stages; neither alone proves every source frame reached the display.

Only one YouTube tab was open for the final live measurement. Earlier normal-profile trials included a restored duplicate tab; those are excluded from the final results. A stuck SteamVR passthrough view during experimental rendering tests was recovered by restarting `steamvr.service`, without rebooting the headset. The user confirmed normal tracking after recovery.

The [Snapdragon 8 Gen 3 HDK specification](https://www.lantronix.com/products/snapdragon-8-gen-3-mobile-hardware-development-kit/) lists 8K60 playback. The offline result establishes that this exact AV1 clip can run at that rate on this headset and driver configuration.

Automated checks: 26 unit tests, extension browser tests and userscript browser tests passed. Native checks covered hardware decoder selection, stereo views, playback timing and video-track restoration. [Machine-readable results](steam-frame-8k-validation.json) contain the final measurements without signed media URLs or account data.
