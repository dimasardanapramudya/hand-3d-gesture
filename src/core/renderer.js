import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * CRITICAL (camera compositing):
 *  - alpha: true + clear alpha 0
 *  - scene.background is NEVER set (it would paint an opaque layer over the webcam)
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  fitRenderer(renderer);
  return renderer;
}

export function fitRenderer(renderer, camera) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (camera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
}

export function createScene(renderer) {
  const scene = new THREE.Scene(); // no background -> transparent

  // Image based lighting (procedural, no network)
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
  } catch (e) {
    console.warn('Environment lighting unavailable:', e);
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x182033, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(4, 5, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 1.3);
  fill.position.set(-5, 1, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd6aa, 1.6);
  rim.position.set(0, -3, -5);
  scene.add(rim);
  return scene;
}
