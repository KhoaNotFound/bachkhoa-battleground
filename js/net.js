import { randId } from './util.js';

const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.esm.js';
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
export const TOPIC_ROOT = 'bkbg/v2';

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export class Net {
  constructor(room) {
    this.room = (room || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'main';
    this.id = randId(8);
    this.mode = '…';
    this.ping = 0;
    this.connected = false;
    this.onMessage = () => {};
    this.onLeave = () => {};
    this.onStatus = () => {};
    this.sent = 0; this.recv = 0;
  }
  async connect() {
    const qs = new URLSearchParams(location.search);
    const force = qs.get('net');
    let wsUrl = qs.get('ws');
    const sameOrigin = /localhost|127\.0\.0\.1|trycloudflare\.com|\.local$/.test(location.hostname) || location.protocol === 'http:';
    if (!wsUrl && force !== 'mqtt') {
      if (sameOrigin) wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      else {
        try {
          const r = await withTimeout(fetch('server.json?t=' + Date.now(), { cache: 'no-store' }), 2500);
          const j = await r.json();
          if (j && j.url) {
            const h = await withTimeout(fetch(j.url.replace(/\/$/, '') + '/health', { cache: 'no-store' }), 2500);
            if (h.ok) wsUrl = j.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
          }
        } catch (e) { /* server offline -> mqtt */ }
      }
    }
    if (wsUrl && force !== 'mqtt') {
      try { await this.connectWS(wsUrl); return; } catch (e) { console.warn('WS failed, falling back to MQTT', e); }
    }
    await this.connectMQTT();
  }
  // ---------------- WebSocket relay ----------------
  connectWS(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url + (url.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(this.room));
      this.ws = ws;
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; ws.close(); reject(new Error('ws timeout')); } }, 4000);
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.recv++;
        if (m.t === 'welcome') {
          this.id = m.id; this.mode = 'server'; this.connected = true;
          if (!done) { done = true; clearTimeout(to); resolve(); }
          this.onStatus();
          return;
        }
        if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.ts); return; }
        if (m.t === 'leave') { this.onLeave(m.f); return; }
        if (m.f && m.f !== this.id) this.onMessage(m.f, m);
      };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(to); reject(new Error('ws error')); } };
      ws.onclose = () => {
        this.connected = false;
        this.onStatus();
        if (done && !this.closing) setTimeout(() => this.reconnect(), 1500);
      };
      this._send = (s) => { if (ws.readyState === 1) ws.send(s); };
      this._ping = () => this._send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    });
  }
  async reconnect() {
    if (this.connected || this.reconnecting) return;
    this.reconnecting = true;
    try { await this.connect(); this.onStatus('reconnected'); } catch (e) { setTimeout(() => this.reconnect(), 3000); }
    this.reconnecting = false;
  }
  // ---------------- MQTT (public broker) ----------------
  async connectMQTT() {
    const mod = await import(MQTT_URL);
    const mqtt = mod.default || mod;
    const prefix = `${TOPIC_ROOT}/${this.room}/`;
    const myTopic = prefix + this.id;
    let lastErr;
    for (const url of BROKERS) {
      try {
        await new Promise((resolve, reject) => {
          const client = mqtt.connect(url, {
            clientId: 'bkbg_' + this.id + '_' + randId(4),
            clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: 6000,
            will: { topic: myTopic, payload: '{"t":"bye"}', qos: 0, retain: false },
          });
          let done = false;
          const to = setTimeout(() => { if (!done) { done = true; client.end(true); reject(new Error('mqtt timeout')); } }, 7000);
          client.on('connect', () => {
            client.subscribe(prefix + '+', { qos: 0 });
            this.connected = true;
            this.onStatus();
            if (!done) { done = true; clearTimeout(to); this.client = client; this.mode = 'p2p'; resolve(); }
          });
          client.on('close', () => { this.connected = false; this.onStatus(); });
          client.on('error', (e) => { if (!done) { done = true; clearTimeout(to); client.end(true); reject(e); } });
          client.on('message', (topic, payload) => {
            const from = topic.slice(prefix.length);
            let m;
            try { m = JSON.parse(payload.toString()); } catch { return; }
            this.recv++;
            if (from === this.id) {
              if (m.t === 'ping') this.ping = Math.round(performance.now() - m.ts);
              return;
            }
            if (m.t === 'bye') { this.onLeave(from); return; }
            if (m.t === 'ping') return;
            this.onMessage(from, m);
          });
          this._send = (s) => client.connected && client.publish(myTopic, s, { qos: 0 });
          this._ping = () => this._send(JSON.stringify({ t: 'ping', ts: performance.now() }));
          this.brokerUrl = url;
        });
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no broker');
  }
  send(obj) {
    if (!this._send) return;
    this.sent++;
    this._send(JSON.stringify(obj));
  }
  sendPing() { if (this._ping) this._ping(); }
  leave() {
    this.closing = true;
    try { this.send({ t: 'bye' }); } catch {}
  }
}
