// ============================================================
// Math / filtering helpers
// ============================================================

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(e0, e1, x) {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing. lambda ~ 1/timeConstant. */
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

/** Shortest signed difference between two angles (radians). */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Continuous (unwrapped) angle: returns `next` expressed near `prev`. */
export const unwrapAngle = (prev, next) => prev + angleDelta(prev, next);

/** Soft dead-zone: values inside +-dz become 0, outside are shifted (no jump). */
export function deadzone(v, dz) {
  const a = Math.abs(v);
  return a <= dz ? 0 : Math.sign(v) * (a - dz);
}

/**
 * Lossless dead-zone: small deltas accumulate until they exceed `dz`, then the
 * whole accumulated amount is released. Kills jitter (+/- cancels out) without
 * the systematic under-rotation of a per-frame threshold.
 */
export class DeadAccumulator {
  constructor(dz) { this.dz = dz; this.acc = 0; }
  push(d) {
    this.acc += d;
    if (Math.abs(this.acc) < this.dz) return 0;
    const out = this.acc; this.acc = 0; return out;
  }
  reset() { this.acc = 0; }
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * One-Euro filter: strong smoothing when slow (kills jitter),
 * almost no smoothing when fast (keeps it responsive).
 */
export class OneEuro {
  constructor(minCutoff = 2, beta = 12, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() { this.x = null; this.dx = 0; }
  filter(v, tSec) {
    if (this.x === null) { this.x = v; this.t = tSec; this.dx = 0; return v; }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

/** Tiny event emitter. */
export class Emitter {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const l = this.map.get(type);
    if (l) this.map.set(type, l.filter((f) => f !== fn));
  }
  emit(type, data) {
    const l = this.map.get(type);
    if (!l) return;
    for (const fn of l) {
      try { fn(data); } catch (e) { console.error(`[event:${type}]`, e); }
    }
  }
}
