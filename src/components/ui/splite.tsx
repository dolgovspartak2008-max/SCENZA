import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Application, SPEObject } from '@splinetool/runtime';
import { RotateCcw } from 'lucide-react';
import { useMotionActivity } from './use-motion-activity';
import { BUBBLE_AT, FINAL_POSE, GREETING_SECONDS, JOINT_PATHS, JOINTS, greetingPose, wristLag } from './robot-greeting';
import type { Euler, Joint, Pose } from './robot-greeting';

const robotScene = 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode';
// The scene asks for the full device pixel ratio (up to 3 on phones = 9x the pixels). Above 1.5 the glowing robot looks the same,
// so the ratio is capped once for every Spline instance; animation, lighting and cursor tracking are untouched.
const MAX_PIXEL_RATIO = 1.5;
type PixelRatioPatch = { _getPixelRatio?: (mode: number) => number; __scenzaPixelRatio?: boolean };
const loadSpline = () => Promise.all([import('@splinetool/runtime'), import('@splinetool/react-spline')]).then(([runtime, spline]) => {
  const prototype = runtime.Application.prototype as unknown as PixelRatioPatch;
  const original = prototype._getPixelRatio;
  if (typeof original === 'function' && !prototype.__scenzaPixelRatio) {
    prototype._getPixelRatio = function (this: unknown, mode: number) { return Math.min(original.call(this, mode) || 1, MAX_PIXEL_RATIO); };
    prototype.__scenzaPixelRatio = true;
  }
  return spline;
});
// Start the runtime chunk and the scene download as soon as the landing module loads, in parallel with the rest of the page.
const splineModule = typeof window === 'undefined' ? null : loadSpline();
if (splineModule && !document.querySelector(`link[href="${robotScene}"]`)) {
  for (const [rel, href] of [['preconnect', 'https://prod.spline.design'], ['preload', robotScene]]) {
    const link = document.createElement('link');
    link.rel = rel; link.href = href; link.crossOrigin = 'anonymous';
    if (rel === 'preload') link.as = 'fetch';
    document.head.append(link);
  }
}
const Spline = lazy(() => splineModule ?? loadSpline());

// The greeting plays once per page load: remounts, language switches and returning to the tab keep the final pose.
let greetedThisLoad = false;

/** The parts of the runtime's scene node the rig needs (Spline does not expose them publicly). */
type SceneNode = { rotation: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; updateMatrix(...args: unknown[]): unknown; matrixWorldNeedsUpdate?: boolean };
type Rig = { read(): Pose; apply(pose: Pose): void; dispose(): void };

/**
 * Takes over the arms, torso and head of the robot. The scene's own idle loop and cursor look-at keep writing these joints,
 * so the chosen rotation is re-applied whenever Spline rebuilds a joint's matrix: the greeting and the final pose always win.
 * Returns null when the scene does not have the expected rig, so the page never fakes a wave with a transform of the whole image.
 */
function attachRig(app: Application): Rig | null {
  const objects = app.getAllObjects();
  const byId = new Map(objects.map(object => [object.uuid, object]));
  const pathOf = (object: SPEObject) => {
    const names: string[] = [];
    for (let current: SPEObject | undefined = object; current; current = byId.get((current as SPEObject & { parentUuid?: string }).parentUuid ?? '')) names.unshift(current.name);
    return names.join('/');
  };
  const byPath = new Map(objects.map(object => [pathOf(object), object]));
  const findEntity = (app as unknown as { _findEntity?: (uuid: string) => unknown })._findEntity;
  if (typeof findEntity !== 'function') return null;
  const nodes = {} as Record<Joint, SceneNode>;
  for (const joint of JOINTS) {
    const object = byPath.get(JOINT_PATHS[joint]);
    const node = object ? findEntity.call(app, object.uuid) as SceneNode | undefined : undefined;
    if (!node || typeof node.updateMatrix !== 'function' || typeof node.rotation?.set !== 'function') return null;
    nodes[joint] = node;
  }
  const held = new Map<Joint, Euler>();
  const originals = new Map<Joint, SceneNode['updateMatrix']>();
  for (const joint of JOINTS) {
    const node = nodes[joint], original = node.updateMatrix;
    originals.set(joint, original);
    node.updateMatrix = function (this: SceneNode, ...args: unknown[]) {
      const rotation = held.get(joint);
      if (rotation) this.rotation.set(rotation[0], rotation[1], rotation[2]);
      return original.apply(this, args);
    };
  }
  const requestRender = (app as unknown as { requestRender?: () => void }).requestRender;
  return {
    read: () => Object.fromEntries(JOINTS.map(joint => { const { x, y, z } = nodes[joint].rotation; return [joint, [x, y, z]]; })) as unknown as Pose,
    apply(pose) {
      for (const joint of JOINTS) {
        const rotation = pose[joint], node = nodes[joint];
        held.set(joint, rotation);
        node.rotation.set(rotation[0], rotation[1], rotation[2]);
        node.updateMatrix();
        node.matrixWorldNeedsUpdate = true;
      }
      requestRender?.call(app);
    },
    dispose() { for (const joint of JOINTS) nodes[joint].updateMatrix = originals.get(joint)!; held.clear(); },
  };
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

type CanvasProps = { active: boolean; start: boolean; reduced: boolean; onReady: () => void; onSpeak: () => void };
function RobotCanvas({ active, start, reduced, onReady, onSpeak }: CanvasProps) {
  const [app, setApp] = useState<Application | null>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const speak = useRef(onSpeak);
  speak.current = onSpeak;

  const onLoad = useCallback((application: Application) => {
    // React StrictMode can finish loading an already disposed Spline instance.
    if (!application.findObjectByName('Bot')) return;
    application.setBackgroundColor('transparent');
    const light = application.findObjectByName('Point Light');
    if (light) light.color = '#b7f5e5';
    const controls = attachRig(application);
    if (!controls) console.warn('SCENZA: the robot scene has no arm rig; the greeting is shown without the wave.');
    setRig(controls);
    setApp(application);
    onReady();
  }, [onReady]);

  useEffect(() => () => rig?.dispose(), [rig]);

  // Before the loader is gone nothing plays. Afterwards the whole sequence runs once, then the robot holds its final pose.
  useEffect(() => {
    if (!app || !start) return;
    if (!rig) { const timer = window.setTimeout(() => speak.current(), reduced || greetedThisLoad ? 0 : BUBBLE_AT * 1000); return () => clearTimeout(timer); }
    if (reduced || greetedThisLoad) { rig.apply(FINAL_POSE); speak.current(); greetedThisLoad = true; return; }
    const from = rig.read();
    let elapsed = 0, last = performance.now(), frame = 0, spoke = false;
    const tick = (now: number) => {
      // Time only moves while the robot is on screen; a hidden tab or a scroll away pauses the greeting instead of skipping it.
      if (activeRef.current) elapsed += Math.min(now - last, 50) / 1000;
      last = now;
      if (!spoke && elapsed >= BUBBLE_AT) { spoke = true; speak.current(); }
      if (elapsed >= GREETING_SECONDS) { rig.apply(FINAL_POSE); greetedThisLoad = true; return; }
      const pose = greetingPose(elapsed, from);
      const hand = pose.handR;
      rig.apply({ ...pose, handR: [hand[0], hand[1], hand[2] + wristLag(elapsed, from)] });
      frame = requestAnimationFrame(tick);
    };
    rig.apply(from);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [app, rig, start, reduced]);

  // Spline renders only while the robot is visible. With reduced motion it draws the still pose and then stops.
  useEffect(() => {
    if (!app) return;
    if (reduced) {
      if (!start) return;
      let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => app.stop()); });
      return () => cancelAnimationFrame(frame);
    }
    if (active) app.play();
    else app.stop();
  }, [active, app, reduced, start]);

  return <Spline scene={robotScene} onLoad={onLoad} className="scenza-robot-canvas" />;
}

export function SplineScene({ language = 'ru', greeting, start = true, onSettled }: { language?: 'ru' | 'en'; greeting: string; start?: boolean; onSettled?: () => void }) {
  const { ref, active, reduced, inView, visible } = useMotionActivity<HTMLDivElement>();
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(greetedThisLoad);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);
  const onSpeak = useCallback(() => setSpeaking(true), []);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const ru = language === 'ru';
  const retry = () => { setReady(false); setFailed(false); setAttempt(value => value + 1); };

  // Tell the page loader the hero is ready (or has failed) so it can close; the greeting waits for it to be gone.
  useEffect(() => {
    if (!ready && !failed) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => settled.current?.());
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, failed]);

  // If the scene cannot load, the greeting still appears once the page is shown.
  useEffect(() => { if (failed && start) setSpeaking(true); }, [failed, start]);

  return <div ref={ref} className="scenza-hero-robot" data-ready={ready && start}>
    <div className="scenza-robot-spotlight" aria-hidden="true" />
    <SceneBoundary key={attempt} onError={onError} fallback={
      <div className="scenza-robot-status" role="status">
        <p>{ru ? 'Не удалось загрузить 3D-робота' : 'Could not load the 3D robot'}</p>
        <button type="button" className="scenza-robot-control" onClick={retry}><RotateCcw size={16} />{ru ? 'Попробовать снова' : 'Try again'}</button>
      </div>
    }>
      {!ready && start && <div className="scenza-robot-status" role="status" aria-label={ru ? 'Подготовка сцены' : 'Preparing the scene'}><span className="scenza-robot-loader" aria-hidden="true" /></div>}
      <div className="scenza-robot-scene" role="img" aria-label={ru ? '3D-робот SCENZA машет рукой и приветствует вас' : 'The SCENZA 3D robot waves hello'}>
        <Suspense fallback={null}><RobotCanvas active={active || (reduced && inView && visible)} start={start} reduced={reduced} onReady={onReady} onSpeak={onSpeak} /></Suspense>
      </div>
    </SceneBoundary>
    <p className="scenza-robot-speech" data-visible={speaking} aria-hidden="true">{greeting}</p>
    <p className="sr-only" aria-live="polite">{speaking ? greeting : ''}</p>
  </div>;
}
