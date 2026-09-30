import * as THREE from 'three';

const VS = /* glsl */`
attribute float aSide;
attribute vec4 aColor;
varying float vSide;
varying vec4 vColor;
void main() {
  vSide = aSide;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS = /* glsl */`
uniform float uPower;
varying float vSide;
varying vec4 vColor;
void main() {
  float a = pow(max(0.0, 1.0 - abs(vSide)), uPower);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/**
 * Batched soft "glow" line renderer (quads with a soft falloff across the width).
 * WebGL ignores linewidth, so this is what gives thick glowing hologram lines.
 * Quads are extruded in the XY plane (camera looks down -Z).
 */
export class GlowLines {
  constructor(maxSegments, { power = 1.6, order = 10 } = {}) {
    this.max = maxSegments;
    this.n = 0;
    this.pos = new Float32Array(maxSegments * 12);
    this.side = new Float32Array(maxSegments * 4);
    this.col = new Float32Array(maxSegments * 16);
    const idx = new Uint16Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4, o = i * 6;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], o);
      this.side.set([-1, 1, -1, 1], i * 4);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    g.setAttribute('aColor', this.aCol);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uPower: { value: power } },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  begin() { this.n = 0; }

  /** a,b: {x,y,z}; wa,wb: world widths; rgb 0..1; alphas at both ends */
  add(a, b, wa, wb, r, g, bl, alphaA, alphaB) {
    if (this.n >= this.max) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let px = 0, py = 1;
    if (len > 1e-5) { px = -dy / len; py = dx / len; }
    const i = this.n++;
    const p = i * 12, c = i * 16;
    const ha = wa * 0.5, hb = wb * 0.5;
    const P = this.pos;
    P[p] = a.x + px * ha; P[p + 1] = a.y + py * ha; P[p + 2] = a.z;
    P[p + 3] = a.x - px * ha; P[p + 4] = a.y - py * ha; P[p + 5] = a.z;
    P[p + 6] = b.x + px * hb; P[p + 7] = b.y + py * hb; P[p + 8] = b.z;
    P[p + 9] = b.x - px * hb; P[p + 10] = b.y - py * hb; P[p + 11] = b.z;
    const C = this.col;
    for (let k = 0; k < 4; k++) {
      const o = c + k * 4;
      C[o] = r; C[o + 1] = g; C[o + 2] = bl; C[o + 3] = k < 2 ? alphaA : alphaB;
    }
  }

  end() {
    this.geometry.setDrawRange(0, this.n * 6);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }
}
