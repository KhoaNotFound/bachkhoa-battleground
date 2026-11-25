// Bách Khoa Battleground relay server.
// - Serves the static game files with ETag, Cache-Control, and streaming
// - Relays JSON messages between players in the same room over WebSocket
// - Bridges every room to the public MQTT broker so players who connect
//   through MQTT (when this server is unreachable) share the same world.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const BROKER = process.env.BROKER || 'wss://broker.emqx.io:8084/mqtt';
const TOPIC_ROOT = 'bkbg/v2';
const BRIDGE = process.env.BRIDGE !== '0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream',
};

// Heavy static binary/media assets can be cached aggressively by the browser
// while still revalidating cleanly via ETag when updated.
const LONG_CACHE_EXTS = new Set(['.glb', '.bin', '.png', '.jpg', '.webp', '.mp3', '.mp4', '.webm', '.wasm']);

const rooms = new Map(); // room -> Set<ws>

function idGen() {
  const s = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(8);
  let o = '';
  for (let i = 0; i < 8; i++) o += s[b[i] % s.length];
  return o;
}
function countPlayers() { let n = 0; for (const s of rooms.values()) n += s.size; return n; }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, players: countPlayers(), bridge: BRIDGE && !!(bridge && bridge.connected) }));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/]\./.test(file.slice(ROOT.length)) || file.includes(`${path.sep}node_modules`) || file.endsWith('.log') || file.endsWith('.sh')) { res.writeHead(403); res.end(); return; }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    const cacheControl = LONG_CACHE_EXTS.has(ext)
      ? 'public, max-age=604800, stale-while-revalidate=86400'
      : 'no-cache';

    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': cacheControl,
      'etag': etag,
      'last-modified': lastModified,
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers['content-length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  });
});

// ---------------- MQTT bridge ----------------
let bridge = null;
const bridgedRooms = new Set();
const localIds = new Set();
if (BRIDGE) {
  bridge = mqtt.connect(BROKER, { clientId: 'bkbg_srv_' + idGen(), clean: true, keepalive: 20, reconnectPeriod: 3000 });
  bridge.on('connect', () => {
    console.log('[bridge] connected to', BROKER);
    for (const r of bridgedRooms) bridge.subscribe(`${TOPIC_ROOT}/${r}/+`);
  });
  bridge.on('error', (e) => console.warn('[bridge] error', e.message));
  bridge.on('message', (topic, payload) => {
    const parts = topic.split('/');
    const room = parts[2], from = parts[3];
    if (!from || localIds.has(from)) return; // our own echo
    const set = rooms.get(room);
    if (!set || !set.size) return;
    const raw = payload.toString();
    if (raw.length > 4096 || raw[0] !== '{') return;
    let out;
    if (raw.startsWith('{"t":"bye"')) out = JSON.stringify({ t: 'leave', f: from });
    else if (raw.startsWith('{"t":"ping"')) return;
    else out = '{"f":"' + from + '",' + raw.slice(1);
    for (const c of set) if (c.readyState === 1) c.send(out);
  });
}
function bridgeRoom(room) {
  if (!bridge || bridgedRooms.has(room)) return;
  bridgedRooms.add(room);
  if (bridge.connected) bridge.subscribe(`${TOPIC_ROOT}/${room}/+`);
}

// ---------------- WebSocket relay ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'main';
  const id = idGen();
  ws.id = id; ws.room = room; ws.alive = true;
  localIds.add(id);
  if (!rooms.has(room)) rooms.set(room, new Set());
  const set = rooms.get(room);
  set.add(ws);
  bridgeRoom(room);
  ws.send(JSON.stringify({ t: 'welcome', id }));
  // Each player gets its own MQTT publisher: the public broker allows ~10 msgs/s per client,
  // so we batch this player's messages at 8 Hz (keeping only the latest state update).
  let pub = null, queue = [], flush = null;
  if (BRIDGE) {
    const topic = `${TOPIC_ROOT}/${room}/${id}`;
    pub = mqtt.connect(BROKER, { clientId: 'bkbg_' + id + '_srv', clean: true, keepalive: 30, reconnectPeriod: 3000, will: { topic, payload: '{"t":"bye"}', qos: 0, retain: false } });
    pub.on('error', () => {});
    flush = setInterval(() => {
      if (!queue.length || !pub.connected) return;
      const q = queue; queue = [];
      pub.publish(topic, q.length === 1 ? q[0] : '{"t":"b","m":[' + q.join(',') + ']}', { qos: 0 });
    }, 125);
  }
  const enqueue = (raw) => {
    if (!pub) return;
    if (raw.startsWith('{"t":"s"') || raw.startsWith('{"t":"h"')) {
      const pre = raw.slice(0, 8);
      const i = queue.findIndex((x) => x.startsWith(pre));
      if (i >= 0) { queue[i] = raw; return; }
    }
    if (queue.length < 40) queue.push(raw);
  };
  console.log(`[+] ${id} joined ${room} (${set.size} in room)`);

  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => {
    const raw = data.toString();
    if (raw.length > 4096 || raw[0] !== '{') return;
    if (raw.startsWith('{"t":"ping"')) {
      const m = JSON.parse(raw);
      ws.send(JSON.stringify({ t: 'pong', ts: m.ts }));
      return;
    }
    // chat anti-spam: 4 messages at once, refill one every 2 s, 120 chars max
    if (raw.startsWith('{"t":"chat"')) {
      const now = Date.now();
      ws.chatTokens = Math.min(4, (ws.chatTokens ?? 4) + (now - (ws.chatT || now)) / 2000);
      ws.chatT = now;
      if (ws.chatTokens < 1 || raw.length > 600) return;
      ws.chatTokens -= 1;
    }
    const out = '{"f":"' + id + '",' + raw.slice(1);
    for (const c of set) if (c !== ws && c.readyState === 1) c.send(out);
    enqueue(raw);
  });
  ws.on('close', () => {
    set.delete(ws);
    localIds.delete(id);
    const out = JSON.stringify({ t: 'leave', f: id });
    for (const c of set) if (c.readyState === 1) c.send(out);
    if (pub) {
      clearInterval(flush);
      const done = () => pub.end(true);
      if (pub.connected) pub.publish(`${TOPIC_ROOT}/${room}/${id}`, '{"t":"bye"}', { qos: 0 }, done); else done();
    }
    console.log(`[-] ${id} left ${room} (${set.size} in room)`);
  });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 10000);

server.listen(PORT, () => console.log(`Bach Khoa Battleground server on http://localhost:${PORT}`));
