import * as THREE from 'three';
import { damp, easeOutCubic, clamp } from '../utils/math.js';

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha, uRadius, uWidth, uTicks, uRot, uGlow;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float ring = 1.0 - smoothstep(0.0, uWidth, abs(r - uRadius));
  if (uTicks > 0.5) {
    float a = atan(p.y, p.x) + uRot;
    ring *= step(0.4, fract(a / 6.2831853 * uTicks));
  }
  float glow = exp(-r * r * 46.0) * uGlow;
  float edge = 1.0 - smoothstep(0.40, 0.5, r);
  gl_FragColor = vec4(uColor, (ring + glow) * edge * uAlpha);
}`;

const PLANE = new THREE.PlaneGeometry(1, 1);

class RingFX {
  constructor(color = 0x7fdcff) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uRadius: { value: 0.4 },
        uWidth: { value: 0.03 }, uTicks: { value: 0 }, uRot: { value: 0 }, uGlow: { value: 0 }
      },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.Mesh(PLANE, this.mat);
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }
  set(pos, size, alpha) {
    this.mesh.visible = alpha > 0.01;
    this.mesh.position.set(pos.x, pos.y, pos.z + 0.05);
    this.mesh.scale.setScalar(size);
    this.mat.uniforms.uAlpha.value = alpha;
  }
  get u() { return this.mat.uniforms; }
}

/** Fingertip cursor, pinch reticle, shockwave rings. */
export class InteractionFX {
  constructor() {
    this.group = new THREE.Group();
    this.t = 0;
    this.cursors = [0, 1].map(() => {
      const glow = new RingFX(0x9fe8ff); glow.u.uGlow.value = 1.6; glow.u.uRadius.value = 0;
      const pulse = new RingFX(0x9fe8ff); pulse.u.uWidth.value = 0.02;
      this.group.add(glow.mesh, pulse.mesh);
      return { glow, pulse, a: 0 };
    });
    this.reticles = [0, 1].map(() => {
      const outer = new RingFX(0xffffff); outer.u.uTicks.value = 12; outer.u.uRadius.value = 0.42; outer.u.uWidth.value = 0.025;
      const inner = new RingFX(0x8ff0ff); inner.u.uRadius.value = 0.22; inner.u.uWidth.value = 0.03; inner.u.uGlow.value = 0.8;
      this.group.add(outer.mesh, inner.mesh);
      return { outer, inner, a: 0 };
    });
    this.shocks = Array.from({ length: 6 }, () => {
      const r = new RingFX(0x9fd0ff); r.u.uRadius.value = 0.45; r.u.uWidth.value = 0.03;
      this.group.add(r.mesh);
      return { r, t: 1, size: 3, pos: new THREE.Vector3(), alpha: 0.8 };
    });
    this.next = 0;
  }

  shock(pos, color = 0x9fd0ff, size = 3.2, alpha = 0.8) {
    const s = this.shocks[this.next];
    this.next = (this.next + 1) % this.shocks.length;
    s.t = 0; s.size = size; s.alpha = alpha; s.pos.copy(pos);
    s.r.u.uColor.value.set(color);
  }

  update(dt, hands) {
    this.t += dt;
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const cur = this.cursors[i], ret = this.reticles[i];
      const pointing = !!h && h.active && h.g?.current === 'POINT';
      cur.a = damp(cur.a, pointing ? 1 : 0, 14, dt);
      if (h) {
        const tip = h.world[8];
        const ph = (this.t * 1.4 + i * 0.5) % 1;
        cur.glow.set(tip, 0.55, cur.a * 0.95);
        cur.pulse.u.uRadius.value = 0.2 + ph * 0.25;
        cur.pulse.set(tip, 0.75, cur.a * (1 - ph) * 0.8);

        const near = h.active ? clamp((0.85 - h.pinchRatio) / 0.5, 0, 1) : 0;
        const pinch = h.g?.pinch ? 1 : 0;
        ret.a = damp(ret.a, Math.max(near * 0.55, pinch), 16, dt);
        const size = 0.55 + (1 - near) * 0.35 - pinch * 0.12;
        ret.outer.u.uRot.value += dt * (1.2 + pinch * 3.5);
        ret.outer.u.uColor.value.setRGB(1, 1, 1).lerp(new THREE.Color(0x8ff0ff), 1 - pinch);
        ret.outer.set(h.pinchPoint, size, ret.a * 0.9);
        ret.inner.set(h.pinchPoint, size * (0.7 + 0.1 * Math.sin(this.t * 10)), ret.a * (0.5 + pinch * 0.5));
      } else { cur.glow.set({ x: 0, y: 0, z: 0 }, 1, 0); cur.pulse.set({ x: 0, y: 0, z: 0 }, 1, 0); ret.outer.set({ x: 0, y: 0, z: 0 }, 1, 0); ret.inner.set({ x: 0, y: 0, z: 0 }, 1, 0); }
    }
    for (const s of this.shocks) {
      if (s.t >= 1) { s.r.mesh.visible = false; continue; }
      s.t = Math.min(1, s.t + dt / 0.75);
      const e = easeOutCubic(s.t);
      s.r.set(s.pos, s.size * (0.25 + e), s.alpha * (1 - s.t));
    }
  }
}
