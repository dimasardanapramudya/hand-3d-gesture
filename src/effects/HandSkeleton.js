import * as THREE from 'three';
import { GlowLines } from './GlowLines.js';

// Same topology as MediaPipe HAND_CONNECTIONS (defined locally: no API guessing)
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];
// Holographic lattice between neighbouring fingers
const WEB = [[6, 10], [10, 14], [14, 18], [7, 11], [11, 15], [15, 19], [8, 12], [12, 16], [16, 20], [2, 5]];
const TIPS = new Set([4, 8, 12, 16, 20]);
const PALM_FAN = [0, 5, 9, 13, 17];

const PVS = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
uniform float uPR;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uPR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PFS = /* glsl */`
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.32, d);
  float halo = pow(max(0.0, 1.0 - d), 2.2) * 0.75;
  float a = clamp(core + halo, 0.0, 1.0);
  gl_FragColor = vec4(vColor.rgb * (0.6 + core), a * vColor.a);
}`;

/** Wireframe holographic hand: glow bones + lattice + joint nodes + palm fill. */
export class HandSkeleton {
  constructor(pixelRatio = 1) {
    this.group = new THREE.Group();
    this.glow = new GlowLines(2 * (BONES.length + WEB.length), { power: 2.0, order: 10 });
    this.core = new GlowLines(2 * (BONES.length + WEB.length), { power: 0.8, order: 11 });
    this.group.add(this.glow.mesh, this.core.mesh);

    const N = 42;
    const geo = new THREE.BufferGeometry();
    this.jPos = new Float32Array(N * 3);
    this.jSize = new Float32Array(N);
    this.jCol = new Float32Array(N * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.jPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.jSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.jCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: PVS, fragmentShader: PFS,
      uniforms: { uPR: { value: pixelRatio } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.group.add(this.points);

    this.palms = [0, 1].map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3).setUsage(THREE.DynamicDrawUsage));
      g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x3ec8ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      m.frustumCulled = false;
      m.renderOrder = 9;
      this.group.add(m);
      return m;
    });
    this._t = 0;
  }

  setPixelRatio(pr) { this.pointMat.uniforms.uPR.value = pr; }
  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  update(dt, hands) {
    this._t += dt;
    this.glow.begin(); this.core.begin();
    let pi = 0;
    for (let hi = 0; hi < hands.length; hi++) {
      const h = hands[hi];
      const vis = h.visible;
      const palm = this.palms[hi];
      if (vis < 0.02) {
        palm.material.opacity = 0;
        for (let k = 0; k < 21; k++) this._joint(pi++, null);
        continue;
      }
      const pinch = h.g?.pinch ? 1 : 0;
      const energy = Math.min(1, h.speed * 0.08);
      // cyan -> white-hot on pinch
      const r = 0.25 + 0.75 * pinch * 0.6 + energy * 0.2;
      const g = 0.85 + 0.15 * pinch;
      const b = 1.0;
      const boost = 0.75 + energy * 0.5 + pinch * 0.35;
      const w = h.world;

      for (const [a, c] of BONES) {
        this.glow.add(w[a], w[c], 0.12, 0.12, r, g, b, 0.42 * vis * boost, 0.42 * vis * boost);
        this.core.add(w[a], w[c], 0.03, 0.03, 0.85, 1, 1, 0.95 * vis, 0.95 * vis);
      }
      for (const [a, c] of WEB) {
        this.glow.add(w[a], w[c], 0.05, 0.05, r, g, b, 0.10 * vis, 0.10 * vis);
        this.core.add(w[a], w[c], 0.012, 0.012, 0.6, 0.95, 1, 0.35 * vis, 0.35 * vis);
      }

      const pos = palm.geometry.attributes.position.array;
      PALM_FAN.forEach((id, i) => { pos[i * 3] = w[id].x; pos[i * 3 + 1] = w[id].y; pos[i * 3 + 2] = w[id].z - 0.01; });
      palm.geometry.attributes.position.needsUpdate = true;
      palm.material.opacity = (0.06 + energy * 0.05 + pinch * 0.06) * vis;

      for (let k = 0; k < 21; k++) {
        const tip = TIPS.has(k);
        const pulse = tip ? 1 + 0.18 * Math.sin(this._t * 6 + k) : 1;
        const size = (k === 0 ? 16 : tip ? 19 : (k % 4 === 1 ? 10 : 8)) * pulse * (0.85 + 0.3 * vis);
        const hot = tip || k === 0;
        this._joint(pi++, w[k], size, hot ? 1 : 0.55, hot ? 0.95 : 0.85, 1, vis * (hot ? 1 : 0.85));
      }
    }
    for (; pi < 42; pi++) this._joint(pi, null);

    this.glow.end(); this.core.end();
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
  }

  _joint(i, p, size = 0, r = 1, g = 1, b = 1, a = 0) {
    const o = i * 3, c = i * 4;
    if (p) { this.jPos[o] = p.x; this.jPos[o + 1] = p.y; this.jPos[o + 2] = p.z; }
    this.jSize[i] = p ? size : 0;
    this.jCol[c] = r; this.jCol[c + 1] = g; this.jCol[c + 2] = b; this.jCol[c + 3] = p ? a : 0;
  }
}
