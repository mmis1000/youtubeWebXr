# Review of `ux-design.md`

Date: October 31, 2026
Reviews: the revised proposal (Enter VR in YouTube's player controls, visible controllers, in-VR playback panel)

## Settled decisions

These were decided by the owner and are not reopened here:

- **Entry:** Enter VR lives in YouTube's player control bar. There is no floating launcher.
- **In-VR panel:** a working minimal playback panel inside the headset (timeline, −10 s, Pause, +10 s, Recenter, Exit VR), so the wearer never needs the system controls to switch windows. Visible buttons alongside the controller shortcuts are intended.
- **Quality switching:** changing quality replaces the stereo source inside the running VR session.
- **Kept from the first draft:** one-click entry, labels for the stream actually playing, no Load or Stop step, preview → VR directly, and clean exit/navigation.

The revision is much tighter than the first draft. The problems left are below.

## Problems

### 1. The quality selector is out of the wearer's reach

The **VR source** selector is a floating row on the YouTube page, shown only while VR is active. During an immersive session the wearer can't see the page. Changing quality means leaving immersion or using the system window switcher, which is exactly what the in-VR panel is meant to avoid.

**Fix:** put the quality control in the headset panel. The page row can show the same state for someone watching the monitor, but it shouldn't be the only control. Or drop the page row and leave quality to Details before entry.

### 2. Two quality controls for one setting

The "preferred starting quality" in Details and the "VR source" selector both set quality, and they behave differently (one applies on next entry or to an active preview, the other applies live). One user-facing setting should have one control. Make the last successful selection the preference, and remove the separate starting-quality field.

### 3. Controller visualization is over-specified for a first pass

Rendering the controllers themselves is necessary, since WebXR content draws its own. But left/right distinction, marked trigger and grip, and press highlights for each are extra work. Start with a pose-tracked ray, a cursor and a hover state. Add the silhouette and button highlights only if Frame testing shows wearers lose track of the buttons.

### 4. Recovery is spread across three surfaces

Errors can appear beside the page control, beside the floating selector and on the headset panel. A wearer only sees the headset, so every error that happens during a session belongs on the headset panel. The page should show only errors from before the session opened (refusal, cancel) or after it ended (renderer failure).

## Minor

- "Keep a compact panel visible below the video's forward viewing direction" and "place it below the user's current forward heading" describe two anchors. Pick one.
- Drop the hint "Point at a control and press trigger". The visible rays, cursor and hover states already teach the interaction.
- "Reuse an already prepared stream when it matches" leaves it unclear how long a prepared stream is kept alive outside preview.
- Acceptance checks are reasonable but restate the requirements. Trim to the observable checks.
