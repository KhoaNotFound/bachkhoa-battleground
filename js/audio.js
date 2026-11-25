// Synthesized sound effects, plus a recorded AWM shot / reload (assets/audio/awm.mp3).
// Segments of that file (seconds): the shot and its tail, then the reload.
const AWM_SAMPLE = { url: new URL('../assets/audio/awm.mp3', import.meta.url), shot: [2.66, 0.94], reload: [3.6, 2.0] };
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(ctx.destination);
    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.5);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.startAmbience();
    fetch(AWM_SAMPLE.url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { this.awmBuf = buf; }).catch(() => {});
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  makeNoise(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  updateListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position;
    const f = { x: -Math.sin(cam.rotation.y) * Math.cos(cam.rotation.x), y: Math.sin(cam.rotation.x), z: -Math.cos(cam.rotation.y) * Math.cos(cam.rotation.x) };
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
    this.listenerPos = p;
  }
  // returns destination node (panner if pos given) and a delay (seconds) for sound travel
  out(pos, ref = 6, roll = 1) {
    const ctx = this.ctx;
    if (!pos) return { node: this.master, rev: this.reverb, delay: 0, dist: 0 };
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = ref; pan.rolloffFactor = roll; pan.maxDistance = 2000;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; }
    else pan.setPosition(pos.x, pos.y, pos.z);
    pan.connect(this.master);
    const lp = this.listenerPos;
    const dist = lp ? Math.hypot(pos.x - lp.x, pos.y - lp.y, pos.z - lp.z) : 0;
    const rg = ctx.createGain(); rg.gain.value = Math.min(1.5, 0.4 + dist / 120);
    pan.connect(rg); rg.connect(this.reverb);
    return { node: pan, rev: this.reverb, delay: Math.min(0.9, dist / 343), dist };
  }
  noise(dest, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 1, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(dest, t, dur, { type = 'sine', f0 = 440, f1 = f0, gain = 0.5, attack = 0.003 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // play a [start, duration] slice of a decoded buffer into a node
  slice(buf, [start, dur], node, t, gain = 1) {
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(node);
    src.start(t, start, dur);
  }
  awm(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 18, 0.8);
    const t = this.ctx.currentTime + o.delay;
    if (this.awmBuf) {
      this.slice(this.awmBuf, AWM_SAMPLE.shot, o.node, t, 1.3);
      this.slice(this.awmBuf, AWM_SAMPLE.shot, o.rev, t, 0.25 + Math.min(0.6, o.dist / 300));
      return;
    }
    const far = Math.min(1, o.dist / 250);
    // crack
    this.noise(o.node, t, 0.12, { type: 'highpass', f0: 2500 - far * 1800, f1: 800, gain: 1.4 * (1 - far * 0.5) });
    // body
    this.noise(o.node, t, 0.55, { type: 'lowpass', f0: 3200 - far * 2600, f1: 160, gain: 1.6, q: 0.7 });
    this.tone(o.node, t, 0.35, { f0: 110, f1: 38, gain: 1.4 });
    // tail into reverb
    this.noise(o.rev, t + 0.02, 0.9, { type: 'lowpass', f0: 1400, f1: 120, gain: 0.9 });
  }
  // automatic rifles / SMG (slot 3 UMP45, 4 M416, 5 AKM): short synthesized shot, deeper for heavier guns
  rifle(pos, slot = 4) {
    if (!this.ctx) return;
    const o = this.out(pos, 14, 0.7);
    const t = this.ctx.currentTime + o.delay;
    const far = Math.min(1, o.dist / 200);
    const k = slot === 5 ? 1 : slot === 4 ? 0.85 : 0.65; // weight of the report
    const pitch = 1 + (Math.random() - 0.5) * 0.08;
    this.noise(o.node, t, 0.05, { type: 'highpass', f0: (3200 - far * 2000) * pitch, f1: 1200, gain: 1.1 * (1 - far * 0.5) });
    this.noise(o.node, t, 0.16 + k * 0.1, { type: 'lowpass', f0: (2600 - far * 2000) * pitch, f1: 200, gain: 1.1 * k + 0.3, q: 0.7 });
    this.tone(o.node, t, 0.12, { f0: 150 * (0.7 + k * 0.4), f1: 55, gain: 0.8 * k });
    this.noise(o.rev, t + 0.01, 0.4, { type: 'lowpass', f0: 1200, f1: 150, gain: 0.5 * k });
  }
  // a bullet passing close by: supersonic crack + falling whoosh, placed where it passed
  whiz(pos, dist) {
    if (!this.ctx) return;
    const o = this.out(pos, 1.5, 0.6), t = this.ctx.currentTime;
    const k = Math.max(0.15, 1 - dist / 6);
    this.noise(o.node, t, 0.03, { type: 'highpass', f0: 5500, f1: 3500, gain: 1.6 * k, attack: 0.001 });
    this.noise(o.node, t + 0.01, 0.28, { type: 'bandpass', f0: 5200, f1: 700, q: 3, gain: 1.1 * k, attack: 0.01 });
    this.tone(o.node, t + 0.01, 0.22, { type: 'sine', f0: 2600, f1: 900, gain: 0.08 * k, attack: 0.005 });
  }
  bolt(delay = 0.35, vol = 1.0, pitch = 1.0, partial = false) {
    if (!this.ctx) return;
    const d = this.master, t = this.ctx.currentTime + delay;
    const click = (tt, f) => {
      this.noise(d, tt, 0.05, { type: 'bandpass', f0: f, q: 6, gain: 0.5 * vol });
      this.tone(d, tt, 0.04, { type: 'square', f0: f * 1.5, f1: f, gain: 0.05 * vol });
    };
    if (partial) {
      click(t, 1800 * pitch);
      click(t + 0.08, 2300 * pitch);
      return;
    }
    click(t, 1800 * pitch); click(t + 0.18, 2400 * pitch); click(t + 0.42, 2100 * pitch); click(t + 0.6, 1600 * pitch);
  }
  reload() {
    if (!this.ctx) return;
    const d = this.master, t = this.ctx.currentTime;
    if (this.awmBuf) { this.slice(this.awmBuf, AWM_SAMPLE.reload, d, t + 0.3, 1.4); return; }
    const click = (tt, f, g = 0.5) => this.noise(d, tt, 0.06, { type: 'bandpass', f0: f, q: 5, gain: g });
    click(t + 0.35, 1200); click(t + 0.4, 900, 0.3); click(t + 1.4, 1500); click(t + 1.55, 2200, 0.6); click(t + 2.1, 1800); click(t + 2.35, 2400);
  }
  dry() { if (!this.ctx) return; this.noise(this.master, this.ctx.currentTime, 0.04, { type: 'bandpass', f0: 3000, q: 8, gain: 0.4 }); }
  swing(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 3, 1.4), t = this.ctx.currentTime;
    this.noise(o.node, t, 0.18, { type: 'bandpass', f0: 500, f1: 1800, q: 1.5, gain: 0.35, attack: 0.05 });
  }
  punchHit(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 4, 1.2), t = this.ctx.currentTime;
    this.tone(o.node, t, 0.16, { f0: 160, f1: 50, gain: 1.1 });
    this.noise(o.node, t, 0.1, { type: 'lowpass', f0: 1800, f1: 300, gain: 0.9 });
  }
  knifeClack(pitch = 1.0, vol = 0.7) {
    if (!this.ctx) return;
    const d = this.master, t = this.ctx.currentTime;
    const p = pitch * (0.95 + Math.random() * 0.1);
    // Crisp metallic tang-pin click + bright titanium ring overtone
    this.noise(d, t, 0.028, { type: 'bandpass', f0: 3600 * p, f1: 2200 * p, q: 7, gain: 0.55 * vol, attack: 0.001 });
    this.tone(d, t, 0.045, { type: 'triangle', f0: 4200 * p, f1: 3400 * p, gain: 0.14 * vol, attack: 0.001 });
    this.tone(d, t, 0.075, { type: 'sine', f0: 6100 * p, f1: 5800 * p, gain: 0.07 * vol, attack: 0.001 });
  }
  knifeDraw() {
    if (!this.ctx) return;
    const d = this.master, t = this.ctx.currentTime;
    // Quick whip air whoosh + metallic shing shimmer
    this.noise(d, t + 0.08, 0.16, { type: 'bandpass', f0: 900, f1: 2800, q: 2.2, gain: 0.28, attack: 0.04 });
    this.tone(d, t + 0.22, 0.22, { type: 'sine', f0: 5200, f1: 4800, gain: 0.055, attack: 0.01 });
  }
  knifeSlash(pos, heavy = false) {
    if (!this.ctx) return;
    const o = this.out(pos, 3.5, 1.3), t = this.ctx.currentTime;
    const dur = heavy ? 0.22 : 0.14;
    this.noise(o.node, t, dur, { type: 'bandpass', f0: heavy ? 1200 : 1800, f1: heavy ? 4200 : 5200, q: 2.4, gain: heavy ? 0.52 : 0.36, attack: 0.02 });
    this.tone(o.node, t, dur * 0.85, { type: 'sine', f0: heavy ? 2800 : 3800, f1: heavy ? 1400 : 2100, gain: 0.07, attack: 0.015 });
  }
  knifeHit(pos, heavy = false) {
    if (!this.ctx) return;
    const o = this.out(pos, 4.5, 1.2), t = this.ctx.currentTime;
    this.noise(o.node, t, 0.11, { type: 'bandpass', f0: 2600, f1: 600, q: 1.4, gain: heavy ? 1.15 : 0.85, attack: 0.002 });
    this.tone(o.node, t, 0.13, { f0: heavy ? 180 : 220, f1: 55, gain: heavy ? 1.0 : 0.72 });
    this.tone(o.node, t, 0.09, { type: 'triangle', f0: 4600, f1: 3100, gain: 0.14 });
  }
  hitmarker(head) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (head) { this.tone(this.master, t, 0.35, { type: 'triangle', f0: 1960, gain: 0.35 }); this.tone(this.master, t, 0.3, { type: 'sine', f0: 2940, gain: 0.15 }); }
    else this.tone(this.master, t, 0.06, { type: 'square', f0: 1700, f1: 1400, gain: 0.08 });
  }
  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [659, 880, 1318].forEach((f, i) => this.tone(this.master, t + i * 0.07, 0.25, { type: 'triangle', f0: f, gain: 0.22 }));
  }
  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 0.25, { f0: 90, f1: 40, gain: 0.9 });
    this.noise(this.master, t, 0.2, { type: 'lowpass', f0: 600, f1: 100, gain: 0.6 });
  }
  death() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 0.6, { type: 'sawtooth', f0: 300, f1: 60, gain: 0.25 });
    this.tone(this.master, t, 1.2, { f0: 70, f1: 30, gain: 0.8 });
  }
  oof(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 6, 1), t = this.ctx.currentTime + o.delay;
    this.tone(o.node, t, 0.22, { type: 'square', f0: 420, f1: 180, gain: 0.12 });
    this.tone(o.node, t, 0.22, { type: 'sine', f0: 220, f1: 110, gain: 0.3 });
  }
  step(pos, vol = 1) {
    if (!this.ctx) return;
    const o = this.out(pos, 2.5, 1.6), t = this.ctx.currentTime;
    this.noise(o.node, t, 0.08, { type: 'lowpass', f0: 700 + Math.random() * 300, f1: 200, gain: 0.25 * vol });
  }
  land() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(this.master, t, 0.12, { type: 'lowpass', f0: 500, f1: 120, gain: 0.5 });
  }
  spawn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 0.5, { type: 'sine', f0: 300, f1: 900, gain: 0.2, attack: 0.05 });
  }
  ui() { if (!this.ctx) return; this.tone(this.master, this.ctx.currentTime, 0.06, { type: 'triangle', f0: 900, gain: 0.12 }); }
  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.035;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    const bird = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const base = 2400 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.tone(this.master, t + i * 0.13, 0.09, { f0: base, f1: base * (1.2 + Math.random() * 0.3), gain: 0.025 });
      setTimeout(bird, 3000 + Math.random() * 9000);
    };
    setTimeout(bird, 2000);
  }
}
