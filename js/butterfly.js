import * as THREE from 'three';
import { loadGLB, warmUpModel, disposeObject3D } from './glb-loader.js';
import { clamp, damp } from './util.js';

// Gravity constant in m/s^2 (scaled for responsive first-person feel)
const GRAVITY = 16.0;
// Closed angles around the tang pins (+Z hinge axis in Knife Space)
const BLADE_CLOSED = Math.PI * 0.96;
const BITE_CLOSED = -Math.PI * 0.94;

// Tang-pin clack timestamps mapped directly from Blender 60-FPS NLA keyframe actions
const CLACK_SCHEDULES = {
  draw: [
    { time: 22 / 60, pitch: 1.04, vol: 0.80 }, // Y2K Rollover open strike
    { time: 35 / 60, pitch: 1.16, vol: 0.90 }, // Staggered catch lock
  ],
  heavy: [
    { time: 13 / 60, pitch: 0.92, vol: 0.85 }, // Icepick reverse lock
    { time: 38 / 60, pitch: 1.12, vol: 0.85 }, // Standard grip return lock
  ],
  inspect: [
    { time: 18 / 60, pitch: 1.05, vol: 0.72 }, // Phase 1: Thumb rollover snap
    { time: 30 / 60, pitch: 1.14, vol: 0.68 }, // Phase 2: Helicopter fan open
    { time: 70 / 60, pitch: 1.18, vol: 0.70 }, // Phase 3: Index chaplin entry
    { time: 106 / 60, pitch: 1.22, vol: 0.92 }, // Phase 4: Wrist pass & snap catch
  ],
};

const LOOP_CLIPS = new Set(['idle']);
const REQUIRED_CLIPS = ['draw', 'idle', 'slash_1', 'slash_2', 'heavy', 'inspect'];

// Builds a procedural stylized Champions Butterfly Knife fallback / 3rd-person mesh
export function buildThirdPersonButterfly() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x16181f, metalness: 0.65, roughness: 0.42 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8a41c, metalness: 0.92, roughness: 0.22 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffb326, emissive: 0xff7a00, emissiveIntensity: 1.8, roughness: 0.25 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x8e1238, metalness: 0.9, roughness: 0.18 });

  // Safe + bite handles
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.014, 0.012), black);
  h1.position.set(-0.065, 0.01, 0);
  const h1Trim = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.005, 0.0135), gold);
  h1Trim.position.set(-0.065, 0.014, 0);
  const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.014, 0.012), black);
  h2.position.set(-0.065, -0.01, 0);
  const h2Trim = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.005, 0.0135), gold);
  h2Trim.position.set(-0.065, -0.014, 0);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.014), glow);
  accent.position.set(-0.03, 0, 0);

  // Tapered blade
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.022, 0.004), bladeMat);
  blade.position.set(0.065, 0, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 4), bladeMat);
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(0.14, 0.003, 0);

  g.add(h1, h1Trim, h2, h2Trim, accent, blade, tip);
  return g;
}

/**
 * First-person Valorant Champions Butterfly Knife controller driven by:
 * - Blender-authored NLA armature rig (assets/butterfly-viewmodel.glb via THREE.AnimationMixer)
 *   with smooth crossFadeTo transitions (0.06s - 0.12s) and 0-clipping 3-phalanx fingers
 * - Layer-1 real-time 6-DOF gravity, camera angular momentum, locomotion gait, jump/land physics
 * - Frame-accurate metallic tang-pin clack audio synced to Blender keyframe timings
 */
export class ButterflyController {
  constructor(sleeveMat, skinMat, audio = null, gpu = null) {
    this.audio = audio;
    this.sleeveMat = sleeveMat;
    this.skinMat = skinMat;
    this._gpu = gpu;
    this._loading = false;

    this.group = new THREE.Group();
    // Layer 1 physics pivot: all procedural inertia, gravity tilt, and locomotion gait live here
    this.inertiaPivot = new THREE.Group();
    this.group.add(this.inertiaPivot);

    // Layer 2 Blender animation root (sits natively in inertiaPivot frame matching VMCamera)
    this.modelRoot = new THREE.Group();
    this.inertiaPivot.add(this.modelRoot);

    // Base resting viewmodel pose (Valorant heroic lower-right framing, FOV 62 deg)
    this.basePos = new THREE.Vector3(0.175, -0.155, -0.365);
    this.baseRot = new THREE.Euler(0.16, 0.14, -0.05, 'YXZ');

    // Blender bone & material references
    this.loaded = false;
    this.mixer = null;
    this.actions = Object.create(null);
    this.activeName = 'idle';
    this.activeAction = null;
    this.pendingClip = 'idle';
    this._rigSleeveMat = null;
    this._rigSkinMat = null;

    this.handBone = null;
    this.knifePivot = null;
    this.safePin = null;
    this.bitePin = null;

    // Action & audio state
    this.slashCombo = 0;
    this.inspectHeld = false;
    this.clackCooldown = 0;
    this._clackMask = 0;
    this._prevActionTime = 0;

    // Layer 1 physics state (6-DOF wrist inertia & gravity response)
    this.prevVel = new THREE.Vector3();
    this.accelWorld = new THREE.Vector3();
    this.hasPrev = false;

    this.linPos = new THREE.Vector3();
    this.linVel = new THREE.Vector3();
    this.angPos = new THREE.Vector3();
    this.angVel = new THREE.Vector3();

    this.yawRate = 0;
    this.pitchRate = 0;
    this.prevYawRate = 0;
    this.prevPitchRate = 0;
    this.yawAccel = 0;
    this.pitchAccel = 0;

    // Gait / movement phase
    this.walkPhase = 0;
    this.idleTime = 0;
    this.sprintBlend = 0;
    this.airBlend = 0;
    this.crouchBlend = 0;

    // Debug & slow-motion controls
    this.timeScale = 1.0;
    this.debugAxesEnabled = false;
    this._debugHelpers = [];

    // Reusable scratch vectors/quaternions (zero per-frame GC allocations)
    this._qCam = new THREE.Quaternion();
    this._qCamInv = new THREE.Quaternion();
    this._eCam = new THREE.Euler(0, 0, 0, 'YXZ');
    this._gCam = new THREE.Vector3();
    this._aCam = new THREE.Vector3();
    this._fEff = new THREE.Vector3();

    this._createFallbackRig(sleeveMat, skinMat);
    // Lazy-loaded when knife is equipped/drawn or preloaded during lobby idle
  }

  ensureLoaded() {
    if (!this.loaded && !this._loading) this._loadGLB();
  }

  _createFallbackRig(sleeveMat, skinMat) {
    this.fallbackGroup = new THREE.Group();

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.084, 0.34), sleeveMat);
    arm.position.set(0.04, -0.022, 0.25);
    arm.rotation.set(0.16, -0.24, 0.04);

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.068, 0.106), skinMat);
    hand.position.set(0.04, -0.022, 0.029);
    hand.rotation.set(0.16, -0.24, 0.04);

    const knife = buildThirdPersonButterfly();
    knife.position.set(-0.012, 0.008, -0.024);
    knife.rotation.set(0.24, Math.PI * 0.5 + 0.34, -0.16);
    knife.scale.setScalar(1.52);

    this.fallbackGroup.add(arm, hand, knife);
    this.modelRoot.add(this.fallbackGroup);
  }

  _tuneMaterial(mat) {
    if (!mat || !mat.isMeshStandardMaterial) return;
    if (mat.name === 'ChampionsGlow') {
      mat.emissiveIntensity = 2.2;
      mat.envMapIntensity = 1.4;
    } else if (mat.name === 'ChampionsGold' || mat.name === 'CuffGold') {
      mat.envMapIntensity = 1.8;
    } else if (mat.name === 'ChampionsBlade') {
      mat.envMapIntensity = 1.8;
    } else if (mat.name === 'ChampionsRed' || mat.name === 'ObsidianBlack') {
      mat.envMapIntensity = 1.5;
    } else if (mat.name === 'SleeveMat') {
      this._rigSleeveMat = mat;
      mat.envMapIntensity = 0.85;
      if (this.sleeveMat) mat.color.copy(this.sleeveMat.color);
    } else if (mat.name === 'SkinMat') {
      this._rigSkinMat = mat;
      mat.envMapIntensity = 0.8;
      if (this.skinMat) mat.color.copy(this.skinMat.color);
    } else if (mat.name === 'GloveMat') {
      mat.envMapIntensity = 1.1;
    } else {
      mat.envMapIntensity = 1.0;
    }
    mat.needsUpdate = true;
  }

  async _loadGLB() {
    if (this.loaded || this._loading) return;
    this._loading = true;
    try {
      const gltf = await loadGLB('assets/butterfly-viewmodel.glb');
      const root = gltf.scene;
      root.visible = false;
      root.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = false;
          o.receiveShadow = false;
          if (Array.isArray(o.material)) {
            for (let i = 0; i < o.material.length; i++) this._tuneMaterial(o.material[i]);
          } else {
            this._tuneMaterial(o.material);
          }
        }
      });

      if (this._gpu?.renderer) {
        await warmUpModel(this._gpu.renderer, this._gpu.scene, this._gpu.camera, root, { lowGfx: this._gpu.lowGfx });
      }

      this.handBone = root.getObjectByName('Hand') || null;
      this.knifePivot = root.getObjectByName('KnifePivot') || null;
      this.safePin = root.getObjectByName('SafePinBone') || null;
      this.bitePin = root.getObjectByName('BitePinBone') || null;

      if (this.fallbackGroup) {
        this.fallbackGroup.removeFromParent();
        disposeObject3D(this.fallbackGroup);
        this.fallbackGroup = null;
      }
      root.visible = true;
      this.modelRoot.add(root);

      this.mixer = new THREE.AnimationMixer(root);
      for (const name of REQUIRED_CLIPS) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, name);
        if (!clip) {
          console.warn(`butterfly-viewmodel.glb missing expected NLA clip: ${name}`);
          continue;
        }
        const action = this.mixer.clipAction(clip);
        if (LOOP_CLIPS.has(name)) {
          action.setLoop(THREE.LoopRepeat, Infinity);
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        this.actions[name] = action;
      }

      this.mixer.addEventListener('finished', (e) => {
        if (e.action === this.activeAction && e.action !== this.actions.idle) {
          this._playClip(this.inspectHeld ? 'inspect' : 'idle', 0.10, true);
        }
      });

      this.loaded = true;
      const startName = this.pendingClip && this.actions[this.pendingClip] ? this.pendingClip : 'idle';
      this._playClip(startName, 0, true);
      if (this.debugAxesEnabled) this.setDebugAxes(true);
    } catch (err) {
      this._loading = false;
      console.warn('Could not load assets/butterfly-viewmodel.glb, keeping fallback mesh:', err);
    }
  }

  _playClip(name, fadeSec = 0.08, forceRestart = true) {
    if (!this.mixer || !this.actions[name]) {
      this.pendingClip = name;
      this.activeName = name;
      return;
    }

    const next = this.actions[name];
    const prev = this.activeAction;
    if (prev === next && !forceRestart) return;

    this._clackMask = 0;
    this._prevActionTime = 0;

    next.enabled = true;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);

    if (prev && prev !== next && fadeSec > 0) {
      prev.enabled = true;
      next.play();
      prev.crossFadeTo(next, fadeSec, false);
    } else {
      for (const k in this.actions) {
        if (this.actions[k] !== next) this.actions[k].stop();
      }
      next.play();
    }

    this.activeAction = next;
    this.activeName = name;
  }

  _clack(pitch = 1.0, vol = 0.7) {
    if (this.clackCooldown > 0) return;
    this.clackCooldown = 0.055;
    if (this.audio && this.audio.knifeClack) this.audio.knifeClack(pitch, vol);
  }

  _updateClackEvents() {
    if (!this.activeAction) return;
    const sched = CLACK_SCHEDULES[this.activeName];
    if (!sched) return;

    const t = this.activeAction.time;
    if (t + 0.15 < this._prevActionTime) {
      // Loop wrapped back to frame 0 (continuous inspect)
      this._clackMask = 0;
    }
    for (let i = 0; i < sched.length; i++) {
      const bit = 1 << i;
      if ((this._clackMask & bit) === 0 && t >= sched[i].time) {
        this._clackMask |= bit;
        this._clack(sched[i].pitch, sched[i].vol);
      }
    }
    this._prevActionTime = t;
  }

  // -------------------------------------------------------------------------
  // Public API & Debug Hooks (exposed via window.__game.vm.butterfly)
  // -------------------------------------------------------------------------
  setTimeScale(scale = 1.0) {
    const v = Number(scale);
    this.timeScale = clamp(Number.isFinite(v) && v > 0 ? v : 1.0, 0.05, 2.0);
    return this.timeScale;
  }

  setDebugAxes(enabled = true) {
    this.debugAxesEnabled = !!enabled;
    for (const h of this._debugHelpers) h.removeFromParent();
    this._debugHelpers.length = 0;
    if (!this.debugAxesEnabled) return false;

    const attach = (obj, size) => {
      if (!obj) return;
      const ax = new THREE.AxesHelper(size);
      obj.add(ax);
      this._debugHelpers.push(ax);
    };
    attach(this.inertiaPivot, 0.04);
    attach(this.handBone, 0.035);
    attach(this.knifePivot, 0.03);
    attach(this.safePin, 0.025);
    attach(this.bitePin, 0.025);
    return true;
  }

  playTrick(name, holdInspect = false) {
    switch (name) {
      case 'draw':
        this.draw();
        break;
      case 'inspect':
        this.inspectHeld = !!holdInspect;
        this._playClip('inspect', 0.08, true);
        break;
      case 'slash':
      case 'slash_1':
        this.slashCombo = 0;
        this._playClip('slash_1', 0.06, true);
        break;
      case 'slash_2':
        this.slashCombo = 1;
        this._playClip('slash_2', 0.06, true);
        break;
      case 'heavy':
        this.slash(true);
        break;
      default:
        this.inspectHeld = false;
        this._playClip('idle', 0.10, true);
        break;
    }
    return this.activeName;
  }

  draw() {
    // Tactile Layer-1 wrist inertia bump when whipping the knife up
    this.linPos.set(0.03, -0.09, 0.04);
    this.linVel.set(-0.15, 0.45, -0.15);
    this.angPos.set(-0.28, 0.16, -0.22);
    this.angVel.set(1.2, -0.8, 1.0);
    if (this.audio && this.audio.knifeDraw) this.audio.knifeDraw();
    this._playClip('draw', 0.06, true);
  }

  slash(heavy = false) {
    if (heavy) {
      this._playClip('heavy', 0.06, true);
    } else {
      this.slashCombo ^= 1;
      this._playClip(this.slashCombo ? 'slash_1' : 'slash_2', 0.06, true);
    }
  }

  setInspect(held) {
    const want = !!held;
    this.inspectHeld = want;
    if (want && (this.activeName === 'idle' || this.activeName === 'inspect')) {
      this._playClip('inspect', 0.08, true);
    }
  }

  /**
   * Main physics + AnimationMixer step (zero per-frame heap allocations).
   * s = { speed, onGround, sprint, crouchV, ads, lookDX, lookDY, yaw, pitch, vel, landImpulse, jumpImpulse }
   */
  update(dt, s) {
    const rawDt = Math.min(dt, 0.05);
    const effDt = rawDt * this.timeScale;
    this.idleTime += effDt;
    this.clackCooldown = Math.max(0, this.clackCooldown - effDt);

    if (this._rigSleeveMat && this.sleeveMat) {
      this._rigSleeveMat.color.copy(this.sleeveMat.color);
    }

    const vx = s.vel ? s.vel.x : 0;
    const vy = s.vel ? s.vel.y : 0;
    const vz = s.vel ? s.vel.z : 0;
    const yaw = s.yaw || 0;
    const pitch = s.pitch || 0;
    const speed = s.speed || 0;
    const onGround = s.onGround !== false;
    const sprint = !!s.sprint;
    const crouchV = s.crouchV || 0;

    // ------------------------------------------------------------------
    // 1. COMPUTE GRAVITY & CHARACTER MOMENTUM IN CAMERA LOCAL SPACE
    // ------------------------------------------------------------------
    if (!this.hasPrev) {
      this.prevVel.set(vx, vy, vz);
      this.hasPrev = true;
    }

    const invDt = 1 / Math.max(rawDt, 0.004);
    const rawAx = clamp((vx - this.prevVel.x) * invDt, -55, 55);
    const rawAy = clamp((vy - this.prevVel.y) * invDt, -75, 75);
    const rawAz = clamp((vz - this.prevVel.z) * invDt, -55, 55);
    this.prevVel.set(vx, vy, vz);

    this.accelWorld.x = damp(this.accelWorld.x, rawAx, 18, rawDt);
    this.accelWorld.y = damp(this.accelWorld.y, rawAy, 22, rawDt);
    this.accelWorld.z = damp(this.accelWorld.z, rawAz, 18, rawDt);

    this._eCam.set(pitch, yaw, 0, 'YXZ');
    this._qCam.setFromEuler(this._eCam);
    this._qCamInv.copy(this._qCam).invert();

    // Transform world gravity (0, -GRAVITY, 0) & linear acceleration into camera space
    this._gCam.set(0, -GRAVITY, 0).applyQuaternion(this._qCamInv);
    this._aCam.copy(this.accelWorld).applyQuaternion(this._qCamInv);
    this._fEff.copy(this._gCam).sub(this._aCam);

    // Camera angular velocity & angular acceleration
    const rawYawRate = clamp(-(s.lookDX || 0) * 0.0022 * invDt, -16, 16);
    const rawPitchRate = clamp(-(s.lookDY || 0) * 0.0022 * invDt, -14, 14);
    this.yawRate = damp(this.yawRate, rawYawRate, 18, rawDt);
    this.pitchRate = damp(this.pitchRate, rawPitchRate, 18, rawDt);
    this.yawAccel = damp(this.yawAccel, clamp((this.yawRate - this.prevYawRate) * invDt, -90, 90), 14, rawDt);
    this.pitchAccel = damp(this.pitchAccel, clamp((this.pitchRate - this.prevPitchRate) * invDt, -90, 90), 14, rawDt);
    this.prevYawRate = this.yawRate;
    this.prevPitchRate = this.pitchRate;

    if (s.jumpImpulse > 0) {
      this.linVel.y -= 0.42 * s.jumpImpulse;
      this.angVel.x -= 2.4 * s.jumpImpulse;
    }
    if (s.landImpulse > 0) {
      const imp = clamp(s.landImpulse, 0, 1.5);
      this.linVel.y -= 0.78 * imp;
      this.linVel.z += 0.14 * imp;
      this.angVel.x -= 4.8 * imp;
      this.angVel.z -= 1.6 * imp;
    }

    // ------------------------------------------------------------------
    // 2. 6-DOF WRIST & FOREARM MOMENTUM SPRING-DAMPER
    // ------------------------------------------------------------------
    const dGx = this._gCam.x;
    const dGy = this._gCam.y - (-GRAVITY);
    const dGz = this._gCam.z;

    const fInX = -this._aCam.x;
    const fInY = -this._aCam.y;
    const fInZ = -this._aCam.z;

    const airFloat = onGround ? 0 : clamp(-vy * 0.0045, -0.025, 0.038);
    const targetLinX = clamp(fInX * 0.0019 + this.yawRate * 0.0055, -0.055, 0.055);
    const targetLinY = clamp(fInY * 0.0016 + dGy * 0.0012 + this.pitchRate * 0.0045 + airFloat, -0.065, 0.055);
    const targetLinZ = clamp(fInZ * 0.0018 + dGz * 0.0016, -0.05, 0.05);

    const targetAngX = clamp(
      dGz * 0.011 + fInZ * 0.0065 + fInY * 0.005 + this.pitchRate * 0.032 + this.pitchAccel * 0.0018,
      -0.32, 0.32
    );
    const targetAngY = clamp(
      -fInX * 0.0075 + this.yawRate * 0.042 + this.yawAccel * 0.0022,
      -0.36, 0.36
    );
    const targetAngZ = clamp(
      fInX * 0.0135 + dGx * 0.012 - this.yawRate * 0.036 - this.yawAccel * 0.0025,
      -0.38, 0.38
    );

    const kLin = 135, cLin = 18.5;
    this.linVel.x += ((targetLinX - this.linPos.x) * kLin - this.linVel.x * cLin) * effDt;
    this.linVel.y += ((targetLinY - this.linPos.y) * kLin - this.linVel.y * cLin) * effDt;
    this.linVel.z += ((targetLinZ - this.linPos.z) * kLin - this.linVel.z * cLin) * effDt;
    this.linPos.addScaledVector(this.linVel, effDt);

    const kAng = 145, cAng = 17.5;
    this.angVel.x += ((targetAngX - this.angPos.x) * kAng - this.angVel.x * cAng) * effDt;
    this.angVel.y += ((targetAngY - this.angPos.y) * kAng - this.angVel.y * cAng) * effDt;
    this.angVel.z += ((targetAngZ - this.angPos.z) * kAng - this.angVel.z * cAng) * effDt;
    this.angPos.addScaledVector(this.angVel, effDt);

    // ------------------------------------------------------------------
    // 3. LOCOMOTION GAIT (WALK / SPRINT / CROUCH / AIRBORNE)
    // ------------------------------------------------------------------
    this.sprintBlend = damp(this.sprintBlend, sprint && onGround && speed > 5.5 ? 1 : 0, 8, effDt);
    this.airBlend = damp(this.airBlend, onGround ? 0 : 1, 10, effDt);
    this.crouchBlend = damp(this.crouchBlend, crouchV, 12, effDt);

    const moveNorm = clamp(speed / 7.5, 0, 1.25) * (onGround ? 1 : 0.15);
    const gaitFreq = 6.2 + speed * 1.15;
    this.walkPhase += effDt * gaitFreq * (moveNorm > 0.04 ? 1 : 0);

    const amp = (0.011 + this.sprintBlend * 0.014) * moveNorm;
    const gaitX = Math.sin(this.walkPhase) * amp * 1.25;
    const gaitY = (Math.cos(this.walkPhase * 2) - 1) * amp * 0.55;
    const gaitZ = Math.sin(this.walkPhase + 0.6) * amp * 0.7;
    const gaitRoll = Math.sin(this.walkPhase) * (0.045 + this.sprintBlend * 0.075) * moveNorm;
    const gaitPitch = Math.cos(this.walkPhase * 2) * (0.02 + this.sprintBlend * 0.04) * moveNorm;

    const breathY = Math.sin(this.idleTime * 2.1) * 0.0028 * (1 - moveNorm * 0.5);
    const breathR = Math.cos(this.idleTime * 1.45) * 0.012 * (1 - moveNorm * 0.5);

    const spX = -0.038 * this.sprintBlend;
    const spY = -0.018 * this.sprintBlend;
    const spZ = 0.016 * this.sprintBlend;
    const spRotX = -0.15 * this.sprintBlend;
    const spRotY = 0.36 * this.sprintBlend;
    const spRotZ = 0.26 * this.sprintBlend;

    const crX = -0.018 * this.crouchBlend;
    const crY = -0.015 * this.crouchBlend;
    const crRotZ = 0.09 * this.crouchBlend;

    this.inertiaPivot.position.set(
      this.basePos.x + this.linPos.x + gaitX + spX + crX,
      this.basePos.y + this.linPos.y + gaitY + breathY + spY + crY,
      this.basePos.z + this.linPos.z + gaitZ + spZ
    );
    this.inertiaPivot.rotation.set(
      this.baseRot.x + this.angPos.x + gaitPitch + spRotX,
      this.baseRot.y + this.angPos.y + spRotY,
      this.baseRot.z + this.angPos.z + gaitRoll + breathR + spRotZ + crRotZ,
      'YXZ'
    );

    // ------------------------------------------------------------------
    // 4. LAYER 2 BLENDER ANIMATION MIXER & TANG-PIN AUDIO EVENTS
    // ------------------------------------------------------------------
    if (this.mixer) {
      this.mixer.update(effDt);
      this._updateClackEvents();
    }
  }
}

export { BLADE_CLOSED, BITE_CLOSED, GRAVITY };
