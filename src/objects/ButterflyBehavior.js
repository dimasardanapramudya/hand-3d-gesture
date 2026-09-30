import * as THREE from 'three';
import { BaseBehavior } from './BaseBehavior.js';
import { clamp, damp } from '../utils/math.js';

/**
 * Butterfly: the GLB ships with wing/body clips -> played through an
 * AnimationMixer whose speed follows hand velocity. On top: hover, bob, banking,
 * squeezed "caught" state on pinch, gentle fly-away on release, dash on swipe.
 */
export class ButterflyBehavior extends BaseBehavior {
  constructor() {
    super('butterfly', {
      file: '/objects/butterfly.glb', label: 'BUTTERFLY', icon: '🦋', size: 2.4, accent: 0xffb35a,
      physics: { k: 34, zeta: 0.52, throwDamp: 0.9, maxSpeed: 16 }
    });
    this.wander = 1;
    this.flap = 1; this.boost = 0;
    this.bank = 0; this.pitch = 0; this.yaw = 0; this.squeeze = 0;
    this.dust = 0;
    this.wings = [];
  }

  onLoaded(gltf) {
    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
    } else {
      // Procedural fallback if the asset has no clips
      this.model.traverse((o) => { if (/wing/i.test(o.name)) this.wings.push(o); });
    }
  }

  update(dt, t, ctx) {
    const sp = ctx.handSpeed;
    const flapTarget = 1.15 + Math.min(2.2, sp * 0.45) + (ctx.grabbed ? 1.8 : 0) + this.boost * 1.8;
    this.flap = damp(this.flap, flapTarget, 6, dt);
    this.boost = Math.max(0, this.boost - dt * 1.1);
    if (this.mixer) { this.mixer.timeScale = this.flap; this.mixer.update(dt); }
    else for (const w of this.wings) w.scale.x = 1 + Math.sin(t * 9 * this.flap) * 0.35;

    // hover / float
    const p = this.pivot;
    const hoverAmp = 1 - this.squeeze * 0.8;
    let px = Math.sin(t * 1.1) * 0.05 * hoverAmp;
    let py = (Math.sin(t * 2.3) * 0.07 + Math.sin(t * 5.1) * 0.015) * hoverAmp;
    let pz = Math.sin(t * 0.9) * 0.05;
    this.squeeze = damp(this.squeeze, ctx.grabbed ? 1 : 0, 10, dt);
    if (this.squeeze > 0.05) { // tremble while caught
      px += (Math.random() - 0.5) * 0.03 * this.squeeze;
      py += (Math.random() - 0.5) * 0.03 * this.squeeze;
    }
    p.position.set(px, py, pz);

    // banking follows real (inertial) velocity
    const v = ctx.vel;
    const bankT = clamp(-v.x * 0.11, -0.7, 0.7);
    const pitchT = clamp(v.y * 0.05, -0.4, 0.4);
    const yawT = clamp(v.x * 0.06, -0.4, 0.4);
    this.bank = damp(this.bank, bankT, 5, dt);
    this.pitch = damp(this.pitch, pitchT, 5, dt);
    this.yaw = damp(this.yaw, yawT, 5, dt);
    p.rotation.set(this.pitch, this.yaw, this.bank);
    p.scale.setScalar(1 - this.squeeze * 0.07);

    // golden dust when fast
    if (ctx.speed > 2.2 && ctx.particles) {
      this.dust += dt * Math.min(40, ctx.speed * 6);
      const n = Math.floor(this.dust);
      if (n > 0) { this.dust -= n; ctx.particles.trail(ctx.pos, v, n, 0xffcf8a, 6); }
    }
  }

  onGrab() { this.boost = Math.max(this.boost, 0.8); }

  onRelease(v, ctx) {
    // "flutters free": slow upward drift + a bit of the hand's momentum
    ctx.ctrl.fling(new THREE.Vector3(v.x * 0.5 + (Math.random() - 0.5) * 0.8, 1.3, 0), 0.9);
    this.boost = 1;
  }

  onSwipe(dir, ctx) {
    ctx.ctrl.fling(new THREE.Vector3(dir.x * 8, dir.y * 8, 0), 0.5);
    this.boost = 1;
  }

  reset() { this.flap = 1; this.boost = 0; this.bank = this.pitch = this.yaw = 0; }
}
