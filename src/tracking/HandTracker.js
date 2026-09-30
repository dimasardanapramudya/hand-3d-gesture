import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { clamp, lerp } from '../utils/math.js';

const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const LOCAL_MODEL = '/models/hand_landmarker.task'; // optional offline copy

async function localModelExists() {
  try {
    const r = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    return r.ok && !type.includes('text/html'); // Vite SPA fallback returns html
  } catch { return false; }
}

/**
 * MediaPipe wrapper. Throttled to ~20-30 FPS and adaptive to inference cost so
 * the 60 FPS render loop never starves. Failure never throws into the app loop.
 */
export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.ready = false;
    this.failed = false;
    this.delegate = '';
    this.fps = 0;
    this.avgMs = 15;
    this.interval = 40;
    this.lastT = 0;
    this.lastResultT = 0;
    this.lastVideoTime = -1;
    this.lastStamp = 0;
    this.errors = 0;
    this.pending = null; // injected result (tests / simulation)
  }

  async init(onStatus = () => {}) {
    onStatus('LOADING MODEL');
    const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
    const urls = (await localModelExists()) ? [LOCAL_MODEL, REMOTE_MODEL] : [REMOTE_MODEL];
    let lastError = null;
    for (const url of urls) {
      for (const delegate of ['GPU', 'CPU']) {
        try {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: url, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.55
          });
          this.delegate = delegate;
          this.ready = true;
          return;
        } catch (e) {
          lastError = e;
          console.warn(`HandLandmarker init failed (${delegate}, ${url}):`, e);
        }
      }
    }
    this.failed = true;
    throw lastError || new Error('HandLandmarker gagal dibuat.');
  }

  inject(landmarks, handedness = []) {
    this.pending = { landmarks, handedness, t: performance.now() };
  }

  /** Returns a fresh result or null when nothing new to process. */
  detect(now) {
    if (this.pending) {
      const r = this.pending;
      this.pending = null;
      return r;
    }
    const v = this.video;
    if (!this.ready || v.readyState < 2 || !v.videoWidth) return null;
    if (now - this.lastT < this.interval) return null;
    if (v.currentTime === this.lastVideoTime) return null;

    this.lastT = now;
    this.lastVideoTime = v.currentTime;
    const stamp = Math.max(now, this.lastStamp + 1);
    this.lastStamp = stamp;

    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(v, stamp);
    } catch (e) {
      if (++this.errors === 1) console.error('MediaPipe frame error:', e);
      if (this.errors > 25) { this.ready = false; this.failed = true; }
      return null;
    }
    const dur = performance.now() - t0;
    this.avgMs = lerp(this.avgMs, dur, 0.1);
    this.interval = clamp(this.avgMs * 1.6, 34, 50); // stay within 20-29 FPS
    if (this.lastResultT) this.fps = lerp(this.fps, 1000 / Math.max(1, now - this.lastResultT), 0.15);
    this.lastResultT = now;

    return {
      landmarks: res.landmarks || [],
      handedness: res.handedness || res.handednesses || [],
      t: now
    };
  }
}
