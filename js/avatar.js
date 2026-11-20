import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as TX from './textures.js';
import { damp, lerpAngle } from './util.js';
import { rayBox } from './physics.js';
import { buildThirdPersonButterfly } from './butterfly.js';

const SKIN = '#f1c27d';
const boxGeoCache = new Map();
function bgeo(w, h, d) {
  const k = w + ',' + h + ',' + d;
  let g = boxGeoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxGeoCache.set(k, g); }
  return g;
}
const faceTex = TX.faceTexture(SKIN);
const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
const shoeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
const faceMat = new THREE.MeshLambertMaterial({ map: faceTex });
const gunDark = new THREE.MeshLambertMaterial({ color: 0x1e2120 });
const gunGold = new THREE.MeshLambertMaterial({ color: 0xc29e44 });

let cachedAwpTemplate = null;
function loadAwpTemplate() {
  if (!cachedAwpTemplate) {
    cachedAwpTemplate = new Promise((resolve) => {
      new GLTFLoader().load(
        'assets/awp-dragon-lore.glb',
        (gltf) => {
          const tpl = new THREE.Group();
          gltf.scene.traverse((o) => {
            if (o.isMesh && o.name && o.name.startsWith('Awp')) {
              const part = new THREE.Mesh(o.geometry, o.material);
              part.castShadow = true;
              tpl.add(part);
            }
          });
          tpl.scale.setScalar(2.2);
          resolve(tpl);
        },
        undefined,
        () => resolve(null)
      );
    });
  }
  return cachedAwpTemplate;
}

export function buildAwmMesh(scale = 1, loadGlb = true) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  add(bgeo(0.06, 0.07, 0.34), gunDark, 0, 0, 0);
  add(bgeo(0.065, 0.12, 0.36), gunGold, 0, -0.02, 0.33);
  add(bgeo(0.07, 0.075, 0.42), gunGold, 0, -0.005, -0.36);
  add(new THREE.CylinderGeometry(0.012, 0.014, 0.6, 8), gunDark, 0, 0.012, -0.85, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 8), gunDark, 0, 0.012, -1.17, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 10), gunDark, 0, 0.085, -0.02, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.032, 0.026, 0.09, 10), gunDark, 0, 0.085, -0.21, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.027, 0.024, 0.07, 10), gunDark, 0, 0.085, 0.16, Math.PI / 2);
  add(bgeo(0.045, 0.1, 0.1), gunDark, 0, -0.08, -0.04);
  add(bgeo(0.03, 0.04, 0.04), gunDark, 0, 0.05, -0.1);
  add(bgeo(0.03, 0.04, 0.04), gunDark, 0, 0.05, 0.06);
  g.scale.setScalar(scale);

  if (loadGlb) {
    loadAwpTemplate().then((tpl) => {
      if (!tpl) return;
      for (const ch of [...g.children]) g.remove(ch);
      g.add(tpl.clone());
    });
  }
  return g;
}

export class Avatar {
  constructor(name, color) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.color = color;
    const shirt = new THREE.MeshLambertMaterial({ color });
    this.shirtMat = shirt;
    const mesh = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

    // legs: hip pivot -> thigh -> knee pivot -> shin
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.14, 0.82, 0); this.body.add(hip);
      mesh(bgeo(0.26, 0.42, 0.28), pantsMat, hip, 0, -0.21, 0);
      const knee = new THREE.Group(); knee.position.set(0, -0.42, 0); hip.add(knee);
      mesh(bgeo(0.25, 0.32, 0.27), pantsMat, knee, 0, -0.16, 0);
      mesh(bgeo(0.26, 0.09, 0.32), shoeMat, knee, 0, -0.355, -0.02);
      this.legs.push({ hip, knee });
    }
    this.torso = new THREE.Group(); this.torso.position.y = 0.82; this.body.add(this.torso);
    mesh(bgeo(0.56, 0.66, 0.3), shirt, this.torso, 0, 0.33, 0);
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 0.68; this.torso.add(this.headPivot);
    const headMats = [skinMat, skinMat, skinMat, skinMat, skinMat, faceMat];
    this.head = mesh(bgeo(0.4, 0.4, 0.4), headMats, this.headPivot, 0, 0.21, 0);
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(side * 0.39, 0.6, 0); this.torso.add(sh);
      mesh(bgeo(0.22, 0.3, 0.24), shirt, sh, 0, -0.1, 0);
      mesh(bgeo(0.2, 0.36, 0.22), skinMat, sh, 0, -0.43, 0);
      this.arms.push(sh);
    }
    // gun held in front, pitches with aim
    this.aim = new THREE.Group(); this.aim.position.set(0, 0.5, 0); this.torso.add(this.aim);
    this.gun = buildAwmMesh(1);
    this.gun.position.set(0.14, -0.05, -0.32);
    this.aim.add(this.gun);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.012, -1.22); this.gun.add(this.muzzle);

    // 3rd-person butterfly knife held in right hand (arms[1])
    this.knife = buildThirdPersonButterfly();
    this.knife.scale.setScalar(1.35);
    this.knife.position.set(0, -0.58, -0.14);
    this.knife.rotation.set(0, Math.PI / 2, -0.2);
    this.knife.visible = false;
    this.arms[1].add(this.knife);

    // name tag
    this.tagMat = new THREE.SpriteMaterial({ map: TX.nameTag(name, color), depthWrite: false, transparent: true });
    this.tag = new THREE.Sprite(this.tagMat);
    this.tag.scale.set(1.6, 0.4, 1);
    this.tag.position.y = 2.25;
    this.tag.renderOrder = 5;
    this.root.add(this.tag);

    // shield bubble for spawn protection
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0x5cf0a0, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shield.position.y = 0.95; this.shield.scale.y = 1.05;
    this.root.add(this.shield);
    this.shield.visible = false;

    this.walk = 0; this.speed = 0; this.crouch = 0; this.yaw = 0; this.pitch = 0;
    this.weapon = 1; this.punchT = 1; this.punchSide = 0; this.recoil = 0;
    this.name = name;
  }
  setName(name, color) {
    if (name === this.name && color === this.color) return;
    this.name = name; this.color = color;
    this.tagMat.map.dispose();
    this.tagMat.map = TX.nameTag(name, color);
    this.tagMat.needsUpdate = true;
    this.shirtMat.color.set(color);
  }
  punch() { this.punchT = 0; this.punchSide ^= 1; }
  fire() { this.recoil = 1; }
  // pose: {x,y,z,yaw,pitch,speed,crouch,weapon,protected}
  update(dt, pose) {
    this.root.position.set(pose.x, pose.y, pose.z);
    this.yaw = pose.yaw;
    this.root.rotation.y = pose.yaw;
    this.pitch = pose.pitch;
    this.speed = damp(this.speed, pose.speed, 10, dt);
    this.crouch = damp(this.crouch, pose.crouch ? 1 : 0, 12, dt);
    this.weapon = pose.weapon;
    this.shield.visible = !!pose.protected;
    if (this.shield.visible) this.shield.material.opacity = 0.12 + Math.sin(performance.now() * 0.01) * 0.06;

    const cr = this.crouch;
    const mv = Math.min(1, this.speed / 5);
    this.walk += dt * (4 + this.speed * 1.4) * (mv > 0.05 ? 1 : 0);
    const sw = Math.sin(this.walk) * 0.75 * mv * (1 - cr * 0.6);
    // legs
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? sw : -sw;
      const L = this.legs[i];
      L.hip.rotation.x = s + cr * 1.2;
      L.knee.rotation.x = -Math.max(0, -Math.sin(this.walk + (i ? Math.PI : 0))) * 0.9 * mv - cr * 1.9;
    }
    const drop = cr * 0.36;
    this.legs[0].hip.position.y = this.legs[1].hip.position.y = 0.82 - drop;
    this.torso.position.y = 0.82 - drop + Math.abs(Math.sin(this.walk)) * 0.04 * mv;
    this.torso.rotation.x = cr * 0.15;
    this.headPivot.rotation.x = this.pitch * 0.6 - cr * 0.15;
    this.aim.rotation.x = this.pitch - cr * 0.15;
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.punchT = Math.min(1, this.punchT + dt * 3.2);

    const [aL, aR] = this.arms;
    if (this.weapon === 1) {
      this.gun.visible = true;
      this.knife.visible = false;
      const p = this.pitch - cr * 0.15;
      aR.rotation.set(Math.PI / 2 + p - 0.15 + this.recoil * 0.25, 0, 0.15);
      aL.rotation.set(Math.PI / 2 + p + 0.05 + this.recoil * 0.25, 0, -0.55);
      this.gun.position.z = -0.32 + this.recoil * 0.08;
    } else if (this.weapon === 2) {
      this.gun.visible = false;
      this.knife.visible = true;
      const pk = Math.sin(Math.min(1, this.punchT) * Math.PI);
      const guard = 1.05 + this.pitch * 0.55;
      aR.rotation.set(guard + pk * 0.85 + sw * 0.28, -pk * 0.45, 0.2 - pk * 0.55);
      aL.rotation.set(0.45 - sw * 0.45, 0, -0.12);
    } else {
      this.gun.visible = false;
      this.knife.visible = false;
      const pk = Math.sin(Math.min(1, this.punchT) * Math.PI);
      const guard = 1.25 + this.pitch * 0.5;
      aR.rotation.set(guard + (this.punchSide === 0 ? pk * 0.5 : 0) + sw * 0.1, 0, 0.25 - (this.punchSide === 0 ? pk * 0.3 : 0));
      aL.rotation.set(guard + (this.punchSide === 1 ? pk * 0.5 : 0) - sw * 0.1, 0, -0.25 + (this.punchSide === 1 ? pk * 0.3 : 0));
    }
  }
  muzzleWorld(out) { return this.muzzle.getWorldPosition(out); }
  dispose() {
    this.root.removeFromParent();
    this.tagMat.map.dispose();
  }
}

// Hitboxes in avatar-local frame (avatar faces -Z, origin at feet).
export function hitboxes(crouch) {
  const d = crouch ? 0.36 : 0;
  return [
    { part: 'head', min: [-0.24, 1.48 - d, -0.24], max: [0.24, 1.94 - d, 0.24] },
    { part: 'body', min: [-0.52, 0.82 - d, -0.24], max: [0.52, 1.48 - d, 0.24] },
    { part: 'legs', min: [-0.3, 0, -0.2], max: [0.3, 0.82 - d, 0.2] },
  ];
}
// Ray (world) vs player at pos/yaw. Returns {t, part} or null.
export function rayPlayer(o, d, pos, yaw, crouch, maxT) {
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  const lx = o.x - pos.x, ly = o.y - pos.y, lz = o.z - pos.z;
  // rotate by -yaw about Y
  const ox = lx * c + lz * s, oz = -lx * s + lz * c;
  const dx = d.x * c + d.z * s, dz = -d.x * s + d.z * c;
  let best = null;
  for (const hb of hitboxes(crouch)) {
    const r = rayBox(ox, ly, oz, dx, d.y, dz, hb);
    if (r && r.t <= maxT && (!best || r.t < best.t)) best = { t: r.t, part: hb.part };
  }
  return best;
}

// Blocky "oof" break-apart debris on death.
export class Debris {
  constructor(scene) { this.scene = scene; this.items = []; }
  burst(avatar, dir) {
    const parts = [];
    avatar.root.updateMatrixWorld(true);
    avatar.body.traverse((o) => { if (o.isMesh) parts.push(o); });
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    for (const p of parts) {
      p.matrixWorld.decompose(wp, wq, ws);
      const m = new THREE.Mesh(p.geometry, p.material);
      m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws);
      m.castShadow = true;
      this.scene.add(m);
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4);
      if (dir) v.addScaledVector(dir, 5 + Math.random() * 3);
      const av = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      this.items.push({ m, v, av, life: 4 + Math.random(), half: 0.15 });
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      it.v.y -= 18 * dt;
      it.m.position.addScaledVector(it.v, dt);
      if (it.m.position.y < it.half) {
        it.m.position.y = it.half;
        it.v.y = Math.abs(it.v.y) * 0.3;
        it.v.x *= 0.6; it.v.z *= 0.6; it.av.multiplyScalar(0.6);
      }
      it.m.rotation.x += it.av.x * dt; it.m.rotation.y += it.av.y * dt; it.m.rotation.z += it.av.z * dt;
      if (it.life < 0.6) it.m.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (it.life <= 0) { it.m.removeFromParent(); this.items.splice(i, 1); }
    }
  }
}
