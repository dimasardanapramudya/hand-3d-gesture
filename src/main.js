import * as THREE from 'three';
import { createRenderer, createScene, fitRenderer } from './core/renderer.js';
import { createCamera, ViewMapper } from './core/camera.js';
import { startWebcam } from './core/webcam.js';
import { HandTracker } from './tracking/HandTracker.js';
import { MotionTracker } from './tracking/MotionTracker.js';
import { GestureEngine, GESTURE_LABEL } from './tracking/GestureEngine.js';
import { ObjectController } from './interaction/ObjectController.js';
import { HandController } from './interaction/HandController.js';
import { ObjectManager } from './objects/ObjectManager.js';
import { ParticleSystem } from './effects/ParticleSystem.js';
import { HandSkeleton } from './effects/HandSkeleton.js';
import { MotionTrail } from './effects/MotionTrail.js';
import { InteractionFX } from './effects/InteractionFX.js';
import { HoloCube } from './effects/HoloCube.js';
import { HUD } from './ui/HUD.js';
import { easeOutBack } from './utils/math.js';

const video = document.getElementById('webcam');
const canvas = document.getElementById('three');
const hud = new HUD();

// ---------- fault isolation: one failing effect never kills the app ----------
const errCount = {};
const disabled = new Set();
function safe(name, fn, onDisable) {
  if (disabled.has(name)) return;
  try { fn(); } catch (e) {
    errCount[name] = (errCount[name] || 0) + 1;
    if (errCount[name] === 1) console.error(`[${name}]`, e);
    if (errCount[name] >= 5) { disabled.add(name); onDisable?.(); hud.toast(`Efek "${name}" dinonaktifkan karena error.`); }
  }
}

// ---------- core ----------
let renderer, scene;
try {
  renderer = createRenderer(canvas);
  scene = createScene(renderer);
} catch (e) {
  console.error(e);
  hud.setTracking('WEBGL ERROR', 'err');
  hud.toast('WebGL tidak dapat dibuat: ' + e.message, 0, 'error');
  throw e;
}
const camera = createCamera();
const mapper = new ViewMapper(camera);
const pr = renderer.getPixelRatio();

const particles = new ParticleSystem(700, pr);
const cube = new HoloCube(3.4);
const skeleton = new HandSkeleton(pr);
const trails = new MotionTrail();
const fx = new InteractionFX();
scene.add(cube.root, particles.points, trails.group, skeleton.group, fx.group);

const ctrl = new ObjectController();
const motion = new MotionTracker(mapper);
const gestures = new GestureEngine(mapper);
const tracker = new HandTracker(video);
const manager = new ObjectManager(scene, {
  particles, fx, cube,
  maxAniso: renderer.capabilities.getMaxAnisotropy(),
  onChange: (b) => hud.setObject(b.label),
  onError: (m) => hud.toast(m, 7000, 'error')
});
const hc = new HandController({ ctrl, manager, gestures, motion, particles, fx, cube });

// ---------- resize ----------
function resize() {
  fitRenderer(renderer, camera);
  const p = renderer.getPixelRatio();
  particles.setPixelRatio(p); skeleton.setPixelRatio(p);
}
window.addEventListener('resize', resize);

// ---------- keyboard fallback ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ('123r'.includes(k) && k.length === 1) peekUntil = performance.now() + PEEK_MS;
  if (k === '1') manager.switchTo('butterfly');
  else if (k === '2') manager.switchTo('planet');
  else if (k === '3') manager.switchTo('robot');
  else if (k === 'r') {
    ctrl.reset(); hc.anchor.set(0, 0, 0);
    Object.values(manager.behaviors).forEach((b) => b.reset());
    cube.kick(0.6); fx.shock(ctrl.pos, 0x9fd0ff, 3.5, 0.7);
  } else if (k === 'd') hud.toggleDebug();
  else if (k === 'h') skeleton.visible = !skeleton.visible;
});

// ---------- loop ----------
const ctx = {
  dt: 0, t: 0, vel: ctrl.vel, speed: 0, handVel: new THREE.Vector3(), handSpeed: 0, grabbed: false,
  twoHands: false, particles, pos: ctrl.pos, scale: 1, ctrl, gesture: 'NONE'
};
const accent = new THREE.Color();
let last = performance.now(), fps = 60, debugAcc = 0, trackState = 'INITIALIZING';
let camOk = false, camFailed = false;
// Presence: object + cube exist only while a hand is tracked (pop in / pop out)
let presence = 0, shown = false, hideTimer = 0, peekUntil = 0;
const HIDE_GRACE = 0.6;   // seconds a lost hand is tolerated before the object disappears
const PEEK_MS = 5000;     // keyboard 1/2/3/R shows the object for a few seconds (testing)

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  fps += (1 / dt - fps) * 0.08;
  const t = now / 1000;

  // viewport <-> video mapping (kept in sync with object-fit: cover)
  if (mapper.update(window.innerWidth, window.innerHeight, video.videoWidth, video.videoHeight)) {
    ctrl.bounds.x = Math.max(1, mapper.halfW - 0.7);
    ctrl.bounds.y = Math.max(1, mapper.halfH - 0.7);
  }

  // 1) tracking (~25 FPS, adaptive)
  safe('tracking', () => {
    const res = tracker.detect(now);
    if (!res) return;
    const updated = motion.ingest(res, now);
    const two = updated.length >= 2 || motion.active().length >= 2;
    for (const h of updated) gestures.detect(h, now, { twoHands: two });
  });

  // 2) hands at 60 FPS
  motion.update(dt, now);
  for (const h of motion.hands) gestures.frame(h, now);
  const hands = motion.hands;
  const active = motion.active();

  // 2b) presence: summon the object at the hand, dismiss it when the hand is gone
  const alwaysShow = tracker.failed || camFailed;           // no tracking -> keyboard mode stays visible
  const wantShow = active.length > 0 || alwaysShow || now < peekUntil;
  hideTimer = wantShow ? 0 : hideTimer + dt;
  const show = wantShow || hideTimer < HIDE_GRACE;
  if (show && !shown) {
    shown = true;
    const p = active[0] ? active[0].palm : { x: 0, y: 0 };
    ctrl.pos.set(p.x, p.y, 0); ctrl.target.set(p.x, p.y, 0); ctrl.vel.set(0, 0, 0);
    safe('spawn', () => {
      particles.burst(ctrl.pos, 60, 3.2, 0x9fd0ff, { life: 0.9, size: 9 });
      fx.shock(ctrl.pos, 0x9fe8ff, 3.6, 0.8);
      cube.kick(0.8);
      manager.current?.onEnter?.({});
    });
  } else if (!show && shown) {
    shown = false;
    safe('despawn', () => particles.burst(ctrl.pos, 40, 2.2, 0x9fd0ff, { life: 0.7, size: 8 }));
  }
  presence = Math.min(1, Math.max(0, presence + (show ? dt / 0.5 : -dt / 0.35)));
  const ps = presence >= 1 ? 1 : easeOutBack(presence);

  // 3) interaction + physics
  ctx.dt = dt; ctx.t = t;
  ctx.speed = ctrl.vel.length(); ctx.scale = ctrl.scale; ctx.grabbed = ctrl.grabbed;
  const prim = hc.primary;
  ctx.handSpeed = prim ? prim.speed : 0;
  if (prim) ctx.handVel.copy(prim.velocity); else ctx.handVel.set(0, 0, 0);
  safe('interaction', () => hc.update(dt, now, ctx));
  if (manager.current) ctrl.params = manager.current.physics;
  ctrl.update(dt);
  hc.postUpdate();

  // 4) objects
  manager.stage.position.copy(ctrl.pos);
  manager.stage.quaternion.copy(ctrl.quat);
  manager.stage.visible = presence > 0.01;
  manager.stage.scale.setScalar(Math.max(0.001, ctrl.scale * ctrl.mul * ps));
  safe('objects', () => manager.update(dt, t, ctx));

  // 5) effects
  const accentColor = manager.current ? manager.current.accent : accent.set(0x5aa8ff);
  safe('cube', () => cube.update(dt, {
    pos: ctrl.pos, scale: ctrl.scale * ctrl.mul, quat: ctrl.quat, grab: ctrl.grab, speed: ctx.speed,
    angular: ctrl.angularSpeed, scaleRate: ctrl.scaleVel, accent: accentColor, squeeze: 1 - ctrl.mul, presence: ps
  }), () => { cube.root.visible = false; });
  if (!disabled.has('cube')) cube.root.visible = presence > 0.01;
  safe('skeleton', () => skeleton.update(dt, hands), () => { skeleton.group.visible = false; });
  safe('trails', () => trails.update(dt, now, hands), () => { trails.group.visible = false; });
  safe('fx', () => fx.update(dt, hands), () => { fx.group.visible = false; });
  safe('particles', () => particles.update(dt), () => { particles.points.visible = false; });

  // 6) HUD
  updateHud(active, prim);
  debugAcc += dt;
  if (debugAcc > 0.25) { debugAcc = 0; updateDebug(active, prim); }

  // 7) render (always, even if everything else failed)
  try { renderer.render(scene, camera); }
  catch (e) { if (!frame.err) { frame.err = true; console.error('render error', e); } }
}

function gestureText(active) {
  if (!active.length) return '—';
  return active.map((h) => {
    const g = h.g;
    if (g?.pinch) return g.pinchHeld ? 'PINCH HOLD' : 'PINCH';
    return GESTURE_LABEL[g?.current || 'NONE'];
  }).join('  +  ');
}
function updateHud(active) {
  if (tracker.failed) hud.setTracking('TRACKING OFF · KEYBOARD MODE', 'err');
  else if (!camOk) hud.setTracking(trackState, 'warn');
  else if (!tracker.ready) hud.setTracking('LOADING MODEL', 'warn');
  else hud.setTracking(active.length ? `${active.length} HAND${active.length > 1 ? 'S' : ''}` : 'SEARCHING', active.length ? 'ok' : 'warn');
  hud.setGesture(gestureText(active));
  if (hc.lastSwipe && performance.now() - hc.lastSwipe.t < 700) hud.setGesture(`SWIPE ${hc.lastSwipe.dir}`);
}
function updateDebug(active, prim) {
  const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-');
  const e = new THREE.Euler().setFromQuaternion(ctrl.quat);
  hud.setDebug([
    `FPS            ${f(fps, 0)}`,
    `MediaPipe FPS  ${f(tracker.fps, 0)}  (${f(tracker.avgMs, 0)} ms, ${tracker.delegate || '-'})`,
    `Hands          ${active.length}   mode ${hc.mode}`,
    `Gesture        ${active.map((h) => h.g?.current || '-').join(' / ') || '-'}`,
    `Pinch dist     ${prim ? f(prim.pinchRatio) : '-'}`,
    `Hand velocity  ${prim ? f(prim.speed) : '-'} u/s`,
    `Openness       ${prim ? f(prim.openness) : '-'}`,
    `Confidence     ${prim ? f(prim.confidence) : '-'}`,
    `Object         ${manager.name}${manager.switching ? ' (switching)' : ''}`,
    `Scale          ${f(ctrl.scale)}`,
    `Rotation (deg) ${f(THREE.MathUtils.radToDeg(e.x), 0)}, ${f(THREE.MathUtils.radToDeg(e.y), 0)}, ${f(THREE.MathUtils.radToDeg(e.z), 0)}`,
    `Particles/draw ${renderer.info.render.calls} calls`
  ].join('\n'));
}

// ---------- boot (each subsystem isolated) ----------
requestAnimationFrame(frame);

(async function boot() {
  const camP = startWebcam(video, (s) => { trackState = s; })
    .then(() => { camOk = true; })
    .catch((e) => {
      console.error(e);
      trackState = 'CAMERA ERROR';
      camFailed = true;
      hud.setTracking('CAMERA ERROR', 'err');
      hud.toast(e.message, 0, 'error');
    });

  const objP = manager.init('butterfly')
    .then(() => manager.prewarm(renderer, scene, camera))
    .catch((e) => hud.toast('Gagal memuat objek 3D: ' + (e.message || e), 0, 'error'));

  await camP;
  if (camOk) {
    try { await tracker.init((s) => { trackState = s; }); }
    catch (e) {
      console.error(e);
      tracker.failed = true;
      hud.toast('MediaPipe gagal dimuat (' + (e.message || e) + '). Mode keyboard 1/2/3 tetap aktif.', 0, 'error');
    }
  }
  await objP;
})();

// Test / debugging hook (also lets you inspect state from the console)
window.__app = { get presence() { return presence; }, tracker, motion, gestures, manager, ctrl, hc, cube, particles, skeleton, renderer, scene, camera, mapper, hud };
