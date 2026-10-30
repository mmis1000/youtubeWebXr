import { XRControls } from './xr-ui.js';

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

export function layoutLabel(metadata) {
  const layout = metadata.stereoMode ? 'Stereo' : 'Monoscopic';
  const p = metadata.projection;
  if (p?.type !== 'equirectangular') return `${layout} VR`;
  const [, , left, right] = p.bounds;
  return `${layout} ${Math.round((1 - left - right) * 360)}°`;
}

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
function modelMatrix(pose, heading) {
  const [yaw, pitch, roll] = pose.map(x => x * Math.PI / 180);
  return multiply(multiply(rotation(1, heading + yaw), rotation(0, pitch)), rotation(2, roll));
}

export class VideoRenderer {
  constructor(canvas, spec) {
    this.canvas = canvas; this.spec = spec; this.heading = 0;
    const gl = this.gl = canvas.getContext('webgl', { alpha: false, antialias: false });
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
        uniform mat4 projection, view, model; uniform vec4 crop;
        varying vec2 videoUV;
        void main() { videoUV = uv * crop.xy + crop.zw;
          gl_Position = projection * view * model * vec4(normalize(position), 1.0); }`));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
        precision mediump float; uniform sampler2D video; varying vec2 videoUV;
        void main() { gl_FragColor = texture2D(video, videoUV); }`));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.uniforms = Object.fromEntries(['projection', 'view', 'model', 'crop', 'video'].map(n => [n, gl.getUniformLocation(program, n)]));
      this.position = gl.getAttribLocation(program, 'position'); this.uv = gl.getAttribLocation(program, 'uv');
      this.setSpec(spec);
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
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
  upload(video) {
    if (video.readyState < 2) return false;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`The video frame could not be used as a WebGL texture (${error}).`);
    return true;
  }
  clear(framebuffer = null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  draw(eye, viewport, projection, viewMatrix) {
    const gl = this.gl, u = this.uniforms;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height); gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.projection, false, projection);
    // Captured video has a fixed camera origin. Only headset rotation changes the viewing direction.
    const v = new Float32Array(viewMatrix); v[12] = v[13] = v[14] = 0;
    gl.uniformMatrix4fv(u.view, false, v);
    gl.uniformMatrix4fv(u.model, false, modelMatrix(this.spec.pose, this.heading));
    gl.uniform4fv(u.crop, uvTransform(this.spec.stereoMode, eye)); gl.uniform1i(u.video, 0);
    for (const part of this.meshes[eye === 'right' && this.meshes.length === 2 ? 1 : 0]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer);
      gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(this.uv); gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 20, 12);
      gl.drawArrays(part.mode, 0, part.count);
    }
  }
  dispose() {
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
    if (spec) this.renderer?.setSpec(spec);
  }
  async enter() {
    if (this.pending || this.session) return false;
    this.pending = true;
    const request = ++this.request;
    this.onStatus('Opening VR…');
    let session;
    try {
      // Keep the permission request in the originating click's activation.
      session = await navigator.xr.requestSession('immersive-vr');
      if (request !== this.request) { await session.end(); return false; }
      this.clearScene(); this.mode = 'vr'; this.session = session;
      session.addEventListener('end', () => { if (this.session === session) this.cleanup(); }, { once: true });
      this.createRenderer();
      const renderer = this.renderer;
      await renderer.gl.makeXRCompatible();
      if (request !== this.request) return false;
      const layer = new XRWebGLLayer(session, renderer.gl, { alpha: false, antialias: false });
      session.updateRenderState({ baseLayer: layer, depthNear: .01, depthFar: 20 });
      const space = await session.requestReferenceSpace('local');
      if (request !== this.request) return false;
      this.controls = new XRControls(renderer.gl, () => this.options.state?.() || {
        title: 'YouTube VR180', time: this.video?.currentTime || 0, duration: this.video?.duration || 0,
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
              renderer.heading = Math.atan2(pose.transform.matrix[8], pose.transform.matrix[10]);
              this.controls.recenter(pose.transform.matrix); this.recenterPending = false;
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
    // Rotate the scene opposite the requested viewing direction; keep the panel anchored.
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
  // Compatibility entry for the standalone device measurement harness.
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
