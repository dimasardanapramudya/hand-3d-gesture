import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ButterflyBehavior } from './ButterflyBehavior.js';
import { PlanetBehavior } from './PlanetBehavior.js';
import { RobotBehavior } from './RobotBehavior.js';
import { clamp, easeInCubic, easeOutBack } from '../utils/math.js';

const OUT_S = 0.38, IN_S = 0.7;

/**
 * Owns the three behaviours (each GLB is loaded ONCE and cached), the stage
 * group driven by ObjectController, and the cinematic switch transition:
 * shrink + spin + flash + fade  ->  particle burst  ->  pop-in with overshoot.
 */
export class ObjectManager {
  constructor(scene, { particles, fx, cube, onChange, onError, maxAniso = 1 } = {}) {
    this.stage = new THREE.Group();
    scene.add(this.stage);
    this.loader = new GLTFLoader();
    this.particles = particles; this.fx = fx; this.cube = cube;
    this.onChange = onChange || (() => {}); this.onError = onError || (() => {});
    this.maxAniso = maxAniso;
    this.behaviors = {
      butterfly: new ButterflyBehavior(), planet: new PlanetBehavior(), robot: new RobotBehavior()
    };
    for (const b of Object.values(this.behaviors)) this.stage.add(b.root);
    this.current = null;
    this.trans = null;
    this.queued = null;
    this.lastSwitch = 0;
  }

  get name() { return this.current?.name ?? 'butterfly'; }
  get switching() { return !!this.trans; }

  async ensure(name) {
    const b = this.behaviors[name];
    if (!b) return null;
    if (b.status === 'idle') {
      try { await b.load(this.loader, this.maxAniso); }
      catch (e) { this.onError(`GLB ${name} gagal dimuat: ${b.error}`); }
    } else if (b.status === 'loading') {
      while (b.status === 'loading') await new Promise((r) => setTimeout(r, 50));
    }
    return b.ready ? b : null;
  }

  /** Show first object immediately, load the rest in the background. */
  async init(first = 'butterfly') {
    const b = await this.ensure(first);
    if (b) this._show(b, true);
    for (const n of Object.keys(this.behaviors)) if (n !== first) await this.ensure(n);
    if (!this.current) { // first failed: fall back to whatever is available
      const any = Object.values(this.behaviors).find((x) => x.ready);
      if (any) this._show(any, true);
    }
  }

  /** Compile the transparent shader variants once so the first transition doesn't hitch. */
  prewarm(renderer, scene, camera) {
    try {
      const vis = new Map();
      for (const b of Object.values(this.behaviors)) {
        if (!b.ready) continue;
        vis.set(b, b.root.visible);
        b.root.visible = true; b.setOpacity(0.5);
      }
      renderer.compile(scene, camera);
      for (const [b, v] of vis) { b.setOpacity(1); b.root.visible = v; }
    } catch (e) { console.warn('prewarm skipped:', e); }
  }

  _show(b, instant) {
    this.current = b;
    b.root.visible = true; b.setOpacity(1); b.appearScale = instant ? 1 : 0.2; b.flash = 0;
    b.root.scale.setScalar(b.appearScale);
    this.onChange(b);
    b.onEnter({});
  }

  async switchTo(name) {
    const target = this.behaviors[name];
    if (!target || (this.current === target && !this.trans)) return;
    if (this.trans) { this.queued = name; return; }
    const b = await this.ensure(name);
    if (!b) return;
    if (!this.current) { this._show(b, false); this.trans = { phase: 'in', t: 0, to: b, from: null }; return; }
    this.lastSwitch = performance.now();
    this.trans = { phase: 'out', t: 0, from: this.current, to: b };
    this.onChange(b); // HUD updates immediately
  }

  update(dt, t, ctx) {
    const tr = this.trans;
    if (tr) {
      tr.t += dt;
      if (tr.phase === 'out') {
        const p = clamp(tr.t / OUT_S, 0, 1), e = easeInCubic(p);
        const f = tr.from;
        f.appearScale = 1 - 0.8 * e; f.setOpacity(1 - e); f.flash = Math.max(f.flash, e);
        f.root.rotation.y += dt * (2 + 12 * e);
        f.root.scale.set(f.appearScale * (1 + 0.35 * e), f.appearScale * (1 - 0.2 * e), f.appearScale * (1 + 0.35 * e));
        if (this.cube) this.cube.kick(0.5 * e);
        if (p >= 1) {
          f.root.visible = false; f.root.rotation.set(0, 0, 0); f.setOpacity(1); f.flash = 0; f.appearScale = 1; f.reset();
          if (this.particles) { this.particles.burst(ctx.pos, 90, 4.2, f.accent.getHex(), { life: 1.0, size: 11 }); this.particles.burst(ctx.pos, 60, 3, tr.to.accent.getHex(), { life: 1.2, size: 9 }); }
          if (this.fx) { this.fx.shock(ctx.pos, tr.to.accent.getHex(), 4.2, 0.9); }
          this.current = tr.to;
          tr.to.root.visible = true; tr.to.setOpacity(0); tr.to.appearScale = 0.2; tr.to.flash = 1;
          tr.to.root.rotation.y = Math.PI * 1.5;
          tr.phase = 'in'; tr.t = 0;
        }
      } else {
        const p = clamp(tr.t / IN_S, 0, 1), b = tr.to;
        b.appearScale = 0.2 + 0.8 * easeOutBack(p);
        b.setOpacity(clamp(p * 2.2, 0, 1));
        b.flash = Math.max(b.flash, 1 - p);
        b.root.rotation.y = Math.PI * 1.5 * Math.pow(1 - p, 2);
        b.root.scale.setScalar(Math.max(0.01, b.appearScale));
        if (p >= 1) {
          b.setOpacity(1); b.appearScale = 1; b.root.rotation.set(0, 0, 0); b.root.scale.setScalar(1);
          this.trans = null;
          b.onEnter(ctx);
          if (this.queued) { const q = this.queued; this.queued = null; this.switchTo(q); }
        }
      }
      if (tr.phase === 'out') { /* scale set above */ }
    }

    for (const b of Object.values(this.behaviors)) {
      if (!b.root.visible || !b.ready) continue;
      try { b.update(dt, t, ctx); b.applyFlash(dt); }
      catch (e) { if (!b._err) { b._err = true; console.error(`${b.name} update error:`, e); } }
      if (!this.trans || (b !== this.trans.from && b !== this.trans.to)) b.root.scale.setScalar(b.appearScale);
    }
  }
}
