// Âm thanh của chế độ đêm: mic + VAD, proximity voice (newmod.md mục 7), phát giọng của ma qua
// đúng chuỗi xử lý của giọng người (PannerNode HRTF + che chắn), và hiệu ứng âm thanh.

const VAD_WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === 2048) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
    return true;
  }
}
registerProcessor('tap', Tap);`;

const SR = 16000;
const FRAME = 480;  // 30 ms ở 16 kHz

export function int16ToB64(i16) {
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToInt16(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Int16Array(u8.buffer);
}
export function f32ToI16(f) { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, f[i] * 32767)); return o; }
export function i16ToF32(i) { const o = new Float32Array(i.length); for (let k = 0; k < i.length; k++) o[k] = i[k] / 32768; return o; }

export class Voice {
  constructor(cfg) {
    this.cfg = cfg;
    this.peers = new Map();    // id -> {el, src, occ, lp, pan, gain}
    this.clips = new Map();    // clipId -> AudioBuffer
    this.playing = [];         // giọng ma đang phát: {pan, occ, lp, src, ghostId}
    this.onSegment = null;     // (Float32Array 16 kHz) => void
    this.capturing = true;     // chỉ ghi khi đang phát (open mic / đang giữ V, còn sống)
    this.level = 0;
    this.vad = { nf: 0.004, speech: false, run: 0, sil: 0, cur: [], pre: [], resamp: 0 };
  }
  // phải gọi trong một thao tác của người dùng (click)
  async initAudio() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 1;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 3;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    fetch(new URL('../../assets/audio/awm.mp3', import.meta.url)).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((b) => { this.awm = b; }).catch(() => {});
    this.ambience();
  }
  async initMic() {
    await this.initAudio();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    // track gốc luôn bật cho VAD; bản sao (sendTrack) mới là thứ gửi qua WebRTC và bị tắt khi
    // push-to-talk nhả phím / chết (tắt một track thì mọi nơi dùng track đó đều nhận im lặng)
    this.track = this.stream.getAudioTracks()[0];
    this.sendTrack = this.track.clone();
    const ctx = this.ctx;
    const url = URL.createObjectURL(new Blob([VAD_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const src = ctx.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(ctx, 'tap');
    const sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(tap).connect(sink).connect(ctx.destination);
    tap.port.onmessage = (e) => this.feed(e.data);
    return this.sendTrack;
  }
  setTransmit(on) { if (this.sendTrack) this.sendTrack.enabled = !!on; this.capturing = !!on; }

  // ---------------------------------------------------------------- VAD theo năng lượng
  // Ngưỡng thích nghi theo nền nhiễu. Clip toàn nhiễu (không ra chữ) bị loại sau bước ASR.
  feed(chunk) {
    const ratio = this.ctx.sampleRate / SR, v = this.vad;
    // hạ mẫu bằng trung bình cửa sổ
    const out = [];
    let input = chunk;
    if (v.tail && v.tail.length) { input = new Float32Array(v.tail.length + chunk.length); input.set(v.tail); input.set(chunk, v.tail.length); }
    let pos = v.resamp;
    while (pos + ratio <= input.length) {
      let s = 0; const a = Math.floor(pos), b = Math.floor(pos + ratio);
      for (let i = a; i < b; i++) s += input[i];
      out.push(s / Math.max(1, b - a));
      pos += ratio;
    }
    const cut = Math.floor(pos);
    v.tail = input.slice(cut);
    v.resamp = pos - cut;
    v.acc = v.acc ? v.acc.concat(out) : out;
    while (v.acc.length >= FRAME) this.frame(Float32Array.from(v.acc.splice(0, FRAME)));
  }
  frame(f) {
    const v = this.vad;
    let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    const rms = Math.sqrt(e / f.length);
    this.level = this.level * 0.7 + rms * 0.3;
    if (!v.speech) v.nf = rms < v.nf ? v.nf * 0.9 + rms * 0.1 : v.nf * 0.998 + rms * 0.002;
    const th = Math.max(v.nf * 3.2, 0.008);
    const isSp = this.capturing && rms > th;
    if (!v.speech) {
      v.pre.push(f); if (v.pre.length > 8) v.pre.shift();
      v.run = isSp ? v.run + 1 : 0;
      if (v.run >= 3) { v.speech = true; v.cur = v.pre.slice(); v.pre = []; v.sil = 0; }
    } else {
      v.cur.push(f);
      v.sil = rms > th * 0.7 ? 0 : v.sil + 1;
      const dur = (v.cur.length * FRAME) / SR;
      if (v.sil >= 20 || dur >= this.cfg.CLIP_MAX || !this.capturing) {
        v.speech = false; v.run = 0;
        const keep = v.cur.slice(0, v.cur.length - Math.max(0, v.sil - 6));
        v.cur = [];
        const n = keep.length * FRAME, all = new Float32Array(n);
        keep.forEach((x, k) => all.set(x, k * FRAME));
        const len = n / SR;
        if (len >= this.cfg.CLIP_MIN && len <= this.cfg.CLIP_MAX + 0.1) {
          if (this.onceResolve) { const r = this.onceResolve; this.onceResolve = null; r(all); }
          else if (this.onSegment) this.onSegment(all);
        }
      }
    }
  }
  captureOnce(timeoutMs = 9000) {
    return new Promise((resolve) => {
      this.onceResolve = resolve;
      setTimeout(() => { if (this.onceResolve === resolve) { this.onceResolve = null; resolve(null); } }, timeoutMs);
    });
  }

  // ---------------------------------------------------------------- chuỗi xử lý không gian
  chain() {
    const ctx = this.ctx, c = this.cfg;
    const occ = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.7;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = c.VOICE_REF; pan.rolloffFactor = c.VOICE_ROLLOFF; pan.maxDistance = c.VOICE_MAX;
    occ.connect(lp).connect(pan).connect(this.master);
    return { occ, lp, pan };
  }
  place(ch, pos, occluded, audible) {
    const t = this.ctx.currentTime;
    if (ch.pan.positionX) { ch.pan.positionX.setTargetAtTime(pos.x, t, 0.03); ch.pan.positionY.setTargetAtTime(pos.y, t, 0.03); ch.pan.positionZ.setTargetAtTime(pos.z, t, 0.03); }
    else ch.pan.setPosition(pos.x, pos.y, pos.z);
    const g = !audible ? 0 : occluded ? this.cfg.OCCLUSION_GAIN : 1;
    ch.occ.gain.setTargetAtTime(g, t, 0.08);
    ch.lp.frequency.setTargetAtTime(occluded ? this.cfg.OCCLUSION_LOWPASS : 20000, t, 0.08);
  }
  addPeer(id, stream) {
    if (!this.ctx) return;
    this.removePeer(id);
    // Chrome: luồng WebRTC từ xa chỉ chảy vào Web Audio khi được gắn vào một phần tử <audio> (để muted)
    const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream);
    const ch = this.chain();
    src.connect(ch.occ);
    // đo mức âm để hiện biểu tượng đang nói
    const an = this.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    this.peers.set(id, { el, src, an, buf: new Float32Array(512), ...ch });
  }
  removePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.src.disconnect(); p.occ.disconnect(); p.pan.disconnect(); } catch {}
    p.el.srcObject = null;
    this.peers.delete(id);
  }
  peerLevel(id) {
    const p = this.peers.get(id);
    if (!p) return 0;
    p.an.getFloatTimeDomainData(p.buf);
    let e = 0; for (const x of p.buf) e += x * x;
    return Math.sqrt(e / p.buf.length);
  }
  updatePeer(id, pos, occluded, audible) { const p = this.peers.get(id); if (p) this.place(p, pos, occluded, audible); }
  updateListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    const f = { x: -Math.sin(cam.rotation.y) * Math.cos(cam.rotation.x), y: Math.sin(cam.rotation.x), z: -Math.cos(cam.rotation.y) * Math.cos(cam.rotation.x) };
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  // ---------------------------------------------------------------- clip (giọng ma)
  storeClip(id, i16) {
    if (!this.ctx || this.clips.has(id)) return;
    const b = this.ctx.createBuffer(1, i16.length, SR);
    b.getChannelData(0).set(i16ToF32(i16));
    this.clips.set(id, b);
  }
  hasClip(id) { return this.clips.has(id); }
  playClip(id, ghostId) {
    const buf = this.clips.get(id);
    if (!buf) return false;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const ch = this.chain();
    src.connect(ch.occ);
    const item = { ...ch, src, ghostId, an: this.ctx.createAnalyser() };
    item.an.fftSize = 512; src.connect(item.an); item.buf = new Float32Array(512);
    this.playing.push(item);
    src.onended = () => { this.playing = this.playing.filter((x) => x !== item); try { ch.pan.disconnect(); } catch {} };
    src.start();
    return item;
  }
  ghostVoices(ghostId) { return this.playing.filter((p) => p.ghostId === ghostId); }

  // ---------------------------------------------------------------- hiệu ứng
  at(pos, ref = 4, roll = 1) {
    const ctx = this.ctx;
    if (!pos) return this.sfxBus;
    const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = ref; pan.rolloffFactor = roll; pan.maxDistance = 200;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y ?? 1.2; pan.positionZ.value = pos.z; } else pan.setPosition(pos.x, pos.y ?? 1.2, pos.z);
    pan.connect(this.sfxBus);
    return pan;
  }
  noise(dest, t, dur, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 1, attack = 0.005 } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(dest, t, dur, { type = 'sine', f0 = 440, f1 = f0, gain = 0.4, attack = 0.005 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  sfx(kind, pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'shot': {
        const d = this.at(pos, 10, 0.8);
        if (this.awm) { const s = this.ctx.createBufferSource(); s.buffer = this.awm; const g = this.ctx.createGain(); g.gain.value = 1.2; s.connect(g).connect(d); s.start(t, 2.66, 0.94); }
        else { this.noise(d, t, 0.5, { type: 'lowpass', f0: 3000, f1: 150, gain: 1.5 }); this.tone(d, t, 0.3, { f0: 110, f1: 40, gain: 1.2 }); }
        break;
      }
      case 'short': { const d = this.at(pos, 12, 0.6); this.noise(d, t, 0.9, { type: 'lowpass', f0: 4000, f1: 80, gain: 2.2, attack: 0.001 }); this.tone(d, t, 0.6, { f0: 70, f1: 30, gain: 1.4 }); for (let k = 0; k < 8; k++) this.noise(d, t + 0.05 + k * 0.07 * Math.random(), 0.05, { type: 'highpass', f0: 5000, gain: 0.9 }); break; }
      case 'clang': case 'screech': { const d = this.at(pos, 8, 0.7); this.tone(d, t, 1.4, { type: 'sawtooth', f0: 2300, f1: 1700, gain: 0.25 }); this.tone(d, t, 1.2, { type: 'square', f0: 3100, f1: 2900, gain: 0.08 }); this.noise(d, t, 1.2, { f0: 4200, q: 8, gain: 0.6 }); break; }
      case 'collapse': { const d = this.at(pos, 10, 0.7); for (let k = 0; k < 6; k++) this.noise(d, t + k * 0.12, 0.5, { type: 'lowpass', f0: 1800, f1: 90, gain: 1.4 }); this.tone(d, t, 0.8, { f0: 60, f1: 28, gain: 1.2 }); break; }
      case 'smoke': { const d = this.at(pos, 6, 1); this.noise(d, t, 3, { type: 'highpass', f0: 3000, f1: 2000, gain: 0.5, attack: 0.3 }); break; }
      case 'reboot': { const d = this.at(pos, 3, 1.2); for (let k = 0; k < 3; k++) this.tone(d, t + k * 0.25, 0.18, { type: 'square', f0: 880, gain: 0.12 }); break; }
      case 'ok': this.tone(this.sfxBus, t, 0.15, { f0: 660, gain: 0.2 }); this.tone(this.sfxBus, t + 0.13, 0.25, { f0: 990, gain: 0.2 }); break;
      case 'click': this.tone(this.sfxBus, t, 0.05, { type: 'square', f0: 1400, gain: 0.06 }); break;
      case 'flash': this.noise(this.sfxBus, t, 0.03, { type: 'highpass', f0: 3000, gain: 0.3 }); break;
      case 'pick': { const d = this.at(pos, 3, 1); this.tone(d, t, 0.08, { type: 'triangle', f0: 1200, gain: 0.25 }); this.tone(d, t + 0.07, 0.1, { type: 'triangle', f0: 1700, gain: 0.25 }); break; }
      case 'cabinet': { const d = this.at(pos, 4, 1); this.tone(d, t, 0.1, { type: 'square', f0: 700, gain: 0.1 }); this.noise(d, t + 0.1, 0.5, { type: 'bandpass', f0: 500, q: 3, gain: 0.7 }); break; }
      case 'ghost_dead': { const d = this.at(pos, 6, 1); this.noise(d, t, 1.4, { type: 'bandpass', f0: 300, f1: 2400, q: 4, gain: 1.0, attack: 0.2 }); this.tone(d, t, 1.2, { f0: 220, f1: 1200, gain: 0.15 }); break; }
      case 'grab': { const d = this.at(pos, 4, 1); this.noise(d, t, 0.8, { type: 'lowpass', f0: 900, f1: 120, gain: 1.3 }); this.tone(d, t, 0.9, { type: 'sawtooth', f0: 90, f1: 55, gain: 0.4 }); break; }
      case 'death': this.tone(this.sfxBus, t, 1.6, { type: 'sine', f0: 300, f1: 60, gain: 0.35 }); this.noise(this.sfxBus, t, 1.5, { type: 'lowpass', f0: 600, f1: 60, gain: 0.6 }); break;
      case 'phase': this.tone(this.sfxBus, t, 2.5, { type: 'sine', f0: 55, f1: 52, gain: 0.5, attack: 0.5 }); this.tone(this.sfxBus, t, 2.5, { type: 'sine', f0: 82, f1: 78, gain: 0.25, attack: 0.5 }); break;
      case 'win': [523, 659, 784, 1046].forEach((f, k) => this.tone(this.sfxBus, t + k * 0.15, 0.4, { type: 'triangle', f0: f, gain: 0.25 })); break;
      case 'lose': [392, 330, 262, 196].forEach((f, k) => this.tone(this.sfxBus, t + k * 0.25, 0.6, { type: 'triangle', f0: f, gain: 0.25 })); break;
      case 'step': { const d = this.at(pos, 2, 1.5); this.noise(d, t, 0.07, { type: 'lowpass', f0: 600, f1: 200, gain: 0.25 }); break; }
    }
  }
  // tiếng ù nền + dế ngoài sân
  ambience() {
    const ctx = this.ctx;
    const hum = ctx.createOscillator(); hum.frequency.value = 50; const hg = ctx.createGain(); hg.gain.value = 0.012;
    hum.connect(hg).connect(this.master); hum.start();
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0.03;
    src.connect(f).connect(g).connect(this.master); src.start();
    const chirp = () => {
      if (ctx.state === 'closed') return;
      const t = ctx.currentTime;
      for (let k = 0; k < 3; k++) this.tone(this.master, t + k * 0.06, 0.04, { f0: 4300 + Math.random() * 300, gain: 0.006 });
      setTimeout(chirp, 600 + Math.random() * 2200);
    };
    chirp();
  }
}
