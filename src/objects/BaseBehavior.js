import * as THREE from 'three';

const FLASH = new THREE.Color(0xffffff);

/**
 * Base for a GLB-backed interactive object.
 * Hierarchy: root (transition scale) > pivot (procedural motion) > holder (normalisation) > model
 */
export class BaseBehavior {
  constructor(name, { file, label, size = 2.2, accent = 0x7ab7ff, physics = {}, icon = '' }) {
    this.name = name;
    this.file = file;
    this.label = label;
    this.icon = icon;
    this.size = size;
    this.accent = new THREE.Color(accent);
    this.physics = { k: 40, zeta: 0.7, throwDamp: 1.3, maxSpeed: 15, ...physics };
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.root.visible = false;
    this.status = 'idle';       // idle | loading | ready | error
    this.error = '';
    this.materials = [];
    this.opacity = 1;
    this.flash = 0;
    this.appearScale = 1;
    this.wander = 0;            // idle wander amount (used by HandController)
  }

  get ready() { return this.status === 'ready'; }

  async load(loader, maxAniso = 1) {
    this.status = 'loading';
    try {
      const gltf = await loader.loadAsync(this.file);
      const model = gltf.scene;
      if (!model) throw new Error('GLB tidak memiliki scene');

      // Normalise: centre the model, then scale a wrapper (fixes the original
      // bug where centring was applied without accounting for scale).
      model.updateMatrixWorld(true); // skinned rigs: bones must be posed before measuring
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (!(maxDim > 0)) throw new Error('GLB kosong (ukuran 0)');
      model.position.sub(center);
      const holder = new THREE.Group();
      holder.add(model);
      holder.scale.setScalar(this.size / maxDim);
      this.pivot.add(holder);
      this.model = model;
      this.holder = holder;

      const seen = new Set();
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || seen.has(m)) continue;
          seen.add(m);
          m.side = THREE.DoubleSide;
          m.userData.t0 = m.transparent;
          m.userData.o0 = m.opacity;
          m.userData.dw0 = m.depthWrite;
          if (m.emissive) m.userData.e0 = m.emissive.clone();
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
            if (m[k]) m[k].anisotropy = Math.min(4, maxAniso);
          }
          this.materials.push(m);
        }
      });

      this.onLoaded(gltf);
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.error = e?.message || String(e);
      console.error(`GLB "${this.name}" gagal dimuat:`, e);
      throw e;
    }
  }

  onLoaded() {}
  update() {}
  reset() {}
  onGrab() {}
  onRelease() {}
  onSwipe() {}
  onEnter() {}
  onGesture() {}

  setOpacity(a) {
    this.opacity = a;
    for (const m of this.materials) {
      const solid = a >= 0.999;
      const t = solid ? m.userData.t0 : true;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; } // OPAQUE define depends on it
      m.opacity = m.userData.o0 * a;
      m.depthWrite = solid ? m.userData.dw0 : false;
    }
  }

  applyFlash(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    for (const m of this.materials) {
      if (!m.emissive) continue;
      m.emissive.copy(m.userData.e0).lerp(FLASH, this.flash * 0.35).lerp(this.accent, this.flash * 0.25);
    }
  }
}
