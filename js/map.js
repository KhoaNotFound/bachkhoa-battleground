import * as THREE from 'three';
import { mulberry32 } from './util.js';
import * as TX from './textures.js';
import { pointInPoly } from './physics.js';
import CAMPUS from './campus-data.js';

// Map built from real OpenStreetMap footprints of the HCMUT campus (268 Lý Thường Kiệt),
// (c) OpenStreetMap contributors, ODbL. Coordinates are meters (scaled, rotated), see tools/build_campus.py.
export const BOUNDS = { x0: CAMPUS.bbox[0], z0: CAMPUS.bbox[1], x1: CAMPUS.bbox[2], z1: CAMPUS.bbox[3] };
export const CAMPUS_POLY = CAMPUS.boundary;
const FLOOR = 3.4;

// ---------- small geometry helpers ----------
function signedArea(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function ccw(P) { return signedArea(P) < 0 ? P.slice().reverse() : P; }
function polyArea(P) { return Math.abs(signedArea(P)); }
function centroid(P) { let x = 0, z = 0; for (const p of P) { x += p[0]; z += p[1]; } return [x / P.length, z / P.length]; }
function distSeg(x, z, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (ax + ex * t), z - (az + ez * t));
}
function distPolyEdge(x, z, P) { let d = Infinity; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; d = Math.min(d, distSeg(x, z, a[0], a[1], b[0], b[1])); } return d; }
function distPoly(x, z, P) { return pointInPoly(x, z, P) ? 0 : distPolyEdge(x, z, P); }
function distLine(x, z, pts) { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; }
function orect(cx, cz, len, wid, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), hl = len / 2, hw = wid / 2;
  return ccw([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]));
}
// oriented rectangle along an edge: from s0..s1 along u, and o0..o1 along outward normal n
function edgeRect(a, u, n, s0, s1, o0, o1) {
  const P = (s, o) => [a[0] + u[0] * s + n[0] * o, a[1] + u[1] * s + n[1] * o];
  return ccw([P(s0, o0), P(s1, o0), P(s1, o1), P(s0, o1)]);
}

export function buildMap(scene, world, { lowGfx = false } = {}) {
  const rng = mulberry32(268);
  const R = (a, b) => a + (b - a) * rng();

  // ---------- materials ----------
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const po = (n) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });
  const mats = {
    f_cream: lam({ map: TX.facade('cream') }), f_white: lam({ map: TX.facade('white') }), f_yellow: lam({ map: TX.facade('yellow') }),
    f_grey: lam({ map: TX.facade('grey') }), f_corridor: lam({ map: TX.facade('corridor') }), f_glass: lam({ map: TX.facade('glass') }),
    f_shed: lam({ map: TX.facade('shed') }), f_city1: lam({ map: TX.facade('city1') }), f_city2: lam({ map: TX.facade('city2') }), f_city3: lam({ map: TX.facade('city3') }),
    r_red: lam({ map: TX.roof('#e2765d', 'tile') }), r_blue: lam({ map: TX.roof('#9cc6ea', 'metal') }), r_grey: lam({ map: TX.roof('#b9bdbf') }),
    r_green: lam({ map: TX.roof('#6fd391', 'metal') }), r_solar: lam({ map: TX.roof('#c9cccf', 'solar') }), r_concrete: lam({ map: TX.roof('#cfcfc8') }),
    r_city: lam({ map: TX.roof('#a7a59e') }),
    concrete: lam({ map: TX.roof('#d6d3ca') }), wall: lam({ map: TX.roof('#ddd2b4') }), wallTop: lam({ color: 0xb79e74 }),
    stair: lam({ map: TX.roof('#c8c5bc') }), rail: lam({ color: 0x8a949c }), trunk: lam({ color: 0x6b4a2f }),
    car: lam({ color: 0xffffff, vertexColors: true }), dark: lam({ color: 0x2a2e33 }), metal: lam({ color: 0x9aa3aa }), white: lam({ color: 0xf4f4f4 }),
    crate: lam({ color: 0xb08850 }), barrier: lam({ color: 0xd8d6cf }), bench: lam({ color: 0x8a5a36 }),
    shedRoof: lam({ map: TX.roof('#7fa7c4', 'metal'), side: THREE.DoubleSide }), moto: lam({ color: 0xffffff, vertexColors: true }),
    pad: lam({ map: TX.pavers(), ...po(1) }), road: lam({ map: TX.asphalt(), ...po(2) }), roadOut: lam({ map: TX.asphalt(), ...po(2) }),
    grass: lam({ map: TX.grass(), ...po(2) }), outsideGround: lam({ map: TX.roof('#9a9890') }),
  };

  // ---------- merged geometry buckets ----------
  const buckets = new Map();
  const B = (key) => { let b = buckets.get(key); if (!b) { b = { pos: [], nor: [], uv: [], col: [] }; buckets.set(key, b); } return b; };
  function tri(bk, p, n, uv, color) {
    for (let i = 0; i < 3; i++) { bk.pos.push(p[i][0], p[i][1], p[i][2]); bk.nor.push(n[0], n[1], n[2]); bk.uv.push(uv[i][0], uv[i][1]); if (color) bk.col.push(color.r, color.g, color.b); }
  }
  function quad(bk, p, n, uv, color) { tri(bk, [p[0], p[1], p[2]], n, [uv[0], uv[1], uv[2]], color); tri(bk, [p[0], p[2], p[3]], n, [uv[0], uv[2], uv[3]], color); }
  // Extrude CCW polygon between y0..y1. side/top = material keys (null to skip).
  function extrude(side, top, P, y0, y1, o = {}) {
    P = ccw(P);
    const uS = o.uS || 4, vS = o.vS || 3.5, col = o.color;
    if (side) {
      const s = B(side);
      let u = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez);
        if (len < 1e-4) continue;
        const n = [ez / len, 0, -ex / len];
        const u0 = o.uFrom0 ? 0 : u, u1 = u0 + len / uS;
        const v0 = 0, v1 = (y1 - y0) / vS;
        // outward face, CCW seen from outside: a(bottom) -> b(bottom) -> b(top) -> a(top) is CW from outside for CCW poly; flip order
        quad(s, [[b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]], n, [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], col);
        u = u1;
      }
    }
    if (top) {
      const t = B(top), tS = o.tS || 4;
      const contour = P.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [i, j, k] of tris) {
        const A = P[i], Bp = P[j], C = P[k];
        // ensure upward facing (CCW from above in x/-z). In x/z with CCW (positive area), from above (+y) it appears CW -> reverse
        const cr = (Bp[0] - A[0]) * (C[1] - A[1]) - (Bp[1] - A[1]) * (C[0] - A[0]);
        const [X, Y] = cr > 0 ? [C, Bp] : [Bp, C];
        tri(t, [[A[0], y1, A[1]], [X[0], y1, X[1]], [Y[0], y1, Y[1]]], [0, 1, 0], [[A[0] / tS, -A[1] / tS], [X[0] / tS, -X[1] / tS], [Y[0] / tS, -Y[1] / tS]], col);
      }
    }
    if (o.collide !== false) return world.addPrism(P, y0, y1, { bullet: o.bullet, walk: o.walk, mat: o.mat || 'concrete' });
    return null;
  }
  function flatPoly(key, P, y, tS = 4) { extrude(null, key, P, y, y, { collide: false, tS }); }
  function obox(side, top, cx, cz, len, wid, ang, y0, y1, o = {}) { return extrude(side, top, orect(cx, cz, len, wid, ang), y0, y1, o); }
  function ribbon(key, pts, w, y) {
    const bk = B(key), hw = w / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez);
      if (len < 0.01) continue;
      const nx = -ez / len * hw, nz = ex / len * hw;
      const ext = Math.min(hw, len * 0.5); // small overlap to hide joints
      const ux = ex / len * ext, uz = ez / len * ext;
      const p = [[a[0] - nx - ux, y, a[1] - nz - uz], [b[0] - nx + ux, y, b[1] - nz + uz], [b[0] + nx + ux, y, b[1] + nz + uz], [a[0] + nx - ux, y, a[1] + nz - uz]];
      const uv = p.map((q) => [q[0] / 6, -q[2] / 6]);
      // make sure it faces up
      const cr = (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]) - (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]);
      if (cr > 0) quad(bk, [p[0], p[3], p[2], p[1]], [0, 1, 0], [uv[0], uv[3], uv[2], uv[1]]);
      else quad(bk, p, [0, 1, 0], uv);
    }
  }

  const minimap = { buildings: [], pitches: [], roads: [], labels: [], trees: [], props: [], boundary: CAMPUS.boundary };
  const solids = []; // polygons to avoid when placing things (buildings, stairs, pitches)
  const blocked = (x, z, r) => {
    if (!pointInPoly(x, z, CAMPUS.boundary) || distPolyEdge(x, z, CAMPUS.boundary) < r + 1) return true;
    for (const s of solids) if (distPoly(x, z, s.p) < r + (s.m || 0)) return true;
    return false;
  };
  const circles = []; // trees + props as circles
  const circleFree = (x, z, r) => { for (const c of circles) if (Math.hypot(c[0] - x, c[1] - z) < c[2] + r) return false; return true; };
  const roadsIn = CAMPUS.roads.filter((r) => r.in || r.p.some((p) => pointInPoly(p[0], p[1], CAMPUS.boundary)));
  const nearRoad = (x, z, extra) => { for (const r of roadsIn) if (distLine(x, z, r.p) < r.w / 2 + extra) return true; return false; };

  // ---------- ground ----------
  {
    const g = new THREE.PlaneGeometry(1400, 1400);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1400 / 6, uv.getY(i) * 1400 / 6);
    const m = new THREE.Mesh(g, mats.outsideGround);
    m.receiveShadow = true;
    scene.add(m);
  }
  flatPoly('pad', CAMPUS.boundary, 0.03, 4);
  for (const r of CAMPUS.roads) ribbon(r.in ? 'road' : 'roadOut', r.p, r.w, r.in ? 0.05 : 0.025);
  for (const r of roadsIn) minimap.roads.push({ p: r.p, w: r.w });

  // ---------- pitches ----------
  const fieldTex = TX.field(), courtTex = TX.court();
  for (const pt of CAMPUS.pitches) {
    const P = ccw(pt.p);
    // orientation from the longest edge
    let best = 0, ang = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of P) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const L = u1 - u0, W = v1 - v0, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const cx = cu * c - cv * s, cz = cu * s + cv * c;
    const isSoccer = pt.s === 'soccer';
    const tex = isSoccer ? fieldTex : courtTex;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, W), lam({ map: tex, ...po(3) }));
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, -ang, 0);
    m.position.set(cx, 0.07, cz);
    m.receiveShadow = true;
    scene.add(m);
    minimap.pitches.push({ p: orect(cx, cz, L, W, ang), s: pt.s });
    solids.push({ p: orect(cx, cz, L, W, ang), m: 0.5, pitch: true });
    if (isSoccer) {
      // goals at both short ends
      for (const side of [-1, 1]) {
        const gx = cx + c * side * (L / 2 - 1.2), gz = cz + s * side * (L / 2 - 1.2);
        const gw = Math.min(7.3, W * 0.25);
        for (const k of [-1, 1]) obox('white', 'white', gx - s * k * gw / 2, gz + c * k * gw / 2, 0.15, 0.15, ang, 0, 2.44, { mat: 'metal' });
        obox('white', 'white', gx, gz, 0.15, gw, ang, 2.3, 2.44, { mat: 'metal', walk: false });
      }
    } else {
      // court fence posts at the corners (light cover), basketball hoops
      if (pt.s === 'basketball') for (const side of [-1, 1]) {
        const hx = cx + c * side * (L / 2 - 0.6), hz = cz + s * side * (L / 2 - 0.6);
        obox('dark', 'dark', hx, hz, 0.25, 0.25, ang, 0, 3.4, { mat: 'metal' });
        obox('white', 'white', hx - c * side * 0.5, hz - s * side * 0.5, 0.1, 1.8, ang, 2.9, 4.0, { mat: 'metal' });
      }
    }
  }

  // ---------- buildings ----------
  const LEVELS = { A1: 3, A2: 3, A3: 3, A4: 3, A5: 4, B1: 3, B2: 4, B3: 4, B4: 6, B6: 5, B7: 3, B8: 3, B9: 3, B10: 7, B11: 5, B12: 2, C1: 4, C2: 3, C3: 3, C4: 3, C5: 3, C6: 4, 'Căn tin': 2, 'Xưởng in': 2 };
  const bList = CAMPUS.buildings.map((b) => {
    const P = ccw(b.p), area = polyArea(P);
    const lv = b.lv || LEVELS[b.n] || (area < 90 ? 1 : area < 220 ? 2 : 3);
    let style, roof;
    const n = b.n || '';
    if (n.startsWith('A')) { style = 'yellow'; roof = 'red'; }
    else if (n.startsWith('C')) { style = 'corridor'; roof = 'blue'; }
    else if (n === 'B10') { style = 'white'; roof = 'solar'; }
    else if (n === 'B4' || n === 'B11') { style = 'glass'; roof = 'grey'; }
    else if (n.startsWith('B')) { style = ['white', 'cream', 'grey'][n.length % 3]; roof = ['grey', 'concrete', 'red'][(n.charCodeAt(1) || 0) % 3]; }
    else if (n === 'Căn tin') { style = 'cream'; roof = 'red'; }
    else if (area < 130) { style = 'shed'; roof = 'blue'; }
    else { style = 'grey'; roof = 'concrete'; }
    return { name: n, P, area, h: lv * FLOOR + 0.6, style, roof, c: centroid(P) };
  });
  for (const b of bList) solids.push({ p: b.P, m: 0.8, building: b });

  // exterior staircases to some rooftops (placed before trees/props so they keep clear)
  const landings = [], stairInfo = [];
  function tryStairs(b) {
    if (b.h < 6 || b.h > 15) return false;
    const P = b.P;
    const edges = P.map((a, i) => { const q = P[(i + 1) % P.length]; const ex = q[0] - a[0], ez = q[1] - a[1], len = Math.hypot(ex, ez); return { a, q, len, u: [ex / len, ez / len], n: [ez / len, -ex / len], i }; }).sort((x, y) => y.len - x.len);
    const rise = 0.45, run = 0.72, w = 2.0;
    const N = Math.ceil(b.h / rise);
    const need = N * run + 1.8 + 1.2;
    for (const e of edges) {
      if (e.len < need + 1) continue;
      for (const startAtEnd of [false, true]) {
        const a = startAtEnd ? e.q : e.a, u = startAtEnd ? [-e.u[0], -e.u[1]] : e.u;
        // check footprint clear
        const foot = edgeRect(a, u, e.n, 0.8, 0.8 + need - 1.2, 0.1, 0.1 + w);
        let ok = foot.every((p) => pointInPoly(p[0], p[1], CAMPUS.boundary) && distPolyEdge(p[0], p[1], CAMPUS.boundary) > 1.5);
        if (ok) for (const s of solids) { if (s.building === b) continue; for (const p of foot.concat([centroid(foot)])) if (distPoly(p[0], p[1], s.p) < 0.6) { ok = false; break; } if (!ok) break; }
        if (!ok) continue;
        for (let i = 0; i < N; i++) {
          const y1 = Math.min(b.h, (i + 1) * rise);
          extrude('stair', 'stair', edgeRect(a, u, e.n, 0.8 + i * run, 0.8 + (i + 1) * run, 0.1, 0.1 + w), 0, y1, { uS: 2, vS: 2 });
        }
        const s0 = 0.8 + N * run, s1 = s0 + 1.8;
        extrude('stair', 'stair', edgeRect(a, u, e.n, s0, s1, 0.0, 0.1 + w), 0, b.h, { uS: 2, vS: 2 });
        // railing on the open side
        for (let i = 0; i <= N; i += 3) {
          const s = 0.8 + i * run, y = Math.min(b.h, i * rise);
          const p = [a[0] + u[0] * s + e.n[0] * (0.15 + w), a[1] + u[1] * s + e.n[1] * (0.15 + w)];
          extrude('rail', 'rail', orect(p[0], p[1], 0.06, 0.06, 0), y, y + 1, { collide: false });
        }
        // landing info in edge coordinates of the ORIGINAL edge for parapet cut
        const sa = startAtEnd ? e.len - s1 : s0, sb = startAtEnd ? e.len - s0 : s1;
        landings.push({ b, edge: e.i, s0: sa - (startAtEnd ? 0.3 : 1.8), s1: sb + (startAtEnd ? 1.8 : 0.3) });
        solids.push({ p: edgeRect(a, u, e.n, 0.8, s1, 0, 0.1 + w), m: 0.6 });
        minimap.buildings.push({ p: edgeRect(a, u, e.n, 0.8, s1, 0, 0.1 + w), roof: 'stair', h: b.h / 2 });
        b.stairs = true;
        stairInfo.push({ name: b.name, h: b.h, start: [a[0] + u[0] * 0.2 + e.n[0] * 1.1, a[1] + u[1] * 0.2 + e.n[1] * 1.1], dir: u, inward: [-e.n[0], -e.n[1]] });
        return true;
      }
    }
    return false;
  }
  const stairCands = bList.filter((b) => b.area > 280 && b.h >= 6 && b.h <= 15).sort((x, y) => y.area - x.area);
  let nStairs = 0;
  for (const b of stairCands) { if (nStairs >= 8) break; if (tryStairs(b)) nStairs++; }

  for (const b of bList) {
    extrude('f_' + b.style, 'r_' + b.roof, b.P, 0, b.h, { tS: b.roof === 'solar' ? 6 : 4 });
    // roof trim band
    const P = b.P;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], q = P[(i + 1) % P.length];
      const ex = q[0] - a[0], ez = q[1] - a[1], len = Math.hypot(ex, ez);
      if (len < 0.3) continue;
      const u = [ex / len, ez / len], n = [ez / len, -ex / len];
      if (b.stairs) {
        // walkable roof: 1 m parapet (cover for snipers), cut where a staircase lands
        const cuts = landings.filter((L) => L.b === b && L.edge === i);
        let pieces = [[0, len]];
        for (const c of cuts) pieces = pieces.flatMap(([p0, p1]) => (c.s1 <= p0 || c.s0 >= p1) ? [[p0, p1]] : [[p0, c.s0], [c.s1, p1]].filter(([x0, x1]) => x1 - x0 > 0.1));
        for (const [p0, p1] of pieces) extrude('concrete', 'wallTop', edgeRect(a, u, n, p0, p1, -0.3, 0.05), b.h, b.h + 1.0, { mat: 'concrete' });
      } else {
        extrude('wallTop', 'wallTop', edgeRect(a, u, n, 0, len, -0.2, 0.15), b.h - 0.05, b.h + 0.3, { collide: false });
      }
    }
    // rooftop clutter (water tanks / AC) as cover on walkable roofs, decoration elsewhere
    const nProps = Math.min(6, Math.floor(b.area / 180));
    for (let k = 0, tries = 0; k < nProps && tries < 40; tries++) {
      const x = R(Math.min(...P.map((p) => p[0])), Math.max(...P.map((p) => p[0]))), z = R(Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[1])));
      if (!pointInPoly(x, z, P) || distPolyEdge(x, z, P) < 2) continue;
      k++;
      if (rng() < 0.5) obox('metal', 'metal', x, z, 1.6, 1.6, 0, b.h, b.h + 1.6, { mat: 'metal' });
      else obox('white', 'white', x, z, 2.6, 1.1, rng() * 3, b.h, b.h + 1.1, { mat: 'metal' });
    }
    if (b.name) {
      minimap.labels.push({ name: b.name, x: b.c[0], z: b.c[1] });
      addSign(b);
    }
    minimap.buildings.push({ p: P, roof: b.roof, h: b.h, name: b.name });
  }
  function addSign(b) {
    // on the longest edge, facing outward
    const P = b.P; let best = null;
    for (let i = 0; i < P.length; i++) { const a = P[i], q = P[(i + 1) % P.length]; const len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (!best || len > best.len) best = { a, q, len }; }
    const t = TX.signText([b.name], { w: 256, h: 128, bg: '#0b3d91' });
    const w = Math.min(4, 1.2 + b.name.length * 0.55);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.6), new THREE.MeshLambertMaterial({ map: t }));
    const ex = best.q[0] - best.a[0], ez = best.q[1] - best.a[1];
    const nx = ez / best.len, nz = -ex / best.len;
    m.position.set((best.a[0] + best.q[0]) / 2 + nx * 0.04, b.h - 1.4, (best.a[1] + best.q[1]) / 2 + nz * 0.04);
    m.rotation.y = Math.atan2(nx, nz);
    scene.add(m);
  }

  // ---------- boundary wall + gate ----------
  const WB = CAMPUS.boundary;
  // gate on the boundary edge nearest to the main (primary) road
  const primary = CAMPUS.roads.filter((r) => r.k === 'primary' || r.k === 'secondary');
  let gate = null;
  for (let i = 0; i < WB.length; i++) {
    const a = WB[i], q = WB[(i + 1) % WB.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (len < 40) continue;
    const mx = (a[0] + q[0]) / 2, mz = (a[1] + q[1]) / 2;
    let d = Infinity; for (const r of primary) d = Math.min(d, distLine(mx, mz, r.p));
    if (!gate || d < gate.d) gate = { i, d, a, q, len };
  }
  const WH = 3.0;
  for (let i = 0; i < WB.length; i++) {
    const a = WB[i], q = WB[(i + 1) % WB.length];
    const ex = q[0] - a[0], ez = q[1] - a[1], len = Math.hypot(ex, ez);
    if (len < 0.1) continue;
    const u = [ex / len, ez / len], n = [ez / len, -ex / len];
    let pieces = [[-0.25, len + 0.25]];
    if (gate && gate.i === i) pieces = [[-0.25, len / 2 - 10], [len / 2 + 10, len + 0.25]];
    for (const [p0, p1] of pieces) extrude('wall', 'wallTop', edgeRect(a, u, n, p0, p1, 0, 0.5), 0, WH, { tS: 3 });
    // invisible tall wall so nobody leaves from a rooftop
    world.addPrism(edgeRect(a, u, n, -1, len + 1, 0, 3), 0, 400, { bullet: false, mat: 'none' });
    if (gate && gate.i === i) {
      const mid = len / 2;
      extrude('concrete', 'concrete', edgeRect(a, u, n, mid - 11.5, mid - 9.5, -0.6, 1.2), 0, 7.5);
      extrude('concrete', 'concrete', edgeRect(a, u, n, mid + 9.5, mid + 11.5, -0.6, 1.2), 0, 7.5);
      extrude('concrete', 'concrete', edgeRect(a, u, n, mid - 11.5, mid + 11.5, -0.4, 1.0), 7.5, 9.2, { collide: false });
      for (let s = mid - 9.4; s < mid + 9.4; s += 0.5) extrude('rail', null, edgeRect(a, u, n, s, s + 0.08, 0.1, 0.18), 0, 2.2, { collide: false });
      extrude('rail', 'rail', edgeRect(a, u, n, mid - 9.5, mid + 9.5, 0.05, 0.25), 2.1, 2.25, { collide: false });
      const t = TX.signText(['TRƯỜNG ĐẠI HỌC BÁCH KHOA', 'ĐẠI HỌC QUỐC GIA TP.HCM · BATTLEGROUND'], { w: 1024, h: 160 });
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(22.6, 1.5), new THREE.MeshBasicMaterial({ map: t }));
        const off = side > 0 ? 1.03 : -0.43;
        m.position.set(a[0] + u[0] * mid + n[0] * off, 8.35, a[1] + u[1] * mid + n[1] * off);
        m.rotation.y = Math.atan2(n[0] * side, n[1] * side);
        scene.add(m);
      }
      // flag pole just inside the gate
      const fp = [a[0] + u[0] * (mid + 14) - n[0] * 6, a[1] + u[1] * (mid + 14) - n[1] * 6];
      obox('white', 'white', fp[0], fp[1], 0.3, 0.3, 0, 0, 12, { mat: 'metal' });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshLambertMaterial({ color: 0xda251d, side: THREE.DoubleSide }));
      flag.position.set(fp[0] + 1.3, 11, fp[1]);
      scene.add(flag);
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.42, 5), new THREE.MeshBasicMaterial({ color: 0xffde00, side: THREE.DoubleSide }));
      star.rotation.z = Math.PI / 2; star.position.set(fp[0] + 1.3, 11, fp[1] + 0.01);
      scene.add(star);
      solids.push({ p: edgeRect(a, u, n, mid - 12, mid + 16, -8, 1), m: 0 });
    }
  }

  // ---------- trees ----------
  const treeList = [];
  function tree(x, z, s) {
    if (blocked(x, z, 1.4) || nearRoad(x, z, 1.0) || !circleFree(x, z, 1.6)) return false;
    treeList.push({ x, z, s, h: R(0.85, 1.25) * s });
    world.add(x - 0.28 * s, 0, z - 0.28 * s, x + 0.28 * s, 3.2 * s, z + 0.28 * s, { mat: 'wood' });
    circles.push([x, z, 1.4]);
    minimap.trees.push([x, z, 2.4 * s]);
    return true;
  }
  {
    // rows of trees along the campus roads (HCMUT is full of them) + scattered groves
    for (const r of roadsIn) {
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
        for (let s = 3; s < len; s += 7.5) {
          for (const side of [-1, 1]) {
            if (rng() < 0.35) continue;
            const off = r.w / 2 + 2.2;
            tree(a[0] + (b[0] - a[0]) * s / len + nx * off * side, a[1] + (b[1] - a[1]) * s / len + nz * off * side, R(0.9, 1.2));
          }
        }
      }
    }
    for (let x = BOUNDS.x0; x < BOUNDS.x1; x += 6.5) for (let z = BOUNDS.z0; z < BOUNDS.z1; z += 6.5) {
      if (rng() < 0.55) continue;
      tree(x + R(-2, 2), z + R(-2, 2), R(0.9, 1.3));
    }
  }

  // ---------- props / cover ----------
  const carColors = [0xd8dde2, 0x24272b, 0xb8302c, 0x2f5fa8, 0xeeeeee, 0x7d8a92, 0xc9a64a];
  function car(x, z, ang) {
    if (blocked(x, z, 2.4) || !circleFree(x, z, 2.4)) return false;
    const c = new THREE.Color(carColors[Math.floor(rng() * carColors.length)]);
    obox('car', 'car', x, z, 4.3, 1.85, ang, 0.25, 1.05, { color: c, mat: 'metal' });
    obox('car', 'car', x, z, 2.5, 1.6, ang, 1.05, 1.6, { color: new THREE.Color(0x1d2733), mat: 'metal' });
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const su of [-1.35, 1.35]) for (const sv of [-0.8, 0.8]) obox('car', 'car', x + su * cs - sv * sn, z + su * sn + sv * cs, 0.66, 0.3, ang, 0, 0.62, { color: new THREE.Color(0x111111), collide: false });
    circles.push([x, z, 2.4]);
    minimap.props.push(orect(x, z, 4.3, 1.85, ang));
    return true;
  }
  function crate(x, z, ang, stack) {
    if (blocked(x, z, 1) || nearRoad(x, z, 0.5) || !circleFree(x, z, 1.2)) return false;
    for (let i = 0; i < stack; i++) obox('crate', 'crate', x, z, 1.3, 1.3, ang, i * 1.3, (i + 1) * 1.3, { mat: 'wood', uS: 1.3, vS: 1.3 });
    circles.push([x, z, 1.2]);
    minimap.props.push(orect(x, z, 1.3, 1.3, ang));
    return true;
  }
  function barrier(x, z, ang) {
    if (blocked(x, z, 1.6) || !circleFree(x, z, 1.7)) return false;
    obox('barrier', 'barrier', x, z, 3, 0.6, ang, 0, 0.95);
    circles.push([x, z, 1.6]);
    minimap.props.push(orect(x, z, 3, 0.6, ang));
    return true;
  }
  function motoRow(b) {
    // covered motorbike parking along a building wall (very HCMUT)
    const P = b.P;
    let e = null;
    for (let i = 0; i < P.length; i++) { const a = P[i], q = P[(i + 1) % P.length]; const len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len > 14 && (!e || len > e.len)) e = { a, q, len }; }
    if (!e) return false;
    const u = [(e.q[0] - e.a[0]) / e.len, (e.q[1] - e.a[1]) / e.len], n = [u[1], -u[0]];
    const s0 = 2, s1 = Math.min(e.len - 2, 2 + 22);
    const foot = edgeRect(e.a, u, n, s0, s1, 2.2, 5.6);
    for (const p of foot.concat([centroid(foot)])) if (blocked(p[0], p[1], 0.3) || nearRoad(p[0], p[1], 0)) return false;
    extrude('shedRoof', 'shedRoof', edgeRect(e.a, u, n, s0, s1, 2.0, 5.8), 2.6, 2.72, { mat: 'metal', walk: false });
    for (let s = s0; s <= s1 + 0.01; s += (s1 - s0) / Math.max(1, Math.round((s1 - s0) / 5))) for (const o of [2.1, 5.7]) {
      const p = [e.a[0] + u[0] * s + n[0] * o, e.a[1] + u[1] * s + n[1] * o];
      obox('metal', 'metal', p[0], p[1], 0.18, 0.18, 0, 0, 2.6, { mat: 'metal' });
    }
    const colors = [0xc0392b, 0x1f1f1f, 0xdedede, 0x2e5ea8, 0x7f8c8d, 0xd35400];
    const ang = Math.atan2(n[1], n[0]);
    for (let s = s0 + 0.5; s < s1 - 0.3; s += 0.75) {
      if (rng() < 0.15) continue;
      const p = [e.a[0] + u[0] * s + n[0] * 3.9, e.a[1] + u[1] * s + n[1] * 3.9];
      obox('moto', 'moto', p[0], p[1], 1.7, 0.36, ang, 0.25, 0.95, { color: new THREE.Color(colors[Math.floor(rng() * colors.length)]), collide: false });
      obox('moto', 'moto', p[0], p[1], 1.5, 0.3, ang, 0, 0.3, { color: new THREE.Color(0x111111), collide: false });
    }
    extrude(null, null, edgeRect(e.a, u, n, s0 + 0.3, s1 - 0.3, 3.05, 4.75), 0, 0.95, { mat: 'metal' });
    solids.push({ p: edgeRect(e.a, u, n, s0, s1, 2.0, 5.8), m: 0.5 });
    minimap.buildings.push({ p: edgeRect(e.a, u, n, s0, s1, 2.0, 5.8), roof: 'shed', h: 2.6 });
    return true;
  }
  {
    let nm = 0;
    for (const b of bList.filter((b) => !b.stairs && b.area > 300).sort((x, y) => y.area - x.area)) { if (nm >= 6) break; if (motoRow(b)) nm++; }
    // parked cars along service roads
    let nc = 0;
    for (const r of roadsIn.filter((r) => r.k === 'service' || r.k === 'residential')) {
      for (let i = 0; i < r.p.length - 1 && nc < 34; i++) {
        const a = r.p[i], b = r.p[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 8) continue;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
        for (let s = 4; s < len - 3; s += R(9, 22)) {
          const side = rng() < 0.5 ? -1 : 1, off = r.w / 2 + 1.1;
          if (car(a[0] + (b[0] - a[0]) * s / len + nx * off * side, a[1] + (b[1] - a[1]) * s / len + nz * off * side, ang)) nc++;
        }
      }
    }
    // scattered crates and barriers for cover in open areas
    let np = 0;
    for (let t = 0; t < 2500 && np < 70; t++) {
      const x = R(BOUNDS.x0, BOUNDS.x1), z = R(BOUNDS.z0, BOUNDS.z1);
      if (rng() < 0.55 ? crate(x, z, rng() * 3, 1 + Math.floor(rng() * 2)) : barrier(x, z, rng() * 3)) np++;
    }
  }

  // ---------- outside city (no collision) ----------
  {
    const crng = mulberry32(777);
    const styles = ['f_city1', 'f_city2', 'f_city3', 'f_cream', 'f_white'];
    for (const ob of CAMPUS.outside) {
      const area = polyArea(ob.p);
      const lv = ob.lv || (area < 60 ? 2 : 2 + Math.floor(crng() * (area > 400 ? 6 : 4)));
      extrude(styles[Math.floor(crng() * styles.length)], 'r_city', ob.p, 0, lv * FLOOR, { collide: false });
    }
  }

  // ---------- spawn points ----------
  const spawns = [];
  {
    const srng = mulberry32(5150);
    const tmp = [];
    for (let t = 0; t < 8000 && spawns.length < 90; t++) {
      const x = BOUNDS.x0 + srng() * (BOUNDS.x1 - BOUNDS.x0), z = BOUNDS.z0 + srng() * (BOUNDS.z1 - BOUNDS.z0);
      if (!pointInPoly(x, z, CAMPUS.boundary) || distPolyEdge(x, z, CAMPUS.boundary) < 4) continue;
      let ok = true;
      for (const b of world.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5, tmp)) {
        if (b.min[1] > 2.5 || !b.walk) continue;
        if (b.isPrism ? (pointInPoly(x, z, b.poly) || distPolyEdge(x, z, b.poly) < 1.5) : (x + 1.5 > b.min[0] && x - 1.5 < b.max[0] && z + 1.5 > b.min[2] && z - 1.5 < b.max[2])) { ok = false; break; }
      }
      if (ok) spawns.push({ x, y: 0, z });
    }
  }

  // ---------- build meshes ----------
  const meshes = [];
  for (const [key, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    if (b.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[key]);
    const isFlat = ['pad', 'road', 'roadOut', 'grass'].includes(key);
    const isCity = key.startsWith('f_city') || key === 'r_city';
    m.castShadow = !isFlat && !isCity && !lowGfx;
    m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
  }
  // trees (instanced)
  {
    const trunkG = new THREE.CylinderGeometry(0.18, 0.26, 1, 6); trunkG.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkG, mats.trunk, Math.max(1, treeList.length));
    const blobG = new THREE.IcosahedronGeometry(1, 0);
    const per = 3;
    const blobs = new THREE.InstancedMesh(blobG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, treeList.length * per));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const greens = [0x2f7d32, 0x3a8f3c, 0x2a6e2e, 0x4c9a3f, 0x37813a];
    treeList.forEach((t, i) => {
      const th = 3.0 * t.h;
      m4.compose(p.set(t.x, 0, t.z), q.identity(), s.set(t.s, th, t.s));
      trunks.setMatrixAt(i, m4);
      for (let k = 0; k < per; k++) {
        const a = rng() * Math.PI * 2, rad = k === 0 ? 0 : 1.1 * t.s, r = (k === 0 ? 2.3 : 1.7) * t.s * R(0.85, 1.1);
        p.set(t.x + Math.cos(a) * rad, th + (k === 0 ? 1.0 : 0.3) * t.s + R(-0.2, 0.4), t.z + Math.sin(a) * rad);
        e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
        m4.compose(p, q, s.set(r, r * 0.85, r));
        blobs.setMatrixAt(i * per + k, m4);
        blobs.setColorAt(i * per + k, col.set(greens[Math.floor(rng() * greens.length)]));
      }
    });
    trunks.count = treeList.length; blobs.count = treeList.length * per;
    trunks.castShadow = blobs.castShadow = !lowGfx;
    trunks.receiveShadow = blobs.receiveShadow = true;
    scene.add(trunks, blobs);
  }
  // clouds
  {
    const crng = mulberry32(42), n = 26;
    const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa, flatShading: true }), n * 4);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = crng() * Math.PI * 2, d = 280 + crng() * 320, cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 110 + crng() * 60;
      for (let j = 0; j < 4; j++) { const r = 10 + crng() * 14; m4.compose(p.set(cx + (j - 1.5) * r * 0.9, cy + crng() * 6, cz + crng() * 10), q, s.set(r * 1.4, r * 0.6, r)); clouds.setMatrixAt(k++, m4); }
    }
    scene.add(clouds);
  }

  const center = { x: (BOUNDS.x0 + BOUNDS.x1) / 2, z: (BOUNDS.z0 + BOUNDS.z1) / 2 };
  return { spawns, minimap, meshes, center, stairs: stairInfo, trees: treeList.length };
}
