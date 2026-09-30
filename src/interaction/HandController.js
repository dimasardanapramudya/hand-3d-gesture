import * as THREE from 'three';
import { TwoHandController } from './TwoHandController.js';
import { angleDelta, DeadAccumulator } from '../utils/math.js';
import { G } from '../tracking/GestureEngine.js';

const Z = new THREE.Vector3(0, 0, 1);
const SWITCH_MAP = { [G.POINT]: 'butterfly', [G.PEACE]: 'planet', [G.OPEN]: 'robot' };
const SWITCH_DWELL_MS = 380;
const SWITCH_COOLDOWN_MS = 1000;
const DIR = { LEFT: [-1, 0], RIGHT: [1, 0], UP: [0, 1], DOWN: [0, -1] };

const _t = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Turns tracked hands + gesture events into object control:
 *  1 hand : palm follows (pinch = strong grab at pinch point), roll while grabbing,
 *           gesture-dwell object switching, swipe / release / thumbs-up reactions
 *  2 hands: TwoHandController
 *  0 hands: idle drift
 */
export class HandController {
  constructor({ ctrl, manager, gestures, motion, particles, fx, cube }) {
    Object.assign(this, { ctrl, manager, gestures, motion, particles, fx, cube });
    this.two = new TwoHandController(ctrl);
    this.mode = 'none';
    this.primary = null;
    this.prevGrab = false;
    this.prevRoll = null;
    this.rollAcc = new DeadAccumulator(0.006);
    this.idleT = 0;
    this.anchor = new THREE.Vector3();
    this.ctx = null; // set every frame by main
    this.lastVel = new THREE.Vector3();

    gestures.on('swipe', (e) => this._onSwipe(e));
    gestures.on('gesture', (e) => this._onGesture(e));
  }

  update(dt, now, ctx) {
    this.ctx = ctx;
    const hands = this.motion.active();
    const c = this.ctrl;
    this.mode = hands.length >= 2 ? 'two' : hands.length === 1 ? 'one' : 'none';
    this.primary = hands.length ? hands.reduce((a, b) => (b.speed > a.speed ? b : a), hands[0]) : null;
    ctx.twoHands = this.mode === 'two';

    // grab = any hand pinching (edge-triggered for behaviour hooks)
    const grab = hands.some((h) => h.g?.pinch);
    if (grab && !this.prevGrab) this._grabStart(hands);
    if (!grab && this.prevGrab) this._grabEnd();
    this.prevGrab = grab;
    c.setGrabbed(grab);

    // pinch attracts particles to the pinch point
    const pinching = hands.find((h) => h.g?.pinch);
    this.particles.setAttractor(!!pinching, pinching?.pinchPoint, 7, 3);

    if (this.mode === 'two') {
      this.two.update(dt, hands[0], hands[1]);
      this.prevRoll = null;
      this.idleT = 0;
    } else {
      this.two.active = false;
      if (this.mode === 'one') this._oneHand(dt, now, hands[0]);
      else this._idle(dt, ctx);
    }

    // fist squeezes the object, thumbs up handled in gesture event
    c.mulTarget = hands.some((h) => h.g?.current === G.FIST) ? 0.82 : 1;

    // planet: hand velocity spins it (rolling-ball feel) with inertia
    if (this.mode !== 'none' && this.manager.current?.spinFromHand && this.primary) {
      const v = this.primary.velocity;
      if (this.primary.speed > 0.5) c.spin(_v.set(-v.y * 0.5 * dt * 3, v.x * 0.5 * dt * 3, 0));
    }
  }

  _oneHand(dt, now, h) {
    const c = this.ctrl, g = h.g;
    this.idleT = 0;
    _t.copy(g?.pinch ? h.pinchPoint : h.palm);
    c.setTarget(_t);
    this.anchor.copy(_t);

    // roll while grabbing (continuous, dead-zoned)
    if (g?.pinch) {
      if (this.prevRoll !== null) c.rotateTarget(Z, this.rollAcc.push(angleDelta(this.prevRoll, h.roll)) * 0.9);
      this.prevRoll = h.roll;
    } else { this.prevRoll = null; this.rollAcc.reset(); }

    // object switching by held gesture (single hand only, never while pinching)
    const want = SWITCH_MAP[g?.current];
    if (want && !g.pinch && g.heldMs >= SWITCH_DWELL_MS && !this.manager.switching &&
        this.manager.name !== want && now - this.manager.lastSwitch > SWITCH_COOLDOWN_MS) {
      this.manager.switchTo(want);
    }
  }

  _idle(dt, ctx) {
    this.idleT += dt;
    const b = this.manager.current;
    if (!b) return;
    this.anchor.multiplyScalar(Math.exp(-0.25 * dt)); // drift back to centre
    if (this.idleT > 0.6) {
      const t = ctx.t, w = b.wander;
      this.ctrl.setTarget(_t.set(
        this.anchor.x + Math.sin(t * 0.45) * 0.7 * w,
        this.anchor.y + Math.cos(t * 0.33) * 0.4 * w, 0));
    }
  }

  _grabStart() {
    this.manager.current?.onGrab(this.ctx);
    this.cube.kick(0.5);
    this.fx.shock(this.ctrl.pos, 0xffffff, 2.2, 0.55);
  }

  _grabEnd() {
    const v = this.lastVel;
    const b = this.manager.current;
    if (b) b.onRelease(v, this.ctx);
    this.particles.burst(this.ctrl.pos, 46, 2.4, 0xbfe6ff, { life: 0.9, size: 8 });
    this.cube.kick(0.7);
    this.fx.shock(this.ctrl.pos, 0x9fe8ff, 3.4, 0.7);
  }

  postUpdate() { if (this.primary) this.lastVel.copy(this.primary.velocity); }

  _onSwipe({ dir, speed }) {
    const b = this.manager.current;
    if (!b || !this.ctx) return;
    const [x, y] = DIR[dir];
    b.onSwipe(_v.set(x, y, 0), this.ctx);
    this.particles.burst(this.ctrl.pos, 30, 3, 0x9fd0ff, { life: 0.6, size: 7, flatten: 0.2 });
    this.cube.kick(0.4);
    this.lastSwipe = { dir, speed, t: performance.now() };
  }

  _onGesture({ to }) {
    if (this.ctx) this.manager.current?.onGesture(to, this.ctx);
    if (to === G.THUMBS_UP) {
      this.particles.burst(this.ctrl.pos, 70, 3.2, 0xffe08a, { life: 1.1, size: 10 });
      this.fx.shock(this.ctrl.pos, 0xffe08a, 4, 0.8);
      this.cube.kick(0.9);
      if (this.manager.current) this.manager.current.flash = 1;
    } else if (to === G.FIST) {
      this.cube.kick(0.3);
    }
  }
}
