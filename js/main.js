import * as THREE from 'three';
import { CollisionWorld, Mover } from './physics.js';
import { buildMap, BOUNDS, REVIEW_MAP } from './map.js';
import { Avatar, Debris, rayPlayer } from './avatar.js';
import { ViewModel } from './viewmodel.js';
import { VFX } from './vfx.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { HUD } from './hud.js';
import { Inspector, loadAdminKey, verifyAdminKey } from './admin.js';
import { Chat, RateLimit, cleanChat } from './chat.js';
import { WEAPONS, getWeapon } from './weapons.js';
import { BuyMenu } from './shop.js';
import { CollectionUI } from './collection.js';
import { getEquippedSkin, isSkinOwned, equipSkin, unlockAllSkins, unlockSkin, resetSkins } from './skins.js';
import { clamp, damp, lerp, lerpAngle, angleDiff, cleanName, escapeHtml, r2, r3 } from './util.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const TEST = qs.has('test');
const COLORS = ['#1e88e5', '#e53935', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#6d4c41', '#eceff1'];

// ---------------- weapons tuning ----------------
const FIST = { dmg: 25, head: 35, range: 2.7, cd: 420 };
const AWM = { head: 250, body: 85, legs: 65, mag: 5, cd: 1350, reload: 2800, switch: 550 };
const KNIFE = { dmg: 45, head: 70, heavyDmg: 75, heavyHead: 110, range: 2.9, cd: 380, heavyCd: 680, switch: 520 };
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
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 260, 950);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 2200);
camera.rotation.order = 'YXZ';

const sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
{
  const g = new THREE.SphereGeometry(1500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d86d6) }, horizon: { value: new THREE.Color(0xd4e6f4) }, bottom: { value: new THREE.Color(0x9fb3c2) }, sunDir: { value: sunDir }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, night: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir, moonDir; uniform float night; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 c = mix(horizon, top, pow(max(h,0.0),0.55)); c = mix(c, bottom, clamp(-h*5.0,0.0,1.0));
      float s = max(dot(d, sunDir), 0.0); c += vec3(1.0,0.92,0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * smoothstep(-0.12, 0.04, sunDir.y);
      float m = max(dot(d, moonDir), 0.0); c += vec3(0.86,0.9,1.0) * (smoothstep(0.99935, 0.99965, m) * 1.4 + pow(m, 80.0) * 0.12) * night;
      vec3 g = floor(d * 420.0); c += vec3(step(0.9975, hash(g)) * (0.5 + 0.5 * hash(g + 1.0))) * night * smoothstep(0.02, 0.3, h);
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

// ---------------- day / night ----------------
// One cycle every 10 real minutes, from the wall clock so every player sees the same time.
// Phase 0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. ?daytime=0.75 forces a phase (testing).
const DAY_MS = 10 * 60 * 1000;
let forcedPhase = qs.has('daytime') ? (+qs.get('daytime') % 1 + 1) % 1 : null;
const TIME_PRESETS = {
  day:      { ph: 0.16, label: 'Buổi sáng (Day · 09:50)' },
  morning:  { ph: 0.16, label: 'Buổi sáng (Day · 09:50)' },
  sang:     { ph: 0.16, label: 'Buổi sáng (Day · 09:50)' },
  buoisang: { ph: 0.16, label: 'Buổi sáng (Day · 09:50)' },
  noon:     { ph: 0.25, label: 'Buổi trưa (Noon · 12:00)' },
  midday:   { ph: 0.25, label: 'Buổi trưa (Noon · 12:00)' },
  trua:     { ph: 0.25, label: 'Buổi trưa (Noon · 12:00)' },
  sunrise:  { ph: 0.02, label: 'Bình minh (Sunrise · 06:30)' },
  dawn:     { ph: 0.02, label: 'Bình minh (Sunrise · 06:30)' },
  binhminh: { ph: 0.02, label: 'Bình minh (Sunrise · 06:30)' },
  sunset:   { ph: 0.48, label: 'Hoàng hôn (Sunset · 17:30)' },
  dusk:     { ph: 0.48, label: 'Hoàng hôn (Sunset · 17:30)' },
  evening:  { ph: 0.48, label: 'Hoàng hôn (Sunset · 17:30)' },
  chieu:    { ph: 0.48, label: 'Hoàng hôn (Sunset · 17:30)' },
  hoanghon: { ph: 0.48, label: 'Hoàng hôn (Sunset · 17:30)' },
  night:    { ph: 0.75, label: 'Buổi tối (Night · 00:00)' },
  toi:      { ph: 0.75, label: 'Buổi tối (Night · 00:00)' },
  dem:      { ph: 0.75, label: 'Buổi tối (Night · 00:00)' },
  buoitoi:  { ph: 0.75, label: 'Buổi tối (Night · 00:00)' },
  midnight: { ph: 0.75, label: 'Nửa đêm (Midnight · 00:00)' },
  khuya:    { ph: 0.75, label: 'Nửa đêm (Midnight · 00:00)' },
  auto:     { ph: null, label: 'Chu kỳ tự động (Auto 10 phút)' },
  cycle:    { ph: null, label: 'Chu kỳ tự động (Auto 10 phút)' },
  reset:    { ph: null, label: 'Chu kỳ tự động (Auto 10 phút)' },
};
function parseTimeArg(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(TIME_PRESETS, s)) return TIME_PRESETS[s];
  const hMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|giờ|gio|:00)$/);
  if (hMatch) {
    const hr = (+hMatch[1]) % 24;
    const ph = ((((hr - 6) / 24) % 1) + 1) % 1;
    return { ph, label: `${hr.toFixed(1).replace(/\.0$/, '')}h00 (phase ${ph.toFixed(2)})` };
  }
  const num = Number(s);
  if (Number.isFinite(num)) {
    if (num >= 100) {
      // Minecraft ticks (0 = 6:00 sunrise, 1000 = day, 6000 = noon, 13000 = night, 18000 = midnight)
      const ph = (((num % 24000) / 24000) + 1) % 1;
      return { ph, label: `${Math.round(num)} ticks (phase ${ph.toFixed(2)})` };
    }
    if (num > 1 && num <= 24) {
      const ph = ((((num - 6) / 24) % 1) + 1) % 1;
      return { ph, label: `${num.toFixed(1).replace(/\.0$/, '')}h00 (phase ${ph.toFixed(2)})` };
    }
    const ph = ((num % 1) + 1) % 1;
    const hr = ((ph * 24 + 6) % 24);
    const hh = String(Math.floor(hr)).padStart(2, '0');
    const mm = String(Math.floor((hr % 1) * 60)).padStart(2, '0');
    return { ph, label: `${hh}:${mm} (phase ${ph.toFixed(2)})` };
  }
  return null;
}
function setTimeOfDay(arg, broadcast = true) {
  const parsed = typeof arg === 'object' && arg !== null ? arg : parseTimeArg(arg);
  if (!parsed) return null;
  forcedPhase = parsed.ph;
  updateDayNight();
  if (broadcast && net.connected) {
    net.send({ t: 'env', ph: forcedPhase, label: parsed.label, by: myName() });
  }
  return parsed;
}
const CYCLE_ORDER = ['day', 'noon', 'sunset', 'night', 'sunrise', 'auto'];
let cycleIdx = 0;
function cycleTimePreset() {
  const key = CYCLE_ORDER[cycleIdx % CYCLE_ORDER.length];
  cycleIdx++;
  const res = setTimeOfDay(key, true);
  if (res && chat) chat.system(`[Admin] Đã chuyển thời gian: ${res.label}`);
  return res ? res.label : '';
}
const lightDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
const DN = {
  dayTop: new THREE.Color(0x3d86d6), dayHor: new THREE.Color(0xd4e6f4), dayBot: new THREE.Color(0x9fb3c2),
  nightTop: new THREE.Color(0x040916), nightHor: new THREE.Color(0x18243c), nightBot: new THREE.Color(0x0a0f18),
  dusk: new THREE.Color(0xf09a5a), sunCol: new THREE.Color(0xfff0d8), moonCol: new THREE.Color(0xa9c2ff),
  hemiSkyDay: new THREE.Color(0xcfe6ff), hemiSkyNight: new THREE.Color(0x3b4f80), hemiGndDay: new THREE.Color(0x7a7563), hemiGndNight: new THREE.Color(0x1b1d24),
};
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function updateDayNight() {
  const ph = forcedPhase ?? (Date.now() % DAY_MS) / DAY_MS;
  const a = ph * Math.PI * 2;
  sunDir.set(Math.cos(a), Math.sin(a), 0.35).normalize();
  moonDir.set(-sunDir.x, -sunDir.y, 0.3).normalize();
  const e = sunDir.y, day = sstep(-0.12, 0.22, e), dusk = Math.max(0, 1 - Math.abs(e) / 0.25);
  // one shadow-casting light: the sun by day, the moon by night
  if (e > -0.05) { lightDir.copy(sunDir); sun.color.copy(DN.sunCol).lerp(DN.dusk, dusk * 0.55); sun.intensity = 2.6 * sstep(-0.05, 0.2, e); }
  else { lightDir.copy(moonDir); sun.color.copy(DN.moonCol); sun.intensity = 0.75 * sstep(-0.05, -0.25, e); }
  hemi.intensity = 0.7 + 0.65 * day;
  hemi.color.copy(DN.hemiSkyNight).lerp(DN.hemiSkyDay, day);
  hemi.groundColor.copy(DN.hemiGndNight).lerp(DN.hemiGndDay, day);
  const u = scene.userData.sky.material.uniforms;
  u.top.value.copy(DN.nightTop).lerp(DN.dayTop, day);
  u.horizon.value.copy(DN.nightHor).lerp(DN.dayHor, day).lerp(DN.dusk, dusk * 0.45);
  u.bottom.value.copy(DN.nightBot).lerp(DN.dayBot, day);
  u.moonDir.value.copy(moonDir);
  u.night.value = 1 - day;
  scene.fog.color.copy(u.horizon.value);
  scene.userData.cloudMat?.emissive.setHex(0x8899aa).multiplyScalar(0.12 + 0.88 * day);
}

// ---------------- systems ----------------
const world = new CollisionWorld(8);
const mover = new Mover(world);
let map, hud, vm, vfx, debris, buyMenu, collectionUI;
const audio = new Audio();
audio.setVolume(settings.vol);
// the review map gets its own rooms, so its players never mix with the ones on the live map
const net = new Net(REVIEW_MAP ? 'review-' + (qs.get('room') || 'main') : qs.get('room'));
if (REVIEW_MAP) {
  document.title = 'Bách Khoa Battleground · Thử map mới';
  const sub = document.querySelector('.brand .sub');
  if (sub) sub.textContent = 'Chế độ thử map mới (map.blend) · Đấu tự do · Mỗi người 100 HP';
  const tip = $('mapModeTip');
  if (tip) tip.innerHTML = '<a href="./" style="color:#a8e6ff">← Quay lại map cũ</a> (phòng chơi riêng, không chung với map cũ).';
}
const peers = new Map();
const dummies = new Map();
let dummySeq = 0;

function makeInitialAmmoMap() {
  const m = Object.create(null);
  for (const id in WEAPONS) {
    if (typeof WEAPONS[id].mag === 'number') m[id] = WEAPONS[id].mag;
  }
  return m;
}

function resolveEquippedMelee() {
  const skin = getEquippedSkin('knife');
  return skin && skin.meleeType === 'knife' ? 'knife' : 'fist';
}

// ---------------- local player ----------------
const me = {
  name: '', color: settings.color, alive: false, hp: MAX_HP, kills: 0, deaths: 0, killStreak: 0,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false,
  yaw: 0, pitch: 0, crouching: false, crouchV: 0, sprint: false,
  slot: 1, lastSlot: 3, weapon: 1, lastWeapon: 2, ammo: AWM.mag,
  loadout: {
    primary: settings.primary && WEAPONS[settings.primary]?.slot === 'primary' ? settings.primary : 'operator',
    secondary: settings.secondary && WEAPONS[settings.secondary]?.slot === 'secondary' ? settings.secondary : 'classic',
    melee: resolveEquippedMelee(),
  },
  ammoMap: makeInitialAmmoMap(),
  nextFire: 0, reloadEnd: 0, reloadStart: 0, reloadDurMs: AWM.reload, switchUntil: 0, ads: 0, protectedUntil: 0,
  lastDamage: 0, recoil: 0, shake: 0, stepAcc: 0, landDip: 0, jumpImpulse: 0, landImpulse: 0, killerId: null,
};
function activeWeaponId() {
  return me.slot === 1 ? me.loadout.primary : me.slot === 2 ? me.loadout.secondary : me.loadout.melee;
}
function activeWeaponDef() {
  return getWeapon(activeWeaponId());
}
function activeVmSlot() {
  if (me.slot === 3) return me.loadout.melee === 'knife' ? 2 : 0;
  return 1;
}
function syncHudLoadout() {
  const w = activeWeaponDef();
  me.weapon = activeVmSlot();
  if (typeof w.mag === 'number') {
    if (me.ammoMap[w.id] === undefined) me.ammoMap[w.id] = w.mag;
    me.ammo = me.ammoMap[w.id];
  }
  if (hud) hud.setLoadout(me.loadout, me.slot, me.ammoMap);
}
function toggleBuyMenu(forceState = null) {
  if (!buyMenu || state !== 'playing' || !me.alive) return;
  const next = forceState === null ? !buyMenu.open : !!forceState;
  if (next === buyMenu.open) return;
  if (next) {
    for (const k in keys) keys[k] = false;
    firing = false;
    adsHeld = false;
    hud.setScope(false);
    buyMenu.setOpen(true);
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    buyMenu.setOpen(false);
    lockPointer();
  }
}
function equipFromShop(w) {
  if (!w) return;
  audio.ui();
  if (w.slot === 'primary') {
    me.loadout.primary = w.id;
    settings.primary = w.id;
    me.ammoMap[w.id] = w.mag;
    saveSettings();
    switchWeapon(1, true);
  } else if (w.slot === 'secondary') {
    me.loadout.secondary = w.id;
    settings.secondary = w.id;
    me.ammoMap[w.id] = w.mag;
    saveSettings();
    switchWeapon(2, true);
  } else if (w.slot === 'melee') {
    if (w.id === 'knife' && !isSkinOwned('knife', 'knife_butterfly')) {
      chat?.system('[Bộ Sưu Tập] Dao Butterfly đang bị khóa! Mở khóa trong Bộ Sưu Tập (hoặc dùng /unlock all).');
      return;
    }
    equipSkin('knife', w.id === 'knife' ? 'knife_butterfly' : 'knife_default');
    me.loadout.melee = w.id === 'knife' ? 'knife' : 'fist';
    settings.melee = me.loadout.melee;
    saveSettings();
    switchWeapon(3, true);
  }
}
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
    map = await buildMap(scene, world, { lowGfx: settings.low, onProgress: (p) => setLoad(p, 'Đang dựng khuôn viên trường…') });
    setLoad(55, 'Đang chuẩn bị vũ khí…');
    await nextFrame();
    hud = new HUD(map.minimap);
    buyMenu = new BuyMenu({
      onSelect: (w) => equipFromShop(w),
      onClose: () => { if (state === 'playing' && me.alive && !chat?.open) lockPointer(); },
      getLoadout: () => ({ ...me.loadout, activeWeaponId: activeWeaponId() }),
    });
    chat = new Chat({
      onSend: (text) => { net.send({ t: 'chat', m: text }); chat.add(myName(), me.color, text, true); },
      onCommand: (cmdText) => handleChatCommand(cmdText),
      onOpenChange: (open) => {
        if (open) {
          if (buyMenu?.open) buyMenu.setOpen(false);
          for (const k in keys) keys[k] = false;
          if (inspector) inspector.keys = {};
          firing = false;
          adsHeld = false;
        }
      },
    });
    vm = new ViewModel(renderer, audio);
    vm.setColor(me.color);
    const bootPrimary = getWeapon(me.loadout.primary);
    vm.setGunDef(bootPrimary, getEquippedSkin(bootPrimary.id));
    collectionUI = new CollectionUI({
      onSound: () => audio.ui(),
      onEquipSkin: (weaponId, skinDef) => {
        if (weaponId === 'knife') {
          me.loadout.melee = skinDef?.meleeType === 'knife' ? 'knife' : 'fist';
          settings.melee = me.loadout.melee;
          saveSettings();
          if (me.slot === 3 && me.alive) switchWeapon(3, true);
          else syncHudLoadout();
          return;
        }
        if (vm && vm.gunDef && vm.gunDef.id === weaponId) {
          vm.setGunDef(vm.gunDef, skinDef);
        }
      },
    });
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
  nameInput.addEventListener('input', () => { settings.name = nameInput.value; saveSettings(); updateAdminBtn(); });
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
  $('playBtn').onclick = () => { if (!net.connected) return; collectionUI?.setOpen(false); audio.init(); audio.ui(); spawn(); };
  const colBtn = $('collectionBtn');
  if (colBtn) colBtn.onclick = () => { audio.init(); audio.ui(); collectionUI?.setOpen(true); };
  $('resumeBtn').onclick = () => { lockPointer(); };
  // admin: free camera to inspect the map (name + key, see admin.js)
  inspector = new Inspector({
    camera,
    canvas,
    onExit: () => { state = 'lobby'; $('lobby').classList.remove('hidden'); renderLobby(); },
    onCycleTime: () => (isAdmin() ? cycleTimePreset() : ''),
  });
  const ib = document.createElement('button');
  ib.id = 'inspectBtn'; ib.className = 'inspect-btn hidden'; ib.textContent = 'ADMIN · INSPECT MAP';
  ib.onclick = () => { if (!isAdmin()) return; state = 'inspect'; $('lobby').classList.add('hidden'); inspector.enter(); };
  $('playBtn').after(ib);
  loadAdminKey().then((ok) => { adminKey = ok; updateAdminBtn(); });
  $('leaveBtn').onclick = () => { leaveToLobby(); };
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('mobileWarn').classList.remove('hidden');
  const credit = document.querySelector('.credit');
  credit.innerHTML += ' · Mô hình 3D: <a href="https://sketchfab.com/3d-models/truong-dai-hoc-bach-khoa-631462b7ccd5432a88ccea48a85aeb0e" target="_blank" rel="noopener" style="color:#8fc7ff;pointer-events:auto">mô hình của PORTCOAST trên Sketchfab</a>';
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
let inspector = null, adminKey = false, chat = null;
const isAdmin = () => !!adminKey;
function updateAdminBtn() { const b = $('inspectBtn'); if (b) b.classList.toggle('hidden', !isAdmin()); }

// ---------------- admin slash commands ----------------
function handleChatCommand(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed.startsWith('/')) return false;
  const parts = trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (cmd === 'clear' || cmd === 'cls') {
    chat?.clear();
    return true;
  }

  if (cmd === 'dummy' || cmd === 'bot') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'clear' || sub === 'del' || sub === 'remove' || sub === '0') {
      const removed = clearDummies();
      chat?.system(`[Dummy] Đã xoá ${removed} dummy tập bắn.`);
      return true;
    }
    if (state !== 'playing' || !me.alive) {
      chat?.system('[Dummy] Hãy vào trận (VÀO TRẬN) trước khi gọi /dummy.');
      return true;
    }
    const count = args.length && Number.isFinite(+args[0]) ? clamp(Math.round(+args[0]), 1, 10) : 1;
    const spawned = spawnDummy(count);
    chat?.system(`[Dummy] Đã spawn ${spawned} dummy phía trước bạn (tổng ${dummies.size} dummy · bắn hạ để kích hoạt Kill Effect!).`);
    return true;
  }

  if (cmd === 'killfx' || cmd === 'killeffect') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'reset' || sub === '0' || sub === 'off') {
      me.killStreak = 0;
      hud?.resetKillEffect();
      chat?.system('[KillFX] Đã reset chuỗi hạ gục liên tiếp về 0.');
      return true;
    }
    const n = args.length && Number.isFinite(+args[0]) ? clamp(Math.round(+args[0]), 1, 99) : null;
    const tier = triggerKillStreak(n);
    chat?.system(`[KillFX] Kích hoạt hiệu ứng hạ gục liên tiếp #${me.killStreak} (clip kill_${tier}.mp4).`);
    return true;
  }

  if (cmd === 'admin') {
    const keyArg = args.join(' ');
    if (!keyArg && isAdmin()) {
      chat?.system(`[Admin] Đang bật chế độ Admin (${adminKey}). Gõ /help để xem danh sách lệnh.`);
      return true;
    }
    verifyAdminKey(keyArg || 'dev').then((label) => {
      if (label) {
        adminKey = label;
        updateAdminBtn();
        chat?.system(`[Admin] Đã kích hoạt quyền Admin (${label})! Gõ /help để xem các lệnh.`);
      } else {
        chat?.system('[Admin] Khóa Admin không hợp lệ.');
      }
    });
    return true;
  }

  if (cmd === 'help' || cmd === '?') {
    if (!isAdmin()) {
      chat?.system('Lệnh cơ bản: /dummy [số|clear] (spawn mục tiêu tập bắn), /killfx [1..6|reset] (thử hiệu ứng hạ gục), /clear (xoá chat), /admin <key>.');
      return true;
    }
    chat?.system('=== LỆNH ADMIN (BÁCH KHOA BATTLEGROUND) ===');
    chat?.system('• /dummy [1..10|clear] : Spawn mục tiêu tập bắn phía trước (bắn hạ để test Kill Effect)');
    chat?.system('• /killfx [1..6|reset] : Kích hoạt hoặc reset chuỗi hiệu ứng hạ gục Valorant (1 -> 6+)');
    chat?.system('• /unlock all | /unlock <id> | /lock all : Mở khóa hoặc khóa lại toàn bộ skin trong Bộ Sưu Tập');
    chat?.system('• /time set <day|noon|sunset|night|sunrise|midnight|auto|0..24h> : Đổi buổi sáng/trưa/chiều/tối');
    chat?.system('• /day, /noon, /sunset, /night, /sunrise : Phím tắt đổi nhanh thời gian');
    chat?.system('• /fly hoặc /inspect : Bật/tắt camera bay tự do (Inspector)');
    chat?.system('• /tp <x> <z> | /tp <x> <y> <z> | /tp <tên> : Dịch chuyển tức thời');
    chat?.system('• /speed <0.5..5> : Đổi tốc độ chạy (mặc định 1)');
    chat?.system('• /heal [hp] : Hồi đầy máu · /god : Bất tử · /ammo : Đạn vô hạn');
    return true;
  }

  if (!isAdmin()) {
    chat?.system('[Admin] Bạn cần quyền Admin để dùng lệnh này. (Dùng ?admin=<key> hoặc /admin <key>)');
    return true;
  }

  if (cmd === 'unlock') {
    const target = args.join(' ').trim().toLowerCase();
    if (!target || target === 'all' || target === '*') {
      const n = unlockAllSkins();
      chat?.system(`[Admin] Đã mở khóa toàn bộ skin trong Bộ Sưu Tập${n ? ` (+${n} skin mới)` : ' (tất cả đã được mở từ trước)'}!`);
      return true;
    }
    const found = unlockSkin(target);
    if (found) chat?.system(`[Admin] Đã mở khóa skin: ${found.name}.`);
    else chat?.system(`[Admin] Không tìm thấy skin "${target}". Dùng /unlock all để mở tất cả.`);
    return true;
  }

  if (cmd === 'lock') {
    const target = (args[0] || 'all').toLowerCase();
    if (target === 'all' || target === 'reset') {
      resetSkins();
      me.loadout.melee = resolveEquippedMelee();
      settings.melee = me.loadout.melee;
      saveSettings();
      const curW = activeWeaponDef();
      if (me.slot === 3 && me.alive) switchWeapon(3, true);
      else if (vm && curW && activeVmSlot() === 1) vm.setGunDef(curW, getEquippedSkin(curW.id));
      syncHudLoadout();
      chat?.system('[Admin] Đã khóa lại toàn bộ skin chưa sở hữu (chỉ giữ skin Mặc định).');
      return true;
    }
  }

  // /day, /night, /noon, /sunrise, /sunset, /midnight, /auto shortcuts
  if (['day', 'night', 'noon', 'sunrise', 'sunset', 'dusk', 'midnight', 'morning', 'auto'].includes(cmd)) {
    const res = setTimeOfDay(cmd, true);
    if (res) chat?.system(`[Admin] Đã chỉnh thời gian: ${res.label}`);
    return true;
  }

  // /time set <val> or /time <val>
  if (cmd === 'time') {
    const sub = (args[0] || '').toLowerCase();
    const targetArg = (sub === 'set' || sub === 'add') ? args[1] : args[0];
    if (!targetArg) {
      chat?.system('Cách dùng: /time set <day | noon | sunset | night | sunrise | midnight | auto | 0..24h>');
      return true;
    }
    let parsed = parseTimeArg(targetArg);
    if (sub === 'add' && parsed && parsed.ph !== null) {
      const cur = forcedPhase ?? (Date.now() % DAY_MS) / DAY_MS;
      const nextPh = ((cur + parsed.ph) % 1 + 1) % 1;
      parsed = parseTimeArg(String(nextPh));
    }
    if (!parsed) {
      chat?.system(`[Admin] Giá trị thời gian "${targetArg}" không hợp lệ. Dùng: day, noon, sunset, night, sunrise, auto, hoặc giờ (vd: 8h, 18h).`);
      return true;
    }
    setTimeOfDay(parsed, true);
    chat?.system(`[Admin] Đã chỉnh thời gian sang: ${parsed.label}`);
    if (inspector?.active) inspector.flash(`Thời gian: ${parsed.label}`);
    return true;
  }

  // /fly or /inspect
  if (cmd === 'fly' || cmd === 'inspect' || cmd === 'freecam') {
    if (state === 'inspect') {
      inspector.exit();
      chat?.system('[Admin] Đã thoát chế độ Camera bay (Inspect).');
    } else {
      if (state === 'playing' && me.alive) {
        me.alive = false;
        net.send({ t: 'despawn' });
        sendHello();
        hud.show(false);
        hud.setScope(false);
      }
      $('lobby').classList.add('hidden');
      $('pause').classList.add('hidden');
      $('death').classList.add('hidden');
      state = 'inspect';
      inspector.enter();
      chat?.system('[Admin] Đã bật Camera bay tự do (Nhấn N để đổi ngày/đêm, Backspace về lobby).');
    }
    return true;
  }

  // /tp <x> <z> | /tp <x> <y> <z> | /tp <playerName>
  if (cmd === 'tp' || cmd === 'teleport') {
    if (!args.length) {
      chat?.system('Cách dùng: /tp <x> <z> hoặc /tp <x> <y> <z> hoặc /tp <tên_người_chơi>');
      return true;
    }
    let tx = null, ty = null, tz = null, label = '';
    if (args.length >= 2 && Number.isFinite(+args[0]) && Number.isFinite(+args[1])) {
      if (args.length >= 3 && Number.isFinite(+args[2])) {
        tx = +args[0]; ty = +args[1]; tz = +args[2];
      } else {
        tx = +args[0]; ty = state === 'inspect' ? inspector.pos.y : me.pos.y; tz = +args[1];
      }
      label = `(${tx.toFixed(1)}, ${ty.toFixed(1)}, ${tz.toFixed(1)})`;
    } else {
      const q = args.join(' ').toLowerCase();
      for (const p of peers.values()) {
        if (p.name && p.name.toLowerCase().includes(q) && (p.pose || p.last)) {
          const s = p.pose || p.last;
          tx = s.x; ty = s.y + 1; tz = s.z;
          label = `${p.name} (${tx.toFixed(1)}, ${tz.toFixed(1)})`;
          break;
        }
      }
      if (tx === null) {
        chat?.system(`[Admin] Không tìm thấy người chơi hoặc tọa độ "${args.join(' ')}".`);
        return true;
      }
    }
    if (state === 'inspect' && inspector) {
      inspector.pos.set(tx, Math.max(0.5, ty), tz);
      chat?.system(`[Admin] Đã dịch chuyển camera tới ${label}.`);
    } else if (state === 'playing' && me.alive) {
      me.pos.set(clamp(tx, BOUNDS.x0 + 1, BOUNDS.x1 - 1), Math.max(0, ty), clamp(tz, BOUNDS.z0 + 1, BOUNDS.z1 - 1));
      me.vel.set(0, 0, 0);
      sendState(true);
      chat?.system(`[Admin] Đã dịch chuyển tới ${label}.`);
    } else {
      chat?.system('[Admin] Hãy vào trận hoặc bật /fly trước khi dịch chuyển.');
    }
    return true;
  }

  // /speed <mult>
  if (cmd === 'speed') {
    const val = args.length ? +args[0] : 1;
    if (!Number.isFinite(val) || val < 0.2 || val > 10) {
      chat?.system('Cách dùng: /speed <0.5 .. 5> (mặc định: /speed 1)');
      return true;
    }
    me.speedMult = val;
    if (inspector?.active) inspector.speed = clamp(25 * val, 2, 400);
    chat?.system(`[Admin] Tốc độ di chuyển: x${val.toFixed(2)}`);
    return true;
  }

  // /heal or /hp [amount]
  if (cmd === 'heal' || cmd === 'hp') {
    const hpVal = args.length && Number.isFinite(+args[0]) ? clamp(Math.round(+args[0]), 1, 9999) : MAX_HP;
    me.hp = hpVal;
    if (hud) { hud.setHP(me.hp); hud.lowHealth(me.hp); }
    chat?.system(`[Admin] Đã đặt máu: ${me.hp} HP.`);
    return true;
  }

  // /god
  if (cmd === 'god') {
    me.god = !me.god;
    if (me.god) {
      me.hp = Math.max(me.hp, MAX_HP);
      if (hud) { hud.setHP(me.hp); hud.lowHealth(me.hp); }
    }
    chat?.system(`[Admin] Chế độ Bất tử (God Mode): ${me.god ? 'BẬT' : 'TẮT'}`);
    return true;
  }

  // /ammo
  if (cmd === 'ammo') {
    me.infAmmo = !me.infAmmo;
    me.ammoMap = makeInitialAmmoMap();
    me.reloadEnd = 0;
    syncHudLoadout();
    if (hud) hud.setReload(-1);
    chat?.system(`[Admin] Đạn vô hạn (Infinite Ammo): ${me.infAmmo ? 'BẬT' : 'TẮT'} (Đã nạp đầy tất cả súng)`);
    return true;
  }

  chat?.system(`[Admin] Không rõ lệnh "/${cmd}". Gõ /help để xem danh sách lệnh.`);
  return true;
}

function triggerKillStreak(streak = null) {
  if (streak !== null && Number.isFinite(+streak)) {
    me.killStreak = Math.max(1, Math.round(+streak));
  } else {
    me.killStreak = (me.killStreak || 0) + 1;
  }
  const tier = Math.max(1, Math.min(6, me.killStreak));
  if (hud) {
    hud.show(true);
    hud.hit('kill');
    hud.showKillEffect(tier, settings.vol, () => audio.kill());
  }
  return tier;
}

// ---------------- practice dummies (/dummy) ----------------
function groundHeightAt(x, z, refY = 0) {
  // Cast straight down from above player's elevation to find the campus floor / rooftop
  const topY = Math.max(refY + 6, 12);
  const hit = world.raycast(new THREE.Vector3(x, topY, z), new THREE.Vector3(0, -1, 0), topY + 2, () => true);
  return hit ? Math.max(0, topY - hit.t) : 0;
}
function spawnDummy(count = 1) {
  const n = clamp(Math.round(count) || 1, 1, 10);
  const fwdX = -Math.sin(me.yaw), fwdZ = -Math.cos(me.yaw);
  const rightX = Math.cos(me.yaw), rightZ = -Math.sin(me.yaw);
  const baseDist = 11;
  let created = 0;
  for (let i = 0; i < n; i++) {
    const spreadIdx = i - (n - 1) / 2;
    const lateral = spreadIdx * 2.2;
    const dist = baseDist + Math.abs(spreadIdx) * 0.45;
    let x = clamp(me.pos.x + fwdX * dist + rightX * lateral, BOUNDS.x0 + 2, BOUNDS.x1 - 2);
    let z = clamp(me.pos.z + fwdZ * dist + rightZ * lateral, BOUNDS.z0 + 2, BOUNDS.z1 - 2);
    // Keep dummy outside walls if raycast hits something closer along the spawn line
    const dir = new THREE.Vector3(x - me.pos.x, 0, z - me.pos.z);
    const dLen = dir.length();
    if (dLen > 0.5) {
      dir.divideScalar(dLen);
      const wallHit = world.raycast(new THREE.Vector3(me.pos.x, me.pos.y + 1.2, me.pos.z), dir, dLen, () => true);
      if (wallHit && wallHit.t > 2.2) {
        const safeT = Math.max(2.0, wallHit.t - 1.0);
        x = me.pos.x + dir.x * safeT;
        z = me.pos.z + dir.z * safeT;
      }
    }
    const y = groundHeightAt(x, z, me.pos.y);
    const id = 'dummy_' + (++dummySeq);
    const label = `Dummy #${dummySeq}`;
    const yaw = Math.atan2(me.pos.x - x, me.pos.z - z);
    const av = new Avatar(`${label} · ${MAX_HP} HP`, '#ff8f00');
    av.update(0.016, { x, y, z, yaw, pitch: 0, speed: 0, crouch: false, weapon: 0, protected: false });
    scene.add(av.root);
    vfx.spawnFx(new THREE.Vector3(x, y, z));
    dummies.set(id, {
      id, name: label, color: '#ff8f00', isDummy: true, alive: true, hp: MAX_HP, maxHp: MAX_HP,
      pose: { x, y, z, yaw, pitch: 0, crouch: false },
      avatar: av, protected: false,
    });
    created++;
  }
  return created;
}
function clearDummies() {
  const n = dummies.size;
  for (const d of dummies.values()) {
    if (d.avatar) d.avatar.dispose();
  }
  dummies.clear();
  return n;
}
function damageDummy(dummy, dmg, head, weaponId, dist) {
  if (!dummy || !dummy.alive) return;
  dummy.hp = Math.max(0, dummy.hp - dmg);
  if (dummy.hp > 0) {
    if (dummy.avatar) dummy.avatar.setName(`${dummy.name} · ${Math.ceil(dummy.hp)} HP`, dummy.color);
    hud.hit(head ? 'head' : 'body');
    audio.hitmarker(head);
    return;
  }
  // Dummy eliminated! Trigger full kill effect + streak + debris + heal
  dummy.alive = false;
  const dir = dummy.pose ? new THREE.Vector3(dummy.pose.x - me.pos.x, 0, dummy.pose.z - me.pos.z).normalize() : null;
  if (dummy.avatar) {
    debris.burst(dummy.avatar, dir);
    vfx.deathFx(dummy.avatar.root.position);
    audio.oof(dummy.avatar.root.position);
    dummy.avatar.dispose();
    dummy.avatar = null;
  }
  dummies.delete(dummy.id);
  me.kills++;
  me.killStreak = (me.killStreak || 0) + 1;
  me.hp = Math.min(MAX_HP, me.hp + KILL_HEAL);
  hud.setHP(me.hp);
  hud.hit('kill');
  const tier = Math.max(1, Math.min(6, me.killStreak));
  hud.showKillEffect(tier, settings.vol, () => audio.kill());
  const streakLabel = me.killStreak === 5 ? 'ACE (5 MẠNG) · ' : me.killStreak >= 6 ? `CHUỖI ${me.killStreak} MẠNG · ` : me.killStreak > 1 ? `MẠNG LIÊN TIẾP #${me.killStreak} · ` : '';
  hud.center(`HẠ GỤC ${dummy.name.toUpperCase()}`, streakLabel + (head ? 'HEADSHOT · ' : '') + `+${KILL_HEAL} HP`, 'kill');
  addKill({ name: myName(), color: me.color }, dummy, weaponId, head, true, dist);
}

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
  me.ammoMap = makeInitialAmmoMap();
  me.hp = MAX_HP; me.slot = 1; me.lastSlot = 3; me.reloadEnd = 0; me.nextFire = 0; me.ads = 0;
  me.alive = true; me.killStreak = 0; me.crouching = false; me.crouchV = 0; me.sprint = false; me.jumpImpulse = 0; me.landImpulse = 0;
  me.protectedUntil = performance.now() + 2500;
  me.switchUntil = 0; me.lastDamage = 0; me.recoil = 0;
  const startGun = getWeapon(me.loadout.primary);
  vm.setGunDef(startGun, getEquippedSkin(startGun.id));
  vm.setWeapon(1, true); vm.switchT = 0;
  state = 'playing';
  net.send({ t: 'spawn', p: [r2(me.pos.x), r2(me.pos.y), r2(me.pos.z)] });
  sendHello();
  sendState(true);
  vfx.spawnFx(me.pos);
  audio.spawn();
  $('lobby').classList.add('hidden');
  $('death').classList.add('hidden');
  if (buyMenu?.open) buyMenu.setOpen(false);
  hud.resetKillEffect();
  hud.show(true);
  hud.setHP(me.hp);
  syncHudLoadout();
  hud.center('VÀO TRẬN!', 'Ấn B mở bảng mua súng · /dummy để tạo mục tiêu');
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
  else if (state === 'playing' && !chat?.open && !buyMenu?.open) { $('pause').classList.remove('hidden'); firing = false; adsHeld = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('pointerlockerror', () => { if (state === 'playing' && !buyMenu?.open && !chat?.open) $('pause').classList.remove('hidden'); });

function die(killerId, m) {
  if (!me.alive) return;
  me.alive = false;
  me.hp = 0;
  me.deaths++;
  me.killStreak = 0;
  state = 'dead';
  if (buyMenu?.open) buyMenu.setOpen(false);
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
  hud.resetKillEffect();
  hud.show(false);
  hud.setScope(false);
  hud.drawBigMap(false);
  $('pause').classList.add('hidden');
  $('death').classList.remove('hidden');
  $('deathBy').innerHTML = killer ? `bởi <span style="color:${killer.color}">${escapeHtml(killer.name)}</span>` : '';
  const wLabel = WEAPONS[m.w]?.name || (m.w === 'fist' ? 'Nắm đấm' : m.w === 'knife' ? 'Dao Butterfly' : 'AWM');
  $('deathInfo').textContent = [wLabel, m.hs ? 'Headshot' : '', m.dist ? `${Math.round(m.dist)} m` : ''].filter(Boolean).join(' · ');
}
function leaveToLobby() {
  if (state === 'playing') {
    me.alive = false;
    net.send({ t: 'despawn' });
    sendHello();
  }
  me.killStreak = 0;
  state = 'lobby';
  if (buyMenu?.open) buyMenu.setOpen(false);
  hud.resetKillEffect();
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
  if (e.code === 'Escape' && buyMenu?.open) { e.preventDefault(); toggleBuyMenu(false); return; }
  if (e.code === 'KeyB' && !e.repeat && state === 'playing' && me.alive && !chat?.open) { e.preventDefault(); toggleBuyMenu(); return; }
  if ((e.code === 'Slash' || e.key === '/') && !e.repeat && chat && state !== 'loading') { e.preventDefault(); chat.toggleOpen(); return; }
  if (state !== 'playing' || buyMenu?.open) return;
  keys[e.code] = true;
  if (e.code === 'Digit1') switchWeapon(1);
  if (e.code === 'Digit2') switchWeapon(2);
  if (e.code === 'Digit3') switchWeapon(3);
  if (e.code === 'KeyQ') switchWeapon(me.lastSlot !== me.slot ? me.lastSlot : (me.slot === 3 ? 1 : 3));
  if (e.code === 'KeyF' && !e.repeat) vm.setInspect(true);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space' || e.code === 'KeyC') e.preventDefault();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') showBoard = false;
  if (e.code === 'KeyF' && vm) vm.setInspect(false);
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; adsHeld = false; showBoard = false; if (vm) vm.setInspect(false); });
addEventListener('mousemove', (e) => {
  if (state !== 'playing' || buyMenu?.open) return;
  if (document.pointerLockElement === canvas || TEST) { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; }
});
addEventListener('mousedown', (e) => {
  if (chat?.open || buyMenu?.open) return;
  if (state !== 'playing' || (document.pointerLockElement !== canvas && !TEST)) return;
  if (e.button === 0) { firing = true; tryFire(false); }
  if (e.button === 2) {
    if (me.slot === 3 && me.loadout.melee === 'knife') tryFire(true);
    else if (me.slot !== 3) { adsHeld = true; if (vm) vm.setInspect(false); }
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; if (e.button === 2) adsHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (state === 'playing' && !buyMenu?.open && document.pointerLockElement === canvas) {
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = ((me.slot - 1 + dir + 3) % 3) + 1;
    switchWeapon(next);
  }
});
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
function switchWeapon(slot, force = false) {
  if (!me.alive) return;
  const s = clamp(slot | 0, 1, 3);
  if (s === me.slot && !force) return;
  if (s !== me.slot) me.lastSlot = me.slot;
  me.slot = s;
  const w = activeWeaponDef();
  const vmSlot = activeVmSlot();
  me.weapon = vmSlot;
  me.switchUntil = performance.now() + Math.min(600, Math.round((w.equipSec || 0.55) * 450));
  me.reloadEnd = 0;
  adsHeld = false;
  vm.reload(0.0001); vm.reloadT = 1;
  if (vmSlot === 1) vm.setGunDef(w, getEquippedSkin(w.id));
  vm.setWeapon(vmSlot, force);
  syncHudLoadout();
  hud.setReload(-1);
  if (vmSlot !== 2) audio.ui();
}
function startReload() {
  const now = performance.now();
  const w = activeWeaponDef();
  if (w.slot === 'melee' || !me.alive || me.reloadEnd > now) return;
  const curAmmo = me.ammoMap[w.id] ?? w.mag;
  if (curAmmo >= w.mag) return;
  const durMs = Math.round((w.reloadSec || 2.2) * 1000);
  me.reloadStart = now;
  me.reloadDurMs = durMs;
  me.reloadEnd = now + durMs;
  vm.reload(durMs / 1000);
  audio.reload();
}
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Vector3();
function aimDir(out) { return out.set(0, 0, -1).applyEuler(camera.rotation); }
function allTargets() {
  const list = [];
  for (const p of peers.values()) if (p.alive && p.pose) list.push(p);
  for (const d of dummies.values()) if (d.alive && d.pose) list.push(d);
  return list;
}
function tryFire(heavy = false) {
  const now = performance.now();
  if (!me.alive || now < me.switchUntil) return;
  me.protectedUntil = Math.min(me.protectedUntil, now); // firing ends spawn protection
  const w = activeWeaponDef();
  if (w.slot === 'melee') {
    if (now < me.nextFire) return;
    const isKnife = w.id === 'knife';
    const range = isKnife ? KNIFE.range : FIST.range;
    me.nextFire = now + (isKnife ? (heavy ? KNIFE.heavyCd : KNIFE.cd) : FIST.cd);
    if (isKnife) {
      vm.knifeSlash(heavy);
      audio.knifeSlash(null, heavy);
    } else {
      vm.punch();
      audio.swing(null);
    }
    net.send({ t: 'p', w: isKnife ? 2 : 0, hv: heavy ? 1 : 0 });
    _o.copy(camera.position); aimDir(_d);
    const wall = world.raycast(_o, _d, range, (b) => b.bullet);
    const maxT = wall ? wall.t : range;
    const targets = allTargets();
    let best = null;
    for (const p of targets) {
      const h = rayPlayer(_o, _d, p.pose, p.pose.yaw, p.pose.crouch, maxT);
      if (h && (!best || h.t < best.t)) best = { p, t: h.t, part: h.part };
    }
    if (!best) {
      // generous cone for melee
      for (const p of targets) {
        _e.set(p.pose.x, p.pose.y + (p.pose.crouch ? 0.8 : 1.15), p.pose.z).sub(_o);
        const dist = _e.length();
        if (dist > range + 0.3 || dist > maxT + 0.4) continue;
        if (_e.normalize().dot(_d) > 0.82 && (!best || dist < best.t)) best = { p, t: dist, part: 'body' };
      }
    }
    if (best) {
      const head = best.part === 'head';
      _e.copy(_o).addScaledVector(_d, best.t);
      const dmg = isKnife
        ? (heavy ? (head ? KNIFE.heavyHead : KNIFE.heavyDmg) : (head ? KNIFE.head : KNIFE.dmg))
        : (head ? FIST.head : FIST.dmg);
      dealDamage(best.p, dmg, head, isKnife ? 'knife' : 'fist', best.t);
      if (isKnife) {
        vfx.blood(_e, _d, head);
        audio.knifeHit(null, heavy);
        me.shake = Math.max(me.shake, heavy ? 0.5 : 0.32);
      } else {
        vfx.punchHit(_e);
        audio.punchHit(null);
        me.shake = Math.max(me.shake, 0.3);
      }
    } else if (wall) {
      _e.copy(_o).addScaledVector(_d, wall.t);
      vfx.impact(_e, wall.normal, wall.mat);
      if (isKnife) audio.knifeClack(0.82, 0.8);
      else audio.punchHit(null);
    }
    return;
  }

  // Firearm (Primary or Secondary)
  if (me.reloadEnd > now || now < me.nextFire) return;
  let curAmmo = me.ammoMap[w.id] ?? w.mag;
  if (curAmmo <= 0 && !me.infAmmo) { audio.dry(); startReload(); return; }
  if (!me.infAmmo) curAmmo--;
  else curAmmo = w.mag;
  me.ammoMap[w.id] = curAmmo;
  me.ammo = curAmmo;
  const cdMs = w.id === 'operator' ? AWM.cd : Math.round(1000 / Math.max(0.5, w.fireRate));
  me.nextFire = now + cdMs;

  const hs = Math.hypot(me.vel.x, me.vel.z);
  const scoped = w.scope && me.ads > 0.92;
  const baseDeg = lerp(w.spreadHip || 0.3, w.spreadAds || 0, me.ads);
  let spread = scoped ? 0 : (baseDeg * Math.PI) / 180;
  spread += (hs / 6) * (scoped ? 0.01 : 0.022);
  if (!me.onGround) spread += 0.055;
  if (me.crouching) spread *= 0.6;
  if (w.pellets > 1) spread = w.pelletSpread || 0.075;

  _o.copy(camera.position);
  _r.set(1, 0, 0).applyEuler(camera.rotation);
  _u.set(0, 1, 0).applyEuler(camera.rotation);
  aimDir(_m);
  const muzzle = new THREE.Vector3().copy(camera.position).addScaledVector(_m, scoped ? 0.8 : 1.1).addScaledVector(_r, scoped ? 0 : 0.18).addScaledVector(_u, scoped ? -0.12 : -0.18);
  const targets = allTargets();
  const pelletCount = w.pellets || 1;
  const maxRange = w.range || 600;
  const hitSummary = new Map();
  let lastEnd = null, lastWall = null, anyHit = false;

  for (let i = 0; i < pelletCount; i++) {
    aimDir(_d);
    if (spread > 0) {
      const a = Math.random() * Math.PI * 2;
      const r = (pelletCount > 1 ? Math.sqrt(Math.random()) : Math.random()) * spread;
      _d.addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
    }
    const wall = world.raycast(_o, _d, maxRange, (b) => b.bullet);
    const maxT = wall ? wall.t : maxRange;
    let best = null;
    for (const p of targets) {
      if (!p.alive) continue;
      const h = rayPlayer(_o, _d, p.pose, p.pose.yaw, p.pose.crouch, maxT);
      if (h && (!best || h.t < best.t)) best = { p, t: h.t, part: h.part };
    }
    const endT = best ? best.t : maxT;
    _e.copy(_o).addScaledVector(_d, endT);
    const tStart = muzzle.clone().addScaledVector(_d, scoped ? 4 : 1.4);
    if (tStart.distanceTo(_o) < endT && (pelletCount === 1 || i % 2 === 0)) {
      vfx.tracer(tStart, _e, w.silenced ? 0xcbe8ff : 0xffe7a8, scoped ? 0.015 : pelletCount > 1 ? 0.012 : 0.018);
    }
    if (best) {
      anyHit = true;
      const head = best.part === 'head';
      const dmg = head ? w.dmg.head : best.part === 'legs' ? w.dmg.legs : w.dmg.body;
      vfx.blood(_e, _d, head);
      const prev = hitSummary.get(best.p);
      if (prev) {
        prev.dmg += dmg;
        prev.head = prev.head || head;
        prev.dist = Math.min(prev.dist, best.t);
      } else {
        hitSummary.set(best.p, { dmg, head, dist: best.t });
      }
    } else if (wall && (pelletCount === 1 || i < 4)) {
      vfx.impact(_e, wall.normal, wall.mat);
    }
    if (i === 0) { lastEnd = _e.clone(); lastWall = wall; }
  }

  for (const [target, info] of hitSummary.entries()) {
    dealDamage(target, info.dmg, info.head, w.id, info.dist);
  }

  if (!w.silenced) { vfx.light.position.copy(muzzle); vfx.lightT = 0; }
  if (lastEnd) {
    net.send({ t: 'f', w: 1, o: [r2(muzzle.x), r2(muzzle.y), r2(muzzle.z)], e: [r2(lastEnd.x), r2(lastEnd.y), r2(lastEnd.z)], h: anyHit ? 1 : 0, n: !anyHit && lastWall ? lastWall.normal : undefined, m: !anyHit && lastWall ? lastWall.mat : undefined });
  }
  const rk = w.recoilKick || 0.025;
  me.recoil = Math.min(0.14, me.recoil + rk * (me.ads > 0.5 ? 0.72 : 1));
  me.shake = Math.max(me.shake, Math.min(0.65, rk * 11));
  vm.fire();
  audio.gunshot(w, null);
  if (w.id === 'operator' && curAmmo > 0) audio.bolt(0.35);
  if (curAmmo <= 0) setTimeout(() => { if (me.alive && activeWeaponId() === w.id) startReload(); }, 350);
  syncHudLoadout();
}
function dealDamage(p, dmg, head, weapon, dist) {
  if (p.isDummy) { damageDummy(p, dmg, head, weapon, dist); return; }
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
  const interval = net.mode === 'server' ? 50 : 125;
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
      const s = { t: m.ts + p.offset, x: +m.p[0], y: +m.p[1], z: +m.p[2], yaw: +m.r || 0, pitch: +m.x || 0, w: clamp(m.w | 0, 0, 2), c: !!m.c, sp: +m.sp || 0, pr: !!m.pr, g: !!m.g };
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
        if (d < 6 && d > 0.25) audio.whiz(cp, d);
      }
      break;
    }
    case 'p': if (p.avatar) { p.avatar.punch(); if (m.w === 2) audio.knifeSlash(p.avatar.root.position, !!m.hv); else audio.swing(p.avatar.root.position); } break;
    case 'dmg': {
      if (m.v === net.id) onDamaged(p, m);
      else {
        const v = peers.get(m.v);
        if (v && v.avatar && (m.w === 'fist' || m.w === 'knife')) {
          if (m.w === 'knife') audio.knifeHit(v.avatar.root.position, false);
          else audio.punchHit(v.avatar.root.position);
          vfx.punchHit(v.avatar.root.position.clone().setY(v.avatar.root.position.y + 1.3));
        }
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
        me.killStreak = (me.killStreak || 0) + 1;
        me.hp = Math.min(MAX_HP, me.hp + KILL_HEAL);
        hud.setHP(me.hp);
        hud.hit('kill');
        const tier = Math.max(1, Math.min(6, me.killStreak));
        hud.showKillEffect(tier, settings.vol, () => audio.kill());
        const streakLabel = me.killStreak === 5 ? 'ACE (5 MẠNG) · ' : me.killStreak >= 6 ? `CHUỖI ${me.killStreak} MẠNG · ` : me.killStreak > 1 ? `MẠNG LIÊN TIẾP #${me.killStreak} · ` : '';
        hud.center(`HẠ GỤC ${p.name.toUpperCase()}`, streakLabel + (m.hs ? 'HEADSHOT · ' : '') + `+${KILL_HEAL} HP`, 'kill');
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
    case 'chat': {
      // per-sender limit on the receiving side too: modified clients can bypass their own
      if (!p.chatRL) p.chatRL = new RateLimit(4, 2000, 600);
      const text = cleanChat(m.m);
      if (!text || !p.chatRL.take(now)) break;
      chat?.add(p.name || '???', p.color || '#bbbbbb', text);
      if (p.avatar) p.avatar.say(text);
      break;
    }
    case 'env': {
      forcedPhase = (m.ph === null || m.ph === undefined) ? null : clamp(+m.ph || 0, 0, 1);
      updateDayNight();
      const who = cleanName(m.by || p.name || 'Admin');
      const lbl = cleanChat(m.label || (forcedPhase === null ? 'Chu kỳ tự động' : `phase ${forcedPhase.toFixed(2)}`));
      chat?.system(`[Admin] ${who} đã chỉnh thời gian sang: ${lbl}`);
      break;
    }
  }
}
function closestOnSeg(a, b, p) {
  const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
  return a.clone().addScaledVector(ab, t);
}
function addKill(killer, victim, weapon, hs, mine, dist) {
  hud.killfeed(killer, victim, weapon, hs, mine || victim.name === myName(), dist);
  const wName = WEAPONS[weapon]?.name || (weapon === 'fist' ? 'nắm đấm' : weapon === 'knife' ? 'dao Butterfly' : 'AWM');
  feed.unshift(`<b style="color:${killer.color}">${escapeHtml(killer.name)}</b> hạ <b style="color:${victim.color}">${escapeHtml(victim.name)}</b> bằng ${wName}${hs ? ' (headshot)' : ''}${dist ? ` · ${Math.round(dist)}m` : ''}`);
  if (feed.length > 30) feed.pop();
}
function onDamaged(attacker, m) {
  const now = performance.now();
  if (state !== 'playing' || !me.alive) return;
  if (now < me.protectedUntil || me.god) return;
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
  me.sprint = !!sprint;
  const curW = activeWeaponDef();
  const wSpeedFactor = curW ? clamp((curW.runSpeed || 5.4) / 5.4, 0.85, 1.18) : 1;
  let speed = (me.crouching ? 2.8 : sprint ? 8.2 : 5.4) * (me.speedMult || 1);
  if (!me.crouching) speed *= wSpeedFactor;
  if (me.ads > 0.5) speed *= curW.scope ? 0.55 : 0.78;
  const accel = me.onGround ? 14 : 2.5;
  const tx = (fx || fz) ? wx * speed : 0, tz = (fx || fz) ? wz * speed : 0;
  me.vel.x = damp(me.vel.x, tx, accel, dt);
  me.vel.z = damp(me.vel.z, tz, accel, dt);
  if (keys.Space && me.onGround && locked) { me.vel.y = 6.8; me.onGround = false; me.jumpImpulse = 1.0; }
  me.vel.y -= 21 * dt;
  const fallV = me.vel.y;
  const wasGround = me.onGround;
  mover.move(me, dt, h);
  if (!wasGround && me.onGround && fallV < -3.5) {
    me.landImpulse = Math.min(1.5, -fallV / 11);
    if (fallV < -7) { audio.land(); me.landDip = Math.min(0.25, -fallV * 0.02); if (fallV < -16 && !me.god) { /* fall damage */ const d = Math.round((-fallV - 16) * 6); if (d > 0) { me.hp -= d; hud.setHP(me.hp); hud.damage(null, d); if (me.hp <= 0) die(null, { w: 'fall' }); } } }
  }
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
  if (me.reloadEnd && now >= me.reloadEnd) {
    me.reloadEnd = 0;
    if (typeof curW.mag === 'number') me.ammoMap[curW.id] = curW.mag;
    syncHudLoadout();
  }
  hud.setReload(me.reloadEnd ? (now - me.reloadStart) / Math.max(100, me.reloadDurMs || AWM.reload) : -1);
  const canAds = curW.slot !== 'melee' && !me.reloadEnd && now >= me.switchUntil && adsHeld && !sprint && !buyMenu?.open;
  me.ads = clamp(me.ads + (canAds ? dt * 6 : -dt * 8), 0, 1);
  if (firing && !buyMenu?.open && (curW.slot === 'melee' || curW.auto)) tryFire(false);

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
  const scoped = !!(curW.scope && me.ads > 0.92);
  const adsFov = curW.adsFov || 62;
  const targetFov = scoped ? adsFov : lerp(75, curW.scope ? 62 : adsFov, me.ads) + (sprint && hs > 6 ? 5 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov = scoped ? targetFov : damp(camera.fov, targetFov, 14, dt); camera.updateProjectionMatrix(); }

  // HUD
  const protectedNow = now < me.protectedUntil;
  hud.protect(protectedNow);
  let spreadPx = curW.slot !== 'melee' ? (4 + (curW.spreadHip || 0.3) * 8) + hs * 2.4 + (me.onGround ? 0 : 18) : 0;
  if (me.crouching) spreadPx *= 0.6;
  if (me.ads > 0.4) spreadPx *= 0.5;
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
    av.updateBubble(now, Math.hypot(dist, s.y + 1.6 - camera.position.y));
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
  const c = map ? map.center : { x: 0, z: 0 };
  camera.position.set(c.x + Math.cos(lobbyAngle) * 320, 150, c.z + Math.sin(lobbyAngle) * 270);
  camera.lookAt(c.x, 0, c.z);
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
  else if (state === 'inspect') inspector.update(dt);
  else lobbyCam(dt);

  updatePeers(dt, now);
  for (const d of dummies.values()) {
    if (!d.alive || !d.avatar || !d.pose) continue;
    d.avatar.update(dt, { x: d.pose.x, y: d.pose.y, z: d.pose.z, yaw: d.pose.yaw, pitch: 0, speed: 0, crouch: false, weapon: 0, protected: false });
    const dist = Math.hypot(d.pose.x - camera.position.x, d.pose.z - camera.position.z);
    d.avatar.tag.visible = dist < 90;
  }
  if (net.connected) {
    if (state === 'playing') sendState(false);
    if (now - lastHello > 2000) sendHello();
    if (now - lastPing > 2000) { lastPing = now; net.sendPing(); updateNetBadge(); }
  }

  // sun follows the action
  const focus = state === 'lobby' ? new THREE.Vector3(map.center.x, 0, map.center.z) : state === 'dead' ? deathPos : state === 'inspect' ? camera.position : me.pos;
  setShadowArea(state === 'lobby' ? 210 : state === 'inspect' ? 140 : 75);
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  updateDayNight();
  sun.position.copy(sun.target.position).addScaledVector(lightDir, 220);
  scene.userData.sky.position.copy(camera.position);

  vfx.update(dt, camera);
  debris.update(dt);
  audio.updateListener(camera);

  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  if (state === 'playing') {
    vm.update(dt, {
      speed: Math.hypot(me.vel.x, me.vel.z),
      onGround: me.onGround,
      sprint: me.sprint,
      crouchV: me.crouchV,
      ads: me.ads,
      lookDX,
      lookDY,
      yaw: me.yaw,
      pitch: me.pitch,
      vel: me.vel,
      jumpImpulse: me.jumpImpulse,
      landImpulse: me.landImpulse,
    });
    me.jumpImpulse = 0;
    me.landImpulse = 0;
    const curW = activeWeaponDef();
    if (!(curW.scope && me.ads > 0.92)) {
      renderer.clearDepth();
      renderer.render(vm.scene, vm.camera);
    }
    const mapEntities = dummies.size ? new Map([...peers, ...dummies]) : peers;
    hud.drawMinimap(me.pos.x, me.pos.z, me.yaw, mapEntities);
    hud.drawBigMap(!!keys.KeyM, me.pos.x, me.pos.z, me.yaw);
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
window.__game = { audio, get hud() { return hud; }, get chat() { return chat; }, get buyMenu() { return buyMenu; }, get collectionUI() { return collectionUI; }, get inspector() { return inspector; }, me, peers, dummies, net, world, camera, keys, spawn, tryFire, switchWeapon, setTimeOfDay, handleChatCommand, triggerKillStreak, spawnDummy, clearDummies, toggleBuyMenu, equipFromShop, unlockAllSkins, unlockSkin, resetSkins, getEquippedSkin, WEAPONS, get forcedPhase() { return forcedPhase; }, get vm() { return vm; }, get state() { return state; }, setLook(y, p) { me.yaw = y; me.pitch = p; }, setAds(v) { adsHeld = v; } };
