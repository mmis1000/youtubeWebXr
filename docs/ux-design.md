# YouTube WebXR VR180 — UX proposal

October 31, 2026 · Revised after [design review](ux-design-review.md) and headset-interface feedback

## Scope

Put **Enter VR** in YouTube's player controls and remove the default floating entry entirely. Entry uses the last successfully used VR resolution, choosing the closest available resolution when necessary. While VR is active, show only a small VR-source resolution selector and Details button floating on the YouTube page. Inside the headset, provide visible controllers, playback controls, and a synchronized resolution selector. Quality switching with rollback and new streaming/decoder support are separate work.

## Page controls

Before entry, add a control to YouTube's existing player control bar:

```text
YouTube player controls:  …  [ Enter VR | ▾ ]  …
```

The main button enters VR immediately. Its secondary menu opens **VR details**, containing Eye preview, manual projection, and the existing diagnostics. Entry has no quality-selection step or separate starting-quality field. Preserve keyboard operation and focus indicators. Remove the floating WebXR launcher and **Load stereo stream** button. If YouTube rebuilds its controls, reattach the entry there; do not replace it with a floating launcher.

Only after the XR session opens, show this minimal floating row **on the YouTube page**:

```text
VR source   [1080p ▾]   [Details]
```

The selector controls the separate stereo source, independently of YouTube's normal video-quality setting. It and the headset selector show the same active resolution, pending change, and result. Details expands the same VR details section; closing it returns to the single row. Keep preview, projection choices, full dimensions, and diagnostics out of the collapsed row.

Hide the floating row when VR ends, entry is refused, or the user navigates away. While VR is active, the player-control button becomes **Exit VR**. Place controls within the player so they remain reachable in normal, theater, and browser-fullscreen layouts. A details section is opened explicitly; it is not a persistent floating entry.

### 1. Enter VR

Request the XR session directly from the click, then prepare and verify the stereo stream inside that session. Show the controllers and a **Preparing video…** panel with an **Exit VR** button while loading. Pause YouTube during preparation after the session opens, then start synchronized playback at that position. Reuse the current preview's stream when entering from preview. Keep prepared media only for active preview, entry preparation, or a running VR session; closing or cancelling these releases unused media.

While entry is pending, the player-control button provides **Cancel**. Permission refusal leaves page playback or preview usable and shows a concise message beside that control. Preparation failure inside VR shows a short error with **Retry** and **Exit VR** on the headset panel. Retry prepares the stream again within the existing session. Exit restores the prior page playback intention. Keep the existing preparation timeout and prevent duplicate entry requests. If the XR renderer itself fails, end the session and show the error beside the page control, with further information in Details.

The session request must precede asynchronous media loading to preserve the click's user activation ([WebXR session request rules](https://www.w3.org/TR/webxr/#dom-xrsystem-requestsession)).

### 2. Resume the last resolution and show the actual stream

On entry, select the last successfully used VR resolution. If it is unavailable, choose the eligible resolution with the smallest difference in frame height; choose the lower resolution when equally close. Use 1080p as the initial target when there is no saved value. Include all compatible VR resolutions across MP4 and WebM, checking browser codec support, stereo projection metadata, and the media index. Exclude incompatible representations. If there are none, report that a playable stereo stream could not be found.

Both active selectors display the actual resolution and offer the same available choices. Playback state, nominal frame rate, and full decoded dimensions remain in Details. A representation's frame rate is distinct from measured playback performance.

Use **720p as the minimum selectable VR resolution** in both menus and automatic source selection. A previously saved lower value selects the closest eligible resolution at or above 720p. If only lower resolutions exist, report that no compatible VR source at 720p or higher is available.

For `38jcxsq8EBU`, a browser supporting its VP9 WebM sources must offer 720p, 1080p, 1440p, and 2160p. After the stream produces a valid stereo frame, remember its actual resolution as the last used value, including when the closest available resolution was selected. Failed attempts leave the saved value unchanged.

### 3. Apply quality changes immediately

Selecting a resolution on either the YouTube page or the headset panel changes the same source in the active VR session, with no separate Load action or exit/re-entry. Keep the current timestamp and play/pause intention. Pause audio and stereo together while preparing the replacement, and keep the headset interface responsive. The page selector and headset status line show **Loading 2160p…** during a switch. The headset quality control names the target resolution; an open quality menu marks it with a spinner. Both surfaces show the actual resolution when ready. A newer selection replaces any pending selection from either surface.

On failure, show one shared error state on the headset panel and beside the page selector. The headset offers Retry, another resolution, or Exit; the page selector also allows another choice. Retaining the previous stream for rollback is outside this change. Keep the current XR session while replacing the video source.

### 4. Move from preview into VR

Open Eye preview from VR details. Preview starts with the same saved-resolution and closest-match rules. **Enter VR** works while preview is active, with no separate Stop step. Preserve source, timestamp, quality, and play/pause state. Keep preview usable until the session is granted. A paused preview enters VR paused. **Close preview** releases its stereo playback and returns to the ordinary YouTube view. The floating resolution row appears only after entering VR, not during page preview. Preview alone does not update the last used VR resolution.

### 5. Exit and navigate cleanly

VR exit preserves YouTube's timestamp and current play/pause state, then releases the stereo video, removes the floating resolution row, and restores **Enter VR** in the player controls. Cancellation or navigation discards outstanding media results. If a session is granted after cancellation, end it immediately. Navigating to another video resets content-specific state and ends the old session.

## Visible controllers and interface inside VR

### Controllers

Render a recognizable outline or lightweight silhouette for each tracked controller at its physical position and orientation. This lets the wearer locate the controllers and see which way they are pointing.

Each controller has a thin pointing ray. When it intersects the interface, show a cursor at the hit point and highlight the targeted control. A press produces visible feedback. Keep outlines readable against both bright and dark video, and keep controller tracking and UI interaction running while media loads or pauses. Hide a controller whose pose is unavailable rather than leaving its last outline floating in place.

A matching controller model can be used when readily available. Detailed trigger/grip markings, individual button animations, and photorealistic assets are optional refinements. Controller outlines, rays, cursors, and interface hover/press feedback are required.

### Playback panel

```text
 Video title                                      [Hide icon]
 1080p · Stereo 180° / loading status / error
 00:18 ━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 02:42
 [Recenter]       [−10] [Play/Pause] [+10]    [1080p ▾] [Exit]
```

On entry and recenter, use the user's current horizontal heading as the shared forward direction for the video and panel. Place the panel below that direction and keep it fixed in the scene until the next recenter. It stays still while the user aims. The compact panel starts visible; the user can hide or show it during playback.

Use the fixed-height graphite card from the round-2 review: rounded pills and circles, a white primary transport control, neutral Exit, and red timeline progress. The quality menu replaces the control row, with Back and full-height paging controls when needed. Keep Exit available in the header while this menu is open. A failure replaces Play/Pause with an amber Retry pill. Show loading text once, in the status line; use a spinner on the pending quality item. Keep all states the same physical size. Hide UI uses a slashed-eye icon with the same full-size hit target.

The implemented card occupies 1024 × 312 texture pixels, measures 1.28 × 0.39 m, and tilts 20° toward the viewer. Use alpha blending for rounded corners and mipmap filtering for text and shapes. Font sizes are at least 22 px, with the explicit Segoe UI / Roboto / Noto Sans stack. The page controls share the graphite palette; VR details and YouTube's settings menu close each other when opened.

Pressing select/trigger away from the panel toggles interface visibility. A visible **Hide UI** button also hides it. While hidden, select/trigger anywhere shows the panel without activating the control at that location. Visibility changes preserve playback state and cancel pending panel gestures. Hide the panel, rays, and cursors together; keep tracked controller outlines visible. Source preparation, seeking, and a new playback error reveal the panel so status and recovery actions are available.

Play/pause, seeking, source resolution, recenter, and exit all have visible controls. The timeline shows elapsed time and duration. Point and select to seek; dragging previews a timestamp and commits one seek on release. Preserve the previous play/pause state. The headset resolution menu is operated with the controller ray and select action; it mirrors the page selector. The playback panel remains available throughout a source change.

While loading or recovering, use the same panel for status and actions. Keep Exit available. A playback failure pauses audio and offers Retry or Exit in the headset. The video may be unavailable while the controller outlines, rays, and panel remain usable.

### Recovery feedback

Every failure during an active, renderable VR session is visible and actionable on the headset panel. The page's floating row mirrors the same status so a page-side quality change also receives feedback where it was initiated. These are two presentations of one operation and its error, with the same retry result. Before session entry, show errors beside Enter VR; after an XR-renderer failure ends the session, show the error there with further information in Details.

### Controller mapping

| Input | Action |
| --- | --- |
| Select while pointing at a control | Activate that control once |
| Select while pointing away from the interface | Hide interface |
| Select while interface is hidden | Show interface |
| Play/Pause button on the panel | Play/pause |
| Squeeze | Restore the initial video direction in front of the viewer and recenter the panel |
| Left thumbstick left/right | Seek −10 / +10 seconds |
| Right thumbstick left/right | Turn the viewing direction left/right by 30° |
| Exit VR button or system action | Exit VR |

Selecting UI consumes that action: pressing Recenter, Exit, or Hide UI performs only that action. Selecting the panel background does nothing. Squeeze and left-stick seeking have corresponding panel controls. The panel carries no instructional hint text; the controls in VR details describe the mapping.

For thumbstick seeking, seek once per deflection, then require a return to neutral before another seek. Clamp the destination to the video's duration and preserve paused/playing state. Confirm the thumbstick mapping on Frame; the visible seek buttons work when that input is unavailable.

For seated 360° viewing, right-stick turning changes the viewing direction once per deflection, with a return to neutral between steps. Turning works while the panel is hidden, keeps the panel anchored, preserves playback time, and retains the chosen direction across resolution changes. Physical head rotation continues to work. Recenter restores the initial video direction relative to the current gaze. Source discovery accepts supported mono and stereo spherical projections; the status describes their layout and equirectangular coverage. Mesh projections use the label “VR” because their coverage can vary.

## Implementation notes

The behaviors above are the requirements. Extend the existing handlers, cancellation signals, and generation guards. Keep playback intention separate from preparation pauses. Store the last successfully used VR resolution, with a session fallback when storage is unavailable. Bind both active resolution controls to one source-selection state.

Add controller visualization, a panel renderer, and ray hit-testing to the XR scene. Render them independently of video readiness. Route input through UI hit-testing before applying background shortcuts. Model assets, rendering library, panel dimensions, and controller-axis bindings are implementation choices; validate readability, physical alignment, and selection on Frame. The existing module structure can remain where practical.

Separate XR session lifetime from video-source lifetime so quality changes from either interface can replace the stereo source while retaining controllers and the headset interface. Keep YouTube control-bar attachment and page-overlay visibility separate from playback logic. The control-bar insertion strategy is an implementation detail; a default floating entry would violate the requested page behavior.

## Acceptance checks

- Enter VR is part of YouTube's player controls, with no default floating entry. It stays reachable after player-control rebuilds and in normal, theater, and fullscreen layouts.
- Entry prepares playback without Load or Stop; controllers, loading status, and Exit are visible before the first video frame. Permission refusal and cancellation leave the page usable; a preparation timeout offers Retry and Exit inside VR.
- The page's floating row appears only while VR is active and contains only the VR-source selector and Details button during normal playback. Exit and navigation remove it; Details opens the secondary controls explicitly.
- Entry uses the last successfully used VR resolution, or the closest eligible resolution; equal-distance choices use the lower one. First use targets 1080p. Failed selections do not replace the saved value, and there is no pre-entry quality field.
- Both selectors include compatible VR resolutions across supported containers and report the actual stream. A selection from either surface updates both, preserves the session, position, and playback intention, and leaves headset controls usable during preparation or failure.
- Preview enters VR directly, preserving time and paused/playing state.
- Controller outlines follow both tracked controllers; rays, cursors, and hover/press states identify the selected control on Frame.
- Complete play/pause, seek, resolution changes, recenter, and exit using only the headset interface. Test with bright and dark scenes and while video is loading or paused.
- A quality-change failure appears in the headset and on the page as the same failure; retry or another selection updates both surfaces.
- A UI press performs one action. Trigger away from the panel and Hide UI hide the panel/rays; trigger while hidden restores them without activating an underlying control or changing playback. New errors and preparation reveal the panel. Squeeze and thumbstick shortcuts work; holding the thumbstick causes one seek. Timeline dragging commits one seek on release.
- Exit releases stereo playback; cancellation and navigation prevent late results from reopening it or affecting another video.
- Run these checks for both extension and userscript, including the installed userscript manager on Frame.
