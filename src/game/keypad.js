// Launch control door (far end of the silo bridge): sealed. Pressing it or its keypad asks for the key or the
// access code for a few seconds: the reader's LCD flashes, the card slot LED blinks, a deny tone.
import * as THREE from 'three';
import { makeModelMaterial } from '../render/shaders.js';

export const KEYPAD = { x: 1.125, y: 1.25, z: 64.92, w: 0.17, h: 0.26 };   // on the door frame's right pillar, facing -z

function faceTexture() {   // brushed dark steel plate, 12 rubber keys, card slot (lit: shown with the room's light)
  const c = document.createElement('canvas'); c.width = 170; c.height = 260; const g = c.getContext('2d');
  g.fillStyle = '#2b2d2c'; g.fillRect(0, 0, 170, 260);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(0, i, 170, 1); }
  g.fillStyle = '#0b0c0b'; g.fillRect(14, 12, 142, 58);                       // LCD bezel (the lit LCD sits on it)
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
    const x = 20 + k * 46, y = 84 + r * 38;
    g.fillStyle = '#4a4c4a'; g.fillRect(x, y, 38, 30); g.fillStyle = '#5c5e5b'; g.fillRect(x + 2, y + 2, 34, 22);
    g.fillStyle = '#d8d8d0'; g.font = 'bold 17px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('123456789*0#'[r * 3 + k], x + 19, y + 14);
  }
  g.fillStyle = '#070707'; g.fillRect(30, 240, 110, 8);                       // card slot
  for (const [x, y] of [[7, 7], [163, 7], [7, 253], [163, 253]]) { g.fillStyle = '#777'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  // grime: darker low and round the keys
  const gr = g.createLinearGradient(0, 120, 0, 260); gr.addColorStop(0, 'rgba(20,16,10,0)'); gr.addColorStop(1, 'rgba(30,20,10,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, 170, 260);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class LaunchDoor {
  constructor(scene, audio) {
    this.audio = audio; this.t = 0; this.shown = '';
    const K = KEYPAD;
    this.faceMat = makeModelMaterial(new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.6, metalness: 0.5 }), { ownProbe: true });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(K.w, K.h).rotateY(Math.PI), this.faceMat);
    face.position.set(K.x, K.y, K.z - 0.061); scene.add(face);
    // backlit LCD and the card reader LED (unlit glow)
    this.lcd = document.createElement('canvas'); this.lcd.width = 256; this.lcd.height = 96;
    this.lcdTex = new THREE.CanvasTexture(this.lcd); this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.136, 0.051).rotateY(Math.PI), new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }));
    lcd.position.set(K.x, K.y + K.h / 2 - 0.0415, K.z - 0.0615); scene.add(lcd);
    this.led = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.008).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: 0x400000 }));
    this.led.position.set(K.x + 0.06, K.y - K.h / 2 + 0.017, K.z - 0.0615); scene.add(this.led);
    this.center = [0, 1.2, 64.9]; this.pad = [K.x, K.y, K.z - 0.06];
    this._draw('LOCKED', '#c8281c', '');
  }
  _draw(a, col, b) {
    const key = a + b + col; if (key === this.shown) return; this.shown = key;
    const g = this.lcd.getContext('2d');
    g.fillStyle = '#061008'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 30px monospace'; g.fillText(a, 128, b ? 32 : 48);
    if (b) { g.font = 'bold 22px monospace'; g.fillText(b, 128, 70); }
    this.lcdTex.needsUpdate = true;
  }
  request() {
    if (this.t > 0.4) return;
    this.t = 3.2;
    this.audio.play3D('click', this.pad, { gain: 0.5, maxDist: 8, rate: 1.2 });
    this.audio.play3D('deny', this.pad, { gain: 0.6, maxDist: 14 });
    return 'LAUNCH CONTROL — KEY OR ACCESS CODE REQUIRED';
  }
  probe(sample) {
    if (this.probed) return;
    const U = this.faceMat.uniforms;
    if (sample(this.pad[0], this.pad[1], this.pad[2] - 0.2, U.uAmb.value, U.uPrbPos.value, U.uPrbCol.value, 8)) this.probed = true;
  }
  update(dt) {
    if (this.t > 0) {
      this.t -= dt;
      const on = (this.t * 2.5) % 1 > 0.35;
      if (this.t <= 0) this._draw('LOCKED', '#c8281c', '');
      else if (this.t > 1.6) this._draw(on ? 'INSERT KEY' : '', '#e8a020', on ? 'OR ENTER CODE' : '');
      else this._draw('_ _ _ _', '#e8a020', 'CODE?');
      this.led.material.color.setHex(on ? 0xff2010 : 0x300000);
    }
  }
}
