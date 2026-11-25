import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildAwmMesh, buildRifleMesh } from './avatar.js';
import { ButterflyController } from './butterfly.js';
import { damp, clamp } from './util.js';
import * as TX from './textures.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const AWP_CLIPS = ['draw', 'idle', 'fire', 'reload', 'inspect'];
const AWP_INSPECT_SOUNDS = [
  { time: 82 / 60,  vol: 0.28, pitch: 0.85 }, // Phase 2: Magazine tap check
  { time: 122 / 60, vol: 0.45, pitch: 1.12 }, // Phase 3: Press-check bolt lift/open (40%)
  { time: 152 / 60, vol: 0.52, pitch: 0.96 }, // Phase 3: Bolt close lock
];

// Lightweight procedural studio environment map so metallic PBR finishes gleam cleanly
function buildViewModelEnv(renderer) {
  if (!renderer) return null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x2c3b52);

    const addPanel = (color, pos, rot, size) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], rot[1], rot[2]);
      envScene.add(m);
    };
    addPanel(0xfff3dd, [0, 5, 0], [Math.PI / 2, 0, 0], [10, 10]);
    addPanel(0x9ed0ff, [-5, 1.5, 0], [0, Math.PI / 2, 0], [8, 6]);
    addPanel(0xffd27a, [5, 2, -2], [0, -Math.PI / 2, 0], [7, 5]);
    addPanel(0xffffff, [0, 2.5, -5], [0, 0, 0], [8, 3]);
    addPanel(0x282420, [0, -4, 0], [-Math.PI / 2, 0, 0], [12, 12]);

    const rt = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    return rt.texture;
  } catch (e) {
    console.warn('VM envMap skipped:', e);
    return null;
  }
}

export class ViewModel {
  constructor(renderer = null, audio = null) {
    this.audio = audio;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x5b5040, 1.5));
    const d = new THREE.DirectionalLight(0xfff1dc, 2.3);
    d.position.set(0.6, 1, 0.4);
    this.scene.add(d);
    const rim = new THREE.DirectionalLight(0xaad4ff, 1.0);
    rim.position.set(-0.8, 0.5, -0.6);
    this.scene.add(rim);

    const env = buildViewModelEnv(renderer);
    if (env) this.scene.environment = env;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    // ---- fists (weapon 0) ----
    this.sleeveMat = new THREE.MeshLambertMaterial({ color: 0x1e88e5 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xf1c27d });
    this.skinMat = skin;
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

    // ---- AWP Dragon Lore (weapon 1) ----
    this.awm = new THREE.Group();
    this.root.add(this.awm);
    this.awmModelRoot = new THREE.Group();
    this.awm.add(this.awmModelRoot);

    this.awmLoaded = false;
    this.awmMixer = null;
    this.awmActions = Object.create(null);
    this.awmActiveAction = null;
    this.awmActiveName = 'idle';
    this.awmPendingClip = 'idle';
    this.awmPendingDur = 0;
    this.awmInspectHeld = false;
    this._awmSoundMask = 0;
    this._awmPrevTime = 0;
    this._awmSleeveMat = null;

    this._createAwmFallback(skin);
    this._loadAwpDragonLoreGLB();

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.006, -0.52);
    this.awm.add(this.muzzle);

    // muzzle flash sprite
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashStar(), color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.16);
    this.flash.position.set(0, 0.006, -0.55);
    this.flash.visible = false;
    this.awm.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 3);
    this.flashLight.position.set(0, 0.02, -0.4);
    this.awm.add(this.flashLight);

    // ---- automatic rifles (weapons 3 UMP45, 4 M416, 5 AKM): procedural models ----
    this.rifles = {};
    this.rifleRoot = new THREE.Group();
    this.root.add(this.rifleRoot);
    for (const k of [3, 4, 5]) {
      const r = buildRifleMesh(k, 1.15);
      r.rotation.y = 0; r.visible = false;
      this.rifleRoot.add(r); this.rifles[k] = r;
    }
    this.rifleKick = 0;
    this.rifleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashStar(), color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.rifleFlash.scale.setScalar(0.13);
    this.rifleFlash.visible = false;
    this.rifleRoot.add(this.rifleFlash);
    this.rifleFlashT = 1;
    this.rifleAdsPos = new THREE.Vector3(0, -0.075, -0.3);

    // ---- Butterfly Knife (weapon 2) ----
    this.butterfly = new ButterflyController(this.sleeveMat, skin, audio);
    this.root.add(this.butterfly.group);

    this.hipPos = new THREE.Vector3(0.115, -0.105, -0.43);
    this.adsPos = new THREE.Vector3(0, -0.038, -0.22);
    this._awmPos = new THREE.Vector3();

    this.weapon = 1;
    this.shown = 1; // currently displayed weapon
    this.switchT = 1; // 0..1
    this.awmDrawTriggered = false;
    this.knifeDrawTriggered = false;
    this.punchT = 1; this.punchSide = 0;
    this.recoil = 0; this.boltT = 1; this.reloadT = 1; this.reloadDur = 1;
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.flashT = 1;
    this.ads = 0;
  }

  _createAwmFallback(skin) {
    this.awmFallback = new THREE.Group();
    this.gun = buildAwmMesh(1, false);
    this.gun.scale.setScalar(0.45);
    this.awmFallback.add(this.gun);
    this.gun.traverse((o) => { if (o.isMesh) o.castShadow = false; });

    this.bolt = new THREE.Group();
    this.bolt.position.set(0.035, 0.015, 0.08);
    const boltArm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 6), new THREE.MeshLambertMaterial({ color: 0x2a2d2c }));
    boltArm.rotation.z = Math.PI / 2; boltArm.position.x = 0.035;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2d2c }));
    knob.position.x = 0.07;
    this.bolt.add(boltArm, knob);
    this.gun.add(this.bolt);

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
    this.awmModelRoot.add(this.awmFallback);
  }

  _tuneAwpMaterial(mat) {
    if (!mat || !mat.isMeshStandardMaterial) return;
    if (mat.name === 'DragonLoreMat') {
      mat.envMapIntensity = 1.35;
      mat.transparent = false;
      mat.opacity = 1.0;
    } else if (mat.name === 'ScopeLensMat') {
      mat.envMapIntensity = 1.6;
      mat.transparent = false;
      mat.opacity = 1.0;
    } else if (mat.name === 'SleeveMat') {
      this._awmSleeveMat = mat;
      mat.envMapIntensity = 0.85;
      mat.color.copy(this.sleeveMat.color);
    } else if (mat.name === 'SkinMat') {
      mat.envMapIntensity = 0.8;
      mat.color.copy(this.skinMat.color);
    }
    mat.needsUpdate = true;
  }

  _loadAwpDragonLoreGLB() {
    const loader = new GLTFLoader();
    loader.load(
      'assets/awp-dragon-lore.glb',
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.frustumCulled = false;
            o.castShadow = false;
            o.receiveShadow = false;
            if (Array.isArray(o.material)) {
              for (let i = 0; i < o.material.length; i++) this._tuneAwpMaterial(o.material[i]);
            } else {
              this._tuneAwpMaterial(o.material);
            }
          }
        });

        if (this.awmFallback) {
          this.awmFallback.removeFromParent();
          this.awmFallback = null;
          this.gun = null;
          this.bolt = null;
          this.mag = null;
        }
        this.awmModelRoot.add(root);

        this.awmMixer = new THREE.AnimationMixer(root);
        for (const name of AWP_CLIPS) {
          const clip = THREE.AnimationClip.findByName(gltf.animations, name);
          if (!clip) {
            console.warn(`awp-dragon-lore.glb missing expected NLA clip: ${name}`);
            continue;
          }
          const action = this.awmMixer.clipAction(clip);
          if (name === 'idle') {
            action.setLoop(THREE.LoopRepeat, Infinity);
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          this.awmActions[name] = action;
        }

        this.awmMixer.addEventListener('finished', (e) => {
          if (e.action === this.awmActiveAction && e.action !== this.awmActions.idle) {
            if (e.action === this.awmActions.inspect) {
              this._playAwmClip(this.awmInspectHeld ? 'inspect' : 'idle', this.awmInspectHeld ? 0.06 : 0.15, true);
            } else {
              this._playAwmClip('idle', 0.10, true);
            }
          }
        });

        this.awmLoaded = true;
        const startClip = this.awmPendingClip && this.awmActions[this.awmPendingClip] ? this.awmPendingClip : 'idle';
        this._playAwmClip(startClip, 0, true, this.awmPendingDur);
      },
      undefined,
      (err) => {
        console.warn('Could not load assets/awp-dragon-lore.glb, keeping fallback AWM:', err);
      }
    );
  }

  _updateAwmSoundEvents() {
    if (this.awmActiveName !== 'inspect' || !this.awmActiveAction) return;
    const t = this.awmActiveAction.time;
    if (t + 0.15 < this._awmPrevTime) this._awmSoundMask = 0;
    for (let i = 0; i < AWP_INSPECT_SOUNDS.length; i++) {
      const bit = 1 << i;
      if ((this._awmSoundMask & bit) === 0 && t >= AWP_INSPECT_SOUNDS[i].time) {
        this._awmSoundMask |= bit;
        const ev = AWP_INSPECT_SOUNDS[i];
        if (this.audio && this.audio.bolt) this.audio.bolt(0, ev.vol, ev.pitch, true);
      }
    }
    this._awmPrevTime = t;
  }

  _playAwmClip(name, fadeSec = 0.08, forceRestart = true, targetDur = 0) {
    if (!this.awmMixer || !this.awmActions[name]) {
      this.awmPendingClip = name;
      this.awmPendingDur = targetDur;
      this.awmActiveName = name;
      return;
    }

    const next = this.awmActions[name];
    const prev = this.awmActiveAction;
    if (prev === next && !forceRestart) return;

    this._awmSoundMask = 0;
    this._awmPrevTime = 0;

    const clipDur = next.getClip().duration || 1;
    const ts = targetDur > 0.1 ? clipDur / targetDur : 1;

    next.enabled = true;
    next.reset();
    next.setEffectiveTimeScale(ts);
    next.setEffectiveWeight(1);

    if (prev && prev !== next && fadeSec > 0) {
      prev.enabled = true;
      next.play();
      prev.crossFadeTo(next, fadeSec, false);
    } else {
      for (const k in this.awmActions) {
        if (this.awmActions[k] !== next) this.awmActions[k].stop();
      }
      next.play();
    }

    this.awmActiveAction = next;
    this.awmActiveName = name;
  }

  setColor(c) {
    this.sleeveMat.color.set(c);
    if (this._awmSleeveMat) this._awmSleeveMat.color.set(c);
  }

  setWeapon(w) {
    if (w !== this.weapon) {
      this.weapon = w;
      this.switchT = 0;
      this.awmDrawTriggered = false;
      this.knifeDrawTriggered = false;
      this.awmInspectHeld = false;
      if (w !== 2) this.butterfly.setInspect(false);
      if (w !== 1 && (this.awmActiveName === 'reload' || this.awmActiveName === 'inspect')) {
        this._playAwmClip('idle', 0.05, true);
      }
    }
  }

  punch() { this.punchT = 0; this.punchSide ^= 1; }
  knifeSlash(heavy = false) { this.butterfly.slash(heavy); }
  setInspect(held) {
    const want = !!held;
    this.awmInspectHeld = want;
    if (this.weapon === 2) {
      this.butterfly.setInspect(want);
    } else if (this.weapon === 1 && want) {
      const busy =
        this.awmActiveName === 'fire' ||
        this.awmActiveName === 'reload' ||
        this.awmActiveName === 'draw' ||
        this.ads > 0.05;
      if (!busy && (this.awmActiveName === 'idle' || this.awmActiveName === 'inspect')) {
        this._playAwmClip('inspect', 0.12, false);
      }
    }
  }
  fire(w = 1) {
    if (w >= 3) { this.rifleKick = Math.min(1.5, this.rifleKick + 0.7); this.rifleFlashT = 0; return; }
    this.recoil = 1;
    this.flashT = 0;
    this.boltT = -0.25;
    this.awmInspectHeld = false;
    this._playAwmClip('fire', 0.04, true);
  }
  reload(dur) {
    this.reloadT = 0;
    this.reloadDur = dur;
    this.awmInspectHeld = false;
    if (dur > 0.1) {
      this._playAwmClip('reload', 0.08, true, dur);
    } else if (this.awmActiveName === 'reload') {
      this._playAwmClip('idle', 0.05, true);
    }
  }
  muzzleWorld(cam, out) { return out; }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  update(dt, s) {
    // s: {speed, onGround, ads, lookDX, lookDY, crouchV, sprint, yaw, pitch, vel, landImpulse, jumpImpulse}
    this.switchT = Math.min(1, this.switchT + dt * 3.2);
    if (this.switchT > 0.45) {
      const prevShown = this.shown;
      this.shown = this.weapon;
      if (this.shown === 2 && (!this.knifeDrawTriggered || prevShown !== 2)) {
        this.knifeDrawTriggered = true;
        this.butterfly.draw();
      }
      if (this.shown === 1 && (!this.awmDrawTriggered || prevShown !== 1)) {
        this.awmDrawTriggered = true;
        this._playAwmClip('draw', 0.06, true);
      }
    }
    const sw = this.switchT < 0.45 ? easeOut(this.switchT / 0.45) : 1 - easeOut((this.switchT - 0.45) / 0.55);
    const lower = this.switchT < 1 ? sw * 0.35 : 0;

    const mv = clamp(s.speed / 6, 0, 1) * (s.onGround ? 1 : 0.2);
    this.bob += dt * (6 + s.speed * 1.1) * (mv > 0.05 ? 1 : 0);
    const bobX = Math.sin(this.bob) * 0.012 * mv;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.012 * mv;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0008, -0.04, 0.04), 8, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0008, -0.04, 0.04), 8, dt);
    this.ads = s.ads;
    this.recoil = damp(this.recoil, 0, 10, dt);

    if (this._awmSleeveMat) this._awmSleeveMat.color.copy(this.sleeveMat.color);

    this.fists.visible = this.shown === 0;
    this.awm.visible = this.shown === 1 && s.ads < 0.92;
    this.rifleRoot.visible = this.shown >= 3;
    for (const k in this.rifles) this.rifles[k].visible = +k === this.shown;
    this.butterfly.group.visible = this.shown === 2;

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
    } else if (this.shown === 1) {
      const ads = easeOut(s.ads);
      this._awmPos.lerpVectors(this.hipPos, this.adsPos, ads);
      const bm = 1 - ads * 0.85;
      const recoilZ = this.awmLoaded ? this.recoil * 0.04 : this.recoil * 0.09;
      const recoilY = this.awmLoaded ? this.recoil * 0.01 : this.recoil * 0.02;
      const recoilRx = this.awmLoaded ? this.recoil * 0.05 : this.recoil * 0.12;
      this.awm.position.set(
        this._awmPos.x + (bobX + this.swayX) * bm,
        this._awmPos.y + (bobY + this.swayY) * bm - lower + recoilY,
        this._awmPos.z + recoilZ
      );
      this.awm.rotation.set(recoilRx, (1 - ads) * 0.03, (1 - ads) * 0.02);

      if (s.ads > 0.05 && this.awmActiveName === 'inspect') {
        this.awmInspectHeld = false;
        this._playAwmClip('idle', 0.08, true);
      }
      if (this.awmLoaded && this.awmMixer) {
        this.awmMixer.update(Math.min(dt, 0.05));
        this._updateAwmSoundEvents();
      } else if (this.awmFallback) {
        // Fallback procedural bolt cycle & reload until Dragon Lore GLB finishes loading
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
        if (this.bolt) {
          this.bolt.rotation.z = lift * 1.2;
          this.bolt.position.z = 0.08 + back * 0.09;
        }
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
      }

      this.flashT += dt;
      this.flash.visible = this.flashT < 0.05;
      this.flash.material.rotation = Math.random() * 6;
      this.flashLight.intensity = this.flashT < 0.06 ? 6 : 0;
    } else if (this.shown >= 3) {
      const ads = easeOut(s.ads);
      this._awmPos.lerpVectors(this.hipPos, this.rifleAdsPos, ads);
      const bm = 1 - ads * 0.85;
      this.rifleKick = damp(this.rifleKick, 0, 14, dt);
      const kz = this.rifleKick * 0.03, kr = this.rifleKick * 0.06;
      this.rifleRoot.position.set(
        this._awmPos.x + (bobX + this.swayX) * bm,
        this._awmPos.y + (bobY + this.swayY) * bm - lower + this.rifleKick * 0.008,
        this._awmPos.z + kz
      );
      this.rifleRoot.rotation.set(kr, (1 - ads) * 0.03, (1 - ads) * 0.02);
      const mz = this.rifles[this.shown].userData.muzzleZ * 1.15;
      this.rifleFlash.position.set(0, 0.012, mz - 0.03);
      this.rifleFlashT += dt;
      this.rifleFlash.visible = this.rifleFlashT < 0.04;
      this.rifleFlash.material.rotation = Math.random() * 6;
    } else if (this.shown === 2) {
      const hideDrop = this.weapon !== 2 && this.switchT < 0.45 ? easeOut(this.switchT / 0.45) * 0.3 : 0;
      this.butterfly.group.position.y = -hideDrop;
      this.butterfly.update(dt, s);
    }
  }
}
