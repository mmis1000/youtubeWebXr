# UX implementation review notes

The behavior requirements are in [ux-design.md](ux-design.md). Panel geometry, controller mesh shape, module boundaries, and rendering techniques are implementation choices. Review those choices against the required behavior.

## Implemented

- Enter VR and Details in YouTube's player controls; the floating resolution row appears only during VR.
- Last successful VR resolution, closest available selection with lower tie-breaking, and synchronized page/headset quality controls.
- A headset panel with playback, timeline, seeking, quality, recenter, exit, and error/retry controls. It starts visible and supports hide/show.
- Tracked controller silhouettes, outlines, pointing rays, and cursors, with hover/press feedback on panel controls.
- Trigger away from the panel toggles UI visibility; Hide UI also hides it. A trigger press while hidden restores the panel without changing playback. Controller outlines remain visible. Preparation, seeking, and new errors reveal the panel.
- Source changes retain the XR session. Preparation and seeking preserve playback intention. Preview can enter VR directly.
- Cancellation, navigation, exit, and source failure release or replace the associated media work.

## Verification on October 31, 2026

`npm run build`, all 24 unit tests, `npm run test:browser`, `npm run test:userscript`, and `npm run test:panel` passed locally. Browser tests use real indexed MP4 and VP9 WebM playback and IWER input to check format filtering, cross-container switching/seeking, failure/retry, cancellation, selection consumption, cleanup, and control-bar replacement. Visibility tests check that hidden panels stop drawing, showing the panel preserves playback, and recovery restores the panel. Stereo color checks verify eye separation and orientation in both containers. Page checks cover mutually exclusive settings popovers and Details fitting inside a 320 px player.

## Changes after implementation review

- Round 2 adopts the proposed graphite palette, explicit font stack, rounded controls, red progress track, white primary transport button, and neutral Exit. The fixed 1024 × 312 card measures 1.28 × 0.39 m and tilts 20° toward the viewer. All states keep the same size. Timeline hover/drag previews the target timestamp. The slashed-eye header icon hides the UI; no instructional hints are drawn.
- The quality menu replaces the transport row. Up to six qualities fit directly; longer lists show four per page with 72 px-tall navigation controls. Exit remains available in the header. The active choice is white; pending choices use a spinner. Loading text appears once. On error, Retry replaces Play/Pause and the quality control retains the requested height. Disabled controls ignore active fills and hover rings.
- Rounded corners blend over the video. The 1024 × 512 backing texture remains power-of-two for mipmap generation, with the visible card cropped to 312 px. Mipmaps regenerate after each upload. Render checks verify transparent corners, the mipmap filter, constant height, target bounds, pagination, and a single loading label. Ray tests verify targeting against the tilted panel.
- Validated formats, headers, and indexes are cached for the active preview/VR session. Quality switches reuse them. The cache expires after at most five minutes, or thirty seconds before a signed URL expires. Exit, navigation, and playback/preparation failures clear it. Retry then performs fresh discovery. Tests count requests across switches and retry, and cover expiry and cancellation.
- Unsupported-browser feedback appears in Details. Diagnostics use the manifest version, retain live updates capped at twice per second, and DOM attachment work is coalesced over 100 ms.
- Page controls reuse the graphite tokens and rounded shapes. Opening VR details closes YouTube settings, and opening YouTube settings closes VR details. The popover is constrained by the player dimensions. The existing text entry remains in the YouTube control bar.

[Updated panel renders](review/xr-panel-updated.png) show the round-2 visual design. The updated extension build ran at 2160p on Frame, and the wearer confirmed that the tilted card is readable and the new controls and quality pills align correctly with controller pointing.

The updated build was installed in Frame's separate test profile. A live 2160p → 1080p → 2160p switch kept discovery counts at one player request and four initialization-header requests throughout. Playback returned to 3840 × 2160 with readyState 4, confirming reuse of validated sources on the device.

The separate test Chromium profile on Steam Frame loaded the new extension UI on `38jcxsq8EBU`. The subsequent format update adds WebM cue-based streaming and validates projection metadata and indexes before listing resolutions. The menus now include 1440p and 2160p VP9 WebM; the 2160p source decoded at 3840 × 2160 on Frame, with audio and stereo clocks within 20 ms in the initial captured sample. Playback also advanced past 99 seconds. The wearer confirmed correct stereo and headset switching between 1080p and 2160p. The browser fixtures exclude flat, unsupported-codec, missing-projection, and missing-index representations from the menu.

For `yVLssFEqKmo`, the initial selector listed 144p through 4320p. The subsequent user-selected 720p minimum excludes the lower entries from both menus and automatic source selection. Native playback decoded 1920 × 1080 and switched to 3840 × 2160 within the existing VR session. The 2160p selection was saved successfully. Listing 4320p confirms source availability; this UX test has not measured 4320p playback performance.

This second video exposed a CDN redirect failure: an HTTP redirect to another media host caused the browser to send `Origin: null`, and the destination omitted its CORS permission header. Requesting `alr=yes` returned the destination as text. Following that URL with a separate page request succeeded on Frame. Both initialization and segment requests now use this path, validate destination hosts, and bound redirect size and count. Automated tests cover the redirect path in both bundles.

The wearer confirmed that controls and playback work after checking the controller outlines, headset panel, Pause, Recenter, and resolution menu at 2160p. The updated userscript has passed browser automation; this UX build has not yet been validated through the installed userscript manager on Frame.

These changes are included in v0.2.0. The v0.1.0 packages contain the previous interface. Tag CI builds and tests the extension and userscript before publishing the release assets.
