import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greetingPose, wristLag, restPose, FINAL_POSE, GREETING_SECONDS, JOINTS } from '../src/components/ui/robot-greeting.ts';

const close = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.every((value, i) => Math.abs(value - b[i]) < eps);

test('the greeting starts from the scene pose and ends exactly in the host pose', () => {
  const from = restPose();
  for (const joint of JOINTS) {
    assert.ok(close(greetingPose(0, from)[joint], from[joint]), joint);
    assert.ok(close(greetingPose(GREETING_SECONDS, from)[joint], FINAL_POSE[joint], 1e-4), joint);
    assert.ok(close(greetingPose(GREETING_SECONDS + 5, from)[joint], FINAL_POSE[joint], 1e-4), `${joint} holds still after the end`);
  }
});

// Angle between two orientations, so Euler wrap-around (π → −π) is not mistaken for a jump.
const quat = ([x, y, z]: readonly number[]) => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
};
const angle = (a: readonly number[], b: readonly number[]) => { const p = quat(a), q = quat(b); return 2 * Math.acos(Math.min(1, Math.abs(p.reduce((sum, value, i) => sum + value * q[i], 0)))); };
// The scene's idle loop swaps the hands between two orientations, so both are possible starting points.
const idleStarts = [restPose(), { ...restPose(), hlR: [0, 0, 0.427], armR: [-0.085, 0, 0], elbR: [0, -0.142, 0], foreR: [-0.89, 0, 0], handR: [0.604, 0.939, 2.475], hlL: [0, 0, 0.427], armL: [-0.085, 0, 0], elbL: [0, -0.142, 0], foreL: [-0.89, 0, 0], handL: [0.604, 0.939, 2.475] }] as const;

test('motion is continuous: no joint turns faster than 7 rad/s (0.12 rad per frame at 60 fps)', () => {
  for (const from of idleStarts) {
    let previous = greetingPose(0, from);
    for (let t = 1 / 60; t <= GREETING_SECONDS + 0.1; t += 1 / 60) {
      const pose = greetingPose(t, from);
      for (const joint of JOINTS) assert.ok(angle(pose[joint], previous[joint]) < 0.12, `${joint} at ${t.toFixed(2)}s`);
      previous = pose;
    }
  }
});

test('the robot waves twice with the elbow and the hand trails the forearm', () => {
  const from = restPose();
  const elbow = (t: number) => greetingPose(t, from).elbR[2];
  let turns = 0, direction = 0;
  for (let t = 1.16; t <= 2.5; t += 0.01) {
    const next = Math.sign(elbow(t + 0.01) - elbow(t));
    if (next && direction && next !== direction) turns++;
    if (next) direction = next;
  }
  assert.ok(turns >= 3 && turns <= 4, `two waves = 3–4 turning points, got ${turns}`);
  assert.ok(greetingPose(1.6, from).hlR[2] > 0.8, 'arm is raised while waving');
  assert.equal(wristLag(0.5, from), 0);
  assert.equal(wristLag(3.5, from), 0);
  assert.ok(Math.abs(wristLag(1.6, from)) > 0.05, 'wrist lags during the swing');
});
