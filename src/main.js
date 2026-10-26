import { decodeMesh } from './metadata.js';
import { observeMedia } from './observe.js';
import { Player, sphere } from './render.js';
import { resolveStereo, LinkedVideo } from './youtube.js';

if (!window.__youtubeWebXRLoaded && window.MediaSource && window.SourceBuffer) {
  window.__youtubeWebXRLoaded = true;
  install();
}

function install() {
  let video, source, revision = -1, generation = 0, spec = null, ui, xrSupported = false;
  let message = 'Play a video to inspect its projection metadata.';
  let mode = 'auto';
  let stereo = null, loadController = null;
  const setStatus = value => { message = value; if (ui) ui.status.textContent = value; };
  const player = new Player(setStatus, () => { stereo?.setActive(false); if (ui) ui.stop.disabled = true; });
  const lookup = observeMedia(() => { queueMicrotask(refresh); });

  async function prepare(metadata) {
    metadata = stereo?.result.metadata || metadata;
    const token = ++generation;
    spec = null; if (ui) { ui.enter.disabled = true; ui.preview.disabled = true; }
    try {
      let candidate;
      if (mode !== 'auto') {
        candidate = { stereoMode: { sbs: 2, tb: 1, mono: 0 }[mode], meshes: [sphere()], pose: [0, 0, 0] };
      } else {
        if (!metadata?.projection) {
          setStatus(source?.error || (metadata ? 'This stream has no spherical projection metadata.'
            : 'Waiting for video metadata. Reload this YouTube tab if playback began before installing the extension.'));
          return;
        }
        const p = metadata.projection;
        if (![0, 1, 2, 3, 4].includes(metadata.stereoMode)) throw new Error('This stereo layout is unsupported.');
        const meshes = p.type === 'mesh' ? await decodeMesh(p.payload)
          : p.type === 'equirectangular' ? [sphere(p.bounds)] : null;
        if (!meshes) throw new Error('This stream uses a cubemap projection that this prototype does not yet render.');
        if (metadata.stereoMode === 3 && meshes.length !== 2) throw new Error('Custom stereo requires two eye meshes.');
        candidate = { stereoMode: metadata.stereoMode, meshes, pose: metadata.pose };
      }
      if (token !== generation) return;
      spec = candidate;
      const layout = ['monoscopic', 'top-bottom stereo', 'left-right stereo', 'custom stereo', 'right-left stereo'][candidate.stereoMode];
      if (!player.active) setStatus(mode === 'auto' ? `${stereo ? 'VR stream — ' : ''}${metadata.container}: ${metadata.projection.type}, ${layout}.`
        : `Manual 180° ${layout}. Use this only when it matches the encoded video.`);
      if (ui) { ui.preview.disabled = !video; ui.enter.disabled = !video || !xrSupported; }
    } catch (error) { if (token === generation) setStatus(error.message); }
  }

  function refresh() {
    const next = document.querySelector('video.html5-main-video') || document.querySelector('video:not([data-youtube-webxr-stereo])');
    const nextSource = lookup(next);
    if (next !== video || nextSource !== source || (nextSource?.revision ?? -1) !== revision) {
      if (next !== video) { player.stop(); stereo?.dispose(); stereo = null; }
      else if (!stereo) player.stop();
      video = next; source = nextSource; revision = source?.revision ?? -1;
      prepare(source?.metadata);
    }
    if (ui) {
      ui.host.hidden = !video;
      const displayed = stereo?.video || video;
      ui.dimensions.textContent = displayed?.videoWidth ? `${displayed.videoWidth} × ${displayed.videoHeight} decoded frame` : 'Waiting for decoded frames';
    }
  }

  function diagnostics() {
    let response;
    try { response = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch {}
    const formats = [...(response?.streamingData?.formats || []), ...(response?.streamingData?.adaptiveFormats || [])];
    return JSON.stringify({
      extensionVersion: '0.1.0', videoId: new URL(location.href).searchParams.get('v'),
      webxr: { available: !!navigator.xr, immersiveVR: xrSupported },
      video: video ? { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState,
        mediaSourceObserved: !!source } : null,
      metadata: source?.metadata ? { container: source.metadata.container, stereoMode: source.metadata.stereoMode,
        projection: source.metadata.projection?.type, pose: source.metadata.pose,
        bounds: source.metadata.projection?.bounds, meshCount: stereo ? undefined : spec?.meshes.length } : null,
      error: source?.error, selectedMode: mode,
      stereoStream: stereo ? { itag: stereo.result.format.itag, width: stereo.video.videoWidth,
        height: stereo.video.videoHeight, stereoMode: stereo.result.metadata.stereoMode,
        projection: stereo.result.metadata.projection.type, meshCount: spec?.meshes.length,
        synchronizationDriftSeconds: stereo.video.currentTime - video.currentTime } : null,
      advertisedFormats: formats.map(f => ({ itag: f.itag, width: f.width, height: f.height,
        mimeType: f.mimeType, projectionType: f.projectionType, stereoLayout: f.stereoLayout }))
    }, null, 2);
  }

  function mount() {
    const host = document.createElement('div'); host.id = 'youtube-webxr';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { position:fixed; right:20px; bottom:80px; z-index:2147483647; color:#eef3fb;
        font:14px/1.5 system-ui,sans-serif; } :host([hidden]) { display:none; }
      * { box-sizing:border-box; } button,select { font:inherit; color:inherit; border:1px solid #536077;
        border-radius:8px; padding:10px 14px; background:#263349; cursor:pointer; }
      button:disabled { opacity:.45; cursor:default; } button:focus-visible,select:focus-visible { outline:2px solid #89b9ff; }
      .toggle { background:#163d6b; box-shadow:0 2px 12px #0008; }
      .panel { background:#111b2a; border:1px solid #43516b; border-radius:12px; padding:18px; margin-bottom:8px;
        width:min(420px,90vw); max-height:75vh; overflow:auto; box-shadow:0 8px 32px #0008; }
      [hidden] { display:none !important; } h2 { font-size:18px; margin:0 0 10px; }
      p { margin:10px 0; } label { display:block; margin-top:12px; } .muted { color:#b7c4d8; font-size:12px; } .actions { display:flex; flex-wrap:wrap; gap:8px; }
      select { display:block; width:100%; margin:6px 0 12px; } canvas { width:100%; height:auto; margin-top:12px; }
      textarea { width:100%; height:180px; background:#0a1220; color:#d8e6ff; margin-top:10px; font:11px/1.4 monospace; }
    `;
    root.append(style);
    const make = (tag, text, parent, className) => {
      const el = document.createElement(tag); if (text) el.textContent = text;
      if (className) el.className = className; parent?.append(el); return el;
    };
    const panel = make('section', null, root, 'panel'); panel.hidden = true;
    panel.setAttribute('aria-label', 'YouTube WebXR controls');
    make('h2', 'YouTube WebXR', panel);
    const status = make('p', message, panel); status.setAttribute('aria-live', 'polite');
    const dimensions = make('p', '', panel, 'muted');
    const qualityLabel = make('label', 'Stereo stream resolution', panel);
    const quality = make('select', null, qualityLabel);
    for (const height of [720, 1080, 2160, 4320]) {
      const option = make('option', `${height}p${height === 4320 ? ' (8K)' : ''}`, quality); option.value = height;
      if (height === 1080) option.selected = true;
    }
    const loadStereo = make('button', 'Load stereo stream', panel);
    loadStereo.addEventListener('click', async () => {
      player.stop(); stereo?.dispose(); stereo = null;
      loadController?.abort();
      const controller = loadController = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('Stereo stream request timed out. Try again.')), 30000);
      const original = video, id = new URL(location.href).searchParams.get('v');
      loadStereo.disabled = true; ui.enter.disabled = true; ui.preview.disabled = true;
      setStatus('Requesting the VR stereo stream…');
      try {
        const result = await resolveStereo(id, Number(quality.value), controller.signal);
        if (controller.signal.aborted || video !== original || new URL(location.href).searchParams.get('v') !== id) return;
        stereo = new LinkedVideo(original, result, error => { player.stop(); setStatus(error.message); }, controller.signal);
        await stereo.ready;
        if (controller.signal.aborted || loadController !== controller) return;
        mode = 'auto'; ui.select.value = mode;
        await prepare(result.metadata);
      } catch (error) { if (loadController === controller) { stereo?.dispose(); stereo = null; setStatus(error.message); } }
      finally { clearTimeout(timeout); if (loadController === controller) { loadController = null; loadStereo.disabled = false; } }
    });
    const label = make('label', 'Projection', panel);
    const select = make('select', null, label);
    for (const [value, text] of [['auto', 'Automatic — stream metadata'], ['sbs', 'Manual — VR180 left-right'],
      ['tb', 'Manual — VR180 top-bottom'], ['mono', 'Manual — 180° monoscopic']]) {
      const option = make('option', text, select); option.value = value;
    }
    select.addEventListener('change', () => { mode = select.value; player.stop(); prepare(source?.metadata); });
    const actions = make('div', null, panel, 'actions');
    const enter = make('button', 'Enter VR', actions); enter.disabled = true;
    const preview = make('button', 'Eye preview', actions); preview.disabled = true;
    const stop = make('button', 'Stop', actions); stop.disabled = true;
    const capability = make('p', 'Checking WebXR…', panel, 'muted');
    make('p', 'Load stereo to request both eye views. YouTube controls audio, playback, and seeking. Higher resolutions require more decoding power.', panel, 'muted');
    const inspect = make('button', 'Show diagnostics', panel);
    const report = make('textarea', null, panel); report.hidden = true; report.readOnly = true;
    report.setAttribute('aria-label', 'Playback diagnostics');
    inspect.addEventListener('click', () => { report.value = diagnostics(); report.hidden = !report.hidden; });
    const previewParent = make('div', null, panel);
    const toggle = make('button', 'WebXR', root, 'toggle'); toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); refresh(); });
    enter.addEventListener('click', () => { if (!spec || !video || player.active) return; stop.disabled = false; stereo?.setActive(true); player.start(stereo?.video || video, spec, null, video); });
    preview.addEventListener('click', () => { if (!spec || !video) return; player.stop(); stop.disabled = false; stereo?.setActive(true); player.start(stereo?.video || video, spec, previewParent, video); });
    stop.addEventListener('click', () => { player.stop(); prepare(source?.metadata); });
    ui = { host, status, dimensions, enter, preview, stop, select, loadStereo };
    document.body.append(host); refresh(); prepare(source?.metadata);
    Promise.resolve(navigator.xr?.isSessionSupported('immersive-vr')).then(supported => {
      xrSupported = !!supported;
      capability.textContent = xrSupported ? 'WebXR immersive VR is available.' : 'Immersive VR is unavailable in this browser session. Eye preview is available.';
      enter.disabled = !xrSupported || !spec || !video;
    }).catch(error => { capability.textContent = `WebXR check: ${error.message}`; });
    setInterval(refresh, 1000);
  }
  document.addEventListener('yt-navigate-start', () => {
    loadController?.abort(); loadController = null; if (ui) ui.loadStereo.disabled = false;
    stereo?.dispose(); stereo = null;
    player.stop(); generation++; spec = null; video = null; source = null; revision = -1;
    mode = 'auto'; if (ui) ui.select.value = mode;
  });
  document.addEventListener('yt-navigate-finish', refresh);
  window.addEventListener('pagehide', () => { player.stop(); stereo?.dispose(); loadController?.abort(); });
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
