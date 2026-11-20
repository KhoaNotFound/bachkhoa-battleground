// Tham số chế độ "Ở lại trường vào buổi tối" (newmod.md mục 11).
// Đổi giá trị ở đây, hoặc thử nhanh qua URL: ?cfg=R_HEAR:15,T_ALONE:10 (chỉ chủ phòng cần đặt,
// chủ phòng gửi cấu hình của mình cho mọi người lúc bắt đầu trận).

export const CONFIG = {
  GAME_START: '22:00',
  GAME_END: '08:00',
  REAL_MINUTES: 25,          // số phút thật cho cả đêm
  PHASE2_AT: '01:00',
  PHASE3_AT: '04:00',
  R_HEAR: 20,                // m, bán kính nghe được giọng
  // đi lẻ = không có người sống nào khác trong NEAR_DIST, hoặc trong ALONE_DIST mà nhìn thấy nhau
  // (hai phòng task khác nhau là tách nhóm; đứng hai bên một bức tường vẫn tính là đi cùng nhau)
  NEAR_DIST: 15,
  ALONE_DIST: 30,
  T_SPAWN: 25,               // s, phải có người đi lẻ liên tục chừng này thì ma mới xuất hiện (nấp nghe / lướt qua)
  T_ALONE: 40,               // s, đi lẻ bao lâu thì ma tới bắt chuyện
  MAX_GHOSTS: [1, 2, 3],     // theo pha
  GHOST_RESPAWN: 60,         // s
  NOISE_RADIUS: 15,          // m
  KNOWLEDGE_RULE: true,      // ma chỉ dùng clip có heard_by_ghost (+ clip né)
  W_SEM: 0.6, W_CTX: 0.25, W_REC: 0.15, W_REP: 0.5,
  SCORE_THRESHOLD: 0.55,
  TAU_REC: 60,               // phút game
  REPEAT_COOLDOWN: 90,       // s
  AMMO: 2,
  WHISPER_MODEL: 'small',    // small khi có WebGPU; máy không có WebGPU tự hạ xuống base (xem README)

  // ---- tham số phụ của bản demo (không có trong spec, chỉnh khi playtest) ----
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,
  VOICE_REF: 2, VOICE_ROLLOFF: 1.5, VOICE_MAX: 25,  // mục 7
  OCCLUSION_LOWPASS: 800, OCCLUSION_GAIN: 0.45,
  TALK_DIST: 3,              // m, APPROACH -> TALK
  GRAB_DIST: 1.5,            // m
  LURE_KILL_PHASE: 2,        // từ pha này ma được giết người đã bị dụ tới chỗ vắng (spec gốc: chỉ pha 3)
  GHOST_SPEED: 3.2,          // m/s (ghi đè bằng tốc độ trung bình của người bị giả dạng nếu có)
  SHOOT_RANGE: 30,
  TASK_WRONG_LOCK: 30,       // s khoá task Máy tính / Hoá sau khi làm sai
  CLIP_MIN: 0.4, CLIP_MAX: 8,
};

export function applyOverrides(cfg, str) {
  if (!str) return cfg;
  for (const part of str.split(',')) {
    const [k, v] = part.split(':');
    if (!(k in cfg)) continue;
    const cur = cfg[k];
    if (typeof cur === 'number') cfg[k] = Number(v);
    else if (typeof cur === 'boolean') cfg[k] = v === 'true' || v === '1';
    else if (Array.isArray(cur)) cfg[k] = v.split('/').map(Number);
    else cfg[k] = v;
  }
  return cfg;
}

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
// phút game kể từ GAME_START (22:00 -> 0, 08:00 -> 600)
export function gameMinutes(cfg, s) { let d = hm(s) - hm(cfg.GAME_START); if (d < 0) d += 1440; return d; }
export function nightLength(cfg) { return gameMinutes(cfg, cfg.GAME_END); }
export function clockText(cfg, tMin) {
  const m = Math.floor(hm(cfg.GAME_START) + tMin) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
export function phaseOf(cfg, tMin) {
  if (tMin >= gameMinutes(cfg, cfg.PHASE3_AT)) return 3;
  if (tMin >= gameMinutes(cfg, cfg.PHASE2_AT)) return 2;
  return 1;
}
// phút game trôi qua mỗi giây thật
export function gameRate(cfg) { return nightLength(cfg) / (cfg.REAL_MINUTES * 60); }

export const FACULTIES = [
  { id: 'cs', name: 'Máy tính', task: 'cs' },
  { id: 'ee', name: 'Điện', task: 'ee' },
  { id: 'me', name: 'Cơ khí', task: 'me' },
  { id: 'ch', name: 'Hoá', task: 'ch' },
  { id: 'ce', name: 'Xây dựng', task: 'ce' },
];
// mọi người (và ma) mặc cùng một màu áo: chỉ nhận ra nhau qua giọng và cách di chuyển
export const SHIRT = '#1e88e5';

export const DODGE_LINES = [
  'Ờ, đợi xíu.',
  'Để tao xem đã.',
  'Ừ.',
  'Không biết nữa.',
  'Đi, đi.',
  'Ê, qua đây.',
  'Gì vậy?',
  'Làm tới đâu rồi?',
];
