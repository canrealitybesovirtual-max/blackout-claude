// Device-agnostic input: keyboard+mouse (pointer lock, drag fallback), standard gamepad, touch.
// Gameplay reads one action state; devices only write into it.
export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.sens = 1; this.invertY = false;
    this.move = { x: 0, y: 0 }; this.look = { x: 0, y: 0 };
    this.held = { fire: false, aim: false, sprint: false };
    this.pressed = new Set();     // edge-triggered actions this frame
    this.crouch = false;
    this.keys = new Set();
    this.locked = false; this.dragLook = false; this.device = 'kbm';
    this.enabled = false;
    this._mouseBtn = 0;
    this._touch = { stick: null, look: null, fire: false, aim: false };
    this._pad = { prev: [] };
    this._bind();
    if (touchRoot) this._buildTouch(touchRoot);
  }
  _bind() {
    const c = this.canvas;
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code); this.device = 'kbm';
      const map = { KeyR: 'reload', KeyE: 'use', KeyF: 'light', KeyV: 'mode', KeyT: 'inspect', Digit1: 'slot1', Digit2: 'slot2', KeyQ: 'swap', Space: 'jump', KeyP: 'perf', KeyK: 'fireTap' };
      if (map[e.code]) this.pressed.add(map[e.code]);
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.held.fire = this.held.aim = false; this._mouseBtn = 0; });
    c.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      this.device = 'kbm';
      if (!this.locked && !this.dragLook) this.requestLock();
      this._mouseBtn |= 1 << e.button;
      if (e.button === 0) this.held.fire = true;
      if (e.button === 2) this.held.aim = true;
    });
    addEventListener('mouseup', e => {
      this._mouseBtn &= ~(1 << e.button);
      if (e.button === 0) this.held.fire = false;
      if (e.button === 2) this.held.aim = false;
    });
    c.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (this.locked || (this.dragLook && this._mouseBtn)) {
        const k = 0.0022 * this.sens;
        this.look.x -= e.movementX * k;
        this.look.y -= e.movementY * k * (this.invertY ? -1 : 1);
      }
    });
    addEventListener('wheel', e => { if (this.enabled) this.pressed.add(e.deltaY > 0 ? 'next' : 'prev'); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked && this.onUnlock) this.onUnlock();
    });
    document.addEventListener('pointerlockerror', () => { this.dragLook = true; });
  }
  requestLock() {
    if (this.dragLook || !this.canvas.requestPointerLock) { this.dragLook = true; return; }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { this.dragLook = true; } });
    } catch (e) { this.dragLook = true; }
  }
  _buildTouch(root) {
    const t = this._touch;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    root.style.display = 'block';
    const stickEl = root.querySelector('#stick'), knob = root.querySelector('#knob');
    const lookEl = root.querySelector('#lookpad');
    const R = 56;
    stickEl.addEventListener('touchstart', e => { const tt = e.changedTouches[0]; t.stick = { id: tt.identifier, x: tt.clientX, y: tt.clientY }; this.device = 'touch'; e.preventDefault(); }, { passive: false });
    lookEl.addEventListener('touchstart', e => { const tt = e.changedTouches[0]; t.look = { id: tt.identifier, x: tt.clientX, y: tt.clientY }; this.device = 'touch'; e.preventDefault(); }, { passive: false });
    const moveH = e => {
      for (const tt of e.changedTouches) {
        if (t.stick && tt.identifier === t.stick.id) {
          let dx = (tt.clientX - t.stick.x) / R, dy = (tt.clientY - t.stick.y) / R;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.move.x = dx; this.move.y = -dy; this.held.sprint = l > 1.35 && dy < -0.6;
          knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
        }
        if (t.look && tt.identifier === t.look.id) {
          const k = 0.0052 * this.sens;
          this.look.x -= (tt.clientX - t.look.x) * k; this.look.y -= (tt.clientY - t.look.y) * k * (this.invertY ? -1 : 1);
          t.look.x = tt.clientX; t.look.y = tt.clientY;
        }
      }
    };
    const endH = e => {
      for (const tt of e.changedTouches) {
        if (t.stick && tt.identifier === t.stick.id) { t.stick = null; this.move.x = this.move.y = 0; this.held.sprint = false; knob.style.transform = ''; }
        if (t.look && tt.identifier === t.look.id) t.look = null;
      }
    };
    addEventListener('touchmove', moveH, { passive: true });
    addEventListener('touchend', endH); addEventListener('touchcancel', endH);
    root.querySelectorAll('[data-act]').forEach(b => {
      const act = b.dataset.act;
      b.addEventListener('touchstart', e => {
        e.preventDefault(); this.device = 'touch'; b.classList.add('on');
        if (act === 'fire') t.fire = true; else if (act === 'aim') t.aim = !t.aim; else if (act === 'crouch') this.crouch = !this.crouch; else this.pressed.add(act);
        // dragging on the fire button also aims the camera
        if (act === 'fire') { const tt = e.changedTouches[0]; t.look = { id: tt.identifier, x: tt.clientX, y: tt.clientY }; }
      }, { passive: false });
      b.addEventListener('touchend', e => { e.preventDefault(); b.classList.remove('on'); if (act === 'fire') t.fire = false; }, { passive: false });
    });
  }
  _pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null; for (const g of pads) if (g && g.connected) { p = g; break; }
    if (!p) return false;
    const dz = v => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
    const ax = dz(p.axes[0] || 0), ay = dz(p.axes[1] || 0), rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
    const b = i => p.buttons[i] ? p.buttons[i].value > 0.4 : false;
    const prev = this._pad.prev, edge = i => b(i) && !prev[i];
    const active = Math.abs(ax) + Math.abs(ay) + Math.abs(rx) + Math.abs(ry) > 0 || p.buttons.some(x => x.pressed);
    if (active) this.device = 'pad';
    if (this.device !== 'pad') { this._pad.prev = p.buttons.map((x, i) => b(i)); return false; }
    this.move.x = ax; this.move.y = -ay;
    const curve = v => Math.sign(v) * v * v;
    const sp = 3.4 * this.sens * dt;
    this.look.x -= curve(rx) * sp; this.look.y -= curve(ry) * sp * 0.75 * (this.invertY ? -1 : 1);
    this.held.fire = b(7); this.held.aim = b(6);
    if (edge(10)) this.held.sprint = !this.held.sprint;
    if (Math.hypot(ax, ay) < 0.3) this.held.sprint = false;
    const map = { 0: 'jump', 2: 'reload', 3: 'swap', 4: 'light', 5: 'use', 11: 'inspect', 13: 'mode', 8: 'perf', 9: 'pause' };
    for (const k in map) if (edge(+k)) this.pressed.add(map[k]);
    if (edge(1)) this.crouch = !this.crouch;
    this._pad.prev = p.buttons.map((x, i) => b(i));
    return true;
  }
  update(dt) {
    if (!this.enabled) { this.move.x = this.move.y = 0; return; }
    if (this.device === 'xr') return; // the XR rig writes move / actions
    const padActive = this._pollPad(dt);
    if (this.device === 'kbm') {
      const k = this.keys;
      this.move.x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      this.move.y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      this.held.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    } else if (this.device === 'touch') {
      this.held.fire = this._touch.fire; this.held.aim = this._touch.aim;
    } else if (!padActive) { this.move.x = this.move.y = 0; }
  }
  consumeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0; return l; }
  endFrame() { this.pressed.clear(); }
  has(a) { return this.pressed.has(a); }
}
