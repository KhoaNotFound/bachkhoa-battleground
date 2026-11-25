// Gun feel on top of the weapon catalog (weapons.js): PUBG-style recoil and carry weight.
//
// RECOIL (modelled on PUBG PC)
//  * Every bullet kicks the REAL aim up and sideways. It does not come back by itself – the player pulls
//    the mouse down to compensate ("spray control"). Only `recover` of the climb eases back after the gun rests.
//  * Vertical kick is small on the first bullets and ramps up over `ramp` bullets to `vMax`.
//  * Horizontal kick = a fixed wave + a pseudo-random value that depends only on (gun, bullet number),
//    so the pattern is the same every spray and can be learned, like PUBG.
//  * Multipliers: ADS ×0.8, crouch ×0.85, moving ×1.1, airborne ×1.4. Numbers are degrees per bullet.
//  * Bloom (random cone) grows per bullet, decays at rest, and is added to the catalog's base spread.
//
// WEIGHT
//  * Each gun has a mass in kg. Move speed multiplier = 1.15 − 0.05·kg, clamped to 0.7 … 1.2
//    (fist 1.15 · pistols ~1.1 · SMGs ~1.03 · rifles ~0.97 · snipers 0.8–0.9 · LMGs 0.7–0.8).
//    Heavier guns are also a bit slower while ADS.

export const BASE_SPEED_MULT = 1.15;
export const SPEED_PER_KG = 0.05;

const R = (vMin, vMax, ramp, hAmp, hFreq, hJit, recover) => ({ vMin, vMax, ramp, hAmp, hFreq, hJit, recover });

// weight in kg + recoil pattern per weapon id
export const GUN_FEEL = {
  // sidearms – one click = one kick (semi) except the auto Frenzy
  classic:  { weight: 0.8, recoil: R(0.9, 0.9, 1, 0.1, 0, 0.25, 0.6) },
  shorty:   { weight: 1.2, recoil: R(3.0, 3.0, 1, 0.3, 0, 0.5, 0.5) },
  frenzy:   { weight: 1.0, recoil: R(0.45, 0.8, 8, 0.3, 0.9, 0.12, 0.3) },
  ghost:    { weight: 0.9, recoil: R(0.8, 0.8, 1, 0.1, 0, 0.2, 0.6) },
  sheriff:  { weight: 1.4, recoil: R(3.0, 3.0, 1, 0.2, 0, 0.4, 0.5) },
  // SMGs: light, small climb
  stinger:  { weight: 2.4, recoil: R(0.18, 0.32, 6, 0.14, 0.9, 0.06, 0.35) },
  spectre:  { weight: 2.6, recoil: R(0.16, 0.28, 6, 0.12, 0.8, 0.05, 0.35) },
  // shotguns: big single kick
  bucky:    { weight: 3.2, recoil: R(3.2, 3.2, 1, 0.3, 0, 0.5, 0.5) },
  judge:    { weight: 4.0, recoil: R(2.4, 3.0, 3, 0.5, 1.1, 0.4, 0.4) },
  // rifles
  bulldog:  { weight: 3.7, recoil: R(0.35, 0.6, 6, 0.2, 0.7, 0.08, 0.3) },
  guardian: { weight: 4.0, recoil: R(1.1, 1.1, 1, 0.12, 0, 0.2, 0.5) },
  phantom:  { weight: 3.4, recoil: R(0.3, 0.5, 8, 0.18, 0.7, 0.07, 0.3) },  // easy
  vandal:   { weight: 3.9, recoil: R(0.45, 0.85, 7, 0.35, 0.55, 0.15, 0.2) }, // hard, wide drift
  // snipers: one huge kick, heaviest rifles
  marshal:  { weight: 5.2, recoil: R(2.2, 2.2, 1, 0.1, 0, 0.3, 0.5) },
  outlaw:   { weight: 5.6, recoil: R(2.8, 2.8, 1, 0.15, 0, 0.35, 0.5) },
  operator: { weight: 6.8, recoil: R(2.6, 2.6, 1, 0.0, 0, 0.35, 0.5) },
  // machine guns: heaviest, long ramp, wild drift
  ares:     { weight: 7.0, recoil: R(0.3, 0.7, 14, 0.3, 0.6, 0.12, 0.2) },
  odin:     { weight: 9.5, recoil: R(0.35, 0.95, 20, 0.45, 0.5, 0.18, 0.15) },
  // melee
  knife:    { weight: 0.3 },
  fist:     { weight: 0 },
};

export const weightOf = (w) => (GUN_FEEL[w.id]?.weight ?? 3);
export const speedMult = (w) => Math.min(1.2, Math.max(0.7, BASE_SPEED_MULT - SPEED_PER_KG * weightOf(w)));
export const adsSpeedMult = (w) => Math.max(0.35, (w.scope ? 0.55 : 0.78) - 0.012 * weightOf(w));

const DEG = Math.PI / 180;
const FALLBACK = R(0.4, 0.6, 6, 0.2, 0.7, 0.1, 0.3);

function hash(s, i) {
  let x = Math.imul(s * 7919 + i * 104729 + 13, 0x9e3779b1);
  x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13;
  return ((x >>> 0) / 4294967295) * 2 - 1;
}
function seedOf(id) { let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) | 0; return Math.abs(s) % 997; }

// kick for bullet number i (0 = first of a spray): { up, right } radians
export function recoilKick(w, i, ctx) {
  const r = GUN_FEEL[w.id]?.recoil || FALLBACK;
  const seed = seedOf(w.id);
  const t = Math.min(1, i / r.ramp);
  const v = r.vMin + (r.vMax - r.vMin) * t * (2 - t);
  const wave = Math.sin(i * r.hFreq * 1.7 + seed);
  const h = r.hAmp * wave * Math.min(1, 0.3 + i / 4) + r.hJit * hash(seed, i);
  let m = 1;
  if (ctx.ads > 0.5) m *= 0.8;
  if (ctx.crouch) m *= 0.85;
  if (ctx.moving) m *= 1.1;
  if (ctx.air) m *= 1.4;
  return { up: v * m * DEG, right: h * m * DEG };
}

// bloom per bullet: auto guns bloom, semi guns a little, snipers/shotguns not at all
function bloomOf(w) {
  if (w.scope || w.pellets > 1) return { perShot: 0, max: 0, decay: 1 };
  return w.auto ? { perShot: 0.0032, max: 0.03, decay: 0.08 } : { perShot: 0.004, max: 0.02, decay: 0.1 };
}

export class Recoil {
  constructor() { this.reset(); }
  reset() { this.shot = 0; this.lastShot = 0; this.pendUp = 0; this.pendRight = 0; this.accUp = 0; this.bloom = 0; this.floor = null; }
  // call once per bullet (after it left the barrel): queues the kick
  kick(w, cdMs, ctx, now) {
    if (now - this.lastShot > Math.max(250, cdMs * 2.2)) this.shot = 0; // spray restarts after a pause
    const k = recoilKick(w, this.shot, ctx);
    this.shot++; this.lastShot = now;
    this.pendUp += k.up; this.pendRight += k.right; this.accUp += k.up; this.floor = null;
    const b = bloomOf(w);
    this.bloom = Math.min(b.max, this.bloom + b.perShot);
    return k;
  }
  // the player pulling the mouse down cancels stored climb, so recovery never drags the view under the start
  compensate(downRad) { if (downRad > 0) this.accUp = Math.max(0, this.accUp - downRad); }
  // per frame: returns { dPitch, dYaw } to add to the real aim (+pitch up, +yaw = turn left)
  update(w, cdMs, dt, now) {
    const f = 1 - Math.exp(-28 * dt);
    const up = this.pendUp * f, rt = this.pendRight * f;
    this.pendUp -= up; this.pendRight -= rt;
    let dPitch = up, dYaw = -rt;
    if (w) {
      this.bloom = Math.max(0, this.bloom - bloomOf(w).decay * dt);
      const rec = (GUN_FEEL[w.id]?.recoil || FALLBACK).recover;
      if (now - this.lastShot > Math.max(120, cdMs * 1.6) && this.accUp > 0 && rec > 0) {
        if (this.floor == null) this.floor = this.accUp * (1 - rec);
        const down = Math.max(0, this.accUp - this.floor) * (1 - Math.exp(-5 * dt));
        this.accUp -= down; dPitch -= down;
      }
    }
    return { dPitch, dYaw };
  }
}
