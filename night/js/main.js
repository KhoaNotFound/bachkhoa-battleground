import * as THREE from 'three';
import { CollisionWorld, Mover } from '../../js/physics.js';
import { Avatar, buildAwmMesh } from '../../js/avatar.js';
import { clamp, damp, lerpAngle, cleanName, escapeHtml } from '../../js/util.js';
import { CONFIG, applyOverrides, clockText, FACULTIES, SHIRT, DODGE_LINES } from './config.js';
import { Net, roomCode } from './net.js';
import { Host } from './host.js';
import { Voice, f32ToI16, int16ToB64, b64ToInt16, ulawEncode } from './voice.js';
import { TaskUI } from './tasks-ui.js';
import { TASK_IDS, TASK_NAMES } from './tasks-logic.js';
import { buildNightMap, SPOTS, SPAWNS, wallBetween, roomAt, ROOMS } from './map.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const DEBUG = qs.has('debug');
const show = (id) => { for (const s of ['menu', 'lobby', 'consent', 'miccheck', 'end']) $(s).classList.toggle('hidden', s !== id); };

// ====================================================================== trạng thái chung
const cfg = applyOverrides({ ...CONFIG }, qs.get('cfg'));
const net = new Net();
const voice = new Voice(cfg);
let me = { name: '', fac: null, color: null };
let room = null;          // {code, hostId, isHost, roster:[{id,name,fac,color,ready}], started}
let host = null;          // Host (chỉ trên máy chủ phòng)
let game = null;          // trạng thái trận trên client
let micOk = false, consented = false;
const dodgeClips = [];    // [{text, f32}] từ mic check
let asr = null, asrReady = false;
const asrJobs = new Map();

try { me.name = localStorage.getItem('bkn_name') || ''; } catch {}
$('nameIn').value = me.name;
if (DEBUG) $('soloBtn').classList.remove('hidden');
if (qs.get('room')) $('codeIn').value = qs.get('room').toUpperCase();

// ====================================================================== mạng
net.onRooms = (rooms) => {
  const ul = $('roomList');
  const list = [...rooms.values()].filter((r) => !r.started).sort((a, b) => b.ts - a.ts);
  if (!list.length) { ul.innerHTML = '<li class="muted">Chưa có phòng nào mở. Tạo phòng rồi gửi mã cho bạn bè.</li>'; return; }
  ul.innerHTML = list.map((r) => `<li><span><b>${escapeHtml(r.room)}</b> · ${escapeHtml(r.name || '')} · ${r.count}/${r.max}</span><button class="small" data-room="${escapeHtml(r.room)}" ${r.count >= r.max ? 'disabled' : ''}>Vào</button></li>`).join('');
  ul.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => joinRoom(b.dataset.room)));
};
net.connect().then(() => { $('netState').textContent = 'Đã kết nối máy chủ tín hiệu'; }).catch((e) => { $('netState').textContent = 'Không kết nối được máy chủ tín hiệu: ' + e.message; });

// tin nhắn tới host
function toHost(msg, reliable = true) {
  if (!room) return;
  if (room.isHost) { if (host) host.onMessage(net.id, msg); else hostLobby(net.id, msg); }
  else net.sendTo(room.hostId, msg, reliable);
}
// io của host: phát cho mọi người (kể cả chính mình)
const hostIO = {
  emit(msg, reliable) { net.broadcast(msg, reliable); onFromHost(net.id, msg); },
  sendTo(id, msg, reliable) { if (id === net.id) onFromHost(net.id, msg); else net.sendTo(id, msg, reliable); },
};
for (const t of ['st', 'act', 'clipm', 'clipt', 'dbg', 'ff', 'join', 'pref', 'ready']) {
  net.on(t, (from, m) => { if (!room?.isHost) return; if (host) host.onMessage(from, m); else hostLobby(from, m); });
}
for (const t of ['snap', 'ev', 'items', 'end', 'task', 'task_r', 'task_result', 'toast', 'gsay', 'dbg', 'start', 'lobby', 'joinok', 'joinno']) {
  net.on(t, (from, m) => { if (room && !room.isHost && from === room.hostId) onFromHost(from, m); else if (t === 'joinno' || t === 'joinok' || t === 'lobby') onFromHost(from, m); });
}
net.on('clipc', (from, m) => onClipChunk(from, m));
// giọng đi vòng qua MQTT cho những cặp không nối P2P được (mạng 4G, CGNAT, mạng công ty...)
net.on('va', (from, m) => { if (typeof m.d === 'string' && m.d.length < 4000 && !net.p2pOk(from)) voice.playRelay(from, m.d); });
let relayBuf = [];
voice.onRelay = (f16) => {
  if (!room) return;
  for (let i = 0; i + 1 < f16.length; i += 2) relayBuf.push(ulawEncode((f16[i] + f16[i + 1]) * 0.5));
  if (relayBuf.length < 960) return;  // gửi mỗi ~120 ms
  const ids = net.relayIds();
  const bytes = relayBuf; relayBuf = [];
  if (!ids.length) return;
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  net.mqttSend({ t: 'va', tos: ids, d: btoa(s) });
};
net.onPeerStream = (id, stream) => { if (voice.ctx) voice.addPeer(id, stream); else pendingStreams.set(id, stream); };
const pendingStreams = new Map();
net.onPeerLeave = (id) => {
  voice.removePeer(id);
  if (!room) return;
  if (id === room.hostId && !room.isHost) {
    leaveToMenu('Chủ phòng đã rời. Trận kết thúc.');
    return;
  }
  if (room.isHost) {
    if (host) host.playerLeft(id);
    else { room.roster = room.roster.filter((r) => r.id !== id); pushLobby(); }
  }
};

// ====================================================================== menu
function readName() {
  const n = cleanName($('nameIn').value || '');
  if (!n) { $('menuMsg').textContent = 'Nhập tên trước đã.'; return null; }
  me.name = n; try { localStorage.setItem('bkn_name', n); } catch {}
  return n;
}
$('createBtn').onclick = () => createRoom(false);
$('soloBtn').onclick = () => createRoom(true);
$('joinBtn').onclick = () => joinRoom($('codeIn').value.trim().toUpperCase());
$('codeIn').onkeydown = (e) => { if (e.key === 'Enter') $('joinBtn').click(); };

function createRoom(solo) {
  if (!readName() || !net.client) return;
  const code = roomCode();
  room = { code, hostId: net.id, isHost: true, solo, started: false, roster: [{ id: net.id, name: me.name, fac: null, color: SHIRT, ready: false }] };
  me.color = SHIRT;
  net.joinRoom(code, { name: me.name, host: true });
  clearInterval(room.annT);
  room.annT = setInterval(() => { if (room && room.isHost && !room.started && !solo) net.announce({ name: me.name, count: room.roster.length, max: cfg.MAX_PLAYERS, started: false }); }, 2000);
  enterLobby();
}
function joinRoom(code) {
  if (!readName() || !net.client) return;
  if (!/^[A-Z0-9]{5}$/.test(code)) { $('menuMsg').textContent = 'Mã phòng gồm 5 ký tự.'; return; }
  room = { code, hostId: null, isHost: false, started: false, roster: [] };
  net.joinRoom(code, { name: me.name, host: false });
  $('menuMsg').textContent = 'Đang tìm phòng ' + code + '…';
  const t0 = Date.now();
  const look = setInterval(() => {
    if (!room || room.code !== code) { clearInterval(look); return; }
    const h = [...net.peers.values()].find((p) => p.hello && p.hello.host);
    if (h) { room.hostId = h.id; net.sendTo(h.id, { t: 'join', name: me.name }); }
    if (room.joined) { clearInterval(look); return; }
    if (Date.now() - t0 > 9000) { clearInterval(look); net.leaveRoom(); room = null; $('menuMsg').textContent = 'Không tìm thấy phòng hoặc phòng không phản hồi.'; }
  }, 700);
}
function leaveToMenu(msg) {
  voice.setTransmit(false);
  lobbyClips.length = 0;
  if (host) { host.stop(); host = null; }
  if (room?.isHost && !room.started) net.announce({ closed: true });
  if (room) clearInterval(room.annT);
  net.leaveRoom();
  room = null;
  endGame();
  show('menu');
  $('menuMsg').textContent = msg || '';
}

// ====================================================================== lobby (host)
function hostLobby(from, m) {
  if (!room?.isHost) return;
  const r = room.roster.find((x) => x.id === from);
  if (m.t === 'join') {
    if (r) { net.sendTo(from, { t: 'joinok', code: room.code }); pushLobby(); return; }
    if (room.started) return net.sendTo(from, { t: 'joinno', reason: 'Trận đã bắt đầu.' });
    if (room.roster.length >= cfg.MAX_PLAYERS || room.solo) return net.sendTo(from, { t: 'joinno', reason: 'Phòng đã đủ 5 người.' });
    room.roster.push({ id: from, name: cleanName(m.name || 'Bạn') || 'Bạn', fac: null, color: SHIRT, ready: false });
    net.sendTo(from, { t: 'joinok', code: room.code });
    pushLobby();
  } else if (m.t === 'pref' && r) {
    if (m.fac !== undefined) {
      if (m.fac === null || (FACULTIES.some((f) => f.id === m.fac) && !room.roster.some((x) => x !== r && x.fac === m.fac))) r.fac = m.fac;
    }
    if (!r.fac) r.ready = false;
    pushLobby();
  } else if (m.t === 'ready' && r) {
    r.ready = !!m.ready && !!r.fac;
    pushLobby();
  }
}
function pushLobby() {
  if (!room?.isHost) return;
  const msg = { t: 'lobby', roster: room.roster, code: room.code };
  net.broadcast(msg, true);
  onFromHost(net.id, msg);
}
function enterLobby() {
  show('lobby');
  $('roomCode').textContent = room.code;
  $('startBtn').classList.toggle('hidden', !room.isHost);
  renderLobby();
}
function renderLobby() {
  if (!room) return;
  const mine = room.roster.find((r) => r.id === net.id) || {};
  me.fac = mine.fac; me.color = mine.color || me.color;
  $('pCount').textContent = room.roster.length;
  $('roster').innerHTML = room.roster.map((r) => `<li data-id="${r.id}">${escapeHtml(r.name)}${r.id === net.id ? ' (bạn)' : ''}${r.id === room.hostId ? ' 👑' : ''}<span class="tag">${r.fac ? FACULTIES.find((f) => f.id === r.fac).name : 'chưa chọn khoa'} ${r.ready ? '<b class="ready">· sẵn sàng</b>' : ''}</span></li>`).join('');
  $('facList').innerHTML = FACULTIES.map((f) => {
    const taker = room.roster.find((r) => r.fac === f.id);
    return `<button data-fac="${f.id}" class="${mine.fac === f.id ? 'on' : taker ? 'taken' : ''}" ${taker && taker.id !== net.id ? 'disabled' : ''}>${f.name}${taker && taker.id !== net.id ? ' · ' + escapeHtml(taker.name) : ''}</button>`;
  }).join('');
  $('facList').querySelectorAll('[data-fac]').forEach((b) => (b.onclick = () => toHost({ t: 'pref', fac: mine.fac === b.dataset.fac ? null : b.dataset.fac })));
  $('readyBtn').disabled = !(mine.fac && micOk);
  $('readyBtn').textContent = mine.ready ? 'Huỷ sẵn sàng' : 'Sẵn sàng';
  $('readyBtn').classList.toggle('on', !!mine.ready);
  const n = room.roster.length, allReady = room.roster.every((r) => r.ready);
  const minP = room.solo ? 1 : cfg.MIN_PLAYERS;
  $('startBtn').disabled = !(n >= minP && allReady);
  $('lobbyMsg').textContent = !mine.fac ? 'Chọn khoa của bạn.' : !micOk ? 'Cần đồng ý ghi âm và kiểm tra mic.' : n < minP ? `Cần ít nhất ${minP} người.` : !allReady ? 'Chờ mọi người sẵn sàng…' : room.isHost ? 'Mọi người đã sẵn sàng.' : 'Chờ chủ phòng bắt đầu…';
}
$('readyBtn').onclick = () => { const mine = room.roster.find((r) => r.id === net.id); toHost({ t: 'ready', ready: !mine?.ready }); };
$('leaveBtn').onclick = () => leaveToMenu('');
$('copyLink').onclick = () => {
  const url = location.origin + location.pathname + '?room=' + room.code;
  navigator.clipboard?.writeText(url).then(() => { $('copyLink').textContent = 'Đã sao chép'; setTimeout(() => ($('copyLink').textContent = 'Sao chép link mời'), 1500); });
};
$('startBtn').onclick = () => {
  if (!room?.isHost) return;
  room.started = true;
  net.announce({ closed: true });
  const roster = room.roster.map((r) => ({ id: r.id, name: r.name, fac: r.fac, color: r.color }));
  host = new Host({ io: hostIO, world: buildCollisionOnly(), cfg, roster, solo: room.solo });
  hostIO.emit({ t: 'start', roster, cfg }, true);
};
function buildCollisionOnly() { return game ? game.world : null; }

// voice ở lobby: không có vị trí, mọi người nghe nhau rõ như đứng cạnh; hiện ai đang nói
setInterval(() => {
  if (game || !room) return;
  for (const id of voice.peers.keys()) voice.updatePeer(id, { x: 0, y: 0, z: -1 }, false, true);
  for (const li of $('roster').querySelectorAll('li[data-id]')) {
    const id = li.dataset.id;
    const lv = id === net.id ? (voice.capturing ? voice.level : 0) : voice.peerLevel(id);
    li.classList.toggle('talking', lv > 0.015);
    if (id !== net.id) {
      const st = net.peerStatus(id), el = li.querySelector('.link') || li.appendChild(Object.assign(document.createElement('span'), { className: 'link' }));
      const txt = st === 'p2p' ? '🔗 P2P' : st === 'relay' ? '📡 qua máy chủ' : '… đang nối';
      if (el.textContent !== txt) { el.textContent = txt; el.title = st === 'relay' ? 'Không nối trực tiếp được, giọng đi vòng qua máy chủ (trễ hơn một chút)' : ''; }
    }
  }
}, 150);

// ====================================================================== đồng ý + mic check
$('micBtn').onclick = () => { show('consent'); };
$('consentNo').onclick = () => { show('lobby'); $('micStatus').textContent = 'Bạn chưa đồng ý ghi âm nên chưa vào trận được.'; };
$('consentYes').onclick = async () => {
  consented = true;
  try {
    const track = await voice.initMic();
    for (const [id, s] of pendingStreams) voice.addPeer(id, s);
    pendingStreams.clear();
    net.setLocalTrack(track);
    voice.setTransmit(false);  // chưa vào trận: không phát, không ghi
    loadASR();
    micCheck();
  } catch (e) {
    show('lobby');
    $('micStatus').textContent = 'Không mở được mic: ' + e.message + '. Kiểm tra quyền micro của trình duyệt.';
  }
};
async function micCheck() {
  show('miccheck');
  dodgeClips.length = 0;
  let i = 0, skip = false, retry = false;
  $('mcSkip').onclick = () => { skip = true; voice.onceResolve?.(null); };
  $('mcRetry').onclick = () => { retry = true; voice.onceResolve?.(null); };
  const vu = setInterval(() => { $('vuBar').style.width = Math.min(100, voice.level * 900) + '%'; }, 80);
  while (i < DODGE_LINES.length) {
    $('mcLine').textContent = DODGE_LINES[i];
    $('mcLine').classList.add('rec');
    $('mcProg').textContent = `Câu ${i + 1}/${DODGE_LINES.length}`;
    voice.capturing = true;
    const f = await voice.captureOnce(10000);
    voice.capturing = false;
    $('mcLine').classList.remove('rec');
    if (retry) { retry = false; continue; }
    if (f) dodgeClips.push({ text: DODGE_LINES[i], f32: f });
    else if (!skip) { $('mcProg').textContent = 'Không nghe thấy gì, đọc lại nhé.'; await new Promise((r) => setTimeout(r, 900)); continue; }
    skip = false; i++;
  }
  clearInterval(vu);
  micOk = dodgeClips.length >= 4;
  $('micStatus').textContent = micOk ? `Mic ổn · đã thu ${dodgeClips.length} câu. Mic đang mở: mọi người trong phòng nghe được bạn${ptt ? ' khi giữ V' : ''}.` : 'Thu được quá ít câu, kiểm tra lại mic.';
  if (micOk) voice.setTransmit(!ptt);  // nói chuyện ở lobby
  show('lobby');
  renderLobby();
}
function loadASR() {
  if (asr) return;
  try {
    asr = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
  } catch (e) { $('aiStatus').textContent = 'Không chạy được nhận dạng giọng nói: ' + e.message; return; }
  const prog = {};
  asr.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'progress') {
      prog[d.file] = d; let a = 0, b = 0; for (const k in prog) { a += prog[k].loaded; b += prog[k].total; }
      $('aiStatus').textContent = `Đang tải mô hình nhận dạng giọng nói: ${(a / 1e6).toFixed(0)}/${(b / 1e6).toFixed(0)} MB (chỉ lần đầu)`;
    } else if (d.type === 'ready') { asrReady = true; $('aiStatus').textContent = `Nhận dạng giọng nói sẵn sàng (${d.model}, ${d.device === 'webgpu' ? 'GPU' : 'CPU'}).`; }
    else if (d.type === 'error') $('aiStatus').textContent = 'Lỗi tải mô hình: ' + d.error + '. Game vẫn chơi được, ma sẽ chỉ dùng câu thu lúc kiểm tra mic.';
    else if (d.type === 'result') { const cb = asrJobs.get(d.id); asrJobs.delete(d.id); if (cb) cb(d); }
  };
  asr.postMessage({ type: 'load', whisper: cfg.WHISPER_MODEL });
}
function asrRun(job) { return new Promise((res) => { if (!asr) return res({ text: job.text || '', emb: null }); asrJobs.set(job.id, res); asr.postMessage(job); }); }

// ====================================================================== tin nhắn từ host
function onFromHost(from, m) {
  switch (m.t) {
    case 'joinok': if (room && !room.isHost && !room.joined) { room.joined = true; room.hostId = from; $('menuMsg').textContent = ''; enterLobby(); } return;
    case 'joinno': if (room && !room.isHost) { $('menuMsg').textContent = m.reason; net.leaveRoom(); room = null; } return;
    case 'lobby': if (room && (room.isHost || from === room.hostId)) { room.roster = m.roster; if (!room.started) renderLobby(); } return;
    case 'start': startGame(m); return;
  }
  if (!game) return;
  switch (m.t) {
    case 'snap': onSnap(m); break;
    case 'ev': onEvent(m); break;
    case 'items': game.items = m.items; game.power = m.power; game.cabinetOpen = m.cabinet; game.map.setCabinetOpen(m.cabinet); game.map.setPower(m.power); syncItems(); break;
    case 'task': taskUI.open(m.view); document.exitPointerLock?.(); break;
    case 'task_r': taskUI.onQuery(m); break;
    case 'task_result': taskUI.onResult(m); break;
    case 'toast': toast(m.text); break;
    case 'gsay': onGhostSay(m); break;
    case 'dbg': renderDebug(m); break;
    case 'end': onEnd(m); break;
  }
}

// ====================================================================== clip giọng
let clipSeq = 1;
const chunkBuf = new Map();
function sendClip(id, f32, dodge, text, lobby = null) {
  const i16 = f32ToI16(f32);
  voice.storeClip(id, i16);
  const b64 = int16ToB64(i16), CH = 12000;
  const n = Math.ceil(b64.length / CH);
  for (let k = 0; k < n; k++) net.broadcast({ t: 'clipc', id, i: k, n, d: b64.slice(k * CH, (k + 1) * CH) }, true);
  toHost({ t: 'clipm', id, dodge, lobby: !!lobby, dur: +(f32.length / 16000).toFixed(2), text: dodge ? text : undefined });
  // clip thu ở lobby đã nhận dạng sẵn từ trước
  const job = lobby ? lobby.ready : asrRun(dodge ? { type: 'embed', id, text } : { type: 'asr', id, audio: f32 });
  job.then((r) => {
    toHost({ t: 'clipt', id, text: dodge ? text : r.text, emb: r.emb });
    if (game) game.myClips.push({ id, text: dodge ? text : r.text, ms: r.ms });
  });
}
function onClipChunk(from, m) {
  if (typeof m.id !== 'string' || !m.id.startsWith(from + ':')) return;  // chỉ nhận clip giọng của chính người gửi
  let e = chunkBuf.get(m.id);
  if (!e) { e = { n: m.n, parts: [], got: 0 }; chunkBuf.set(m.id, e); }
  if (e.parts[m.i] == null) { e.parts[m.i] = m.d; e.got++; }
  if (e.got === e.n) { chunkBuf.delete(m.id); voice.storeClip(m.id, b64ToInt16(e.parts.join(''))); }
}
// trò chuyện ở lobby cũng được thu (nhận dạng luôn, gửi cho host lúc vào trận)
const lobbyClips = [];
voice.onSegment = (f32) => {
  if (!game && room && !room.started && micOk) {
    const id = net.id + ':l' + clipSeq++;
    lobbyClips.push({ id, f32, ready: asrRun({ type: 'asr', id, audio: f32 }) });
    if (lobbyClips.length > 40) lobbyClips.shift();
    return;
  }
  if (!game || !game.alive || game.ended) return;
  sendClip(net.id + ':' + clipSeq++, f32, false);
};
function onGhostSay(m) {
  const g = game.ghosts.get(m.g);
  if (!g) return;
  const tryPlay = (left) => {
    if (voice.hasClip(m.clip)) { const it = voice.playClip(m.clip, m.g); if (it) g.voices.push(it); return; }
    if (left > 0) setTimeout(() => tryPlay(left - 1), 150);
  };
  tryPlay(20);
}

// ====================================================================== trận đấu: dựng cảnh
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 400);
camera.rotation.order = 'YXZ';
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function nightSky(scene) {
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.028);
  const stars = new THREE.BufferGeometry(), pos = [];
  for (let i = 0; i < 1500; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.45 * Math.PI;
    pos.push(Math.cos(th) * Math.cos(ph) * 300, Math.sin(ph) * 300 + 10, Math.sin(th) * Math.cos(ph) * 300);
  }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const sm = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.2, sizeAttenuation: false, fog: false }));
  scene.add(sm);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(12, 32), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
  moon.position.set(-200, 160, -120); moon.lookAt(0, 0, 0); scene.add(moon);
}

const taskUI = new TaskUI({
  send: (a) => toHost({ t: 'act', ...a }),
  onClose: () => { if (!locked && game) $('clickToPlay').classList.remove('hidden'); },
  sfx: (k) => voice.sfx(k),
});

function makeAvatar(color) {
  const a = new Avatar('', color);
  a.tag.visible = false;   // không hiện tên trên đầu (mục 6)
  a.shield.visible = false;
  return a;
}

function startGame(m) {
  if (game) return;
  if (room) room.started = true;
  Object.assign(cfg, m.cfg || {});
  const scene = new THREE.Scene();
  nightSky(scene);
  const world = new CollisionWorld(8);
  const map = buildNightMap(scene, world);
  scene.add(camera);
  const roster = m.roster;
  const myIdx = roster.findIndex((r) => r.id === net.id);
  const [sx, sz] = SPAWNS[Math.max(0, myIdx) % SPAWNS.length];
  // đèn pin của mình
  const flash = new THREE.SpotLight(0xfff2d8, 40, 30, 0.42, 0.45, 1.4);
  flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.camera.near = 0.2; flash.shadow.bias = -0.0008;
  flash.position.set(0.25, -0.2, 0); camera.add(flash); camera.add(flash.target); flash.target.position.set(0, -0.4, -5);
  // pool đèn pin cho người khác + ma (số đèn cố định để không phải biên dịch lại shader)
  const pool = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.SpotLight(0xfff2d8, 0, 24, 0.42, 0.5, 1.5);
    s.castShadow = true; s.shadow.mapSize.set(512, 512); s.shadow.bias = -0.001;
    scene.add(s); scene.add(s.target); pool.push(s);
  }
  // súng trên tay (view model)
  const vm = buildAwmMesh(0.55);
  vm.position.set(0.22, -0.24, -0.45); vm.visible = false; camera.add(vm);

  game = {
    scene, world, map, roster, pool, flash, vm,
    mover: new Mover(world),
    st: { pos: { x: sx, y: 0, z: sz }, vel: { x: 0, y: 0, z: 0 }, onGround: true },
    yaw: Math.PI, pitch: 0, crouch: false, flashOn: true, alive: true, ended: false,
    weapon: 0, gun: 0, hasKey: false,
    players: new Map(), ghosts: new Map(), items: [], itemMeshes: new Map(),
    tg: 0, phase: 1, done: [], locks: {}, power: false,
    myClips: [], spectating: null, lastSend: 0, steps: new Map(),
  };
  for (const r of roster) {
    if (r.id === net.id) continue;
    const av = makeAvatar(r.color);
    scene.add(av.root);
    game.players.set(r.id, { ...r, av, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, cr: 0, fl: 1, alive: true, w: 0, spd: 0, tx: 0, ty: 0, tz: 0, tyaw: 0 });
  }
  // host dùng chung CollisionWorld của client mình
  if (host) host.world = world;
  // gửi clip né đã thu lúc kiểm tra mic
  for (const d of dodgeClips) sendClip(net.id + ':d' + clipSeq++, d.f32, true, d.text);
  for (const c of lobbyClips.splice(0)) sendClip(c.id, c.f32, false, null, c);
  voice.setTransmit(!ptt);
  show(null);
  $('hud').classList.remove('hidden');
  $('clickToPlay').classList.remove('hidden');
  renderTasks();
  renderInv();
  if (DEBUG) toast('Debug: F1 mở bảng debug');
  toast(`Bạn là sinh viên khoa ${FACULTIES.find((f) => f.id === me.fac)?.name || '?'}. Xong 5 task, lấy chìa khoá cổng ở phòng bảo vệ, ra cổng trước 08:00.`, 8000);
}
function endGame() {
  if (!game) return;
  taskUI.close(false);
  game.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  camera.clear();
  game = null;
  $('hud').classList.add('hidden');
  $('debug').classList.add('hidden');
  voice.setTransmit(false);
}

// ====================================================================== đồng bộ
function onSnap(m) {
  game.tg = m.tg; game.phase = m.ph; game.done = m.done; game.locks = m.locks;
  if (!!m.power !== game.power) { game.power = !!m.power; game.map.setPower(game.power); }
  for (const a of m.ps) {
    const [id, x, y, z, yaw, pitch, cr, fl, alive, w, spd, key, gun] = a;
    if (id === net.id) { game.hasKey = !!key; if (game.gun !== gun) { game.gun = gun; renderInv(); } continue; }
    const p = game.players.get(id);
    if (!p) continue;
    p.tx = x; p.ty = y; p.tz = z; p.tyaw = yaw; p.pitch = pitch; p.cr = cr; p.fl = fl; p.w = w; p.spd = spd;
    if (!p.seen) { p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.seen = true; }
    p.alive = !!alive;
  }
  const seen = new Set();
  for (const a of m.gs) {
    const [id, imp, x, z, yaw, cr, fl, st, spd, pitch] = a;
    seen.add(id);
    let g = game.ghosts.get(id);
    const impP = game.roster.find((r) => r.id === imp);
    if (!g) {
      const av = makeAvatar(impP ? impP.color : '#888');
      game.scene.add(av.root);
      g = { id, imp, av, x, z, yaw, tx: x, tz: z, tyaw: yaw, voices: [] };
      game.ghosts.set(id, g);
    }
    if (g.imp !== imp && impP) { g.imp = imp; g.av.shirtMat.color.set(impP.color); }
    g.tx = x; g.tz = z; g.tyaw = yaw; g.cr = cr; g.fl = fl; g.st = st; g.spd = spd; g.tpitch = pitch || 0;
  }
  for (const [id, g] of game.ghosts) if (!seen.has(id)) { g.av.dispose(); game.ghosts.delete(id); }
  renderTasks();
}
function onEvent(m) {
  const P = (id) => game.roster.find((r) => r.id === id);
  switch (m.e) {
    case 'task_done': toast(`✔ Task ${TASK_NAMES[m.task]} xong${m.by === net.id ? '' : ''}.`); voice.sfx('ok'); if (m.task === 'ee') toast('Phòng bảo vệ đã có điện.'); break;
    case 'noise': voice.sfx(m.sound, { x: m.x, y: 1.2, z: m.z }); if (m.sound === 'smoke') smokeAt(m.x, m.z, m.lock); break;
    case 'cabinet': voice.sfx('cabinet', SPOTS.cabinet); break;
    case 'pick': voice.sfx('pick', posOf(m.by)); if (m.by === net.id) { if (m.kind === 'key') { game.hasKey = true; toast('Đã lấy chìa khoá cổng.'); } else { game.gun = m.ammo; toast(`Nhặt được súng (${m.ammo} viên). Bấm 2 để cầm.`); } renderInv(); } break;
    case 'shot': {
      voice.sfx('shot', { x: m.o[0], y: m.o[1], z: m.o[2] });
      tracer(m.o, m.end);
      if (m.by === net.id) { game.gun = m.ammo; renderInv(); }
      const sp = game.players.get(m.by); if (sp) sp.av.fire();
      break;
    }
    case 'ghost_dead': {
      voice.sfx('ghost_dead', { x: m.x, y: 1.2, z: m.z });
      const g = game.ghosts.get(m.g);
      if (g) { g.dying = performance.now(); for (const v of g.voices) try { v.src.stop(); } catch {} }
      break;
    }
    case 'grab': voice.sfx('grab', posOf(m.who)); if (m.who === net.id) grabbedFx(m.g); break;
    case 'death': {
      if (m.who === net.id) {
        game.alive = false; game.weapon = 0; game.hasKey = false; game.gun = 0;
        voice.setTransmit(false);  // người chết bị tắt mic
        voice.sfx('death');
        taskUI.close(false);
        $('fade').style.opacity = 1; setTimeout(() => ($('fade').style.opacity = 0), 1200);
        renderInv();
      } else {
        const p = game.players.get(m.who);
        if (p) p.alive = false;
      }
      break;
    }
    case 'phase': voice.sfx('phase'); break;
  }
}
function posOf(id) {
  if (id === net.id) return { x: game.st.pos.x, y: 1.4, z: game.st.pos.z };
  const p = game.players.get(id);
  return p ? { x: p.x, y: 1.4, z: p.z } : null;
}
function onEnd(m) {
  game.ended = true;
  voice.sfx(m.win ? 'win' : 'lose');
  document.exitPointerLock?.();
  $('endTitle').textContent = m.win ? 'Thắng! Kịp bảo vệ đồ án' : 'Thua';
  $('endText').textContent = m.text;
  setTimeout(() => show('end'), 1200);
}
$('againBtn').onclick = () => leaveToMenu('');
$('quitBtn').onclick = () => leaveToMenu('');

// ====================================================================== vật phẩm, hiệu ứng
const keyMat = new THREE.MeshLambertMaterial({ color: 0xffc94d, emissive: 0x332200 });
function syncItems() {
  const ids = new Set(game.items.map((i) => i.id));
  for (const [id, m] of game.itemMeshes) if (!ids.has(id)) { m.removeFromParent(); game.itemMeshes.delete(id); }
  for (const it of game.items) {
    if (game.itemMeshes.has(it.id)) continue;
    let m;
    if (it.kind === 'key') { m = new THREE.Group(); const a = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 16), keyMat); const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.025), keyMat); b.position.x = 0.13; m.add(a, b); }
    else { m = buildAwmMesh(0.45); m.rotation.y = Math.PI / 2; }
    m.position.set(it.x, it.y + 0.05, it.z);
    game.scene.add(m); game.itemMeshes.set(it.id, m);
  }
}
function tracer(o, e) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 }));
  game.scene.add(l);
  const flashL = new THREE.PointLight(0xffc070, 30, 12, 2); flashL.position.set(...o); game.scene.add(flashL);
  setTimeout(() => { l.removeFromParent(); g.dispose(); flashL.removeFromParent(); }, 90);
}
function smokeAt(x, z, sec) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x9aa39a, transparent: true, opacity: 0.35, depthWrite: false });
  const grp = new THREE.Group();
  for (let k = 0; k < 18; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random() * 1.5, 8, 6), mat); s.position.set(x + (Math.random() - 0.5) * 8, 0.8 + Math.random() * 2, z - 2 - Math.random() * 7); grp.add(s); }
  game.scene.add(grp);
  if (roomAt(game.st.pos.x, game.st.pos.z) === 'ch') toast('Khói độc! Rời phòng Hoá ngay.', 4000);
  setTimeout(() => grp.removeFromParent(), (sec || 30) * 1000);
}
function grabbedFx() {
  $('fade').style.background = '#300'; $('fade').style.opacity = 0.85;
  setTimeout(() => { $('fade').style.background = '#000'; }, 1100);
}

// ====================================================================== HUD
let toastT = 0;
function toast(text, ms = 4000) {
  const d = document.createElement('div'); d.textContent = text;
  $('toast').appendChild(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, ms);
  while ($('toast').children.length > 4) $('toast').firstChild.remove();
}
function renderTasks() {
  if (!game) return;
  const mineTask = FACULTIES.find((f) => f.id === me.fac)?.task;
  const html = TASK_IDS.map((t) => {
    const done = game.done.includes(t), lock = game.locks[t];
    return `<div class="${done ? 'done' : lock ? 'lock' : ''}">${done ? '☑' : '☐'} ${TASK_NAMES[t]}${t === mineTask ? ' ★' : ''}${lock ? ` (${lock}s)` : ''}</div>`;
  }).join('') + `<div class="${game.hasKey ? 'done' : ''}">${game.hasKey ? '☑' : '☐'} Chìa khoá cổng</div>`;
  if (html !== renderTasks.last) { $('taskList').innerHTML = html; renderTasks.last = html; }
  const c = clockText(cfg, game.tg);
  if ($('clock').textContent !== c) $('clock').textContent = c;
}
function renderInv() {
  if (!game) return;
  const parts = [];
  if (game.hasKey) parts.push('🔑 Chìa khoá cổng');
  if (game.gun > 0 || game.weapon === 1) parts.push(`🔫 ${game.gun} viên ${game.weapon === 1 ? '(đang cầm)' : '(bấm 2)'}`);
  parts.push(game.flashOn ? '🔦 Bật' : '🔦 Tắt');
  $('inv').innerHTML = parts.join('<br>');
}

// ====================================================================== điều khiển
const keys = {};
let ptt = false, sens = 1, locked = false;
try { ptt = localStorage.getItem('bkn_ptt') === '1'; sens = +localStorage.getItem('bkn_sens') || 1; } catch {}
$('pttIn').checked = ptt; $('sensIn').value = sens;
$('pttIn').onchange = () => { ptt = $('pttIn').checked; try { localStorage.setItem('bkn_ptt', ptt ? '1' : '0'); } catch {} if (game?.alive) voice.setTransmit(!ptt); };
$('sensIn').oninput = () => { sens = +$('sensIn').value; try { localStorage.setItem('bkn_sens', sens); } catch {} };
$('volIn').oninput = () => { if (voice.master) voice.master.gain.value = +$('volIn').value; };
$('resumeBtn').onclick = () => { $('pause').classList.add('hidden'); canvas.requestPointerLock(); };

canvas.addEventListener('click', () => { if (game && !taskUI.isOpen && !game.ended) { canvas.requestPointerLock(); voice.initAudio(); } });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!game) return;
  $('clickToPlay').classList.toggle('hidden', locked || taskUI.isOpen);
});
document.addEventListener('mousemove', (e) => {
  if (!locked || !game) return;
  if (game.alive) {
    game.yaw -= e.movementX * 0.0022 * sens;
    game.pitch = clamp(game.pitch - e.movementY * 0.0022 * sens, -1.45, 1.45);
  }
});
document.addEventListener('mousedown', (e) => {
  if (!locked || !game || e.button !== 0) return;
  if (!game.alive) { cycleSpectate(); return; }
  if (game.weapon === 1 && game.gun > 0) {
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    toHost({ t: 'act', a: 'shoot', o: [camera.position.x, camera.position.y, camera.position.z], d: [d.x, d.y, d.z] });
  }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'F1') { e.preventDefault(); if (DEBUG && game) toggleDebug(); return; }
  if (!game) { if (e.code === 'KeyV' && ptt && micOk && room) voice.setTransmit(true); return; }
  if (e.code === 'Escape' && taskUI.isOpen) { taskUI.close(); return; }
  keys[e.code] = true;
  if (['Space', 'ControlLeft', 'ControlRight', 'KeyF'].includes(e.code)) e.preventDefault();
  if (taskUI.isOpen || !game.alive) return;
  if (e.code === 'KeyF' && !e.repeat) { game.flashOn = !game.flashOn; voice.sfx('flash'); renderInv(); }
  if (e.code === 'KeyE' && !e.repeat) interact();
  if (e.code === 'Digit1') { game.weapon = 0; renderInv(); }
  if (e.code === 'Digit2' && game.gun >= 0 && (game.gun > 0 || game.weapon === 1)) { game.weapon = 1; renderInv(); }
  if (e.code === 'KeyV' && ptt) voice.setTransmit(true);
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyV' && ptt && (game ? game.alive : room)) voice.setTransmit(false);
});
document.addEventListener('pointerlockchange', () => {
  if (!locked && game && !taskUI.isOpen && !game.ended && game.wasLocked) $('pause').classList.remove('hidden');
  if (locked) { $('pause').classList.add('hidden'); game && (game.wasLocked = true); }
});

// ---- tương tác (E)
function nearestInteract() {
  const p = game.st.pos;
  const fx = -Math.sin(game.yaw), fz = -Math.cos(game.yaw);
  let best = null;
  const consider = (d, x, z, label, act, r = 2.4) => {
    const dx = x - p.x, dz = z - p.z, dist = Math.hypot(dx, dz);
    if (dist > r) return;
    const facing = (dx * fx + dz * fz) / (dist || 1);
    if (dist > 0.9 && facing < 0.2) return;
    const score = dist - facing;
    if (!best || score < best.score) best = { score, label, act };
  };
  for (const t of TASK_IDS) {
    if (game.done.includes(t)) continue;
    const s = SPOTS[t];
    consider(t, s.x, s.z, game.locks[t] ? `${s.label} (chờ ${game.locks[t]}s)` : `E: ${s.label} (task ${TASK_NAMES[t]})`, { a: 'task_open', task: t });
  }
  if (!game.cabinetOpen) consider('cab', SPOTS.cabinet.x, SPOTS.cabinet.z, game.power ? 'E: Mở tủ khoá' : 'Tủ khoá điện tử (mất điện)', { a: 'cabinet' });
  for (const it of game.items) consider('it', it.x, it.z, it.kind === 'key' ? 'E: Lấy chìa khoá cổng' : `E: Lấy súng (${it.ammo} viên)`, { a: 'pick', id: it.id }, 2.2);
  consider('gate', SPOTS.gate.x, SPOTS.gate.z, 'E: Mở cổng trường', { a: 'gate' }, 4.5);
  return best;
}
function interact() {
  const n = nearestInteract();
  if (n) toHost({ t: 'act', ...n.act });
}

// ---- khán giả (spectator)
function cycleSpectate() {
  const alive = [...game.players.values()].filter((p) => p.alive);
  if (!alive.length) { game.spectating = null; return; }
  const i = alive.findIndex((p) => p.id === game.spectating);
  game.spectating = alive[(i + 1) % alive.length].id;
}

// ====================================================================== debug (F1)
let dbgOn = false;
function toggleDebug() {
  dbgOn = !dbgOn;
  $('debug').classList.toggle('hidden', !dbgOn);
  toHost({ t: 'dbg', on: dbgOn });
}
function renderDebug(d) {
  if (!dbgOn) return;
  const esc = (s) => escapeHtml(String(s ?? ''));
  const lp = d.lastPick;
  $('debug').innerHTML = `
    <div><b>${d.clock}</b> · pha ${d.phase} · tốc độ x${d.speed} ${d.solo ? '· SOLO' : ''}
      <button data-ff="1">x1</button><button data-ff="10">x10</button><button data-ff="40">x40</button><button data-jump="30">+30 phút</button></div>
    <h4>Ma (${d.ghosts.length})</h4>
    <table><tr><th>#</th><th>trạng thái</th><th>giả dạng</th><th>mục tiêu</th><th>phòng</th><th>v</th></tr>
    ${d.ghosts.map((g) => `<tr><td>${g.id}</td><td>${g.state}</td><td>${esc(g.imp)}</td><td>${esc(g.target)}</td><td>${esc(g.room)}</td><td>${g.speed}</td></tr>`).join('')}</table>
    <h4>Người chơi</h4>
    <table>${d.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.alive ? 'sống' : 'chết'}</td><td>lẻ ${p.alone}s</td><td>${esc(p.room)}</td><td>${esc(p.task)}</td></tr>`).join('')}</table>
    <h4>Lần chọn clip gần nhất ${lp ? `(${lp.at}, ma #${lp.ghost})` : ''}</h4>
    ${lp ? `<div>q: ${esc(lp.q)}</div><table><tr><th>S</th><th>sim</th><th>ctx</th><th>rec</th><th>rep</th><th>text</th></tr>${lp.top.map((t) => `<tr${t.id === lp.chosen ? ' style="color:#5bd68a"' : ''}><td>${t.S}</td><td>${t.sim}</td><td>${t.ctx}</td><td>${t.rec}</td><td>${t.rep}</td><td>${esc(t.text)}</td></tr>`).join('')}</table><div>${lp.dodge ? '→ không đạt ngưỡng: phát clip né' : '→ phát clip điểm cao nhất'}</div>` : '<i>chưa có</i>'}
    <h4>Kho clip (${d.nClips})</h4>
    <table><tr><th>người</th><th>text</th><th>intent</th><th>heard</th><th>phòng</th></tr>
    ${d.clips.slice().reverse().map((c) => `<tr><td>${esc(c.spk)}</td><td>${c.dodge ? '[né] ' : ''}${c.text == null ? '<i>đang ASR…</i>' : esc(c.text)}</td><td>${esc(c.intent)}</td><td>${c.heard ? '✓' : ''}</td><td>${esc(c.room)}</td></tr>`).join('')}</table>
    <h4>Câu của bạn (ASR)</h4>
    <div>${game ? game.myClips.slice(-5).reverse().map((c) => `${esc(c.text)} <i>${c.ms ? c.ms + ' ms' : ''}</i>`).join('<br>') : ''}</div>
    <div>mạng: ${net.brokerUrl || ''} · P2P ${[...net.peers.values()].filter((p) => p.dcR?.readyState === 'open').length}/${net.peers.size}</div>`;
  $('debug').querySelectorAll('[data-ff]').forEach((b) => (b.onclick = () => toHost({ t: 'ff', speed: +b.dataset.ff })));
  $('debug').querySelectorAll('[data-jump]').forEach((b) => (b.onclick = () => toHost({ t: 'ff', speed: d.speed, jump: +b.dataset.jump })));
}

// ====================================================================== vòng lặp khung hình
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (!game) return;
  const now = performance.now();
  const st = game.st;
  // ---- di chuyển của mình
  if (game.alive && !game.ended) {
    const canMove = locked && !taskUI.isOpen;
    game.crouch = canMove && (keys.ControlLeft || keys.ControlRight || keys.KeyC);
    const run = canMove && (keys.ShiftLeft || keys.ShiftRight) && !game.crouch;
    const speed = game.crouch ? 2.0 : run ? 6.2 : 4.0;
    let ix = 0, iz = 0;
    if (canMove) { if (keys.KeyW) iz -= 1; if (keys.KeyS) iz += 1; if (keys.KeyA) ix -= 1; if (keys.KeyD) ix += 1; }
    const L = Math.hypot(ix, iz) || 1;
    const sy = Math.sin(game.yaw), cy = Math.cos(game.yaw);
    const wx = ((ix * cy + iz * sy) / L) * speed, wz = ((-ix * sy + iz * cy) / L) * speed;
    st.vel.x = damp(st.vel.x, wx, 14, dt); st.vel.z = damp(st.vel.z, wz, 14, dt);
    st.vel.y -= 20 * dt;
    game.mover.move(st, dt, game.crouch ? 1.2 : 1.8);
    game.eye = damp(game.eye ?? 1.62, game.crouch ? 1.05 : 1.62, 12, dt);
    camera.position.set(st.pos.x, st.pos.y + game.eye, st.pos.z);
    camera.rotation.set(game.pitch, game.yaw, 0);
    const spd = Math.hypot(st.vel.x, st.vel.z);
    game.spd = spd;
    // bước chân của mình
    game.stepT = (game.stepT || 0) + dt * spd;
    if (game.stepT > (run ? 2.2 : 1.7) && !game.crouch) { game.stepT = 0; voice.sfx('step', { x: st.pos.x, y: 0, z: st.pos.z }); }
    // gửi trạng thái 20 lần/s
    if (now - game.lastSend > 50) {
      game.lastSend = now;
      toHost({ t: 'st', x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2), z: +st.pos.z.toFixed(2), yaw: +game.yaw.toFixed(3), pitch: +game.pitch.toFixed(3), cr: game.crouch ? 1 : 0, fl: game.flashOn ? 1 : 0, spd: +spd.toFixed(2), w: game.weapon }, false);
    }
    // mic: open mic / push-to-talk
    $('micInd').classList.toggle('on', voice.capturing && voice.level > 0.01);
    $('micInd').classList.toggle('off', !voice.capturing);
  } else if (!game.alive) {
    // khán giả: theo người còn sống
    if (!game.spectating || !game.players.get(game.spectating)?.alive) cycleSpectate();
    const t = game.players.get(game.spectating);
    if (t) {
      camera.position.set(t.x + Math.sin(t.yaw) * 2.6, 2.4, t.z + Math.cos(t.yaw) * 2.6);
      camera.lookAt(t.x, 1.3, t.z);
      $('spectate').innerHTML = `Bạn đã chết · đang xem <b>${escapeHtml(t.name)}</b> · mic đã tắt<br><span class="muted">Bấm chuột để đổi người</span>`;
    } else $('spectate').textContent = 'Bạn đã chết · không còn ai sống';
    $('spectate').classList.remove('hidden');
    $('micInd').classList.add('off');
  }
  game.flash.intensity = game.alive && game.flashOn ? 40 : 0;
  game.vm.visible = game.alive && game.weapon === 1;
  if (game.vm.visible) game.vm.position.y = -0.24 + Math.sin(now * 0.008) * 0.004 * Math.min(1, (game.spd || 0) / 4);

  // ---- người khác
  const lis = camera.position;
  const lights = [];
  for (const p of game.players.values()) {
    p.x = damp(p.x, p.tx, 14, dt); p.y = damp(p.y, p.ty, 14, dt); p.z = damp(p.z, p.tz, 14, dt); p.yaw = lerpAngle(p.yaw, p.tyaw, 1 - Math.exp(-14 * dt));
    p.av.root.visible = p.alive && p.seen;
    if (p.alive) p.av.update(dt, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, speed: p.spd, crouch: !!p.cr, weapon: p.w === 1 ? 1 : 0, protected: false });
    if (p.w !== 1) { p.av.gun.visible = false; relaxArms(p.av); }
    const d = Math.hypot(p.x - lis.x, p.z - lis.z);
    const occ = wallBetween(lis.x, lis.z, p.x, p.z);
    voice.updatePeer(p.id, { x: p.x, y: p.y + 1.6, z: p.z }, occ, p.alive && d < cfg.R_HEAR);
    if (p.alive && p.fl) lights.push({ x: p.x, y: p.y + (p.cr ? 1.0 : 1.5), z: p.z, yaw: p.yaw, pitch: p.pitch, d });
    stepSound(p.id, p, dt, d, p.alive && !p.cr ? p.spd : 0);
  }
  // ---- ma
  for (const g of game.ghosts.values()) {
    g.x = damp(g.x, g.tx, 12, dt); g.z = damp(g.z, g.tz, 12, dt); g.yaw = lerpAngle(g.yaw, g.tyaw, 1 - Math.exp(-12 * dt));
    const dying = g.dying ? (now - g.dying) / 1200 : 0;
    g.av.root.visible = dying < 1;
    g.pitch = damp(g.pitch || 0, g.tpitch || 0, 12, dt);
    g.av.update(dt, { x: g.x, y: 0, z: g.z, yaw: g.yaw, pitch: g.pitch, speed: g.spd || 0, crouch: !!g.cr, weapon: 0, protected: false });
    if (g.st === 2) g.av.arms.forEach((a) => a.rotation.set(1.5, 0, 0)); else relaxArms(g.av);
    if (dying) { g.av.root.scale.setScalar(Math.max(0.01, 1 - dying)); g.av.root.position.y = dying * 1.5; }
    const d = Math.hypot(g.x - lis.x, g.z - lis.z);
    const occ = wallBetween(lis.x, lis.z, g.x, g.z);
    g.voices = g.voices.filter((v) => voice.playing.includes(v));
    for (const v of g.voices) voice.place(v, { x: g.x, y: 1.6, z: g.z }, occ, d < cfg.R_HEAR);
    if (g.fl && !dying) lights.push({ x: g.x, y: g.cr ? 1.0 : 1.5, z: g.z, yaw: g.yaw, pitch: g.pitch || 0, d });
    stepSound('g' + g.id, g, dt, d, g.cr ? 0 : g.spd || 0);
  }
  lights.sort((a, b) => a.d - b.d);
  game.pool.forEach((s, i) => {
    const l = lights[i];
    if (!l || l.d > 40) { s.intensity = 0; return; }
    s.intensity = 30;
    s.position.set(l.x - Math.sin(l.yaw) * 0.3, l.y, l.z - Math.cos(l.yaw) * 0.3);
    s.target.position.set(l.x - Math.sin(l.yaw) * 5, l.y + Math.sin(l.pitch) * 5 - 0.6, l.z - Math.cos(l.yaw) * 5);
  });
  voice.updateListener(camera);
  for (const m of game.itemMeshes.values()) m.rotation.y += dt;
  // ---- gợi ý tương tác
  const n = game.alive && !taskUI.isOpen ? nearestInteract() : null;
  $('prompt').classList.toggle('hidden', !n);
  if (n) $('prompt').textContent = n.label;
  if (game.alive) $('spectate').classList.add('hidden');
  if (game.lastHud === undefined || now - game.lastHud > 250) { game.lastHud = now; renderTasks(); }
  renderer.render(game.scene, camera);
}
// tay buông thả và vung theo bước chân (Avatar gốc chỉ có tư thế cầm súng / đấm)
function relaxArms(av) {
  const mv = Math.min(1, av.speed / 4), sw = Math.sin(av.walk) * 0.6 * mv;
  av.arms[0].rotation.set(sw, 0, -0.08);
  av.arms[1].rotation.set(-sw, 0, 0.08);
  av.knife.visible = false;
}
function stepSound(key, e, dt, d, spd) {
  if (d > 22 || spd < 0.5) return;
  const t = (game.steps.get(key) || 0) + dt * spd;
  if (t > 1.8) { game.steps.set(key, 0); voice.sfx('step', { x: e.x, y: 0, z: e.z }); } else game.steps.set(key, t);
}
frame();

// tiện cho kiểm thử tự động
window.__night = { net, voice, get game() { return game; }, get host() { return host; }, get room() { return room; }, cfg, toHost, sendClip };
