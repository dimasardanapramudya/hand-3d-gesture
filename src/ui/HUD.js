/** Minimal futuristic HUD + toast + optional debug panel. */
export class HUD {
  constructor() {
    this.$track = document.getElementById('hud-track');
    this.$gesture = document.getElementById('hud-gesture');
    this.$object = document.getElementById('hud-object');
    this.$toast = document.getElementById('toast');
    this.$debug = document.getElementById('debug');
    this.$hud = document.getElementById('hud');
    this._toastTimer = 0;
    this._last = {};
    this.debug = false;
  }
  _set(el, key, text, state) {
    const k = text + '|' + (state || '');
    if (this._last[key] === k) return;
    this._last[key] = k;
    el.textContent = text;
    if (state !== undefined) el.dataset.state = state;
  }
  setTracking(text, state = 'ok') { this._set(this.$track, 't', text, state); }
  setGesture(text) { this._set(this.$gesture, 'g', text); }
  setObject(text) { this._set(this.$object, 'o', text); }
  toast(msg, ms = 4500, level = 'warn') {
    this.$toast.textContent = msg;
    this.$toast.dataset.level = level;
    this.$toast.classList.add('show');
    clearTimeout(this._toastTimer);
    if (ms > 0) this._toastTimer = setTimeout(() => this.$toast.classList.remove('show'), ms);
  }
  toggleDebug() {
    this.debug = !this.debug;
    this.$debug.hidden = !this.debug;
    return this.debug;
  }
  setDebug(text) { if (this.debug) this.$debug.textContent = text; }
}
