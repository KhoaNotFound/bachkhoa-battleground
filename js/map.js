import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { pointInPoly } from './physics.js';

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
  const { min, scale } = meta.quant;
  const meshes = [];
  for (const o of meta.objects) {
    const q = new Uint16Array(bin, o.v[0], o.v[1] * 3);
    const pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3) {
      pos[i] = min[0] + q[i] * scale[0];
      pos[i + 1] = min[1] + q[i + 1] * scale[1];
      pos[i + 2] = min[2] + q[i + 2] * scale[2];
    }
    const idx = o.i[2] === 32 ? new Uint32Array(bin, o.i[0], o.i[1]) : new Uint16Array(bin, o.i[0], o.i[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    // The export has no materials and mixed winding, so draw both sides with flat shading.
    const mat = new THREE.MeshLambertMaterial({ color: o.color, flatShading: true, side: THREE.DoubleSide });
    if (o.ground) Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !o.ground && !lowGfx;
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
  for (const b of meta.boxes) world.add(b[0], b[1], b[2], b[3], b[4], b[5], { mat: 'concrete' });
  // invisible tall wall along the campus boundary so nobody leaves
  const WB = CAMPUS_POLY;
  for (let i = 0; i < WB.length; i++) {
    const a = WB[i], q = WB[(i + 1) % WB.length];
    const ex = q[0] - a[0], ez = q[1] - a[1], len = Math.hypot(ex, ez);
    if (len < 0.1) continue;
    const u = [ex / len, ez / len], n = [ez / len, -ex / len];
    world.addPrism(edgeRect(a, u, n, -1, len + 1, 0, 3), -5, 400, { bullet: false, mat: 'none' });
  }

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
