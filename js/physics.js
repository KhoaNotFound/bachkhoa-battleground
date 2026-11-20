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
        const r = rayBox(ox, oy, oz, dx, dy, dz, b);
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

const R = 0.34;
const STEP = 0.5;

// Character controller: pos is feet position {x,y,z}, h is height.
export class Mover {
  constructor(world) { this.world = world; this.list = []; }
  overlapsAt(x, y, z, h) {
    const L = this.world.query(x - R, z - R, x + R, z + R, this.list);
    for (const b of L) {
      if (!b.walk) continue;
      if (x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2] && y + h > b.min[1] + 1e-4 && y < b.max[1] - 1e-4) return b;
    }
    return null;
  }
  collect(x, y, z, h) {
    const L = this.world.query(x - R, z - R, x + R, z + R, this.list);
    const out = [];
    for (const b of L) {
      if (!b.walk) continue;
      if (x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2] && y + h > b.min[1] + 1e-4 && y < b.max[1] - 1e-4) out.push(b);
    }
    return out;
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
      // vertical
      p.y += st.vel.y * sdt;
      const hits = this.collect(p.x, p.y, p.z, h);
      for (const b of hits) {
        if (st.vel.y <= 0 && p.y < b.max[1] && p.y > b.max[1] - 1.2) { p.y = b.max[1]; st.vel.y = 0; st.onGround = true; }
        else if (st.vel.y > 0) { p.y = b.min[1] - h; st.vel.y = 0; }
        else { p.y = b.max[1]; st.vel.y = 0; st.onGround = true; }
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
      if (x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2]) {
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
