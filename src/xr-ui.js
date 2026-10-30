import { identity, transform, anchorMatrix, panelIntersection, thumbstickDirection } from './xr-math.js';
import { paintPanel, PANEL_HEIGHT, qualityPageSize } from './panel.js';

const halfHeight = PANEL_HEIGHT * .64 / 512 / 2;
const bottomUV = 1 - PANEL_HEIGHT / 512;
const quad = new Float32Array([-.64,-halfHeight,0,0,bottomUV, .64,-halfHeight,0,1,bottomUV, -.64,halfHeight,0,0,1,
  .64,-halfHeight,0,1,bottomUV, .64,halfHeight,0,1,1, -.64,halfHeight,0,0,1]);
const corners = [[-.025, -.065, -.025], [.025, -.065, -.025], [.025, .035, -.025], [-.025, .035, -.025],
  [-.025, -.065, .025], [.025, -.065, .025], [.025, .035, .025], [-.025, .035, .025]];
const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const triangles = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
const vertices = list => new Float32Array(list.flatMap(p => [...p, 0, 0]));
const body = vertices(triangles.flatMap(t => t.map(i => corners[i])));
const outlinePoints = edges.flatMap(e => e.map(i => corners[i]));
for (let i = 0; i < 24; i++) for (const angle of [i, i + 1]) {
  const a = angle * Math.PI / 12; outlinePoints.push([Math.cos(a) * .047, .035, Math.sin(a) * .047 - .018]);
}
const outline = vertices(outlinePoints);

export class XRControls {
  constructor(gl, getState, action) {
    this.gl = gl; this.getState = getState; this.action = action;
    this.anchor = identity(); this.pointers = new Map(); this.presses = new Map(); this.sticks = new Map();
    this.visible = true; this.panelHeight = PANEL_HEIGHT; this.menuPage = 0;
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d'); this.menu = false; this.buttons = []; this.shaders = [];
    const shader = (type, code) => {
      const s = gl.createShader(type); this.shaders.push(s); gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;
    };
    this.program = gl.createProgram();
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, `
      attribute vec3 position; attribute vec2 uv; uniform mat4 projection, view, model;
      varying vec2 textureUV;
      void main(){ textureUV=uv; gl_Position=projection*view*model*vec4(position,1.0); }`));
    gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float; varying vec2 textureUV; uniform sampler2D picture;
      uniform vec4 color; uniform bool textured;
      void main(){ gl_FragColor=textured?texture2D(picture,textureUV):color; }`));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.u = Object.fromEntries(['projection','view','model','picture','color','textured'].map(n => [n, gl.getUniformLocation(this.program, n)]));
    this.position = gl.getAttribLocation(this.program, 'position'); this.uv = gl.getAttribLocation(this.program, 'uv');
    this.buffer = gl.createBuffer(); this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  recenter(pose) { this.anchor = anchorMatrix(pose); }
  setVisible(visible) {
    this.visible = visible; this.menu = false; this.menuPage = 0; this.presses.clear(); this.signature = null;
    for (const pointer of this.pointers.values()) pointer.hit = null;
  }
  hit(matrix) {
    if (!this.visible) return null;
    const p = panelIntersection(matrix, this.anchor);
    if (!p?.inside || p.y > this.panelHeight) return null;
    const button = this.buttons.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    return { ...p, id: button?.id || 'background', disabled: button?.disabled,
      ratio: Math.max(0, Math.min(1, (p.x - 128) / 768)) };
  }
  input(type, source) {
    const hit = this.pointers.get(source)?.hit;
    if (type === 'selectstart') { this.presses.set(source, { hit, down: true }); return; }
    const press = this.presses.get(source);
    if (type === 'selectend') { if (press) press.down = false; return; }
    if (type !== 'select') return;
    this.presses.delete(source);
    if (!press) return;
    if (press.hit?.disabled) return;
    if (press.hit?.id === 'seek') {
      if (!this.getState().busy) this.action('seek', (hit?.ratio ?? press.hit.ratio) * this.getState().duration);
    } else if (hit?.id === press.hit?.id) {
      if (!hit) this.setVisible(!this.visible);
      else if (!hit.disabled && hit.id !== 'background') {
        if (hit.id === 'hide-ui') this.setVisible(false);
        else if (hit.id === 'quality') { this.menu = !this.menu; this.menuPage = 0; }
        else if (hit.id === 'quality-back') this.menu = false;
        else if (hit.id === 'quality-next') this.menuPage++;
        else if (hit.id === 'quality-previous') this.menuPage = Math.max(0, this.menuPage - 1);
        else if (hit.id.startsWith('quality:')) this.action('quality', Number(hit.id.split(':')[1]));
        else this.action(hit.id);
      }
    }
  }
  update(frame, space, sources, now) {
    const state = this.getState();
    if (state.error && state.error !== this.lastError) this.setVisible(true);
    else if (state.busy && !this.wasBusy && !this.visible) this.setVisible(true);
    this.lastError = state.error; this.wasBusy = state.busy;
    const live = new Set(sources);
    for (const source of this.pointers.keys()) if (!live.has(source)) { this.pointers.delete(source); this.presses.delete(source); this.sticks.delete(source); }
    for (const source of sources) {
      const ray = frame.getPose(source.targetRaySpace, space);
      const grip = source.gripSpace && frame.getPose(source.gripSpace, space);
      if (!ray) { this.pointers.delete(source); this.presses.delete(source); continue; }
      const hit = this.hit(ray.transform.matrix);
      this.pointers.set(source, { ray: ray.transform.matrix, grip: grip?.transform.matrix, hit });
      const press = this.presses.get(source);
      if (press?.down && press.hit?.id === 'seek' && hit) press.hit.ratio = hit.ratio;
      if (source.gamepad?.mapping === 'xr-standard' && source.gamepad.axes.length >= 4) {
        const next = thumbstickDirection(source.gamepad.axes, this.sticks.get(source) || false);
        this.sticks.set(source, next.latched); if (next.step) this.action('skip', next.step);
      }
    }
    if (this.visible) this.paint(now);
  }
  paint(now) {
    const state = this.getState();
    const hovered = [...this.pointers.values()].map(p => p.hit?.id);
    const pressed = [...this.presses.values()].filter(p => p.down).map(p => p.hit?.id);
    const dragRatio = [...this.presses.values()].find(p => p.down && p.hit?.id === 'seek')?.hit.ratio;
    const hoverRatio = [...this.pointers.values()].find(p => p.hit?.id === 'seek')?.hit.ratio;
    const count = state.qualities?.length || 0, size = qualityPageSize(count);
    this.menuPage = Math.min(this.menuPage, Math.max(0, Math.ceil(count / size) - 1));
    // Pointer ratios move every frame; repaint at 2 px track steps. Spinners animate at about 15 fps.
    const step = ratio => ratio == null ? null : Math.round(ratio * 384);
    const spin = state.busy ? Math.floor(now / 66) : 0;
    const signature = JSON.stringify([state.title,state.status,state.busy,state.error,state.paused,state.quality,state.requestedQuality,state.qualities,
      state.layout,Math.floor(state.time || 0),Math.floor(state.duration || 0),this.menu,this.menuPage,hovered,pressed,step(dragRatio),step(hoverRatio),spin]);
    if (signature === this.signature && now - this.paintedAt < 250) return;
    this.signature = signature; this.paintedAt = now;
    this.buttons = paintPanel(this.ctx,state,{hovered,pressed,dragRatio,hoverRatio,menu:this.menu,menuPage:this.menuPage,now});
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  draw(view, viewport) {
    const gl = this.gl, u = this.u;
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height); gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(u.projection, false, view.projectionMatrix); gl.uniformMatrix4fv(u.view, false, view.transform.inverse.matrix);
    const draw = (data, model, mode, color, textured = false) => {
      gl.uniformMatrix4fv(u.model, false, model); gl.uniform4fv(u.color, color); gl.uniform1i(u.textured, textured);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(this.uv); gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 20, 12);
      gl.drawArrays(mode, 0, data.length / 5);
    };
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(u.picture, 0);
    if (this.visible) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      draw(quad, this.anchor, gl.TRIANGLES, [1,1,1,1], true);
      gl.disable(gl.BLEND);
    }
    for (const [source, pointer] of this.pointers) {
      const color = source.handedness === 'left' ? [.25,.85,1,1] : [1,.8,.35,1];
      if (pointer.grip) {
        draw(body, pointer.grip, gl.TRIANGLES, [.035,.05,.07,1]);
        draw(outline, pointer.grip, gl.LINES, color);
      }
      if (!this.visible) continue;
      const start = transform(pointer.ray, [0,0,0]), end = transform(pointer.ray, [0,0,-(pointer.hit?.distance || 1.2)]);
      draw(vertices([start, end]), identity(), gl.LINES, color);
      if (pointer.hit) {
        const x = (pointer.hit.x / 1024 - .5) * 1.28, y = (.5 - pointer.hit.y / PANEL_HEIGHT) * (halfHeight * 2);
        const points = [];
        for (let i = 0; i < 24; i++) for (const a of [i, i + 1]) points.push([x + Math.cos(a * Math.PI / 12) * .008, y + Math.sin(a * Math.PI / 12) * .008, .002]);
        draw(vertices(points), this.anchor, gl.LINES, [1,1,1,1]);
      }
    }
  }
  dispose() {
    const gl = this.gl; gl.deleteBuffer(this.buffer); gl.deleteTexture(this.texture); gl.deleteProgram(this.program);
    for (const shader of this.shaders) gl.deleteShader(shader);
    this.pointers.clear(); this.presses.clear(); this.sticks.clear();
  }
}
