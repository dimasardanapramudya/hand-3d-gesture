import * as THREE from 'three';

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 100);
  cam.position.set(0, 0, 7.2);
  return cam;
}

/**
 * Maps MediaPipe normalized video coordinates -> Three world coordinates on the
 * z=0 plane, accounting for: object-fit: cover crop, CSS mirror (scaleX(-1)),
 * window aspect ratio. This keeps the holographic skeleton glued to the real hand.
 */
export class ViewMapper {
  constructor(camera) {
    this.camera = camera;
    this.W = 1; this.H = 1; this.vw = 1280; this.vh = 720;
    this.dw = 1; this.dh = 1; this.ox = 0; this.oy = 0;
    this.halfW = 1; this.halfH = 1;
    this.key = '';
  }
  /** returns true when anything changed */
  update(W, H, vw, vh) {
    const key = `${W}x${H}|${vw}x${vh}|${this.camera.fov}`;
    if (key === this.key) return false;
    this.key = key;
    this.W = W; this.H = H;
    this.vw = vw || W; this.vh = vh || H;
    const s = Math.max(W / this.vw, H / this.vh);
    this.dw = this.vw * s; this.dh = this.vh * s;
    this.ox = (W - this.dw) / 2; this.oy = (H - this.dh) / 2;
    this.halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    this.halfW = this.halfH * (W / H);
    return true;
  }
  toWorld(nx, ny, nz, out) {
    const sx = this.W - (nx * this.dw + this.ox); // mirrored
    const sy = ny * this.dh + this.oy;
    out.x = (sx / this.W * 2 - 1) * this.halfW;
    out.y = -(sy / this.H * 2 - 1) * this.halfH;
    out.z = -nz * this.halfW * 0.9;
    return out;
  }
}
