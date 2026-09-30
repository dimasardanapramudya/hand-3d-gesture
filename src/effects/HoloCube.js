import * as THREE from 'three';
import { GlowLines } from './GlowLines.js';
import { makePoints } from './glow.js';
import { damp, clamp } from '../utils/math.js';

const FACE_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FACE_FS = /* glsl */`
uniform vec3 uColor; uniform float uTime, uAlpha;
varying vec2 vUv;
void main() {
  vec2 f = abs(fract(vUv * 4.0 + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.035, min(f.x, f.y));
  float scan = pow(max(0.0, sin((vUv.y * 2.0 - uTime * 0.5) * 3.14159)), 24.0);
  float e = 1.0 - smoothstep(0.0, 0.07, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  float a = (0.025 + 0.07 * line + 0.16 * scan + 0.10 * e) * uAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

const EDGES = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
const BASE = new THREE.Color(0x5aa8ff);

/** Holographic 3D control volume that reacts to grab / scale / rotation / speed. */
export class HoloCube {
  constructor(size = 3.4) {
    this.size = size;
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);
    this.baseTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, 0.55, 0));
    this.lag = new THREE.Quaternion();
    this.energy = 0; this.kickV = 0; this.scaleSmooth = 1; this.t = 0; this.innerRot = 0;
    this.color = new THREE.Color();

    const box = new THREE.BoxGeometry(size, size, size);
    this.edgeMat = new THREE.LineBasicMaterial({ color: BASE, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tilt.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), this.edgeMat));

    this.faceMat = new THREE.ShaderMaterial({
      vertexShader: FACE_VS, fragmentShader: FACE_FS,
      uniforms: { uColor: { value: new THREE.Color(BASE) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    });
    this.faces = new THREE.Mesh(box, this.faceMat);
    this.tilt.add(this.faces);

    this.innerMat = this.edgeMat.clone();
    this.innerMat.opacity = 0.3;
    this.inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 0.5, size * 0.5, size * 0.5)), this.innerMat);
    this.tilt.add(this.inner);

    const h = size / 2;
    this.corners = [];
    for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) this.corners.push(new THREE.Vector3(x, y, z));
    this.cornerPts = makePoints(8, { size: 0.24, color: 0xaed2ff });
    this.corners.forEach((c, i) => this.cornerPts.geometry.attributes.position.setXYZ(i, c.x, c.y, c.z));
    this.tilt.add(this.cornerPts);

    this.pulsePts = makePoints(12, { size: 0.14, color: 0xffffff });
    this.pulsePhase = EDGES.map((_, i) => i / EDGES.length);
    this.tilt.add(this.pulsePts);

    this.motes = makePoints(60, { size: 0.05, color: 0x9fd0ff, opacity: 0.8 });
    this.moteVel = new Float32Array(60 * 3);
    const mp = this.motes.geometry.attributes.position.array;
    for (let i = 0; i < 60; i++) {
      for (let k = 0; k < 3; k++) { mp[i * 3 + k] = (Math.random() - 0.5) * size; this.moteVel[i * 3 + k] = (Math.random() - 0.5) * 0.25; }
    }
    this.tilt.add(this.motes);

    // soft halo on the edges (world space, screen-facing quads)
    this.halo = new GlowLines(12, { power: 2.2, order: 2 });
    this.root = new THREE.Group(); // halo is world-space, so it must not inherit the group transform
    this.root.add(this.group, this.halo.mesh);
    this._q = new THREE.Quaternion();
    this._id = new THREE.Quaternion();
    this._w = this.corners.map(() => new THREE.Vector3());
  }

  /** transient flash (release, thumbs-up, transition) */
  kick(v = 0.6) { this.kickV = Math.max(this.kickV, v); }

  update(dt, s) {
    // s: { pos, scale, quat, grab, speed, angular, scaleRate, accent, squeeze }
    this.t += dt;
    this.kickV = damp(this.kickV, 0, 3.2, dt);
    const target = clamp(s.grab * 0.75 + Math.min(0.3, s.speed * 0.05) + Math.min(0.2, s.angular * 0.05) + this.kickV, 0, 1);
    this.energy = damp(this.energy, target, target > this.energy ? 14 : 5, dt);
    const e = this.energy;

    this.group.position.copy(s.pos);
    const sc = clamp(s.scale, 0.45, 2.6) * (1 + clamp(s.scaleRate, -1, 1) * 0.04) * (1 - s.grab * 0.03 - s.squeeze * 0.12) * (1 + 0.012 * Math.sin(this.t * 1.6)) * (s.presence ?? 1);
    this.scaleSmooth = damp(this.scaleSmooth, sc, 12, dt);
    this.group.scale.setScalar(this.scaleSmooth);

    // orientation: fixed 3D tilt + a lagging echo of the object rotation
    this.lag.slerp(s.quat, 1 - Math.exp(-3 * dt));
    this._q.copy(this._id).slerp(this.lag, 0.35);
    this.tilt.quaternion.copy(this.baseTilt).multiply(this._q);
    this.innerRot += dt * (0.25 + s.angular * 0.8);
    this.inner.rotation.set(this.innerRot * 0.7, this.innerRot, this.innerRot * 0.4);

    // colour: cool blue -> accent tint -> white-hot with energy
    this.color.copy(BASE).lerp(s.accent, 0.28).lerp(new THREE.Color(0xffffff), e * 0.5);
    this.edgeMat.color.copy(this.color);
    this.innerMat.color.copy(this.color);
    this.edgeMat.opacity = 0.42 + e * 0.5;
    this.innerMat.opacity = 0.22 + e * 0.4;
    this.faceMat.uniforms.uColor.value.copy(this.color);
    this.faceMat.uniforms.uAlpha.value = 0.7 + e * 1.2;
    this.faceMat.uniforms.uTime.value = this.t * (1 + e * 2);
    this.cornerPts.material.color.copy(this.color);
    this.cornerPts.material.size = 0.2 + e * 0.22 + 0.03 * Math.sin(this.t * 3);
    this.motes.material.color.copy(this.color);

    // energy pulses travelling along the edges
    const pp = this.pulsePts.geometry.attributes.position;
    const speed = 0.18 + e * 0.9;
    EDGES.forEach(([a, b], i) => {
      this.pulsePhase[i] = (this.pulsePhase[i] + dt * speed) % 1;
      const t = this.pulsePhase[i], A = this.corners[a], B = this.corners[b];
      pp.setXYZ(i, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, A.z + (B.z - A.z) * t);
    });
    pp.needsUpdate = true;
    this.pulsePts.material.opacity = 0.35 + e * 0.6;

    // drifting motes (wrapped inside the volume)
    const mp = this.motes.geometry.attributes.position.array, h = this.size / 2, mv = this.moteVel;
    const boost = 1 + e * 2.5;
    for (let i = 0; i < mp.length; i++) {
      mp[i] += mv[i] * dt * boost;
      if (mp[i] > h) mp[i] = -h; else if (mp[i] < -h) mp[i] = h;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;

    // halo quads
    this.group.updateMatrixWorld(true);
    this.tilt.updateMatrixWorld(true);
    this.corners.forEach((c, i) => this._w[i].copy(c).applyMatrix4(this.tilt.matrixWorld));
    this.halo.begin();
    for (const [a, b] of EDGES) {
      this.halo.add(this._w[a], this._w[b], 0.16 + e * 0.12, 0.16 + e * 0.12, this.color.r, this.color.g, this.color.b, 0.09 + e * 0.18, 0.09 + e * 0.18);
    }
    this.halo.end();
  }
}
