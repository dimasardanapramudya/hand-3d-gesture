import * as THREE from 'three';
import { OneEuro, clamp, damp, unwrapAngle } from '../utils/math.js';

const PALM_IDS = [0, 5, 9, 13, 17];
const FINGERS = [ // mcp, pip, dip, tip
  [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]
];
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * One tracked hand. Two layers of data:
 *  - detection layer (~25 FPS): One-Euro filtered landmarks + derived features
 *  - frame layer (60 FPS): damped display positions + velocity/acceleration
 */
export class Hand {
  constructor(id) {
    this.id = id;
    this.active = false;
    this.visible = 0;
    this.lastSeen = 0;
    this.confidence = 0;
    this.label = '';
    this.detections = 0;
    this.filters = Array.from({ length: 63 }, () => new OneEuro(2.0, 14, 1.0));
    this.lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    this.px = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.target = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.world = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.palmT = new THREE.Vector3();   // filtered palm centre (detection rate)
    this.palm = new THREE.Vector3();    // display palm centre (frame rate)
    this._palmPrev = new THREE.Vector3();
    this._velPrev = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.speed = 0;
    this.pinchPoint = new THREE.Vector3();
    // features
    this.ext = [0, 0, 0, 0, 0];         // thumb..pinky extension 0..1
    this.openness = 0;
    this.pinchRatio = 1;                // thumb-index distance / palm size
    this.palmSize = 100;
    this.thumbUp = 0;
    this.roll = 0;                      // unwrapped hand rotation (rad)
    this.rollRate = 0;
    this.palmYaw = 0;
    this.palmPitch = 0;
    this.facing = 0;
    this.g = null;                      // gesture state (GestureEngine)
    this._snap = true;
  }

  applyDetection(lms, score, label, tMs, mapper) {
    const ts = tMs / 1000;
    if (!this.active) {
      for (const f of this.filters) f.reset();
      this.active = true;
      this._snap = true;
      this.detections = 0;
    }
    for (let i = 0; i < 21; i++) {
      const p = lms[i], l = this.lm[i], f = this.filters;
      l.x = f[i * 3].filter(p.x, ts);
      l.y = f[i * 3 + 1].filter(p.y, ts);
      l.z = f[i * 3 + 2].filter(p.z || 0, ts);
      mapper.toWorld(l.x, l.y, l.z, this.target[i]);
    }
    this.lastSeen = tMs;
    this.confidence = score;
    this.label = label;
    this.detections++;

    this.palmT.set(0, 0, 0);
    for (const id of PALM_IDS) this.palmT.add(this.target[id]);
    this.palmT.multiplyScalar(1 / PALM_IDS.length);

    if (this._snap) {
      for (let i = 0; i < 21; i++) this.world[i].copy(this.target[i]);
      this.palm.copy(this.palmT);
      this._palmPrev.copy(this.palmT);
      this.velocity.set(0, 0, 0);
      this._velPrev.set(0, 0, 0);
      this._snap = false;
      this.roll = NaN;
    }
    this._features(mapper.vw, mapper.vh);
  }

  _features(vw, vh) {
    const px = this.px, lm = this.lm;
    for (let i = 0; i < 21; i++) px[i].set(lm[i].x * vw, lm[i].y * vh, lm[i].z * vw);

    this.palmSize = Math.max(1, px[0].distanceTo(px[9]));
    const ps = this.palmSize;

    // Finger extension: distance ratio + PIP joint angle (robust to foreshortening)
    for (let f = 0; f < 4; f++) {
      const [mcp, pip, , tip] = FINGERS[f];
      const r = px[tip].distanceTo(px[0]) / Math.max(1, px[mcp].distanceTo(px[0]));
      const extR = clamp((r - 1.05) / 0.5, 0, 1);
      _a.subVectors(px[mcp], px[pip]);
      _b.subVectors(px[tip], px[pip]);
      const deg = (_a.angleTo(_b) * 180) / Math.PI;
      const extA = clamp((deg - 105) / 45, 0, 1);
      this.ext[f + 1] = (extR + extA) * 0.5;
    }
    this.ext[0] = clamp((px[4].distanceTo(px[17]) / ps - 0.85) / 0.4, 0, 1);

    _a.subVectors(px[4], px[2]);
    this.thumbUp = clamp((-_a.y / Math.max(1e-3, _a.length()) - 0.35) / 0.45, 0, 1);

    this.openness = (this.ext[1] + this.ext[2] + this.ext[3] + this.ext[4] + 0.5 * this.ext[0]) / 4.5;
    this.pinchRatio = px[4].distanceTo(px[8]) / ps;

    // Continuous roll angle (unwrapped, never flips)
    const v = _a.subVectors(this.target[9], this.target[0]);
    const raw = Math.atan2(v.y, v.x);
    this.roll = Number.isNaN(this.roll) ? raw : unwrapAngle(this.roll, raw);

    // Palm orientation (sign-normalised so it never flips between hands)
    _a.subVectors(px[5], px[0]);
    _b.subVectors(px[17], px[0]);
    _n.crossVectors(_a, _b).normalize();
    if (_n.z < 0) _n.negate();
    this.palmYaw = Math.atan2(_n.x, _n.z);
    this.palmPitch = Math.atan2(_n.y, _n.z);
    this.facing = _n.z;
  }

  updateFrame(dt, nowMs) {
    if (this.active && nowMs - this.lastSeen > 220) this.active = false;
    this.visible = damp(this.visible, this.active ? 1 : 0, this.active ? 14 : 7, dt);
    if (!this.active && this.visible < 0.01) { this.velocity.set(0, 0, 0); this.speed = 0; return; }

    const k = 1 - Math.exp(-32 * dt);
    for (let i = 0; i < 21; i++) this.world[i].lerp(this.target[i], k);

    this.palm.set(0, 0, 0);
    for (const id of PALM_IDS) this.palm.add(this.world[id]);
    this.palm.multiplyScalar(1 / PALM_IDS.length);

    if (this.active) {
      _a.subVectors(this.palm, this._palmPrev).multiplyScalar(1 / dt);
      this.velocity.lerp(_a, 1 - Math.exp(-14 * dt));
      _b.subVectors(this.velocity, this._velPrev).multiplyScalar(1 / dt);
      this.acceleration.lerp(_b, 1 - Math.exp(-8 * dt));
    } else {
      this.velocity.multiplyScalar(Math.exp(-6 * dt));
      this.acceleration.multiplyScalar(0);
    }
    this._palmPrev.copy(this.palm);
    this._velPrev.copy(this.velocity);
    this.speed = this.velocity.length();
    if (this.speed > 0.05) this.direction.copy(this.velocity).multiplyScalar(1 / this.speed);

    this.pinchPoint.addVectors(this.world[4], this.world[8]).multiplyScalar(0.5);
  }
}

/** Owns two hand slots, assigns detections to slots with continuity. */
export class MotionTracker {
  constructor(mapper) {
    this.mapper = mapper;
    this.hands = [new Hand(0), new Hand(1)];
  }

  /** Returns the hands that received a fresh detection. */
  ingest(result, nowMs = performance.now()) {
    const dets = result.landmarks.map((lm, i) => {
      const cat = result.handedness?.[i]?.[0];
      return { lm, score: cat?.score ?? 0.8, label: cat?.categoryName ?? '' };
    });
    const updated = [];
    if (!dets.length) return updated;

    const pairs = [];
    dets.forEach((d, di) => {
      this.hands.forEach((h, hi) => {
        const cost = h.active
          ? Math.hypot(d.lm[0].x - h.lm[0].x, d.lm[0].y - h.lm[0].y)
          : 0.35; // prefer keeping continuity over grabbing an empty slot
        pairs.push({ di, hi, cost });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);
    const usedD = new Set(), usedH = new Set();
    for (const p of pairs) {
      if (usedD.has(p.di) || usedH.has(p.hi)) continue;
      usedD.add(p.di); usedH.add(p.hi);
      const d = dets[p.di];
      this.hands[p.hi].applyDetection(d.lm, d.score, d.label, nowMs, this.mapper);
      updated.push(this.hands[p.hi]);
    }
    return updated;
  }

  update(dt, nowMs) {
    for (const h of this.hands) h.updateFrame(dt, nowMs);
  }

  /** Active hands sorted left -> right on screen. */
  active() {
    return this.hands.filter((h) => h.active).sort((a, b) => a.palm.x - b.palm.x);
  }
}
