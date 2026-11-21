import * as THREE from 'three';
import { clamp } from './util.js';

// Admin "inspect map" mode: a free-flying camera for screenshots, not visible to other players.
// Unlocked when this browser holds one of the admin keys (open the site once with ?admin=<key>).
// One key per person, only SHA-256 hashes live here: add / revoke with tools/admin_key.py.
const KEY_HASHES = {
  'ed977d7fb222f9ad81b82c9bda20cfe1386c4b89d0e5a1deb1fa2e6a68b62277': 'khoa',
  '02880a0eb4117ac453569790cb6cb40600e6d9e2984b6e3592ed69528884e628': 'dong-nghiep-1',
  // @admin-keys (tools/admin_key.py inserts new entries above this line)
};
const LS_KEY = 'bkbg_admin_key';

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function verifyAdminKey(rawKey) {
  const k = String(rawKey || '').trim();
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!k) return isLocal ? 'local-dev' : null;
  try {
    const label = KEY_HASHES[await sha256(k)] || (isLocal && (k === 'dev' || k === 'admin' || k === 'localhost') ? 'local-dev' : null);
    if (label) {
      try { localStorage.setItem(LS_KEY, k); } catch {}
    }
    return label;
  } catch {
    return isLocal ? 'local-dev' : null;
  }
}

export async function loadAdminKey() {
  const qs = new URLSearchParams(location.search);
  const fromUrl = qs.get('admin');
  if (fromUrl) {
    try { localStorage.setItem(LS_KEY, fromUrl); } catch {}
    qs.delete('admin');  // don't leave the key in the address bar / screenshots
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
  }
  let k = fromUrl;
  if (!k) try { k = localStorage.getItem(LS_KEY); } catch {}
  if (k) {
    try {
      const matched = KEY_HASHES[await sha256(k)];
      if (matched) return matched;
    } catch {}
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'local-dev';
  return null;
}

export class Inspector {
  constructor({ camera, canvas, onExit, onCycleTime }) {
    this.camera = camera; this.canvas = canvas; this.onExit = onExit; this.onCycleTime = onCycleTime || null;
    this.active = false; this.keys = {};
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0;
    this.speed = 25; this.fov = 70; this.hideUi = false;
    this.el = document.createElement('div');
    this.el.className = 'inspect-ui hidden';
    this.el.innerHTML = `
      <div class="inspect-coords"></div>
      <div class="inspect-help">Click: điều khiển · WASD bay · Space/C lên/xuống · Shift nhanh · Lăn chuột: tốc độ · [ ] FOV · N: ngày/đêm · /: lệnh admin · P: copy toạ độ · H: ẩn chữ · Backspace: về lobby</div>
      <div class="inspect-toast"></div>`;
    document.body.appendChild(this.el);
    this.coords = this.el.querySelector('.inspect-coords');
    this.toast = this.el.querySelector('.inspect-toast');

    addEventListener('keydown', (e) => {
      if (!this.active || (e.target && e.target.tagName === 'INPUT')) return;
      this.keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.code === 'KeyH') { this.hideUi = !this.hideUi; this.el.classList.toggle('bare', this.hideUi); }
      if (e.code === 'KeyP') this.copy();
      if (e.code === 'KeyN' && this.onCycleTime) { const label = this.onCycleTime(); if (label) this.flash(`Thời gian: ${label}`); }
      if (e.code === 'BracketLeft') this.fov = clamp(this.fov - 5, 20, 110);
      if (e.code === 'BracketRight') this.fov = clamp(this.fov + 5, 20, 110);
      if (e.code === 'Backspace') { e.preventDefault(); this.exit(); }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.55, 1.55);
    });
    addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.speed = clamp(this.speed * (e.deltaY > 0 ? 0.8 : 1.25), 2, 400);
      this.flash(`Tốc độ ${this.speed.toFixed(0)} m/s`);
    });
    canvas.addEventListener('click', () => { if (this.active && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
  }
  enter() {
    this.active = true;
    // start from the current (lobby) camera
    this.pos.copy(this.camera.position);
    const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.el.classList.remove('hidden');
    this.canvas.requestPointerLock();
  }
  exit() {
    this.active = false; this.keys = {};
    this.el.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onExit();
  }
  text() {
    const p = this.pos, deg = (r) => Math.round(THREE.MathUtils.radToDeg(r));
    return `x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} z=${p.z.toFixed(1)} · yaw=${deg(this.yaw)}° pitch=${deg(this.pitch)}° · fov=${this.fov}`;
  }
  copy() {
    navigator.clipboard?.writeText(this.text()).then(() => this.flash('Đã copy toạ độ'), () => this.flash('Không copy được'));
  }
  flash(t) { this.toast.textContent = t; this.toast.classList.add('on'); clearTimeout(this._t); this._t = setTimeout(() => this.toast.classList.remove('on'), 1200); }
  update(dt) {
    const k = this.keys, cam = this.camera;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const u = (k.Space ? 1 : 0) - (k.KeyC || k.ControlLeft ? 1 : 0);
    const sp = this.speed * (k.ShiftLeft || k.ShiftRight ? 4 : 1) * dt;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch);
    // forward follows the view (including pitch), strafe stays horizontal
    this.pos.x += (-sy * cp * f + cy * r) * sp;
    this.pos.z += (-cy * cp * f - sy * r) * sp;
    this.pos.y += (Math.sin(this.pitch) * f + u) * sp;
    this.pos.y = Math.max(0.3, this.pos.y);
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.coords.textContent = this.text();
  }
}
