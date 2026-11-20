// Axis-aligned box collision world with a uniform XZ grid.
export class CollisionWorld {
  constructor(cell = 8) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this._stamp = 1;
    this._tmp = [];
  }
  key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  add(x0, y0, z0, x1, y1, z1, opts = {}) {
    const b = {
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      bullet: opts.bullet !== false,
      walk: opts.walk !== false,
      mat: opts.mat || 'concrete',
      _s: 0,
    };
    this.boxes.push(b);
    const c = this.cell;
    const i0 = Math.floor(b.min[0] / c), i1 = Math.floor(b.max[0] / c);
    const j0 = Math.floor(b.min[2] / c), j1 = Math.floor(b.max[2] / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(b);
    }
    return b;
  }
  // Vertical extruded polygon (CCW in x/z). Used for real building footprints and rotated props.
  addPrism(poly, y0, y1, opts = {}) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const b = this.add(x0, y0, z0, x1, y1, z1, opts);
    b.isPrism = true;
    b.poly = poly;
    b.edges = poly.map((a, i) => {
      const c = poly[(i + 1) % poly.length];
      const ex = c[0] - a[0], ez = c[1] - a[1], len = Math.hypot(ex, ez) || 1e-6;
      return { ax: a[0], az: a[1], ex, ez, len, nx: ez / len, nz: -ex / len };
    });
    return b;
  }
  query(x0, z0, x1, z1, out = this._tmp) {
    out.length = 0;
    const s = ++this._stamp, c = this.cell;
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c);
    const j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.grid.get(this.key(i, j));
      if (!arr) continue;
      for (const b of arr) if (b._s !== s) { b._s = s; out.push(b); }
    }
    return out;
  }
  // Returns {t, normal:[x,y,z], box} or null. o, d are arrays or {x,y,z}.
  raycast(o, d, maxDist, filter) {
    const ox = o.x ?? o[0], oy = o.y ?? o[1], oz = o.z ?? o[2];
    const dx = d.x ?? d[0], dy = d.y ?? d[1], dz = d.z ?? d[2];
    let best = maxDist, hit = null;
    // ground plane
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t >= 0 && t < best) { best = t; hit = { t, normal: [0, 1, 0], box: null, mat: 'ground' }; }
    }
    // traverse grid cells along ray (2D DDA)
    const c = this.cell;
    let i = Math.floor(ox / c), j = Math.floor(oz / c);
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDeltaI = Math.abs(dx) > 1e-9 ? Math.abs(c / dx) : Infinity;
    const tDeltaJ = Math.abs(dz) > 1e-9 ? Math.abs(c / dz) : Infinity;
    let tMaxI = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (i + 1) * c - ox : ox - i * c) / Math.abs(dx)) : Infinity;
    let tMaxJ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (j + 1) * c - oz : oz - j * c) / Math.abs(dz)) : Infinity;
    const s = ++this._stamp;
    let tCell = 0;
    for (let n = 0; n < 400 && tCell <= best; n++) {
      const arr = this.grid.get(this.key(i, j));
      if (arr) for (const b of arr) {
        if (b._s === s) continue;
        b._s = s;
        if (filter && !filter(b)) continue;
        const r = b.isPrism ? rayPrism(ox, oy, oz, dx, dy, dz, b, best) : rayBox(ox, oy, oz, dx, dy, dz, b);
        if (r && r.t < best) { best = r.t; hit = { t: r.t, normal: r.normal, box: b, mat: b.mat }; }
      }
      if (tMaxI < tMaxJ) { tCell = tMaxI; tMaxI += tDeltaI; i += stepI; }
      else { tCell = tMaxJ; tMaxJ += tDeltaJ; j += stepJ; }
    }
    return hit;
  }
}

export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
    } else {
      const inv = 1 / d[a];
      let t1 = (b.min[a] - o[a]) * inv, t2 = (b.max[a] - o[a]) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, normal: [0, 1, 0] };
  const n = [0, 0, 0]; n[axis] = sign;
  return { t: tmin, normal: n };
}

export function pointInPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// closest point on prism outline: returns {d, cx, cz, nx, nz} (n = outward normal of that edge)
const _cp = { d: 0, cx: 0, cz: 0, nx: 0, nz: 0 };
export function closestOnPrism(x, z, pr) {
  let best = Infinity;
  for (const e of pr.edges) {
    let t = ((x - e.ax) * e.ex + (z - e.az) * e.ez) / (e.len * e.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = e.ax + e.ex * t, cz = e.az + e.ez * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) { best = d; _cp.d = d; _cp.cx = cx; _cp.cz = cz; _cp.nx = e.nx; _cp.nz = e.nz; }
  }
  return _cp;
}
export function rayPrism(ox, oy, oz, dx, dy, dz, pr, maxT = Infinity) {
  if (!rayBox(ox, oy, oz, dx, dy, dz, pr)) return null;
  if (oy >= pr.min[1] && oy <= pr.max[1] && pointInPoly(ox, oz, pr.poly)) return { t: 0, normal: [0, 1, 0] };
  let best = maxT, n = null;
  for (const e of pr.edges) {
    const den = dx * e.nx + dz * e.nz;
    if (den >= -1e-9) continue;
    const t = -((ox - e.ax) * e.nx + (oz - e.az) * e.nz) / den;
    if (t < 0 || t >= best) continue;
    const px = ox + dx * t, pz = oz + dz * t;
    const s = ((px - e.ax) * e.ex + (pz - e.az) * e.ez) / (e.len * e.len);
    if (s < 0 || s > 1) continue;
    const y = oy + dy * t;
    if (y < pr.min[1] || y > pr.max[1]) continue;
    best = t; n = [e.nx, 0, e.nz];
  }
  if (Math.abs(dy) > 1e-9) {
    const capY = dy < 0 ? pr.max[1] : pr.min[1];
    const t = (capY - oy) / dy;
    if (t >= 0 && t < best && pointInPoly(ox + dx * t, oz + dz * t, pr.poly)) { best = t; n = [0, dy < 0 ? 1 : -1, 0]; }
  }
  return n ? { t: best, normal: n } : null;
}

const R = 0.34;
const STEP = 0.5;

// Character controller: pos is feet position {x,y,z}, h is height.
export class Mover {
  constructor(world) { this.world = world; this.list = []; }
  hits(b, x, y, z, h) {
    if (!(x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2] && y + h > b.min[1] + 1e-4 && y < b.max[1] - 1e-4)) return false;
    if (!b.isPrism) return true;
    if (pointInPoly(x, z, b.poly)) return true;
    return closestOnPrism(x, z, b).d < R - 1e-4;
  }
  overlapsAt(x, y, z, h) {
    const L = this.world.query(x - R, z - R, x + R, z + R, this.list);
    for (const b of L) if (b.walk && this.hits(b, x, y, z, h)) return b;
    return null;
  }
  collect(x, y, z, h) {
    const L = this.world.query(x - R, z - R, x + R, z + R, this.list);
    const out = [];
    for (const b of L) if (b.walk && this.hits(b, x, y, z, h)) out.push(b);
    return out;
  }
  // circle-vs-polygon push out for prisms (after the axis moves of a substep)
  prisms(st, h, canStep) {
    const p = st.pos;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const L = this.world.query(p.x - R, p.z - R, p.x + R, p.z + R, []);
      for (const b of L) {
        if (!b.isPrism || !b.walk || !this.hits(b, p.x, p.y, p.z, h)) continue;
        if (b.max[1] - p.y <= STEP && (canStep || st.onGround)) {
          // climb, allowing a short chain of steps (stairs) as long as each rise is small
          let y = b.max[1], ok = true;
          for (let k = 0; k < 3; k++) {
            const o = this.overlapsAt(p.x, y, p.z, h);
            if (!o) break;
            if (o.max[1] - y <= STEP) y = o.max[1]; else { ok = false; break; }
          }
          if (ok && !this.overlapsAt(p.x, y, p.z, h)) { p.y = y; moved = true; continue; }
        }
        const inside = pointInPoly(p.x, p.z, b.poly);
        const c = closestOnPrism(p.x, p.z, b);
        let nx, nz, push;
        if (inside) { nx = c.nx; nz = c.nz; push = c.d + R + 1e-3; p.x = c.cx + nx * (R + 1e-3); p.z = c.cz + nz * (R + 1e-3); }
        else { nx = (p.x - c.cx) / (c.d || 1); nz = (p.z - c.cz) / (c.d || 1); push = R - c.d + 1e-3; p.x += nx * push; p.z += nz * push; }
        const vn = st.vel.x * nx + st.vel.z * nz;
        if (vn < 0) { st.vel.x -= vn * nx; st.vel.z -= vn * nz; }
        moved = true;
      }
      if (!moved) break;
    }
  }
  // moves state {pos, vel, onGround} by vel*dt with sliding & stepping.
  move(st, dt, h) {
    const p = st.pos;
    const total = Math.max(Math.abs(st.vel.x), Math.abs(st.vel.z), Math.abs(st.vel.y)) * dt;
    const steps = Math.max(1, Math.ceil(total / 0.25));
    const sdt = dt / steps;
    const wasGround = st.onGround;
    st.onGround = false;
    for (let s = 0; s < steps; s++) {
      this.axis(st, 0, st.vel.x * sdt, h, wasGround);
      this.axis(st, 2, st.vel.z * sdt, h, wasGround);
      this.prisms(st, h, wasGround);
      // vertical
      p.y += st.vel.y * sdt;
      const hits = this.collect(p.x, p.y, p.z, h);
      // Only land on a box we actually fell onto this substep, and only bump our head on a box
      // we rose into. Overlaps from the side are left to the horizontal push-out: snapping to the
      // top there let players climb trees / walls by spamming jump.
      const fall = Math.max(0, -st.vel.y * sdt) + 0.06;
      for (const b of hits) {
        if (st.vel.y <= 0 && p.y < b.max[1] && p.y > b.max[1] - fall) { p.y = b.max[1]; st.vel.y = 0; st.onGround = true; }
        else if (st.vel.y > 0 && p.y + h - b.min[1] < st.vel.y * sdt + 0.06) { p.y = b.min[1] - h; st.vel.y = 0; }
      }
      if (p.y <= 0) { p.y = 0; if (st.vel.y < 0) st.vel.y = 0; st.onGround = true; }
    }
    // step-down snapping (stairs)
    if (!st.onGround && wasGround && st.vel.y <= 0 && p.y > 0) {
      const top = this.groundBelow(p.x, p.y, p.z, STEP + 0.05);
      if (top !== null) { p.y = top; st.vel.y = 0; st.onGround = true; }
    }
  }
  groundBelow(x, y, z, maxDrop) {
    if (y - maxDrop <= 0) return 0 <= y ? (y <= maxDrop ? 0 : null) : null;
    const L = this.world.query(x - R, z - R, x + R, z + R, this.list);
    let best = null;
    for (const b of L) {
      if (!b.walk) continue;
      if (x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2] && (!b.isPrism || pointInPoly(x, z, b.poly) || closestOnPrism(x, z, b).d < R)) {
        const top = b.max[1];
        if (top <= y + 1e-3 && top >= y - maxDrop && (best === null || top > best)) best = top;
      }
    }
    return best;
  }
  axis(st, a, delta, h, canStep) {
    if (delta === 0) return;
    const p = st.pos;
    const key = a === 0 ? 'x' : 'z';
    p[key] += delta;
    const hits = this.collect(p.x, p.y, p.z, h);
    for (const b of hits) {
      if (b.isPrism) continue;
      const rise = b.max[1] - p.y;
      if (rise <= STEP && (canStep || st.onGround) && !this.overlapsAt(p.x, b.max[1], p.z, h)) {
        p.y = b.max[1];
        continue;
      }
      if (delta > 0) p[key] = b.min[a] - R - 1e-4;
      else p[key] = b.max[a] + R + 1e-4;
      st.vel[key] = 0;
    }
  }
}
export const PLAYER_RADIUS = R;
