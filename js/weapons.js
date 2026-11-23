// Complete weapon catalog & Valorant-style Buy Menu metadata for Bách Khoa Battleground.
// Slots: 'primary' (key 1), 'secondary' (key 2), 'melee' (key 3: knife OR fist, mutually exclusive).

export const WEAPON_SVGS = {
  classic: `<svg viewBox="0 0 120 44" fill="currentColor"><path d="M26 10h54l4 4v6H60l-6 18H40l4-18H26v-10zm48 0h12v4H74v-4zm-30 10h12v4H44v-4z"/></svg>`,
  shorty: `<svg viewBox="0 0 140 44" fill="currentColor"><path d="M14 26l14-12h20l6 2h66v6H56l-10 4-18 12-14-4 6-8zM54 22h42v4H54z"/></svg>`,
  frenzy: `<svg viewBox="0 0 120 44" fill="currentColor"><path d="M24 10h56l6 4v7H62l-3 17H47l3-17H36l-4 15H22l4-15v-11zm48-3h14v3H72z"/></svg>`,
  ghost: `<svg viewBox="0 0 140 44" fill="currentColor"><path d="M16 12h62v9H50l-6 17H30l5-17H16v-9zm64 1h44v7H80v-7z"/></svg>`,
  sheriff: `<svg viewBox="0 0 130 44" fill="currentColor"><path d="M22 28l10-12h14l4-6h56v8H62v6H48l-10 14H24l4-10zm30-14h14v10H52z"/></svg>`,

  stinger: `<svg viewBox="0 0 160 46" fill="currentColor"><path d="M14 14h24l8-4h56l8 5h32v5h-32l-4 4H84l-5 16H69l4-16H52l-6 14H36l5-14H24l-10 6V14z"/></svg>`,
  spectre: `<svg viewBox="0 0 160 46" fill="currentColor"><path d="M12 16h26l6-5h52l6 4h46v6h-46l-4 4H78l-4 15H64l3-15H50l-5 13H35l4-13H12v-9z"/></svg>`,

  bucky: `<svg viewBox="0 0 170 46" fill="currentColor"><path d="M10 24l18-10h34l8-2h86v6H76v4h44v4H66l-12 2-18 10-20-4 8-10z"/></svg>`,
  judge: `<svg viewBox="0 0 170 46" fill="currentColor"><path d="M10 15h34l6-4h64l6 4h38v6h-38l-4 4H92c0 8-6 13-14 13s-14-5-14-13H48l-6 13H31l5-13H10V15z"/></svg>`,

  bulldog: `<svg viewBox="0 0 170 48" fill="currentColor"><path d="M12 14h32l8-6h56l8 6h40v6h-40l-6 5H78l-4 14H62l3-14H40l-4 14H24l4-14H12V14zm46-3h28v3H58v-3z"/></svg>`,
  guardian: `<svg viewBox="0 0 180 46" fill="currentColor"><path d="M8 20l22-6h30l8-4h50l6 4h48v5h-48l-6 4H88l-4 15H74l3-15H54l-14 12H16l8-11H8v-4z"/></svg>`,
  phantom: `<svg viewBox="0 0 180 48" fill="currentColor"><path d="M10 15h34l6-5h52l6 5h60v6h-60l-5 4H84l-5 15H69l4-15H54l-6 14H38l5-14H10V15zm46-6h26v4H56V9z"/></svg>`,
  vandal: `<svg viewBox="0 0 180 48" fill="currentColor"><path d="M10 17l28-4h20l8-5h46l8 5h46v5h-46l-6 5H94c-2 8-6 14-12 17l-10-2c5-4 8-9 9-15H56l-6 14H40l5-14H28l-18 6V17z"/></svg>`,

  marshal: `<svg viewBox="0 0 190 46" fill="currentColor"><path d="M8 24l24-8h34l6-6h34l6 6h70v4h-70l-8 4H64l-18 11H16l8-9H8v-2zm62-15h34v5H70V9z"/></svg>`,
  outlaw: `<svg viewBox="0 0 190 46" fill="currentColor"><path d="M8 22l26-7h34l8-4h44l6 4h56v6h-56l-6 3H74l-16 12H18l8-10H8v-4zm64-13h40v5H72V9z"/></svg>`,
  operator: `<svg viewBox="0 0 190 48" fill="currentColor"><path d="M8 18h28l8-3h52l6 3h78v5h-78v4H82l-5 13H67l3-13H48l-14 12H14l7-12H8v-9zm42-11h48v6H50V7zm16 6h6v4h-6v-4zm20 0h6v4h-6v-4z"/></svg>`,

  ares: `<svg viewBox="0 0 180 48" fill="currentColor"><path d="M10 15h34l8-5h62l8 5h48v6h-48l-6 4H98v13H68V25H50l-6 14H34l5-14H10V15z"/></svg>`,
  odin: `<svg viewBox="0 0 185 50" fill="currentColor"><path d="M10 14h34l8-5h68l8 5h47v8h-47l-6 5h-16v14H66V27H48l-6 14H31l5-14H10V14zm52-7h38v4H62V7z"/></svg>`,

  knife: `<svg viewBox="0 0 150 48" fill="currentColor"><path d="M14 14c18 1 36 5 54 7v6c-18-2-36-4-54-7v-6z"/><path d="M14 34c18-1 36-5 54-7v-6c-18 2-36 4-54 7v6z"/><path d="M68 18h36c16 0 28 3 36 7-9 4-22 6-36 5H68V18z"/></svg>`,
  fist: `<svg viewBox="0 0 120 48" fill="currentColor"><path d="M36 12h36a8 8 0 0 1 8 8v12a10 10 0 0 1-10 10H42a10 10 0 0 1-10-10V20l-6 2v-7l10-3z"/></svg>`,
};

export const WEAPONS = {
  // ---------------- SIDEARMS ----------------
  classic: {
    id: 'classic', name: 'CLASSIC', cat: 'SIDEARMS', catVi: 'SÚNG LỤC', slot: 'secondary', price: 0,
    mode: 'Semi', auto: false, pen: 'Low', penVi: 'Thấp',
    fireRate: 6.75, runSpeed: 5.73, equipSec: 0.75, spreadHip: 0.4, spreadAds: 0.4,
    reloadSec: 1.75, mag: 12, pellets: 1, range: 260,
    dmg: { head: 78, body: 26, legs: 22 },
    adsFov: 68, scope: false, silenced: false, recoilKick: 0.018,
    modelType: 'pistol', color: 0x3b424c, accent: 0x6c7a89,
    altTitle: 'ALT FIRE · BẮN CHÙM 3 VIÊN',
    altBullets: ['Mặc định trang bị miễn phí', 'Độ cơ động cao (5.73 m/s)', 'Bắn bán tự động chính xác tầm gần'],
  },
  shorty: {
    id: 'shorty', name: 'SHORTY', cat: 'SIDEARMS', catVi: 'SÚNG LỤC', slot: 'secondary', price: 300,
    mode: 'Pellet ×12', auto: false, pen: 'Low', penVi: 'Thấp',
    fireRate: 3.33, runSpeed: 5.4, equipSec: 0.75, spreadHip: 4.0, spreadAds: 4.0,
    reloadSec: 1.75, mag: 2, pellets: 12, pelletSpread: 0.095, range: 28,
    dmg: { head: 22, body: 11, legs: 9 },
    adsFov: 68, scope: false, silenced: false, recoilKick: 0.048,
    modelType: 'shorty', color: 0x3d3835, accent: 0x7a5c43,
    altTitle: 'SHOTGUN CẦM TAY 2 NÒNG',
    altBullets: ['Bắn 12 viên bi mỗi phát', 'Sát thương hủy diệt ở cự ly gần (< 10m)', 'Nạp lại nhanh 1.75 giây'],
  },
  frenzy: {
    id: 'frenzy', name: 'FRENZY', cat: 'SIDEARMS', catVi: 'SÚNG LỤC', slot: 'secondary', price: 450,
    mode: 'Auto', auto: true, pen: 'Low', penVi: 'Thấp',
    fireRate: 10.0, runSpeed: 5.73, equipSec: 1.0, spreadHip: 0.45, spreadAds: 0.45,
    reloadSec: 1.5, mag: 13, pellets: 1, range: 200,
    dmg: { head: 78, body: 26, legs: 22 },
    adsFov: 68, scope: false, silenced: false, recoilKick: 0.02,
    modelType: 'frenzy', color: 0x2f3842, accent: 0x2ec4b6,
    altTitle: 'SÚNG LỤC TỰ ĐỘNG',
    altBullets: ['Giữ chuột trái để xả đạn liên thanh 10 viên/giây', 'Rất mạnh khi áp sát tầm gần', 'Tốc độ nạp đạn nhanh 1.5s'],
  },
  ghost: {
    id: 'ghost', name: 'GHOST', cat: 'SIDEARMS', catVi: 'SÚNG LỤC', slot: 'secondary', price: 500,
    mode: 'Semi', auto: false, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 6.75, runSpeed: 5.73, equipSec: 0.75, spreadHip: 0.3, spreadAds: 0.3,
    reloadSec: 1.5, mag: 15, pellets: 1, range: 300,
    dmg: { head: 105, body: 30, legs: 25 },
    adsFov: 68, scope: false, silenced: true, recoilKick: 0.016,
    modelType: 'ghost', color: 0x2a2f36, accent: 0x90a4ae,
    altTitle: 'SÚNG LỤC GIẢM THANH',
    altBullets: ['1 viên Headshot hạ gục ngay (105 sát thương)', 'Nòng giảm thanh êm ái, độ chính xác cao', 'Băng đạn lớn 15 viên'],
  },
  sheriff: {
    id: 'sheriff', name: 'SHERIFF', cat: 'SIDEARMS', catVi: 'SÚNG LỤC', slot: 'secondary', price: 800,
    mode: 'Semi', auto: false, pen: 'High', penVi: 'Cao',
    fireRate: 4.0, runSpeed: 5.4, equipSec: 1.0, spreadHip: 0.25, spreadAds: 0.25,
    reloadSec: 2.25, mag: 6, pellets: 1, range: 400,
    dmg: { head: 159, body: 55, legs: 46 },
    adsFov: 66, scope: false, silenced: false, recoilKick: 0.045,
    modelType: 'revolver', color: 0x454a52, accent: 0xd4af37,
    altTitle: 'LỤC BẠC HẠNG NẶNG',
    altBullets: ['1 phát Headshot 159 sát thương ở mọi tầm trung', 'Độ xuyên cao, tiếng nổ uy lực', '2 phát vào thân hạ gục kẻ địch 100 HP'],
  },

  // ---------------- SMGS ----------------
  stinger: {
    id: 'stinger', name: 'STINGER', cat: 'SMGS', catVi: 'TIỂU LIÊN', slot: 'primary', price: 1100,
    mode: 'Auto', auto: true, pen: 'Low', penVi: 'Thấp',
    fireRate: 16.0, runSpeed: 5.73, equipSec: 0.75, spreadHip: 0.65, spreadAds: 0.35,
    reloadSec: 2.25, mag: 20, pellets: 1, range: 260,
    dmg: { head: 67, body: 27, legs: 22 },
    adsFov: 62, scope: false, silenced: false, recoilKick: 0.017,
    modelType: 'smg', color: 0x353b45, accent: 0xff7043,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.15×)',
    altBullets: ['Tốc độ xả đạn siêu nhanh 16 viên/giây', 'Zoom 1.15× giảm độ tản đạn', 'Cơ động cao khi chạy bắn tầm gần'],
  },
  spectre: {
    id: 'spectre', name: 'SPECTRE', cat: 'SMGS', catVi: 'TIỂU LIÊN', slot: 'primary', price: 1600,
    mode: 'Auto', auto: true, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 13.33, runSpeed: 5.73, equipSec: 0.75, spreadHip: 0.4, spreadAds: 0.25,
    reloadSec: 2.25, mag: 30, pellets: 1, range: 320,
    dmg: { head: 78, body: 26, legs: 22 },
    adsFov: 62, scope: false, silenced: true, recoilKick: 0.015,
    modelType: 'smgSilenced', color: 0x262c34, accent: 0x26c6da,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.15×)',
    altBullets: ['Tiểu liên giảm thanh ổn định nhất tầm gần-trung', 'Băng đạn 30 viên, độ giật thấp', 'Zoom 1.15× cải thiện độ chụm'],
  },

  // ---------------- SHOTGUNS ----------------
  bucky: {
    id: 'bucky', name: 'BUCKY', cat: 'SHOTGUNS', catVi: 'SHOTGUN', slot: 'primary', price: 850,
    mode: 'Pellet ×12', auto: false, pen: 'Low', penVi: 'Thấp',
    fireRate: 1.1, runSpeed: 5.06, equipSec: 1.0, spreadHip: 2.6, spreadAds: 2.6,
    reloadSec: 2.5, mag: 5, pellets: 12, pelletSpread: 0.072, range: 45,
    dmg: { head: 40, body: 20, legs: 17 },
    adsFov: 66, scope: false, silenced: false, recoilKick: 0.055,
    modelType: 'shotgun', color: 0x3b3d40, accent: 0x8d6e63,
    altTitle: 'SHOTGUN BƠM CỔ ĐIỂN',
    altBullets: ['12 viên đạn bi mỗi phát bắn', 'Hạ gục tức thì chỉ 1 phát ở tầm gần', 'Sát thương mỗi viên: 40 Đầu / 20 Thân'],
  },
  judge: {
    id: 'judge', name: 'JUDGE', cat: 'SHOTGUNS', catVi: 'SHOTGUN', slot: 'primary', price: 1850,
    mode: 'Auto · ×10', auto: true, pen: 'Low', penVi: 'Thấp',
    fireRate: 3.5, runSpeed: 5.06, equipSec: 1.0, spreadHip: 2.25, spreadAds: 2.25,
    reloadSec: 2.2, mag: 5, pellets: 10, pelletSpread: 0.082, range: 40,
    dmg: { head: 34, body: 17, legs: 14 },
    adsFov: 66, scope: false, silenced: false, recoilKick: 0.048,
    modelType: 'judge', color: 0x2c3036, accent: 0xef5350,
    altTitle: 'SHOTGUN TỰ ĐỘNG BĂNG TRỐNG',
    altBullets: ['Giữ chuột trái bắn liên tục 3.5 phát/giây', '10 viên bi mỗi phát, càn quét không gian hẹp', 'Nạp đạn cả băng trống trong 2.2 giây'],
  },

  // ---------------- RIFLES ----------------
  bulldog: {
    id: 'bulldog', name: 'BULLDOG', cat: 'RIFLES', catVi: 'SÚNG TRƯỜNG', slot: 'primary', price: 2050,
    mode: 'Auto', auto: true, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 10.0, runSpeed: 5.4, equipSec: 1.0, spreadHip: 0.3, spreadAds: 0.1,
    reloadSec: 2.5, mag: 24, pellets: 1, range: 550,
    dmg: { head: 116, body: 35, legs: 30 },
    adsFov: 56, scope: false, silenced: false, recoilKick: 0.022,
    modelType: 'bullpup', color: 0x3b444b, accent: 0x66bb6a,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.25×)',
    altBullets: ['Zoom 1.25× tăng độ chính xác tầm xa', '1 viên Headshot hạ gục kẻ địch 100 HP', 'Cân bằng giữa giá thành và hỏa lực'],
  },
  guardian: {
    id: 'guardian', name: 'GUARDIAN', cat: 'RIFLES', catVi: 'SÚNG TRƯỜNG', slot: 'primary', price: 2250,
    mode: 'Semi', auto: false, pen: 'High', penVi: 'Cao',
    fireRate: 5.25, runSpeed: 5.4, equipSec: 1.0, spreadHip: 0.1, spreadAds: 0.0,
    reloadSec: 2.5, mag: 12, pellets: 1, range: 850,
    dmg: { head: 195, body: 65, legs: 49 },
    adsFov: 48, scope: false, silenced: false, recoilKick: 0.032,
    modelType: 'dmr', color: 0x323942, accent: 0xffca28,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.5×)',
    altBullets: ['Độ lệch phát đầu 0.0° khi ADS (chuẩn tuyệt đối)', '195 sát thương Headshot · 65 sát thương Thân', 'Độ xuyên cao, cực mạnh tầm trung-xa'],
  },
  phantom: {
    id: 'phantom', name: 'PHANTOM', cat: 'RIFLES', catVi: 'SÚNG TRƯỜNG', slot: 'primary', price: 2900,
    mode: 'Auto', auto: true, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 11.0, runSpeed: 5.4, equipSec: 1.0, spreadHip: 0.2, spreadAds: 0.11,
    reloadSec: 2.5, mag: 30, pellets: 1, range: 600,
    dmg: { head: 156, body: 39, legs: 33 },
    adsFov: 56, scope: false, silenced: true, recoilKick: 0.019,
    modelType: 'rifleSilenced', color: 0x252b34, accent: 0x42a5f5,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.25×)',
    altBullets: ['Súng trường giảm thanh, tốc độ bắn 11 viên/giây', 'Băng đạn 30 viên, độ giật êm dễ kiểm soát', 'Headshot 156 sát thương hạ ngay lập tức'],
  },
  vandal: {
    id: 'vandal', name: 'VANDAL', cat: 'RIFLES', catVi: 'SÚNG TRƯỜNG', slot: 'primary', price: 2900,
    mode: 'Auto', auto: true, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 9.75, runSpeed: 5.4, equipSec: 1.0, spreadHip: 0.25, spreadAds: 0.157,
    reloadSec: 2.5, mag: 25, pellets: 1, range: 700,
    dmg: { head: 160, body: 40, legs: 34 },
    adsFov: 56, scope: false, silenced: false, recoilKick: 0.025,
    modelType: 'vandal_glb', color: 0x2c3035, accent: 0xff7043,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.25×)',
    altBullets: ['Mô hình 3D Vandal chuẩn PBR (ấn F soi súng · đổi skin ngoài Bộ Sưu Tập)', '1 viên Headshot 160 sát thương ở mọi khoảng cách', 'Hỏa lực ổn định 40 sát thương mỗi viên vào thân'],
  },

  // ---------------- SNIPER RIFLES ----------------
  marshal: {
    id: 'marshal', name: 'MARSHAL', cat: 'SNIPER RIFLES', catVi: 'SNIPER', slot: 'primary', price: 950,
    mode: 'Semi', auto: false, pen: 'Medium', penVi: 'Trung bình',
    fireRate: 1.5, runSpeed: 5.4, equipSec: 1.25, spreadHip: 1.0, spreadAds: 0.0,
    reloadSec: 2.5, mag: 5, pellets: 1, range: 1200,
    dmg: { head: 202, body: 101, legs: 85 },
    adsFov: 22, scope: true, silenced: false, recoilKick: 0.042,
    modelType: 'sniper', color: 0x45423d, accent: 0x90a4ae,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (3.5×)',
    altBullets: ['Zoom 3.5× ngắm chính xác tuyệt đối', '1 phát vào thân 101 sát thương hạ mục tiêu 100 HP', 'Tốc độ di chuyển nhanh & nạp đạn linh hoạt'],
  },
  outlaw: {
    id: 'outlaw', name: 'OUTLAW', cat: 'SNIPER RIFLES', catVi: 'SNIPER', slot: 'primary', price: 2400,
    mode: 'Semi', auto: false, pen: 'High', penVi: 'Cao',
    fireRate: 2.75, runSpeed: 5.4, equipSec: 1.25, spreadHip: 3.5, spreadAds: 0.0,
    reloadSec: 3.8, mag: 2, pellets: 1, range: 1350,
    dmg: { head: 238, body: 140, legs: 119 },
    adsFov: 20, scope: true, silenced: false, recoilKick: 0.052,
    modelType: 'outlaw', color: 0x2e353b, accent: 0x2ce5b5,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (3.5×)',
    altBullets: ['Zoom: 3.5×', 'Bắn 2 phát cực nhanh liên tiếp (2.75 viên/giây)', 'Sát thương cao: 238 Đầu / 140 Thân / 119 Chân'],
  },
  operator: {
    id: 'operator', name: 'OPERATOR (AWP)', cat: 'SNIPER RIFLES', catVi: 'SNIPER', slot: 'primary', price: 4700,
    mode: 'Semi', auto: false, pen: 'High', penVi: 'Cao',
    fireRate: 0.74, runSpeed: 5.13, equipSec: 1.35, spreadHip: 5.0, spreadAds: 0.0,
    reloadSec: 2.8, mag: 5, pellets: 1, range: 1500,
    dmg: { head: 250, body: 150, legs: 120 },
    adsFov: 13, scope: true, silenced: false, recoilKick: 0.055,
    modelType: 'sniper', color: 0x3b4838, accent: 0xc9a227,
    altTitle: 'ALT FIRE · DUAL SCOPE (5.0×)',
    altBullets: ['Hỗ trợ 2 bản Default (AWP CS2 & Operator Valorant) + skin AWP Dragon Lore', 'Zoom 5.0× · 1 phát hạ gục mọi vùng cơ thể', 'Độ xuyên tối đa, tầm bắn 1500m toàn khuôn viên'],
  },

  // ---------------- MACHINE GUNS ----------------
  ares: {
    id: 'ares', name: 'ARES', cat: 'MACHINE GUNS', catVi: 'SÚNG MÁY', slot: 'primary', price: 1600,
    mode: 'Auto', auto: true, pen: 'High', penVi: 'Cao',
    fireRate: 13.0, runSpeed: 5.13, equipSec: 1.25, spreadHip: 0.9, spreadAds: 0.7,
    reloadSec: 3.25, mag: 50, pellets: 1, range: 480,
    dmg: { head: 72, body: 30, legs: 25 },
    adsFov: 60, scope: false, silenced: false, recoilKick: 0.022,
    modelType: 'lmg', color: 0x3b4046, accent: 0x78909c,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.15×)',
    altBullets: ['Băng đạn lớn 50 viên, độ xuyên tường cao', 'Tốc độ bắn 13 viên/giây áp chế mạnh', 'Ngồi (C) hoặc ADS giúp gom đạn chặt hơn'],
  },
  odin: {
    id: 'odin', name: 'ODIN', cat: 'MACHINE GUNS', catVi: 'SÚNG MÁY', slot: 'primary', price: 3200,
    mode: 'Auto', auto: true, pen: 'High', penVi: 'Cao',
    fireRate: 15.6, runSpeed: 5.13, equipSec: 1.25, spreadHip: 0.8, spreadAds: 0.55,
    reloadSec: 5.0, mag: 100, pellets: 1, range: 520,
    dmg: { head: 95, body: 38, legs: 32 },
    adsFov: 60, scope: false, silenced: false, recoilKick: 0.024,
    modelType: 'odin', color: 0x262a30, accent: 0xffb300,
    altTitle: 'ALT FIRE · AIM DOWN SIGHTS (1.15×)',
    altBullets: ['Băng đạn khổng lồ 100 viên · 15.6 viên/giây', 'Độ xuyên cao, áp đảo giao tranh tầm trung', 'Zoom 1.15× tối ưu tốc độ xả đạn ngay lập tức'],
  },

  // ---------------- MELEE (MUTUALLY EXCLUSIVE) ----------------
  knife: {
    id: 'knife', name: 'DAO BUTTERFLY', cat: 'MELEE', catVi: 'CẬN CHIẾN', slot: 'melee', price: 0,
    mode: 'Cận chiến', auto: false, pen: 'Low', penVi: 'Không',
    fireRate: 2.63, runSpeed: 6.21, equipSec: 0.52, spreadHip: 0, spreadAds: 0,
    reloadSec: 0, mag: '∞', pellets: 1, range: 2.9,
    dmg: { head: 110, body: 75, legs: 45 },
    modelType: 'butterfly_glb',
    altTitle: 'CHUỘT PHẢI · ĐÂM MẠNH (ICEPICK)',
    altBullets: ['Khi chọn Dao Butterfly sẽ ẨN Nắm đấm', 'Chém nhẹ: 45/70 · Đâm mạnh chuột phải: 75/110', 'Tăng +15% tốc độ chạy · Nhấn F múa dao 4 pha'],
  },
  fist: {
    id: 'fist', name: 'NẮM ĐẤM', cat: 'MELEE', catVi: 'CẬN CHIẾN', slot: 'melee', price: 0,
    mode: 'Cận chiến', auto: false, pen: 'Low', penVi: 'Không',
    fireRate: 2.38, runSpeed: 5.83, equipSec: 0.35, spreadHip: 0, spreadAds: 0,
    reloadSec: 0, mag: '∞', pellets: 1, range: 2.7,
    dmg: { head: 35, body: 25, legs: 25 },
    modelType: 'fists',
    altTitle: 'ĐẤM TAY KHÔNG LUÂN PHIÊN',
    altBullets: ['Khi chọn Nắm đấm sẽ ẨN Dao Butterfly', 'Sát thương: 35 Đầu / 25 Thân & Chân', 'Tăng +8% tốc độ chạy, ra đòn linh hoạt'],
  },
};

export const SHOP_LAYOUT = [
  {
    col: 1,
    sections: [
      { title: 'SIDEARMS · SÚNG LỤC', items: ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff'] },
    ],
  },
  {
    col: 2,
    sections: [
      { title: 'SMGS · TIỂU LIÊN', items: ['stinger', 'spectre'] },
      { title: 'SHOTGUNS', items: ['bucky', 'judge'] },
    ],
  },
  {
    col: 3,
    sections: [
      { title: 'RIFLES · SÚNG TRƯỜNG', items: ['bulldog', 'guardian', 'phantom', 'vandal'] },
    ],
  },
  {
    col: 4,
    sections: [
      { title: 'SNIPER RIFLES · SNIPER', items: ['marshal', 'outlaw', 'operator'] },
      { title: 'MACHINE GUNS · SÚNG MÁY', items: ['ares', 'odin'] },
    ],
  },
  {
    col: 5,
    sections: [
      { title: 'MELEE · CẬN CHIẾN', items: ['knife', 'fist'], tall: true },
    ],
  },
];

export function getWeapon(id) {
  return WEAPONS[id] || WEAPONS.operator;
}
