import * as THREE from 'three';
import { GlowLines } from './GlowLines.js';

const N = 34;                 // samples per trail
const LIFE = 0.55;            // seconds
const IDS = [0, 8, 4, 12, 16, 20];         // palm(wrist), index, thumb, middle, ring, pinky
const WEIGHT = [1, 1, 0.6, 0.55, 0.5, 0.5];
const TRAILS = 2 * IDS.length;

/** Fading ribbon trails: longer + brighter the faster the hand moves. */
export class MotionTrail {
  constructor() {
    this.group = new THREE.Group();
    this.lines = new GlowLines(TRAILS * N, { power: 1.5, order: 8 });
    this.group.add(this.lines.mesh);
    this.buf = Array.from({ length: TRAILS }, () => ({
      d: new Float32Array(N * 5), head: 0, count: 0
    }));
  }

  update(dt, nowMs, hands) {
    const now = nowMs / 1000;
    this.lines.begin();
    for (let hi = 0; hi < hands.length; hi++) {
      const h = hands[hi];
      for (let k = 0; k < IDS.length; k++) {
        const tr = this.buf[hi * IDS.length + k];
        if (h.active && h.speed > 0.6) {
          const isMain = k < 2;
          const s = isMain
            ? Math.min(1, 0.2 + h.speed / 5)
            : Math.min(1, Math.max(0, (h.speed - 1.5) / 4)) * WEIGHT[k];
          if (s > 0.02) {
            const p = h.world[IDS[k]];
            const o = tr.head * 5;
            tr.d[o] = p.x; tr.d[o + 1] = p.y; tr.d[o + 2] = p.z; tr.d[o + 3] = now; tr.d[o + 4] = s;
            tr.head = (tr.head + 1) % N;
            tr.count = Math.min(N, tr.count + 1);
          }
        }
        this._draw(tr, now, k);
      }
    }
    this.lines.end();
  }

  _draw(tr, now, k) {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    const width = k < 2 ? 0.085 : 0.05;
    for (let i = 1; i < tr.count; i++) {
      const i0 = (tr.head - i - 1 + N * 2) % N;
      const i1 = (tr.head - i + N * 2) % N;
      const o0 = i0 * 5, o1 = i1 * 5;
      const age0 = now - tr.d[o0 + 3], age1 = now - tr.d[o1 + 3];
      if (age0 > LIFE || age1 > LIFE) continue;
      if (tr.d[o1 + 3] - tr.d[o0 + 3] > 0.12) continue; // discontinuity
      a.x = tr.d[o0]; a.y = tr.d[o0 + 1]; a.z = tr.d[o0 + 2];
      b.x = tr.d[o1]; b.y = tr.d[o1 + 1]; b.z = tr.d[o1 + 2];
      const f0 = Math.pow(1 - age0 / LIFE, 1.6) * tr.d[o0 + 4];
      const f1 = Math.pow(1 - age1 / LIFE, 1.6) * tr.d[o1 + 4];
      this.lines.add(a, b, width * (1 - age0 / LIFE * 0.7), width * (1 - age1 / LIFE * 0.7),
        0.45, 0.9, 1.0, f0 * 0.75, f1 * 0.75);
    }
  }
}
