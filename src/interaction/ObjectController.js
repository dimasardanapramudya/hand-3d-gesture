import * as THREE from 'three';
import { clamp } from '../utils/math.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Quaternion();
const _ax = new THREE.Vector3();

/**
 * Spring-damper physics for the object stage: position, scale and rotation each
 * have velocity, so motion has inertia, momentum and friction. Nothing is ever
 * assigned directly from the hand.
 */
export class ObjectController {
  constructor() {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.scale = 1; this.scaleVel = 0; this.targetScale = 1; this.mul = 1; this.mulTarget = 1;
    this.quat = new THREE.Quaternion(); this.targetQuat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3(); // spring-driven
    this.omega = new THREE.Vector3();  // free spin (inertia), integrated into targetQuat
    this.params = { k: 40, zeta: 0.7, throwDamp: 1.3, maxSpeed: 15 };
    this.grabbed = false; this.grab = 0;
    this.throwT = 0; this.rampT = 1;
    this.bounds = { x: 4, y: 2.4 };
  }

  get angularSpeed() { return this.angVel.length() + this.omega.length(); }

  setTarget(v) { this.target.set(v.x, v.y, 0); }
  impulse(v) { this.vel.add(v); }
  /** Decoupled coasting flight for `coast` seconds, then springs back to the hand. */
  fling(v, coast = 0.6) { this.vel.add(v); this.throwT = Math.max(this.throwT, coast); this.rampT = 0; }
  spin(w) { this.omega.add(w); }
  rotateTarget(axis, angle) {
    if (!angle) return;
    _q.setFromAxisAngle(axis, angle);
    this.targetQuat.premultiply(_q).normalize();
  }
  setGrabbed(v) { this.grabbed = v; }

  reset() {
    this.pos.set(0, 0, 0); this.vel.set(0, 0, 0); this.target.set(0, 0, 0);
    this.scale = this.targetScale = 1; this.scaleVel = 0; this.mul = this.mulTarget = 1;
    this.quat.identity(); this.targetQuat.identity(); this.angVel.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.grabbed = false; this.throwT = 0; this.rampT = 1;
  }

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    const P = this.params;
    this.grab += ((this.grabbed ? 1 : 0) - this.grab) * (1 - Math.exp(-12 * dt));

    // ---- position ----
    let k = P.k * (this.grabbed ? 2.4 : 1);
    let c;
    if (this.throwT > 0) { this.throwT -= dt; k = 0; c = P.throwDamp; }
    else {
      if (this.rampT < 1) { this.rampT = Math.min(1, this.rampT + dt / 0.9); k *= this.rampT * this.rampT; }
      const zeta = this.grabbed ? 0.95 : P.zeta;
      c = Math.max(1.4, 2 * zeta * Math.sqrt(k));
    }
    const steps = 2, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.vel.x += ((this.target.x - this.pos.x) * k - this.vel.x * c) * h;
      this.vel.y += ((this.target.y - this.pos.y) * k - this.vel.y * c) * h;
      this.vel.z += ((0 - this.pos.z) * k - this.vel.z * c) * h;
      const sp = this.vel.length();
      if (sp > P.maxSpeed) this.vel.multiplyScalar(P.maxSpeed / sp);
      this.pos.addScaledVector(this.vel, h);
    }
    const bx = this.bounds.x, by = this.bounds.y;
    if (Math.abs(this.pos.x) > bx) { this.pos.x = clamp(this.pos.x, -bx, bx); this.vel.x *= -0.35; }
    if (Math.abs(this.pos.y) > by) { this.pos.y = clamp(this.pos.y, -by, by); this.vel.y *= -0.35; }

    // ---- scale (slightly under-damped -> soft overshoot) ----
    const ks = 55, cs = 2 * 0.62 * Math.sqrt(ks);
    this.scaleVel += ((this.targetScale - this.scale) * ks - this.scaleVel * cs) * dt;
    this.scale += this.scaleVel * dt;
    this.mul += (this.mulTarget - this.mul) * (1 - Math.exp(-10 * dt));

    // ---- rotation: free spin with friction -> target; angular spring -> current ----
    const w = this.omega.length();
    if (w > 1e-4) {
      _q.setFromAxisAngle(_ax.copy(this.omega).normalize(), w * dt);
      this.targetQuat.premultiply(_q).normalize();
      this.omega.multiplyScalar(Math.exp(-1.7 * dt));
    }
    _e.copy(this.targetQuat).multiply(_q.copy(this.quat).invert());
    if (_e.w < 0) { _e.x = -_e.x; _e.y = -_e.y; _e.z = -_e.z; _e.w = -_e.w; }
    const ang = 2 * Math.acos(clamp(_e.w, -1, 1));
    const sinHalf = Math.sqrt(Math.max(0, 1 - _e.w * _e.w));
    if (sinHalf > 1e-5 && ang > 1e-4) {
      _ax.set(_e.x, _e.y, _e.z).multiplyScalar(1 / sinHalf);
      const kr = 60, cr = 2 * 0.8 * Math.sqrt(kr);
      this.angVel.x += (_ax.x * ang * kr - this.angVel.x * cr) * dt;
      this.angVel.y += (_ax.y * ang * kr - this.angVel.y * cr) * dt;
      this.angVel.z += (_ax.z * ang * kr - this.angVel.z * cr) * dt;
    } else this.angVel.multiplyScalar(Math.exp(-8 * dt));
    const av = this.angVel.length();
    if (av > 1e-4) {
      _q.setFromAxisAngle(_ax.copy(this.angVel).normalize(), av * dt);
      this.quat.premultiply(_q).normalize();
    }
  }
}
