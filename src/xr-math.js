export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function transform(m, p, direction = false) {
  return [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + (direction ? 0 : m[12 + i]));
}

const PITCH_DEADZONE = 15 * Math.PI / 180;
const MAX_PITCH_UP = 85 * Math.PI / 180;
const MAX_PITCH_DOWN = -80 * Math.PI / 180;

// Extract viewer yaw and recliner/bed pitch (clamped, with a +/-15 deg upright horizon deadzone).
export function gazeAngles(pose) {
  const horiz = Math.hypot(pose[8], pose[10]);
  // When looking nearly straight up/down, fall back to the viewer's up-vector horizontal projection.
  const yaw = horiz > 0.05
    ? Math.atan2(pose[8], pose[10])
    : Math.atan2(pose[9] < 0 ? pose[4] : -pose[4], pose[9] < 0 ? pose[6] : -pose[6]);
  const rawPitch = Math.atan2(-pose[9], horiz);
  const pitch = Math.abs(rawPitch) < PITCH_DEADZONE
    ? 0
    : Math.max(MAX_PITCH_DOWN, Math.min(MAX_PITCH_UP, rawPitch));
  return { yaw, pitch };
}

// Build a panel anchor 1.7 m along the viewer's gaze and 0.65 m perpendicularly below it, tilted 20 deg back.
// When upright (pitch === 0), this matches the exact horizontal horizon-locked placement.
export function anchorMatrix(pose) {
  const { yaw, pitch } = gazeAngles(pose);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const tilt = 20 * Math.PI / 180;
  // Basis = Ry(yaw) * Rx(pitch - tilt): tilts top of panel back 20 deg toward the viewer's eyes
  // at any pitch (when pitch === 0, this reduces identically to Ry(yaw) * Rx(-tilt)).
  const a = pitch - tilt, ca = Math.cos(a), sa = Math.sin(a);
  const m = identity();
  m[0] = cy;       m[1] = 0;   m[2] = -sy;
  m[4] = sy * sa;  m[5] = ca;  m[6] = cy * sa;
  m[8] = sy * ca;  m[9] = -sa; m[10] = cy * ca;
  // Position = eye + Ry(yaw) * Rx(pitch) * (0, -0.65, -1.7)
  const localY = -0.65, localZ = -1.7;
  const ryY = localY * cp - localZ * sp;
  const ryZ = localY * sp + localZ * cp;
  m[12] = pose[12] + ryZ * sy;
  m[13] = pose[13] + ryY;
  m[14] = pose[14] + ryZ * cy;
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

export function thumbstickVertical(axes, latched) {
  // xr-standard axes[3]: negative is stick UP, positive is stick DOWN.
  const y = axes[3] || 0;
  if (Math.abs(y) < 0.25) return { latched: false, step: 0 };
  if (!latched && Math.abs(y) > 0.65) return { latched: true, step: y < 0 ? 1 : -1 };
  return { latched, step: 0 };
}
