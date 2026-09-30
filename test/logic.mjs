import * as THREE from 'three';
import { MotionTracker } from '../src/tracking/MotionTracker.js';
import { GestureEngine } from '../src/tracking/GestureEngine.js';
import { ViewMapper } from '../src/core/camera.js';
import { ObjectController } from '../src/interaction/ObjectController.js';
import { TwoHandController } from '../src/interaction/TwoHandController.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const cam = { fov: 42, position: { z: 7.2 } };
const mapper = new ViewMapper(cam);
mapper.update(1280, 720, 1280, 720);

// ---- synthetic hand ----
const P = (x, y) => ({ x, y, z: 0 });
function hand({ ox = 0, oy = 0, fingers = [1, 1, 1, 1], thumb = 'out', pinch = false }) {
  const lm = new Array(21);
  lm[0] = P(0.5, 0.8);
  const mcp = [[0.46, 0.68], [0.5, 0.66], [0.54, 0.68], [0.58, 0.71]];
  const base = [5, 9, 13, 17];
  fingers.forEach((e, f) => {
    const [mx, my] = mcp[f], b = base[f];
    lm[b] = P(mx, my);
    lm[b + 1] = P(mx, my - 0.05);
    if (e) { lm[b + 2] = P(mx, my - 0.085); lm[b + 3] = P(mx, my - 0.115); }
    else { lm[b + 2] = P(mx, my - 0.02); lm[b + 3] = P(mx, my + 0.0); }
  });
  lm[1] = P(0.45, 0.77); lm[2] = P(0.42, 0.74);
  if (thumb === 'out') { lm[3] = P(0.39, 0.71); lm[4] = P(0.36, 0.69); }
  else if (thumb === 'up') { lm[3] = P(0.41, 0.68); lm[4] = P(0.41, 0.6); }
  else { lm[3] = P(0.47, 0.74); lm[4] = P(0.53, 0.70); }
  if (pinch) { lm[3] = P(0.42, 0.68); lm[4] = P(0.44, 0.61); lm[6] = P(0.45, 0.63); lm[7] = P(0.445, 0.615); lm[8] = P(0.44, 0.60); }
  return lm.map((p) => ({ x: p.x + ox, y: p.y + oy, z: 0 }));
}
const POSES = {
  OPEN_PALM: { fingers: [1, 1, 1, 1], thumb: 'out' },
  FIST: { fingers: [0, 0, 0, 0], thumb: 'in' },
  POINT: { fingers: [1, 0, 0, 0], thumb: 'in' },
  PEACE: { fingers: [1, 1, 0, 0], thumb: 'in' },
  THUMBS_UP: { fingers: [0, 0, 0, 0], thumb: 'up' },
  PINCH: { fingers: [1, 0, 0, 0], thumb: 'out', pinch: true }
};

function run(pose, frames = 12, hz = 25) {
  const mt = new MotionTracker(mapper), ge = new GestureEngine(mapper);
  const ev = []; ge.on('gesture', (e) => ev.push(e.to));
  ge.on('pinchstart', () => ev.push('pinchstart'));
  let t = 1000;
  for (let i = 0; i < frames; i++) {
    t += 1000 / hz;
    const up = mt.ingest({ landmarks: [hand(pose)], handedness: [] }, t);
    for (const h of up) ge.detect(h, t, {});
    mt.update(1 / 60, t);
  }
  return { h: mt.hands[0], ev };
}

for (const [name, pose] of Object.entries(POSES)) {
  const { h } = run(pose);
  const shown = name === 'PINCH' ? (h.g.pinch ? 'PINCH' : h.g.current) : h.g.current;
  ok(shown === name, `${name} classified as ${shown} (ext=${h.ext.map((v) => v.toFixed(2)).join(',')} pinchRatio=${h.pinchRatio.toFixed(2)})`);
}

// stability: a single-frame glitch must not change gesture
{
  const mt = new MotionTracker(mapper), ge = new GestureEngine(mapper);
  const changes = []; ge.on('gesture', (e) => changes.push(e.to));
  let t = 1000;
  const seq = [...Array(10).fill('OPEN_PALM'), 'FIST', ...Array(6).fill('OPEN_PALM')];
  for (const s of seq) { t += 40; for (const h of mt.ingest({ landmarks: [hand(POSES[s])], handedness: [] }, t)) ge.detect(h, t, {}); }
  ok(changes.join() === 'OPEN_PALM', `single-frame glitch ignored, changes=[${changes}]`);
}

// pinch hysteresis / release event
{
  const mt = new MotionTracker(mapper), ge = new GestureEngine(mapper);
  const ev = []; ge.on('pinchstart', () => ev.push('start')); ge.on('pinchrelease', (e) => ev.push('release'));
  let t = 1000;
  for (let i = 0; i < 8; i++) { t += 40; for (const h of mt.ingest({ landmarks: [hand(POSES.PINCH)], handedness: [] }, t)) ge.detect(h, t, {}); }
  for (let i = 0; i < 8; i++) { t += 40; for (const h of mt.ingest({ landmarks: [hand(POSES.OPEN_PALM)], handedness: [] }, t)) ge.detect(h, t, {}); }
  ok(ev.join() === 'start,release', `pinch start/release once each: [${ev}]`);
}

// swipe: fast move right triggers exactly once
{
  const mt = new MotionTracker(mapper), ge = new GestureEngine(mapper);
  const sw = []; ge.on('swipe', (e) => sw.push(e.dir));
  let t = 1000;
  for (let i = 0; i < 6; i++) { t += 40; for (const h of mt.ingest({ landmarks: [hand({ ...POSES.OPEN_PALM, ox: -0.25 })], handedness: [] }, t)) ge.detect(h, t, {}); mt.update(0.04, t); }
  for (let i = 0; i < 8; i++) { t += 40; for (const h of mt.ingest({ landmarks: [hand({ ...POSES.OPEN_PALM, ox: -0.25 + i * 0.08 })], handedness: [] }, t)) ge.detect(h, t, {}); mt.update(0.04, t); }
  ok(sw.join() === 'LEFT' || sw.join() === 'RIGHT', `swipe fired once: [${sw}]`);
  ok(sw[0] === 'LEFT', `video-space +x motion appears as screen LEFT because the view is mirrored (got ${sw[0]})`);
}

// slow move must NOT swipe
{
  const mt = new MotionTracker(mapper), ge = new GestureEngine(mapper);
  const sw = []; ge.on('swipe', (e) => sw.push(e.dir));
  let t = 1000;
  for (let i = 0; i < 40; i++) { t += 40; for (const h of mt.ingest({ landmarks: [hand({ ...POSES.OPEN_PALM, ox: i * 0.006 })], handedness: [] }, t)) ge.detect(h, t, {}); mt.update(0.04, t); }
  ok(sw.length === 0, 'slow movement does not trigger swipe');
}

// two-hand: scale relative + continuous rotation across +-PI
{
  const c = new ObjectController(); const th = new TwoHandController(c);
  const mk = (x, y, s = 100) => ({ palm: new THREE.Vector3(x, y, 0), palmSize: s });
  let L = mk(-1, 0), R = mk(1, 0);
  th.update(1 / 60, L, R);
  for (let i = 0; i < 60; i++) { L = mk(-2, 0); R = mk(2, 0); th.update(1 / 60, L, R); }
  ok(Math.abs(c.targetScale - 2) < 0.05, `hands 2x apart -> scale ${c.targetScale.toFixed(2)} (~2)`);
  for (let i = 0; i < 60; i++) { L = mk(-1, 0); R = mk(1, 0); th.update(1 / 60, L, R); }
  ok(Math.abs(c.targetScale - 1) < 0.05, `hands back together -> scale ${c.targetScale.toFixed(2)} (~1)`);
  // rotate through the atan2 wrap point: 170deg -> 190deg
  th.active = false; c.targetQuat.identity();
  const at = (deg) => { const r = deg * Math.PI / 180; return [mk(-Math.cos(r), -Math.sin(r)), mk(Math.cos(r), Math.sin(r))]; };
  let [a, b] = at(170); th.update(1 / 60, a, b);
  for (let d = 171; d <= 190; d++) { [a, b] = at(d); th.update(1 / 60, a, b); }
  const e = new THREE.Euler().setFromQuaternion(c.targetQuat);
  ok(Math.abs(THREE.MathUtils.radToDeg(e.z) - 20) < 3, `rotation across atan2 wrap = ${THREE.MathUtils.radToDeg(e.z).toFixed(1)}deg (expected ~20, no flip)`);
}

// physics: inertia, overshoot, settle
{
  const c = new ObjectController();
  c.params = { k: 34, zeta: 0.52, throwDamp: 0.9, maxSpeed: 16 };
  c.setTarget(new THREE.Vector3(3, 1, 0));
  let maxX = 0;
  for (let i = 0; i < 60 * 4; i++) { c.update(1 / 60); maxX = Math.max(maxX, c.pos.x); }
  ok(Math.abs(c.pos.x - 3) < 0.02 && maxX > 3.0, `spring settles at target (x=${c.pos.x.toFixed(3)}) with overshoot (max ${maxX.toFixed(2)})`);
  c.bounds.x = 50; c.fling(new THREE.Vector3(6, 0, 0), 0.6);
  const x0 = c.pos.x; for (let i = 0; i < 20; i++) c.update(1 / 60);
  ok(c.pos.x > x0 + 0.8, 'fling coasts by inertia (decoupled from hand)');
  c.spin(new THREE.Vector3(0, 6, 0)); for (let i = 0; i < 60; i++) c.update(1 / 60);
  ok(c.quat.angleTo(new THREE.Quaternion()) > 0.5, 'spin impulse rotates object with momentum');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL LOGIC TESTS PASSED');
process.exit(fails ? 1 : 0);
