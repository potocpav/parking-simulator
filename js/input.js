// Keyboard + multi-touch on-screen controls.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = new Map(); // pointerId -> control
    this.enabled = false;
    this.handlers = { pause: () => {}, reset: () => {}, any: () => {} };

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.clear());
  }

  on(name, fn) { this.handlers[name] = fn; }

  onKey(e, down) {
    if (!this.enabled) return;
    if (e.target && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName) && e.code !== 'Escape') return;
    const ctl = KEYMAP[e.code];
    if (ctl) {
      e.preventDefault();
      if (down) { this.keys.add(ctl); this.handlers.any(); } else this.keys.delete(ctl);
      return;
    }
    if (!down) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.handlers.pause();
    } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.handlers.reset();
    }
  }

  /** Wire on-screen buttons that carry data-ctl="left|right|up|down". */
  bindTouch(root) {
    const release = (e) => {
      const ctl = this.touch.get(e.pointerId);
      if (!ctl) return;
      this.touch.delete(e.pointerId);
      if (![...this.touch.values()].includes(ctl)) {
        root.querySelectorAll(`[data-ctl="${ctl}"]`).forEach((b) => b.classList.remove('active'));
      }
    };
    root.querySelectorAll('[data-ctl]').forEach((btn) => {
      const ctl = btn.dataset.ctl;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        btn.classList.add('active');
        this.handlers.any();
        this.touch.set(e.pointerId, ctl);
      });
      btn.addEventListener('pointerup', (e) => { release(e); btn.classList.remove('active'); });
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  has(ctl) {
    if (this.keys.has(ctl)) return true;
    for (const v of this.touch.values()) if (v === ctl) return true;
    return false;
  }

  get left() { return this.has('left'); }
  get right() { return this.has('right'); }
  get up() { return this.has('up'); }
  get down() { return this.has('down'); }

  clear() {
    this.keys.clear();
    this.touch.clear();
    document.querySelectorAll('[data-ctl].active').forEach((b) => b.classList.remove('active'));
  }
}
