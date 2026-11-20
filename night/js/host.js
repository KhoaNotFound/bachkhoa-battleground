import { CONFIG, nightLength, phaseOf, gameRate, FACULTIES } from './config.js';
import { generateTasks, taskView, checkTask, taskQuery, TASK_IDS, TASK_NAMES } from './tasks-logic.js';
import { intentOf, scoreClips } from './clips.js';
import { roomAt, wallBetween, findPath, randomPointIn, ROOMS, SPOTS, SPAWNS } from './map.js';
import { rayPlayer } from '../../js/avatar.js';

// "game-server" của chế độ đêm, chạy trong trình duyệt của chủ phòng (newmod.md mục 4).
// Có thẩm quyền với: đồng hồ game, pha, task và đáp án, tủ khoá, vật phẩm, súng, sống/chết, ma,
// kho clip + metadata, hàm điểm. Vị trí người chơi do client tự mô phỏng rồi gửi lên (bạn bè chơi
// co-op nên chấp nhận được; host vẫn tự kiểm tra tầm bắn, khoảng cách tương tác, điều kiện bắt).

const TICK = 1 / 20;
const GHOST_STATES = ['WANDER', 'LISTEN', 'APPROACH', 'TALK', 'LEAVE', 'HUNT', 'GRAB', 'DEAD'];
const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Host {
  // io: {emit(msg, reliable), sendTo(id, msg, reliable)}; world: CollisionWorld (đạn chạm tường)
  constructor({ io, world, cfg, roster, solo }) {
    this.io = io; this.world = world;
    this.cfg = cfg || { ...CONFIG };
    this.solo = !!solo;
    this.tGame = 0; this.speed = 1;  // tua nhanh (debug)
    this.phase = 1;
    this.tasks = generateTasks(Math.random);
    this.power = false; this.cabinetOpen = false;
    this.items = []; this.itemSeq = 1;
    this.clips = new Map();
    this.ghosts = []; this.ghostSeq = 1; this.lastSpawn = -999; this.respawnBlock = [];
    this.lastPick = null;   // top-3 lần chọn gần nhất (debug)
    this.ended = null;
    this.noises = [];
    this.timeReal = 0;
    this.players = new Map();
    roster.forEach((r, k) => {
      const [sx, sz] = SPAWNS[k % SPAWNS.length];
      this.players.set(r.id, {
        id: r.id, name: r.name, fac: r.fac, color: r.color,
        x: sx, y: 0, z: sz, yaw: Math.PI, pitch: 0, crouch: false, flash: true, spd: 0,
        alive: true, task: null, aloneSince: 0, hasKey: false, gun: 0, weapon: 0,
        stat: { n: 0, moveN: 0, speedSum: 0, flashOn: 0, crouchN: 0 }, lastStat: 0,
      });
    });
    this.dbgSubs = new Set();
    // dt theo đồng hồ thật: setInterval có thể bị trễ khi máy chủ phòng đang render nặng
    this.lastT = performance.now();
    this.timer = setInterval(() => { const t = performance.now(); const dt = Math.min(1, (t - this.lastT) / 1000); this.lastT = t; this.tick(dt); }, TICK * 1000);
    this.dbgTimer = setInterval(() => this.sendDebug(), 500);
  }
  stop() { clearInterval(this.timer); clearInterval(this.dbgTimer); }
  get nowSec() { return this.timeReal; }

  // ================================================================= tin nhắn từ client
  onMessage(from, m) {
    const p = this.players.get(from);
    if (!p) return;
    switch (m.t) {
      case 'st': {
        if (!p.alive) return;
        p.x = +m.x || 0; p.y = +m.y || 0; p.z = +m.z || 0; p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0;
        p.crouch = !!m.cr; p.flash = !!m.fl; p.spd = +m.spd || 0; p.weapon = m.w | 0;
        return;
      }
      case 'act': return this.onAction(p, m);
      case 'clipm': return this.onClipMeta(p, m);
      case 'clipt': return this.onClipText(p, m);
      case 'dbg': if (m.on) this.dbgSubs.add(from); else this.dbgSubs.delete(from); return;
      case 'ff': this.speed = Math.max(1, Math.min(60, +m.speed || 1)); if (m.jump) this.tGame = Math.min(nightLength(this.cfg) - 1, this.tGame + m.jump); return;
    }
  }

  onAction(p, m) {
    if (this.ended) return;
    const reply = (msg) => this.io.sendTo(p.id, msg, true);
    if (!p.alive) return;
    const near = (spot, r = 2.6) => Math.hypot(p.x - spot.x, p.z - spot.z) < r;
    switch (m.a) {
      case 'task_open': {
        const st = this.tasks[m.task];
        if (!st || !near(SPOTS[m.task])) return;
        if (st.done) return reply({ t: 'toast', text: `Task ${TASK_NAMES[m.task]} đã xong.` });
        if (st.lockUntil > this.nowSec) return reply({ t: 'toast', text: `Chưa dùng được, chờ ${Math.ceil(st.lockUntil - this.nowSec)} giây.` });
        p.task = m.task;
        return reply({ t: 'task', view: taskView(st, FACULTIES.find((f) => f.id === p.fac)?.task === m.task) });
      }
      case 'task_close': p.task = null; return;
      case 'task_q': {
        const st = this.tasks[m.task];
        if (!st || p.task !== m.task) return;
        const r = taskQuery(st, m.q || {}, FACULTIES.find((f) => f.id === p.fac)?.task === m.task);
        return reply({ t: 'task_r', task: m.task, q: m.q, r });
      }
      case 'task_submit': {
        const st = this.tasks[m.task];
        if (!st || st.done || p.task !== m.task) return;
        if (st.lockUntil > this.nowSec) return;
        const r = checkTask(st, m.ans);
        if (r.ok) {
          st.done = true; p.task = null;
          if (m.task === 'ee') this.power = true;
          this.io.emit({ t: 'ev', e: 'task_done', task: m.task, by: p.id, power: this.power }, true);
          reply({ t: 'task_result', task: m.task, ok: true });
        } else {
          reply({ t: 'task_result', task: m.task, ok: false, why: r.why, soft: !!r.soft });
          if (!r.soft) this.taskFail(p, m.task);
        }
        return;
      }
      case 'cabinet': {
        if (!near(SPOTS.cabinet, 2.4)) return;
        if (!this.power) return reply({ t: 'toast', text: 'Tủ khoá điện tử không có điện.' });
        if (this.cabinetOpen) return;
        this.cabinetOpen = true;
        const c = SPOTS.cabinet;
        this.items.push({ id: this.itemSeq++, kind: 'key', x: c.x - 0.35, y: 1.25, z: c.z - 0.3 });
        this.items.push({ id: this.itemSeq++, kind: 'gun', x: c.x - 0.35, y: 0.85, z: c.z + 0.25, ammo: this.cfg.AMMO });
        this.io.emit({ t: 'ev', e: 'cabinet', by: p.id }, true);
        this.emitItems();
        return;
      }
      case 'pick': {
        const it = this.items.find((i) => i.id === m.id);
        if (!it || Math.hypot(p.x - it.x, p.z - it.z) > 2.6) return;
        this.items = this.items.filter((i) => i !== it);
        if (it.kind === 'key') p.hasKey = true; else p.gun = it.ammo;
        this.io.emit({ t: 'ev', e: 'pick', by: p.id, kind: it.kind, ammo: it.ammo }, true);
        this.emitItems();
        return;
      }
      case 'shoot': return this.onShoot(p, m);
      case 'gate': {
        if (!near(SPOTS.gate, 4.5)) return;
        const left = TASK_IDS.filter((t) => !this.tasks[t].done);
        if (!p.hasKey) return reply({ t: 'toast', text: 'Cổng khoá. Cần chìa khoá cổng.' });
        if (left.length) return reply({ t: 'toast', text: 'Chưa xong task: ' + left.map((t) => TASK_NAMES[t]).join(', ') });
        return this.end(true, `${p.name} mở cổng lúc ${this.clock()}. Kịp giờ bảo vệ đồ án!`);
      }
    }
  }

  taskFail(p, task) {
    const st = this.tasks[task];
    const spot = SPOTS[task];
    let radius = this.cfg.NOISE_RADIUS, sound = 'clang';
    if (task === 'ee') { radius *= 2; sound = 'short'; }
    if (task === 'cs') { st.lockUntil = this.nowSec + this.cfg.TASK_WRONG_LOCK; sound = 'reboot'; radius = 0; }
    if (task === 'ch') { st.lockUntil = this.nowSec + this.cfg.TASK_WRONG_LOCK; sound = 'smoke'; }
    if (task === 'me') sound = 'screech';
    if (task === 'ce') sound = 'collapse';
    p.task = null;
    this.io.emit({ t: 'ev', e: 'noise', task, x: spot.x, z: spot.z, radius, sound, lock: st.lockUntil > this.nowSec ? this.cfg.TASK_WRONG_LOCK : 0 }, true);
    if (radius > 0 && this.phase >= 2) {
      for (const g of this.ghosts) if (g.state !== 'DEAD' && g.state !== 'GRAB' && Math.hypot(g.x - spot.x, g.z - spot.z) < radius) this.setGhost(g, 'APPROACH', { target: p.id });
    }
  }

  onShoot(p, m) {
    if (p.gun <= 0 || p.weapon !== 1) return;
    p.gun--;
    const o = { x: +m.o[0], y: +m.o[1], z: +m.o[2] };
    let d = { x: +m.d[0], y: +m.d[1], z: +m.d[2] };
    const L = Math.hypot(d.x, d.y, d.z) || 1; d = { x: d.x / L, y: d.y / L, z: d.z / L };
    // gốc bắn phải gần người bắn
    if (Math.hypot(o.x - p.x, o.z - p.z) > 1.5) return;
    let maxT = this.cfg.SHOOT_RANGE;
    const w = this.world.raycast(o, d, maxT, (b) => b.bullet);
    if (w) maxT = w.t;
    let hit = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const r = rayPlayer(o, d, q, q.yaw, q.crouch, maxT);
      if (r && (!hit || r.t < hit.t)) hit = { t: r.t, kind: 'player', who: q };
    }
    for (const g of this.ghosts) {
      if (g.state === 'DEAD') continue;
      const r = rayPlayer(o, d, { x: g.x, y: 0, z: g.z }, g.yaw, g.crouch, maxT);
      if (r && (!hit || r.t < hit.t)) hit = { t: r.t, kind: 'ghost', who: g };
    }
    const t = hit ? hit.t : maxT;
    this.io.emit({ t: 'ev', e: 'shot', by: p.id, o: m.o, end: [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t], ammo: p.gun, hit: hit ? hit.kind : null }, true);
    if (hit?.kind === 'player') this.kill(hit.who, 'shot', p.id);
    if (hit?.kind === 'ghost') {
      const g = hit.who;
      this.io.emit({ t: 'ev', e: 'ghost_dead', g: g.id, x: g.x, z: g.z }, true);
      this.setGhost(g, 'DEAD');
      g.removeAt = this.nowSec + 1.5;
      this.respawnBlock.push(this.nowSec + this.cfg.GHOST_RESPAWN);
    }
  }

  kill(p, cause, by) {
    if (!p.alive) return;
    p.alive = false; p.task = null;
    if (p.hasKey) { this.items.push({ id: this.itemSeq++, kind: 'key', x: p.x, y: 0.1, z: p.z + 0.3 }); p.hasKey = false; }
    if (p.gun > 0) { this.items.push({ id: this.itemSeq++, kind: 'gun', x: p.x + 0.3, y: 0.1, z: p.z, ammo: p.gun }); }
    p.gun = 0;
    this.io.emit({ t: 'ev', e: 'death', who: p.id, cause, by, x: p.x, z: p.z }, true);
    this.emitItems();
    if (![...this.players.values()].some((q) => q.alive)) this.end(false, 'Cả nhóm đã chết. Không ai kịp bảo vệ đồ án.');
  }
  playerLeft(id) {
    const p = this.players.get(id);
    if (p && p.alive) this.kill(p, 'left');
  }
  emitItems() { this.io.emit({ t: 'items', items: this.items, cabinet: this.cabinetOpen, power: this.power }, true); }
  clock() { const m = (22 * 60 + Math.floor(this.tGame)) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  end(win, text) {
    if (this.ended) return;
    this.ended = { win, text };
    this.io.emit({ t: 'end', win, text }, true);
  }

  // ================================================================= clip giọng
  onClipMeta(p, m) {
    if (!p.alive) return;                      // người chết bị tắt mic, bỏ qua clip
    if (this.clips.has(m.id) || !String(m.id).startsWith(p.id + ':')) return;
    const nearby = [...this.players.values()].filter((q) => q !== p && q.alive && dist2(q, p) < this.cfg.R_HEAR).map((q) => q.id);
    const heard = this.ghosts.some((g) => g.state !== 'DEAD' && dist2(g, p) < this.cfg.R_HEAR);
    const c = {
      id: m.id, speaker: p.id, tGame: this.tGame, room: roomAt(p.x, p.z), task: p.task,
      nearby, heardByGhost: !!m.dodge || heard, dodge: !!m.dodge, dur: +m.dur || 0,
      text: m.dodge ? String(m.text || '') : null, emb: null, intent: m.dodge ? intentOf(m.text) : null, lastUsedAt: null,
      pos: { x: p.x, z: p.z },
    };
    this.clips.set(c.id, c);
  }
  onClipText(p, m) {
    const c = this.clips.get(m.id);
    if (!c || c.speaker !== p.id) return;
    c.text = String(m.text || '').slice(0, 300);
    c.emb = Array.isArray(m.emb) ? Float32Array.from(m.emb) : null;
    if (!c.dodge) c.intent = intentOf(c.text);
    if (c.dodge || !c.text.trim()) return;
    // ma bị hỏi: người chơi nói trong R_HEAR của ma đang APPROACH/TALK
    for (const g of this.ghosts) {
      if ((g.state === 'APPROACH' || g.state === 'TALK') && Math.hypot(g.x - c.pos.x, g.z - c.pos.z) < this.cfg.R_HEAR && this.phase >= 2) {
        if (g.pendingSay) continue;
        this.ghostSpeak(g, { q: c, listener: p.id });
        if (g.state === 'APPROACH' && dist2(g, p) < 8) this.setGhost(g, 'TALK', { target: p.id });
        if (g.state === 'TALK') g.turns--;
      }
    }
  }
  clipsOf(speaker) { const out = []; for (const c of this.clips.values()) if (c.speaker === speaker) out.push(c); return out; }
  // chọn clip theo hàm điểm (8.4); không đạt ngưỡng thì phát clip né
  chooseClip(g, { q, needIntents, listener }) {
    const all = this.clipsOf(g.imp);
    const scored = scoreClips(this.cfg, all, {
      q, needIntents: needIntents || [], ghostRoom: roomAt(g.x, g.z), ghostTask: null, listener,
      tGame: this.tGame, nowSec: this.nowSec,
    });
    let chosen = scored[0] && scored[0].S >= this.cfg.SCORE_THRESHOLD ? scored[0].clip : null;
    let dodge = false;
    if (!chosen) {
      const dodges = all.filter((c) => c.dodge);
      chosen = dodges.length ? pick(dodges) : null;
      dodge = true;
    }
    this.lastPick = {
      ghost: g.id, imp: g.imp, q: q ? q.text : `(chủ động: ${(needIntents || []).join('/')})`,
      top: scored.slice(0, 3).map((s) => ({ id: s.clip.id, text: s.clip.text, S: +s.S.toFixed(3), ...Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, +v.toFixed(2)])) })),
      chosen: chosen ? chosen.id : null, dodge, at: this.clock(),
    };
    return chosen;
  }
  ghostSpeak(g, opts) {
    const c = this.chooseClip(g, opts);
    if (!c) return;
    g.pendingSay = true;
    const delay = rnd(0.4, 1.2);
    setTimeout(() => {
      g.pendingSay = false;
      if (g.state === 'DEAD' || this.ended) return;
      c.lastUsedAt = this.nowSec;
      g.lastSayAt = this.nowSec;
      this.io.emit({ t: 'gsay', g: g.id, clip: c.id, spk: c.speaker, dur: c.dur }, true);
    }, delay * 1000);
  }

  // ================================================================= ma
  setGhost(g, state, extra = {}) {
    g.state = state; g.stateT = 0; Object.assign(g, extra);
    g.path = null; g.repath = 0;
    if (state === 'TALK') { g.turns = 1 + Math.floor(Math.random() * 3); g.saidOpen = false; }
    if (state === 'LISTEN') g.listenFor = rnd(12, 28);
    if (state === 'HUNT') g.lookT = 0;
  }
  alivePlayers() { return [...this.players.values()].filter((p) => p.alive); }
  seenByAny(x, z, maxD = 22) {
    for (const p of this.alivePlayers()) { const d = Math.hypot(p.x - x, p.z - z); if (d < maxD && !wallBetween(p.x, p.z, x, z)) return true; }
    return false;
  }
  hiddenPoint(near, minD, maxD) {
    const rooms = Object.keys(ROOMS).filter((r) => r !== 'yard');
    for (let k = 0; k < 60; k++) {
      const pt = randomPointIn(pick(rooms));
      const d = near ? Math.hypot(pt.x - near.x, pt.z - near.z) : 30;
      if (near && (d < minD || d > maxD)) continue;
      if (this.alivePlayers().some((p) => Math.hypot(p.x - pt.x, p.z - pt.z) < 10)) continue;
      if (this.seenByAny(pt.x, pt.z, 40)) continue;
      return pt;
    }
    return null;
  }
  spawnGhost() {
    const alive = this.alivePlayers();
    if (!alive.length) return;
    const pt = this.hiddenPoint(null);
    if (!pt) return;
    // ai bị giả dạng: ưu tiên người đã chết (chiến thuật 4), đôi khi là đồng đội đang đứng gần người đi lẻ (chiến thuật 2)
    const all = [...this.players.values()];
    const dead = all.filter((p) => !p.alive);
    let imp;
    if (this.solo) imp = all[0].id;
    else if (dead.length && Math.random() < 0.5) imp = pick(dead).id;
    else {
      const lone = this.loneliest();
      const others = all.filter((p) => !lone || p.id !== lone.id);
      imp = pick(others.length ? others : all).id;
    }
    const st = this.players.get(imp).stat;
    const g = {
      id: this.ghostSeq++, imp, x: pt.x, z: pt.z, yaw: 0, crouch: false, flash: true,
      speed: st.moveN > 20 ? Math.max(2.2, Math.min(5, st.speedSum / st.moveN)) : this.cfg.GHOST_SPEED,
      flashP: st.n > 20 ? st.flashOn / st.n : 0.85, crouchP: st.n > 20 ? st.crouchN / st.n : 0.05,
      state: 'WANDER', stateT: 0, path: null, target: null, turns: 0, lookT: 0, pendingSay: false, habitT: 0,
    };
    this.ghosts.push(g);
    this.lastSpawn = this.nowSec;
  }
  loneliest() {
    let best = null;
    for (const p of this.alivePlayers()) if (p.aloneSince != null && (!best || p.aloneSince < best.aloneSince)) best = p;
    return best;
  }
  aloneFor(p) { return p.aloneSince == null ? 0 : this.nowSec - p.aloneSince; }
  walk(g, tx, tz, dt, speedMul = 1) {
    if (!g.path || g.repath <= 0 || !g.goal || Math.hypot(g.goal.x - tx, g.goal.z - tz) > 1.5) {
      g.path = findPath(g.x, g.z, tx, tz) || [[g.x, g.z], [tx, tz]];
      g.pi = 1; g.goal = { x: tx, z: tz }; g.repath = 1.0;
    }
    g.repath -= dt;
    let step = g.speed * speedMul * dt;
    while (step > 0 && g.pi < g.path.length) {
      const [px, pz] = g.path[g.pi];
      const dx = px - g.x, dz = pz - g.z, d = Math.hypot(dx, dz);
      if (d < 1e-3) { g.pi++; continue; }
      const s = Math.min(step, d);
      g.x += (dx / d) * s; g.z += (dz / d) * s;
      g.yaw = Math.atan2(-dx, -dz);
      step -= s; g.moving = true;
      if (s >= d) g.pi++;
    }
    return g.pi >= g.path.length;
  }
  face(g, p) { g.yaw = Math.atan2(-(p.x - g.x), -(p.z - g.z)); }
  // góc giữa hướng nhìn của người chơi và vector người chơi -> ma (độ)
  angleFrom(p, g) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz) || 1;
    return (Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / d))) * 180) / Math.PI;
  }
  canGrab(g, p) {
    return this.phase >= 3 && p.alive && this.aloneFor(p) >= this.cfg.T_ALONE && this.angleFrom(p, g) > this.cfg.BEHIND_ANGLE && dist2(g, p) < this.cfg.GRAB_DIST;
  }
  updateGhost(g, dt) {
    g.stateT += dt; g.moving = false;
    // thói quen đèn pin / cúi người của người bị giả dạng
    g.habitT -= dt;
    if (g.habitT <= 0) { g.habitT = rnd(6, 14); g.flash = Math.random() < g.flashP; g.crouch = Math.random() < g.crouchP; }
    const alive = this.alivePlayers();
    const near = alive.filter((p) => dist2(p, g) < this.cfg.R_HEAR);
    const tgt = g.target ? this.players.get(g.target) : null;
    const loneTarget = () => {
      const c = alive.filter((p) => this.solo || p.aloneSince != null).sort((a, b) => a.aloneSince - b.aloneSince);  // chiến thuật 3
      return c[0] || null;
    };
    switch (g.state) {
      case 'WANDER': {
        if (!g.dest || this.walk(g, g.dest.x, g.dest.z, dt, 0.8)) {
          // ưu tiên đi ngang qua tầm nhìn người chơi từ xa
          const p = pick(alive);
          g.dest = (p && this.hiddenPoint(p, 12, 30)) || randomPointIn(pick(Object.keys(ROOMS).filter((r) => r !== 'yard')));
          g.path = null;
        }
        if (this.phase >= 2) {
          const lt = loneTarget();
          if (lt && g.stateT > 4) { this.setGhost(g, 'APPROACH', { target: lt.id }); break; }
        }
        if (near.length && g.stateT > 3) this.setGhost(g, 'LISTEN', { target: near[0].id });
        break;
      }
      case 'LISTEN': {
        // đứng khuất gần người chơi để "nghe"
        if (!tgt || !tgt.alive) { this.setGhost(g, 'WANDER'); break; }
        if (!g.spot || g.stateT % 6 < dt) g.spot = this.hiddenPoint(tgt, 8, this.cfg.R_HEAR - 3) || g.spot;
        if (g.spot) this.walk(g, g.spot.x, g.spot.z, dt, 0.6);
        if (dist2(g, tgt) > this.cfg.R_HEAR + 6) g.spot = null;
        if (this.phase >= 2 && (this.solo || tgt.aloneSince != null)) { this.setGhost(g, 'APPROACH', { target: tgt.id }); break; }
        if (g.stateT > g.listenFor) this.setGhost(g, 'WANDER');
        break;
      }
      case 'APPROACH': {
        if (this.phase < 2 || !tgt || !tgt.alive) { this.setGhost(g, 'LEAVE'); break; }
        this.walk(g, tgt.x, tgt.z, dt, 0.9);
        if (dist2(g, tgt) < this.cfg.TALK_DIST) this.setGhost(g, 'TALK', { target: tgt.id });
        if (g.stateT > 60) this.setGhost(g, 'LEAVE');
        break;
      }
      case 'TALK': {
        if (!tgt || !tgt.alive) { this.setGhost(g, 'LEAVE'); break; }
        this.face(g, tgt);
        if (dist2(g, tgt) > this.cfg.TALK_DIST + 1.5) this.walk(g, tgt.x, tgt.z, dt, 0.7);
        if (!g.saidOpen && g.stateT > 0.8) {
          g.saidOpen = true;
          // bắt chuyện: hỏi tiến độ / gọi; đôi khi báo sai tiến độ (chiến thuật 5)
          const intents = Math.random() < 0.25 ? ['report_progress'] : ['ask_progress', 'call'];
          this.ghostSpeak(g, { needIntents: intents, listener: tgt.id });
        }
        if (this.phase >= 3 && this.aloneFor(tgt) >= this.cfg.T_ALONE && g.stateT > 4) { this.setGhost(g, 'HUNT', { target: tgt.id }); break; }
        if (g.turns <= 0 && !g.pendingSay && g.stateT > 3) { this.setGhost(g, 'LEAVE', { lure: Math.random() < 0.3 ? tgt.id : null }); break; }
        if (g.stateT > 14) this.setGhost(g, 'LEAVE', { lure: Math.random() < 0.3 ? tgt.id : null });
        break;
      }
      case 'LEAVE': {
        if (!g.dest || g.stateT < dt * 1.5) g.dest = this.hiddenPoint(g, 10, 40) || randomPointIn('auditorium');
        const arrived = this.walk(g, g.dest.x, g.dest.z, dt, 1);
        // chiến thuật 1: gọi người chơi tới phòng vắng bằng clip "call" rồi chờ ở đó
        if (g.lure && arrived && !g.lureCalled) {
          g.lureCalled = true;
          const p = this.players.get(g.lure);
          if (p && p.alive) this.ghostSpeak(g, { needIntents: ['call'], listener: p.id });
        }
        if (arrived && (!g.lure || g.stateT > 25)) { g.lure = null; g.lureCalled = false; this.setGhost(g, 'WANDER'); }
        if (g.lure && this.phase >= 3) { const p = this.players.get(g.lure); if (p && p.alive && dist2(p, g) < 6) this.setGhost(g, 'HUNT', { target: p.id, lure: null }); }
        break;
      }
      case 'HUNT': {
        if (this.phase < 3 || !tgt || !tgt.alive) { this.setGhost(g, 'LEAVE'); break; }
        // bám phía sau
        const bx = tgt.x + Math.sin(tgt.yaw) * 1.1, bz = tgt.z + Math.cos(tgt.yaw) * 1.1;
        this.walk(g, bx, bz, dt, dist2(g, tgt) > 4 ? 1.1 : 0.9);
        const looking = this.angleFrom(tgt, g) < 25 && dist2(g, tgt) < 15 && !wallBetween(tgt.x, tgt.z, g.x, g.z);
        g.lookT = looking ? g.lookT + dt : Math.max(0, g.lookT - dt * 0.5);
        const helper = alive.some((q) => q !== tgt && dist2(q, tgt) < this.cfg.R_HEAR);
        if (g.lookT > this.cfg.LOOK_AT_LEAVE || (helper && !this.solo)) { this.setGhost(g, 'LEAVE'); break; }
        if (this.canGrab(g, tgt)) { this.setGhost(g, 'GRAB', { target: tgt.id }); this.io.emit({ t: 'ev', e: 'grab', g: g.id, who: tgt.id }, true); }
        if (g.stateT > 90) this.setGhost(g, 'LEAVE');
        break;
      }
      case 'GRAB': {
        if (tgt) this.face(g, tgt);
        if (g.stateT >= 1.0) {
          if (tgt) this.kill(tgt, 'ghost', g.id);
          if (tgt) g.imp = tgt.id;  // giả dạng người vừa chết
          this.setGhost(g, 'LEAVE');
        }
        break;
      }
      case 'DEAD': break;
    }
  }

  // ================================================================= vòng lặp
  tick(dt) {
    if (this.ended) { this.broadcastSnap(); return; }
    this.timeReal += dt;
    this.tGame += dt * gameRate(this.cfg) * this.speed;
    const ph = phaseOf(this.cfg, this.tGame);
    if (ph !== this.phase) { this.phase = ph; this.io.emit({ t: 'ev', e: 'phase', phase: ph }, true); }
    if (this.tGame >= nightLength(this.cfg)) { this.end(false, '08:00 rồi mà chưa ra được cổng. Hẹn gặp lại năm sau!'); return; }
    const alive = this.alivePlayers();
    // đi lẻ: không có người sống nào khác trong R_HEAR
    for (const p of alive) {
      const alone = !alive.some((q) => q !== p && dist2(q, p) < this.cfg.R_HEAR);
      if (alone && p.aloneSince == null) p.aloneSince = this.nowSec;
      if (!alone) p.aloneSince = null;
      // thống kê dáng đi mỗi giây (cho ngoại hình ma)
      if (this.nowSec - p.lastStat >= 1) {
        p.lastStat = this.nowSec; const s = p.stat; s.n++;
        if (p.spd > 0.5) { s.moveN++; s.speedSum += p.spd; }
        if (p.flash) s.flashOn++;
        if (p.crouch) s.crouchN++;
      }
    }
    // sinh ma
    this.respawnBlock = this.respawnBlock.filter((t) => t > this.nowSec);
    const live = this.ghosts.filter((g) => g.state !== 'DEAD');
    const cap = this.cfg.MAX_GHOSTS[ph - 1] - this.respawnBlock.length;
    const someoneAlone = this.solo || alive.some((p) => p.aloneSince != null && this.aloneFor(p) > 5);
    if (live.length < cap && someoneAlone && this.nowSec - this.lastSpawn > 12 && this.nowSec > 20) this.spawnGhost();
    for (const g of this.ghosts) this.updateGhost(g, dt);
    this.ghosts = this.ghosts.filter((g) => !(g.state === 'DEAD' && this.nowSec > g.removeAt));
    this.broadcastSnap();
  }
  broadcastSnap() {
    const ps = [];
    for (const p of this.players.values()) ps.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.crouch ? 1 : 0, p.flash ? 1 : 0, p.alive ? 1 : 0, p.weapon, +p.spd.toFixed(1), p.hasKey ? 1 : 0, p.gun]);
    const gs = this.ghosts.map((g) => [g.id, g.imp, +g.x.toFixed(2), +g.z.toFixed(2), +g.yaw.toFixed(3), g.crouch ? 1 : 0, g.flash ? 1 : 0, g.state === 'DEAD' ? 0 : g.state === 'GRAB' ? 2 : 1, g.moving ? +(g.speed).toFixed(1) : 0]);
    const tasks = TASK_IDS.filter((t) => this.tasks[t].done);
    const locks = {};
    for (const t of TASK_IDS) if (this.tasks[t].lockUntil > this.nowSec) locks[t] = Math.ceil(this.tasks[t].lockUntil - this.nowSec);
    this.io.emit({ t: 'snap', tg: +this.tGame.toFixed(2), ph: this.phase, ps, gs, done: tasks, locks, power: this.power ? 1 : 0 }, false);
  }
  sendDebug() {
    if (!this.dbgSubs.size) return;
    const clips = [...this.clips.values()].slice(-40).map((c) => ({ id: c.id, spk: this.players.get(c.speaker)?.name, text: c.text, intent: c.intent, heard: c.heardByGhost, dodge: c.dodge, room: c.room, task: c.task, t: +c.tGame.toFixed(1), used: c.lastUsedAt != null }));
    const msg = {
      t: 'dbg', clock: this.clock(), phase: this.phase, speed: this.speed, solo: this.solo,
      ghosts: this.ghosts.map((g) => ({ id: g.id, state: g.state, imp: this.players.get(g.imp)?.name, target: g.target ? this.players.get(g.target)?.name : null, x: +g.x.toFixed(1), z: +g.z.toFixed(1), room: roomAt(g.x, g.z), speed: +g.speed.toFixed(2), flashP: +g.flashP.toFixed(2) })),
      players: [...this.players.values()].map((p) => ({ name: p.name, alive: p.alive, alone: +this.aloneFor(p).toFixed(0), room: roomAt(p.x, p.z), task: p.task })),
      clips, nClips: this.clips.size, lastPick: this.lastPick,
    };
    for (const id of this.dbgSubs) this.io.sendTo(id, msg, true);
  }
}

export { GHOST_STATES };
