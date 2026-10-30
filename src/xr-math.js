export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function transform(m, p, direction = false) {
  return [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + (direction ? 0 : m[12 + i]));
}

export function anchorMatrix(pose) {
  const m = identity(), heading = Math.atan2(pose[8], pose[10]), c = Math.cos(heading), s = Math.sin(heading);
  const tilt = 20 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  m[4] = -s * st; m[5] = ct; m[6] = -c * st;
  m[8] = s * ct; m[9] = st; m[10] = c * ct;
  m[12] = pose[12] - 1.7 * s; m[13] = pose[13] - 0.65; m[14] = pose[14] - 1.7 * c;
  return m;
}

// Transform a target ray into a rigid panel's local coordinates.
export function panelIntersection(ray, panel, width = 1.28, height = 0.39) {
  const delta = [ray[12] - panel[12], ray[13] - panel[13], ray[14] - panel[14]];
  const local = v => [0, 4, 8].map(i => panel[i] * v[0] + panel[i + 1] * v[1] + panel[i + 2] * v[2]);
  const origin = local(delta), direction = local([-ray[8], -ray[9], -ray[10]]);
  if (direction[2] >= -0.00001 || origin[2] <= 0) return null;
  const distance = -origin[2] / direction[2];
  const x = origin[0] + distance * direction[0], y = origin[1] + distance * direction[1];
  return { x: (x / width + 0.5) * 1024, y: (0.5 - y / height) * 312, distance,
    inside: Math.abs(x) <= width / 2 && Math.abs(y) <= height / 2 };
}

export function seekTarget(time, delta, duration) {
  return Math.max(0, Math.min(Math.max(0, duration - 0.01), time + delta));
}

export function thumbstickDirection(axes, latched) {
  const x = axes[2] || 0;
  if (Math.abs(x) < 0.25) return { latched: false, step: 0 };
  if (!latched && Math.abs(x) > 0.65) return { latched: true, step: Math.sign(x) * 10 };
  return { latched, step: 0 };
}
