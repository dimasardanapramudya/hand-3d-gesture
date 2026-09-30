import { Emitter, lerp } from '../utils/math.js';

export const G = {
  NONE: 'NONE', OPEN: 'OPEN_PALM', POINT: 'POINT', PEACE: 'PEACE',
  PINCH: 'PINCH', FIST: 'FIST', THUMBS: 'THUMBS_UP'
};
export const GESTURE_LABEL = {
  NONE: '—', OPEN_PALM: 'OPEN PALM', POINT: 'POINT', PEACE: 'PEACE',
  PINCH: 'PINCH', FIST: 'FIST', THUMBS_UP: 'THUMBS UP'
};

const CFG = {
  minHoldMs: 110,      // candidate must be stable this long
  noneHoldMs: 200,     // dropping to NONE needs longer (avoid flicker)
  cooldownMs: 140,     // min time between committed changes
  minScore: 0.55,
  pinchEnter: 0.30, pinchExit: 0.44,
  pinchEnterMs: 50, pinchExitMs: 80, pinchHoldMs: 350,
  // swipe (units: screen heights)
  swipeWindowMs: 300, swipeMinDist: 0.42, swipeMinSpeed: 1.7, swipeAxisRatio: 1.7, swipeCooldownMs: 550
};

const newState = () => ({
  current: G.NONE, candidate: G.NONE, candSince: 0, since: 0, lastChange: 0, conf: 0, heldMs: 0,
  pinch: false, pinchSince: 0, pinchHeld: false, pinchCand: 0, releaseCand: 0,
  hist: [], lastSwipe: 0
});

/**
 * Gesture state machine (per hand).
 * Temporal stability: hold time + confidence + cooldown + hysteresis.
 * Events: 'gesture', 'pinchstart', 'pinchhold', 'pinchrelease', 'swipe'
 */
export class GestureEngine {
  constructor(mapper) {
    this.mapper = mapper;
    this.events = new Emitter();
  }
  on(type, fn) { return this.events.on(type, fn); }
  state(h) { return (h.g ||= newState()); }

  static scores(h) {
    const e = h.ext, c = e.map((v) => 1 - v);
    const thumbish = Math.min(e[0], h.thumbUp);
    return {
      [G.OPEN]: Math.min(e[1], e[2], e[3], e[4]),
      [G.FIST]: Math.min(c[1], c[2], c[3], c[4]) * (1 - thumbish * 0.85),
      [G.POINT]: Math.min(e[1], c[2], c[3], c[4]),
      [G.PEACE]: Math.min(e[1], e[2], c[3], c[4]),
      [G.THUMBS]: Math.min(e[0], h.thumbUp, c[1], c[2], c[3], c[4])
    };
  }

  /** Called once per fresh detection of an active hand. */
  detect(h, now, ctx = {}) {
    const g = this.state(h);

    // ---- pinch with hysteresis + debounce ----
    const canPinch = h.ext[1] > 0.12; // index not fully curled (fist guard)
    if (!g.pinch) {
      if (h.pinchRatio < CFG.pinchEnter && canPinch) {
        g.pinchCand ||= now;
        if (now - g.pinchCand >= CFG.pinchEnterMs) {
          g.pinch = true; g.pinchSince = now; g.pinchHeld = false; g.releaseCand = 0;
          this.events.emit('pinchstart', { hand: h });
        }
      } else g.pinchCand = 0;
    } else if (h.pinchRatio > CFG.pinchExit || !canPinch) {
      g.releaseCand ||= now;
      if (now - g.releaseCand >= CFG.pinchExitMs) this._endPinch(h, g, now);
    } else g.releaseCand = 0;

    // ---- static gestures ----
    const sc = GestureEngine.scores(h);
    let name = G.NONE, best = 0;
    for (const k in sc) if (sc[k] > best) { best = sc[k]; name = k; }
    if (best < CFG.minScore) name = G.NONE;
    if (g.pinch) { name = G.PINCH; best = 1; }
    g.conf = lerp(g.conf, best, 0.5);

    if (name !== g.candidate) { g.candidate = name; g.candSince = now; }
    const need = name === G.NONE ? CFG.noneHoldMs : name === G.PINCH ? 0 : CFG.minHoldMs;
    if (g.candidate !== g.current && now - g.candSince >= need && now - g.lastChange >= CFG.cooldownMs) {
      const from = g.current;
      g.current = g.candidate; g.since = now; g.lastChange = now;
      this.events.emit('gesture', { hand: h, from, to: g.current });
    }

    if (!g.pinch && !ctx.twoHands) this._swipe(h, g, now);
    else g.hist.length = 0;
  }

  _endPinch(h, g, now) {
    const holdMs = now - g.pinchSince;
    g.pinch = false; g.pinchHeld = false; g.pinchCand = 0; g.releaseCand = 0;
    this.events.emit('pinchrelease', { hand: h, holdMs, velocity: h.velocity.clone() });
  }

  _swipe(h, g, now) {
    const sh = 2 * this.mapper.halfH; // world units per screen height
    const hist = g.hist;
    hist.push({ t: now, x: h.palmT.x / sh, y: h.palmT.y / sh });
    while (hist.length && now - hist[0].t > CFG.swipeWindowMs) hist.shift();
    if (hist.length < 3 || now - g.lastSwipe < CFG.swipeCooldownMs) return;

    const a = hist[0], b = hist[hist.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.08) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < CFG.swipeMinDist || dist / dt < CFG.swipeMinSpeed) return;

    let dir = null;
    if (Math.abs(dx) > Math.abs(dy) * CFG.swipeAxisRatio) dir = dx > 0 ? 'RIGHT' : 'LEFT';
    else if (Math.abs(dy) > Math.abs(dx) * CFG.swipeAxisRatio) dir = dy > 0 ? 'UP' : 'DOWN';
    if (!dir) return;

    g.lastSwipe = now;
    hist.length = 0; // one swipe = one event
    this.events.emit('swipe', { hand: h, dir, speed: dist / dt });
  }

  /** Called every render frame for every hand slot. */
  frame(h, now) {
    const g = h.g;
    if (!g) return;
    if (!h.active) {
      if (g.current !== G.NONE || g.pinch) this.reset(h, now);
      return;
    }
    g.heldMs = now - g.since;
    if (g.pinch && !g.pinchHeld && now - g.pinchSince >= CFG.pinchHoldMs) {
      g.pinchHeld = true;
      this.events.emit('pinchhold', { hand: h });
    }
  }

  reset(h, now) {
    const g = h.g;
    if (g.pinch) this._endPinch(h, g, now);
    if (g.current !== G.NONE) this.events.emit('gesture', { hand: h, from: g.current, to: G.NONE });
    h.g = newState();
  }
}
