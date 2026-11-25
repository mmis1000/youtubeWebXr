import { decodeMesh } from './metadata.js';
import { observeMedia } from './observe.js';
import { Player, sphere, cinemaScreen, layoutLabel } from './render.js';
import { StereoResolver, LinkedVideo, waitForFrame, MIN_VR_HEIGHT } from './youtube.js';
import { version } from '../extension/manifest.json';
import { colors, fontStack } from './theme.js';
import { seekTarget } from './xr-math.js';

const STORAGE_KEY = 'youtube-webxr:last-resolution';
const CINEMA_SCALE_KEY = 'youtube-webxr:cinema-scale';
if (!window.__youtubeWebXRLoaded && window.MediaSource && window.SourceBuffer) {
  window.__youtubeWebXRLoaded = true;
  install();
}

function install() {
  let video, source, stereo, spec, ui, loadController;
  let generation = 0, entryGeneration = 0, mode = 'auto', busy = false, error = '', status = '';
  let qualities = [], quality = 0, targetQuality = 1080, requestedQuality = 1080, xrSupported = false;
  let cinemaScale = 1;
  let intendedPlaying = false, restorePlaying = false, started = false, navigating = false, detailsOpen = false;
  let removeVideoListeners = () => {};
  const resolver = new StereoResolver();
  let lastDiagnosticsAt = -Infinity, attachTimer = 0;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(saved) && saved > 0 && saved <= 16384) targetQuality = Math.max(MIN_VR_HEIGHT, saved);
    const savedScale = Number(localStorage.getItem(CINEMA_SCALE_KEY));
    if (Number.isFinite(savedScale) && savedScale >= 0.5 && savedScale <= 2.0) cinemaScale = savedScale;
  } catch {}
  const id = () => new URL(location.href).searchParams.get('v');
  const activeVideo = () => (stereo?.unified ? stereo.video : video);
  const state = () => {
    const active = activeVideo();
    return {
      title: document.getElementById('movie_player')?.getVideoData?.()?.title || document.title.replace(/ - YouTube$/, ''),
      time: active?.currentTime || 0, duration: active?.duration || 0, paused: busy ? !intendedPlaying : active?.paused ?? true,
      volume: active?.volume ?? 1, muted: !!active?.muted, playbackRate: active?.playbackRate || 1,
      cinema: !!spec?.cinema, cinemaScale,
      quality, qualities, requestedQuality, busy, error, status, layout: spec?.layout || 'VR'
    };
  };
  const player = new Player(message => { status = message; update(); }, () => finish(), {
    state, action,
    error: e => { error = e.message; status = error; update(); }
  });
  const lookup = observeMedia(() => queueMicrotask(refresh));

  function remember() {
    if (!player.session || !quality || mode !== 'auto') return;
    targetQuality = quality;
    try { localStorage.setItem(STORAGE_KEY, String(quality)); } catch {}
  }
  function syncBackToOriginal() {
    if (stereo?.unified && !navigating && video?.isConnected && Number.isFinite(stereo.video.currentTime) && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(stereo.video.currentTime, Math.max(0, video.duration - 0.01));
    }
  }
  function finish(resume = true) {
    ++generation; ++entryGeneration;
    const restore = started ? intendedPlaying : restorePlaying;
    const wasUnified = !!stereo?.unified;
    const shouldRestore = busy || !!error || wasUnified;
    syncBackToOriginal();
    loadController?.abort(); loadController = null;
    resolver.clear();
    stereo?.dispose(); stereo = null; spec = null;
    busy = false; started = false; quality = 0; error = ''; status = '';
    if (shouldRestore && resume && !navigating && video?.isConnected) {
      if (restore) video.play().catch(() => {}); else video.pause();
    }
    update();
  }
  function exit() { const active = player.active; player.stop(); if (!active) finish(); }
  function mediaError(e, controller, token) {
    if (controller !== loadController || token !== generation) return;
    resolver.clear();
    if (busy) { controller.abort(e); return; }
    error = e.message || String(e); status = error; activeVideo()?.pause(); video?.pause(); player.setSource(null); update();
  }
  function cinemaAspect(displayed, stereoMode) {
    const raw = displayed?.videoWidth && displayed?.videoHeight ? displayed.videoWidth / displayed.videoHeight : 16 / 9;
    // Account for full-resolution packed stereo (e.g. 3840x1080 SBS -> 16:9 per eye, 1920x2160 TB -> 16:9 per eye)
    // while leaving half-SBS/half-TB at their display aspect ratio.
    if ((stereoMode === 2 || stereoMode === 4) && raw > 2.5) return raw / 2;
    if (stereoMode === 1 && raw < 1.1) return raw * 2;
    return raw;
  }
  async function specification(metadata, displayed) {
    if (mode === 'cinema' || mode === 'cinema-sbs' || mode === 'cinema-tb') {
      const stereoMode = mode === 'cinema-sbs' ? 2 : mode === 'cinema-tb' ? 1 : 0;
      const aspect = cinemaAspect(displayed, stereoMode);
      return {
        meshes: [cinemaScreen(aspect, cinemaScale)], stereoMode, pose: [0, 0, 0],
        cinema: true, aspect, layout: stereoMode ? '3D Cinema' : 'Virtual Cinema'
      };
    }
    if (mode !== 'auto') return { meshes: [sphere()], stereoMode: { sbs: 2, tb: 1, mono: 0 }[mode], pose: [0,0,0],
      layout: mode === 'mono' ? 'Monoscopic 180°' : 'Stereo 180°' };
    if (!metadata?.projection || metadata.projection.type === 'cinema') {
      const stereoMode = [0, 1, 2, 4].includes(metadata?.stereoMode) ? metadata.stereoMode : 0;
      const aspect = cinemaAspect(displayed, stereoMode);
      return {
        meshes: [cinemaScreen(aspect, cinemaScale)], stereoMode, pose: [0, 0, 0],
        cinema: true, aspect, layout: stereoMode ? '3D Cinema' : 'Virtual Cinema'
      };
    }
    const p = metadata.projection;
    if (p.type === 'cubemap') {
      return {
        meshes: [sphere([0, 0, 0, 0])], stereoMode: metadata.stereoMode ?? 0, pose: metadata.pose || [0, 0, 0],
        cubemapMode: p.eac ? 2 : 1, eac: !!p.eac, eacPadding: p.padding || 0, layout: layoutLabel(metadata)
      };
    }
    const meshes = p.type === 'mesh' ? await decodeMesh(p.payload) : p.type === 'equirectangular' ? [sphere(p.bounds)] : null;
    if (!meshes) throw new Error('This projection is not supported.');
    if (metadata.stereoMode === 3 && meshes.length !== 2) throw new Error('Custom stereo requires two eye meshes.');
    return { meshes, stereoMode: metadata.stereoMode ?? 0, pose: metadata.pose || [0,0,0], layout: layoutLabel(metadata) };
  }
  async function prepare(height = targetQuality, preview = false) {
    if (!video) return;
    const token = ++generation, original = video;
    syncBackToOriginal();
    loadController?.abort(); stereo?.dispose(); stereo = null; spec = null;
    player.setSource(null);
    const controller = loadController = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Preparing video timed out. Try again.')), 30000);
    requestedQuality = height; busy = true; error = ''; status = `Loading ${height}p…`; quality = 0;
    original.pause(); update();
    let candidate;
    try {
      let metadata, result;
      const observedVR = source?.metadata?.projection && [0,1,2,3,4].includes(source.metadata.stereoMode);
      if (mode !== 'auto' || (observedVR && !id()) || !id()) {
        metadata = source?.metadata || { container: 'Cinema', stereoMode: 0, projection: { type: 'cinema' }, pose: [0, 0, 0] };
        qualities = mode === 'auto' && observedVR ? [original.videoHeight].filter(h => h >= MIN_VR_HEIGHT) : [];
        await waitForFrame(original, controller.signal);
      } else {
        result = await resolver.resolve(id(), height, controller.signal, formats => {
          if (token !== generation) return;
          qualities = formats.qualities; update();
        });
        controller.signal.throwIfAborted();
        if (result.cinemaDirect) {
          metadata = observedVR ? source.metadata : result.metadata;
          qualities = observedVR ? [original.videoHeight].filter(h => h >= MIN_VR_HEIGHT) : [];
          await waitForFrame(original, controller.signal);
        } else {
          candidate = new LinkedVideo(original, result, e => mediaError(e, controller, token), controller.signal);
          await candidate.prepare(controller.signal);
          metadata = result.metadata;
        }
      }
      const displayed = candidate?.video || original;
      const nextSpec = await specification(metadata, displayed);
      controller.signal.throwIfAborted();
      if (token !== generation || original !== video) return;
      stereo = candidate; spec = nextSpec;
      quality = displayed.videoHeight;
      if (preview && !player.session) player.preview(displayed, spec, ui.previewParent);
      else player.setSource(displayed, spec);
      busy = false; started = true; status = preview && !player.session ? 'Eye preview: left eye on the left, right eye on the right.' : `Playing ${quality}p`;
      remember(); update();
      if (intendedPlaying) {
        if (stereo?.unified) await stereo.video.play();
        else { await original.play(); stereo?.sync(); }
      }
    } catch (e) {
      if (token !== generation) return;
      resolver.clear();
      candidate?.dispose(); stereo = null; player.setSource(null);
      busy = false; error = controller.signal.reason?.message || e.message; status = error;
      original.pause(); update();
    } finally {
      clearTimeout(timeout);
      if (token !== generation) candidate?.dispose();
    }
  }
  async function enter() {
    if (!video) return;
    if (player.pending) {
      ++entryGeneration; player.cancelEntry(); status = ''; error = ''; update(); return;
    }
    if (player.session) { exit(); return; }
    const token = ++entryGeneration, preview = player.mode === 'preview';
    const current = activeVideo();
    restorePlaying = !current.paused;
    intendedPlaying = preview ? !current.paused : true;
    error = ''; status = 'Opening VR…';
    const entry = player.enter(); update();
    try {
      if (!await entry || token !== entryGeneration) return;
      update();
      if (preview && spec && (!stereo || !stereo.disposed)) {
        player.setSource(stereo?.video || video, spec); started = true;
        status = `Playing ${quality}p`; remember(); update();
      } else await prepare();
    } catch (e) {
      if (token !== entryGeneration) return;
      error = e.message || 'VR permission was not granted.'; status = error; update();
    }
  }
  function preview() {
    if (!video || player.session || player.pending) return;
    if (player.mode === 'preview' || busy) { exit(); return; }
    restorePlaying = !video.paused; intendedPlaying = restorePlaying; started = false;
    prepare(targetQuality, true);
  }
  async function seek(time) {
    const active = activeVideo();
    if (!active || busy || error || !Number.isFinite(active.duration)) return;
    const token = generation, original = video;
    const controller = loadController;
    const playing = !active.paused;
    intendedPlaying = playing; busy = true; status = 'Seeking…'; active.pause(); update();
    const seekController = new AbortController();
    const cancel = () => seekController.abort(controller?.signal.reason);
    controller?.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => seekController.abort(new Error('Seeking timed out. Try again.')), 30000);
    try {
      if (stereo?.unified) {
        stereo.video.currentTime = seekTarget(time, 0, stereo.video.duration);
        stereo.stream.pump();
        await waitForFrame(stereo.video, seekController.signal);
        if (token !== generation) return;
        busy = false; status = `Playing ${quality}p`; update();
        if (playing) await stereo.video.play();
      } else {
        original.currentTime = seekTarget(time, 0, original.duration);
        if (stereo) { stereo.video.currentTime = Math.min(original.currentTime, stereo.video.duration - .01); stereo.stream.pump(); }
        await Promise.all([waitForFrame(original, seekController.signal), ...(stereo ? [waitForFrame(stereo.video, seekController.signal)] : [])]);
        if (token !== generation) return;
        busy = false; status = `Playing ${quality}p`; update();
        if (playing) { await original.play(); stereo?.sync(); }
      }
    } catch (e) {
      if (token === generation) { busy = false; error = e.message; status = error; update(); }
    } finally { clearTimeout(timeout); controller?.signal.removeEventListener('abort', cancel); }
  }
  function action(name, value) {
    if (name === 'exit') return exit();
    if (name === 'quality') {
      if (value === quality && !busy && !error) return;
      if (player.session && qualities.includes(value)) { if (!busy && !error) intendedPlaying = !activeVideo().paused; prepare(value); }
      return;
    }
    if (name === 'retry') return prepare(requestedQuality, !player.session);
    const active = activeVideo();
    if (name === 'mute' && active) {
      const next = !active.muted;
      active.muted = next;
      if (video && video !== active) video.muted = next;
      update(); return;
    }
    if (name === 'volume' && active) {
      const next = Math.max(0, Math.min(1, Math.round(((active.muted ? 0 : active.volume) + value) * 100) / 100));
      active.volume = next; active.muted = next === 0;
      if (video && video !== active) { video.volume = next; video.muted = next === 0; }
      update(); return;
    }
    if (name === 'speed' && active) {
      const rate = Math.max(0.25, Math.min(4, Number(value) || 1));
      active.playbackRate = rate;
      if (video && video !== active) video.playbackRate = rate;
      update(); return;
    }
    if (name === 'zoom' && spec?.cinema) {
      cinemaScale = Math.max(0.5, Math.min(2.0, Math.round((cinemaScale + value) * 100) / 100));
      try { localStorage.setItem(CINEMA_SCALE_KEY, String(cinemaScale)); } catch {}
      spec = { ...spec, meshes: [cinemaScreen(spec.aspect, cinemaScale)] };
      player.setSource(stereo?.video || video, spec);
      update(); return;
    }
    if (busy || error || !active) return;
    if (name === 'toggle') {
      intendedPlaying = active.paused;
      if (intendedPlaying) active.play().catch(e => { error = e.message; status = error; update(); }); else active.pause();
    } else if (name === 'seek') seek(value);
    else if (name === 'skip' || name === 'back' || name === 'forward') seek(seekTarget(active.currentTime, name === 'back' ? -10 : name === 'forward' ? 10 : value, active.duration));
    update();
  }
  function refresh() {
    const next = document.querySelector('video.html5-main-video') || document.querySelector('video:not([data-youtube-webxr-stereo])');
    if (next !== video) {
      navigating = true; exit(); navigating = false; removeVideoListeners(); video = next;
      if (video) {
        const original = video;
        const changed = () => {
          if (!busy && !error && !stereo?.holding && !stereo?.unified) intendedPlaying = !original.paused;
          update();
        };
        original.addEventListener('play', changed); original.addEventListener('pause', changed);
        removeVideoListeners = () => { original.removeEventListener('play', changed); original.removeEventListener('pause', changed); };
      }
    }
    source = lookup(video); attach(); update();
  }
  function diagnostics() {
    return JSON.stringify({ extensionVersion: version, videoId: id(), webxr: { available: !!navigator.xr, immersiveVR: xrSupported },
      video: video ? { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, mediaSourceObserved: !!source } : null,
      selectedMode: mode, state: { busy, status, error, actualResolution: quality, availableResolutions: qualities, cinema: !!spec?.cinema, layout: spec?.layout || '' },
      stereoStream: stereo ? { itag: stereo.result.format.itag, width: stereo.video.videoWidth, height: stereo.video.videoHeight,
        playbackMode: stereo.unified ? 'unified-mse' : 'linked-video', hasAudio: !!stereo.stream.hasAudio,
        stereoMode: stereo.result.metadata.stereoMode, projection: stereo.result.metadata.projection.type, meshCount: spec?.meshes.length,
        synchronizationDriftSeconds: stereo.unified ? 0 : stereo.video.currentTime - video.currentTime } : null }, null, 2);
  }
  function update() {
    if (!ui) return;
    ui.entry.textContent = player.pending ? 'Cancel VR' : player.session ? 'Exit VR' : 'Enter VR';
    ui.entry.disabled = !video || (!xrSupported && !player.session && !player.pending);
    ui.entry.title = xrSupported ? 'Open the VR player' : 'This browser cannot enter VR. Eye preview is available in VR details.';
    ui.support.textContent = xrSupported ? '' : 'Immersive VR is unavailable in this browser. Eye preview is available below.';
    ui.support.hidden = xrSupported;
    ui.row.hidden = !player.session;
    ui.details.hidden = !detailsOpen;
    ui.message.textContent = status;
    ui.message.hidden = !status || (!error && !busy);
    ui.host.hidden = !player.session && !detailsOpen && !error && !player.pending;
    ui.quality.disabled = !qualities.length;
    const options = qualities.map(h => `${h}:${h}p`);
    const selected = quality || (busy || error ? -1 : 0);
    if (!quality) options.unshift(`${selected}:${busy ? status : error ? `Requested: ${requestedQuality}p` : 'Choose resolution'}`);
    const signature = JSON.stringify(options);
    if (ui.quality.dataset.options !== signature) {
      ui.quality.replaceChildren(...options.map(text => { const [value, ...label] = text.split(':'); const o = document.createElement('option'); o.value = value; o.textContent = label.join(':'); o.disabled = Number(value) <= 0; return o; }));
      ui.quality.dataset.options = signature;
    }
    ui.quality.value = String(selected);
    ui.preview.textContent = player.mode === 'preview' || (busy && !player.session) ? 'Close preview' : 'Eye preview';
    ui.preview.disabled = !!player.session || player.pending || !video;
    ui.mode.disabled = busy || player.pending;
    if (!ui.report.hidden && performance.now() - lastDiagnosticsAt >= 500) {
      ui.report.value = diagnostics(); lastDiagnosticsAt = performance.now();
    }
  }
  function toggleDetails() {
    const opening = !detailsOpen;
    const settings = ui.entryGroup.closest('#movie_player, .html5-video-player')?.querySelector('.ytp-settings-button');
    if (opening && settings?.getAttribute('aria-expanded') === 'true') settings.click();
    detailsOpen = opening; update();
  }
  function attach() {
    if (!ui) return;
    const root = video?.closest('#movie_player, .html5-video-player') || document.getElementById('movie_player');
    const controls = root?.querySelector('.ytp-right-controls');
    if (!root || !controls) { ui.entryGroup.remove(); ui.host.remove(); return; }
    if (ui.entryGroup.parentNode !== controls) controls.insertBefore(ui.entryGroup, controls.querySelector(':scope > .ytp-fullscreen-button'));
    if (ui.host.parentNode !== root) root.append(ui.host);
    const bounds = root.getBoundingClientRect();
    ui.host.style.setProperty('--player-width', `${bounds.width}px`);
    ui.host.style.setProperty('--player-height', `${bounds.height}px`);
    if (detailsOpen && root.querySelector('.ytp-settings-button')?.getAttribute('aria-expanded') === 'true') { detailsOpen = false; update(); }
  }
  function mount() {
    const entryGroup = document.createElement('span'); entryGroup.className = 'youtube-webxr-entry';
    entryGroup.style.cssText = 'display:inline-flex;vertical-align:top;height:100%;align-items:center';
    const entry = document.createElement('button'); entry.className = 'ytp-button'; entry.textContent = 'Enter VR';
    entry.style.cssText = 'width:auto;padding:0 10px;font:600 13px sans-serif;color:white'; entry.addEventListener('click', enter);
    const more = document.createElement('button'); more.className = 'ytp-button'; more.textContent = '▾'; more.setAttribute('aria-label', 'VR details');
    more.style.cssText = 'width:28px;color:white'; more.addEventListener('click', toggleDetails);
    entryGroup.append(entry, more);
    const host = document.createElement('div'); host.id = 'youtube-webxr';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `
      :host { position:absolute;right:16px;bottom:65px;z-index:70;max-width:calc(100% - 32px);color:${colors.text};font:14px/1.5 ${fontStack};text-align:left; }
      :host([hidden]),[hidden] {display:none!important} * {box-sizing:border-box}
      button,select {font:inherit;color:inherit;border:1px solid ${colors.line};border-radius:18px;padding:8px 12px;background:${colors.raised};cursor:pointer}
      button:hover,select:hover {background:${colors.hover}} button:disabled,select:disabled {color:${colors.dim};cursor:default}
      button:focus-visible,select:focus-visible {outline:2px solid ${colors.text};outline-offset:2px}
      .row {display:flex;align-items:center;gap:8px;background:rgba(28,28,28,.95);padding:8px;border:1px solid ${colors.line};border-radius:12px}
      .row select {min-width:0;flex:1} .row button,.row span {flex-shrink:0}
      .details {width:min(400px,calc(var(--player-width,100vw) - 32px));max-height:min(65vh,calc(var(--player-height,100vh) - 80px));overflow:auto;background:rgba(28,28,28,.97);border:1px solid ${colors.line};padding:16px;border-radius:12px;margin-top:6px}
      .message {max-width:400px;padding:8px;background:${colors.surface};color:${colors.warn};border-radius:12px;margin:4px 0} label {display:block;margin:10px 0} label select {display:block;width:100%}
      textarea {width:100%;height:170px;background:${colors.surface};color:${colors.text};font:11px monospace} canvas {width:100%;height:auto} p {margin:10px 0}
    `; root.append(style);
    const make = (tag, text, parent, className) => { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; parent.append(e); return e; };
    const row = make('div', '', root, 'row'); row.hidden = true;
    make('span', 'VR source', row);
    const qualitySelect = make('select', '', row); qualitySelect.setAttribute('aria-label', 'VR source resolution');
    qualitySelect.addEventListener('change', () => action('quality', Number(qualitySelect.value)));
    make('button', 'Details', row).addEventListener('click', toggleDetails);
    const message = make('p', '', root, 'message'); message.setAttribute('aria-live', 'polite');
    const details = make('section', '', root, 'details'); details.setAttribute('aria-label', 'VR details'); details.hidden = true;
    make('button', 'Close details', details).addEventListener('click', () => { detailsOpen = false; update(); more.focus(); });
    const support = make('p', '', details); support.setAttribute('role', 'status');
    const previewButton = make('button', 'Eye preview', details); previewButton.addEventListener('click', preview);
    const label = make('label', 'Projection', details), select = make('select', '', label);
    for (const [value, text] of [
      ['auto', 'Automatic'],
      ['cinema', 'Virtual Cinema — 2D'],
      ['cinema-sbs', 'Virtual Cinema — 3D left-right'],
      ['cinema-tb', 'Virtual Cinema — 3D top-bottom'],
      ['sbs', 'Manual — VR180 left-right'],
      ['tb', 'Manual — VR180 top-bottom'],
      ['mono', 'Manual — 180° monoscopic']
    ]) {
      const option = make('option', text, select); option.value = value;
    }
    select.addEventListener('change', () => { mode = select.value; if (player.mode) { intendedPlaying = !activeVideo().paused; prepare(targetQuality, player.mode === 'preview'); } });
    make('p', 'In VR: point and trigger to use controls. Trigger away from the panel to hide it; trigger again to show it. Left stick: seek ±10s / volume up-down. Right stick: turn 30° / cinema zoom up-down. Squeeze to recenter (supports reclining & lying down).', details);
    const inspect = make('button', 'Show diagnostics', details);
    const report = make('textarea', '', details); report.readOnly = true; report.hidden = true; report.setAttribute('aria-label', 'Playback diagnostics');
    inspect.addEventListener('click', () => { report.hidden = !report.hidden; lastDiagnosticsAt = -Infinity; update(); });
    const previewParent = make('div', '', details);
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { detailsOpen = false; update(); more.focus(); e.stopPropagation(); } });
    ui = { entryGroup, entry, host, row, details, support, message, quality: qualitySelect, preview: previewButton, mode: select, report, previewParent };
    document.addEventListener('click', event => {
      if (detailsOpen && event.target.closest?.('.ytp-settings-button') && ui.entryGroup.parentNode?.contains(event.target)) { detailsOpen = false; update(); }
    }, true);
    refresh();
    const checkXR = () => navigator.xr?.isSessionSupported('immersive-vr')
      .then(supported => { if (supported !== xrSupported) { xrSupported = supported; update(); } }).catch(() => {});
    checkXR();
    navigator.xr?.addEventListener('devicechange', checkXR);
    setInterval(() => { if (!xrSupported) checkXR(); }, 2000);
    new MutationObserver(() => {
      if (!attachTimer) attachTimer = setTimeout(() => { attachTimer = 0; attach(); }, 100);
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(refresh, 500);
  }
  document.addEventListener('yt-navigate-start', () => {
    navigating = true; exit(); navigating = false; mode = 'auto'; qualities = []; detailsOpen = false;
    if (ui) ui.mode.value = mode;
  });
  document.addEventListener('yt-navigate-finish', refresh);
  window.addEventListener('pagehide', () => { navigating = true; exit(); });
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
