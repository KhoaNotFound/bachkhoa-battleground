import * as THREE from 'three';
import * as TX from './textures.js';

const MAXP = 3000;

class ParticleSystem {
  constructor(scene, additive) {
    this.n = 0;
    this.pos = new Float32Array(MAXP * 3);
    this.col = new Float32Array(MAXP * 4);
    this.size = new Float32Array(MAXP);
    this.vel = new Float32Array(MAXP * 3);
    this.life = new Float32Array(MAXP);
    this.maxLife = new Float32Array(MAXP);
    this.grav = new Float32Array(MAXP);
    this.drag = new Float32Array(MAXP);
    this.grow = new Float32Array(MAXP);
    this.baseA = new Float32Array(MAXP);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('size', this.aSize);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TX.softDot() }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.mat = mat;
    g.setDrawRange(0, 0);
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav = 0, drag = 0, grow = 0) {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.baseA[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j];
          this.baseA[i] = this.baseA[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.baseA[i] * Math.min(1, t * 2);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticleSystem(scene, true);
    this.norm = new ParticleSystem(scene, false);
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerGeo.translate(0, 0, 0.5);
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    this.decalMat = new THREE.MeshBasicMaterial({ map: TX.bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.flashes = [];
    this.flashTex = TX.flashStar();
    this.light = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(this.light);
    this.lightT = 1;
    this.rings = [];
  }
  setScale(h) { this.add.mat.uniforms.scale.value = h * 0.9; this.norm.mat.uniforms.scale.value = h * 0.9; }
  tracer(a, b, color = 0xffe7a8, width = 0.025) {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.position.copy(a);
    m.lookAt(b);
    m.scale.set(width, width, len);
    m.renderOrder = 4;
    this.scene.add(m);
    // glow sheath
    const mat2 = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const m2 = new THREE.Mesh(this.tracerGeo, mat2);
    m2.position.copy(a); m2.lookAt(b); m2.scale.set(width * 3.5, width * 3.5, len);
    this.scene.add(m2);
    this.tracers.push({ m, m2, t: 0, life: 0.28 });
    // smoke trail along the shot
    const n = Math.min(60, Math.floor(len / 3));
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      this.norm.emit(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k, (Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.7, 0.18, 0.85, 0.85, 0.85, 0.16, 0, 0.5, 0.35);
    }
  }
  muzzle(p, dir) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(p);
    s.scale.setScalar(1.1);
    s.material.rotation = Math.random() * 6;
    this.scene.add(s);
    this.flashes.push({ s, t: 0 });
    this.light.position.copy(p);
    this.light.intensity = 30;
    this.lightT = 0;
    for (let i = 0; i < 10; i++) {
      this.norm.emit(p.x, p.y, p.z, dir.x * (2 + Math.random() * 3) + (Math.random() - 0.5), dir.y * 3 + Math.random() * 0.6, dir.z * (2 + Math.random() * 3) + (Math.random() - 0.5), 0.9 + Math.random() * 0.6, 0.25, 0.8, 0.8, 0.8, 0.35, -0.4, 2.2, 0.9);
    }
  }
  impact(p, n, mat) {
    const nx = n[0], ny = n[1], nz = n[2];
    // sparks
    const sparks = mat === 'metal' ? 22 : 12;
    for (let i = 0; i < sparks; i++) {
      const sp = 3 + Math.random() * 7;
      this.add.emit(p.x, p.y, p.z, (nx + (Math.random() - 0.5) * 1.6) * sp, (ny + Math.random() * 0.9) * sp, (nz + (Math.random() - 0.5) * 1.6) * sp, 0.2 + Math.random() * 0.35, 0.05, 1, 0.75, 0.35, 1, 14, 1.5, -0.08);
    }
    // dust
    const dc = mat === 'wood' ? [0.55, 0.42, 0.28] : mat === 'ground' ? [0.45, 0.43, 0.4] : [0.78, 0.76, 0.72];
    for (let i = 0; i < 14; i++) {
      const sp = 0.8 + Math.random() * 2.5;
      this.norm.emit(p.x + nx * 0.05, p.y + ny * 0.05, p.z + nz * 0.05, (nx + (Math.random() - 0.5)) * sp, (ny + Math.random() * 0.6) * sp, (nz + (Math.random() - 0.5)) * sp, 0.7 + Math.random() * 0.8, 0.22, dc[0], dc[1], dc[2], 0.7, 1.2, 2.5, 0.9);
    }
    this.decal(p, n);
  }
  decal(p, n) {
    if (n[1] > 0.9 && p.y < 0.1) {} // ground ok
    const m = new THREE.Mesh(this.decalGeo, this.decalMat);
    m.position.set(p.x + n[0] * 0.012, p.y + n[1] * 0.012, p.z + n[2] * 0.012);
    m.lookAt(m.position.x + n[0], m.position.y + n[1], m.position.z + n[2]);
    m.rotation.z = Math.random() * 6;
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 80) this.decals.shift().removeFromParent();
  }
  blood(p, dir, big) {
    const n = big ? 40 : 20;
    for (let i = 0; i < n; i++) {
      const sp = 1 + Math.random() * (big ? 6 : 4);
      this.norm.emit(p.x, p.y, p.z, (dir.x + (Math.random() - 0.5) * 1.4) * sp, (dir.y + Math.random() * 0.8) * sp, (dir.z + (Math.random() - 0.5) * 1.4) * sp, 0.5 + Math.random() * 0.6, 0.09 + Math.random() * 0.08, 0.6 + Math.random() * 0.2, 0.02, 0.03, 0.95, 9, 1, 0.05);
    }
    for (let i = 0; i < 8; i++) this.norm.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 1.2, Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 0.6, 0.35, 0.55, 0.02, 0.02, 0.5, 0, 2, 1.2);
  }
  punchHit(p) {
    for (let i = 0; i < 12; i++) this.add.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 4, (Math.random() - 0.3) * 4, (Math.random() - 0.5) * 4, 0.25, 0.12, 1, 0.95, 0.7, 0.9, 0, 4, 0.4);
    this.ring(p, 0xffffff);
  }
  ring(p, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(p);
    this.scene.add(m);
    this.rings.push({ m, t: 0 });
  }
  spawnFx(p) {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 0.4;
      this.add.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.3, p.z + Math.sin(a) * r, 0, 2 + Math.random() * 3, 0, 0.8 + Math.random() * 0.5, 0.12, 0.35, 1, 0.65, 0.9, -1, 1, 0);
    }
  }
  deathFx(p) {
    for (let i = 0; i < 40; i++) {
      const sp = 2 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      this.norm.emit(p.x, p.y + 0.9, p.z, Math.cos(a) * sp, Math.random() * 2.5, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 0.14, 0.92, 0.92, 0.92, 0.35, 1, 3.5, 0.5);
    }
  }
  update(dt, camera) {
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const k = 1 - t.t / t.life;
      t.m.material.opacity = 0.95 * k;
      t.m2.material.opacity = 0.35 * k;
      if (t.t >= t.life) { t.m.removeFromParent(); t.m2.removeFromParent(); t.m.material.dispose(); t.m2.material.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      f.s.material.opacity = 1 - f.t / 0.06;
      if (f.t > 0.06) { f.s.removeFromParent(); f.s.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      r.m.scale.setScalar(1 + r.t * 14);
      r.m.material.opacity = 0.9 * (1 - r.t / 0.25);
      if (camera) r.m.quaternion.copy(camera.quaternion);
      if (r.t > 0.25) { r.m.removeFromParent(); r.m.material.dispose(); r.m.geometry.dispose(); this.rings.splice(i, 1); }
    }
    this.lightT += dt;
    this.light.intensity = this.lightT < 0.07 ? 30 * (1 - this.lightT / 0.07) : 0;
  }
}
