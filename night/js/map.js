import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildGate } from '../../js/landmarks.js';

// Một tầng trường học dựng bằng khối (newmod.md mục 5). Bố cục lưu dưới dạng các hình chữ nhật
// "không gian" (phòng, hành lang, cửa); tường được sinh tự động trên lưới 0.5 m quanh các không gian
// đó, nên lưới này dùng chung cho va chạm, tìm đường của ma, tầm nhìn và che chắn âm thanh.
//
//                 [ Hội trường (cột) ]
//   [Điện]-armL                       armR-[Xây dựng]
//          armL   [Cơ khí]   [Hoá]    armR
//  sân -- cửa ======== hành lang chính ========
//          [Bảo vệ]   [Xuất phát]   [Máy tính]

export const CELL = 0.5;
export const WALL_H = 3.2;
const GX0 = -92, GZ0 = -22, GW = 300, GH = 120; // lưới: x [-92, 58), z [-22, 38)

export const ROOMS = {
  hall: { name: 'Hành lang', rects: [[-36, -1.5, 36, 1.5], [-36, 1.5, -33, 32], [33, 1.5, 36, 32]] },
  auditorium: { name: 'Hội trường', rects: [[-32.5, 20, 32.5, 32]] },
  guard: { name: 'Phòng bảo vệ', rects: [[-34, -13, -22, -2]] },
  start: { name: 'Phòng xuất phát', rects: [[-6, -13, 6, -2]] },
  cs: { name: 'Phòng Máy tính', rects: [[22, -13, 34, -2]] },
  me: { name: 'Xưởng Cơ khí', rects: [[-20, 2, -6, 13]] },
  ch: { name: 'Phòng thí nghiệm Hoá', rects: [[6, 2, 20, 13]] },
  ee: { name: 'Phòng Điện', rects: [[-48, 18, -36.5, 30]] },
  ce: { name: 'Phòng thí nghiệm Xây dựng', rects: [[36.5, 18, 48, 30]] },
  yard: { name: 'Sân trước cổng', outdoor: true, rects: [[-80, -18, -36.5, 18]] },
};
// cửa: hình chữ nhật khoét qua một hàng ô tường, gắn vào phòng nằm trong
const DOORS = [
  ['guard', [-29, -2, -27, -1.5]],
  ['start', [-1.5, -2, 1.5, -1.5]],
  ['cs', [27, -2, 29, -1.5]],
  ['me', [-14, 1.5, -12, 2]],
  ['ch', [12, 1.5, 14, 2]],
  ['ee', [-36.5, 23, -36, 25]],
  ['ce', [36, 23, 36.5, 25]],
  ['auditorium', [-33, 25, -32.5, 27]],
  ['auditorium', [32.5, 25, 33, 27]],
  ['hall', [-36.5, -1, -36, 1]],      // lối ra sân
];
const PILLARS = [];
for (let x = -24; x <= 24; x += 8) for (const z of [23.5, 28.5]) PILLARS.push([x - 0.5, z - 0.5, x + 0.5, z + 0.5]);

// vị trí tương tác (E)
export const SPOTS = {
  ee: { x: -47.2, z: 24, room: 'ee', label: 'Tủ điện tổng', face: Math.PI / 2 },
  cs: { x: 28, z: -11.8, room: 'cs', label: 'Máy trạm điều khiển', face: 0 },
  me: { x: -13, z: 11.6, room: 'me', label: 'Bàn lắp hộp số', face: 0 },
  ch: { x: 13, z: 11.6, room: 'ch', label: 'Bàn pha dung dịch', face: 0 },
  ce: { x: 47.2, z: 24, room: 'ce', label: 'Khung thử tải', face: -Math.PI / 2 },
  cabinet: { x: -33.4, z: -7.5, room: 'guard', label: 'Tủ khoá', face: Math.PI / 2 },
  gate: { x: -76, z: 0, room: 'yard', label: 'Cổng trường' },
};
export const SPAWNS = [[-2, -6.5], [2, -6.5], [-2, -4.5], [2, -4.5], [0, -5.5]];

// ---------------------------------------------------------------- lưới
const ci = (x) => Math.floor((x - GX0) / CELL), cj = (z) => Math.floor((z - GZ0) / CELL);
export const cx = (i) => GX0 + (i + 0.5) * CELL, cz = (j) => GZ0 + (j + 0.5) * CELL;
const space = new Int8Array(GW * GH).fill(-1);  // chỉ số phòng, -1 = không đi được
const wallG = new Uint8Array(GW * GH);          // 1 = tường (chặn tầm nhìn / âm thanh)
const walkG = new Uint8Array(GW * GH);          // 1 = đi được (đã trừ đồ đạc)
const ROOM_IDS = Object.keys(ROOMS);
function fill(rect, f) {
  const [x0, z0, x1, z1] = rect;
  for (let j = cj(z0 + 1e-3); j <= cj(z1 - 1e-3); j++) for (let i = ci(x0 + 1e-3); i <= ci(x1 - 1e-3); i++) if (i >= 0 && j >= 0 && i < GW && j < GH) f(j * GW + i);
}
ROOM_IDS.forEach((id, k) => { for (const r of ROOMS[id].rects) fill(r, (n) => { space[n] = k; }); });
for (const [id, r] of DOORS) fill(r, (n) => { space[n] = ROOM_IDS.indexOf(id); });
for (const p of PILLARS) fill(p, (n) => { space[n] = -1; });
for (let n = 0; n < GW * GH; n++) {
  if (space[n] >= 0) continue;
  const i = n % GW, j = (n / GW) | 0;
  let adj = false;
  for (let dj = -1; dj <= 1 && !adj; dj++) for (let di = -1; di <= 1; di++) {
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < GW && jj < GH && space[jj * GW + ii] >= 0) { adj = true; break; }
  }
  if (adj) wallG[n] = 1;
}
for (let n = 0; n < GW * GH; n++) walkG[n] = space[n] >= 0 ? 1 : 0;

export function roomAt(x, z) {
  const i = ci(x), j = cj(z);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return null;
  const k = space[j * GW + i];
  return k >= 0 ? ROOM_IDS[k] : null;
}
export function walkable(x, z) {
  const i = ci(x), j = cj(z);
  return i >= 0 && j >= 0 && i < GW && j < GH && walkG[j * GW + i] === 1;
}
// có tường cắt đoạn a-b không (DDA trên lưới)
export function wallBetween(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.5));
  for (let k = 1; k < n; k++) {
    const t = k / n, i = ci(ax + (bx - ax) * t), j = cj(az + (bz - az) * t);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return true;
    if (wallG[j * GW + i]) return true;
  }
  return false;
}
function walkLine(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.5));
  for (let k = 0; k <= n; k++) {
    const t = n ? k / n : 0;
    // bán kính thân ~0.35 m: kiểm tra cả hai bên
    for (const [ox, oz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) if (!walkable(ax + (bx - ax) * t + ox, az + (bz - az) * t + oz)) return false;
  }
  return true;
}
export function randomPointIn(roomId, rng = Math.random) {
  const r = ROOMS[roomId].rects[Math.floor(rng() * ROOMS[roomId].rects.length)];
  for (let k = 0; k < 40; k++) {
    const x = r[0] + 1 + rng() * (r[2] - r[0] - 2), z = r[1] + 1 + rng() * (r[3] - r[1] - 2);
    if (walkable(x, z) && walkable(x + 0.4, z) && walkable(x - 0.4, z) && walkable(x, z + 0.4) && walkable(x, z - 0.4)) return { x, z };
  }
  return { x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2 };
}

// A* 8 hướng trên lưới đi được, rồi làm mượt bằng kiểm tra đường thẳng
export function findPath(ax, az, bx, bz) {
  const s = cj(az) * GW + ci(ax), g = cj(bz) * GW + ci(bx);
  if (!walkG[s] || !walkG[g]) return null;
  const N = GW * GH;
  const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [];  // [f, n]
  const push = (f, n) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const gi = g % GW, gj = (g / GW) | 0;
  const h = (n) => { const dx = Math.abs(n % GW - gi), dz = Math.abs(((n / GW) | 0) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  gs[s] = 0; push(h(s), s);
  const clear = (n) => walkG[n] && (wallG[n] === 0);
  let found = false, iter = 0;
  while (heap.length && iter++ < 60000) {
    const [, n] = pop();
    if (closed[n]) continue;
    closed[n] = 1;
    if (n === g) { found = true; break; }
    const i = n % GW, j = (n / GW) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
      const m = jj * GW + ii;
      if (!clear(m) || closed[m]) continue;
      if (di && dj && (!clear(j * GW + ii) || !clear(jj * GW + i))) continue;
      // tránh sát tường: phạt ô cạnh tường
      let pen = 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (jj + oz) * GW + ii + ox; if (q >= 0 && q < N && !walkG[q]) pen = 1.5; }
      const ng = gs[n] + (di && dj ? 1.414 : 1) + pen;
      if (ng < gs[m]) { gs[m] = ng; from[m] = n; push(ng + h(m), m); }
    }
  }
  if (!found) return null;
  const raw = [];
  for (let n = g; n !== -1; n = from[n]) raw.push([cx(n % GW), cz((n / GW) | 0)]);
  raw.reverse();
  raw[raw.length - 1] = [bx, bz];
  const out = [[ax, az]];
  let k = 0;
  while (k < raw.length - 1) {
    let best = k + 1;
    for (let m = Math.min(raw.length - 1, k + 40); m > k + 1; m--) if (walkLine(raw[k][0], raw[k][1], raw[m][0], raw[m][1])) { best = m; break; }
    out.push(raw[best]);
    k = best;
  }
  return out;
}

// ---------------------------------------------------------------- dựng hình + va chạm
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function grain(g, w, h, amt) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
// tường trường học: nửa dưới sơn xanh, nửa trên vàng kem (1 lần lặp = 4 m ngang, cao WALL_H)
const wallTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#e8dcae'; g.fillRect(0, 0, w, h);
  const dado = h * (1 - 1.2 / WALL_H);
  g.fillStyle = '#5f8a6c'; g.fillRect(0, dado, w, h - dado);
  g.fillStyle = '#3f5f49'; g.fillRect(0, dado - 3, w, 5);
  grain(g, w, h, 18);
  g.fillStyle = 'rgba(60,50,30,0.12)';
  for (let k = 0; k < 6; k++) g.fillRect(Math.random() * w, Math.random() * dado, 2 + Math.random() * 30, 1 + Math.random() * 40);
});
const floorTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#c9c2b2' : '#a99f8d'; g.fillRect(x * 64 + 1, y * 64 + 1, 62, 62); }
  grain(g, w, h, 26);
});
const ceilTex = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#a9a59b'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  grain(g, w, h, 14);
});
const yardTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#5a5b5c'; g.fillRect(0, 0, w, h);
  grain(g, w, h, 40);
  g.strokeStyle = 'rgba(30,30,30,0.5)'; g.lineWidth = 2;
  for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, k * 64); g.lineTo(w, k * 64); g.stroke(); }
});

// greedy merge các ô thành hộp
function mergeCells(mask) {
  const used = new Uint8Array(GW * GH), out = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const n = j * GW + i;
    if (!mask[n] || used[n]) continue;
    let w = 1; while (i + w < GW && mask[n + w] && !used[n + w]) w++;
    let h = 1;
    outer: while (j + h < GH) { for (let k = 0; k < w; k++) { const m = (j + h) * GW + i + k; if (!mask[m] || used[m]) break outer; } h++; }
    for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) used[(j + y) * GW + i + k] = 1;
    out.push([GX0 + i * CELL, GZ0 + j * CELL, GX0 + (i + w) * CELL, GZ0 + (j + h) * CELL]);
  }
  return out;
}
// hộp với UV theo toạ độ thế giới (4 m ngang = 1 lần lặp texture, cao = 1 lần lặp)
function boxGeo(x0, z0, x1, z1, y0, y1, top = true) {
  const pos = [], nor = [], uv = [];
  const quad = (a, b, c, d, n, uvs) => {
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) { pos.push(...p); nor.push(...n); uv.push(...t); }
  };
  const v0 = y0 / WALL_H, v1 = y1 / WALL_H, U = 4;
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 / U, v0], [x1 / U, v0], [x1 / U, v1], [x0 / U, v1]]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[x1 / U, v0], [x0 / U, v0], [x0 / U, v1], [x1 / U, v1]]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[z1 / U, v0], [z0 / U, v0], [z0 / U, v1], [z1 / U, v1]]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 / U, v0], [z1 / U, v0], [z1 / U, v1], [z0 / U, v1]]);
  if (top) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / U, z1 / U], [x1 / U, z1 / U], [x1 / U, z0 / U], [x0 / U, z0 / U]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function planeGeo(x0, z0, x1, z1, y, down = false, U = 4) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k) / U, p.getZ(k) / U);
  return g;
}

// đồ vật trang trí / điểm task
function prop(group, world, mat, x, z, w, d, y0, y1, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), mat);
  m.position.set(x, (y0 + y1) / 2, z); m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  if (collide) {
    world.add(x - w / 2, y0, z - d / 2, x + w / 2, y1, z + d / 2, { mat: 'wood' });
    fill([x - w / 2, z - d / 2, x + w / 2, z + d / 2], (n) => { walkG[n] = 0; });
  }
  return m;
}

export function buildNightMap(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  // tường trong nhà: cao WALL_H; tường sân (hàng rào) thấp hơn, có ánh trăng giả (emissive)
  const outdoorK = ROOM_IDS.indexOf('yard');
  const indoorWall = new Uint8Array(GW * GH), fence = new Uint8Array(GW * GH);
  for (let n = 0; n < GW * GH; n++) {
    if (!wallG[n]) continue;
    const i = n % GW, j = (n / GW) | 0;
    let ind = false;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
      const k = space[jj * GW + ii];
      if (k >= 0 && k !== outdoorK) ind = true;
    }
    if (ind) indoorWall[n] = 1; else fence[n] = 1;
  }
  const wt = wallTex();
  const wallMat = lam({ map: wt });
  const geos = [];
  for (const [x0, z0, x1, z1] of mergeCells(indoorWall)) {
    geos.push(boxGeo(x0, z0, x1, z1, 0, WALL_H + 0.3));
    world.add(x0, 0, z0, x1, WALL_H + 0.3, z1, { mat: 'concrete' });
  }
  const walls = new THREE.Mesh(mergeGeometries(geos), wallMat);
  walls.castShadow = true; walls.receiveShadow = true;
  group.add(walls);
  const fenceMat = lam({ color: 0x8c8a84, emissive: 0x0b1424 });
  const fgeos = [];
  for (const [x0, z0, x1, z1] of mergeCells(fence)) {
    fgeos.push(boxGeo(x0, z0, x1, z1, 0, 2.6));
    world.add(x0, 0, z0, x1, 6, z1, { mat: 'concrete' });  // cao hơn hình để không trèo ra
  }
  const fm = new THREE.Mesh(mergeGeometries(fgeos), fenceMat); fm.receiveShadow = true; fm.castShadow = true;
  group.add(fm);
  // mặt ngoài toà nhà nhìn từ sân: một khối lớn phía sau tường để không thấy "rỗng"
  const shell = new THREE.Mesh(boxGeo(-36.5, -18, -36, 18, 0, 7.5), lam({ color: 0xc9bf9a, emissive: 0x0a1220 }));
  group.add(shell);
  world.add(-36.5, 0, -18, -36, 7.5, -1, {}); world.add(-36.5, 0, 1, -36, 7.5, 18, {}); world.add(-36.5, WALL_H, -1, -36, 7.5, 1, {});

  // sàn, trần
  const fmat = lam({ map: floorTex() }), cmat = lam({ map: ceilTex() }), ymat = lam({ map: yardTex(), emissive: 0x08101c });
  const floors = [], ceils = [], yard = [];
  for (const id of ROOM_IDS) for (const r of ROOMS[id].rects) {
    if (ROOMS[id].outdoor) { yard.push(planeGeo(r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1, 0, false, 6)); continue; }
    floors.push(planeGeo(r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5, 0, false, 2));
    ceils.push(planeGeo(r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5, WALL_H, true, 2));
  }
  for (const [, r] of DOORS) { floors.push(planeGeo(r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5, -0.002, false, 2)); ceils.push(planeGeo(r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5, WALL_H, true, 2)); }
  const fl = new THREE.Mesh(mergeGeometries(floors), fmat); fl.receiveShadow = true; group.add(fl);
  const ce = new THREE.Mesh(mergeGeometries(ceils), cmat); ce.receiveShadow = true; group.add(ce);
  const yd = new THREE.Mesh(mergeGeometries(yard), ymat); yd.receiveShadow = true; group.add(yd);
  // trần chặn nhảy lên mái
  world.add(-50, WALL_H, -15, 50, WALL_H + 1, 34, { bullet: false });
  // nền xa ngoài hàng rào
  const far = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), lam({ color: 0x1d241c, emissive: 0x050a10 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.05; group.add(far);

  // cột hội trường
  const pmat = lam({ color: 0xd8cfae });
  for (const [x0, z0, x1, z1] of PILLARS) prop(group, world, pmat, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0, WALL_H);

  // ---- đồ đạc ----
  const wood = lam({ color: 0x7a5534 }), metal = lam({ color: 0x6f767c }), dark = lam({ color: 0x2a2e33 }), grey = lam({ color: 0x9aa0a4 });
  // phòng xuất phát: bàn ghế, bảng đen
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) prop(group, world, wood, -4 + c * 4, -10.8 + r * 1.8, 2.4, 0.9, 0, 0.75);
  prop(group, world, lam({ color: 0x1f3a2a }), 0, -12.9, 5, 0.1, 0.9, 2.3, false);
  // phòng máy tính: dãy bàn + màn hình phát sáng
  const screen = new THREE.MeshBasicMaterial({ color: 0x2a4f7a });
  for (let r = 0; r < 3; r++) {
    prop(group, world, wood, 28, -9 + r * 2.6 - 0.2, 9, 0.9, 0, 0.75);
    for (let c = 0; c < 4; c++) prop(group, world, screen, 24.5 + c * 2.3, -9 + r * 2.6 - 0.35, 0.6, 0.06, 0.8, 1.2, false);
  }
  prop(group, world, wood, SPOTS.cs.x, SPOTS.cs.z - 0.7, 3, 1, 0, 0.75);
  prop(group, world, new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }), SPOTS.cs.x, SPOTS.cs.z - 0.95, 1.1, 0.06, 0.8, 1.45, false);
  // xưởng cơ khí: bàn nguyên công, máy tiện
  prop(group, world, metal, SPOTS.me.x, SPOTS.me.z + 0.7, 3.2, 1.1, 0, 0.9);
  prop(group, world, dark, -18, 6, 2.5, 1.2, 0, 1.3);
  prop(group, world, dark, -9, 5, 1.6, 1.6, 0, 1.7);
  // phòng hoá: bàn thí nghiệm, tủ hút
  prop(group, world, lam({ color: 0xeeeeee }), SPOTS.ch.x, SPOTS.ch.z + 0.7, 3.4, 1.1, 0, 0.9);
  prop(group, world, lam({ color: 0xdedede }), 8, 6, 1.2, 4, 0, 0.9);
  prop(group, world, lam({ color: 0xbfc8cc }), 18.6, 6, 1.6, 2.2, 0, 2.4);
  for (let k = 0; k < 5; k++) prop(group, world, new THREE.MeshLambertMaterial({ color: [0xe57373, 0x64b5f6, 0xfff176, 0x81c784, 0xba68c8][k], transparent: true, opacity: 0.8 }), 12 + k * 0.4, SPOTS.ch.z + 0.75, 0.14, 0.14, 0.9, 1.2, false);
  // phòng điện: tủ điện tổng
  prop(group, world, lam({ color: 0x8d9aa3 }), SPOTS.ee.x - 0.5, SPOTS.ee.z, 0.6, 2, 0, 2.1);
  prop(group, world, lam({ color: 0xffb300 }), SPOTS.ee.x - 0.18, SPOTS.ee.z, 0.04, 0.5, 1.5, 1.8, false);
  prop(group, world, dark, -40, 20, 2, 1, 0, 1.6);
  prop(group, world, dark, -44, 28.5, 3, 1, 0, 1.8);
  // phòng xây dựng: khung thử tải
  prop(group, world, metal, SPOTS.ce.x + 0.7, SPOTS.ce.z - 1.3, 0.25, 0.25, 0, 2.6);
  prop(group, world, metal, SPOTS.ce.x + 0.7, SPOTS.ce.z + 1.3, 0.25, 0.25, 0, 2.6);
  prop(group, world, metal, SPOTS.ce.x + 0.7, SPOTS.ce.z, 0.3, 2.85, 2.5, 2.7, false);
  prop(group, world, grey, 41, 20, 3, 1.4, 0, 0.8);
  // phòng bảo vệ: bàn, tủ khoá (cửa tủ là mesh riêng để mở)
  prop(group, world, wood, -26, -10, 2.4, 1, 0, 0.75);
  prop(group, world, lam({ color: 0x4e5a63 }), SPOTS.cabinet.x - 0.45, SPOTS.cabinet.z, 0.7, 1.4, 0, 2);
  const cabDoor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 1.35), lam({ color: 0x5f6e78 }));
  const hinge = new THREE.Group(); hinge.position.set(SPOTS.cabinet.x - 0.08, 1.0, SPOTS.cabinet.z - 0.68);
  cabDoor.position.set(0, 0, 0.675); hinge.add(cabDoor); group.add(hinge);
  const cabLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  cabLed.position.set(0.03, 0.4, 1.2); hinge.add(cabLed);

  // đèn thoát hiểm xanh (phát sáng, không chiếu)
  const exitMat = new THREE.MeshBasicMaterial({ color: 0x22dd66 });
  for (const [x, z, ry] of [[-35.9, 0, Math.PI / 2], [0, -1.7, 0], [-34.6, 26, Math.PI / 2], [34.6, 26, -Math.PI / 2], [-28, -1.7, 0], [28, -1.7, 0]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.05), exitMat); s.position.set(x, 2.75, z); s.rotation.y = ry; group.add(s);
  }

  // ánh sáng: rất tối; trăng giả bằng emissive ngoài sân + vài đèn đường
  scene.add(new THREE.AmbientLight(0x30405a, 0.35));
  const hemi = new THREE.HemisphereLight(0x223355, 0x0b0b10, 0.25); scene.add(hemi);
  for (const [x, z] of [[-60, -12], [-60, 12], [-45, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 8), dark); pole.position.set(x, 2.75, z); group.add(pole);
    world.add(x - 0.15, 0, z - 0.15, x + 0.15, 5.5, z + 0.15, { mat: 'metal' });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); bulb.position.set(x, 5.5, z); group.add(bulb);
    const pl = new THREE.PointLight(0xffc98a, 18, 16, 1.6); pl.position.set(x, 5.3, z); scene.add(pl);
  }
  // đèn phòng bảo vệ, bật khi có điện
  const guardLight = new THREE.PointLight(0xfff1d0, 0, 9, 1.5); guardLight.position.set(-28, 3.0, -7.5); scene.add(guardLight);
  const guardBulb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.2), new THREE.MeshBasicMaterial({ color: 0x333333 })); guardBulb.position.set(-28, 3.17, -7.5); group.add(guardBulb);

  // cổng trường ở cuối sân (dùng lại cổng chính của map campus)
  const poly = [[-80, -18], [-36.5, -18], [-36.5, 18], [-80, 18]];
  try { buildGate(scene, world, poly, { x: -80, z: 0, wall: [[-80, 18], [-80, -18]] }); } catch (e) { console.warn('gate', e); }

  return {
    group,
    setPower(on) {
      guardLight.intensity = on ? 9 : 0;
      guardBulb.material.color.set(on ? 0xfff6dc : 0x333333);
      cabLed.material.color.set(on ? 0x30ff60 : 0xff3030);
    },
    setCabinetOpen(open) { hinge.rotation.y = open ? -1.9 : 0; },
  };
}

export const BOUNDS_DEBUG = { GX0, GZ0, GW, GH, CELL };
