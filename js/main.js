import * as THREE from 'three';
import { CollisionWorld, Mover } from './physics.js';
import { buildMap, BOUNDS } from './map.js';
import { Avatar, Debris, rayPlayer } from './avatar.js';
import { ViewModel } from './viewmodel.js';
import { VFX } from './vfx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { HUD } from './hud.js';
import { clamp, damp, lerp, lerpAngle, angleDiff, cleanName, escapeHtml, r2, r3 } from './util.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const TEST = qs.has('test');
const COLORS = ['#1e88e5', '#e53935', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#6d4c41', '#eceff1'];

// ---------------- weapons tuning ----------------
const FIST = { dmg: 25, head: 35, range: 2.7, cd: 420 };
const AWM = { head: 250, body: 85, legs: 65, mag: 5, cd: 1350, reload: 2800, switch: 550 };
const MAX_HP = 100;
const KILL_HEAL = 25;

// ---------------- settings ----------------
const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('bkbg.settings') || '{}'); } catch {}
  return Object.assign({ name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], sens: 1, vol: 0.8, low: false }, s);
})();
function saveSettings() { try { localStorage.setItem('bkbg.settings', JSON.stringify(settings)); } catch {} }

// ---------------- loading UI ----------------
const loadFill = $('loadFill'), loadText = $('loadText');
const setLoad = (p, t) => { loadFill.style.width = p + '%'; if (t) loadText.textContent = t; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------------- renderer / scene ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !settings.low, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.low ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !settings.low;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 260, 950);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 2200);
camera.rotation.order = 'YXZ';

const sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
{
  const g = new THREE.SphereGeometry(1500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d86d6) }, horizon: { value: new THREE.Color(0xd4e6f4) }, bottom: { value: new THREE.Color(0x9fb3c2) }, sunDir: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = mix(horizon, top, pow(max(h,0.0),0.55)); c = mix(c, bottom, clamp(-h*5.0,0.0,1.0));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.92,0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(g, m);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  scene.userData.sky = sky;
}
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x7a7563, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = !settings.low;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
function setShadowArea(r) {
  const c = sun.shadow.camera;
  if (c.right === r) return;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = 500;
  c.updateProjectionMatrix();
}
setShadowArea(75);

// ---------------- systems ----------------
const world = new CollisionWorld(8);
const mover = new Mover(world);
let map, hud, vm, vfx, debris;
const audio = new Audio();
audio.setVolume(settings.vol);
const net = new Net(qs.get('room'));
const peers = new Map();

// ---------------- local player ----------------
const me = {
  name: '', color: settings.color, alive: false, hp: MAX_HP, kills: 0, deaths: 0,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false,
  yaw: 0, pitch: 0, crouching: false, crouchV: 0, weapon: 1, ammo: AWM.mag,
  nextFire: 0, reloadEnd: 0, reloadStart: 0, switchUntil: 0, ads: 0, protectedUntil: 0,
  lastDamage: 0, recoil: 0, shake: 0, stepAcc: 0, landDip: 0, killerId: null,
};
let state = 'loading';
const keys = {};
let mouseDX = 0, mouseDY = 0, lookDX = 0, lookDY = 0;
let firing = false, adsHeld = false, showBoard = false;
let deathUntil = 0, deathStart = 0, deathPos = new THREE.Vector3();
const feed = [];

// ---------------- boot ----------------
(async function boot() {
  try {
    setLoad(10, 'Đang dựng khuôn viên trường…');
    await nextFrame();
    map = buildMap(scene, world, { lowGfx: settings.low });
    setLoad(55, 'Đang chuẩn bị vũ khí…');
    await nextFrame();
    hud = new HUD(map.minimap);
    vm = new ViewModel();
    vm.setColor(me.color);
    vfx = new VFX(scene);
    vfx.setScale(window.innerHeight);
    debris = new Debris(scene);
    onResize();
    // warm up shaders
    renderer.compile(scene, camera);
    setLoad(75, 'Đang kết nối máy chủ…');
    setupLobby();
    lobbyCam(0);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    setLoad(100, 'Xong!');
    await nextFrame();
    $('loading').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    state = 'lobby';
    connectNet();
  } catch (e) {
    console.error(e);
    setLoad(100, 'Lỗi khi tải game: ' + e.message);
  }
})();

async function connectNet() {
  net.onMessage = onNetMessage;
  net.onLeave = removePeer;
  net.onStatus = () => updateNetBadge();
  try {
    await net.connect();
  } catch (e) {
    console.error(e);
    $('playSub').textContent = 'Không kết nối được mạng, đang thử lại…';
    setTimeout(connectNet, 3000);
    return;
  }
  sendHello();
  updateNetBadge();
  $('playBtn').disabled = false;
  $('playSub').textContent = 'Nhấn để xuất hiện trong khuôn viên';
}
function updateNetBadge() {
  const b = $('netBadge');
  if (!net.connected) { b.textContent = 'Mất kết nối'; b.className = 'badge'; return; }
  const n = peers.size + 1;
  b.textContent = `${n} người · ${net.mode === 'server' ? 'Server' : 'Relay'}${net.ping ? ' · ' + net.ping + 'ms' : ''}`;
  b.className = 'badge ' + (net.ping && net.ping < 120 ? 'good' : 'mid');
}

// ---------------- lobby ----------------
function setupLobby() {
  const nameInput = $('nameInput');
  nameInput.value = settings.name;
  nameInput.addEventListener('input', () => { settings.name = nameInput.value; saveSettings(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('playBtn').click(); e.stopPropagation(); });
  const row = $('colorRow');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    if (c === me.color) b.classList.add('on');
    b.onclick = () => {
      me.color = settings.color = c; saveSettings();
      row.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      vm.setColor(c); audio.ui(); sendHello();
    };
    row.appendChild(b);
  }
  const sens = $('sensInput'), sensOut = $('sensOut');
  sens.value = settings.sens; sensOut.textContent = (+settings.sens).toFixed(2);
  sens.oninput = () => { settings.sens = +sens.value; sensOut.textContent = (+sens.value).toFixed(2); saveSettings(); };
  const vol = $('volInput'), volOut = $('volOut');
  vol.value = settings.vol; volOut.textContent = Math.round(settings.vol * 100) + '%';
  vol.oninput = () => { settings.vol = +vol.value; volOut.textContent = Math.round(vol.value * 100) + '%'; audio.setVolume(settings.vol); saveSettings(); };
  const low = $('lowGfx');
  low.checked = settings.low;
  low.onchange = () => { settings.low = low.checked; saveSettings(); location.reload(); };
  $('playBtn').onclick = () => { if (!net.connected) return; audio.init(); audio.ui(); spawn(); };
  $('resumeBtn').onclick = () => { lockPointer(); };
  $('leaveBtn').onclick = () => { leaveToLobby(); };
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('mobileWarn').classList.remove('hidden');
  const credit = document.querySelector('.credit');
  credit.innerHTML += ' · Tham khảo bố cục: <a href="https://sketchfab.com/3d-models/truong-dai-hoc-bach-khoa-631462b7ccd5432a88ccea48a85aeb0e" target="_blank" rel="noopener" style="color:#8fc7ff;pointer-events:auto">mô hình của PORTCOAST trên Sketchfab</a>';
  renderLobby();
}
function renderLobby() {
  const list = $('lobbyList');
  const rows = allPlayers();
  if (!rows.length) list.innerHTML = '<li class="empty">Chưa có ai…</li>';
  list.innerHTML = rows.map((r) => `<li><span class="dot" style="background:${r.color}"></span><span class="name">${escapeHtml(r.name)}${r.me ? '<em>(bạn)</em>' : ''}${r.alive ? '<em>đang chiến</em>' : ''}</span><span class="kd"><b>${r.kills}</b> hạ · ${r.deaths} chết</span></li>`).join('');
  $('lobbyFeed').innerHTML = feed.slice(0, 12).map((f) => `<li>${f}</li>`).join('') || '<li>Chưa có diễn biến nào. Vào trận và mở màn đi!</li>';
}
function allPlayers() {
  const rows = [{ name: myName(), color: me.color, kills: me.kills, deaths: me.deaths, alive: me.alive, me: true }];
  for (const p of peers.values()) rows.push({ name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, alive: p.alive });
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return rows;
}
function myName() { return cleanName(settings.name); }

// ---------------- spawn / death ----------------
function spawn() {
  const enemies = [];
  for (const p of peers.values()) if (p.alive && p.last) enemies.push(p.last);
  let cands = map.spawns.map((s) => {
    let d = 400;
    for (const e of enemies) d = Math.min(d, Math.hypot(e.x - s.x, e.z - s.z));
    return { s, d };
  });
  cands.sort((a, b) => b.d - a.d);
  const pick = cands[Math.floor(Math.random() * Math.min(cands.length, enemies.length ? 6 : cands.length))].s;
  me.pos.set(pick.x, 0, pick.z);
  me.vel.set(0, 0, 0);
  me.yaw = Math.atan2(pick.x, pick.z); // face campus centre
  me.pitch = 0;
  me.hp = MAX_HP; me.ammo = AWM.mag; me.weapon = 1; me.reloadEnd = 0; me.nextFire = 0; me.ads = 0;
  me.alive = true; me.crouching = false; me.crouchV = 0;
  me.protectedUntil = performance.now() + 2500;
  me.switchUntil = 0; me.lastDamage = 0; me.recoil = 0;
  vm.setWeapon(1); vm.switchT = 0;
  state = 'playing';
  net.send({ t: 'spawn', p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)] });
  sendHello();
  sendState(true);
  vfx.spawnFx(me.pos);
  audio.spawn();
  $('lobby').classList.add('hidden');
  $('death').classList.add('hidden');
  hud.show(true);
  hud.setHP(me.hp);
  hud.setWeapon(me.weapon, me.ammo);
  hud.center('VÀO TRẬN!', 'Hạ gục đối thủ để hồi 25 HP');
  lockPointer();
}
function lockPointer() {
  if (TEST) { $('pause').classList.add('hidden'); return; }
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch {} });
  } catch { try { canvas.requestPointerLock(); } catch {} }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) $('pause').classList.add('hidden');
  else if (state === 'playing') { $('pause').classList.remove('hidden'); firing = false; adsHeld = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('pointerlockerror', () => { if (state === 'playing') $('pause').classList.remove('hidden'); });

function die(killerId, m) {
  if (!me.alive) return;
  me.alive = false;
  me.hp = 0;
  me.deaths++;
  state = 'dead';
  deathStart = performance.now();
  deathUntil = deathStart + 4200;
  deathPos.copy(me.pos);
  me.killerId = killerId;
  net.send({ t: 'die', k: killerId, w: m.w, hs: m.hs ? 1 : 0, dist: m.dist || 0, p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)] });
  sendHello();
  const killer = peers.get(killerId);
  addKill(killer ? killer : { name: '???', color: '#fff' }, { name: myName(), color: me.color }, m.w, m.hs, false, m.dist);
  if (killer) killer.kills++;
  audio.death();
  vfx.deathFx(me.pos);
  hud.show(false);
  hud.setScope(false);
  $('pause').classList.add('hidden');
  $('death').classList.remove('hidden');
  $('deathBy').innerHTML = killer ? `bởi <span style="color:${killer.color}">${escapeHtml(killer.name)}</span>` : '';
  $('deathInfo').textContent = [m.w === 'fist' ? 'Nắm đấm' : 'AWM', m.hs ? 'Headshot' : '', m.dist ? `${Math.round(m.dist)} m` : ''].filter(Boolean).join(' · ');
}
function leaveToLobby() {
  if (state === 'playing') {
    me.alive = false;
    net.send({ t: 'despawn' });
    sendHello();
  }
  state = 'lobby';
  hud.show(false);
  hud.setScope(false);
  $('pause').classList.add('hidden');
  $('death').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  renderLobby();
}

// ---------------- input ----------------
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'Tab') { e.preventDefault(); showBoard = true; }
  if (state !== 'playing') return;
  keys[e.code] = true;
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'KeyQ') switchWeapon(me.weapon ? 0 : 1);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space' || e.code === 'KeyC') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Tab') showBoard = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; adsHeld = false; showBoard = false; });
addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  if (document.pointerLockElement === canvas || TEST) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; }
});
addEventListener('mousedown', (e) => {
  if (state !== 'playing' || (document.pointerLockElement !== canvas && !TEST)) return;
  if (e.button === 0) { firing = true; tryFire(); }
  if (e.button === 2) adsHeld = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) adsHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (state === 'playing' && document.pointerLockElement === canvas) switchWeapon(me.weapon ? 0 : 1); });
addEventListener('resize', onResize);
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (vm) vm.resize(w / h);
  if (vfx) vfx.setScale(h);
}
addEventListener('beforeunload', () => net.leave());

// ---------------- weapons ----------------
function switchWeapon(w) {
  if (w === me.weapon || !me.alive) return;
  me.weapon = w;
  me.switchUntil = performance.now() + AWM.switch;
  me.reloadEnd = 0;
  vm.reload(0.0001); vm.reloadT = 1;
  vm.setWeapon(w);
  hud.setWeapon(w, me.ammo);
  hud.setReload(-1);
  audio.ui();
}
function startReload() {
  const now = performance.now();
  if (me.weapon !== 1 || me.ammo >= AWM.mag || me.reloadEnd > now || !me.alive) return;
  me.reloadStart = now;
  me.reloadEnd = now + AWM.reload;
  vm.reload(AWM.reload / 1000);
  audio.reload();
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Vector3();
function aimDir(out) { return out.set(0, 0, -1).applyEuler(camera.rotation); }
function tryFire() {
  const now = performance.now();
  if (!me.alive || now < me.switchUntil) return;
  me.protectedUntil = Math.min(me.protectedUntil, now); // firing ends spawn protection
  if (me.weapon === 0) {
    if (now < me.nextFire) return;
    me.nextFire = now + FIST.cd;
    vm.punch();
    audio.swing(null);
    net.send({ t: 'p' });
    _o.copy(camera.position); aimDir(_d);
    const wall = world.raycast(_o, _d, FIST.range, (b) => b.bullet);
    const maxT = wall ? wall.t : FIST.range;
    let best = null;
    for (const p of peers.values()) {
      if (!p.alive || !p.pose) continue;
      const h = rayPlayer(_o, _d, p.pose, p.pose.yaw, p.pose.crouch, maxT);
      if (h && (!best || h.t < best.t)) best = { p, t: h.t, part: h.part };
    }
    if (!best) {
      // generous cone for melee
      for (const p of peers.values()) {
        if (!p.alive || !p.pose) continue;
        _e.set(p.pose.x, p.pose.y + (p.pose.crouch ? 0.8 : 1.15), p.pose.z).sub(_o);
        const dist = _e.length();
        if (dist > FIST.range + 0.3 || dist > maxT + 0.4) continue;
        if (_e.normalize().dot(_d) > 0.82 && (!best || dist < best.t)) best = { p, t: dist, part: 'body' };
      }
    }
    if (best) {
      const head = best.part === 'head';
      _e.copy(_o).addScaledVector(_d, best.t);
      dealDamage(best.p, head ? FIST.head : FIST.dmg, head, 'fist', best.t);
      vfx.punchHit(_e);
      audio.punchHit(null);
      me.shake = Math.max(me.shake, 0.3);
    } else if (wall) {
      _e.copy(_o).addScaledVector(_d, wall.t);
      vfx.impact(_e, wall.normal, wall.mat);
      audio.punchHit(null);
    }
    return;
  }
  // AWM
  if (me.reloadEnd > now || now < me.nextFire) return;
  if (me.ammo <= 0) { audio.dry(); startReload(); return; }
  me.ammo--;
  me.nextFire = now + AWM.cd;
  const hs = Math.hypot(me.vel.x, me.vel.z);
  const scoped = me.ads > 0.92;
  let spread = scoped ? 0 : 0.055;
  spread += (hs / 6) * (scoped ? 0.012 : 0.03);
  if (!me.onGround) spread += 0.07;
  if (me.crouching) spread *= 0.6;
  _o.copy(camera.position); aimDir(_d);
  if (spread > 0) {
    _r.set(1, 0, 0).applyEuler(camera.rotation); _u.set(0, 1, 0).applyEuler(camera.rotation);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _d.addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
  }
  const wall = world.raycast(_o, _d, 1500, (b) => b.bullet);
  let maxT = wall ? wall.t : 1500;
  let best = null;
  for (const p of peers.values()) {
    if (!p.alive || !p.pose) continue;
    const h = rayPlayer(_o, _d, p.pose, p.pose.yaw, p.pose.crouch, maxT);
    if (h && (!best || h.t < best.t)) best = { p, t: h.t, part: h.part };
  }
  const endT = best ? best.t : maxT;
  _e.copy(_o).addScaledVector(_d, endT);
  // muzzle position (world)
  _r.set(1, 0, 0).applyEuler(camera.rotation); _u.set(0, 1, 0).applyEuler(camera.rotation);
  aimDir(_m);
  const muzzle = new THREE.Vector3().copy(camera.position).addScaledVector(_m, scoped ? 0.8 : 1.15).addScaledVector(_r, scoped ? 0 : 0.2).addScaledVector(_u, scoped ? -0.12 : -0.2);
  // start the visible tracer a bit ahead of the eye so it never fills the screen
  const tStart = muzzle.clone().addScaledVector(_d, scoped ? 4 : 1.5);
  if (tStart.distanceTo(_o) < endT) vfx.tracer(tStart, _e, 0xffe7a8, scoped ? 0.015 : 0.02);
  vfx.light.position.copy(muzzle); vfx.lightT = 0;
  if (best) {
    const head = best.part === 'head';
    const dmg = head ? AWM.head : best.part === 'legs' ? AWM.legs : AWM.body;
    vfx.blood(_e, _d, head);
    dealDamage(best.p, dmg, head, 'awm', best.t);
  } else if (wall) {
    vfx.impact(_e, wall.normal, wall.mat);
  }
  net.send({ t: 'f', w: 1, o: [r2(muzzle.x), r2(muzzle.y), r2(muzzle.z)], e: [r2(_e.x), r2(_e.y), r2(_e.z)], h: best ? 1 : 0, n: !best && wall ? wall.normal : undefined, m: !best && wall ? wall.mat : undefined });
  me.recoil += 0.055;
  me.shake = Math.max(me.shake, 0.6);
  vm.fire();
  audio.awm(null);
  if (me.ammo > 0) audio.bolt(0.35);
  else setTimeout(() => { if (me.alive && me.weapon === 1) startReload(); }, 600);
  hud.setWeapon(me.weapon, me.ammo);
}
function dealDamage(p, dmg, head, weapon, dist) {
  if (p.protected) { vfx.ring(new THREE.Vector3(p.pose.x, p.pose.y + 1, p.pose.z), 0x5cf0a0); return; }
  net.send({ t: 'dmg', v: p.id, d: dmg, hs: head ? 1 : 0, w: weapon, dist: Math.round(dist), from: [r2(me.pos.x), r2(me.pos.y + 1.5), r2(me.pos.z)] });
  hud.hit(head ? 'head' : 'body');
  audio.hitmarker(head);
}

// ---------------- network ----------------
let lastStateSent = 0, lastHello = 0, lastPing = 0;
function sendHello() {
  lastHello = performance.now();
  net.send({ t: 'h', n: myName(), c: me.color, k: me.kills, d: me.deaths, a: me.alive ? 1 : 0 });
}
function sendState(force) {
  const now = performance.now();
  const interval = net.mode === 'server' ? 50 : 80;
  if (!force && now - lastStateSent < interval) return;
  lastStateSent = now;
  net.send({
    t: 's', ts: Math.round(now), p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)], r: r3(me.yaw), x: r3(me.pitch + me.recoil),
    w: me.weapon, c: me.crouching ? 1 : 0, sp: r2(Math.hypot(me.vel.x, me.vel.z)), pr: now < me.protectedUntil ? 1 : 0, g: me.onGround ? 1 : 0,
  });
}
function getPeer(id) {
  let p = peers.get(id);
  if (!p) {
    p = { id, name: 'Người chơi', color: '#bbbbbb', kills: 0, deaths: 0, alive: false, buf: [], avatar: null, offset: null, pose: null, last: null, lastSeen: performance.now(), protected: false, stepAcc: 0 };
    peers.set(id, p);
    // let newcomers know who we are quickly
    if (performance.now() - lastHello > 300) sendHello();
    if (me.alive) sendState(true);
    updateNetBadge();
    if (state === 'lobby') renderLobby();
  }
  p.lastSeen = performance.now();
  return p;
}
function removePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  if (p.avatar) { p.avatar.dispose(); p.avatar = null; }
  peers.delete(id);
  updateNetBadge();
  if (state === 'lobby') renderLobby();
}
function ensureAvatar(p) {
  if (!p.avatar) { p.avatar = new Avatar(p.name, p.color); scene.add(p.avatar.root); }
  return p.avatar;
}
function killAvatar(p, dir) {
  if (p.avatar) {
    debris.burst(p.avatar, dir);
    vfx.deathFx(p.avatar.root.position);
    audio.oof(p.avatar.root.position);
    p.avatar.dispose();
    p.avatar = null;
  }
  p.alive = false;
  p.buf.length = 0;
  p.pose = null;
}
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function onNetMessage(from, m) {
  if (!m || typeof m.t !== 'string') return;
  const p = getPeer(from);
  const now = performance.now();
  switch (m.t) {
    case 'h': {
      const name = cleanName(m.n), color = /^#[0-9a-f]{6}$/i.test(m.c) ? m.c : '#bbbbbb';
      p.name = name; p.color = color;
      p.kills = m.k | 0; p.deaths = m.d | 0;
      if (p.avatar) p.avatar.setName(name, color);
      if (!m.a && p.alive) killAvatar(p, null);
      if (m.a) p.alive = true;
      if (state === 'lobby') renderLobby();
      break;
    }
    case 's': {
      if (!Array.isArray(m.p)) return;
      const o = now - m.ts;
      if (p.offset === null || o < p.offset || Math.abs(o - p.offset) > 1500) p.offset = o;
      else p.offset += (o - p.offset) * 0.01;
      const s = { t: m.ts + p.offset, x: +m.p[0], y: +m.p[1], z: +m.p[2], yaw: +m.r || 0, pitch: +m.x || 0, w: m.w ? 1 : 0, c: !!m.c, sp: +m.sp || 0, pr: !!m.pr, g: !!m.g };
      if (!isFinite(s.x + s.y + s.z)) return;
      p.buf.push(s);
      if (p.buf.length > 40) p.buf.shift();
      p.last = s;
      if (!p.alive) { p.alive = true; if (state === 'lobby') renderLobby(); }
      break;
    }
    case 'spawn': {
      p.alive = true; p.buf.length = 0;
      if (Array.isArray(m.p)) vfx.spawnFx(v3(m.p));
      if (state === 'lobby') renderLobby();
      break;
    }
    case 'despawn': killAvatar(p, null); if (state === 'lobby') renderLobby(); break;
    case 'f': {
      if (!Array.isArray(m.o) || !Array.isArray(m.e)) return;
      const o = v3(m.o), e = v3(m.e);
      const dir = e.clone().sub(o).normalize();
      vfx.tracer(o, e);
      vfx.muzzle(o, dir);
      audio.awm(o);
      if (m.h) vfx.blood(e, dir, false);
      else if (Array.isArray(m.n)) vfx.impact(e, m.n, m.m);
      if (p.avatar) p.avatar.fire();
      hud.ping(o.x, o.z);
      // bullet whiz if it passed close to my head
      if (me.alive) {
        const cp = closestOnSeg(o, e, camera.position);
        const d = cp.distanceTo(camera.position);
        if (d < 4 && d > 0.3) audio.noise(audio.master, audio.ctx ? audio.ctx.currentTime : 0, 0.15, { type: 'bandpass', f0: 4000, f1: 1200, q: 2, gain: 0.6 });
      }
      break;
    }
    case 'p': if (p.avatar) { p.avatar.punch(); audio.swing(p.avatar.root.position); } break;
    case 'dmg': {
      if (m.v === net.id) onDamaged(p, m);
      else {
        const v = peers.get(m.v);
        if (v && v.avatar && m.w === 'fist') { audio.punchHit(v.avatar.root.position); vfx.punchHit(v.avatar.root.position.clone().setY(v.avatar.root.position.y + 1.3)); }
      }
      break;
    }
    case 'die': {
      const killer = m.k === net.id ? null : peers.get(m.k);
      let dir = null;
      if (killer && killer.pose && p.pose) dir = new THREE.Vector3(p.pose.x - killer.pose.x, 0, p.pose.z - killer.pose.z).normalize();
      if (m.k === net.id && p.pose) dir = new THREE.Vector3(p.pose.x - me.pos.x, 0, p.pose.z - me.pos.z).normalize();
      killAvatar(p, dir);
      p.deaths++;
      if (m.k === net.id) {
        me.kills++;
        me.hp = Math.min(MAX_HP, me.hp + KILL_HEAL);
        hud.setHP(me.hp);
        hud.hit('kill');
        audio.kill();
        hud.center(`HẠ GỤC ${p.name.toUpperCase()}`, (m.hs ? 'HEADSHOT · ' : '') + `+${KILL_HEAL} HP`, 'kill');
        addKill({ name: myName(), color: me.color }, p, m.w, m.hs, true, m.dist);
        sendHello();
      } else {
        if (killer) killer.kills++;
        addKill(killer || { name: m.k ? '???' : 'Môi trường', color: '#ccc' }, p, m.w, m.hs, false, m.dist);
      }
      if (state === 'lobby') renderLobby();
      break;
    }
    case 'bye': removePeer(from); break;
  }
}
function closestOnSeg(a, b, p) {
  const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return a.clone().addScaledVector(ab, t);
}
function addKill(killer, victim, weapon, hs, mine, dist) {
  hud.killfeed(killer, victim, weapon, hs, mine || victim.name === myName(), dist);
  feed.unshift(`<b style="color:${killer.color}">${escapeHtml(killer.name)}</b> hạ <b style="color:${victim.color}">${escapeHtml(victim.name)}</b> bằng ${weapon === 'fist' ? 'nắm đấm' : 'AWM'}${hs ? ' (headshot)' : ''}${dist ? ` · ${Math.round(dist)}m` : ''}`);
  if (feed.length > 30) feed.pop();
}
function onDamaged(attacker, m) {
  const now = performance.now();
  if (state !== 'playing' || !me.alive) return;
  if (now < me.protectedUntil) return;
  const dmg = clamp(+m.d || 0, 0, 300);
  me.hp -= dmg;
  me.lastDamage = now;
  me.shake = Math.max(me.shake, m.w === 'fist' ? 0.4 : 0.9);
  audio.hurt();
  let ang = null;
  if (Array.isArray(m.from)) {
    const vx = m.from[0] - me.pos.x, vz = m.from[2] - me.pos.z;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    ang = Math.atan2(vx * rx + vz * rz, vx * fx + vz * fz);
  }
  hud.damage(ang, dmg);
  hud.setHP(me.hp);
  if (me.hp <= 0) die(attacker.id, m);
}

// ---------------- player update ----------------
const PLAYER_H = 1.8, CROUCH_H = 1.2;
function updatePlayer(dt, now) {
  const locked = document.pointerLockElement === canvas || TEST;
  // look
  const zoom = camera.fov / 75;
  const k = 0.0022 * settings.sens * zoom;
  me.yaw -= mouseDX * k;
  me.pitch = clamp(me.pitch - mouseDY * k, -1.52, 1.52);
  lookDX = mouseDX; lookDY = mouseDY;
  mouseDX = mouseDY = 0;

  // crouch
  const wantCrouch = !!(keys.KeyC || keys.ControlLeft);
  if (wantCrouch) me.crouching = true;
  else if (me.crouching && !mover.overlapsAt(me.pos.x, me.pos.y, me.pos.z, PLAYER_H)) me.crouching = false;
  me.crouchV = damp(me.crouchV, me.crouching ? 1 : 0, 14, dt);
  const h = me.crouching ? CROUCH_H : PLAYER_H;

  // movement
  let fx = 0, fz = 0;
  if (locked) {
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
  }
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const wx = fx * cos + fz * sin, wz = -fx * sin + fz * cos;
  const sprint = keys.ShiftLeft && fz < 0 && !me.crouching && me.ads < 0.3;
  let speed = me.crouching ? 2.8 : sprint ? 8.2 : 5.4;
  if (me.ads > 0.5) speed *= 0.55;
  if (me.weapon === 0 && !me.crouching) speed *= 1.08;
  const accel = me.onGround ? 14 : 2.5;
  const tx = (fx || fz) ? wx * speed : 0, tz = (fx || fz) ? wz * speed : 0;
  me.vel.x = damp(me.vel.x, tx, accel, dt);
  me.vel.z = damp(me.vel.z, tz, accel, dt);
  if (keys.Space && me.onGround && locked) { me.vel.y = 6.8; me.onGround = false; }
  me.vel.y -= 21 * dt;
  const fallV = me.vel.y;
  const wasGround = me.onGround;
  mover.move(me, dt, h);
  if (!wasGround && me.onGround && fallV < -7) { audio.land(); me.landDip = Math.min(0.25, -fallV * 0.02); if (fallV < -16) { /* fall damage */ const d = Math.round((-fallV - 16) * 6); if (d > 0) { me.hp -= d; hud.setHP(me.hp); hud.damage(null, d); if (me.hp <= 0) die(null, { w: 'fall' }); } } }
  // keep inside bounds (safety)
  me.pos.x = clamp(me.pos.x, BOUNDS.x0 + 0.5, BOUNDS.x1 - 0.5);
  me.pos.z = clamp(me.pos.z, BOUNDS.z0 + 0.5, BOUNDS.z1 - 0.5);

  // footsteps
  const hs = Math.hypot(me.vel.x, me.vel.z);
  if (me.onGround && hs > 1.5 && !me.crouching) {
    me.stepAcc += hs * dt;
    if (me.stepAcc > 2.4) { me.stepAcc = 0; audio.step(null, sprint ? 1 : 0.7); }
  }

  // weapons state
  if (me.reloadEnd && now >= me.reloadEnd) { me.reloadEnd = 0; me.ammo = AWM.mag; hud.setWeapon(me.weapon, me.ammo); }
  hud.setReload(me.reloadEnd ? (now - me.reloadStart) / AWM.reload : -1);
  const canAds = me.weapon === 1 && !me.reloadEnd && now >= me.switchUntil && adsHeld && !sprint;
  me.ads = clamp(me.ads + (canAds ? dt * 6 : -dt * 8), 0, 1);
  if (firing && me.weapon === 0) tryFire();

  // regen
  if (me.hp < MAX_HP && now - me.lastDamage > 7000) { me.hp = Math.min(MAX_HP, me.hp + 8 * dt); hud.setHP(me.hp); }

  // camera
  me.recoil = damp(me.recoil, 0, 6, dt);
  me.shake = damp(me.shake, 0, 8, dt);
  me.landDip = damp(me.landDip, 0, 10, dt);
  const eye = me.pos.y + lerp(1.62, 1.05, me.crouchV) - me.landDip;
  camera.position.set(me.pos.x, eye, me.pos.z);
  const sh = me.shake * 0.012;
  camera.rotation.set(me.pitch + me.recoil + (Math.random() - 0.5) * sh, me.yaw + (Math.random() - 0.5) * sh, 0);
  const scoped = me.ads > 0.92;
  const targetFov = scoped ? 13 : 75 - me.ads * 12 + (sprint && hs > 6 ? 5 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov = scoped ? targetFov : damp(camera.fov, targetFov, 14, dt); camera.updateProjectionMatrix(); }

  // HUD
  const protectedNow = now < me.protectedUntil;
  hud.protect(protectedNow);
  let spreadPx = me.weapon === 1 ? 10 + hs * 3 + (me.onGround ? 0 : 20) : 0;
  if (me.crouching) spreadPx *= 0.6;
  hud.setSpread(spreadPx);
  if (scoped && (!updatePlayer.rangeT || now - updatePlayer.rangeT > 120)) {
    updatePlayer.rangeT = now;
    aimDir(_d);
    const hit = world.raycast(camera.position, _d, 1500, (b) => b.bullet);
    updatePlayer.range = hit ? hit.t : 0;
  }
  hud.setScope(scoped, updatePlayer.range);
  hud.lowHealth(me.hp);
}

// ---------------- remote players ----------------
function samplePose(p, rt) {
  const b = p.buf;
  if (!b.length) return null;
  if (rt <= b[0].t) return b[0];
  for (let i = b.length - 1; i >= 0; i--) {
    if (b[i].t <= rt) {
      const a = b[i], c = b[i + 1];
      if (!c) {
        // extrapolate a little
        const prev = b[i - 1];
        const ex = Math.min(150, rt - a.t);
        if (prev && a.t > prev.t && ex > 0) {
          const k = ex / (a.t - prev.t);
          return { ...a, x: a.x + (a.x - prev.x) * k, z: a.z + (a.z - prev.z) * k, y: a.y + (a.g ? 0 : (a.y - prev.y) * k) };
        }
        return a;
      }
      const t = (rt - a.t) / Math.max(1, c.t - a.t);
      return { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t), z: lerp(a.z, c.z, t), yaw: lerpAngle(a.yaw, c.yaw, t), pitch: lerp(a.pitch, c.pitch, t), w: c.w, c: c.c, sp: lerp(a.sp, c.sp, t), pr: c.pr, g: c.g };
    }
  }
  return b[b.length - 1];
}
function updatePeers(dt, now) {
  const delay = net.mode === 'server' ? 100 : 170;
  for (const p of peers.values()) {
    if (now - p.lastSeen > 9000) { removePeer(p.id); continue; }
    if (!p.alive || !p.buf.length) { if (p.avatar && !p.alive) { p.avatar.dispose(); p.avatar = null; } continue; }
    const s = samplePose(p, now - delay);
    if (!s) continue;
    const av = ensureAvatar(p);
    p.pose = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: s.c };
    p.protected = s.pr;
    av.update(dt, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, speed: s.sp, crouch: s.c, weapon: s.w, protected: s.pr });
    const dist = Math.hypot(s.x - camera.position.x, s.z - camera.position.z);
    av.tag.visible = dist < 70;
    // remote footsteps
    if (s.g && s.sp > 3 && !s.c && dist < 35) {
      p.stepAcc += s.sp * dt;
      if (p.stepAcc > 2.4) { p.stepAcc = 0; audio.step(av.root.position, 1.2); }
    }
  }
}

// ---------------- cameras for lobby / death ----------------
let lobbyAngle = 0.6;
function lobbyCam(dt) {
  lobbyAngle += dt * 0.035;
  camera.position.set(Math.cos(lobbyAngle) * 185, 78, Math.sin(lobbyAngle) * 140);
  camera.lookAt(0, 0, 0);
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
}
function deathCam(dt, now) {
  const killer = peers.get(me.killerId);
  const t = clamp((now - deathStart) / 1200, 0, 1);
  const target = killer && killer.avatar ? killer.avatar.root.position.clone().setY(killer.avatar.root.position.y + 1.2) : deathPos.clone().setY(1);
  const dir = target.clone().sub(deathPos).setY(0);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const camPos = deathPos.clone().addScaledVector(dir, -3.5 * t).setY(lerp(1.6, 4.5, t));
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 6));
  const m = new THREE.Matrix4().lookAt(camera.position, target, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  camera.quaternion.slerp(q, 1 - Math.exp(-dt * 5));
  if (Math.abs(camera.fov - 60) > 0.1) { camera.fov = damp(camera.fov, 60, 6, dt); camera.updateProjectionMatrix(); }
  $('deathFill').style.width = clamp((now - deathStart) / (deathUntil - deathStart), 0, 1) * 100 + '%';
  if (now >= deathUntil) {
    camera.rotation.order = 'YXZ';
    leaveToLobby();
  }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0, lobbyRefresh = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();

  if (state === 'playing') updatePlayer(dt, now);
  else if (state === 'dead') deathCam(dt, now);
  else lobbyCam(dt);

  updatePeers(dt, now);
  if (net.connected) {
    if (state === 'playing') sendState(false);
    if (now - lastHello > 2000) sendHello();
    if (now - lastPing > 2000) { lastPing = now; net.sendPing(); updateNetBadge(); }
  }

  // sun follows the action
  const focus = state === 'lobby' ? new THREE.Vector3(0, 0, 0) : (state === 'dead' ? deathPos : me.pos);
  setShadowArea(state === 'lobby' ? 170 : 75);
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 220);
  scene.userData.sky.position.copy(camera.position);

  vfx.update(dt, camera);
  debris.update(dt);
  audio.updateListener(camera);

  renderer.clear();
  renderer.render(scene, camera);
  if (state === 'playing') {
    vm.update(dt, { speed: Math.hypot(me.vel.x, me.vel.z), onGround: me.onGround, ads: me.ads, lookDX, lookDY });
    if (me.ads <= 0.92 || me.weapon === 0) {
      renderer.clearDepth();
      renderer.render(vm.scene, vm.camera);
    }
    hud.drawMinimap(me.pos.x, me.pos.z, me.yaw, peers);
    hud.scoreboard(showBoard, allPlayers());
  } else if (state === 'lobby') {
    if (now - lobbyRefresh > 1000) { lobbyRefresh = now; renderLobby(); }
  }

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    hud.stats(`${fps} FPS · ${net.ping || '–'} ms · ${net.mode === 'server' ? 'server' : 'relay'} · ${peers.size + 1} người`);
  }
}

// test hooks
window.__game = { me, peers, net, world, camera, keys, spawn, tryFire, switchWeapon, get state() { return state; }, setLook(y, p) { me.yaw = y; me.pitch = p; }, setAds(v) { adsHeld = v; } };
