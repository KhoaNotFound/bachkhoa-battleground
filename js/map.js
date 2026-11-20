import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { pointInPoly } from './physics.js';
import * as TX from './textures.js';
import { buildGate } from './landmarks.js';

// Map loaded from the campus OBJ export, converted by tools/build_obj_map.py into
// assets/map/campus.{bin,json} + minimap.png. Coordinates are meters, Y up.
const BASE = new URL('../assets/map/', import.meta.url);

// Filled in by buildMap() before anything reads them (HUD and main use them after boot).
export const BOUNDS = { x0: -1, z0: -1, x1: 1, z1: 1 };
export let CAMPUS_POLY = [];

function edgeRect(a, u, n, s0, s1, o0, o1) {
  const P = (s, o) => [a[0] + u[0] * s + n[0] * o, a[1] + u[1] * s + n[1] * o];
  const r = [P(s0, o0), P(s1, o0), P(s1, o1), P(s0, o1)];
  let A = 0; for (let i = 0; i < 4; i++) { const p = r[i], q = r[(i + 1) % 4]; A += p[0] * q[1] - q[0] * p[1]; }
  return A < 0 ? r.reverse() : r;
}

export async function buildMap(scene, world, { lowGfx = false, onProgress } = {}) {
  const [meta, bin] = await Promise.all([
    fetch(new URL('campus.json', BASE)).then((r) => r.json()),
    fetch(new URL('campus.bin', BASE)).then((r) => r.arrayBuffer()),
  ]);
  onProgress?.(35);
  const mmImg = new Image();
  mmImg.src = new URL('minimap.png', BASE).href;
  const mmReady = mmImg.decode().catch(() => null);

  [BOUNDS.x0, BOUNDS.z0, BOUNDS.x1, BOUNDS.z1] = meta.bbox;
  CAMPUS_POLY = meta.boundary;

  // ---------- render meshes ----------
  // Every triangle has a material (see tools/build_obj_map.py). The export has no UVs, so they are
  // box-projected here from each face's normal: facades get one window row per 3.9 m floor.
  const { min, scale } = meta.quant;
  const q = new Uint16Array(bin);
  const texFor = {
    facade: (m) => TX.facade(m.style), roof: (m) => TX.roof(m.color, m.style),
    pitch: (m) => TX.field(m.bbox[2] - m.bbox[0], m.bbox[3] - m.bbox[1]), asphalt: () => TX.asphalt(), pavers: () => TX.pavers(), grass: () => TX.grass(), concrete: () => TX.roof('#cfccc2'),
  };
  const TILE = { facade: 4, roof: 4, asphalt: 6, pavers: 4, grass: 6, concrete: 4 };
  const FLOOR_H = 3.9;
  const meshes = [];
  for (const mt of meta.materials) {
    const [t0, nt] = mt.tris;
    if (!nt) continue;
    const n = nt * 9, pos = new Float32Array(n), nor = new Float32Array(n);
    const textured = !!texFor[mt.kind];
    const uv = textured ? new Float32Array(nt * 6) : null;
    const tile = TILE[mt.kind] || 4;
    for (let t = 0; t < nt; t++) {
      const b = (t0 + t) * 9, o = t * 9;
      for (let k = 0; k < 9; k += 3) {
        pos[o + k] = min[0] + q[b + k] * scale[0];
        pos[o + k + 1] = min[1] + q[b + k + 1] * scale[1];
        pos[o + k + 2] = min[2] + q[b + k + 2] * scale[2];
      }
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
      const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 9; k += 3) { nor[o + k] = nx; nor[o + k + 1] = ny; nor[o + k + 2] = nz; }
      if (!uv) continue;
      const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
      for (let k = 0, u = t * 6; k < 3; k++, u += 2) {
        const x = pos[o + k * 3], y = pos[o + k * 3 + 1], z = pos[o + k * 3 + 2];
        if (mt.bbox) { uv[u] = (x - mt.bbox[0]) / (mt.bbox[2] - mt.bbox[0]); uv[u + 1] = 1 - (z - mt.bbox[1]) / (mt.bbox[3] - mt.bbox[1]); }
        else if (any >= anx && any >= anz) { uv[u] = x / tile; uv[u + 1] = -z / tile; }
        else {
          uv[u] = (anx > anz ? z * Math.sign(nx) : -x * Math.sign(nz)) / tile;
          uv[u + 1] = y / (mt.kind === 'facade' ? FLOOR_H : tile);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    // mixed winding in the export -> draw both sides
    const mat = new THREE.MeshLambertMaterial(textured
      ? { map: texFor[mt.kind](mt), side: THREE.DoubleSide }
      : { color: mt.color, side: THREE.DoubleSide });
    if (mt.ground) Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !mt.ground && !lowGfx;
    m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
  }

  // far ground beyond the model
  {
    const g = new THREE.PlaneGeometry(2400, 2400);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8e8c84 }));
    m.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, -0.35, (BOUNDS.z0 + BOUNDS.z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- collision ----------
  // collision.bin (tools/build_obj_map.py + voxel_collision.py): int16 boxes in 0.25 m units from
  // the grid origin. Solid boxes first (block movement and bullets), then the virtual cage:
  // movement-only boxes over unreachable surfaces and ceilings over open sky.
  {
    const c = meta.collision, g = meta.grid;
    const buf = await fetch(new URL(c.file, BASE)).then((r) => r.arrayBuffer());
    const q = new Int16Array(buf), U = c.unit;
    for (let i = 0, n = 0; i < q.length; i += 6, n++) {
      const solid = n < c.solid;
      world.add(g.x0 + q[i] * U, q[i + 1] * U, g.z0 + q[i + 2] * U, g.x0 + q[i + 3] * U, q[i + 4] * U, g.z0 + q[i + 5] * U,
        solid ? { mat: 'concrete' } : { bullet: false, mat: 'none' });
    }
  }
  // invisible tall wall along the campus boundary so nobody leaves
  const WB = CAMPUS_POLY;
  for (let i = 0; i < WB.length; i++) {
    const a = WB[i], q = WB[(i + 1) % WB.length];
    const ex = q[0] - a[0], ez = q[1] - a[1], len = Math.hypot(ex, ez);
    if (len < 0.1) continue;
    const u = [ex / len, ez / len], n = [ez / len, -ex / len];
    world.addPrism(edgeRect(a, u, n, -1, len + 1, 0, 3), -5, 400, { bullet: false, mat: 'none' });
  }

  // ---------- landmarks ----------
  if (meta.gate) buildGate(scene, world, CAMPUS_POLY, meta.gate);

  // ---------- spawns (precomputed on reachable open ground) ----------
  const spawns = meta.spawns.filter(([x, z]) => pointInPoly(x, z, CAMPUS_POLY)).map(([x, z]) => ({ x, y: 0, z }));

  // ---------- clouds ----------
  {
    const crng = mulberry32(42), n = 26;
    const cx0 = (BOUNDS.x0 + BOUNDS.x1) / 2, cz0 = (BOUNDS.z0 + BOUNDS.z1) / 2;
    const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8899aa, flatShading: true }), n * 4);
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = crng() * Math.PI * 2, d = 380 + crng() * 320, cx = cx0 + Math.cos(a) * d, cz = cz0 + Math.sin(a) * d, cy = 120 + crng() * 60;
      for (let j = 0; j < 4; j++) { const r = 10 + crng() * 14; m4.compose(p.set(cx + (j - 1.5) * r * 0.9, cy + crng() * 6, cz + crng() * 10), qt, s.set(r * 1.4, r * 0.6, r)); clouds.setMatrixAt(k++, m4); }
    }
    scene.add(clouds);
    scene.userData.cloudMat = clouds.material;  // dimmed at night by main.js
  }

  await mmReady;
  const g = meta.grid;
  const minimap = {
    boundary: CAMPUS_POLY, buildings: [], pitches: [], roads: [], labels: [], trees: [], props: [],
    image: mmImg.naturalWidth ? { img: mmImg, x0: g.x0, z0: g.z0, x1: g.x0 + g.w * g.res, z1: g.z0 + g.h * g.res } : null,
  };
  const center = { x: (BOUNDS.x0 + BOUNDS.x1) / 2, z: (BOUNDS.z0 + BOUNDS.z1) / 2 };
  return { spawns, minimap, meshes, center, stairs: [], trees: 0 };
}
