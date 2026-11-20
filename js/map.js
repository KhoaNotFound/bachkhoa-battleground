import * as THREE from 'three';
import { mulberry32 } from './util.js';
import * as TX from './textures.js';

// Campus bounds (meters). North = -Z, Lý Thường Kiệt street on the south (+Z).
export const BOUNDS = { x0: -150, x1: 150, z0: -100, z1: 100 };

export function buildMap(scene, world, { lowGfx = false } = {}) {
  const rng = mulberry32(268);
  const R = (a, b) => a + (b - a) * rng();

  // ---------- materials ----------
  const lam = (opts) => new THREE.MeshLambertMaterial(opts);
  const mats = {
    f_cream: lam({ map: TX.facade('cream') }),
    f_white: lam({ map: TX.facade('white') }),
    f_yellow: lam({ map: TX.facade('yellow') }),
    f_grey: lam({ map: TX.facade('grey') }),
    f_corridor: lam({ map: TX.facade('corridor') }),
    f_glass: lam({ map: TX.facade('glass') }),
    f_shed: lam({ map: TX.facade('shed') }),
    f_city1: lam({ map: TX.facade('city1') }),
    f_city2: lam({ map: TX.facade('city2') }),
    f_city3: lam({ map: TX.facade('city3') }),
    r_red: lam({ map: TX.roof('#e2765d', 'tile') }),
    r_blue: lam({ map: TX.roof('#9cc6ea', 'metal') }),
    r_grey: lam({ map: TX.roof('#b9bdbf') }),
    r_green: lam({ map: TX.roof('#6fd391', 'metal') }),
    r_solar: lam({ map: TX.roof('#c9cccf', 'solar') }),
    r_concrete: lam({ map: TX.roof('#cfcfc8') }),
    r_city: lam({ map: TX.roof('#a7a59e') }),
    concrete: lam({ map: TX.roof('#d6d3ca') }),
    wall: lam({ map: TX.roof('#ddd2b4') }),
    wallTop: lam({ color: 0xb79e74 }),
    stair: lam({ map: TX.roof('#c8c5bc') }),
    rail: lam({ color: 0x8a949c }),
    trunk: lam({ color: 0x6b4a2f }),
    car: lam({ color: 0xffffff, vertexColors: true }),
    dark: lam({ color: 0x2a2e33 }),
    metal: lam({ color: 0x9aa3aa }),
    white: lam({ color: 0xf4f4f4 }),
    crate: lam({ color: 0xb08850 }),
    barrier: lam({ color: 0xd8d6cf }),
    bench: lam({ color: 0x8a5a36 }),
    shedRoof: lam({ map: TX.roof('#7fa7c4', 'metal'), side: THREE.DoubleSide }),
    moto: lam({ color: 0xffffff, vertexColors: true }),
    bleacher: lam({ color: 0x3f7fc0 }),
  };

  // ---------- geometry buckets (merged per material) ----------
  const buckets = new Map();
  function B(key) {
    let b = buckets.get(key);
    if (!b) { b = { pos: [], nor: [], uv: [], col: [] }; buckets.set(key, b); }
    return b;
  }
  function quad(bk, p, n, uv, color) {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      bk.pos.push(p[i][0], p[i][1], p[i][2]);
      bk.nor.push(n[0], n[1], n[2]);
      bk.uv.push(uv[i][0], uv[i][1]);
      if (color) bk.col.push(color.r, color.g, color.b);
    }
  }
  // Box with side material and top material. uS/vS = meters per texture tile.
  function box(side, x0, y0, z0, x1, y1, z1, o = {}) {
    const top = o.top === undefined ? side : o.top;
    const uS = o.uS || 4, vS = o.vS || 3.5, tS = o.tS || 4;
    const col = o.color;
    const vb = (y) => (y - y0) / vS;
    if (side) {
      const s = B(side);
      quad(s, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[0, vb(y0)], [(z1 - z0) / uS, vb(y0)], [(z1 - z0) / uS, vb(y1)], [0, vb(y1)]], col);
      quad(s, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[0, vb(y0)], [(z1 - z0) / uS, vb(y0)], [(z1 - z0) / uS, vb(y1)], [0, vb(y1)]], col);
      quad(s, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[0, vb(y0)], [(x1 - x0) / uS, vb(y0)], [(x1 - x0) / uS, vb(y1)], [0, vb(y1)]], col);
      quad(s, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[0, vb(y0)], [(x1 - x0) / uS, vb(y0)], [(x1 - x0) / uS, vb(y1)], [0, vb(y1)]], col);
    }
    if (top) {
      const t = B(top);
      quad(t, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0 / tS, -z1 / tS], [x1 / tS, -z1 / tS], [x1 / tS, -z0 / tS], [x0 / tS, -z0 / tS]], col);
    }
    if (o.bottom) {
      const t = B(top || side);
      quad(t, [[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    }
    if (o.collide !== false) world.add(x0, y0, z0, x1, y1, z1, { bullet: o.bullet, mat: o.mat || 'concrete' });
  }
  function flat(key, x0, z0, x1, z1, y, tS = 4) {
    const t = B(key);
    quad(t, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], [[x0 / tS, -z1 / tS], [x1 / tS, -z1 / tS], [x1 / tS, -z0 / tS], [x0 / tS, -z0 / tS]]);
  }

  const minimap = { rects: [], labels: [], pads: [], grass: [], trees: [] };
  const spawnAreas = [];

  // ---------- ground ----------
  const groundMeshes = [];
  {
    const g = new THREE.PlaneGeometry(900, 900);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 900 / 8, uv.getY(i) * 900 / 8);
    const m = new THREE.Mesh(g, lam({ map: TX.asphalt() }));
    m.receiveShadow = true;
    scene.add(m);
    groundMeshes.push(m);
  }
  const padMat = lam({ map: TX.pavers(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const grassMat = lam({ map: TX.grass(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pads = [];
  const grasses = [];
  function pad(x0, z0, x1, z1) { pads.push([x0, z0, x1, z1]); minimap.pads.push([x0, z0, x1, z1]); }
  function lawn(x0, z0, x1, z1) { grasses.push([x0, z0, x1, z1]); minimap.grass.push([x0, z0, x1, z1]); }

  // ---------- helpers ----------
  const occupied = []; // xz rects for tree/prop placement avoidance
  function occ(x0, z0, x1, z1, m = 0) { occupied.push([x0 - m, z0 - m, x1 + m, z1 + m]); }
  function isFree(x, z, r) {
    for (const o of occupied) if (x + r > o[0] && x - r < o[2] && z + r > o[1] && z - r < o[3]) return false;
    return true;
  }

  function building(name, x0, z0, x1, z1, h, style, roof, o = {}) {
    box('f_' + style, x0, 0, z0, x1, h, z1, { top: 'r_' + roof, tS: roof === 'solar' ? 6 : 4 });
    occ(x0, z0, x1, z1, 1.2);
    minimap.rects.push({ x0, z0, x1, z1, h, roof, name });
    if (name) minimap.labels.push({ name, x: (x0 + x1) / 2, z: (z0 + z1) / 2 });
    // roof trim
    box('wallTop', x0 - 0.25, h - 0.05, z0 - 0.25, x1 + 0.25, h + 0.25, z0 + 0.25, { collide: false });
    box('wallTop', x0 - 0.25, h - 0.05, z1 - 0.25, x1 + 0.25, h + 0.25, z1 + 0.25, { collide: false });
    box('wallTop', x0 - 0.25, h - 0.05, z0, x0 + 0.25, h + 0.25, z1, { collide: false });
    box('wallTop', x1 - 0.25, h - 0.05, z0, x1 + 0.25, h + 0.25, z1, { collide: false });
    if (o.parapet) {
      const ph = 1.0, t = 0.3;
      box('concrete', x0, h, z0, x1, h + ph, z0 + t);
      box('concrete', x0, h, z1 - t, x1, h + ph, z1);
      box('concrete', x0, h, z0 + t, x0 + t, h + ph, z1 - t);
      box('concrete', x1 - t, h, z0 + t, x1, h + ph, z1 - t);
      // rooftop cover: water tanks + AC units
      const n = Math.max(2, Math.floor(((x1 - x0) * (z1 - z0)) / 160));
      for (let i = 0; i < n; i++) {
        const cx = R(x0 + 3, x1 - 3), cz = R(z0 + 3, z1 - 3);
        if (rng() < 0.5) box('metal', cx - 0.9, h, cz - 0.9, cx + 0.9, h + 1.6, cz + 0.9, { mat: 'metal' });
        else box('white', cx - 1.4, h, cz - 0.6, cx + 1.4, h + 1.1, cz + 0.6, { mat: 'metal' });
      }
      spawnRoof.push([x0 + 2, z0 + 2, x1 - 2, z1 - 2, h]);
    }
    if (o.sign) addSign(o.sign, x0, z0, x1, z1, h, o.signSide || 's');
  }
  const spawnRoof = [];

  const signs = [];
  function addSign(text, x0, z0, x1, z1, h, side) {
    const t = TX.signText([text], { w: 256, h: 128, bg: '#0b3d91' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshLambertMaterial({ map: t }));
    const y = h - 1.6;
    if (side === 's') { m.position.set((x0 + x1) / 2, y, z1 + 0.03); }
    if (side === 'n') { m.position.set((x0 + x1) / 2, y, z0 - 0.03); m.rotation.y = Math.PI; }
    if (side === 'e') { m.position.set(x1 + 0.03, y, (z0 + z1) / 2); m.rotation.y = Math.PI / 2; }
    if (side === 'w') { m.position.set(x0 - 0.03, y, (z0 + z1) / 2); m.rotation.y = -Math.PI / 2; }
    scene.add(m);
    signs.push(m);
  }

  // Exterior staircase running along a wall. (sx,sz) = start at ground, dir = 'x+','x-','z+','z-'
  // side offset: stairs occupy [along wall] with width w outward from wall.
  function stairs(sx, sz, dir, height, w = 2.2) {
    const rise = 0.4, run = 0.6;
    const n = Math.ceil(height / rise);
    for (let i = 0; i < n; i++) {
      const y1 = Math.min(height, (i + 1) * rise);
      let x0, x1, z0, z1;
      const a = i * run, b = (i + 1) * run;
      if (dir === 'x+') { x0 = sx + a; x1 = sx + b; z0 = sz; z1 = sz + w; }
      if (dir === 'x-') { x0 = sx - b; x1 = sx - a; z0 = sz; z1 = sz + w; }
      if (dir === 'z+') { z0 = sz + a; z1 = sz + b; x0 = sx; x1 = sx + w; }
      if (dir === 'z-') { z0 = sz - b; z1 = sz - a; x0 = sx; x1 = sx + w; }
      box('stair', x0, 0, z0, x1, y1, z1, { uS: 2, vS: 2 });
    }
    // landing at top
    const L = n * run;
    let lx0, lx1, lz0, lz1;
    if (dir === 'x+') { lx0 = sx + L; lx1 = sx + L + 1.6; lz0 = sz; lz1 = sz + w; }
    if (dir === 'x-') { lx0 = sx - L - 1.6; lx1 = sx - L; lz0 = sz; lz1 = sz + w; }
    if (dir === 'z+') { lz0 = sz + L; lz1 = sz + L + 1.6; lx0 = sx; lx1 = sx + w; }
    if (dir === 'z-') { lz0 = sz - L - 1.6; lz1 = sz - L; lx0 = sx; lx1 = sx + w; }
    box('stair', lx0, 0, lz0, lx1, height, lz1, { uS: 2, vS: 2 });
    const all = dir[0] === 'x'
      ? [Math.min(sx, lx0), sz, Math.max(sx, lx1), sz + w]
      : [sx, Math.min(sz, lz0), sx + w, Math.max(sz, lz1)];
    occ(all[0], all[1], all[2], all[3], 1);
    minimap.rects.push({ x0: all[0], z0: all[1], x1: all[2], z1: all[3], h: height * 0.5, roof: 'stair' });
  }

  // ---------- trees (instanced) ----------
  const treeList = [];
  function tree(x, z, s = 1) {
    if (!isFree(x, z, 1.0)) return false;
    treeList.push({ x, z, s, h: R(0.85, 1.25) * s });
    world.add(x - 0.28 * s, 0, z - 0.28 * s, x + 0.28 * s, 3.2 * s, z + 0.28 * s, { mat: 'wood' });
    occ(x - 0.8, z - 0.8, x + 0.8, z + 0.8);
    minimap.trees.push([x, z, 2.6 * s]);
    return true;
  }
  function treeArea(x0, z0, x1, z1, spacing, jitter = 1.5, prob = 1) {
    for (let x = x0; x <= x1; x += spacing) for (let z = z0; z <= z1; z += spacing) {
      if (rng() > prob) continue;
      tree(x + R(-jitter, jitter), z + R(-jitter, jitter), R(0.9, 1.25));
    }
  }

  // ---------- props ----------
  const carColors = [0xd8dde2, 0x24272b, 0xb8302c, 0x2f5fa8, 0xeeeeee, 0x7d8a92, 0xc9a64a];
  function car(x, z, rotated) {
    const c = new THREE.Color(carColors[Math.floor(rng() * carColors.length)]);
    const L = 4.3, W = 1.85;
    const hx = rotated ? L / 2 : W / 2, hz = rotated ? W / 2 : L / 2;
    if (!isFree(x, z, Math.max(hx, hz))) return;
    box('car', x - hx, 0.25, z - hz, x + hx, 1.05, z + hz, { color: c, mat: 'metal' });
    const cx = rotated ? 0.95 : 0.8, cz = rotated ? 0.8 : 0.95;
    box('car', x - hx * cx, 1.05, z - hz * cz, x + hx * cx, 1.6, z + hz * cz, { color: new THREE.Color(0x1d2733), collide: false });
    world.add(x - hx * cx, 1.05, z - hz * cz, x + hx * cx, 1.6, z + hz * cz, { mat: 'metal' });
    // wheels
    const wc = new THREE.Color(0x111111);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wx = x + (rotated ? sx * 1.35 : sx * 0.78), wz = z + (rotated ? sz * 0.78 : sz * 1.35);
      box('car', wx - 0.33, 0, wz - 0.33, wx + 0.33, 0.62, wz + 0.33, { color: wc, collide: false });
    }
    occ(x - hx, z - hz, x + hx, z + hz, 0.8);
    minimap.rects.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz, h: 1.5, roof: 'car' });
  }
  // motorbike parking shed (very HCMUT)
  function motoShed(x0, z0, x1, z1) {
    const along = x1 - x0 > z1 - z0;
    const h = 2.6;
    // pillars
    const n = Math.floor((along ? x1 - x0 : z1 - z0) / 5);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (const side of [0, 1]) {
        const px = along ? x0 + (x1 - x0) * t : (side ? x1 - 0.2 : x0 + 0.2);
        const pz = along ? (side ? z1 - 0.2 : z0 + 0.2) : z0 + (z1 - z0) * t;
        box('metal', px - 0.1, 0, pz - 0.1, px + 0.1, h, pz + 0.1, { mat: 'metal' });
      }
    }
    box('shedRoof', x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.12, z1 + 0.3, { mat: 'metal' });
    // rows of bikes (low cover)
    const colors = [0xc0392b, 0x1f1f1f, 0xdedede, 0x2e5ea8, 0x7f8c8d, 0xd35400];
    const rows = along ? [z0 + 1.2, z1 - 1.2] : [x0 + 1.2, x1 - 1.2];
    for (const r of rows) {
      const len = along ? x1 - x0 : z1 - z0;
      for (let k = 0.8; k < len - 0.5; k += 0.75) {
        if (rng() < 0.15) continue;
        const c = new THREE.Color(colors[Math.floor(rng() * colors.length)]);
        const bx = along ? x0 + k : r, bz = along ? r : z0 + k;
        const hx = along ? 0.18 : 0.85, hz = along ? 0.85 : 0.18;
        box('moto', bx - hx, 0.25, bz - hz, bx + hx, 0.95, bz + hz, { color: c, collide: false });
        box('moto', bx - hx * 0.9, 0, bz - hz * 0.9, bx + hx * 0.9, 0.3, bz + hz * 0.9, { color: new THREE.Color(0x111111), collide: false });
      }
      if (along) world.add(x0 + 0.5, 0, r - 0.85, x1 - 0.5, 0.95, r + 0.85, { mat: 'metal' });
      else world.add(r - 0.85, 0, z0 + 0.5, r + 0.85, 0.95, z1 - 0.5, { mat: 'metal' });
    }
    occ(x0, z0, x1, z1, 0.5);
    minimap.rects.push({ x0, z0, x1, z1, h: 2.6, roof: 'shed' });
  }
  function crate(x, z, s = 1.2, stack = 1) {
    for (let i = 0; i < stack; i++) box('crate', x - s / 2, i * s, z - s / 2, x + s / 2, (i + 1) * s, z + s / 2, { uS: s, vS: s, mat: 'wood' });
    occ(x - s / 2, z - s / 2, x + s / 2, z + s / 2, 0.5);
  }
  function barrier(x, z, rotated) {
    const hx = rotated ? 0.3 : 1.5, hz = rotated ? 1.5 : 0.3;
    box('barrier', x - hx, 0, z - hz, x + hx, 0.95, z + hz);
    occ(x - hx, z - hz, x + hx, z + hz, 0.3);
  }
  function bench(x, z, rotated) {
    const hx = rotated ? 0.25 : 0.9, hz = rotated ? 0.9 : 0.25;
    box('bench', x - hx, 0.35, z - hz, x + hx, 0.48, z + hz, { collide: false });
    box('dark', x - hx * 0.9, 0, z - hz * 0.9, x + hx * 0.9, 0.35, z + hz * 0.9, { collide: false });
    world.add(x - hx, 0, z - hz, x + hx, 0.48, z + hz, { mat: 'wood' });
  }
  function lamp(x, z) {
    box('dark', x - 0.07, 0, z - 0.07, x + 0.07, 5.5, z + 0.07, { collide: false });
    box('white', x - 0.3, 5.4, z - 0.15, x + 0.3, 5.55, z + 0.15, { collide: false });
  }

  // =====================================================================
  //  LAYOUT  (inspired by the HCMUT campus at 268 Lý Thường Kiệt)
  // =====================================================================
  // Block pads (light concrete), roads are the asphalt in-between.
  pad(-147, 37, -65, 97);   // A cluster
  pad(-56, 37, 11, 97);     // football field block
  pad(-147, -17, -65, 29);  // west plaza
  pad(-56, -17, 11, 29);    // central gardens
  pad(-147, -97, -65, -27); // workshops
  pad(-56, -97, 11, -27);   // B10 block
  pad(23, -97, 71, -27);    // B1 + court
  pad(23, -17, 71, 97);     // hall + B4
  pad(81, -97, 147, -57);   // towers
  pad(81, -53, 147, 97);    // C rows

  // ---- SW: A cluster (old yellow buildings, red roofs) ----
  building('A1', -144, 40, -132, 94, 13, 'yellow', 'red', { parapet: true, sign: 'A1', signSide: 'e' });
  building('', -132, 40, -101, 50, 13, 'yellow', 'red', { parapet: true });
  stairs(-131.8, 56, 'z+', 13);
  building('A2', -116, 58, -106, 94, 16, 'corridor', 'blue', { sign: 'A2', signSide: 'n' });
  building('A3', -99, 58, -89, 94, 16, 'corridor', 'blue', { sign: 'A3', signSide: 'n' });
  building('A4', -84, 82, -67, 94, 8, 'grey', 'grey', { sign: 'A4', signSide: 'n' });
  building('A5', -84, 60, -71, 72, 6, 'white', 'concrete', { parapet: true });
  stairs(-70.6, 60, 'z+', 6, 1.8);
  lawn(-128, 53, -119, 94);
  treeArea(-126, 56, -121, 92, 7, 1);
  treeArea(-104, 54, -101, 92, 8, 0.4, 0.8);
  motoShed(-86, 40, -68, 46);
  car(-78, 52, true); car(-88, 52, true);
  crate(-74, 78, 1.3, 2); crate(-72.6, 78, 1.3, 1);

  // ---- S-mid: football field ----
  {
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), lam({ map: TX.field(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    fm.rotation.x = -Math.PI / 2;
    fm.position.set(-22, 0.02, 60);
    fm.receiveShadow = true;
    scene.add(fm);
    groundMeshes.push(fm);
    minimap.grass.push([-52, 40, 8, 80]);
    // goals
    for (const gx of [-50.5, 6.5]) {
      const d = gx < 0 ? -1 : 1;
      box('white', gx, 0, 56.3, gx + 0.15, 2.44, 56.45, { mat: 'metal' });
      box('white', gx, 0, 63.55, gx + 0.15, 2.44, 63.7, { mat: 'metal' });
      box('white', gx, 2.3, 56.3, gx + 0.15, 2.44, 63.7, { mat: 'metal' });
      box('rail', gx + d * 1.6, 0, 56.3, gx + d * 1.6 + 0.08, 1.4, 63.7, { collide: false });
    }
    // bleachers (south side) – stepped cover
    for (let i = 0; i < 3; i++) box('bleacher', -46, 0, 82 + i * 1.1, -2, 0.5 * (i + 1), 83.1 + i * 1.1, { mat: 'metal' });
    occ(-46, 82, -2, 85.3, 1);
    minimap.rects.push({ x0: -46, z0: 82, x1: -2, z1: 85.3, h: 1.5, roof: 'bleacher' });
    for (let x = -52; x <= 8; x += 6.5) tree(x, 90 + R(-1, 1), 1.1);
    for (let x = -52; x <= 8; x += 7) tree(x, 34.5 + R(-0.5, 0.5), 1);
    building('', 2, 88, 8, 94, 3.2, 'white', 'red'); // guard house
  }

  // ---- W plaza: tree grid + long building ----
  building('C6', -144, -14, -92, -4, 10, 'cream', 'grey', { sign: 'C6', signSide: 's' });
  lawn(-144, 2, -68, 27);
  treeArea(-141, 5, -70, 25, 7.5, 0.8);
  for (let x = -138; x < -72; x += 15) bench(x, 0, false);
  barrier(-80, -9, true); barrier(-74, -2, false);
  crate(-86, -10, 1.3, 1); crate(-84.6, -10, 1.3, 2);

  // ---- NW: workshops ----
  building('X1', -144, -94, -122, -60, 8, 'shed', 'blue', { sign: 'X1', signSide: 's' });
  building('X2', -117, -94, -97, -60, 8, 'shed', 'blue', { sign: 'X2', signSide: 's' });
  building('X3', -91, -94, -68, -66, 10, 'grey', 'grey', { parapet: true, sign: 'X3', signSide: 's' });
  stairs(-67.6, -66, 'z-', 10, 2);
  building('', -144, -50, -112, -32, 6, 'shed', 'metal' === 'x' ? 'blue' : 'blue');
  building('', -104, -50, -78, -32, 7, 'grey', 'concrete', { parapet: true });
  stairs(-104, -31.6, 'x+', 7, 2);
  crate(-118, -56, 1.4, 2); crate(-116.5, -56, 1.4, 1); crate(-95, -55, 1.4, 1);
  barrier(-128, -55, false); barrier(-74, -52, true);
  car(-90, -56, true); car(-106, -24, true);

  // ---- Central gardens ----
  lawn(-52, -14, -26, 26); lawn(-20, -14, 7, 26);
  treeArea(-50, -12, -28, 24, 6, 1.6, 0.85);
  treeArea(-18, -12, 5, 24, 6, 1.6, 0.85);
  // monument / fountain in the middle path
  box('white', -24.5, 0, 3.5, -21.5, 0.8, 6.5, { mat: 'concrete' });
  box('concrete', -23.6, 0.8, 4.4, -22.4, 4.5, 5.6, { mat: 'concrete' });
  occ(-25, 3, -21, 7, 1);
  minimap.rects.push({ x0: -24.5, z0: 3.5, x1: -21.5, z1: 6.5, h: 4, roof: 'grey' });
  for (let z = -10; z <= 22; z += 8) { bench(-23, z, true); }

  // ---- N-mid: B10 (solar roof) + annex ----
  building('B10', -52, -62, -22, -42, 24, 'white', 'solar', { sign: 'B10', signSide: 's' });
  building('', -22, -62, -6, -46, 10, 'cream', 'concrete', { parapet: true });
  stairs(-5.6, -46, 'z-', 10, 2);
  building('B2', -52, -94, -14, -80, 12, 'yellow', 'red', { sign: 'B2', signSide: 's' });
  building('B3', -8, -94, 7, -72, 9, 'glass', 'blue', { sign: 'B3', signSide: 'w' });
  motoShed(-50, -36, -24, -31);
  treeArea(-48, -74, -18, -68, 6, 1, 0.9);
  car(-12, -36, false); car(-2, -66, false);

  // ---- NE-mid: B1 long + basketball court ----
  building('B1', 26, -95, 69, -83, 12, 'grey', 'grey', { parapet: true, sign: 'B1', signSide: 's' });
  stairs(27, -82.6, 'x+', 12, 2.2);
  {
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(28, 15), lam({ map: TX.court(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    cm.rotation.x = -Math.PI / 2; cm.position.set(47, 0.02, -60);
    cm.receiveShadow = true;
    scene.add(cm); groundMeshes.push(cm);
    minimap.pads.push([33, -67.5, 61, -52.5]);
    for (const hx of [33.6, 60.4]) {
      const d = hx < 47 ? 1 : -1;
      box('dark', hx - 0.12, 0, -60.12, hx + 0.12, 3.4, -59.88, { mat: 'metal' });
      box('white', hx + d * 0.6 - 0.05, 2.9, -61, hx + d * 0.6 + 0.05, 4, -59, { mat: 'metal' });
    }
    occ(33, -67.5, 61, -52.5);
  }
  treeArea(26, -48, 68, -32, 7, 1.2, 0.8);
  treeArea(26, -76, 31, -46, 6, 0.6, 1);
  treeArea(64, -76, 69, -46, 6, 0.6, 1);

  // ---- Mid-E: red hall + tall B4 + south blocks ----
  building('H6', 27, -13, 51, 13, 11, 'cream', 'red', { sign: 'H6', signSide: 'w' });
  {
    // pyramid roof (visual) on the hall
    const g = new THREE.ConeGeometry(17.5, 6, 4, 1);
    g.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(g, mats.r_red);
    m.position.set(39, 11 + 3, 0);
    m.scale.set(1, 1, 26 / 24);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    world.add(29, 11, -11, 49, 14, 11, { mat: 'concrete' });
  }
  building('B4', 54, -15, 68, 23, 28, 'glass', 'grey', { sign: 'B4', signSide: 'w' });
  building('B5', 28, 38, 50, 54, 9, 'white', 'blue', { parapet: true, sign: 'B5', signSide: 'n' });
  stairs(50.4, 54, 'z-', 9, 2);
  building('B6', 28, 72, 68, 84, 12, 'corridor', 'blue', { sign: 'B6', signSide: 'n' });
  lawn(27, 18, 51, 33);
  treeArea(29, 20, 49, 31, 6, 1.2, 0.9);
  treeArea(55, 30, 68, 66, 6.5, 1.2, 0.85);
  treeArea(28, 60, 50, 66, 6, 1, 0.8);
  treeArea(30, 89, 68, 94, 7, 0.6, 1);
  car(36, 57, true); car(44, 57, true);
  barrier(40, 31, false); crate(52, 36, 1.3, 2);

  // ---- E: towers ----
  building('B11', 104, -95, 144, -80, 30, 'white', 'grey', { sign: 'B11', signSide: 's' });
  building('B9', 112, -74, 145, -61, 22, 'cream', 'red', { sign: 'B9', signSide: 'w' });
  building('B8', 84, -95, 99, -70, 14, 'glass', 'blue', { sign: 'B8', signSide: 'e' });
  car(96, -64, false); car(104, -66, true);
  treeArea(84, -66, 108, -60, 6, 1, 0.6);

  // ---- E: C rows ----
  building('C1', 84, -50, 144, -40, 10, 'corridor', 'blue', { parapet: true, sign: 'C1', signSide: 'w' });
  stairs(86, -39.6, 'x+', 10, 2);
  building('C2', 84, -30, 144, -20, 10, 'corridor', 'blue', { sign: 'C2', signSide: 'w' });
  building('C3', 84, -11, 120, -1, 10, 'cream', 'blue', { sign: 'C3', signSide: 'w' });
  building('GYM', 126, -12, 146, 12, 12, 'shed', 'green', { sign: 'NTĐ', signSide: 'w' });
  building('C4', 84, 12, 118, 22, 10, 'cream', 'blue', { sign: 'C4', signSide: 'w' });
  building('C5', 84, 40, 146, 50, 10, 'corridor', 'blue', { parapet: true, sign: 'C5', signSide: 'w' });
  stairs(144, 50.4, 'x-', 10, 2);
  building('C7', 84, 62, 124, 72, 8, 'cream', 'grey', { sign: 'C7', signSide: 'w' });
  building('', 132, 62, 146, 90, 7, 'white', 'concrete');
  motoShed(86, 82, 124, 88);
  lawn(84, 26, 120, 36);
  treeArea(86, 27, 118, 35, 6.5, 1.2, 0.9);
  treeArea(86, -16, 118, -14, 6, 0.5, 0.8);
  treeArea(122, 16, 145, 34, 7, 1.2, 0.8);
  treeArea(86, 54, 128, 58, 6, 0.8, 0.8);
  car(130, 30, false); car(124, -35, true); car(100, -35, true);
  crate(122, 6, 1.3, 1); crate(122, 4.6, 1.3, 2); barrier(110, 56, false); barrier(92, 6, false);

  // Street-side props along roads
  for (const [x, z, r] of [[-60, 10, false], [-60, -40, false], [-60, 70, false], [17, -60, false], [17, 0, false], [17, 50, false], [76, -30, false], [76, 30, false], [76, 75, false], [-100, 33, true], [-30, 33, true], [40, -22, true], [110, -55, true]]) {
    car(x + R(-1, 1), z + R(-3, 3), r);
  }
  for (const [x, z, r] of [[-60, -10, false], [17, 25, false], [17, -40, false], [76, 0, false], [-110, -21, true], [-20, -22, true], [50, 33, true], [76, 55, false]]) barrier(x, z, r);
  for (let z = -90; z <= 90; z += 22) { lamp(12.3, z); lamp(21.7, z + 11); }

  // ---------- boundary wall + main gate ----------
  const { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1 } = BOUNDS;
  const WH = 3.0, WT = 0.5;
  box('wall', BX0 - WT, 0, BZ0 - WT, BX1 + WT, WH, BZ0, { tS: 3 });
  box('wall', BX0 - WT, 0, BZ0, BX0, WH, BZ1, { tS: 3 });
  box('wall', BX1, 0, BZ0, BX1 + WT, WH, BZ1, { tS: 3 });
  box('wall', BX0 - WT, 0, BZ1, 6, WH, BZ1 + WT, { tS: 3 });
  box('wall', 28, 0, BZ1, BX1 + WT, WH, BZ1 + WT, { tS: 3 });
  // gate pillars + sign + sliding gate
  box('concrete', 4, 0, BZ1 - 0.6, 7, 7.5, BZ1 + 1.2);
  box('concrete', 27, 0, BZ1 - 0.6, 30, 7.5, BZ1 + 1.2);
  box('concrete', 4, 7.5, BZ1 - 0.4, 30, 9.2, BZ1 + 1.0, { collide: false });
  {
    const t = TX.signText(['TRƯỜNG ĐẠI HỌC BÁCH KHOA', 'ĐẠI HỌC QUỐC GIA TP.HCM · BATTLEGROUND'], { w: 1024, h: 160 });
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(25.4, 1.6), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(17, 8.35, side > 0 ? BZ1 + 1.03 : BZ1 - 0.43);
      if (side < 0) m.rotation.y = Math.PI;
      scene.add(m);
    }
  }
  for (let x = 7.4; x < 27; x += 0.5) box('rail', x, 0, BZ1 + 0.1, x + 0.08, 2.2, BZ1 + 0.18, { collide: false });
  box('rail', 7, 2.1, BZ1 + 0.05, 27, 2.25, BZ1 + 0.25, { collide: false });
  // invisible tall boundary so nobody jumps out from rooftops
  for (const b of [[BX0 - 5, BZ0 - 5, BX1 + 5, BZ0], [BX0 - 5, BZ1, BX1 + 5, BZ1 + 5], [BX0 - 5, BZ0, BX0, BZ1], [BX1, BZ0, BX1 + 5, BZ1]]) {
    world.add(b[0], 0, b[1], b[2], 400, b[3], { bullet: false, mat: 'none' });
  }
  // flagpole
  box('white', 16.85, 0, 86.85, 17.15, 12, 87.15, { mat: 'metal' });
  {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshLambertMaterial({ color: 0xda251d, side: THREE.DoubleSide }));
    flag.position.set(18.3, 11, 87);
    scene.add(flag);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.42, 5), new THREE.MeshBasicMaterial({ color: 0xffde00, side: THREE.DoubleSide }));
    star.rotation.z = Math.PI / 2;
    star.position.set(18.3, 11, 87.01);
    scene.add(star);
  }

  // ---------- outside city (no collision) ----------
  // sidewalk ring and Lý Thường Kiệt road lines
  const outside = lam({ map: TX.pavers() });
  {
    const ring = [[BX0 - 8, BZ0 - 8, BX1 + 8, BZ0 - WT], [BX0 - 8, BZ1 + WT, BX1 + 8, BZ1 + 8], [BX0 - 8, BZ0 - WT, BX0 - WT, BZ1 + WT], [BX1 + WT, BZ0 - WT, BX1 + 8, BZ1 + WT]];
    for (const r of ring) box(null, r[0], 0, r[1], r[2], 0.15, r[3], { top: 'outsideWalk', collide: false });
    // lane markings on the street south
    for (let x = -260; x < 260; x += 8) box(null, x, 0, BZ1 + 18.9, x + 4, 0.03, BZ1 + 19.1, { top: 'laneMark', collide: false });
  }
  mats.outsideWalk = outside;
  mats.laneMark = lam({ color: 0xf2f2f2 });
  {
    const styles = ['f_city1', 'f_city2', 'f_city3', 'f_cream', 'f_white'];
    const crng = mulberry32(777);
    const CR = (a, b) => a + (b - a) * crng();
    const strips = [
      { x0: -330, x1: 330, z0: BZ1 + 30, z1: BZ1 + 110, axis: 'x' },
      { x0: -330, x1: 330, z0: BZ0 - 110, z1: BZ0 - 12, axis: 'x' },
      { x0: BX0 - 110, x1: BX0 - 12, z0: BZ0 - 12, z1: BZ1 + 30, axis: 'z' },
      { x0: BX1 + 12, x1: BX1 + 110, z0: BZ0 - 12, z1: BZ1 + 30, axis: 'z' },
    ];
    for (const s of strips) {
      let t = s.axis === 'x' ? s.x0 : s.z0;
      const end = s.axis === 'x' ? s.x1 : s.z1;
      while (t < end) {
        const w = CR(6, 16);
        const depth = CR(10, 22);
        const h = CR(6, crng() < 0.12 ? 45 : 18);
        const st = styles[Math.floor(crng() * styles.length)];
        if (s.axis === 'x') {
          const near = s.z0 > 0 ? s.z0 : s.z1 - depth;
          box(st, t, 0, near, t + w, h, near + depth, { top: 'r_city', collide: false });
        } else {
          const near = s.x0 > 0 ? s.x0 : s.x1 - depth;
          box(st, near, 0, t, near + depth, h, t + w, { top: 'r_city', collide: false });
        }
        t += w + CR(0.5, 3);
      }
    }
  }

  // ---------- spawn points ----------
  const spawns = [];
  {
    const tmpList = [];
    const srng = mulberry32(5150);
    let tries = 0;
    const areas = pads.concat([[-52, 40, 8, 80]]);
    while (spawns.length < 70 && tries < 6000) {
      tries++;
      const a = areas[Math.floor(srng() * areas.length)];
      const x = a[0] + 2 + srng() * (a[2] - a[0] - 4), z = a[1] + 2 + srng() * (a[3] - a[1] - 4);
      const L = world.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5, tmpList);
      let ok = true;
      for (const b of L) if (x + 1.5 > b.min[0] && x - 1.5 < b.max[0] && z + 1.5 > b.min[2] && z - 1.5 < b.max[2] && b.min[1] < 2) { ok = false; break; }
      if (ok) spawns.push({ x, y: 0, z });
    }
  }

  // ---------- build meshes ----------
  for (const [x0, z0, x1, z1] of pads) flat('__pad', x0, z0, x1, z1, 0.03, 4);
  for (const [x0, z0, x1, z1] of grasses) flat('__grass', x0, z0, x1, z1, 0.05, 6);
  mats.__pad = padMat; mats.__grass = grassMat;

  const meshes = [];
  for (const [key, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (b.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[key]);
    const isFlat = key === '__pad' || key === '__grass' || key === 'laneMark' || key === 'outsideWalk';
    const isCity = key.startsWith('f_city') || key === 'r_city';
    m.castShadow = !isFlat && !lowGfx;
    m.receiveShadow = true;
    if (isCity) m.castShadow = false;
    scene.add(m);
    meshes.push(m);
  }

  // trees: instanced trunks + canopy blobs
  {
    const trunkG = new THREE.CylinderGeometry(0.18, 0.26, 1, 6);
    trunkG.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkG, mats.trunk, treeList.length);
    const blobG = new THREE.IcosahedronGeometry(1, 0);
    const blobsPer = 3;
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const blobs = new THREE.InstancedMesh(blobG, leafMat, treeList.length * blobsPer);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const greens = [0x2f7d32, 0x3a8f3c, 0x2a6e2e, 0x4c9a3f, 0x37813a];
    const col = new THREE.Color();
    treeList.forEach((t, i) => {
      const th = 3.0 * t.h;
      m4.compose(p.set(t.x, 0, t.z), q.identity(), s.set(t.s, th, t.s));
      trunks.setMatrixAt(i, m4);
      for (let k = 0; k < blobsPer; k++) {
        const ang = rng() * Math.PI * 2, rad = k === 0 ? 0 : 1.1 * t.s;
        const r = (k === 0 ? 2.3 : 1.7) * t.s * R(0.85, 1.1);
        p.set(t.x + Math.cos(ang) * rad, th + (k === 0 ? 1.0 : 0.3) * t.s + R(-0.2, 0.4), t.z + Math.sin(ang) * rad);
        e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
        m4.compose(p, q, s.set(r, r * 0.85, r));
        blobs.setMatrixAt(i * blobsPer + k, m4);
        col.set(greens[Math.floor(rng() * greens.length)]);
        blobs.setColorAt(i * blobsPer + k, col);
      }
    });
    trunks.castShadow = blobs.castShadow = !lowGfx;
    trunks.receiveShadow = blobs.receiveShadow = true;
    scene.add(trunks, blobs);
  }

  // clouds
  {
    const cg = new THREE.IcosahedronGeometry(1, 1);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa, flatShading: true });
    const crng = mulberry32(42);
    const n = 26;
    const clouds = new THREE.InstancedMesh(cg, cm, n * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = crng() * Math.PI * 2, d = 250 + crng() * 300;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 110 + crng() * 60;
      for (let j = 0; j < 4; j++) {
        const r = 10 + crng() * 14;
        m4.compose(p.set(cx + (j - 1.5) * r * 0.9, cy + crng() * 6, cz + crng() * 10), q, s.set(r * 1.4, r * 0.6, r));
        clouds.setMatrixAt(k++, m4);
      }
    }
    scene.add(clouds);
  }

  minimap.spawns = spawns;
  return { spawns, minimap, meshes, groundMeshes, spawnRoof };
}
