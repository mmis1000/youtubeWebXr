import { decodeMesh } from './metadata.js';
import { observeMedia } from './observe.js';
import { Player, sphere } from './render.js';
import { StereoResolver, LinkedVideo, waitForFrame, MIN_VR_HEIGHT } from './youtube.js';
import { version } from '../extension/manifest.json';
import { colors, fontStack } from './theme.js';
import { seekTarget } from './xr-math.js';

const STORAGE_KEY = 'youtube-webxr:last-resolution';
if (!window.__youtubeWebXRLoaded && window.MediaSource && window.SourceBuffer) {
  window.__youtubeWebXRLoaded = true;
  install();
}

function install() {
  let video, source, stereo, spec, ui, loadController;
  let generation = 0, entryGeneration = 0, mode = 'auto', busy = false, error = '', status = '';
  let qualities = [], quality = 0, targetQuality = 1080, requestedQuality = 1080, xrSupported = false;
  let intendedPlaying = false, restorePlaying = false, started = false, navigating = false, detailsOpen = false;
  let removeVideoListeners = () => {};
  const resolver = new StereoResolver();
  let lastDiagnosticsAt = -Infinity, attachTimer = 0;
  try { const saved = Number(localStorage.getItem(STORAGE_KEY)); if (Number.isInteger(saved) && saved > 0 && saved <= 16384) targetQuality = Math.max(MIN_VR_HEIGHT, saved); } catch {}
  const id = () => new URL(location.href).searchParams.get('v');
  const state = () => ({ title: document.getElementById('movie_player')?.getVideoData?.()?.title || document.title.replace(/ - YouTube$/, ''),
    time: video?.currentTime || 0, duration: video?.duration || 0, paused: busy ? !intendedPlaying : video?.paused ?? true,
    quality, qualities, requestedQuality, busy, error, status, layout: mode === 'mono' ? 'Monoscopic 180°' : 'Stereo 180°' });
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
  function finish(resume = true) {
    ++generation; ++entryGeneration;
    const restore = started ? intendedPlaying : restorePlaying;
    const shouldRestore = busy || !!error;
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
    error = e.message || String(e); status = error; video?.pause(); player.setSource(null); update();
  }
  async function specification(metadata) {
    if (mode !== 'auto') return { meshes: [sphere()], stereoMode: { sbs: 2, tb: 1, mono: 0 }[mode], pose: [0,0,0] };
    if (!metadata?.projection) throw new Error('This stream has no projection metadata. Choose a manual layout in VR details if you know its packing.');
    const p = metadata.projection;
    const meshes = p.type === 'mesh' ? await decodeMesh(p.payload) : p.type === 'equirectangular' ? [sphere(p.bounds)] : null;
    if (!meshes) throw new Error('This projection is not supported.');
    if (metadata.stereoMode === 3 && meshes.length !== 2) throw new Error('Custom stereo requires two eye meshes.');
    return { meshes, stereoMode: metadata.stereoMode ?? 0, pose: metadata.pose || [0,0,0] };
  }
  async function prepare(height = targetQuality, preview = false) {
    if (!video) return;
    const token = ++generation, original = video;
    loadController?.abort(); stereo?.dispose(); stereo = null; spec = null;
    player.setSource(null);
    const controller = loadController = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Preparing video timed out. Try again.')), 30000);
    requestedQuality = height; busy = true; error = ''; status = `Loading ${height}p…`; quality = 0;
    original.pause(); update();
    let candidate;
    try {
      let metadata, result;
      const observedStereo = source?.metadata?.projection && [1,2,3,4].includes(source.metadata.stereoMode);
      if (mode !== 'auto' || (observedStereo && !id())) {
        metadata = source?.metadata;
        qualities = mode === 'auto' ? [original.videoHeight].filter(h => h >= MIN_VR_HEIGHT) : [];
        await waitForFrame(original, controller.signal);
      } else {
        result = await resolver.resolve(id(), height, controller.signal, formats => {
          if (token !== generation) return;
          qualities = formats.qualities; update();
        });
        controller.signal.throwIfAborted();
        candidate = new LinkedVideo(original, result, e => mediaError(e, controller, token), controller.signal);
        await candidate.prepare(controller.signal);
        metadata = result.metadata;
      }
      const nextSpec = await specification(metadata);
      controller.signal.throwIfAborted();
      if (token !== generation || original !== video) return;
      stereo = candidate; spec = nextSpec;
      const displayed = stereo?.video || original;
      quality = displayed.videoHeight;
      if (preview && !player.session) player.preview(displayed, spec, ui.previewParent);
      else player.setSource(displayed, spec);
      busy = false; started = true; status = preview && !player.session ? 'Eye preview: left eye on the left, right eye on the right.' : `Playing ${quality}p`;
      remember(); update();
      if (intendedPlaying) { await original.play(); stereo?.sync(); }
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
    restorePlaying = !video.paused;
    intendedPlaying = preview ? !video.paused : true;
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
    if (!video || busy || error || !Number.isFinite(video.duration)) return;
    const token = generation, original = video;
    const controller = loadController;
    const playing = !original.paused;
    intendedPlaying = playing; busy = true; status = 'Seeking…'; original.pause(); update();
    const seekController = new AbortController();
    const cancel = () => seekController.abort(controller?.signal.reason);
    controller?.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => seekController.abort(new Error('Seeking timed out. Try again.')), 30000);
    try {
      original.currentTime = seekTarget(time, 0, original.duration);
      if (stereo) { stereo.video.currentTime = Math.min(original.currentTime, stereo.video.duration - .01); stereo.stream.pump(); }
      await Promise.all([waitForFrame(original, seekController.signal), ...(stereo ? [waitForFrame(stereo.video, seekController.signal)] : [])]);
      if (token !== generation) return;
      busy = false; status = `Playing ${quality}p`; update();
      if (playing) { await original.play(); stereo?.sync(); }
    } catch (e) {
      if (token === generation) { busy = false; error = e.message; status = error; update(); }
    } finally { clearTimeout(timeout); controller?.signal.removeEventListener('abort', cancel); }
  }
  function action(name, value) {
    if (name === 'exit') return exit();
    if (name === 'quality') {
      if (value === quality && !busy && !error) return;
      if (player.session && qualities.includes(value)) { if (!busy && !error) intendedPlaying = !video.paused; prepare(value); }
      return;
    }
    if (name === 'retry') return prepare(requestedQuality, !player.session);
    if (busy || error || !video) return;
    if (name === 'toggle') {
      intendedPlaying = video.paused;
      if (intendedPlaying) video.play().catch(e => { error = e.message; status = error; update(); }); else video.pause();
    } else if (name === 'seek') seek(value);
    else if (name === 'skip' || name === 'back' || name === 'forward') seek(seekTarget(video.currentTime, name === 'back' ? -10 : name === 'forward' ? 10 : value, video.duration));
    update();
  }
  function refresh() {
    const next = document.querySelector('video.html5-main-video') || document.querySelector('video:not([data-youtube-webxr-stereo])');
    if (next !== video) {
      navigating = true; exit(); navigating = false; removeVideoListeners(); video = next;
      if (video) {
        const original = video;
        const changed = () => {
          if (!busy && !error) intendedPlaying = !original.paused;
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
      selectedMode: mode, state: { busy, status, error, actualResolution: quality, availableResolutions: qualities },
      stereoStream: stereo ? { itag: stereo.result.format.itag, width: stereo.video.videoWidth, height: stereo.video.videoHeight,
        stereoMode: stereo.result.metadata.stereoMode, projection: stereo.result.metadata.projection.type, meshCount: spec?.meshes.length,
        synchronizationDriftSeconds: stereo.video.currentTime - video.currentTime } : null }, null, 2);
  }
  function update() {
    if (!ui) return;
    ui.entry.textContent = player.pending ? 'Cancel VR' : player.session ? 'Exit VR' : 'Enter VR';
    ui.entry.disabled = !video || (!xrSupported && !player.session && !player.pending);
    ui.entry.title = xrSupported ? 'Open the VR180 player' : 'This browser cannot enter VR. Eye preview is available in VR details.';
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
    for (const [value, text] of [['auto','Automatic'],['sbs','Manual — VR180 left-right'],['tb','Manual — VR180 top-bottom'],['mono','Manual — 180° monoscopic']]) {
      const option = make('option', text, select); option.value = value;
    }
    select.addEventListener('change', () => { mode = select.value; if (player.mode) { intendedPlaying = !video.paused; prepare(targetQuality, player.mode === 'preview'); } });
    make('p', 'In VR: point and trigger to use controls. Trigger away from the panel to hide it; trigger again to show it. Squeeze to recenter.', details);
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
    navigator.xr?.isSessionSupported('immersive-vr').then(supported => { xrSupported = supported; update(); }).catch(() => {});
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
