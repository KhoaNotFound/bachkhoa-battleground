import { WEAPONS } from './weapons.js';

const LS_KEY = 'bkbg.skins';

export const TIER_META = {
  standard:  { label: 'Mặc định',  color: '#8aa2b2', symbol: '◇' },
  select:    { label: 'Select',    color: '#5ca9e6', symbol: '●' },
  deluxe:    { label: 'Deluxe',    color: '#2ce5b5', symbol: '◆' },
  premium:   { label: 'Premium',   color: '#e066a6', symbol: '▽' },
  exclusive: { label: 'Exclusive', color: '#f5b942', symbol: '⬟' },
};

const CUSTOM_SKINS = {
  classic: [
    {
      id: 'classic_cs2',
      name: 'USP-S',
      subtitle: 'CS2 · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/cs2/usps-cs2.glb',
      thumb: 'assets/skins/thumbs/classic-cs2.png',
      desc: 'Súng lục giảm thanh USP-S chuẩn CS2 với vật liệu PBR sắc nét và hoạt ảnh soi súng (F).',
    },
    {
      id: 'classic_default',
      name: 'CLASSIC',
      subtitle: 'Valorant · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: null,
      thumb: null,
      desc: 'Súng lục Classic tiêu chuẩn phong cách Valorant.',
    },
  ],
  sheriff: [
    {
      id: 'sheriff_cs2',
      name: 'DESERT EAGLE',
      subtitle: 'CS2 · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/cs2/deagle-cs2.glb',
      thumb: 'assets/skins/thumbs/sheriff-cs2.png',
      desc: 'Lục bạc hạng nặng Desert Eagle chuẩn CS2 với lớp thép mạ sáng và hoạt ảnh soi súng (F).',
    },
    {
      id: 'sheriff_default',
      name: 'SHERIFF',
      subtitle: 'Valorant · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: null,
      thumb: null,
      desc: 'Súng lục ổ quay Sheriff tiêu chuẩn phong cách Valorant.',
    },
  ],
  phantom: [
    {
      id: 'phantom_cs2',
      name: 'M4A1-S',
      subtitle: 'CS2 · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/cs2/m4a1s-cs2.glb',
      thumb: 'assets/skins/thumbs/phantom-cs2.png',
      desc: 'Súng trường giảm thanh M4A1-S chuẩn CS2 kèm hoạt ảnh soi súng hất-xoay-hứng (F).',
    },
    {
      id: 'phantom_default',
      name: 'PHANTOM',
      subtitle: 'Valorant · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: null,
      thumb: null,
      desc: 'Súng trường giảm thanh Phantom tiêu chuẩn phong cách Valorant.',
    },
  ],
  vandal: [
    {
      id: 'vandal_default',
      name: 'VANDAL',
      subtitle: 'Valorant · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/vandal/vandal-default.glb',
      thumb: 'assets/skins/thumbs/vandal-default.png',
      desc: 'Mô hình 3D Vandal nguyên bản Valorant với vật liệu PBR kim loại nhám và hoạt ảnh soi súng hất-xoay-hứng (F).',
    },
    {
      id: 'vandal_cs2',
      name: 'AK-47',
      subtitle: 'CS2 · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/cs2/ak47-cs2.glb',
      thumb: 'assets/skins/thumbs/vandal-cs2.png',
      desc: 'Súng trường huyền thoại AK-47 ốp gỗ chuẩn CS2 kèm hoạt ảnh soi súng hất-xoay-hứng (F).',
    },
    {
      id: 'vandal_forsaken',
      name: 'FORSAKEN VANDAL',
      subtitle: 'White · Sovereign',
      tier: 'premium',
      ownedByDefault: false,
      glb: 'assets/skins/vandal/vandal-forsaken.glb',
      thumb: 'assets/skins/thumbs/vandal-forsaken.png',
      desc: 'Phiên bản Forsaken trắng mạ vàng kèm tinh thể xanh ngọc tinh xảo.',
    },
    {
      id: 'vandal_rgx',
      name: 'RGX 11Z PRO VANDAL',
      subtitle: 'LED Tactical',
      tier: 'exclusive',
      ownedByDefault: false,
      glb: 'assets/skins/vandal/vandal-rgx.glb',
      thumb: 'assets/skins/thumbs/vandal-rgx.png',
      desc: 'Thân vỏ trong suốt lộ linh kiện cơ khí kết hợp dải LED phát sáng phong cách RGX 11z Pro.',
    },
  ],
  operator: [
    {
      id: 'operator_cs2',
      name: 'AWP',
      subtitle: 'CS2 · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: 'assets/skins/cs2/awp-cs2.glb',
      thumb: 'assets/skins/thumbs/operator-cs2.png',
      desc: 'Súng bắn tỉa AWP xanh rêu chuẩn CS2 với độ chi tiết cao và ngắm 5.0×.',
    },
    {
      id: 'operator_default',
      name: 'OPERATOR',
      subtitle: 'Valorant · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      glb: null,
      thumb: null,
      desc: 'Súng bắn tỉa Operator tiêu chuẩn phong cách Valorant.',
    },
    {
      id: 'operator_dragon_lore',
      name: 'AWP DRAGON LORE',
      subtitle: 'CS:GO · Souvenir',
      tier: 'exclusive',
      ownedByDefault: false,
      glb: 'assets/awp-dragon-lore.glb',
      thumb: 'assets/skins/thumbs/operator-default.png',
      desc: 'Phiên bản huyền thoại CS:GO AWP Dragon Lore kèm đầy đủ hoạt ảnh kéo khóa nòng & press-check (F).',
    },
  ],
  knife: [
    {
      id: 'knife_default',
      name: 'NẮM ĐẤM',
      subtitle: 'Cận chiến · Mặc định',
      tier: 'standard',
      ownedByDefault: true,
      meleeType: 'fist',
      svgKey: 'fist',
      glb: null,
      thumb: null,
      desc: 'Đấm tay không luân phiên 2 tay, tăng +8% tốc độ chạy (mặc định cho ô Cận chiến).',
    },
    {
      id: 'knife_butterfly',
      name: 'DAO BUTTERFLY',
      subtitle: 'Champions · Cận chiến',
      tier: 'exclusive',
      ownedByDefault: false,
      meleeType: 'knife',
      svgKey: 'knife',
      glb: 'assets/butterfly-knife.glb',
      thumb: 'assets/skins/thumbs/knife-butterfly.png',
      desc: 'Dao Butterfly Champions với hiệu ứng múa 4 pha khi nhấn phím F và tăng +15% tốc độ chạy.',
    },
  ],
};

// Build complete catalog for every weapon in WEAPONS (fist is merged into knife/MELEE default skin)
export const SKINS_CATALOG = (() => {
  const map = Object.create(null);
  for (const id of Object.keys(WEAPONS)) {
    if (id === 'fist') continue;
    const w = WEAPONS[id];
    if (CUSTOM_SKINS[id]) {
      map[id] = CUSTOM_SKINS[id].map((s) => ({ ...s, weaponId: id }));
    } else {
      map[id] = [
        {
          id: `${id}_default`,
          weaponId: id,
          name: w.name,
          subtitle: 'Mặc định',
          tier: 'standard',
          ownedByDefault: true,
          glb: null,
          thumb: null,
          desc: `Phiên bản tiêu chuẩn của ${w.name} (${w.catVi}).`,
        },
      ];
    }
  }
  return map;
})();

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return {
      equipped: raw && typeof raw.equipped === 'object' && raw.equipped ? { ...raw.equipped } : {},
      unlocked: Array.isArray(raw?.unlocked) ? [...new Set(raw.unlocked)] : [],
    };
  } catch {
    return { equipped: {}, unlocked: [] };
  }
}

const skinState = loadState();
const listeners = new Set();

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(skinState));
  } catch {}
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch {}
  }
}

export function onSkinsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWeaponSkins(weaponId) {
  return SKINS_CATALOG[weaponId] || [];
}

export function getSkin(weaponId, skinId) {
  const list = getWeaponSkins(weaponId);
  return list.find((s) => s.id === skinId) || list[0] || null;
}

export function isSkinOwned(weaponId, skinId) {
  const skin = getSkin(weaponId, skinId);
  if (!skin) return false;
  if (skin.ownedByDefault) return true;
  return skinState.unlocked.includes(skin.id);
}

export function getEquippedSkin(weaponId) {
  const list = getWeaponSkins(weaponId);
  if (!list.length) return null;
  const savedId = skinState.equipped[weaponId];
  if (savedId) {
    const found = list.find((s) => s.id === savedId);
    if (found && isSkinOwned(weaponId, found.id)) return found;
  }
  return list[0];
}

export function equipSkin(weaponId, skinId) {
  const skin = getSkin(weaponId, skinId);
  if (!skin || !isSkinOwned(weaponId, skin.id)) return false;
  skinState.equipped[weaponId] = skin.id;
  saveState();
  notify();
  return true;
}

export function unlockSkin(skinId) {
  const target = String(skinId || '').trim().toLowerCase();
  let matched = null;
  for (const wid in SKINS_CATALOG) {
    for (const s of SKINS_CATALOG[wid]) {
      if (s.id.toLowerCase() === target || s.name.toLowerCase() === target) {
        matched = s;
        break;
      }
    }
    if (matched) break;
  }
  if (!matched) return null;
  if (!matched.ownedByDefault && !skinState.unlocked.includes(matched.id)) {
    skinState.unlocked.push(matched.id);
    saveState();
    notify();
  }
  return matched;
}

export function unlockAllSkins() {
  let added = 0;
  for (const wid in SKINS_CATALOG) {
    for (const s of SKINS_CATALOG[wid]) {
      if (!s.ownedByDefault && !skinState.unlocked.includes(s.id)) {
        skinState.unlocked.push(s.id);
        added++;
      }
    }
  }
  saveState();
  notify();
  return added;
}

export function resetSkins() {
  skinState.unlocked = [];
  for (const wid of Object.keys(skinState.equipped)) {
    if (!isSkinOwned(wid, skinState.equipped[wid])) {
      delete skinState.equipped[wid];
    }
  }
  saveState();
  notify();
}

export function getWeaponSkinCounts(weaponId) {
  const list = getWeaponSkins(weaponId);
  let owned = 0;
  for (const s of list) if (isSkinOwned(weaponId, s.id)) owned++;
  return { owned, total: list.length };
}

export function getTotalSkinCounts() {
  let owned = 0, total = 0;
  for (const wid in SKINS_CATALOG) {
    for (const s of SKINS_CATALOG[wid]) {
      total++;
      if (isSkinOwned(wid, s.id)) owned++;
    }
  }
  return { owned, total };
}
