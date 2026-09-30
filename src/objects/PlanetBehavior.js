import * as THREE from 'three';
import { BaseBehavior } from './BaseBehavior.js';
import { makePoints } from '../effects/glow.js';
import { damp } from '../utils/math.js';

const ATMO_VS = /* glsl */`
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ATMO_FS = /* glsl */`
uniform vec3 uColor; uniform float uIntensity;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  gl_FragColor = vec4(uColor, f * uIntensity);
}`;

/** Planet: axial spin + tilt, atmosphere glow, orbital belt, star field, spin inertia. */
export class PlanetBehavior extends BaseBehavior {
  constructor() {
    super('planet', {
      file: '/objects/planet.glb', label: 'PLANET', icon: '🪐', size: 2.4, accent: 0x6fb1ff,
      physics: { k: 26, zeta: 0.88, throwDamp: 1.6, maxSpeed: 10 }
    });
    this.spinRate = 0.22;
    this.spinBoost = 0;
    this.glow = 0;
    this.spinFromHand = true;
  }

  onLoaded() {
    const R = this.size / 2;
    this.pivot.rotation.z = 0.41; // axial tilt (rewritten each frame together with wobble)

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VS, fragmentShader: ATMO_FS,
      uniforms: { uColor: { value: new THREE.Color(0x5fb0ff) }, uIntensity: { value: 1.2 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 48, 32), this.atmoMat);
    this.holder.parent.add(this.atmo);

    // orbital belt
    this.belt = makePoints(320, { size: 0.045, color: 0xbfdcff, opacity: 0.85 });
    const bp = this.belt.geometry.attributes.position.array;
    for (let i = 0; i < 320; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = R * (1.45 + Math.random() * 0.55);
      bp[i * 3] = Math.cos(a) * r;
      bp[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      bp[i * 3 + 2] = Math.sin(a) * r;
    }
    this.beltGroup = new THREE.Group();
    this.beltGroup.rotation.x = 0.35;
    this.beltGroup.add(this.belt);
    this.pivot.add(this.beltGroup);

    // stars
    this.stars = makePoints(180, { size: 0.03, color: 0xffffff, opacity: 0.7 });
    const sp = this.stars.geometry.attributes.position.array;
    for (let i = 0; i < 180; i++) {
      const r = R * (2.6 + Math.random() * 2.0);
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
      sp[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      sp[i * 3 + 2] = r * Math.cos(ph) * 0.5;
    }
    this.pivot.add(this.stars);
  }

  update(dt, t, ctx) {
    this.spinBoost = damp(this.spinBoost, 0, 1.2, dt);
    this.spinRate = 0.22 + this.spinBoost;
    if (this.model) this.model.rotation.y += this.spinRate * dt;
    if (this.beltGroup) this.beltGroup.rotation.y += dt * (0.12 + this.spinBoost * 0.3);
    if (this.stars) this.stars.rotation.y += dt * 0.02;

    this.glow = damp(this.glow, (ctx.grabbed ? 0.6 : 0) + Math.min(0.5, ctx.speed * 0.08), 5, dt);
    if (this.atmoMat) this.atmoMat.uniforms.uIntensity.value = 1.0 + this.glow * 1.4;

    this.pivot.position.set(0, Math.sin(t * 0.8) * 0.05, 0);
    this.pivot.rotation.z = 0.41 + Math.sin(t * 0.3) * 0.02;
    this.pivot.scale.setScalar(1 + Math.sin(t * 1.2) * 0.008);
  }

  onSwipe(dir, ctx) {
    ctx.ctrl.spin(new THREE.Vector3(-dir.y * 7, dir.x * 7, 0));
    this.spinBoost = 1.2;
  }

  onRelease(v, ctx) {
    ctx.ctrl.fling(new THREE.Vector3(v.x * 0.4, v.y * 0.4, 0), 0.7);
    ctx.ctrl.spin(new THREE.Vector3(-v.y * 0.4, v.x * 0.4, 0));
  }

  reset() { this.spinBoost = 0; this.glow = 0; }
}
