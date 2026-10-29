// Greeting choreography for the SCENZA Spline robot (scene kZDDjO5HuC9GJUM2).
// The scene is a real rig: every arm is "Hand LEFT" (shoulder) > arm > elbow > forearm > Hand (mesh),
// the right-hand arm is the "Hand" component and the left one its mirrored "Hand Instance".
// Rotations below are absolute local Euler angles (XYZ), measured on that rig in the browser.
// "R"/"L" mean the robot's arm on the right/left side of the screen.

export type Joint = 'top' | 'head' | 'hlR' | 'armR' | 'elbR' | 'foreR' | 'handR' | 'hlL' | 'armL' | 'elbL' | 'foreL' | 'handL';
export type Euler = readonly [number, number, number];
export type Pose = Record<Joint, Euler>;

const R = 'Bot/Top part/Hand/Hand LEFT', L = 'Bot/Top part/Hand Instance/Hand LEFT';
export const JOINT_PATHS: Record<Joint, string> = {
  top: 'Bot/Top part', head: 'Bot/Top part/Head',
  hlR: R, armR: `${R}/arm`, elbR: `${R}/arm/elbow`, foreR: `${R}/arm/elbow/forearm`, handR: `${R}/arm/elbow/forearm/Hand`,
  hlL: L, armL: `${L}/arm`, elbL: `${L}/arm/elbow`, foreL: `${L}/arm/elbow/forearm`, handL: `${L}/arm/elbow/forearm/Hand`,
};
export const JOINTS = Object.keys(JOINT_PATHS) as Joint[];
const HANDS: readonly Joint[] = ['handR', 'handL'];

/** Whole sequence after the page loader is gone: appear, notice, two waves, settle into the host pose. */
export const GREETING_SECONDS = 4;
/** The speech bubble appears with the first wave. */
export const BUBBLE_AT = 1.15;
const APPEAR_END = 0.6;

// Resting stance used when the scene's idle pose cannot be read.
const REST: Pose = {
  top: [0, 0, 0], head: [0, 0, 0],
  hlR: [0, 0, 0.2], armR: [-0.59, 0, 0], elbR: [0, 0.36, 0], foreR: [0, 0, 0], handR: [2.62, 0.35, 0.62],
  hlL: [0, 0, 0.2], armL: [-0.59, 0, 0], elbL: [0, 0.36, 0], foreL: [0, 0, 0], handL: [2.62, 0.35, 0.62],
};
// Open palm toward the visitor with the forearm upright; solved against the camera for this rig.
const WAVE_HAND: Euler = [2.442, 0.064, 0.154];
/** Host pose: body turned toward the headline, left palm open and up presenting the page, head tilted to the visitor. */
export const FINAL_POSE: Pose = {
  top: [0, -0.18, 0.02], head: [0.07, 0.2, 0.1],
  hlR: [0, 0, 0.12], armR: [-0.45, 0, 0], elbR: [0, 0.36, 0.25], foreR: [0, 0, 0], handR: [2.58, 0.3, 0.55],
  hlL: [0, 0, 0.005], armL: [-1.098, -0.445, 0], elbL: [0, 0.798, 0.063], foreL: [0, 0, 0], handL: [2.822, 0.557, -0.811],
};

type Key = readonly [time: number, value: Euler | 'from'];
// Body channels use smooth Hermite curves; hands are slerped quaternions so they never flip.
const TRACKS: Record<Joint, readonly Key[]> = {
  top: [[0, 'from'], [APPEAR_END, 'from'], [0.74, [0, -0.02, 0.018]], [1.12, [0, 0.08, -0.03]], [1.5, [0, 0.085, -0.02]], [1.86, [0, 0.075, -0.035]], [2.45, [0, 0.08, -0.028]], [3.05, [0, -0.06, 0]], [3.62, [0, -0.19, 0.022]], [GREETING_SECONDS, FINAL_POSE.top]],
  head: [[0, 'from'], [APPEAR_END, 'from'], [0.98, [0.05, 0.05, -0.07]], [1.5, [0.05, 0.06, -0.09]], [2.45, [0.05, 0.06, -0.08]], [3.1, [0.06, 0.12, 0.02]], [3.7, [0.07, 0.205, 0.1]], [GREETING_SECONDS, FINAL_POSE.head]],
  // Shoulder: a small dip before lifting, then it follows each swing a little. The elbow folds first and the forearm
  // turns slightly forward, so the hand rises close to the body instead of sweeping out of the frame.
  hlR: [[0, 'from'], [APPEAR_END, 'from'], [0.72, [0, 0, 0.12]], [0.84, [0, 0, 0.2]], [0.98, [0, 0, 0.6]], [1.14, [0, 0, 0.9]], [1.42, [0, 0, 0.93]], [1.78, [0, 0, 0.87]], [2.1, [0, 0, 0.92]], [2.45, [0, 0, 0.88]], [2.85, [0, 0, 0.3]], [3.15, [0, 0, 0.12]], [GREETING_SECONDS, FINAL_POSE.hlR]],
  armR: [[0, 'from'], [APPEAR_END, 'from'], [0.8, [-0.5, 0, 0]], [1.12, [-0.35, 0, 0]], [2.45, [-0.35, 0, 0]], [3.3, [-0.44, 0, 0]], [GREETING_SECONDS, FINAL_POSE.armR]],
  // Two calm waves from the elbow, the second a little smaller and slower; lowering, the shoulder drops before the forearm unfolds.
  elbR: [[0, 'from'], [0.52, 'from'], [0.8, [0, -0.2, 1.0]], [0.95, [0, -0.05, 1.75]], [1.14, [0, 0.36, 2.0]], [1.42, [0, 0.36, 1.74]], [1.78, [0, 0.36, 2.26]], [2.1, [0, 0.36, 1.78]], [2.45, [0, 0.36, 2.15]], [2.85, [0, 0.2, 2.0]], [3.2, [0, -0.2, 1.6]], [3.55, [0, -0.1, 0.7]], [3.85, [0, 0.3, 0.27]], [GREETING_SECONDS, FINAL_POSE.elbR]],
  // The scene's idle loop also bends the forearms; the poses above were built with them straight. While the arm passes
  // the horizontal on the way up and down, the forearm bends in a little so the hand stays near the body and in frame.
  foreR: [[0, 'from'], [APPEAR_END, 'from'], [0.82, [-0.75, 0, 0]], [1.12, [0, 0, 0]], [2.7, [0, 0, 0]], [3.2, [-0.75, 0, 0]], [3.7, [0, 0, 0]], [GREETING_SECONDS, FINAL_POSE.foreR]],
  foreL: [[0, 'from'], [2.65, 'from'], [3.4, [0, 0, 0]], [GREETING_SECONDS, FINAL_POSE.foreL]],
  handR: [[0, 'from'], [APPEAR_END, 'from'], [1.1, WAVE_HAND], [2.5, WAVE_HAND], [3.6, FINAL_POSE.handR], [GREETING_SECONDS, FINAL_POSE.handR]],
  hlL: [[0, 'from'], [2.65, 'from'], [3.4, [0, 0, 0.06]], [3.75, [0, 0, -0.008]], [GREETING_SECONDS, FINAL_POSE.hlL]],
  armL: [[0, 'from'], [2.65, 'from'], [3.35, [-0.82, -0.3, 0]], [3.72, [-1.12, -0.455, 0]], [GREETING_SECONDS, FINAL_POSE.armL]],
  elbL: [[0, 'from'], [2.7, 'from'], [3.35, [0, 0.62, 0.3]], [3.75, [0, 0.81, 0.055]], [GREETING_SECONDS, FINAL_POSE.elbL]],
  handL: [[0, 'from'], [2.75, 'from'], [3.62, FINAL_POSE.handL], [GREETING_SECONDS, FINAL_POSE.handL]],
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

function hermite(keys: readonly (readonly [number, Euler])[], time: number, axis: number) {
  if (time <= keys[0][0]) return keys[0][1][axis];
  const last = keys.length - 1;
  if (time >= keys[last][0]) return keys[last][1][axis];
  let index = 0;
  while (keys[index + 1][0] < time) index++;
  const [t0, a] = keys[index], [t1, b] = keys[index + 1], span = t1 - t0;
  // Catmull-Rom tangents keep velocity continuous through keys; the first and last keys ease in and out.
  const slope = (i: number) => {
    if (i <= 0 || i >= last) return 0;
    const [tp, p] = keys[i - 1], [tn, n] = keys[i + 1];
    const value = (n[axis] - p[axis]) / (tn - tp);
    // A key between two higher or two lower neighbours is a turning point: stop there instead of overshooting.
    return Math.sign(keys[i][1][axis] - p[axis]) !== Math.sign(n[axis] - keys[i][1][axis]) ? 0 : value;
  };
  const u = (time - t0) / span, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a[axis] + (u3 - 2 * u2 + u) * span * slope(index) + (-2 * u3 + 3 * u2) * b[axis] + (u3 - u2) * span * slope(index + 1);
}

type Quat = [number, number, number, number];
function toQuat([x, y, z]: Euler): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function toEuler([x, y, z, w]: Quat): Euler {
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.min(1, Math.max(-1, m13)));
  return Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), ry, 0];
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [...b];
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const q = a.map((value, i) => value + (target[i] - value) * t) as Quat, length = Math.hypot(...q);
    return q.map(value => value / length) as Quat;
  }
  const angle = Math.acos(dot), sin = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sin, wb = Math.sin(t * angle) / sin;
  return a.map((value, i) => value * wa + target[i] * wb) as Quat;
}
function slerpTrack(keys: readonly (readonly [number, Euler])[], time: number): Euler {
  if (time <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (time >= last[0]) return last[1];
  let index = 0;
  while (keys[index + 1][0] < time) index++;
  const [t0, a] = keys[index], [t1, b] = keys[index + 1];
  return toEuler(slerp(toQuat(a), toQuat(b), smooth(clamp01((time - t0) / (t1 - t0)))));
}

/** Pose at a moment of the greeting, starting from the pose the scene had when the greeting began. */
export function greetingPose(time: number, from: Pose): Pose {
  const pose = {} as Record<Joint, Euler>;
  for (const joint of JOINTS) {
    const keys = TRACKS[joint].map(([t, value]) => [t, value === 'from' ? from[joint] : value] as const);
    pose[joint] = HANDS.includes(joint) ? slerpTrack(keys, time) : [0, 1, 2].map(axis => hermite(keys, time, axis)) as unknown as Euler;
  }
  return pose;
}

/**
 * Secondary motion of the waving hand: it trails the forearm and catches up a moment later.
 * Returns the extra rotation (radians, Euler Z of the hand) for the elbow angle `delay` seconds ago.
 */
export function wristLag(time: number, from: Pose, delay = 0.09, gain = 1.15) {
  if (time < 1.1 || time > 2.75) return 0;
  const elbow = (t: number) => greetingPose(t, from).elbR[2];
  const fade = Math.min(smooth(clamp01((time - 1.1) / 0.2)), smooth(clamp01((2.75 - time) / 0.3)));
  return (elbow(Math.max(0, time - delay)) - elbow(time)) * gain * fade;
}

/** Fallback when the scene's current pose cannot be read. */
export const restPose = (): Pose => ({ ...REST });
