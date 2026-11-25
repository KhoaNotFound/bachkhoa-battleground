// Weapon table: damage, fire rate, PUBG-style recoil pattern, bloom and carry weight.
//
// Slots (index used on the wire and by the HUD): 0 fist · 1 AWM · 2 knife · 3 UMP45 · 4 M416 · 5 AKM
//
// RECOIL MODEL (modelled on PUBG PC)
//  * Every shot kicks the view up (vertical) and sideways (horizontal). The kick is real: it moves the
//    player's aim, and it does NOT come back by itself – the player has to pull the mouse down to
//    compensate ("spray control"). Only a small part (`recover`) drifts back after the gun stops firing.
//  * The vertical kick is small for the first shots and ramps up over `ramp` shots to `vMax`
//    (PUBG: the first bullet is nearly flat, then the climb accelerates).
//  * The horizontal kick follows a fixed wave plus a per-shot pseudo-random value that depends only on
//    (gun, shot number). Same gun + same shot index = same offset, so a pattern is learnable, like PUBG.
//  * Multipliers: ADS ×0.8, crouch ×0.85, moving ×1.1, airborne ×1.4. Kick numbers are degrees per shot.
//  * Separate from the kick there is bloom: the random cone around the aim point (crosshair gap),
//    which grows per shot, decays when you stop, and grows when moving or airborne.
//
// WEIGHT / SPEED
//  * Each gun has a weight in kg. Move speed multiplier = 1.15 − 0.05·kg (fist 1.15 … AWM 0.81).
//    Weight also slows ADS walking, the draw time and, for the heavy guns, the reload.

export const BASE_SPEED_MULT = 1.15;
export const SPEED_PER_KG = 0.05;

export const WEAPONS = {
  // bolt-action sniper: one huge kick, long recovery, heaviest gun in the game
  1: {
    id: 'awm', name: 'AWM', slot: 1, auto: false, weight: 6.8,
    head: 250, body: 85, legs: 65, mag: 5, cd: 1350, reload: 2800, draw: 450,
    recoil: { vMin: 2.6, vMax: 2.6, ramp: 1, hAmp: 0.0, hFreq: 0, hJit: 0.35, recover: 0.5 },
    bloom: { hip: 0.055, ads: 0.055, scoped: 0, move: 0.03, perShot: 0, max: 0, decay: 1 },
    range: 1500, falloff: 0,
  },
  // SMG: light and fast to move with, weak kick, small mag
  3: {
    id: 'ump45', name: 'UMP45', slot: 3, auto: true, weight: 2.3,
    head: 40, body: 20, legs: 15, mag: 25, cd: 100, reload: 2300, draw: 280,
    recoil: { vMin: 0.2, vMax: 0.36, ramp: 6, hAmp: 0.16, hFreq: 0.9, hJit: 0.07, recover: 0.35 },
    bloom: { hip: 0.03, ads: 0.0055, scoped: 0, move: 0.022, perShot: 0.0030, max: 0.026, decay: 0.09 },
    range: 90, falloff: 0.5,
  },
  // all-round assault rifle: moderate climb, gentle sway
  4: {
    id: 'm416', name: 'M416', slot: 4, auto: true, weight: 3.5,
    head: 48, body: 24, legs: 18, mag: 30, cd: 86, reload: 2500, draw: 340,
    recoil: { vMin: 0.28, vMax: 0.5, ramp: 8, hAmp: 0.22, hFreq: 0.7, hJit: 0.09, recover: 0.3 },
    bloom: { hip: 0.034, ads: 0.0055, scoped: 0, move: 0.02, perShot: 0.0034, max: 0.03, decay: 0.08 },
    range: 130, falloff: 0.45,
  },
  // heavy hitter: slowest of the rifles to carry, hardest to control (steep climb, wide drift)
  5: {
    id: 'akm', name: 'AKM', slot: 5, auto: true, weight: 4.3,
    head: 60, body: 30, legs: 22, mag: 30, cd: 100, reload: 2900, draw: 400,
    recoil: { vMin: 0.5, vMax: 0.92, ramp: 6, hAmp: 0.4, hFreq: 0.55, hJit: 0.16, recover: 0.2 },
    bloom: { hip: 0.04, ads: 0.0065, scoped: 0, move: 0.024, perShot: 0.0046, max: 0.04, decay: 0.07 },
    range: 120, falloff: 0.5,
  },
};

// Non-gun slots only need a weight (so the speed formula is uniform)
export const MELEE_WEIGHT = { 0: 0, 2: 0.3 };

export const isGun = (w) => !!WEAPONS[w];
export const weaponWeight = (w) => (WEAPONS[w] ? WEAPONS[w].weight : MELEE_WEIGHT[w] || 0);
export const weaponSpeedMult = (w) => BASE_SPEED_MULT - SPEED_PER_KG * weaponWeight(w);
// ADS walk speed: base 0.55, heavier guns are a little slower still
export const adsSpeedMult = (w) => 0.55 - 0.012 * weaponWeight(w);
export const drawTime = (w) => (WEAPONS[w] ? WEAPONS[w].draw : 450);
export const reloadTime = (w) => WEAPONS[w].reload;

const DEG = Math.PI / 180;

// deterministic pseudo-random in [-1, 1] from (gun, shot)
function hash(slot, i) {
  let x = Math.imul(slot * 7919 + i * 104729 + 13, 0x9e3779b1);
  x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13;
  return ((x >>> 0) / 4294967295) * 2 - 1;
}

// Kick for shot number `i` (0 = first bullet of a spray), in radians: { up, right }
export function recoilKick(def, i, ctx) {
  const r = def.recoil;
  const t = Math.min(1, i / r.ramp);
  const v = r.vMin + (r.vMax - r.vMin) * t * (2 - t); // ease-out ramp
  const wave = Math.sin(i * r.hFreq * 1.7 + def.slot);
  const h = r.hAmp * wave * Math.min(1, 0.3 + i / 4) + r.hJit * hash(def.slot, i);
  let m = 1;
  if (ctx.ads > 0.5) m *= 0.8;
  if (ctx.crouch) m *= 0.85;
  if (ctx.moving) m *= 1.1;
  if (ctx.air) m *= 1.4;
  return { up: v * m * DEG, right: h * m * DEG };
}

// Random-cone half angle (radians) for the next bullet
export function spreadOf(def, ctx) {
  const b = def.bloom;
  let s = ctx.scoped ? b.scoped : b.hip + (b.ads - b.hip) * ctx.ads;
  s += ctx.bloom;
  s += (ctx.speed / 6) * b.move * (ctx.scoped ? 0.4 : 1);
  if (ctx.air) s += 0.07;
  if (ctx.crouch) s *= 0.6;
  return s;
}

// Per-player recoil state. update() is called every frame; kick() on every bullet.
export class Recoil {
  constructor() { this.reset(); }
  reset() {
    this.shot = 0;        // bullets fired in the current spray
    this.lastShot = 0;
    this.pendUp = 0;      // kick still to be applied to the view (smoothed over ~60 ms)
    this.pendRight = 0;
    this.accUp = 0;       // total upward kick not yet compensated by the player (for recovery)
    this.bloom = 0;
    this.floor = null;
  }
  // returns the kick that was queued (radians) so callers can add visual punch
  kick(def, ctx, now) {
    // spray restarts after the gun has rested for a moment (AWM: every shot is a fresh first shot)
    if (now - this.lastShot > Math.max(250, def.cd * 2.2)) this.shot = 0;
    const k = recoilKick(def, this.shot, ctx);
    this.shot++;
    this.lastShot = now;
    this.pendUp += k.up; this.pendRight += k.right;
    this.accUp += k.up;
    this.floor = null;
    this.bloom = Math.min(def.bloom.max, this.bloom + def.bloom.perShot);
    return k;
  }
  // The player pulling the mouse down cancels stored kick, so recovery never drags the view below the start.
  compensate(downRad) { if (downRad > 0) this.accUp = Math.max(0, this.accUp - downRad); }
  // apply to the view: returns { dPitch, dYaw } (radians; + pitch = up, + yaw = counter-clockwise/left)
  update(def, dt, now) {
    let dPitch = 0, dYaw = 0;
    const f = 1 - Math.exp(-28 * dt);
    const up = this.pendUp * f, rt = this.pendRight * f;
    this.pendUp -= up; this.pendRight -= rt;
    dPitch += up; dYaw -= rt;
    if (def) {
      this.bloom = Math.max(0, this.bloom - def.bloom.decay * dt);
      const idle = now - this.lastShot;
      if (idle > Math.max(120, def.cd * 1.6) && this.accUp > 0 && def.recoil.recover > 0) {
        // after the gun rests, a fraction of the remaining climb eases back down
        if (this.floor == null) this.floor = this.accUp * (1 - def.recoil.recover);
        const down = Math.max(0, this.accUp - this.floor) * (1 - Math.exp(-5 * dt));
        this.accUp -= down; dPitch -= down;
      }
    }
    return { dPitch, dYaw };
  }
}
