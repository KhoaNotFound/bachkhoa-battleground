import { escapeHtml } from './util.js';
import { BOUNDS } from './map.js';
import { getWeapon, WEAPON_SVGS } from './weapons.js';

const $ = (id) => document.getElementById(id);


export class HUD {
  constructor(minimapData) {
    this.el = {
      hud: $('hud'), hpFill: $('hpFill'), hpGhost: $('hpGhost'), hpText: $('hpText'),
      slot1: $('slot1'), slot2: $('slot2'), slot3: $('slot3'),
      slot1Icon: $('slot1Icon'), slot1Name: $('slot1Name'), ammoPrimary: $('ammoPrimary'),
      slot2Icon: $('slot2Icon'), slot2Name: $('slot2Name'), ammoSecondary: $('ammoSecondary'),
      slot3Icon: $('slot3Icon'), slot3Name: $('slot3Name'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      scope: $('scope'), rangeText: $('rangeText'), vignette: $('dmgVignette'), dirs: $('dmgDirs'),
      killfeed: $('killfeed'), center: $('centerMsg'), killBanner: $('killBanner'), stats: $('stats'), sb: $('scoreboard'), sbBody: $('sbBody'),
      reloadBar: $('reloadBar'), protect: $('protect'), minimap: $('minimap'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this.buildMapImage(minimapData);
    this.pings = [];
    this.initKillEffects();
  }
  initKillEffects() {
    this.killVideos = [];
    this.activeKillVideo = null;
    this.activeKillTier = 0;
    this.killRaf = 0;
    this.killCtx = this.el.killBanner ? this.el.killBanner.getContext('2d', { willReadFrequently: true }) : null;
    for (let i = 1; i <= 6; i++) {
      const v = document.createElement('video');
      v.src = `assets/killfx/kill_${i}.mp4`;
      v.preload = 'auto';
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.addEventListener('ended', () => {
        if (this.activeKillVideo === v) this.resetKillEffect();
      });
      this.killVideos.push(v);
    }
  }
  showKillEffect(streak, volume = 0.8, onFallbackAudio = null) {
    if (!this.el.killBanner || !this.killCtx) {
      if (onFallbackAudio) onFallbackAudio();
      return;
    }
    const tier = Math.max(1, Math.min(6, streak | 0));
    if (this.activeKillVideo) {
      try {
        this.activeKillVideo.pause();
        this.activeKillVideo.currentTime = 0;
      } catch {}
    }
    const vid = this.killVideos[tier - 1];
    this.activeKillVideo = vid;
    this.activeKillTier = tier;
    this.el.killBanner.classList.remove('hidden');
    this.el.killBanner.style.opacity = '1';
    try {
      vid.currentTime = 0;
      vid.volume = Math.max(0, Math.min(1, volume));
      const p = vid.play();
      if (p && p.catch) {
        p.catch(() => {
          // If autoplay with audio was blocked, play muted + trigger synthesized audio fallback
          vid.muted = true;
          vid.play().catch(() => {});
          if (onFallbackAudio) onFallbackAudio();
        });
      }
    } catch {
      if (onFallbackAudio) onFallbackAudio();
    }
    if (!this.killRaf) {
      const tick = () => {
        if (!this.activeKillVideo) { this.killRaf = 0; return; }
        this.drawKillEffectFrame();
        this.killRaf = requestAnimationFrame(tick);
      };
      this.killRaf = requestAnimationFrame(tick);
    }
  }
  drawKillEffectFrame() {
    const vid = this.activeKillVideo;
    const c = this.el.killBanner, g = this.killCtx;
    if (!vid || !c || !g) return;
    if (vid.readyState < 2) return;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    // Crop the bottom-center skull badge region (600x320 at x=660, y=710 in 1920x1080)
    g.drawImage(vid, 660, 710, 600, 320, 0, 0, W, H);
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      // Background green screen is ~(28, 119, 0); foreground skull & particles are neutral white ~(195, 196, 195)
      const aB = (b - 10) * 1.45;
      const aR = (r - 38) * 1.62;
      const a = aB > aR ? aB : aR;
      if (a <= 4 || (gr > r + 26 && gr > b + 42 && b < 26)) {
        d[i + 3] = 0;
      } else {
        const alpha = a >= 255 ? 255 : a | 0;
        const lum = Math.min(255, (r > b ? r : b) + 60);
        d[i] = lum;
        d[i + 1] = lum;
        d[i + 2] = Math.min(255, lum + 6);
        d[i + 3] = alpha;
      }
    }
    g.putImageData(img, 0, 0);
    // Smooth fade-out at the tail of clips 1..4 if no subsequent kill interrupts them
    if (this.activeKillTier <= 4 && vid.duration > 0) {
      const rem = vid.duration - vid.currentTime;
      c.style.opacity = rem < 0.25 ? String(Math.max(0, rem / 0.25)) : '1';
    } else {
      c.style.opacity = '1';
    }
  }
  resetKillEffect() {
    if (this.killRaf) {
      cancelAnimationFrame(this.killRaf);
      this.killRaf = 0;
    }
    if (this.activeKillVideo) {
      try {
        this.activeKillVideo.pause();
        this.activeKillVideo.currentTime = 0;
      } catch {}
      this.activeKillVideo = null;
    }
    this.activeKillTier = 0;
    if (this.el.killBanner && this.killCtx) {
      this.killCtx.clearRect(0, 0, this.el.killBanner.width, this.el.killBanner.height);
      this.el.killBanner.classList.add('hidden');
      this.el.killBanner.style.opacity = '1';
    }
  }
  buildMapImage(d) {
    const S = 3; // px per meter
    const pad = 30;
    const W = (BOUNDS.x1 - BOUNDS.x0 + pad * 2) * S, H = (BOUNDS.z1 - BOUNDS.z0 + pad * 2) * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = (x) => (x - BOUNDS.x0 + pad) * S, Z = (z) => (z - BOUNDS.z0 + pad) * S;
    const path = (P) => { g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); };
    g.fillStyle = '#2b3138'; g.fillRect(0, 0, W, H);
    if (d.image) {
      // pre-rendered top-down view (tools/build_obj_map.py)
      const m = d.image;
      g.drawImage(m.img, X(m.x0), Z(m.z0), (m.x1 - m.x0) * S, (m.z1 - m.z0) * S);
    } else { path(d.boundary); g.fillStyle = '#6b6f6c'; g.fill(); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of d.roads) { g.strokeStyle = '#3c434b'; g.lineWidth = r.w * S; g.beginPath(); r.p.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke(); }
    for (const p of d.pitches) { path(p.p); g.fillStyle = p.s === 'soccer' ? '#4e8f3b' : '#c27a46'; g.fill(); }
    g.fillStyle = 'rgba(52,110,48,0.9)';
    for (const t of d.trees) { g.beginPath(); g.arc(X(t[0]), Z(t[1]), t[2] * S * 0.7, 0, 7); g.fill(); }
    g.fillStyle = '#8d96a0';
    for (const p of d.props) { path(p); g.fill(); }
    const roofCol = { red: '#d9765f', blue: '#8fb7da', grey: '#b5b9bc', green: '#6fd391', solar: '#46598a', concrete: '#c9c8c0', stair: '#e6d7a8', shed: '#7fa7c4' };
    for (const b of d.buildings) {
      path(b.p); g.fillStyle = roofCol[b.roof] || '#bbb'; g.fill();
      if (b.h > 4) { g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2; g.stroke(); }
    }
    path(d.boundary); g.strokeStyle = '#d8cba5'; g.lineWidth = 4; g.stroke();
    g.font = '700 20px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of d.labels) {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(l.name, X(l.x) + 1.5, Z(l.z) + 1.5);
      g.fillStyle = '#fff'; g.fillText(l.name, X(l.x), Z(l.z));
    }
    this.mapImg = c; this.mapS = S; this.mapX = X; this.mapZ = Z;
  }
  ping(x, z) { this.pings.push({ x, z, t: performance.now() }); }
  // full map, north up (hold M)
  drawBigMap(show, px, pz, yaw) {
    const c = this.big || (this.big = document.getElementById('bigmap'));
    if (!c) return;
    c.classList.toggle('hidden', !show);
    if (!show) return;
    const img = this.mapImg, s = Math.min(innerWidth * 0.8 / img.width, innerHeight * 0.8 / img.height);
    const W = Math.round(img.width * s), H = Math.round(img.height * s);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    const now = performance.now();
    for (const p of this.pings) {
      const a = 1 - (now - p.t) / 2500;
      if (a <= 0) continue;
      g.fillStyle = `rgba(255,70,70,${a})`;
      g.beginPath(); g.arc(this.mapX(p.x) * s, this.mapZ(p.z) * s, 6, 0, 7); g.fill();
    }
    g.save();
    g.translate(this.mapX(px) * s, this.mapZ(pz) * s);
    g.rotate(-yaw);
    g.fillStyle = '#ffc83d'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#fff'; g.font = '700 16px "Chakra Petch"'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('B ▲', W / 2, 8);
  }
  drawMinimap(px, pz, yaw, others) {
    const g = this.mm, R = 100, scale = 0.9; // zoom
    g.clearRect(0, 0, 200, 200);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.clip();
    g.fillStyle = '#20262c'; g.fillRect(0, 0, 200, 200);
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(scale, scale);
    g.translate(-this.mapX(px), -this.mapZ(pz));
    g.drawImage(this.mapImg, 0, 0);
    g.restore();
    // ---- enemies and gunshots, drawn in the rotated minimap frame ----
    const now = performance.now();
    const k = this.mapS * scale, Rm = (R - 6) / k;  // px per meter, visible radius in meters
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const toScreen = (x, z) => { const dx = x - px, dz = z - pz; return [R + (dx * c - dz * s) * k, R + (dx * s + dz * c) * k, Math.hypot(dx, dz)]; };
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.clip();
    // enemies & dummies inside the minimap radius
    if (others) for (const p of others.values()) {
      if (!p.alive || !p.pose) continue;
      const [sx, sy, d] = toScreen(p.pose.x, p.pose.z);
      if (d > Rm) continue;
      g.save();
      g.translate(sx, sy);
      g.rotate(yaw - (p.pose.yaw || 0));
      g.globalAlpha = 1 - 0.7 * (d / Rm);
      g.fillStyle = p.isDummy ? '#ff9800' : '#ff3b3b'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5.5, 5); g.lineTo(-5.5, 5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // gunshots: a dot where it was if it's on the minimap, otherwise a wedge on the rim pointing
    // toward it. Closer shots are more opaque; all fade out over 2.5 s.
    this.pings = this.pings.filter((p) => now - p.t < 2500);
    for (const p of this.pings) {
      const fade = 1 - (now - p.t) / 2500;
      const [sx, sy, d] = toScreen(p.x, p.z);
      const a = fade * Math.max(0.25, Math.min(1, 1 - d / 300));
      if (d < Rm) {
        g.fillStyle = `rgba(255,70,70,${a})`;
        g.beginPath(); g.arc(sx, sy, 6, 0, 7); g.fill();
        g.strokeStyle = `rgba(255,70,70,${a * 0.6})`; g.lineWidth = 2;
        g.beginPath(); g.arc(sx, sy, 6 + (1 - fade) * 16, 0, 7); g.stroke();
      } else {
        const ang = Math.atan2(sy - R, sx - R), aa = Math.max(0.35, a);
        g.strokeStyle = `rgba(0,0,0,${aa * 0.5})`; g.lineWidth = 13; g.lineCap = 'butt';
        g.beginPath(); g.arc(R, R, R - 7, ang - 0.26, ang + 0.26); g.stroke();
        g.strokeStyle = `rgba(255,40,40,${aa})`; g.lineWidth = 9;
        g.beginPath(); g.arc(R, R, R - 7, ang - 0.24, ang + 0.24); g.stroke();
        // arrow pointing out toward the shot
        g.save(); g.translate(R + Math.cos(ang) * (R - 22), R + Math.sin(ang) * (R - 22)); g.rotate(ang + Math.PI / 2);
        g.fillStyle = `rgba(255,40,40,${aa})`; g.beginPath(); g.moveTo(0, -7); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill();
        g.restore();
      }
    }
    g.restore();
    // player arrow (always up)
    g.save();
    g.translate(R, R);
    g.fillStyle = '#ffc83d'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north marker
    const nx = R + Math.sin(-yaw) * (R - 12) * -1, nz = R - Math.cos(-yaw) * (R - 12);
    g.fillStyle = '#fff'; g.font = '700 13px "Chakra Petch"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('B', nx, nz);
  }
  setHP(hp) {
    const pct = Math.max(0, hp) + '%';
    this.el.hpFill.style.width = pct;
    this.el.hpGhost.style.width = pct;
    this.el.hpText.textContent = Math.max(0, Math.ceil(hp));
    this.el.hpFill.parentElement.classList.toggle('low', hp <= 30);
  }
  setLoadout(loadout, activeSlot, ammoMap, reserveText = '∞') {
    const pW = getWeapon(loadout.primary);
    const sW = getWeapon(loadout.secondary);
    const mW = getWeapon(loadout.melee);
    if (this.el.slot1) this.el.slot1.classList.toggle('on', activeSlot === 1);
    if (this.el.slot2) this.el.slot2.classList.toggle('on', activeSlot === 2);
    if (this.el.slot3) this.el.slot3.classList.toggle('on', activeSlot === 3);
    if (this.el.slot1Name) this.el.slot1Name.textContent = pW.name;
    if (this.el.slot1Icon) this.el.slot1Icon.innerHTML = WEAPON_SVGS[pW.id] || '';
    if (this.el.ammoPrimary) this.el.ammoPrimary.innerHTML = `${ammoMap[pW.id] ?? pW.mag}<small>/${reserveText}</small>`;
    if (this.el.slot2Name) this.el.slot2Name.textContent = sW.name;
    if (this.el.slot2Icon) this.el.slot2Icon.innerHTML = WEAPON_SVGS[sW.id] || '';
    if (this.el.ammoSecondary) this.el.ammoSecondary.innerHTML = `${ammoMap[sW.id] ?? sW.mag}<small>/${reserveText}</small>`;
    if (this.el.slot3Name) this.el.slot3Name.textContent = mW.name;
    if (this.el.slot3Icon) this.el.slot3Icon.innerHTML = WEAPON_SVGS[mW.id] || '';
    this.el.crosshair.classList.toggle('fist', activeSlot === 3);
  }
  setWeapon(w, ammo, reserveText = '∞') {
    // Legacy compatibility wrapper
    if (this.el.slot1) this.el.slot1.classList.toggle('on', w === 1);
    if (this.el.slot2) this.el.slot2.classList.toggle('on', w === 2);
    if (this.el.slot3) this.el.slot3.classList.toggle('on', w === 3 || w === 0);
    if (this.el.ammoPrimary && w === 1) this.el.ammoPrimary.innerHTML = `${ammo}<small>/${reserveText}</small>`;
    if (this.el.ammoSecondary && w === 2) this.el.ammoSecondary.innerHTML = `${ammo}<small>/${reserveText}</small>`;
    this.el.crosshair.classList.toggle('fist', w === 0 || w === 3);
  }
  setSpread(px) { this.el.crosshair.style.setProperty('--gap', `${Math.round(6 + px)}px`); }
  setScope(on, range) {
    this.el.scope.classList.toggle('hidden', !on);
    this.el.crosshair.style.visibility = on ? 'hidden' : 'visible';
    if (on) this.el.rangeText.textContent = range ? `${Math.round(range)} m` : '';
  }
  setReload(p) {
    this.el.reloadBar.classList.toggle('hidden', p < 0);
    if (p >= 0) this.el.reloadBar.firstElementChild.style.width = p * 100 + '%';
  }
  hit(kind) {
    const h = this.el.hitmarker;
    h.className = 'hitmarker' + (kind === 'kill' ? ' kill' : kind === 'head' ? ' head' : '');
    void h.offsetWidth;
    h.classList.add('show');
  }
  damage(angle, amount) {
    const v = this.el.vignette;
    v.style.transition = 'none';
    v.style.opacity = Math.min(1, 0.35 + amount / 80);
    void v.offsetWidth;
    v.style.transition = 'opacity 0.9s';
    v.style.opacity = 0;
    if (angle !== null) {
      const d = document.createElement('div');
      d.className = 'dmg-dir';
      d.style.transform = `rotate(${angle}rad)`;
      this.el.dirs.appendChild(d);
      setTimeout(() => d.remove(), 1400);
    }
  }
  lowHealth(hp) {
    if (hp <= 30) this.el.vignette.style.opacity = Math.max(parseFloat(this.el.vignette.style.opacity) || 0, 0.35 + Math.sin(performance.now() * 0.006) * 0.1);
  }
  killfeed(killer, victim, weapon, hs, mine, dist) {
    const div = document.createElement('div');
    div.className = 'kf' + (mine ? ' me' : '');
    const svg = WEAPON_SVGS[weapon] || WEAPON_SVGS[weapon === 'awm' ? 'operator' : ''] || '';
    const iconHtml = svg
      ? `<span class="wi" style="display:inline-flex;align-items:center;justify-content:center;color:${weapon === 'knife' ? '#ffc83d' : '#fff'}">${svg}</span>`
      : `<span class="wi ${weapon === 'fist' ? 'fist' : weapon === 'knife' ? 'knife' : 'awm'}"></span>`;
    div.innerHTML = `<span style="color:${killer.color}">${escapeHtml(killer.name)}</span>${iconHtml}${hs ? '<span class="hs" title="Headshot"></span>' : ''}<span style="color:${victim.color}">${escapeHtml(victim.name)}</span>${dist ? `<small style="opacity:.6">${Math.round(dist)}m</small>` : ''}`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 7000);
  }
  center(text, sub, cls = '') {
    const d = document.createElement('div');
    d.className = 'cm ' + cls;
    d.innerHTML = escapeHtml(text) + (sub ? `<small>${escapeHtml(sub)}</small>` : '');
    this.el.center.innerHTML = '';
    this.el.center.appendChild(d);
  }
  scoreboard(show, rows) {
    this.el.sb.classList.toggle('hidden', !show);
    if (!show) return;
    this.el.sbBody.innerHTML = rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span style="color:${r.color}">■</span> ${escapeHtml(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.alive ? 'Đang chiến' : 'Ở sảnh'}</td></tr>`).join('');
  }
  stats(text) { this.el.stats.textContent = text; }
  protect(on) { this.el.protect.classList.toggle('hidden', !on); }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }
}
