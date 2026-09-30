import * as THREE from 'three';
import { BaseBehavior } from './BaseBehavior.js';
import { clamp, damp } from '../utils/math.js';

const LOOPS = new Set(['Idle', 'Walking', 'Running', 'Dance']);

/**
 * Holographic mech-robot (RobotExpressive.glb, CC0 - Tomás Laulhé).
 * A real skinned rig with 14 clips + face morph targets, driven by a small
 * animation state machine:
 *   Idle / Walking / Running  <- object speed (hysteresis, cross-faded)
 *   Dance                     <- two-hand control
 *   Jump   <- swipe UP / pinch release      Punch <- swipe LEFT/RIGHT
 *   Yes    <- swipe DOWN                    ThumbsUp <- THUMBS UP gesture
 *   Wave   <- appears on stage              Angry face while grabbed
 * Plus turning to face travel direction, forward lean, and jet-thruster
 * particles under the feet.
 */
export class RobotBehavior extends BaseBehavior {
  constructor() {
    super('robot', {
      file: '/objects/robot.glb', label: 'ROBOT', icon: '🤖', size: 3.0, accent: 0x5fe0ff,
      physics: { k: 22, zeta: 0.8, throwDamp: 1.1, maxSpeed: 11 }
    });
    this.wander = 0.8;
    this.actions = {};
    this.cur = null;
    this.once = null;
    this.baseName = 'Idle';
    this.baseSince = 0;
    this.yaw = 0; this.lean = 0; this.expr = { Angry: 0, Surprised: 0 };
    this.thrust = 0;
    this.morphMeshes = [];
    this.t = 0;
  }

  onLoaded(gltf) {
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (LOOPS.has(clip.name)) a.setLoop(THREE.LoopRepeat, Infinity);
      else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[clip.name] = a;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.once) { this.once = null; this._applyBase(true); }
    });
    this.model.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.morphMeshes.push(o);
    });
    this._go(this.actions.Idle, 0);
  }

  _go(next, fade = 0.25) {
    if (!next || this.cur === next) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(next, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = next;
  }

  _applyBase(force = false) {
    if (this.once) return;
    this._go(this.actions[this.baseName], force ? 0.3 : 0.25);
  }

  playOnce(name, fade = 0.15) {
    const a = this.actions[name];
    if (!a) return;
    this.once = a;
    this._go(a, fade);
  }

  update(dt, t, ctx) {
    this.t = t;
    const speed = ctx.speed;

    // ---- locomotion state with hysteresis (min dwell 0.2s) ----
    let want = 'Idle';
    if (ctx.twoHands) want = 'Dance';
    else if (speed > 3.3 || (this.baseName === 'Running' && speed > 2.6)) want = 'Running';
    else if (speed > 0.9 || (this.baseName === 'Walking' && speed > 0.5)) want = 'Walking';
    if (want !== this.baseName && t - this.baseSince > 0.2) {
      this.baseName = want; this.baseSince = t; this._applyBase();
    }
    const a = this.cur;
    if (a && !this.once) {
      a.setEffectiveTimeScale(this.baseName === 'Running' ? clamp(speed / 5, 0.8, 1.7)
        : this.baseName === 'Walking' ? clamp(speed / 1.8, 0.7, 1.4) : this.baseName === 'Dance' ? 1.1 : 1);
    }
    this.mixer.update(dt);

    // ---- face travel direction (partial turn), lean into motion ----
    const v = ctx.vel;
    const moving = speed > 0.9 && !this.once;
    const yawT = moving ? clamp(v.x * 0.3, -1.0, 1.0) : 0;
    this.yaw = damp(this.yaw, yawT, 4, dt);
    this.lean = damp(this.lean, moving ? clamp(speed * 0.03, 0, 0.22) : 0, 5, dt);
    const p = this.pivot;
    p.rotation.set(this.lean, this.yaw, clamp(-v.x * 0.02, -0.15, 0.15));
    p.position.y = Math.sin(t * 1.7) * 0.05; // hologram hover

    // ---- expressions (face morph targets) ----
    this.expr.Angry = damp(this.expr.Angry, ctx.grabbed ? 1 : 0, 10, dt);
    this.expr.Surprised = damp(this.expr.Surprised, 0, 3, dt);
    for (const m of this.morphMeshes) {
      for (const k in this.expr) {
        const i = m.morphTargetDictionary[k];
        if (i !== undefined) m.morphTargetInfluences[i] = this.expr[k];
      }
    }

    // ---- jet thrusters under the feet ----
    this.thrust = damp(this.thrust, ctx.grabbed || speed > 0.8 ? 1 : 0.15, 6, dt);
    if (ctx.particles && this.thrust > 0.2) {
      const feetY = ctx.pos.y - this.size * 0.5 * ctx.scale;
      const n = Math.random() < this.thrust * dt * 40 ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0;
      for (let i = 0; i < n; i++) {
        const hot = Math.random() < 0.45;
        ctx.particles.emit(
          ctx.pos.x + (Math.random() - 0.5) * 0.7 * ctx.scale, feetY, ctx.pos.z + (Math.random() - 0.5) * 0.3,
          -v.x * 0.15 + (Math.random() - 0.5) * 0.4, -1.4 - Math.random() * 1.6 - speed * 0.15, 0,
          0.55 + Math.random() * 0.4, 8 + Math.random() * 6,
          hot ? 1.0 : 0.35, hot ? 0.62 : 0.88, hot ? 0.25 : 1.0, 2.2);
      }
    }
  }

  onEnter() { if (this.mixer) this.playOnce('Wave'); this.expr.Surprised = 1; }
  onGrab() { this.playOnce('Standing', 0.1); }

  onRelease(v, ctx) {
    ctx.ctrl.fling(new THREE.Vector3(v.x * 0.5, 1.6, 0), 0.8);
    this.playOnce('Jump', 0.1);
  }

  onSwipe(dir, ctx) {
    ctx.ctrl.fling(new THREE.Vector3(dir.x * 8, dir.y * 8, 0), 0.5);
    this.expr.Surprised = 1;
    if (dir.y > 0.5) this.playOnce('Jump', 0.1);
    else if (dir.y < -0.5) this.playOnce('Yes', 0.15);
    else this.playOnce('Punch', 0.08);
  }

  onGesture(to) {
    if (to === 'THUMBS_UP') this.playOnce('ThumbsUp', 0.15);
  }

  reset() {
    this.once = null; this.baseName = 'Idle'; this.yaw = this.lean = 0;
    if (this.mixer) this._go(this.actions.Idle, 0.2);
  }
}
