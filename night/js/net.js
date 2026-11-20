import { randId } from '../../js/util.js';

// Mạng của chế độ đêm, không cần server riêng:
//  - MQTT công cộng: danh sách phòng, vào phòng, signaling WebRTC, và đường dự phòng cho dữ liệu game
//    (gom gói 8 lần/s vì broker giới hạn ~10 tin/s mỗi client).
//  - WebRTC mesh: mỗi cặp người chơi một kết nối P2P mang giọng nói (audio track) và hai data channel
//    ('u' không tin cậy cho vị trí 20 lần/s, 'r' tin cậy cho sự kiện và clip giọng).
//  - Trình duyệt của người tạo phòng là "game-server" (host.js), có thẩm quyền với trạng thái game.

const MQTT_URL = new URL('../../vendor/mqtt.esm.js', import.meta.url).href;
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const ROOT = 'bkbgn/v1';
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];

export function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.id = randId(10);
    this.peers = new Map();  // id -> {pc, dcU, dcR, audio, stream, hello, lastSeen, polite}
    this.room = null;
    this.handlers = {};      // t -> fn(from, msg)
    this.onPeerStream = () => {};
    this.onPeerLeave = () => {};
    this.onRooms = () => {};
    this.rooms = new Map();
    this.queue = [];
    this.localTrack = null;
    this.stats = { mqttOut: 0, dcOut: 0, mqttIn: 0, dcIn: 0 };
  }
  on(t, fn) { this.handlers[t] = fn; }

  async connect() {
    const mod = await import(MQTT_URL);
    const mqtt = mod.default || mod;
    let lastErr;
    for (const url of BROKERS) {
      try {
        await new Promise((resolve, reject) => {
          const c = mqtt.connect(url, { clientId: 'bkbgn_' + this.id + '_' + randId(3), clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: 6000 });
          const to = setTimeout(() => { c.end(true); reject(new Error('mqtt timeout')); }, 7000);
          c.on('connect', () => {
            clearTimeout(to); this.client = c; this.brokerUrl = url;
            c.subscribe(ROOT + '/lobby', { qos: 0 });
            if (this.room) this.subRoom();
            resolve();
          });
          c.on('error', (e) => { clearTimeout(to); c.end(true); reject(e); });
          c.on('message', (topic, payload) => this.onMqtt(topic, payload));
        });
        break;
      } catch (e) { lastErr = e; }
    }
    if (!this.client) throw lastErr || new Error('no broker');
    clearInterval(this.flushT);
    this.flushT = setInterval(() => this.flush(), 125);
    clearInterval(this.beatT);
    this.beatT = setInterval(() => this.beat(), 2000);
  }
  // ------------------------------------------------ phòng
  joinRoom(code, hello) {
    this.room = code;
    this.hello = hello;   // {name, host:boolean}
    this.subRoom();
    this.mqttSend({ t: 'hello', ...this.hello });
  }
  subRoom() { this.client.subscribe(`${ROOT}/r/${this.room}/+`, { qos: 0 }); }
  leaveRoom() {
    if (this.room) {
      try { this.client.publish(`${ROOT}/r/${this.room}/${this.id}`, JSON.stringify({ t: 'bye' })); } catch {}
      this.client.unsubscribe(`${ROOT}/r/${this.room}/+`);
    }
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.room = null;
  }
  announce(info) { if (this.client?.connected) this.client.publish(ROOT + '/lobby', JSON.stringify({ ...info, room: this.room, ts: Date.now() })); }
  beat() {
    if (this.room) this.mqttSend({ t: 'hello', ...this.hello });
    const now = performance.now();
    for (const [id, p] of this.peers) if (now - p.lastSeen > 9000) this.dropPeer(id);
    for (const [r, info] of this.rooms) if (Date.now() - info.seen > 8000) this.rooms.delete(r);
    this.onRooms(this.rooms);
  }
  onMqtt(topic, payload) {
    let m;
    try { m = JSON.parse(payload.toString()); } catch { return; }
    if (topic === ROOT + '/lobby') {
      if (m && typeof m.room === 'string') {
        if (m.closed) this.rooms.delete(m.room); else this.rooms.set(m.room, { ...m, seen: Date.now() });
        this.onRooms(this.rooms);
      }
      return;
    }
    const from = topic.slice(topic.lastIndexOf('/') + 1);
    if (from === this.id) return;
    this.stats.mqttIn++;
    const list = m && m.t === 'b' && Array.isArray(m.m) ? m.m : [m];
    for (const x of list) {
      if (!x || typeof x.t !== 'string') continue;
      if (x.to && x.to !== this.id) continue;
      this.handleSys(from, x, 'mqtt');
    }
  }
  handleSys(from, m, via) {
    if (m.t === 'bye') { this.dropPeer(from); return; }
    if (m.t === 'hello') {
      let p = this.peers.get(from);
      if (!p) p = this.addPeer(from);
      p.hello = m; p.lastSeen = performance.now();
      if (!p.answered) { p.answered = true; this.mqttSend({ t: 'hello', ...this.hello, to: from }); }
      return;
    }
    if (m.t === 'sig') { this.onSignal(from, m); return; }
    const p = this.peers.get(from);
    if (p) p.lastSeen = performance.now();
    const h = this.handlers[m.t];
    if (h) h(from, m, via);
  }
  // ------------------------------------------------ gửi
  mqttSend(obj) { if (this.queue.length < 120) this.queue.push(obj); }
  flush() {
    if (!this.queue.length || !this.client?.connected || !this.room) return;
    let q = this.queue; this.queue = [];
    // chỉ giữ trạng thái mới nhất cho các loại gửi liên tục
    const seen = new Set();
    q = q.reverse().filter((x) => { if (x.t !== 'st' && x.t !== 'snap') return true; const k = x.t + (x.to || ''); if (seen.has(k)) return false; seen.add(k); return true; }).reverse();
    this.stats.mqttOut++;
    this.client.publish(`${ROOT}/r/${this.room}/${this.id}`, JSON.stringify(q.length === 1 ? q[0] : { t: 'b', m: q }), { qos: 0 });
  }
  sendTo(id, obj, reliable = true) {
    const p = this.peers.get(id);
    const dc = p && (reliable ? p.dcR : p.dcU);
    if (dc && dc.readyState === 'open') {
      try { dc.send(JSON.stringify(obj)); this.stats.dcOut++; return; } catch {}
    }
    this.mqttSend({ ...obj, to: id });
  }
  broadcast(obj, reliable = true) {
    const s = JSON.stringify(obj);
    for (const [id, p] of this.peers) {
      if (!p.hello) continue;
      const dc = reliable ? p.dcR : p.dcU;
      if (dc && dc.readyState === 'open') { try { dc.send(s); this.stats.dcOut++; continue; } catch {} }
      this.mqttSend({ ...obj, to: id });  // chưa có P2P với người này: đi đường MQTT
    }
  }
  // ------------------------------------------------ WebRTC
  addPeer(id) {
    const p = { id, lastSeen: performance.now(), polite: this.id > id, pc: null };
    this.peers.set(id, p);
    this.makePC(p);
    if (!p.polite) this.negotiate(p);
    return p;
  }
  makePC(p) {
    const pc = (p.pc = new RTCPeerConnection({ iceServers: ICE }));
    p.makingOffer = false;
    if (!p.polite) {
      p.tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.localTrack) p.tx.sender.replaceTrack(this.localTrack);
      this.setupDC(p, pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      this.setupDC(p, pc.createDataChannel('r', { ordered: true }));
    }
    pc.ondatachannel = (e) => this.setupDC(p, e.channel);
    pc.onicecandidate = (e) => { if (e.candidate) this.mqttSend({ t: 'sig', to: p.id, ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      p.stream = stream;
      this.onPeerStream(p.id, stream);
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch {} }
    };
  }
  async negotiate(p) {
    try {
      p.makingOffer = true;
      await p.pc.setLocalDescription(await p.pc.createOffer());
      this.mqttSend({ t: 'sig', to: p.id, sdp: p.pc.localDescription.toJSON() });
    } catch (e) { console.warn('offer', e); } finally { p.makingOffer = false; }
  }
  async onSignal(from, m) {
    let p = this.peers.get(from);
    if (!p) p = this.addPeer(from);
    const pc = p.pc;
    try {
      if (m.sdp) {
        const collision = m.sdp.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        if (collision && !p.polite) return;
        await pc.setRemoteDescription(m.sdp);
        if (m.sdp.type === 'offer') {
          const tx = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
          if (tx) { tx.direction = 'sendrecv'; p.tx = tx; if (this.localTrack) tx.sender.replaceTrack(this.localTrack); }
          await pc.setLocalDescription(await pc.createAnswer());
          this.mqttSend({ t: 'sig', to: from, sdp: pc.localDescription.toJSON() });
        }
      } else if (m.ice) {
        try { await pc.addIceCandidate(m.ice); } catch (e) { /* ice trước sdp: bỏ qua */ }
      }
    } catch (e) { console.warn('signal', e); }
  }
  setupDC(p, dc) {
    if (dc.label === 'u') p.dcU = dc; else p.dcR = dc;
    dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.stats.dcIn++;
      p.lastSeen = performance.now();
      const h = this.handlers[m.t];
      if (h) h(p.id, m, 'dc');
    };
  }
  setLocalTrack(track) {
    this.localTrack = track;
    for (const p of this.peers.values()) if (p.tx) p.tx.sender.replaceTrack(track).catch(() => {});
  }
  dcOpen(id) { const p = this.peers.get(id); return !!(p && p.dcR && p.dcR.readyState === 'open'); }
  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch {}
    this.peers.delete(id);
    this.onPeerLeave(id);
  }
}
