import * as THREE from 'three';
import * as TX from './textures.js';

// Main gate on Lý Thường Kiệt, modelled after the reference photo:
// left (seen from the street): a tall blue tower whose plan is a 3-pointed star (it reads as
// star-fruit slices from the ground) with the BK logo on top, flanked by dark granite sign walls;
// right: the guard house with a blue-framed LED screen on its roof and a white sliding gate.

const LOGO_URL = new URL('../assets/img/logo-bk.png', import.meta.url).href;

// Closest point on the boundary, and the wall direction around it. The direction comes from a
// PCA of the boundary sampled within 35 m: the gate sits in a small notch, so the nearest edge
// alone can point the wrong way.
function nearestEdge(poly, x, z) {
  let best = null;
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez, L = Math.sqrt(l2);
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
    const px = a[0] + ex * t, pz = a[1] + ez * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { d, px, pz };
    for (let k = 0; k <= L; k += 1) { const qx = a[0] + ex * k / L, qz = a[1] + ez * k / L; if (Math.hypot(qx - x, qz - z) < 35) pts.push([qx, qz]); }
  }
  let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= pts.length; mz /= pts.length;
  let sxx = 0, sxz = 0, szz = 0; for (const p of pts) { const dx = p[0] - mx, dz = p[1] - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  best.ux = Math.cos(ang); best.uz = Math.sin(ang);
  return best;
}

export function buildGate(scene, world, poly, at) {
  const e = nearestEdge(poly, at.x, at.z);
  if (at.wall) {  // explicit wall line from tools/landmarks.json
    const [[ax, az], [bx, bz]] = at.wall, L = Math.hypot(bx - ax, bz - az);
    e.ux = (bx - ax) / L; e.uz = (bz - az) / L;
    const t = (at.x - ax) * e.ux + (at.z - az) * e.uz;
    e.px = ax + e.ux * t; e.pz = az + e.uz * t;
  }
  // u along the wall, n into the campus (boundary is CCW in x/z -> inward is (-uz, ux)... check by centroid)
  let nx = -e.uz, nz = e.ux;
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= poly.length; cz /= poly.length;
  if ((cx - e.px) * nx + (cz - e.pz) * nz < 0) { nx = -nx; nz = -nz; }
  // seen from the street looking in (along n), "left" is (nz, -nx)
  const lx = nz, lz = -nx;
  const base = { x: e.px + nx * 3, z: e.pz + nz * 3 };
  // local (s = to the left, o = inward) -> world
  const W = (s, o) => [base.x + lx * s + nx * o, base.z + lz * s + nz * o];
  const yaw = Math.atan2(nx, nz); // mesh local +x = left, +z = inward (planes rotated by PI face the street)

  const group = new THREE.Group();
  scene.add(group);
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const add = (geo, mat, s, o, y, rot = 0) => {
    const m = new THREE.Mesh(geo, mat);
    const [x, z] = W(s, o);
    m.position.set(x, y, z);
    m.rotation.y = yaw + rot;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // oriented box collider (local s/o extents)
  const solid = (s0, s1, o0, o1, y0, y1) => {
    const P = [W(s0, o0), W(s1, o0), W(s1, o1), W(s0, o1)];
    let A = 0; for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4]; A += p[0] * q[1] - q[0] * p[1]; }
    world.addPrism(A < 0 ? P.reverse() : P, y0, y1, { mat: 'concrete' });
  };
  // box in local coords: s = left offset of center, o = inward offset, width along s, depth along o
  const box = (mat, s, o, w, d, y0, y1) => {
    add(new THREE.BoxGeometry(w, y1 - y0, d), mat, s, o, (y0 + y1) / 2);
    solid(s - w / 2, s + w / 2, o - d / 2, o + d / 2, y0, y1);
  };

  // ---------- star-fruit tower ----------
  {
    const s = 7.6, o = 0, H = 10.5, R = 2.0, r = 0.75;
    const star = (rad, inner, y) => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 2, rr = i % 2 ? inner : rad;
        pts.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
      }
      return pts;
    };
    const bot = star(R, r, 0.6), top = star(R * 0.82, r * 0.9, H);
    const pos = [], col = [];
    const deep = new THREE.Color('#183f9c'), light = new THREE.Color('#2f63cf');
    const push = (p, c) => { pos.push(...p); col.push(c.r, c.g, c.b); };
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6, c = i % 2 ? deep : light;  // alternate facets like star-fruit ridges
      for (const p of [bot[i], bot[j], top[j], bot[i], top[j], top[i]]) push(p, c);
    }
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; for (const p of [[0, H, 0], top[j], top[i]]) push(p, light); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    add(g, lam({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), s, o, 0);
    // plinth
    box(lam({ color: 0x55595e }), s, o, 4.6, 4.6, 0, 0.6);
    // logo block on top, slightly turned like the real one
    const logo = new THREE.TextureLoader().load(LOGO_URL);
    logo.colorSpace = THREE.SRGBColorSpace;
    const face = lam({ map: logo }), side = lam({ color: 0x1d4fb0 });
    add(new THREE.BoxGeometry(2.2, 1.8, 0.5), [side, side, side, side, face, face], s, o, H + 1.1, 0.35);
    // collider: the star outline
    const [wx, wz] = W(s, o), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const P = bot.map(([x, , z]) => [wx + x * cy + z * sy, wz - x * sy + z * cy]);
    let A = 0; for (let i = 0; i < 6; i++) { const p = P[i], q = P[(i + 1) % 6]; A += p[0] * q[1] - q[0] * p[1]; }
    world.addPrism(A < 0 ? P.reverse() : P, 0, H + 2, { mat: 'metal' });
  }

  // ---------- granite sign walls ----------
  {
    const granite = lam({ color: 0x2f3236 });
    const sign = TX.signText(['TRƯỜNG ĐẠI HỌC BÁCH KHOA', 'HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY'], { w: 1024, h: 200, bg: '#2f3236', fg: '#e9e1c4' });
    box(granite, 14.2, 0, 8.0, 0.7, 0, 2.3);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.45), lam({ map: sign }));
    { const [x, z] = W(14.2, -0.36); pl.position.set(x, 1.35, z); pl.rotation.y = yaw + Math.PI; group.add(pl); }
    const s268 = TX.signText(['268', 'LÝ THƯỜNG KIỆT'], { w: 256, h: 160, bg: '#2f3236', fg: '#e9e1c4' });
    box(granite, 4.4, 0, 1.6, 0.7, 0, 2.3);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), lam({ map: s268 }));
    { const [x, z] = W(4.4, -0.36); p2.position.set(x, 1.4, z); p2.rotation.y = yaw + Math.PI; group.add(p2); }
  }

  // ---------- guard house + LED screen ----------
  {
    const s = -8.5, o = 1.0;
    const wall = lam({ color: 0xeceae4 }), pillar = lam({ color: 0x3b3f44 }), roof = lam({ color: 0xf4f4f2 });
    box(wall, s, o, 4.2, 3.6, 0, 2.9);
    for (const ds of [-2.2, 2.2]) for (const dd of [-1.9, 1.9]) box(pillar, s + ds, o + dd, 0.45, 0.45, 0, 3.0);
    box(roof, s, o, 5.6, 4.8, 2.9, 3.25);
    // blue frame + dark screen, facing the street
    const blue = lam({ color: 0x1f4fb8 });
    box(blue, s, o + 0.4, 4.2, 0.5, 3.25, 6.0);
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 160); grd.addColorStop(0, '#5a4a2a'); grd.addColorStop(1, '#2a2418');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(255,220,140,0.35)'; for (let y = 4; y < 160; y += 6) g.fillRect(0, y, 256, 1);
    const scr = new THREE.CanvasTexture(c); scr.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.35), new THREE.MeshBasicMaterial({ map: scr }));
    { const [x, z] = W(s, o + 0.4 - 0.26); pm.position.set(x, 4.62, z); pm.rotation.y = yaw + Math.PI; group.add(pm); }
    // white sliding gate (bars) next to the guard house
    const white = lam({ color: 0xf2f2f0 });
    for (let k = 0; k < 18; k++) add(new THREE.BoxGeometry(0.07, 1.9, 0.07), white, s - 3.0 - k * 0.32, o - 1.6, 0.95);
    add(new THREE.BoxGeometry(5.8, 0.1, 0.1), white, s - 5.75, o - 1.6, 1.85);
    add(new THREE.BoxGeometry(5.8, 0.1, 0.1), white, s - 5.75, o - 1.6, 0.15);
    solid(s - 8.7, s - 2.8, o - 1.7, o - 1.5, 0, 1.95);
  }
  return group;
}
