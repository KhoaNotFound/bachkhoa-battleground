import { CONFIG, nightLength, phaseOf, gameRate, FACULTIES } from './config.js';
import { generateTasks, taskView, checkTask, taskQuery, TASK_IDS, TASK_NAMES } from './tasks-logic.js';
import { intentOf, scoreClips } from './clips.js';
import { roomAt, wallBetween, findPath, randomPointIn, walkable, ROOMS, SPOTS, SPAWNS } from './map.js';
import { angleDiff, damp } from '../../js/util.js';
import { rayPlayer } from '../../js/avatar.js';

// "game-server" của chế độ đêm, chạy trong trình duyệt của chủ phòng (newmod.md mục 4).
// Có thẩm quyền với: đồng hồ game, pha, task và đáp án, tủ khoá, vật phẩm, súng, sống/chết, ma,
// kho clip + metadata, hàm điểm. Vị trí người chơi do client tự mô phỏng rồi gửi lên (bạn bè chơi
// co-op nên chấp nhận được; host vẫn tự kiểm tra tầm bắn, khoảng cách tương tác, điều kiện bắt).

const TICK = 1 / 20;
// tốc độ giống hệt người chơi (main.js): đi bộ / chạy / cúi
const GAIT = { walk: 4.0, run: 6.2, sneak: 2.0 };
const GHOST_STATES = ['LURK', 'GLIMPSE', 'APPROACH', 'TALK', 'LURE', 'LEAVE', 'GRAB', 'DEAD'];
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
        stat: { n: 0, moveN: 0, speedSum: 0, flashOn: 0, crouchN: 0, runN: 0, turnSum: 0, flips: 0 }, lastStat: 0, prevYaw: 0, prevFlash: true,
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
    // clip thu ở lobby: coi như ma đã nghe (trường nghe thấy hết từ trước khi vào trận)
    const lobby = !!m.lobby && String(m.id).startsWith(p.id + ':l');
    const c = {
      id: m.id, speaker: p.id, tGame: lobby ? 0 : this.tGame, room: lobby ? 'lobby' : roomAt(p.x, p.z), task: lobby ? null : p.task,
      nearby: lobby ? [...this.players.keys()].filter((k) => k !== p.id) : nearby, heardByGhost: !!m.dodge || lobby || heard, dodge: !!m.dodge, dur: +m.dur || 0,
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
      if ((g.state === 'APPROACH' || g.state === 'TALK' || g.state === 'LURE') && Math.hypot(g.x - c.pos.x, g.z - c.pos.z) < this.cfg.R_HEAR && this.phase >= 2) {
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
  // Ma không đứng sẵn trên bản đồ (kiểu "mimic" của MIMESIS). Ba cách xuất hiện:
  //  - LURK: nấp ngoài tầm nhìn của mọi người nhưng trong R_HEAR của một người để "nghe"
  //    (heard_by_ghost). Bị nhìn thấy thì lủi đi; nấp đủ lâu thì tan rồi xuất hiện chỗ khác.
  //  - GLIMPSE (pha 1): lướt qua xa xa một khoảnh khắc rồi khuất và tan.
  //  - Chạm mặt (pha >= 2, có người đi lẻ): APPROACH -> TALK (hỏi 1-2 câu, trả lời nếu bị hỏi)
  //    -> LURE (rủ đi, chạy như người tới chỗ vắng, chờ nếu người chơi tụt lại, gọi thêm)
  //    -> GRAB khi người chơi theo tới chỗ vắng mà không còn ai ở gần. Không theo thì LEAVE: đi khuất rồi tan.
  setGhost(g, state, extra = {}) {
    g.state = state; g.stateT = 0; Object.assign(g, extra);
    g.path = null; g.repath = 0;
    if (state === 'TALK') { g.turns = 1 + Math.floor(Math.random() * 2); g.saidOpen = false; }
    if (state === 'LURE') { g.dest = null; g.callT = 0; g.lostT = 0; }
    if (state === 'LEAVE' || state === 'LURK' || state === 'GLIMPSE') { g.dest = null; g.seenT = 0; }
  }
  alivePlayers() { return [...this.players.values()].filter((p) => p.alive); }
  seenByAny(x, z, maxD = 22) {
    for (const p of this.alivePlayers()) { const d = Math.hypot(p.x - x, p.z - z); if (d < maxD && !wallBetween(p.x, p.z, x, z)) return true; }
    return false;
  }
  hiddenPoint(near, minD, maxD, clear = 10) {
    const rooms = Object.keys(ROOMS).filter((r) => r !== 'yard');
    for (let k = 0; k < 80; k++) {
      const pt = randomPointIn(pick(rooms));
      const d = near ? Math.hypot(pt.x - near.x, pt.z - near.z) : 30;
      if (near && (d < minD || d > maxD)) continue;
      if (this.alivePlayers().some((p) => Math.hypot(p.x - pt.x, p.z - pt.z) < clear)) continue;
      if (this.seenByAny(pt.x, pt.z, 40)) continue;
      return pt;
    }
    return null;
  }
  // phòng vắng để dụ tới: không có người sống nào khác ở gần, càng xa những người khác càng tốt
  emptySpot(tgt, g) {
    const others = this.alivePlayers().filter((p) => p !== tgt);
    let best = null;
    for (const r of ['ee', 'ce', 'auditorium', 'guard', 'me', 'ch', 'cs', 'start']) {
      for (let k = 0; k < 3; k++) {
        const pt = randomPointIn(r);
        const dT = Math.hypot(pt.x - tgt.x, pt.z - tgt.z);
        if (dT < 10 || dT > 55 || roomAt(tgt.x, tgt.z) === r) continue;
        const far = others.length ? Math.min(...others.map((p) => Math.hypot(p.x - pt.x, p.z - pt.z))) : 99;
        if (far < this.cfg.R_HEAR) continue;
        const score = Math.min(far, 40) - Math.abs(dT - 25) * 0.5 + Math.random() * 6;
        if (!best || score > best.score) best = { x: pt.x, z: pt.z, room: r, score };
      }
    }
    return best;
  }
  impFor(target) {
    const all = [...this.players.values()];
    if (this.solo) return all[0].id;
    const dead = all.filter((p) => !p.alive);
    if (dead.length && Math.random() < 0.5) return pick(dead).id;      // giọng người đã chết (chiến thuật 4)
    const others = all.filter((p) => !target || p.id !== target.id);
    // ưu tiên người đang ở xa người bị nhắm, đỡ lộ hai bản giống nhau đứng cạnh nhau
    others.sort((a, b) => (target ? dist2(b, target) - dist2(a, target) : 0));
    return (Math.random() < 0.7 ? others[0] : pick(others.length ? others : all)).id;
  }
  spawnGhost(kind, target) {
    const pt = kind === 'GLIMPSE' ? this.hiddenPoint(target, 15, 30) : this.hiddenPoint(target, 10, this.cfg.R_HEAR - 2);
    if (!pt) return null;
    const imp = this.impFor(target);
    const st = this.players.get(imp).stat;
    const g = {
      id: this.ghostSeq++, imp, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, pitch: 0, crouch: false, flash: true,
      state: kind, stateT: 0, path: null, target: target ? target.id : null, turns: 0, pendingSay: false, habitT: 0,
      life: rnd(40, 90), seenT: 0, curSpeed: 0, swayPh: Math.random() * 10, glanceT: rnd(0.5, 2), lookOff: 0, lookPitch: 0, pauseT: 0, runT: 0,
    };
    this.applyHabits(g);
    this.setGhost(g, kind);
    if (kind === 'GLIMPSE') { g.dest = this.hiddenPoint(target, 12, 30); if (!g.dest) return null; }
    this.ghosts.push(g);
    this.lastSpawn = this.nowSec;
    return g;
  }
  // thói quen lấy từ thống kê của người bị giả dạng (ghi mỗi giây): đèn pin, cúi, chạy, tốc độ quay đầu
  applyHabits(g) {
    const st = this.players.get(g.imp).stat, ok = st.n > 20;
    g.flashP = ok ? st.flashOn / st.n : 0.85;
    g.crouchP = ok ? st.crouchN / st.n : 0.05;
    g.runP = st.moveN > 10 ? st.runN / st.moveN : 0.3;
    g.turnRate = ok ? st.turnSum / st.n : 1.2;                 // rad/s trung bình
    g.flipEvery = ok && st.flips ? Math.max(4, Math.min(60, st.n / st.flips)) : 20;  // giây giữa hai lần bật/tắt đèn
    g.speed = GAIT.walk;
  }
  aloneFor(p) { return p.aloneSince == null ? 0 : this.nowSec - p.aloneSince; }
  aloneNow(p) { return this.solo || !this.alivePlayers().some((q) => q !== p && dist2(q, p) < this.cfg.R_HEAR); }
  // Đi như người: đường đi bị xê dịch ngẫu nhiên (không đi thẳng tắp theo lưới), tốc độ theo dáng
  // đi/chạy/cúi của người chơi và có quán tính, lắc lư ngang theo bước, thỉnh thoảng khựng lại.
  walk(g, tx, tz, dt, speedMul = 1) {
    if (!g.path || g.repath <= 0 || !g.goal || Math.hypot(g.goal.x - tx, g.goal.z - tz) > 1.5) {
      g.path = findPath(g.x, g.z, tx, tz) || [[g.x, g.z], [tx, tz]];
      for (let k = 1; k < g.path.length - 1; k++) {
        const [x, z] = g.path[k], [px, pz] = g.path[k - 1], [nx, nz] = g.path[k + 1];
        const ox = x + (Math.random() - 0.5) * 1.2, oz = z + (Math.random() - 0.5) * 1.2;
        if (walkable(ox, oz) && !wallBetween(px, pz, ox, oz) && !wallBetween(ox, oz, nx, nz)) g.path[k] = [ox, oz];
      }
      g.pi = 1; g.goal = { x: tx, z: tz }; g.repath = rnd(0.8, 1.4);
    }
    g.repath -= dt;
    // dáng: chạy khi được yêu cầu nhanh hoặc theo thói quen hay chạy của người bị giả dạng
    g.runT -= dt;
    if (g.runT <= 0) { g.runT = rnd(2, 6); g.habitRun = Math.random() < g.runP; }
    let gait = speedMul >= 1.25 ? 'run' : speedMul <= 0.75 ? 'sneak' : (g.habitRun && speedMul >= 1 ? 'run' : 'walk');
    if (g.crouch && gait !== 'run') gait = 'sneak';
    if (gait === 'run') g.crouch = false;
    let want = GAIT[gait] * (1 + Math.sin(g.swayPh * 0.23) * 0.07);
    if (g.pauseT > 0) { g.pauseT -= dt; want = 0; }
    else if (gait !== 'run' && Math.random() < dt * 0.07) g.pauseT = rnd(0.25, 0.9);  // khựng lại, nhìn quanh
    g.curSpeed = damp(g.curSpeed || 0, want, want > g.curSpeed ? 7 : 10, dt);
    let step = g.curSpeed * dt;
    while (step > 1e-4 && g.pi < g.path.length) {
      const [px, pz] = g.path[g.pi];
      const dx = px - g.x, dz = pz - g.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { g.pi++; continue; }
      const s = Math.min(step, d);
      g.x += (dx / d) * s; g.z += (dz / d) * s;
      const my = Math.atan2(-dx, -dz);
      g.moveYaw = g.moveYaw == null ? my : g.moveYaw + angleDiff(g.moveYaw, my) * Math.min(1, dt * 9);
      step -= s; g.moving = true;
      if (s >= d) g.pi++;
    }
    // lắc lư ngang theo nhịp bước
    if (g.curSpeed > 0.3) {
      g.swayPh += dt * (2.2 + g.curSpeed * 0.9);
      const off = Math.sin(g.swayPh) * (0.05 + g.curSpeed * 0.012) + Math.sin(g.swayPh * 0.31) * 0.08;
      const dOff = off - (g.lastOff || 0); g.lastOff = off;
      const sx = Math.cos(g.moveYaw || 0) * dOff, sz = -Math.sin(g.moveYaw || 0) * dOff;
      if (walkable(g.x + sx, g.z + sz)) { g.x += sx; g.z += sz; }
    }
    return g.pi >= g.path.length && g.curSpeed < 0.8 ? true : g.pi >= g.path.length;
  }
  face(g, p) { g.focus = p; }
  // Hướng nhìn (camera) tách khỏi hướng đi: liếc nhanh sang hai bên / ra sau như người chơi xoay chuột,
  // tần suất theo tốc độ quay đầu trung bình của người bị giả dạng; khi nói chuyện thì nhìn người kia.
  updateLook(g, dt) {
    let base;
    if (g.focus) base = Math.atan2(-(g.focus.x - g.x), -(g.focus.z - g.z));
    else base = g.moveYaw ?? g.yaw;
    g.glanceT -= dt;
    if (g.glanceT <= 0) {
      const busy = Math.max(0.3, Math.min(3, g.turnRate || 1.2));
      if (g.lookOff !== 0 && Math.random() < 0.6) { g.lookOff = 0; g.glanceT = rnd(0.8, 3) / busy; }
      else {
        const r = Math.random();
        g.lookOff = g.focus ? (Math.random() - 0.5) * 0.5 : r < 0.12 ? Math.PI * (Math.random() < 0.5 ? 0.9 : -0.9) : (Math.random() < 0.5 ? 1 : -1) * rnd(0.4, 1.6);
        g.glanceT = rnd(0.3, 1.1);
      }
      g.lookPitch = g.focus ? rnd(-0.12, 0.05) : rnd(-0.35, 0.15);
    }
    const target = base + g.lookOff;
    const diff = angleDiff(g.yaw, target);
    const maxTurn = (g.focus ? 6 : 11) * dt;   // quay nhanh như rê chuột
    g.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff * Math.min(1, dt * 14)));
    g.pitch = damp(g.pitch || 0, g.lookPitch, 8, dt);
  }
  updateGhost(g, dt) {
    g.stateT += dt; g.moving = false;
    // thói quen đèn pin / cúi người của người bị giả dạng
    g.habitT -= dt;
    if (g.habitT <= 0) { g.habitT = rnd(0.5, 1.5) * g.flipEvery; g.flash = Math.random() < g.flashP; g.crouch = Math.random() < g.crouchP; }
    g.focus = null;
    const alive = this.alivePlayers();
    let tgt = g.target ? this.players.get(g.target) : null;
    const seen = this.seenByAny(g.x, g.z, 30);
    const R = this.cfg.R_HEAR;
    switch (g.state) {
      case 'LURK': {
        if (!tgt || !tgt.alive) { tgt = alive.sort((a, b) => dist2(a, g) - dist2(b, g))[0]; if (!tgt) break; g.target = tgt.id; }
        g.seenT = seen ? g.seenT + dt : Math.max(0, g.seenT - dt);
        if (!g.dest || seen || dist2(g, tgt) > R || (g.stateT % 8 < dt)) g.dest = this.hiddenPoint(tgt, 8, R - 3, 8) || g.dest;
        if (g.dest) this.walk(g, g.dest.x, g.dest.z, dt, seen ? 1.4 : 0.7);
        if (g.seenT > 2) { this.setGhost(g, 'LEAVE'); break; }
        if (g.stateT > g.life && !seen) { g.state = 'GONE'; break; }
        if (this.phase >= 2 && g.stateT > 5 && (this.solo || this.aloneFor(tgt) >= this.cfg.T_ALONE) && !this.ghosts.some((o) => o !== g && o.target === tgt.id && ['APPROACH', 'TALK', 'LURE', 'GRAB'].includes(o.state))) {
          this.setGhost(g, 'APPROACH', { target: tgt.id });
        }
        break;
      }
      case 'GLIMPSE': {
        const arrived = !g.dest || this.walk(g, g.dest.x, g.dest.z, dt, 1.25);
        if ((arrived || g.stateT > 25) && !seen) g.state = 'GONE';
        else if (arrived) g.dest = this.hiddenPoint(g, 6, 30, 6);
        break;
      }
      case 'APPROACH': {
        if (this.phase < 2 || !tgt || !tgt.alive || !this.aloneNow(tgt)) { this.setGhost(g, 'LEAVE'); break; }
        // chạy khi còn khuất, tới gần thì đi bộ như người bình thường
        this.walk(g, tgt.x, tgt.z, dt, seen ? 0.9 : 1.4);
        if (dist2(g, tgt) < this.cfg.TALK_DIST) this.setGhost(g, 'TALK', { target: tgt.id });
        if (g.stateT > 45) this.setGhost(g, 'LEAVE');
        break;
      }
      case 'TALK': {
        if (!tgt || !tgt.alive) { this.setGhost(g, 'LEAVE'); break; }
        this.face(g, tgt);
        if (dist2(g, tgt) > this.cfg.TALK_DIST + 1.5) this.walk(g, tgt.x, tgt.z, dt, 0.8);
        if (!g.saidOpen && g.stateT > 0.8) {
          g.saidOpen = true;
          // bắt chuyện: hỏi tiến độ; đôi khi báo sai tiến độ (chiến thuật 5)
          const intents = Math.random() < 0.25 ? ['report_progress'] : ['ask_progress', 'question'];
          this.ghostSpeak(g, { needIntents: intents, listener: tgt.id });
        }
        // hỏi xong (hoặc bị hỏi vặn) thì rủ đi luôn
        if (((g.turns <= 0 && g.stateT > 2.5) || g.stateT > 9) && !g.pendingSay) this.setGhost(g, 'LURE');
        break;
      }
      case 'LURE': {
        if (!tgt || !tgt.alive) { this.setGhost(g, 'LEAVE'); break; }
        if (!g.dest) {
          g.dest = this.emptySpot(tgt, g) || this.hiddenPoint(g, 10, 40, 6);
          if (!g.dest) { this.setGhost(g, 'LEAVE'); break; }
          this.ghostSpeak(g, { needIntents: ['call'], listener: tgt.id });  // "Ê, qua đây" (chiến thuật 1)
        }
        const dT = dist2(g, tgt), dD = Math.hypot(g.x - g.dest.x, g.z - g.dest.z);
        const arrived = dD < 1.2;
        g.callT += dt;
        if (!arrived && dT < 9) this.walk(g, g.dest.x, g.dest.z, dt, dT < 4 ? 1.5 : 1.1);  // bị bám sát thì chạy như người
        else {
          this.face(g, tgt);
          if (dT > 5 && g.callT > 7 && !g.pendingSay) { g.callT = 0; this.ghostSpeak(g, { needIntents: ['call'], listener: tgt.id }); }
        }
        g.lostT = dT > R ? g.lostT + dt : 0;
        if (g.lostT > 8 || g.stateT > 100) { this.setGhost(g, 'LEAVE'); break; }
        // người chơi theo tới chỗ vắng, không còn ai ở gần: bắt
        if (dD < 6 && dT < this.cfg.GRAB_DIST && this.phase >= this.cfg.LURE_KILL_PHASE && this.aloneNow(tgt)) {
          this.setGhost(g, 'GRAB', { target: tgt.id });
          this.io.emit({ t: 'ev', e: 'grab', g: g.id, who: tgt.id }, true);
        }
        break;
      }
      case 'LEAVE': {
        if (!g.dest) g.dest = this.hiddenPoint(g, 8, 40, 8) || randomPointIn('auditorium');
        const arrived = this.walk(g, g.dest.x, g.dest.z, dt, 1.3);
        if ((arrived || g.stateT > 25) && !seen) g.state = 'GONE';
        else if (arrived) g.dest = null;
        break;
      }
      case 'GRAB': {
        if (tgt) this.face(g, tgt);
        if (g.stateT >= 1.0) {
          if (tgt) { this.kill(tgt, 'ghost', g.id); g.imp = tgt.id; this.applyHabits(g); }  // giả dạng người vừa chết
          this.setGhost(g, 'LEAVE');
        }
        break;
      }
      case 'DEAD': break;
    }
    if (g.state !== 'DEAD') this.updateLook(g, dt);
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
        if (p.spd > 5) s.runN++;
        s.turnSum += Math.min(Math.PI, Math.abs(angleDiff(p.prevYaw, p.yaw)));  // rad quay trong 1 giây
        if (p.flash !== p.prevFlash) s.flips++;
        p.prevYaw = p.yaw; p.prevFlash = p.flash;
      }
    }
    // sinh ma: số ma tối đa theo pha, cộng thêm 1 cho mỗi người đã chết (như MIMESIS)
    this.respawnBlock = this.respawnBlock.filter((t) => t > this.nowSec);
    const live = this.ghosts.filter((g) => g.state !== 'DEAD');
    const deadN = [...this.players.values()].filter((p) => !p.alive).length;
    const cap = this.cfg.MAX_GHOSTS[ph - 1] + deadN - this.respawnBlock.length;
    if (live.length < cap && this.nowSec - this.lastSpawn > 10 && this.nowSec > 20 && alive.length) {
      // nhắm người đi lẻ lâu nhất (chiến thuật 3); không ai lẻ thì chỉ nấp nghe hoặc lướt qua
      const lone = alive.filter((p) => this.solo || p.aloneSince != null).sort((a, b) => a.aloneSince - b.aloneSince)[0];
      const target = lone || pick(alive);
      const kind = ph === 1 && Math.random() < 0.35 ? 'GLIMPSE' : 'LURK';
      if (lone || kind === 'GLIMPSE' || Math.random() < 0.5) this.spawnGhost(kind, target);
      else this.lastSpawn = this.nowSec;
    }
    for (const g of this.ghosts) this.updateGhost(g, dt);
    this.ghosts = this.ghosts.filter((g) => g.state !== 'GONE' && !(g.state === 'DEAD' && this.nowSec > g.removeAt));
    this.broadcastSnap();
  }
  broadcastSnap() {
    const ps = [];
    for (const p of this.players.values()) ps.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.crouch ? 1 : 0, p.flash ? 1 : 0, p.alive ? 1 : 0, p.weapon, +p.spd.toFixed(1), p.hasKey ? 1 : 0, p.gun]);
    const gs = this.ghosts.map((g) => [g.id, g.imp, +g.x.toFixed(2), +g.z.toFixed(2), +g.yaw.toFixed(3), g.crouch ? 1 : 0, g.flash ? 1 : 0, g.state === 'DEAD' ? 0 : g.state === 'GRAB' ? 2 : 1, +(g.curSpeed || 0).toFixed(1), +(g.pitch || 0).toFixed(2)]);
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
      ghosts: this.ghosts.map((g) => ({ id: g.id, state: g.state, imp: this.players.get(g.imp)?.name, target: g.target ? this.players.get(g.target)?.name : null, x: +g.x.toFixed(1), z: +g.z.toFixed(1), room: roomAt(g.x, g.z), speed: +(g.curSpeed || 0).toFixed(1), flashP: +g.flashP.toFixed(2), runP: +g.runP.toFixed(2), turn: +g.turnRate.toFixed(2) })),
      players: [...this.players.values()].map((p) => ({ name: p.name, alive: p.alive, alone: +this.aloneFor(p).toFixed(0), room: roomAt(p.x, p.z), task: p.task })),
      clips, nClips: this.clips.size, lastPick: this.lastPick,
    };
    for (const id of this.dbgSubs) this.io.sendTo(id, msg, true);
  }
}

export { GHOST_STATES };
