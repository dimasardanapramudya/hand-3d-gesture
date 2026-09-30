import * as THREE from 'three';
import { angleDelta, clamp, damp, DeadAccumulator } from '../utils/math.js';

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Two hands as a 3D controller.
 *  midpoint            -> position (spring-followed)
 *  distance ratio      -> scale (relative to the moment both hands appeared)
 *  angle between hands -> roll; CONTINUOUS delta (never raw atan2 => no flipping)
 *  depth difference    -> yaw (log ratio of apparent hand sizes)
 */
export class TwoHandController {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.active = false;
    this.mid = new THREE.Vector3();
    this.prevAngle = 0; this.baseDist = 1; this.baseScale = 1; this.prevYaw = 0; this.yawS = 0;
    this.distance = 0; this.angle = 0;
    this.rollAcc = new DeadAccumulator(0.004);
    this.yawAcc = new DeadAccumulator(0.004);
  }

  update(dt, L, R) {
    const c = this.ctrl;
    if (!L || !R) { this.active = false; return false; }

    this.mid.addVectors(L.palm, R.palm).multiplyScalar(0.5);
    const dx = R.palm.x - L.palm.x, dy = R.palm.y - L.palm.y;
    const dist = Math.max(0.05, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const yawSig = Math.log(Math.max(1, L.palmSize) / Math.max(1, R.palmSize));

    if (!this.active) { // engage: capture baselines so nothing jumps
      this.active = true;
      this.baseDist = dist; this.baseScale = c.targetScale;
      this.prevAngle = angle; this.yawS = yawSig; this.prevYaw = yawSig;
      this.rollAcc.reset(); this.yawAcc.reset();
    }
    this.distance = dist; this.angle = angle;

    // position
    c.setTarget(this.mid);

    // scale: hands apart -> bigger, together -> smaller
    c.targetScale = damp(c.targetScale, clamp(this.baseScale * (dist / this.baseDist), 0.35, 3.2), 18, dt);

    // roll (continuous delta with dead-zone)
    const d = this.rollAcc.push(angleDelta(this.prevAngle, angle));
    this.prevAngle = angle;
    c.rotateTarget(Z, d);

    // yaw from depth difference (smoothed, dead-zone, delta based)
    this.yawS = damp(this.yawS, yawSig, 10, dt);
    const dy2 = this.yawAcc.push(this.yawS - this.prevYaw);
    this.prevYaw = this.yawS;
    c.rotateTarget(Y, dy2 * 2.2);

    return true;
  }
}
