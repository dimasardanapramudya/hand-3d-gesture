# Hand 3D Gesture — Holographic WebAR Installation

Webcam → MediaPipe Hand Landmarker → gesture/motion engine → spring-physics 3D objects (GLB) + realtime FX.

## Menjalankan
```bash
npm install      # hanya jika node_modules belum ada / rusak
npm run dev      # buka http://localhost:5173/  (Chrome, izinkan kamera)
npm run build    # production build
npm test         # tes logika gesture / two-hand / fisika (tanpa browser)
```
Model MediaPipe (`hand_landmarker.task`) diunduh dari Google saat start (butuh internet).
Untuk offline: simpan file itu ke `public/models/hand_landmarker.task` — otomatis dipakai.

## Keyboard
| Key | Aksi |
|---|---|
| 1 / 2 / 3 | Butterfly / Planet / Robot (transisi sinematik) |
| R | Reset objek (posisi, scale, rotasi) |
| H | Toggle hand skeleton |
| D | Toggle debug panel |

## Gesture
| Gesture | Efek |
|---|---|
| POINT (tahan ~0.4s, 1 tangan) | Butterfly + kursor holografik di ujung telunjuk |
| PEACE (tahan ~0.4s) | Planet |
| OPEN PALM (tahan ~0.4s) | Robot (lari saat digerakkan cepat, tinju/lompat saat swipe, dance saat 2 tangan) |
| PINCH | Grab: objek mengikuti kuat, reticle, partikel tertarik; putar tangan = roll |
| PINCH RELEASE | Objek dilepas dengan inertia (throw) |
| FIST | Objek "diremas" (mengecil sementara) |
| THUMBS UP | Burst emas + flash |
| SWIPE ← → ↑ ↓ | Dash / spin sesuai objek |
| 2 TANGAN | Midpoint = posisi, jarak = scale, sudut antar tangan = roll (kontinu), selisih kedalaman = yaw |

Objek berganti hanya saat 1 tangan terdeteksi (agar tidak berganti liar saat 2 tangan dipakai).

## Struktur
```
src/
  main.js                 bootstrap, loop, fault isolation
  core/                   renderer (alpha:true, tanpa scene.background), camera + ViewMapper, webcam
  tracking/               HandTracker (MediaPipe), MotionTracker (One-Euro, velocity, fitur), GestureEngine
  interaction/            ObjectController (spring), HandController, TwoHandController
  objects/                ObjectManager + Butterfly/Planet/Robot behavior
  effects/                HandSkeleton, MotionTrail, ParticleSystem, InteractionFX, HoloCube, GlowLines
  ui/HUD.js  utils/math.js
```
Layer: video z-index 0 · canvas transparan z-index 1 · UI z-index 10.
