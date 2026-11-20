// Năm task (newmod.md 9.2), phần chạy trên host: sinh tham số ngẫu nhiên mỗi trận, tính đáp án,
// trả "view" cho client (thêm thông tin chuyên ngành nếu đúng khoa), chấm bài nộp.
// Client không bao giờ nhận đáp án.
//
// Giả định đơn giản hoá (bảng tra, không mô phỏng vật lý thật):
//  - Điện: 3 cặp đầu dây đúng đo được ~220 V; thứ tự cầu dao = CB tổng trước, rồi các nhánh theo dòng tải tăng dần.
//  - Cơ khí: tỉ số truyền i = z2/z1 chính xác, khay luôn có đúng một cặp đạt.
//  - Hoá: nồng độ mol từ nhãn C = 10·d·w/M; khối lượng riêng d lấy xấp xỉ tuyến tính theo w.
//  - Xây dựng: khả năng chịu uốn tỉ lệ với mô-men kháng uốn W = b·h²/6 (đặt đứng) hoặc h·b²/6 (đặt nằm);
//    giằng chéo chỉ là số thanh tối thiểu chống xô ngang. Tải P (kN) = W_cần / 100.

export const TASK_IDS = ['ee', 'cs', 'me', 'ch', 'ce'];
export const TASK_NAMES = { ee: 'Điện', cs: 'Máy tính', me: 'Cơ khí', ch: 'Hoá', ce: 'Xây dựng' };

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
function shuffle(rng, a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ------------------------------------------------------------------ Điện
function genEE(rng) {
  const T = ['A', 'B', 'C', 'D', 'E', 'F'];
  const s = shuffle(rng, T);
  const pairs = [[s[0], s[1]], [s[2], s[3]], [s[4], s[5]]].map((p) => p.sort());
  const key = (a, b) => [a, b].sort().join('');
  const volts = {};
  const good = new Set(pairs.map((p) => key(...p)));
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const k = key(T[i], T[j]);
    volts[k] = good.has(k) ? 215 + Math.round(rng() * 12) : pick(rng, [0, 0, 380, 381, 12, 110, 0.4]);
  }
  const loads = shuffle(rng, [
    { icon: 'lamp', name: 'Đèn chiếu sáng', amp: 0.5 },
    { icon: 'fan', name: 'Quạt hút', amp: 2.5 },
    { icon: 'ac', name: 'Máy lạnh', amp: 9 },
  ]);
  const codes = shuffle(rng, ['Q1', 'Q2', 'Q3', 'Q4']);
  const breakers = [{ code: codes[0], kind: 'main' }, ...loads.map((l, i) => ({ code: codes[i + 1], kind: 'load', ...l }))];
  const order = [breakers[0].code, ...breakers.slice(1).sort((a, b) => a.amp - b.amp).map((b) => b.code)];
  const shown = shuffle(rng, breakers);
  return {
    secret: { good, order, volts },
    pub: { terminals: T, breakers: shown.map((b) => ({ code: b.code, icon: b.kind === 'main' ? 'main' : b.icon })) },
    spec: {
      legend: shown.map((b) => ({ code: b.code, text: b.kind === 'main' ? 'CB tổng (2 cực)' : `${b.name}: ${b.amp} A` })),
      rule: 'Đóng CB tổng trước, sau đó đóng các nhánh từ tải nhỏ đến tải lớn. Cặp đầu dây đúng: 220 V ± 5%.',
    },
  };
}
function measureEE(st, a, b) {
  const k = [a, b].sort().join('');
  const v = st.secret.volts[k];
  if (v == null) return null;
  return { v, ok: Math.abs(v - 220) <= 11 };
}
function checkEE(st, ans) {
  if (!ans || !Array.isArray(ans.wires) || !Array.isArray(ans.order)) return { ok: false, why: 'Thiếu dây hoặc thứ tự cầu dao.' };
  const w = new Set(ans.wires.map((p) => [...p].sort().join('')));
  const wiresOk = w.size === 3 && [...w].every((k) => st.secret.good.has(k));
  const orderOk = ans.order.join() === st.secret.order.join();
  return { ok: wiresOk && orderOk, why: !wiresOk ? 'Nối sai dây: chập điện!' : 'Đóng cầu dao sai thứ tự: chập điện!' };
}

// ------------------------------------------------------------------ Máy tính
const CS_TEMPLATES = [
  (rng) => {
    const M = pick(rng, [1200, 1500, 1800, 2400]), R = pick(rng, [50, 80, 100]);
    return {
      title: 'Bộ điều tốc động cơ băng tải',
      code: [
        `const MAX_RPM = ${M};`, `const RAMP = ${R};`, 'let rpm = 0;', 'function step(target) {',
        '  if (target > rpm) rpm = rpm + RAMP;', '  else rpm = rpm - RAMP;', '  if (rpm > MAX_RPM) rpm = MAX_RPM;',
        '  if (rpm < 0) rpm = MAX_RPM;', '  setMotor(rpm);', '}',
      ],
      bug: 7, decoy: 6,
      log: [`[t=4.1s] target=0 rpm=${R} -> step`, `[t=4.2s] target=0 rpm=-${R} -> kẹp -> rpm=${M}`, '[t=4.2s] !! QUÁ TỐC, ngắt khẩn cấp'],
      notes: ['Lệnh dừng (target=0) đang được xử lý', 'rpm âm bị kẹp lên giá trị tối đa thay vì 0', 'Hậu quả: động cơ vọt lên tốc độ cực đại'],
      fixes: ['if (rpm < 0) rpm = 0;', 'if (rpm < 0) rpm = -rpm;', 'if (rpm > MAX_RPM) rpm = 0;', 'const RAMP = 0;'],
    };
  },
  (rng) => {
    const N = pick(rng, [4, 5, 8, 10]), L = pick(rng, [30, 45, 60]);
    return {
      title: 'Lọc trung bình cảm biến tải trọng',
      code: [
        `const N = ${N};`, `const LIMIT = ${L};`, 'let buf = new Array(N).fill(0);', 'function avg() {', '  let s = 0;',
        '  for (let i = 0; i <= N; i++)', '    s += buf[i];', '  return s / N;', '}', 'if (avg() > LIMIT) stop(); else run();',
      ],
      bug: 5, decoy: 7,
      log: [`buf = [${Array.from({ length: N }, () => 12).join(', ')}]`, `buf[${N}] = undefined`, 'avg() = NaN -> so sánh NaN > LIMIT luôn sai -> run()'],
      notes: ['Mảng có N phần tử, chỉ số 0..N-1', 'Vòng lặp đọc tới phần tử thứ N (không tồn tại)', 'NaN làm phép so sánh an toàn bị vô hiệu'],
      fixes: ['for (let i = 0; i < N; i++)', 'return s / (N + 1);', 'let buf = new Array(N).fill(1);', 'for (let i = 1; i <= N; i++)'],
    };
  },
  (rng) => {
    const D = pick(rng, [2, 3, 5, 8]);
    return {
      title: 'Hẹn giờ đóng van làm mát',
      code: [
        `const DELAY_S = ${D};`, 'function openValve() {', '  valve.open();', '  setTimeout(closeValve, DELAY_S);', '}',
        'function closeValve() {', '  valve.close();', "  log('closed');", '}', 'openValve();',
      ],
      bug: 3, decoy: 0,
      log: ['[0.000 s] valve open', `[0.00${D} s] closed`, `   (mong đợi: ${D}.000 s)`],
      notes: ['Van mở đúng', `Van đóng sau ${D} ms thay vì ${D} s`, 'setTimeout nhận mili giây'],
      fixes: ['setTimeout(closeValve, DELAY_S * 1000);', 'setTimeout(closeValve, DELAY_S / 1000);', 'setInterval(closeValve, DELAY_S);', `const DELAY_S = ${D * 60};`],
    };
  },
  (rng) => {
    const T = pick(rng, [60, 70, 80, 90]);
    return {
      title: 'Bảo vệ quá nhiệt tủ điều khiển',
      code: [
        `const T_MAX = ${T};`, 'function check(temp) {', '  if (temp < T_MAX) {', '    fan.on();', "    alarm('quá nhiệt');",
        '  } else {', '    fan.off();', '  }', '}', 'every(1000, () => check(readTemp()));',
      ],
      bug: 2, decoy: 9,
      log: ['temp=24 -> fan ON, ALARM quá nhiệt', `temp=${T + 15} -> fan OFF`, 'Người vận hành: "báo động khi máy nguội, tắt quạt khi máy nóng"'],
      notes: ['Nhiệt độ thấp mà lại báo quá nhiệt', 'Nhiệt độ vượt ngưỡng thì quạt lại tắt', 'Điều kiện so sánh bị đảo'],
      fixes: ['if (temp > T_MAX) {', 'if (temp <= T_MAX) {', 'const T_MAX = 0;', 'every(100, () => check(readTemp()));'],
    };
  },
];
function genCS(rng) {
  const t = pick(rng, CS_TEMPLATES)(rng);
  const order = shuffle(rng, [0, 1, 2, 3]);
  return {
    secret: { line: t.bug, fix: order.indexOf(0) },
    pub: { title: t.title, code: t.code, log: t.log, fixes: order.map((i) => t.fixes[i]) },
    spec: { suspect: shuffle(rng, [t.bug, t.decoy]), notes: t.notes },
  };
}
function checkCS(st, ans) {
  const ok = ans && ans.line === st.secret.line && ans.fix === st.secret.fix;
  return { ok, why: 'Sửa sai: thiết bị khởi động lại, chờ 30 giây.' };
}

// ------------------------------------------------------------------ Cơ khí
function genME(rng) {
  const Z = [12, 15, 16, 18, 20, 24, 25, 30, 32, 36, 40, 45, 48, 50, 60];
  const ratios = [1.5, 2, 2.5, 3, 4, 1.25, 0.5, 0.75];
  for (let tries = 0; tries < 200; tries++) {
    const i = pick(rng, ratios);
    const z1 = pick(rng, Z), z2 = z1 * i;
    if (!Z.includes(z2)) continue;
    const tray = [z1, z2];
    let guard = 0;
    while (tray.length < 7 && guard++ < 200) {
      const z = pick(rng, Z);
      if (tray.includes(z)) continue;
      const bad = tray.some((t) => t * i === z || z * i === t);
      if (!bad) tray.push(z);
    }
    if (tray.length < 7) continue;
    const sh = shuffle(rng, tray);
    return {
      secret: { a: sh.indexOf(z1), b: sh.indexOf(z2) },
      pub: { ratio: i, gears: sh.map((z) => ({ z })), countable: true },
      spec: { labels: true },
    };
  }
  throw new Error('gear gen');
}
function checkME(st, ans) {
  const ok = ans && ans.driver === st.secret.a && ans.driven === st.secret.b;
  return { ok, why: 'Sai tỉ số truyền: hộp số kẹt, kim loại rít lên!' };
}

// ------------------------------------------------------------------ Hoá
function genCH(rng) {
  const chem = pick(rng, [{ f: 'HCl', M: 36.46 }, { f: 'NaOH', M: 40.0 }, { f: 'H₂SO₄', M: 98.08 }, { f: 'HNO₃', M: 63.01 }]);
  const C1 = pick(rng, [2, 2.5, 4, 5]);
  for (let k = 0; k < 200; k++) {
    const V2 = pick(rng, [100, 200, 250, 500]);
    const V1 = pick(rng, [10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100]);
    const C2 = (C1 * V1) / V2;
    const mM = Math.round(C2 * 1000);
    if (V1 >= V2 || Math.abs(C2 * 1000 - mM) > 1e-6 || mM % 5 !== 0 || C2 < 0.05) continue;
    // nhãn kiểu nhà sản xuất: phần trăm khối lượng + khối lượng riêng
    const d = +(1 + 0.0055 * (C1 * chem.M / 10)).toFixed(3);  // xấp xỉ
    const w = +((C1 * chem.M) / (10 * d)).toFixed(2);
    return {
      secret: { V1 },
      pub: { formula: chem.f, V2, C2, label: { w, d, M: chem.M } },
      spec: { C1 },
    };
  }
  throw new Error('chem gen');
}
function checkCH(st, ans) {
  const v = Number(ans && ans.v1);
  const ok = Number.isFinite(v) && Math.abs(v - st.secret.V1) <= Math.max(1, st.secret.V1 * 0.02);
  return { ok, why: 'Pha sai nồng độ: dung dịch bốc khói! Rời phòng 30 giây.' };
}

// ------------------------------------------------------------------ Xây dựng
const SECTIONS = [{ b: 20, h: 30, cost: 2 }, { b: 20, h: 40, cost: 3 }, { b: 25, h: 50, cost: 4 }, { b: 30, h: 60, cost: 6 }];
const Wmod = (s, up) => (up ? (s.b * s.h * s.h) / 6 : (s.h * s.b * s.b) / 6);
function genCE(rng) {
  const k = 1 + Math.floor(rng() * 3);  // tiết diện cần dùng: 1..3
  const s = SECTIONS[k];
  let lo = Wmod(s, false);
  for (let j = 0; j < SECTIONS.length; j++) for (const up of [true, false]) if (SECTIONS[j].cost < s.cost) lo = Math.max(lo, Wmod(SECTIONS[j], up));
  const Wreq = Math.round(lo + (Wmod(s, true) - lo) * (0.25 + rng() * 0.6));
  const braces = 1 + Math.floor(rng() * 3);
  return {
    secret: { Wreq, braces, budget: s.cost + braces },
    pub: { sections: SECTIONS.map((x) => ({ b: x.b, h: x.h, cost: x.cost })), braceCost: 1, maxBraces: 4, P: Math.round(Wreq / 100), L: 4, budget: s.cost + braces },
    spec: { Wreq, braces, stress: true },
  };
}
function evalCE(st, ans) {
  const s = SECTIONS[ans?.section];
  if (!s) return null;
  const up = !!ans.up, nb = Math.max(0, Math.min(4, ans.braces | 0));
  return { beam: st.secret.Wreq / Wmod(s, up), frame: nb >= st.secret.braces ? 0.6 : 1.4 - nb * 0.2, cost: s.cost + nb };
}
function checkCE(st, ans) {
  const e = evalCE(st, ans);
  if (!e) return { ok: false, why: 'Chưa chọn tiết diện.' };
  if (e.cost > st.secret.budget) return { ok: false, why: 'Vượt ngân sách vật liệu: không được duyệt chạy thử.', soft: true };
  if (e.beam > 1) return { ok: false, why: 'Dầm gãy giữa nhịp: mô hình sập!' };
  if (e.frame > 1) return { ok: false, why: 'Khung bị xô ngang: mô hình sập!' };
  return { ok: true };
}

const GEN = { ee: genEE, cs: genCS, me: genME, ch: genCH, ce: genCE };
const CHECK = { ee: checkEE, cs: checkCS, me: checkME, ch: checkCH, ce: checkCE };

export function generateTasks(rng) {
  const out = {};
  for (const id of TASK_IDS) out[id] = { id, done: false, lockUntil: 0, ...GEN[id](rng) };
  return out;
}
export function taskView(st, specialist) {
  return { id: st.id, pub: st.pub, spec: specialist ? st.spec : null };
}
export function checkTask(st, ans) { return CHECK[st.id](st, ans); }
export function taskQuery(st, q, specialist) {
  if (st.id === 'ee' && q.kind === 'measure') {
    const r = measureEE(st, q.a, q.b);
    if (!r) return null;
    return specialist ? r : { v: r.v };
  }
  if (st.id === 'ce' && q.kind === 'stress' && specialist) return evalCE(st, q);
  return null;
}
