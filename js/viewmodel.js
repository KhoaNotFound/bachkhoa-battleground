import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildAwmMesh } from './avatar.js';
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

    // ---- Butterfly Knife (weapon 2) ----
    this.butterfly = new ButterflyController(this.sleeveMat, skin, audio);
    this.root.add(this.butterfly.group);

    // ---- Procedural Custom Gun ViewModel (for bought sidearms/SMGs/rifles/shotguns/LMGs/snipers) ----
    this.customGun = new THREE.Group();
    this.customGun.visible = false;
    this.root.add(this.customGun);
    this.customGunCache = new Map();
    this.activeCustomMesh = null;
    this.gunDef = null;
    this.skinDef = null;
    this.useAwpGlb = true;
    this.useVandalGlb = false;

    // ---- Vandal GLB ViewModel (supports switching skins dynamically) ----
    this.vandal = new THREE.Group();
    this.vandal.visible = false;
    this.root.add(this.vandal);
    this.vandalModelRoot = new THREE.Group();
    this.vandal.add(this.vandalModelRoot);
    this.vandalCache = new Map();
    this.vandalActive = null;
    this.vandalUrl = null;
    this.vandalInspectHeld = false;
    this.vandalDrawTriggered = false;
    this.vandalFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashStar(), color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.vandalFlash.scale.setScalar(0.14);
    this.vandalFlash.position.set(0, 0.015, -0.53);
    this.vandalFlash.visible = false;
    this.vandal.add(this.vandalFlash);
    this.vandalFlashLight = new THREE.PointLight(0xffc070, 0, 3);
    this.vandalFlashLight.position.set(0, 0.02, -0.42);
    this.vandal.add(this.vandalFlashLight);
    this.vandalHipPos = new THREE.Vector3(0.115, -0.112, -0.40);
    this.vandalAdsPos = new THREE.Vector3(0, -0.052, -0.25);
    this._vandalPos = new THREE.Vector3();
    this._vandalCatchPlayed = false;
    this.customInspectT = -1;
    this.customInspectHeld = false;
    this._customCatchPlayed = false;

    this.customFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.flashStar(), color: 0xffe0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.customFlash.scale.setScalar(0.14);
    this.customFlash.visible = false;
    this.customGun.add(this.customFlash);
    this.customFlashLight = new THREE.PointLight(0xffc070, 0, 3);
    this.customFlashLight.position.set(0, 0.03, -0.35);
    this.customGun.add(this.customFlashLight);

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
    for (const entry of this.vandalCache.values()) {
      for (const sm of entry.sleeveMats) sm.color.set(c);
    }
  }

  _tuneVandalMaterial(mat, entry) {
    if (!mat || !mat.isMeshStandardMaterial) return;
    if (mat.name === 'SleeveMat') {
      entry.sleeveMats.push(mat);
      mat.envMapIntensity = 0.85;
      mat.color.copy(this.sleeveMat.color);
    } else if (mat.name === 'SkinMat') {
      mat.envMapIntensity = 0.8;
      mat.color.copy(this.skinMat.color);
    } else {
      mat.envMapIntensity = Math.max(mat.envMapIntensity || 1.0, 1.25);
    }
    mat.needsUpdate = true;
  }

  _loadOrActivateVandalGLB(url) {
    const targetUrl = url || 'assets/skins/vandal/vandal-default.glb';
    this.vandalUrl = targetUrl;

    for (const [k, ent] of this.vandalCache.entries()) {
      if (ent.root) ent.root.visible = (k === targetUrl);
    }

    let entry = this.vandalCache.get(targetUrl);
    if (entry) {
      this.vandalActive = entry;
      if (entry.loaded) {
        this._playVandalClip(entry.pendingClip || 'idle', 0.05, false, entry.pendingDur || 0);
      }
      return;
    }

    entry = {
      url: targetUrl,
      root: null,
      mixer: null,
      actions: Object.create(null),
      sleeveMats: [],
      activeAction: null,
      activeName: 'idle',
      pendingClip: 'draw',
      pendingDur: 0,
      loaded: false,
    };
    this.vandalCache.set(targetUrl, entry);
    this.vandalActive = entry;

    const loader = new GLTFLoader();
    loader.load(
      targetUrl,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            o.frustumCulled = false;
            o.castShadow = false;
            o.receiveShadow = false;
            if (Array.isArray(o.material)) {
              for (let i = 0; i < o.material.length; i++) this._tuneVandalMaterial(o.material[i], entry);
            } else {
              this._tuneVandalMaterial(o.material, entry);
            }
          }
        });

        root.visible = (this.vandalUrl === targetUrl);
        this.vandalModelRoot.add(root);
        entry.root = root;
        entry.mixer = new THREE.AnimationMixer(root);

        for (const name of AWP_CLIPS) {
          const clip = THREE.AnimationClip.findByName(gltf.animations, name);
          if (!clip) continue;
          const action = entry.mixer.clipAction(clip);
          if (name === 'idle') {
            action.setLoop(THREE.LoopRepeat, Infinity);
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          entry.actions[name] = action;
        }

        entry.mixer.addEventListener('finished', (e) => {
          if (e.action === entry.activeAction && e.action !== entry.actions.idle) {
            if (e.action === entry.actions.inspect) {
              this._playVandalClip(this.vandalInspectHeld ? 'inspect' : 'idle', this.vandalInspectHeld ? 0.06 : 0.15, true, 0, entry);
            } else {
              this._playVandalClip('idle', 0.08, true, 0, entry);
            }
          }
        });

        entry.loaded = true;
        const startClip = entry.pendingClip && entry.actions[entry.pendingClip] ? entry.pendingClip : 'idle';
        this._playVandalClip(startClip, 0, true, entry.pendingDur, entry);
      },
      undefined,
      (err) => {
        console.warn(`Could not load Vandal GLB (${targetUrl}):`, err);
      }
    );
  }

  _playVandalClip(name, fadeSec = 0.06, forceRestart = true, targetDur = 0, targetEntry = null) {
    const entry = targetEntry || this.vandalActive;
    if (!entry) return;
    if (!entry.mixer || !entry.actions[name]) {
      entry.pendingClip = name;
      entry.pendingDur = targetDur;
      entry.activeName = name;
      return;
    }

    const next = entry.actions[name];
    const prev = entry.activeAction;
    if (prev === next && !forceRestart) return;

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
      for (const k in entry.actions) {
        if (entry.actions[k] !== next) entry.actions[k].stop();
      }
      next.play();
    }

    entry.activeAction = next;
    entry.activeName = name;
  }

  _buildCustomGun(w, includeHands = true) {
    const g = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const handsGroup = new THREE.Group();
    g.add(bodyGroup, handsGroup);
    const bodyMat = new THREE.MeshStandardMaterial({ color: w.color || 0x2f353d, roughness: 0.45, metalness: 0.45 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.55, metalness: 0.5 });
    const accentMat = new THREE.MeshStandardMaterial({ color: w.accent || 0x2ce5b5, roughness: 0.35, metalness: 0.55 });
    const addBox = (sx, sy, sz, x, y, z, mat = bodyMat, rx = 0, ry = 0, rz = 0) => {
      const isHand = (mat === this.sleeveMat || mat === this.skinMat);
      if (isHand && !includeHands) return null;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      (isHand ? handsGroup : bodyGroup).add(m);
      return m;
    };
    const addCyl = (r, len, x, y, z, mat = darkMat, rx = Math.PI / 2) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      bodyGroup.add(m);
      return m;
    };

    const t = w.modelType || 'rifle';
    let muzzleZ = -0.45;
    let magMesh = null;

    if (t === 'pistol' || t === 'ghost' || t === 'frenzy' || t === 'revolver' || t === 'shorty') {
      // Compact sidearm geometry
      if (t === 'revolver') {
        addBox(0.036, 0.052, 0.16, 0, 0.01, -0.02, bodyMat);
        addCyl(0.026, 0.068, 0, 0.012, -0.03, accentMat);
        addBox(0.024, 0.036, 0.22, 0, 0.022, -0.18, bodyMat);
        addBox(0.032, 0.11, 0.048, 0, -0.06, 0.055, darkMat, 0.28);
        muzzleZ = -0.32;
      } else if (t === 'shorty') {
        addBox(0.052, 0.044, 0.15, 0, 0.0, -0.02, accentMat);
        addCyl(0.014, 0.26, -0.014, 0.014, -0.16, darkMat);
        addCyl(0.014, 0.26, 0.014, 0.014, -0.16, darkMat);
        addBox(0.042, 0.068, 0.13, 0, -0.042, 0.09, accentMat, 0.36);
        muzzleZ = -0.31;
      } else {
        addBox(0.036, 0.044, 0.22, 0, 0.015, -0.05, bodyMat);
        addBox(0.032, 0.014, 0.21, 0, 0.038, -0.05, accentMat);
        addBox(0.03, 0.11, 0.046, 0, -0.055, 0.035, darkMat, 0.22);
        if (t === 'frenzy') {
          magMesh = addBox(0.024, 0.13, 0.036, 0, -0.09, -0.09, accentMat, -0.12);
          addBox(0.022, 0.02, 0.08, 0, 0.016, -0.19, darkMat);
          muzzleZ = -0.26;
        } else if (t === 'ghost') {
          addCyl(0.015, 0.20, 0, 0.016, -0.25, darkMat);
          magMesh = addBox(0.022, 0.10, 0.036, 0, -0.06, 0.035, accentMat, 0.22);
          muzzleZ = -0.37;
        } else {
          magMesh = addBox(0.022, 0.095, 0.036, 0, -0.06, 0.035, accentMat, 0.22);
          muzzleZ = -0.20;
        }
      }
      // Two-hand blocky pistol stance
      addBox(0.075, 0.075, 0.28, 0.045, -0.11, 0.22, this.sleeveMat, 0.28, -0.18);
      addBox(0.068, 0.068, 0.085, 0.015, -0.06, 0.05, this.skinMat);
      addBox(0.075, 0.075, 0.28, -0.065, -0.12, 0.20, this.sleeveMat, 0.26, 0.28);
      addBox(0.068, 0.068, 0.085, -0.02, -0.065, 0.025, this.skinMat);
    } else if (t === 'smg' || t === 'smgSilenced') {
      addBox(0.052, 0.068, 0.34, 0, 0.01, -0.06, bodyMat);
      addBox(0.044, 0.016, 0.26, 0, 0.05, -0.06, accentMat);
      addBox(0.036, 0.095, 0.046, 0, -0.06, 0.05, darkMat, 0.22);
      magMesh = addBox(0.028, 0.17, 0.036, 0, -0.10, -0.08, darkMat, -0.15);
      addBox(0.04, 0.058, 0.14, 0, 0.0, 0.15, darkMat);
      if (t === 'smgSilenced') {
        addCyl(0.02, 0.22, 0, 0.016, -0.33, darkMat);
        muzzleZ = -0.46;
      } else {
        addCyl(0.012, 0.14, 0, 0.016, -0.28, darkMat);
        muzzleZ = -0.37;
      }
      addBox(0.082, 0.082, 0.30, 0.055, -0.10, 0.24, this.sleeveMat, 0.3, -0.12);
      addBox(0.072, 0.072, 0.085, 0.02, -0.055, 0.06, this.skinMat);
      addBox(0.082, 0.082, 0.32, -0.085, -0.11, -0.02, this.sleeveMat, 0.22, 0.45);
      addBox(0.072, 0.072, 0.085, -0.025, -0.055, -0.16, this.skinMat);
    } else if (t === 'shotgun' || t === 'judge') {
      addBox(0.058, 0.066, 0.40, 0, 0.01, -0.04, bodyMat);
      addCyl(0.018, 0.42, 0, 0.026, -0.30, darkMat);
      addBox(0.054, 0.042, 0.22, 0, -0.012, -0.26, accentMat);
      addBox(0.046, 0.08, 0.20, 0, -0.018, 0.22, bodyMat, 0.12);
      if (t === 'judge') {
        magMesh = addCyl(0.062, 0.078, 0, -0.06, -0.08, accentMat, 0);
        magMesh.rotation.z = Math.PI / 2;
      } else {
        magMesh = addCyl(0.014, 0.36, 0, -0.008, -0.26, darkMat);
      }
      muzzleZ = -0.53;
      addBox(0.084, 0.084, 0.32, 0.06, -0.10, 0.26, this.sleeveMat, 0.32, -0.12);
      addBox(0.074, 0.074, 0.085, 0.022, -0.055, 0.08, this.skinMat);
      addBox(0.084, 0.084, 0.34, -0.085, -0.11, -0.06, this.sleeveMat, 0.22, 0.48);
      addBox(0.074, 0.074, 0.085, -0.02, -0.052, -0.24, this.skinMat);
    } else if (t === 'sniper' || t === 'outlaw') {
      addBox(0.054, 0.068, 0.44, 0, 0.006, -0.04, bodyMat);
      addBox(0.048, 0.082, 0.22, 0, -0.018, 0.24, bodyMat, 0.08);
      if (t === 'outlaw') {
        addCyl(0.013, 0.50, -0.014, 0.022, -0.38, darkMat);
        addCyl(0.013, 0.50, 0.014, 0.022, -0.38, darkMat);
        addBox(0.058, 0.026, 0.24, 0, 0.018, -0.26, accentMat);
      } else {
        addCyl(0.014, 0.54, 0, 0.02, -0.40, darkMat);
      }
      // Scope
      addCyl(0.024, 0.26, 0, 0.076, -0.08, darkMat);
      addCyl(0.028, 0.06, 0, 0.076, -0.20, accentMat);
      addBox(0.016, 0.026, 0.022, 0, 0.048, -0.02, darkMat);
      addBox(0.016, 0.026, 0.022, 0, 0.048, -0.14, darkMat);
      magMesh = addBox(0.036, 0.09, 0.065, 0, -0.06, -0.06, accentMat);
      muzzleZ = -0.68;
      addBox(0.086, 0.086, 0.32, 0.06, -0.10, 0.26, this.sleeveMat, 0.34, -0.1);
      addBox(0.074, 0.074, 0.085, 0.025, -0.055, 0.10, this.skinMat);
      addBox(0.086, 0.086, 0.34, -0.09, -0.11, -0.08, this.sleeveMat, 0.24, 0.48);
      addBox(0.074, 0.074, 0.085, -0.02, -0.055, -0.26, this.skinMat);
    } else if (t === 'lmg' || t === 'odin') {
      const heavy = t === 'odin';
      addBox(heavy ? 0.082 : 0.068, heavy ? 0.092 : 0.078, 0.48, 0, 0.008, -0.08, bodyMat);
      addBox(heavy ? 0.066 : 0.052, 0.022, 0.38, 0, 0.062, -0.10, accentMat);
      addCyl(heavy ? 0.022 : 0.016, 0.36, 0, 0.02, -0.42, darkMat);
      if (heavy) {
        addCyl(0.012, 0.34, 0, -0.006, -0.41, accentMat);
        magMesh = addBox(0.11, 0.14, 0.14, -0.01, -0.10, -0.12, darkMat);
      } else {
        magMesh = addBox(0.082, 0.12, 0.11, 0, -0.09, -0.12, accentMat);
      }
      addBox(0.056, 0.09, 0.20, 0, -0.015, 0.22, darkMat);
      muzzleZ = -0.62;
      addBox(0.09, 0.09, 0.32, 0.065, -0.11, 0.26, this.sleeveMat, 0.32, -0.12);
      addBox(0.076, 0.076, 0.088, 0.025, -0.06, 0.09, this.skinMat);
      addBox(0.09, 0.09, 0.34, -0.10, -0.12, -0.08, this.sleeveMat, 0.22, 0.5);
      addBox(0.076, 0.076, 0.088, -0.03, -0.065, -0.26, this.skinMat);
    } else {
      // Rifles: Vandal, Phantom (silenced), Bulldog (bullpup), Guardian (DMR)
      const isSil = t === 'rifleSilenced';
      const isBullpup = t === 'bullpup';
      const isDmr = t === 'dmr';
      addBox(0.054, 0.068, 0.42, 0, 0.01, -0.06, bodyMat);
      addBox(0.044, 0.018, 0.34, 0, 0.052, -0.07, accentMat);
      addBox(0.044, 0.076, 0.19, 0, -0.012, 0.20, darkMat, 0.08);
      addBox(0.036, 0.095, 0.046, 0, -0.06, 0.06, darkMat, 0.24);
      // Optic rail / holographic sight
      addBox(0.028, 0.034, 0.08, 0, 0.072, -0.03, darkMat);
      addBox(0.022, 0.008, 0.01, 0, 0.076, -0.065, accentMat);
      // Barrel
      if (isSil) {
        addCyl(0.020, 0.28, 0, 0.016, -0.40, darkMat);
        muzzleZ = -0.56;
      } else if (isDmr) {
        addCyl(0.014, 0.44, 0, 0.018, -0.44, darkMat);
        muzzleZ = -0.67;
      } else {
        addCyl(0.014, 0.28, 0, 0.018, -0.39, darkMat);
        muzzleZ = -0.55;
      }
      // Magazine
      magMesh = addBox(0.032, isDmr ? 0.11 : 0.16, 0.052, 0, -0.095, isBullpup ? 0.14 : -0.10, accentMat, isBullpup ? 0.1 : -0.22);
      // Blocky hands
      if (includeHands) {
        addBox(0.084, 0.084, 0.32, 0.058, -0.10, 0.24, this.sleeveMat, 0.32, -0.12);
        addBox(0.074, 0.074, 0.085, 0.022, -0.055, 0.07, this.skinMat);
        addBox(0.084, 0.084, 0.34, -0.085, -0.11, -0.05, this.sleeveMat, 0.22, 0.48);
        addBox(0.074, 0.074, 0.085, -0.02, -0.052, -0.22, this.skinMat);
      }
    }

    g.userData.muzzleZ = muzzleZ;
    g.userData.mag = magMesh;
    g.userData.magBaseY = magMesh ? magMesh.position.y : 0;
    g.userData.bodyGroup = bodyGroup;
    g.userData.handsGroup = handsGroup;
    return g;
  }

  setGunDef(wDef, skinDef = null) {
    if (!wDef) return;
    const prevId = this.gunDef ? this.gunDef.id : null;
    const prevSkinId = this.skinDef ? this.skinDef.id : null;
    this.gunDef = wDef;
    this.skinDef = skinDef;

    const glbUrl = skinDef?.glb || null;
    this.useAwpGlb = glbUrl === 'assets/awp-dragon-lore.glb';
    this.useVandalGlb = !!(glbUrl && !this.useAwpGlb);

    if (this.useVandalGlb) {
      const isPistol = wDef.slot === 'secondary';
      const isSniper = wDef.id === 'operator';
      if (isPistol) {
        this.vandalHipPos.set(0.11, -0.105, -0.32);
        this.vandalAdsPos.set(0, -0.056, -0.22);
        this.vandalFlash.position.set(0, 0.02, -0.34);
      } else if (isSniper) {
        this.vandalHipPos.set(0.115, -0.105, -0.43);
        this.vandalAdsPos.set(0, -0.042, -0.22);
        this.vandalFlash.position.set(0, 0.015, -0.55);
      } else {
        this.vandalHipPos.set(0.115, -0.112, -0.40);
        this.vandalAdsPos.set(0, -0.052, -0.25);
        this.vandalFlash.position.set(0, 0.015, -0.53);
      }
      this._loadOrActivateVandalGLB(glbUrl);
    } else if (!this.useAwpGlb) {
      if (this.activeCustomMesh) this.activeCustomMesh.visible = false;
      let mesh = this.customGunCache.get(wDef.id);
      if (!mesh) {
        mesh = this._buildCustomGun(wDef, true);
        this.customGunCache.set(wDef.id, mesh);
        this.customGun.add(mesh);
      }
      mesh.visible = true;
      this.activeCustomMesh = mesh;
      this.customFlash.position.set(0, 0.02, (mesh.userData.muzzleZ || -0.45) - 0.04);
    }
    const changed = prevId !== wDef.id || (skinDef && prevSkinId !== skinDef.id);
    if (changed && this.weapon === 1) {
      this.switchT = 0;
      this.awmDrawTriggered = false;
      this.vandalDrawTriggered = false;
      this.customInspectT = -1;
      this.reloadT = 1;
    }
  }

  setWeapon(w, forceDraw = false) {
    if (w !== this.weapon || forceDraw) {
      this.weapon = w;
      this.switchT = 0;
      this.awmDrawTriggered = false;
      this.vandalDrawTriggered = false;
      this.knifeDrawTriggered = false;
      this.awmInspectHeld = false;
      this.vandalInspectHeld = false;
      this.customInspectHeld = false;
      this.customInspectT = -1;
      if (w !== 2) this.butterfly.setInspect(false);
      if (w !== 1 && (this.awmActiveName === 'reload' || this.awmActiveName === 'inspect')) {
        this._playAwmClip('idle', 0.05, true);
      }
      if (w !== 1 && this.vandalActive && (this.vandalActive.activeName === 'reload' || this.vandalActive.activeName === 'inspect')) {
        this._playVandalClip('idle', 0.05, true);
      }
    }
  }

  punch() { this.punchT = 0; this.punchSide ^= 1; }
  knifeSlash(heavy = false) { this.butterfly.slash(heavy); }
  setInspect(held) {
    const want = !!held;
    this.awmInspectHeld = want;
    this.vandalInspectHeld = want;
    this.customInspectHeld = want;
    if (this.weapon === 2) {
      this.butterfly.setInspect(want);
    } else if (this.weapon === 1 && this.useAwpGlb && want) {
      const busy =
        this.awmActiveName === 'fire' ||
        this.awmActiveName === 'reload' ||
        this.awmActiveName === 'draw' ||
        this.ads > 0.05;
      if (!busy && (this.awmActiveName === 'idle' || this.awmActiveName === 'inspect')) {
        this._playAwmClip('inspect', 0.12, false);
      }
    } else if (this.weapon === 1 && this.useVandalGlb && want && this.vandalActive) {
      const an = this.vandalActive.activeName;
      const busy = an === 'fire' || an === 'reload' || an === 'draw' || this.ads > 0.05;
      if (this.gunDef && this.gunDef.slot === 'secondary') {
        // Use the exact same YXZ procedural pistol inspect for GLB pistols (USP-S, Desert Eagle)
        if (!busy && this.customInspectT < 0) {
          this.customInspectT = 0;
          this._customCatchPlayed = false;
        }
      } else if (!busy && (an === 'idle' || an === 'inspect')) {
        this._vandalCatchPlayed = false;
        this._playVandalClip('inspect', 0.12, false);
      }
    } else if (this.weapon === 1 && !this.useAwpGlb && !this.useVandalGlb && want) {
      const busy = this.reloadT < 1 || this.switchT < 1 || this.ads > 0.05;
      if (!busy && this.customInspectT < 0) {
        this.customInspectT = 0;
        this._customCatchPlayed = false;
      }
    }
  }
  fire() {
    this.recoil = 1;
    this.flashT = 0;
    this.boltT = -0.25;
    this.awmInspectHeld = false;
    this.vandalInspectHeld = false;
    this.customInspectHeld = false;
    this.customInspectT = -1;
    if (this.useAwpGlb) this._playAwmClip('fire', 0.04, true);
    else if (this.useVandalGlb) this._playVandalClip('fire', 0.02, true);
  }
  reload(dur) {
    this.reloadT = 0;
    this.reloadDur = Math.max(0.01, dur);
    this.awmInspectHeld = false;
    this.vandalInspectHeld = false;
    this.customInspectHeld = false;
    this.customInspectT = -1;
    if (this.useAwpGlb) {
      if (dur > 0.1) {
        this._playAwmClip('reload', 0.08, true, dur);
      } else if (this.awmActiveName === 'reload') {
        this._playAwmClip('idle', 0.05, true);
      }
    } else if (this.useVandalGlb && this.vandalActive) {
      if (dur > 0.1) {
        this._playVandalClip('reload', 0.08, true, dur);
      } else if (this.vandalActive.activeName === 'reload') {
        this._playVandalClip('idle', 0.05, true);
      }
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
      if (this.shown === 1 && this.useAwpGlb && (!this.awmDrawTriggered || prevShown !== 1)) {
        this.awmDrawTriggered = true;
        this._playAwmClip('draw', 0.06, true);
      }
      if (this.shown === 1 && this.useVandalGlb && (!this.vandalDrawTriggered || prevShown !== 1)) {
        this.vandalDrawTriggered = true;
        this._playVandalClip('draw', 0.06, true);
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
    this.recoil = damp(this.recoil, 0, 12, dt);

    if (this._awmSleeveMat) this._awmSleeveMat.color.copy(this.sleeveMat.color);
    if (this.vandalActive) {
      for (const sm of this.vandalActive.sleeveMats) sm.color.copy(this.sleeveMat.color);
    }

    const hideForScope = this.gunDef && this.gunDef.scope && s.ads > 0.92;
    this.fists.visible = this.shown === 0;
    this.awm.visible = this.shown === 1 && this.useAwpGlb && !hideForScope;
    this.vandal.visible = this.shown === 1 && this.useVandalGlb && !hideForScope;
    this.customGun.visible = this.shown === 1 && !this.useAwpGlb && !this.useVandalGlb && !hideForScope;
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
    } else if (this.shown === 1 && this.useAwpGlb) {
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
    } else if (this.shown === 1 && this.useVandalGlb) {
      const ads = easeOut(s.ads);
      this._vandalPos.lerpVectors(this.vandalHipPos, this.vandalAdsPos, ads);
      const bm = 1 - ads * 0.85;
      const recoilZ = this.recoil * 0.036;
      const recoilY = this.recoil * 0.009;
      const recoilRx = this.recoil * 0.055;
      this.vandal.position.set(
        this._vandalPos.x + (bobX + this.swayX) * bm,
        this._vandalPos.y + (bobY + this.swayY) * bm - lower + recoilY,
        this._vandalPos.z + recoilZ
      );
      this.vandal.rotation.set(recoilRx, (1 - ads) * 0.03, (1 - ads) * 0.02);

      if (this.vandalActive) {
        if (s.ads > 0.05) {
          if (this.vandalActive.activeName === 'inspect') {
            this.vandalInspectHeld = false;
            this._playVandalClip('idle', 0.08, true);
          }
          if (this.customInspectT >= 0) {
            this.customInspectHeld = false;
            this.customInspectT = -1;
          }
        }
        if (this.vandalActive.loaded && this.vandalActive.mixer) {
          this.vandalActive.mixer.update(Math.min(dt, 0.05));
          // Play subtle catch click on 2-handed toss-catch inspect (non-pistol, non-operator)
          const isTwoHandedToss = this.gunDef && this.gunDef.slot === 'primary' && this.gunDef.id !== 'operator';
          if (isTwoHandedToss && this.vandalActive.activeName === 'inspect' && this.vandalActive.activeAction) {
            const ct = this.vandalActive.activeAction.time;
            if (ct < 0.2) this._vandalCatchPlayed = false;
            else if (!this._vandalCatchPlayed && ct >= 44 / 60) {
              this._vandalCatchPlayed = true;
              if (this.audio && this.audio.bolt) this.audio.bolt(0, 0.26, 1.18, true);
            }
          }
        }
      }
      if (this.gunDef && this.gunDef.slot === 'secondary') {
        this._applyProceduralInspect(dt, { userData: { bodyGroup: this.vandalModelRoot, handsGroup: null } });
      } else {
        this.vandalModelRoot.position.set(0, 0, 0);
        this.vandalModelRoot.rotation.set(0, 0, 0);
      }

      this.flashT += dt;
      const silenced = this.gunDef && this.gunDef.silenced;
      this.vandalFlash.visible = !silenced && this.flashT < 0.04;
      this.vandalFlash.material.rotation = Math.random() * 6;
      this.vandalFlashLight.intensity = !silenced && this.flashT < 0.05 ? 4.8 : 0;
    } else if (this.shown === 1 && !this.useAwpGlb && !this.useVandalGlb) {
      const ads = easeOut(s.ads);
      const isPistol = this.gunDef && this.gunDef.slot === 'secondary';
      const hx = isPistol ? 0.13 : 0.14;
      const hy = isPistol ? -0.12 : -0.125;
      const hz = isPistol ? -0.36 : -0.38;
      const ax = 0, ay = isPistol ? -0.065 : -0.072, az = isPistol ? -0.26 : -0.28;
      const px = hx + (ax - hx) * ads;
      const py = hy + (ay - hy) * ads;
      const pz = hz + (az - hz) * ads;
      const bm = 1 - ads * 0.8;
      const rk = this.gunDef ? Math.min(1.8, (this.gunDef.recoilKick || 0.025) * 40) : 1;
      const recoilZ = this.recoil * 0.055 * rk;
      const recoilY = this.recoil * 0.014 * rk;
      const recoilRx = this.recoil * 0.10 * rk;
      this.customGun.position.set(
        px + (bobX + this.swayX) * bm,
        py + (bobY + this.swayY) * bm - lower + recoilY,
        pz + recoilZ
      );
      this.customGun.rotation.set(recoilRx, (1 - ads) * 0.03, (1 - ads) * 0.02);

      if (s.ads > 0.05 && this.customInspectT >= 0) {
        this.customInspectHeld = false;
        this.customInspectT = -1;
      }
      this._applyProceduralInspect(dt, this.activeCustomMesh);

      this.reloadT = Math.min(1, this.reloadT + dt / this.reloadDur);
      if (this.reloadT < 1) {
        const r = this.reloadT;
        const tilt = Math.sin(Math.min(1, r * 1.15) * Math.PI);
        this.customGun.rotation.z += tilt * 0.48;
        this.customGun.rotation.x += tilt * 0.18;
        this.customGun.position.y -= tilt * 0.055;
        if (this.activeCustomMesh && this.activeCustomMesh.userData.mag) {
          const magOut = r > 0.18 && r < 0.65 ? Math.sin(((r - 0.18) / 0.47) * Math.PI) : 0;
          this.activeCustomMesh.userData.mag.position.y = this.activeCustomMesh.userData.magBaseY - magOut * 0.22;
        }
      } else if (this.activeCustomMesh && this.activeCustomMesh.userData.mag) {
        this.activeCustomMesh.userData.mag.position.y = this.activeCustomMesh.userData.magBaseY;
      }

      this.flashT += dt;
      const silenced = this.gunDef && this.gunDef.silenced;
      this.customFlash.visible = !silenced && this.flashT < 0.04;
      this.customFlash.material.rotation = Math.random() * 6;
      this.customFlashLight.intensity = !silenced && this.flashT < 0.05 ? 4.5 : 0;
    } else if (this.shown === 2) {
      const hideDrop = this.weapon !== 2 && this.switchT < 0.45 ? easeOut(this.switchT / 0.45) * 0.3 : 0;
      this.butterfly.group.position.y = -hideDrop;
      this.butterfly.update(dt, s);
    }
  }

  _applyProceduralInspect(dt, mesh) {
    if (!mesh || !mesh.userData.bodyGroup) return;
    const body = mesh.userData.bodyGroup;
    const hands = mesh.userData.handsGroup;
    if (this.customInspectT < 0) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      if (hands) { hands.position.set(0, 0, 0); hands.rotation.set(0, 0, 0); }
      return;
    }

    const isPistol = this.gunDef && this.gunDef.slot === 'secondary';
    const isOperator = this.gunDef && this.gunDef.id === 'operator';
    const dur = isPistol ? 2.8 : isOperator ? 3.0 : 3.4;

    this.customInspectT += dt;
    if (this.customInspectT >= dur) {
      if (this.customInspectHeld) {
        this.customInspectT = 0;
        this._customCatchPlayed = false;
      } else {
        this.customInspectT = -1;
        body.position.set(0, 0, 0);
        body.rotation.set(0, 0, 0);
        if (hands) { hands.position.set(0, 0, 0); hands.rotation.set(0, 0, 0); }
        return;
      }
    }

    const t = this.customInspectT;
    const sm = (a, b, x) => {
      const k = clamp((x - a) / Math.max(1e-4, b - a), 0, 1);
      return k * k * (3 - 2 * k);
    };
    const lerpK = (keys, time) => {
      for (let i = 0; i < keys.length - 1; i++) {
        const k0 = keys[i], k1 = keys[i + 1];
        if (time >= k0[0] && time <= k1[0]) {
          const u = sm(k0[0], k1[0], time);
          return [
            k0[1] + (k1[1] - k0[1]) * u,
            k0[2] + (k1[2] - k0[2]) * u,
            k0[3] + (k1[3] - k0[3]) * u,
            k0[4] + (k1[4] - k0[4]) * u,
            k0[5] + (k1[5] - k0[5]) * u,
            k0[6] + (k1[6] - k0[6]) * u,
          ];
        }
      }
      return [0, 0, 0, 0, 0, 0];
    };
    const D = Math.PI / 180;

    if (isPistol) {
      // Pistol inspect (YXZ order so pitch lifts barrel cleanly before yaw turns side profile to camera):
      // Phase 1: Rotate left with barrel angled diagonally UP toward sky (Side 1)
      // Phase 2: Raise muzzle straight UP
      // Phase 3: While muzzle points UP, twist pistol to face the opposite side directly at player (Side 2)
      // Phase 4: Return to idle
      body.rotation.order = 'YXZ';
      const k = lerpK([
        // [time, x, y, z, rxDeg (pitch up), ryDeg (yaw left+/right-), rzDeg (roll)]
        [0.00,  0.000, 0.000,  0.000,  0,    0,   0],
        [0.48, -0.042, 0.026, -0.024, 28,   70,  -8],
        [1.02, -0.042, 0.028, -0.024, 30,   68,  -8],
        [1.48, -0.006, 0.048, -0.020, 68,    6,   0],
        [1.82,  0.008, 0.046, -0.022, 64,  -80,  12],
        [2.34,  0.008, 0.044, -0.022, 62,  -78,  12],
        [2.80,  0.000, 0.000,  0.000,  0,    0,   0],
      ], t);
      body.position.set(k[0], k[1], k[2]);
      body.rotation.set(k[3] * D, k[4] * D, k[5] * D);
      if (hands) {
        hands.rotation.order = 'YXZ';
        hands.position.copy(body.position);
        hands.rotation.copy(body.rotation);
      }
    } else if (isOperator) {
      // Operator Valorant Default: Classic sniper tilt left -> right (no toss)
      const k = lerpK([
        [0.00,  0.000, 0.000,  0.000,  0,   0,   0],
        [0.75, -0.035, 0.018, -0.015,  8,  38,  22],
        [1.50, -0.040, 0.020, -0.020, 10,  44,  26],
        [2.25,  0.028, 0.012, -0.010,  6, -32, -20],
        [3.00,  0.000, 0.000,  0.000,  0,   0,   0],
      ], t);
      body.position.set(k[0], k[1], k[2]);
      body.rotation.set(k[3] * D, k[4] * D, k[5] * D);
      if (hands) {
        hands.position.copy(body.position);
        hands.rotation.copy(body.rotation);
      }
    } else {
      // Shared 2-handed Toss-Catch Flip Inspect:
      // Toss HIGH & spin horizontal -> Catch & inspect Side 1 -> Vertical -> Tilt opposite (Side 2) -> Idle
      if (!this._customCatchPlayed && t >= 0.72) {
        this._customCatchPlayed = true;
        if (this.audio && this.audio.bolt) this.audio.bolt(0, 0.26, 1.18, true);
      }
      const bk = lerpK([
        [0.00,  0.000,  0.000,  0.000,  0,   0,   0],
        [0.20,  0.000, -0.028,  0.010, -8,   4,   0],
        [0.44, -0.030,  0.135, -0.030,  6,  52,   8],
        [0.64, -0.050,  0.075, -0.040,  8,  90,   6],
        [0.74, -0.050,  0.010, -0.040, 10,  88,   4],
        [0.88, -0.050,  0.026, -0.045,  8,  88,   4],
        [1.55, -0.040,  0.028, -0.045,  6,  86,   2],
        [1.95,  0.000,  0.012, -0.010,  4,   0,   0],
        [2.38,  0.035,  0.022, -0.025, 10, -48, -28],
        [2.86,  0.032,  0.020, -0.025,  8, -45, -26],
        [3.40,  0.000,  0.000,  0.000,  0,   0,   0],
      ], t);
      body.position.set(bk[0], bk[1], bk[2]);
      body.rotation.set(bk[3] * D, bk[4] * D, bk[5] * D);
      if (hands) {
        const hk = lerpK([
          [0.00,  0.000,  0.000,  0.000,  0,   0,   0],
          [0.20,  0.000, -0.028,  0.000, -8,   4,   0],
          [0.36,  0.000,  0.032, -0.015, 10,   6,   0],
          [0.60, -0.020, -0.012, -0.010,  4,  15,   0],
          [0.74, -0.020, -0.028, -0.010,  6,  16,   0],
          [0.88, -0.020, -0.012, -0.015,  4,  16,   0],
          [1.55, -0.020, -0.010, -0.015,  4,  16,   0],
          [1.95,  0.000,  0.008,  0.000,  4,   0,   0],
          [2.38,  0.020,  0.012, -0.010, 10, -32, -22],
          [2.86,  0.018,  0.010, -0.010,  8, -30, -20],
          [3.40,  0.000,  0.000,  0.000,  0,   0,   0],
        ], t);
        hands.position.set(hk[0], hk[1], hk[2]);
        hands.rotation.set(hk[3] * D, hk[4] * D, hk[5] * D);
      }
    }
  }
}

export function buildProceduralWeaponMesh(wDef) {
  if (!wDef) return new THREE.Group();
  const dummySleeve = new THREE.MeshBasicMaterial();
  const dummySkin = new THREE.MeshBasicMaterial();
  const g = ViewModel.prototype._buildCustomGun.call(
    { sleeveMat: dummySleeve, skinMat: dummySkin },
    wDef,
    false
  );
  if (g.userData.handsGroup) g.remove(g.userData.handsGroup);
  dummySleeve.dispose();
  dummySkin.dispose();
  return g;
}
