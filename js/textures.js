import * as THREE from 'three';
import { mulberry32 } from './util.js';

const rng = mulberry32(99);

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, amt, alpha = 1) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    if (alpha !== 1) d[i + 3] = 255 * alpha;
  }
  g.putImageData(img, 0, 0);
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/* Facade tile: 1 floor (3.5 m) tall, 4 m wide. */
export function facade(style) {
  const [c, g] = cv(256, 224);
  const W = 256, H = 224;
  const s = {
    cream:    { wall: '#ece3cf', win: '#5d86b5', frame: '#fbf7ee', cols: 2 },
    white:    { wall: '#eef1f3', win: '#4f7fae', frame: '#ffffff', cols: 3 },
    yellow:   { wall: '#e9cf8c', win: '#5b7fa3', frame: '#f6ecd0', cols: 2 },
    grey:     { wall: '#c3c7c9', win: '#55708c', frame: '#e3e6e8', cols: 3 },
    corridor: { wall: '#e8e2d2', win: '#4b6a8c', frame: '#ffffff', cols: 2 },
    glass:    { wall: '#7fa9cf', win: '#9cc4e6', frame: '#dfe9f2', cols: 4 },
    shed:     { wall: '#b9c3c8', win: '#6c8aa3', frame: '#dfe5e8', cols: 1 },
    city1:    { wall: '#d9cdb8', win: '#57708a', frame: '#efe6d6', cols: 3 },
    city2:    { wall: '#b8c4cc', win: '#4f6a85', frame: '#dfe6ea', cols: 2 },
    city3:    { wall: '#e6b9a0', win: '#5b7591', frame: '#f4dccd', cols: 2 },
  }[style];
  g.fillStyle = s.wall; g.fillRect(0, 0, W, H);
  noise(g, W, H, 10);
  if (style === 'corridor') {
    // open corridor: dark recess band, white railing, pillars
    g.fillStyle = '#5b5f63'; g.fillRect(0, 34, W, 150);
    g.fillStyle = shade(s.win, 0.85);
    g.fillRect(40, 60, 70, 110); g.fillRect(150, 60, 70, 110);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(40, 60, 22, 110); g.fillRect(150, 60, 22, 110);
    g.fillStyle = '#3c4044'; g.fillRect(118, 70, 24, 114); // door
    g.fillStyle = s.wall; g.fillRect(0, 140, W, 44); // railing wall
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 140, W, 4);
    g.fillStyle = shade(s.wall, 1.04); g.fillRect(0, 0, 14, H); g.fillRect(W - 14, 0, 14, H); // pillars
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(14, 0, 3, H); g.fillRect(W - 17, 0, 3, H);
  } else if (style === 'glass') {
    for (let i = 0; i < 4; i++) {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#b9d6ee'); grd.addColorStop(1, '#4f80ad');
      g.fillStyle = grd; g.fillRect(i * 64 + 3, 6, 58, H - 12);
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(i * 64 + 6, 6, 14, H - 12);
    }
    g.fillStyle = '#dfe9f2'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6);
  } else if (style === 'shed') {
    for (let x = 0; x < W; x += 8) { g.fillStyle = x % 16 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 4, H); }
    g.fillStyle = s.win; g.fillRect(0, 40, W, 34);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 40, W, 8);
  } else {
    const cols = s.cols, ww = W / cols;
    for (let i = 0; i < cols; i++) {
      const x = i * ww + ww * 0.16, w = ww * 0.68, y = 52, h = 118;
      g.fillStyle = s.frame; g.fillRect(x - 5, y - 5, w + 10, h + 14);
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, shade(s.win, 1.35)); grd.addColorStop(1, shade(s.win, 0.8));
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, w * 0.28, h);
      g.fillStyle = s.frame; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.35, w, 3);
      // AC unit sometimes
      if (style !== 'yellow' && rng() < 0.25) { g.fillStyle = '#d9dcde'; g.fillRect(x + w * 0.6, y + h + 12, 30, 20); }
    }
  }
  // floor slab line
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, H - 8, W, 8);
  g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, H - 10, W, 2);
  return tex(c);
}

export function roof(color, kind = 'flat') {
  const [c, g] = cv(128, 128);
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  if (kind === 'tile') {
    for (let y = 0; y < 128; y += 8) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, 128, 2); }
    for (let x = 0; x < 128; x += 16) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, 0, 6, 128); }
  } else if (kind === 'metal') {
    for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x, 0, 3, 128); g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(x + 4, 0, 2, 128); }
  } else if (kind === 'solar') {
    g.fillStyle = '#c9cccf'; g.fillRect(0, 0, 128, 128);
    for (let y = 6; y < 128; y += 30) for (let x = 6; x < 128; x += 40) {
      g.fillStyle = '#26365e'; g.fillRect(x, y, 34, 24);
      g.strokeStyle = 'rgba(160,190,255,0.35)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + i * 8.5, y); g.lineTo(x + i * 8.5, y + 24); g.stroke(); }
      g.beginPath(); g.moveTo(x, y + 12); g.lineTo(x + 34, y + 12); g.stroke();
    }
  } else {
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.06})`; g.fillRect(rng() * 128, rng() * 128, 10 + rng() * 30, 2 + rng() * 10); }
  }
  noise(g, 128, 128, 12);
  return tex(c);
}

export function asphalt() {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#4a4f55'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 26);
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`; g.beginPath(); g.arc(rng() * 256, rng() * 256, 4 + rng() * 26, 0, 7); g.fill(); }
  return tex(c);
}
export function pavers() {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#bdbdb5'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 14);
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(255,255,255,${rng() * 0.08})`; g.fillRect(Math.floor(rng() * 8) * 32, Math.floor(rng() * 8) * 32, 32, 32); }
  return tex(c);
}
export function grass() {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#5f9a45'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(40,90,30,0.35)' : 'rgba(150,200,90,0.25)'; g.fillRect(rng() * 256, rng() * 256, 2, 3 + rng() * 3); }
  noise(g, 256, 256, 14);
  return tex(c);
}
export function field(L = 60, Wd = 40) {
  // L x Wd meter pitch (long side along the texture's u axis)
  const S = Math.min(16, 2048 / L), W = Math.round(L * S), H = Math.round(Wd * S);
  const [c, g] = cv(W, H);
  const stripes = Math.max(12, Math.round(L / 6)) & ~1;
  for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? '#4f9a3c' : '#5aa946'; g.fillRect((i * W) / stripes, 0, W / stripes + 1, H); }
  noise(g, W, H, 10);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.14 * S;
  const m = 1.5 * S;
  g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  g.beginPath(); g.moveTo(W / 2, m); g.lineTo(W / 2, H - m); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 5.5 * S, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 0.3 * S, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  const pbw = 9 * S, pbh = 22 * S, gbw = 3.5 * S, gbh = 11 * S;
  g.strokeRect(m, H / 2 - pbh / 2, pbw, pbh); g.strokeRect(W - m - pbw, H / 2 - pbh / 2, pbw, pbh);
  g.strokeRect(m, H / 2 - gbh / 2, gbw, gbh); g.strokeRect(W - m - gbw, H / 2 - gbh / 2, gbw, gbh);
  g.beginPath(); g.arc(m + pbw, H / 2, 3.5 * S, -1.1, 1.1); g.stroke();
  g.beginPath(); g.arc(W - m - pbw, H / 2, 3.5 * S, Math.PI - 1.1, Math.PI + 1.1); g.stroke();
  return tex(c, false);
}
export function court() {
  const S = 20, W = 28 * S, H = 15 * S;
  const [c, g] = cv(W, H);
  g.fillStyle = '#3b6fb0'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#c96f3b'; g.fillRect(S, S, W - 2 * S, H - 2 * S);
  noise(g, W, H, 10);
  g.strokeStyle = '#fff'; g.lineWidth = 0.1 * S;
  g.strokeRect(S, S, W - 2 * S, H - 2 * S);
  g.beginPath(); g.moveTo(W / 2, S); g.lineTo(W / 2, H - S); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 1.8 * S, 0, 7); g.stroke();
  for (const side of [0, 1]) {
    const x0 = side ? W - S : S, dir = side ? -1 : 1;
    g.fillStyle = '#3b6fb0'; g.fillRect(side ? x0 - 5.8 * S : x0, H / 2 - 2.45 * S, 5.8 * S, 4.9 * S);
    g.strokeRect(side ? x0 - 5.8 * S : x0, H / 2 - 2.45 * S, 5.8 * S, 4.9 * S);
    g.beginPath(); g.arc(x0 + dir * 1.6 * S, H / 2, 6.75 * S, -Math.PI / 2 + (side ? Math.PI : 0) + (side ? 0.15 : -0.15) * 0, Math.PI / 2 + (side ? Math.PI : 0)); g.stroke();
  }
  return tex(c, false);
}
export function signText(lines, { w = 1024, h = 160, bg = '#0b3d91', fg = '#ffffff', font = 'Be Vietnam Pro' } = {}) {
  const [c, g] = cv(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = i === 0 ? h * (n > 1 ? 0.38 : 0.62) : h * 0.22;
    g.font = `800 ${size}px "${font}", sans-serif`;
    g.fillText(ln, w / 2, n > 1 ? (i === 0 ? h * 0.38 : h * 0.78) : h / 2);
  });
  return tex(c, false);
}
export function faceTexture(skin) {
  const [c, g] = cv(64, 64);
  g.fillStyle = skin; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1b1b';
  g.fillRect(18, 22, 7, 10); g.fillRect(39, 22, 7, 10);
  g.lineWidth = 3.5; g.strokeStyle = '#1b1b1b'; g.lineCap = 'round';
  g.beginPath(); g.arc(32, 36, 12, 0.35, Math.PI - 0.35); g.stroke();
  const t = tex(c, false);
  t.magFilter = THREE.NearestFilter;
  return t;
}
export function nameTag(name, color) {
  const [c, g] = cv(256, 64);
  g.font = '700 30px "Be Vietnam Pro", sans-serif';
  const w = Math.min(248, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(8,14,26,0.6)';
  const x = (256 - w) / 2;
  g.beginPath(); g.roundRect(x, 10, w, 44, 12); g.fill();
  g.fillStyle = color; g.fillRect(x + 10, 26, 6, 12);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 128 + 5, 33, 220);
  const t = tex(c, false);
  return t;
}
export function softDot() {
  const [c, g] = cv(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return tex(c, false);
}
export function flashStar() {
  const [c, g] = cv(128, 128);
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.25, 'rgba(255,210,120,0.9)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(62, 0); g.lineTo(0, 7); g.fill();
  }
  g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill();
  return tex(c, false);
}
export function bulletHole() {
  const [c, g] = cv(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(10,10,10,1)'); grd.addColorStop(0.3, 'rgba(25,25,25,0.95)'); grd.addColorStop(0.55, 'rgba(60,55,50,0.5)'); grd.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return tex(c, false);
}
