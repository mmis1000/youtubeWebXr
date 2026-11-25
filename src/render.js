import { XRControls } from './xr-ui.js';
import { gazeAngles } from './xr-math.js';

export function uvTransform(stereoMode, eye) {
  const right = eye === 'right';
  if (stereoMode === 2) return [0.5, 1, right ? 0.5 : 0, 0];
  if (stereoMode === 4) return [0.5, 1, right ? 0 : 0.5, 0];
  if (stereoMode === 1) return [1, 0.5, 0, right ? 0 : 0.5];
  if (stereoMode === 0 || stereoMode === 3) return [1, 1, 0, 0];
  throw new Error('Unsupported stereo layout.');
}

export function sphere(bounds = [0, 0, 0.25, 0.25]) {
  const [top, bottom, left, right] = bounds;
  const data = [];
  const vertex = (x, y) => {
    const u = x / 64, v = y / 32;
    const yaw = (left + u * (1 - left - right) - 0.5) * 2 * Math.PI;
    const pitch = (bottom + v * (1 - top - bottom) - 0.5) * Math.PI;
    data.push(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch), u, v);
  };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    vertex(x, y); vertex(x + 1, y); vertex(x, y + 1);
    vertex(x + 1, y); vertex(x + 1, y + 1); vertex(x, y + 1);
  }
  return [{ mode: 0, data: new Float32Array(data) }];
}

// Curved cylindrical virtual cinema screen centered in front of the viewer.
export function cinemaScreen(aspect = 16 / 9, scale = 1) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 && aspect < 5 ? aspect : 16 / 9;
  const safeScale = Math.max(0.5, Math.min(2.0, scale || 1));
  const radius = 3.0;
  // Cap vertical height so tall 9:16 Shorts stay comfortable in the headset.
  let width = 3.2 * safeScale;
  let height = width / safeAspect;
  const maxHeight = 2.6 * safeScale;
  if (height > maxHeight) { height = maxHeight; width = height * safeAspect; }
  const arc = Math.min(Math.PI * 0.85, width / radius);
  const cols = 48, rows = 8, data = [];
  const vertex = (x, y) => {
    const u = x / cols, v = y / rows;
    const angle = (u - 0.5) * arc;
    const px = Math.sin(angle) * radius;
    const py = (v - 0.5) * height;
    const pz = -Math.cos(angle) * radius;
    data.push(px, py, pz, u, v);
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    vertex(x, y); vertex(x + 1, y); vertex(x, y + 1);
    vertex(x + 1, y); vertex(x + 1, y + 1); vertex(x, y + 1);
  }
  return [{ mode: 0, data: new Float32Array(data) }];
}

// Pure JS reference for EAC 3x2 cubemap direction -> bottom-up UV (matches the GLSL shader).
export function eacDirectionToUV(dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let col, row, fu, fv;
  if (ax >= ay && ax >= az) {
    if (dx < 0) { col = 0; row = 1; fu = -dz / ax; fv = dy / ax; } // Left (-X), top row (row=1 in bottom-up)
    else { col = 2; row = 1; fu = dz / ax; fv = dy / ax; }         // Right (+X), top row
  } else if (az >= ax && az >= ay) {
    if (dz < 0) { col = 1; row = 1; fu = dx / az; fv = dy / az; }  // Front (-Z), top row
    else { col = 1; row = 0; fu = dy / az; fv = dx / az; }         // Back (+Z), bottom row (rot 90 CW)
  } else {
    if (dy < 0) { col = 0; row = 0; fu = dz / ay; fv = dx / ay; }  // Bottom (-Y), bottom row
    else { col = 2; row = 0; fu = -dz / ay; fv = dx / ay; }        // Top (+Y), bottom row
  }
  const u = (col + 0.5 + (2 / Math.PI) * Math.atan(fu)) / 3;
  const v = (row + 0.5 + (2 / Math.PI) * Math.atan(fv)) / 2;
  return [u, v];
}

// Pure JS reference for standard Spherical Video V2 cbmp 3x2 cubemap (Right/Left/Up over Down/Front/Back).
export function cbmpDirectionToUV(dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let col, row, fu, fv;
  if (ax >= ay && ax >= az) {
    if (dx > 0) { col = 0; row = 1; fu = dz / ax; fv = dy / ax; }  // Right (+X)
    else { col = 1; row = 1; fu = -dz / ax; fv = dy / ax; }        // Left (-X)
  } else if (ay >= ax && ay >= az) {
    if (dy > 0) { col = 2; row = 1; fu = dx / ay; fv = dz / ay; }  // Up (+Y)
    else { col = 0; row = 0; fu = dx / ay; fv = -dz / ay; }        // Down (-Y)
  } else {
    if (dz < 0) { col = 1; row = 0; fu = dx / az; fv = dy / az; }  // Front (-Z)
    else { col = 2; row = 0; fu = -dx / az; fv = dy / az; }        // Back (+Z)
  }
  return [(col + 0.5 + 0.5 * fu) / 3, (row + 0.5 + 0.5 * fv) / 2];
}

export function layoutLabel(metadata) {
  const layout = metadata.stereoMode ? 'Stereo' : 'Monoscopic';
  const p = metadata.projection;
  if (p?.type === 'cinema') return metadata.stereoMode ? '3D Cinema' : 'Virtual Cinema';
  if (p?.type === 'cubemap') return `${layout} 360° ${p.eac ? 'EAC' : 'Cubemap'}`;
  if (p?.type !== 'equirectangular') return `${layout} VR`;
  const [, , left, right] = p.bounds;
  return `${layout} ${Math.round((1 - left - right) * 360)}°`;
}

// Decoded frames kept open after upload (see VideoRenderer.upload). The decoder has few buffers
// (Iris AV1: 8 references + 2), so holding more than the latest frame stalls playback.
const HELD_FRAMES = 1;

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const multiply = (a, b) => {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};
function rotation(axis, angle) {
  const out = identity(), c = Math.cos(angle), s = Math.sin(angle);
  const i = (axis + 1) % 3, j = (axis + 2) % 3;
  out[i * 4 + i] = c; out[j * 4 + j] = c; out[i * 4 + j] = s; out[j * 4 + i] = -s;
  return out;
}
function translation(x, y, z) {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}
function modelMatrix(pose, heading, pitchOffset = 0, origin = null) {
  const [yaw, pitch, roll] = pose.map(x => x * Math.PI / 180);
  const rot = multiply(
    multiply(rotation(1, heading + yaw), rotation(0, pitchOffset + pitch)),
    rotation(2, roll)
  );
  return origin ? multiply(translation(origin[0], origin[1], origin[2]), rot) : rot;
}

export class VideoRenderer {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec; this.heading = 0; this.pitch = 0;
    this.origin = [0, 0, 0]; this.heldFrames = [];
    const attrs = { alpha: false, antialias: false, xrCompatible: true };
    const gl = this.gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) throw new Error('WebGL is unavailable.');
    this.buffers = []; this.shaders = [];
    try {
      const shader = (type, source) => {
        const s = gl.createShader(type); this.shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const program = this.program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, `
        attribute vec3 position; attribute vec2 uv;
        uniform mat4 projection, view, model; uniform vec4 crop; uniform float isCinema;
        varying vec2 videoUV; varying vec3 dir;
        void main() {
          vec2 c = uv * crop.xy + crop.zw;
          videoUV = vec2(c.x, 1.0 - c.y);
          dir = position;
          vec3 p = isCinema > 0.5 ? position : normalize(position);
          gl_Position = projection * view * model * vec4(p, 1.0);
        }`));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D video; uniform vec4 crop; uniform float cubemapMode; uniform float eacInset;
        varying vec2 videoUV; varying vec3 dir;
        const float TWO_OVER_PI = 0.63661977237;
        void main() {
          if (cubemapMode < 0.5) {
            gl_FragColor = texture2D(video, videoUV);
            return;
          }
          vec3 d = normalize(dir);
          vec3 a = abs(d);
          float col, row, fu, fv, lu, lv;
          if (cubemapMode > 1.5) {
            // YouTube Equi-Angular Cubemap (EAC): Left/Front/Right over Bottom/Back/Top (bottom row rot 90 CW).
            if (a.x >= a.y && a.x >= a.z) {
              if (d.x < 0.0) { col = 0.0; row = 1.0; fu = -d.z / a.x; fv = d.y / a.x; }
              else { col = 2.0; row = 1.0; fu = d.z / a.x; fv = d.y / a.x; }
            } else if (a.z >= a.x && a.z >= a.y) {
              if (d.z < 0.0) { col = 1.0; row = 1.0; fu = d.x / a.z; fv = d.y / a.z; }
              else { col = 1.0; row = 0.0; fu = d.y / a.z; fv = d.x / a.z; }
            } else {
              if (d.y < 0.0) { col = 0.0; row = 0.0; fu = d.z / a.y; fv = d.x / a.y; }
              else { col = 2.0; row = 0.0; fu = -d.z / a.y; fv = d.x / a.y; }
            }
            lu = clamp(0.5 + atan(fu) * TWO_OVER_PI, eacInset, 1.0 - eacInset);
            lv = clamp(0.5 + atan(fv) * TWO_OVER_PI, eacInset, 1.0 - eacInset);
          } else {
            // Standard Spherical Video V2 cbmp layout 0: Right/Left/Up over Down/Front/Back (linear).
            if (a.x >= a.y && a.x >= a.z) {
              if (d.x > 0.0) { col = 0.0; row = 1.0; fu = d.z / a.x; fv = d.y / a.x; }
              else { col = 1.0; row = 1.0; fu = -d.z / a.x; fv = d.y / a.x; }
            } else if (a.y >= a.x && a.y >= a.z) {
              if (d.y > 0.0) { col = 2.0; row = 1.0; fu = d.x / a.y; fv = d.z / a.y; }
              else { col = 0.0; row = 0.0; fu = d.x / a.y; fv = -d.z / a.y; }
            } else {
              if (d.z < 0.0) { col = 1.0; row = 0.0; fu = d.x / a.z; fv = d.y / a.z; }
              else { col = 2.0; row = 0.0; fu = -d.x / a.z; fv = d.y / a.z; }
            }
            lu = clamp(0.5 + 0.5 * fu, eacInset, 1.0 - eacInset);
            lv = clamp(0.5 + 0.5 * fv, eacInset, 1.0 - eacInset);
          }
          vec2 uv = vec2((col + lu) / 3.0, (row + lv) / 2.0);
          vec2 c = uv * crop.xy + crop.zw;
          gl_FragColor = texture2D(video, vec2(c.x, 1.0 - c.y));
        }`));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.uniforms = Object.fromEntries(['projection', 'view', 'model', 'crop', 'video', 'isCinema', 'cubemapMode', 'eacInset'].map(n => [n, gl.getUniformLocation(program, n)]));
      this.position = gl.getAttribLocation(program, 'position'); this.uv = gl.getAttribLocation(program, 'uv');
      this.setSpec(spec);
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
    } catch (error) { this.dispose(); throw error; }
  }
  setSpec(spec) {
    const gl = this.gl;
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    this.buffers = []; this.spec = spec;
    this.meshes = spec.meshes.map(parts => parts.map(part => {
      const buffer = gl.createBuffer(); this.buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, part.data, gl.STATIC_DRAW);
      return { buffer, count: part.data.length / 5, mode: [gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN][part.mode] };
    }));
  }
  watch(video) {
    if (this.watched === video) return;
    this.releaseFrames();
    this.unwatch?.(); this.unwatch = null;
    if (this.watched && this.frameCallback) this.watched.cancelVideoFrameCallback?.(this.frameCallback);
    if (video) {
      const release = () => this.releaseFrames();
      const events = ['seeking', 'emptied', 'loadstart', 'ended', 'waiting', 'resize'];
      for (const type of events) video.addEventListener(type, release);
      this.unwatch = () => { for (const type of events) video.removeEventListener(type, release); };
    }
    this.watched = video; this.frameCallback = null; this.presented = 0; this.uploaded = -1; this.lastCallback = 0;
    if (!video?.requestVideoFrameCallback) return;
    const tick = (now, metadata) => {
      if (this.watched !== video) return;
      this.presented = metadata.presentedFrames; this.lastCallback = performance.now();
      this.frameCallback = video.requestVideoFrameCallback(tick);
    };
    this.frameCallback = video.requestVideoFrameCallback(tick);
  }
  upload(video) {
    if (video.readyState < 2) { this.releaseFrames(); return false; }
    this.watch(video);
    const callbacksLive = this.frameCallback && (video.paused || performance.now() - this.lastCallback < 250);
    if (callbacksLive && this.uploaded === this.presented) return true;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Avoid UNPACK_FLIP_Y_WEBGL (Y is flipped in the vertex/fragment shader) and upload RGBA so
    // ANGLE/Vulkan can take the zero-copy video import path instead of an intermediate 8K GPU blit.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    let source = video;
    if (typeof VideoFrame === 'function') {
      try { source = new VideoFrame(video); } catch { source = video; }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (source !== video) {
      this.heldFrames.push(source);
      while (this.heldFrames.length > HELD_FRAMES) this.heldFrames.shift().close();
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`The video frame could not be used as a WebGL texture (${error}).`);
    this.uploaded = this.presented;
    return true;
  }
  releaseFrames() {
    for (const frame of this.heldFrames.splice(0)) frame.close();
  }
  clear(framebuffer = null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  draw(eye, viewport, projection, viewMatrix) {
    const gl = this.gl, u = this.uniforms;
    const cinema = !!this.spec.cinema;
    const eac = !!this.spec.eac;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height); gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.projection, false, projection);
    const v = new Float32Array(viewMatrix);
    if (!cinema) v[12] = v[13] = v[14] = 0;
    gl.uniformMatrix4fv(u.view, false, v);
    gl.uniformMatrix4fv(u.model, false, modelMatrix(this.spec.pose, this.heading, this.pitch, cinema ? this.origin : null));
    gl.uniform4fv(u.crop, uvTransform(this.spec.stereoMode, eye)); gl.uniform1i(u.video, 0);
    gl.uniform1f(u.isCinema, cinema ? 1 : 0);
    gl.uniform1f(u.cubemapMode, this.spec.cubemapMode || (this.spec.eac ? 2 : 0));
    const paddingPx = this.spec.eacPadding || 0;
    const faceSize = Math.max(1, (this.watched?.videoHeight || 1080) / 2);
    gl.uniform1f(u.eacInset, Math.min(0.08, (paddingPx + 0.5) / faceSize));
    for (const part of this.meshes[eye === 'right' && this.meshes.length === 2 ? 1 : 0]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer);
      gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(this.uv); gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 20, 12);
      gl.drawArrays(part.mode, 0, part.count);
    }
  }
  dispose() {
    this.watch(null);
    const gl = this.gl;
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const shader of this.shaders) gl.deleteShader(shader);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export class Player {
  constructor(onStatus, onEnd, options = {}) {
    this.onStatus = onStatus; this.onEnd = onEnd; this.options = options;
    this.mode = null; this.pending = false; this.request = 0;
  }
  get active() { return !!this.mode || this.pending; }
  cancelEntry() {
    if (this.session) this.stop();
    else { ++this.request; this.pending = false; }
  }
  createRenderer(spec = { meshes: [], stereoMode: 0, pose: [0, 0, 0] }) {
    const canvas = this.canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 480;
    this.renderer = new VideoRenderer(canvas, spec);
  }
  setSource(video, spec) {
    this.video = video;
    this.renderer?.watch(video || null);
    if (spec) this.renderer?.setSpec(spec);
  }
  async enter() {
    if (this.pending || this.session) return false;
    this.pending = true;
    const request = ++this.request;
    this.onStatus('Opening VR…');
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr');
      if (request !== this.request) { await session.end(); return false; }
      this.clearScene(); this.mode = 'vr'; this.session = session;
      session.addEventListener('end', () => { if (this.session === session) this.cleanup(); }, { once: true });
      this.createRenderer();
      const renderer = this.renderer;
      await renderer.gl.makeXRCompatible();
      if (request !== this.request) return false;
      const rawScale = typeof XRWebGLLayer.getNativeFramebufferScaleFactor === 'function'
        ? XRWebGLLayer.getNativeFramebufferScaleFactor(session) : 1;
      const framebufferScaleFactor = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
      const layer = new XRWebGLLayer(session, renderer.gl, { alpha: false, antialias: false, framebufferScaleFactor });
      session.updateRenderState({ baseLayer: layer, depthNear: .01, depthFar: 20 });
      const space = await session.requestReferenceSpace('local');
      if (request !== this.request) return false;
      this.controls = new XRControls(renderer.gl, () => this.options.state?.() || {
        title: 'YouTube WebXR', time: this.video?.currentTime || 0, duration: this.video?.duration || 0,
        paused: this.video?.paused ?? true, qualities: [], quality: this.video?.videoHeight
      }, (name, value) => {
        if (name === 'recenter') this.recenterPending = true;
        else if (name === 'turn') this.turn(value);
        else if (name === 'exit') this.stop();
        else this.options.action?.(name, value);
      });
      this.recenterPending = true;
      for (const type of ['selectstart', 'selectend', 'select']) session.addEventListener(type, e => {
        if (this.session === session) this.controls?.input(type, e.inputSource);
      });
      session.addEventListener('squeeze', () => { this.recenterPending = true; });
      const frame = (time, xrFrame) => {
        if (this.session !== session) return;
        try {
          const pose = xrFrame.getViewerPose(space);
          renderer.clear(layer.framebuffer);
          if (pose) {
            if (this.recenterPending) {
              const m = pose.transform.matrix;
              const { yaw, pitch } = gazeAngles(m);
              renderer.heading = yaw;
              renderer.pitch = pitch;
              renderer.origin = [m[12], m[13], m[14]];
              this.controls.recenter(m); this.recenterPending = false;
            }
            this.controls.update(xrFrame, space, session.inputSources, time);
            const ready = this.video && renderer.upload(this.video);
            for (const view of pose.views) {
              const viewport = layer.getViewport(view);
              if (ready) renderer.draw(view.eye, viewport, view.projectionMatrix, view.transform.inverse.matrix);
              this.controls.draw(view, viewport);
            }
          }
          this.frame = session.requestAnimationFrame(frame);
        } catch (error) { this.fail(error); }
      };
      this.frame = session.requestAnimationFrame(frame);
      this.pending = false; return true;
    } catch (error) {
      if (request !== this.request) return false;
      this.pending = false;
      if (session) { this.stop(); this.options.error?.(error); }
      this.onStatus(error.message || 'VR permission was not granted.');
      throw error;
    }
  }
  turn(degrees) {
    if (!this.renderer) return;
    const heading = this.renderer.heading + degrees * Math.PI / 180;
    this.renderer.heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  }
  preview(video, spec, parent) {
    this.clearScene(); this.mode = 'preview'; this.createRenderer(spec); this.video = video;
    parent.append(this.canvas);
    const renderer = this.renderer;
    const projection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -.02002, 0]);
    const frame = () => {
      if (this.mode !== 'preview' || this.renderer !== renderer) return;
      try {
        renderer.clear();
        if (this.video && renderer.upload(this.video)) {
          renderer.draw('left', { x: 0, y: 0, width: 480, height: 480 }, projection, identity());
          renderer.draw('right', { x: 480, y: 0, width: 480, height: 480 }, projection, identity());
        }
        this.frame = requestAnimationFrame(frame);
      } catch (error) { this.fail(error); }
    };
    this.frame = requestAnimationFrame(frame);
  }
  async start(video, spec, parent = null, controlsVideo = video) {
    if (parent) this.preview(video, spec, parent);
    else if (await this.enter()) this.setSource(video, spec);
    if (this.active) {
      await controlsVideo.play();
      if (video !== controlsVideo) await video.play();
    }
  }
  fail(error) { this.stop(); this.options.error?.(error); this.onStatus(error.message || String(error)); }
  stop() {
    ++this.request;
    this.session?.end().catch(() => {});
    this.cleanup();
  }
  clearScene() {
    if (this.frame) {
      if (this.session) this.session.cancelAnimationFrame(this.frame);
      else cancelAnimationFrame(this.frame);
    }
    this.frame = null;
    this.controls?.dispose(); this.controls = null;
    this.renderer?.dispose(); this.renderer = null; this.canvas?.remove(); this.canvas = null;
    this.video = null; this.mode = null;
  }
  cleanup() {
    const wasActive = this.active;
    ++this.request; this.pending = false;
    this.clearScene(); this.session = null;
    if (wasActive) this.onEnd();
  }
}
