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
      this.meshes = spec.meshes.map(parts => parts.map(part => {
        const buffer = gl.createBuffer(); this.buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, part.data, gl.STATIC_DRAW);
        return { buffer, count: part.data.length / 5, mode: [gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN][part.mode] };
      }));
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
    } catch (error) { this.dispose(); throw error; }
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
  constructor(onStatus, onEnd) { this.onStatus = onStatus; this.onEnd = onEnd; this.active = false; }
  async start(video, spec, previewParent = null, controlsVideo = video) {
    if (this.active) return;
    this.active = true; this.video = video; this.recenterPending = true;
    const run = this.run = (this.run || 0) + 1;
    const current = () => this.active && this.run === run;
    try {
      // Request the session within the button's activation, before awaiting other work.
      if (!previewParent) {
        this.onStatus('Requesting immersive VR…');
        const session = await navigator.xr.requestSession('immersive-vr');
        if (!current()) { await session.end(); return; }
        this.session = session;
        session.addEventListener('end', () => { if (current()) this.cleanup(); }, { once: true });
      }
      const canvas = this.canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 480;
      if (previewParent) previewParent.append(canvas);
      const renderer = this.renderer = new VideoRenderer(canvas, spec);
      if (controlsVideo.paused) await controlsVideo.play();
      if (video !== controlsVideo && video.paused) await video.play();
      if (!current()) return;
      if (this.session) {
        await renderer.gl.makeXRCompatible();
        if (!current()) return;
        const layer = new XRWebGLLayer(this.session, renderer.gl, { alpha: false, antialias: false });
        this.session.updateRenderState({ baseLayer: layer, depthNear: 0.01, depthFar: 10 });
        const space = await this.session.requestReferenceSpace('local');
        if (!current()) return;
        this.session.addEventListener('select', () => {
          if (controlsVideo.paused) controlsVideo.play().catch(e => this.fail(e)); else controlsVideo.pause();
        });
        this.session.addEventListener('squeeze', () => { this.recenterPending = true; });
        const frame = (_, xrFrame) => {
          if (!this.active) return;
          try {
            const pose = xrFrame.getViewerPose(space);
            renderer.clear(layer.framebuffer);
            if (pose && renderer.upload(video)) {
              if (this.recenterPending) {
                const m = pose.transform.matrix;
                renderer.heading = Math.atan2(m[8], m[10]); this.recenterPending = false;
              }
              for (const xrView of pose.views) renderer.draw(xrView.eye, layer.getViewport(xrView), xrView.projectionMatrix, xrView.transform.inverse.matrix);
            }
            this.frame = this.session.requestAnimationFrame(frame);
          } catch (error) { this.fail(error); }
        };
        this.frame = this.session.requestAnimationFrame(frame);
        this.onStatus('VR active. Select to pause or play; squeeze to recenter.');
      } else {
        const p = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.02002, 0]);
        const frame = () => {
          if (!this.active) return;
          try {
            renderer.clear();
            if (renderer.upload(video)) {
              renderer.draw('left', { x: 0, y: 0, width: 480, height: 480 }, p, identity());
              renderer.draw('right', { x: 480, y: 0, width: 480, height: 480 }, p, identity());
            }
            this.frame = requestAnimationFrame(frame);
          } catch (error) { this.fail(error); }
        };
        this.frame = requestAnimationFrame(frame);
        this.onStatus('Eye preview: left eye on the left, right eye on the right.');
      }
    } catch (error) { if (current()) this.fail(error); }
  }
  fail(error) { this.stop(); this.onStatus(error.message || String(error)); }
  stop() {
    if (this.session) this.session.end().catch(() => {});
    this.cleanup();
  }
  cleanup() {
    if (!this.active) return;
    this.active = false;
    if (this.session && this.frame) this.session.cancelAnimationFrame(this.frame);
    else if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null; this.session = null;
    this.renderer?.dispose(); this.renderer = null; this.canvas?.remove(); this.canvas = null;
    this.onEnd();
  }
}
