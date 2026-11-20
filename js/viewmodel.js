import * as THREE from 'three';
import { buildAwmMesh } from './avatar.js';
import { damp, clamp } from './util.js';
import * as TX from './textures.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5b5040, 1.6));
    const d = new THREE.DirectionalLight(0xfff1dc, 2.2);
    d.position.set(0.6, 1, 0.4);
    this.scene.add(d);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    // ---- fists ----
    this.sleeveMat = new THREE.MeshLambertMaterial({ color: 0x1e88e5 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xf1c27d });
    this.fists = new THREE.Group();
    this.root.add(this.fists);
    this.fistArms = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.42), this.sleeveMat);
      sleeve.position.z = 0.2;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.13), skin);
      hand.position.z = -0.06;
      g.add(sleeve, hand);
      g.userData.base = new THREE.Vector3(side * 0.2, -0.24, -0.5);
      g.scale.setScalar(0.8);
      g.position.copy(g.userData.base);
      g.rotation.y = -side * 0.12;
      g.rotation.x = 0.12;
      this.fists.add(g);
      this.fistArms.push(g);
    }

    // ---- AWM ----
    this.awm = new THREE.Group();
    this.root.add(this.awm);
    this.gun = buildAwmMesh(1);
    this.gun.scale.setScalar(0.45);
    this.awm.add(this.gun);
    this.gun.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    // bolt handle
    this.bolt = new THREE.Group();
    this.bolt.position.set(0.035, 0.015, 0.08);
    const boltArm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 6), new THREE.MeshLambertMaterial({ color: 0x2a2d2c }));
    boltArm.rotation.z = Math.PI / 2; boltArm.position.x = 0.035;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2d2c }));
    knob.position.x = 0.07;
    this.bolt.add(boltArm, knob);
    this.gun.add(this.bolt);
    // right hand + left hand on gun
    const rh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.32), this.sleeveMat);
    rh.position.set(0.06, -0.09, 0.32); rh.rotation.x = 0.35;
    const rhand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.09), skin);
    rhand.position.set(0.035, -0.05, 0.16);
    const lh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.34), this.sleeveMat);
    lh.position.set(-0.09, -0.11, -0.12); lh.rotation.set(0.25, 0.5, 0);
    const lhand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.09), skin);
    lhand.position.set(-0.02, -0.06, -0.3);
    this.gun.add(rh, rhand, lh, lhand);
    this.mag = this.gun.children[8];
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, -1.22);
    this.gun.add(this.muzzle);

    // muzzle flash sprite
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashStar(), color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.35);
    this.flash.position.set(0, 0.012, -1.28);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 3);
    this.flashLight.position.set(0, 0, -0.9);
    this.gun.add(this.flashLight);

    this.hipPos = new THREE.Vector3(0.14, -0.13, -0.34);
    this.adsPos = new THREE.Vector3(0, -0.038, -0.2);

    this.weapon = 1;
    this.shown = 1; // currently displayed weapon
    this.switchT = 1; // 0..1
    this.punchT = 1; this.punchSide = 0;
    this.recoil = 0; this.boltT = 1; this.reloadT = 1; this.reloadDur = 1;
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.flashT = 1;
    this.ads = 0;
  }
  setColor(c) { this.sleeveMat.color.set(c); }
  setWeapon(w) { if (w !== this.weapon) { this.weapon = w; this.switchT = 0; } }
  punch() { this.punchT = 0; this.punchSide ^= 1; }
  fire() { this.recoil = 1; this.flashT = 0; this.boltT = -0.25; }
  reload(dur) { this.reloadT = 0; this.reloadDur = dur; }
  muzzleWorld(cam, out) {
    // approximate muzzle position in world space from camera
    return out;
  }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  update(dt, s) {
    // s: {speed, onGround, ads, lookDX, lookDY, crouch}
    this.switchT = Math.min(1, this.switchT + dt * 3);
    if (this.switchT > 0.5) this.shown = this.weapon;
    const sw = this.switchT < 0.5 ? easeOut(this.switchT * 2) : 1 - easeOut((this.switchT - 0.5) * 2);
    const lower = this.switchT < 1 ? sw * 0.35 : 0;

    const mv = clamp(s.speed / 6, 0, 1) * (s.onGround ? 1 : 0.2);
    this.bob += dt * (6 + s.speed * 1.1) * (mv > 0.05 ? 1 : 0);
    const bobX = Math.sin(this.bob) * 0.012 * mv;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.012 * mv;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0008, -0.04, 0.04), 8, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0008, -0.04, 0.04), 8, dt);
    this.ads = s.ads;
    this.recoil = damp(this.recoil, 0, 10, dt);

    this.fists.visible = this.shown === 0;
    this.awm.visible = this.shown === 1 && s.ads < 0.92;

    if (this.shown === 0) {
      this.punchT = Math.min(1, this.punchT + dt * 4);
      this.fistArms.forEach((a, i) => {
        const active = i === this.punchSide;
        const t = this.punchT;
        const k = active ? (t < 0.35 ? easeOut(t / 0.35) : 1 - easeOut((t - 0.35) / 0.65)) : 0;
        const b = a.userData.base;
        a.position.set(b.x * (1 - k * 0.8) + bobX + this.swayX, b.y + bobY - lower + k * 0.08 + this.swayY, b.z - k * 0.3);
        a.rotation.x = 0.12 - k * 0.15;
      });
    } else {
      const ads = easeOut(s.ads);
      const p = this.hipPos.clone().lerp(this.adsPos, ads);
      const bm = 1 - ads * 0.85;
      this.awm.position.set(p.x + (bobX + this.swayX) * bm, p.y + (bobY + this.swayY) * bm - lower + this.recoil * 0.02, p.z + this.recoil * 0.09);
      this.awm.rotation.set(this.recoil * 0.12, 0, (1 - ads) * 0.02);
      // bolt cycle: starts after recoil settles
      this.boltT = Math.min(1, this.boltT + dt * 1.0);
      const bt = clamp(this.boltT, 0, 1);
      let lift = 0, back = 0;
      if (this.boltT > 0 && this.boltT < 1) {
        if (bt < 0.25) lift = bt / 0.25;
        else if (bt < 0.5) { lift = 1; back = (bt - 0.25) / 0.25; }
        else if (bt < 0.75) { lift = 1; back = 1 - (bt - 0.5) / 0.25; }
        else lift = 1 - (bt - 0.75) / 0.25;
        this.awm.rotation.z += lift * 0.25 * (1 - ads);
      }
      this.bolt.rotation.z = lift * 1.2;
      this.bolt.position.z = 0.08 + back * 0.09;
      // reload
      this.reloadT = Math.min(1, this.reloadT + dt / this.reloadDur);
      if (this.reloadT < 1) {
        const r = this.reloadT;
        const tilt = Math.sin(Math.min(1, r * 1.2) * Math.PI);
        this.awm.rotation.z += tilt * 0.5;
        this.awm.rotation.x += tilt * 0.15;
        this.awm.position.y -= tilt * 0.05;
        const magOut = r > 0.15 && r < 0.6 ? Math.sin(((r - 0.15) / 0.45) * Math.PI) : 0;
        if (this.mag) this.mag.position.y = -0.08 - magOut * 0.25;
      } else if (this.mag) this.mag.position.y = -0.08;
      this.flashT += dt;
      this.flash.visible = this.flashT < 0.05;
      this.flash.material.rotation = Math.random() * 6;
      this.flashLight.intensity = this.flashT < 0.06 ? 6 : 0;
    }
  }
}
