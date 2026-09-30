import * as THREE from 'three';

const VS = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
uniform float uPR;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uPR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS = /* glsl */`
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** Pooled CPU-simulated GPU-rendered particles (single draw call). */
export class ParticleSystem {
  constructor(max = 700, pixelRatio = 1) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.rgb = new Float32Array(max * 3);
    this.drag = new Float32Array(max).fill(1.5);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aCol);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uPR: { value: pixelRatio } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;

    this.attractor = { on: false, x: 0, y: 0, z: 0, strength: 0, radius: 3 };
    this._c = new THREE.Color();
  }

  setPixelRatio(pr) { this.material.uniforms.uPR.value = pr; }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, drag = 1.5) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.rgb[o] = r; this.rgb[o + 1] = g; this.rgb[o + 2] = b;
    this.drag[i] = drag;
  }

  /** Radial burst. color: hex number. */
  burst(p, count, speed = 2, color = 0x9fd0ff, { life = 0.9, size = 9, drag = 2.2, flatten = 0.6 } = {}) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.emit(p.x, p.y, p.z,
        Math.sin(ph) * Math.cos(th) * s, Math.sin(ph) * Math.sin(th) * s, Math.cos(ph) * s * flatten,
        life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8),
        this._c.r, this._c.g, this._c.b, drag);
    }
  }

  /** Trail puffs along a motion direction. */
  trail(p, vel, count, color = 0x9fd0ff, size = 7) {
    this._c.set(color);
    for (let i = 0; i < count; i++) {
      this.emit(
        p.x + (Math.random() - 0.5) * 0.25, p.y + (Math.random() - 0.5) * 0.25, p.z + (Math.random() - 0.5) * 0.2,
        -vel.x * 0.12 + (Math.random() - 0.5) * 0.5, -vel.y * 0.12 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3,
        0.5 + Math.random() * 0.5, size * (0.6 + Math.random() * 0.7),
        this._c.r, this._c.g, this._c.b, 2.5);
    }
  }

  setAttractor(on, p, strength = 6, radius = 3) {
    const a = this.attractor;
    a.on = on;
    if (on && p) { a.x = p.x; a.y = p.y; a.z = p.z; a.strength = strength; a.radius = radius; }
  }

  update(dt) {
    const a = this.attractor;
    for (let i = 0; i < this.max; i++) {
      const o = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[c + 3] = 0; continue; }
      this.life[i] -= dt;
      if (a.on) {
        const dx = a.x - this.pos[o], dy = a.y - this.pos[o + 1], dz = a.z - this.pos[o + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < a.radius * a.radius && d2 > 0.0025) {
          const inv = a.strength / Math.sqrt(d2);
          this.vel[o] += dx * inv * dt; this.vel[o + 1] += dy * inv * dt; this.vel[o + 2] += dz * inv * dt;
          this.life[i] = Math.max(this.life[i], 0.25); // captured particles linger
        }
      }
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= damp; this.vel[o + 1] *= damp; this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = this.baseSize[i] * (0.5 + 0.5 * t);
      this.col[c] = this.rgb[o]; this.col[c + 1] = this.rgb[o + 1]; this.col[c + 2] = this.rgb[o + 2];
      this.col[c + 3] = Math.min(1, t * 1.6) * 0.9;
    }
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}
