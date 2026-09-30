/**
 * Robust webcam start (kept from the working original implementation, with
 * clearer error reporting). Video element must be: autoplay, playsinline, muted.
 */
export async function startWebcam(video, onStatus = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia tidak tersedia (gunakan localhost / https).');
  }
  onStatus('REQUESTING CAMERA');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: { ideal: 'user' }
      }
    });
  } catch (e) {
    const map = {
      NotAllowedError: 'Izin kamera ditolak. Izinkan kamera di browser lalu refresh.',
      NotFoundError: 'Kamera tidak ditemukan.',
      NotReadableError: 'Kamera sedang dipakai aplikasi lain.',
      OverconstrainedError: 'Kamera tidak mendukung resolusi yang diminta.'
    };
    throw new Error(map[e.name] || `Kamera gagal: ${e.message || e.name}`);
  }

  if (!stream.getVideoTracks().length) throw new Error('Tidak ada video track dari kamera.');

  video.srcObject = stream;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error('Timeout menunggu video kamera.')); }
    }, 10000);
    const ready = () => {
      if (done) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        done = true; clearTimeout(timer); resolve();
      }
    };
    video.onloadedmetadata = ready;
    video.oncanplay = ready;
    video.onplaying = ready;
    ready();
  });

  if (video.paused) await video.play();

  await new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => resolve());
    else requestAnimationFrame(() => resolve());
  });

  onStatus('CAMERA READY');
  return stream;
}
