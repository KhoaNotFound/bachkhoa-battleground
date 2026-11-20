import { escapeHtml } from '../../js/util.js';
import { TASK_NAMES } from './tasks-logic.js';

// Mini-game 2D hiện đè lên màn hình (newmod.md 9.1). Client chỉ hiển thị và gửi lựa chọn; host chấm.

const ICON = { main: '⚡', lamp: '💡', fan: '🌀', ac: '❄️' };
const fmt = (v, d = 2) => Number(v).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });

export class TaskUI {
  constructor({ send, onClose, sfx }) {
    this.send = send; this.onCloseCb = onClose; this.sfx = sfx || (() => {});
    this.el = document.getElementById('task');
    this.view = null;
  }
  get isOpen() { return !!this.view; }
  open(view) {
    this.view = view; this.state = {};
    this.el.classList.remove('hidden');
    this.render();
  }
  close(notify = true) {
    if (!this.view) return;
    const id = this.view.id;
    this.view = null;
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    if (notify) this.send({ a: 'task_close', task: id });
    this.onCloseCb();
  }
  shell(body, extra = '') {
    const v = this.view;
    this.el.innerHTML = `<div class="task-card">
      <div class="task-head"><b>Task ${TASK_NAMES[v.id]}</b>${v.spec ? '<span class="spec-badge">Đúng chuyên ngành: có thêm thông tin</span>' : ''}<button class="task-x" title="Đóng (Esc)">✕</button></div>
      <div class="task-body">${body}</div>
      <div class="task-msg"></div>
      <div class="task-foot">${extra}</div></div>`;
    this.el.querySelector('.task-x').onclick = () => this.close();
  }
  msg(text, bad = false) { const m = this.el.querySelector('.task-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', bad); } }
  submit(ans) { this.send({ a: 'task_submit', task: this.view.id, ans }); this.msg('Đang kiểm tra…'); }
  query(q) { this.send({ a: 'task_q', task: this.view.id, q }); }
  onQuery(m) { if (this.view && m.task === this.view.id && this['q_' + m.task]) this['q_' + m.task](m.q, m.r); }
  onResult(m) {
    if (!this.view || m.task !== this.view.id) return;
    if (m.ok) { this.sfx('ok'); this.msg('Hoàn thành!'); setTimeout(() => this.close(false), 700); return; }
    this.msg(m.why, true);
    if (m.soft) return;
    const id = this.view.id;
    if (id === 'cs' || id === 'ch') { setTimeout(() => this.close(false), 1600); return; }
    // làm lại: Điện xoá thứ tự cầu dao, Cơ khí bỏ chọn, Xây dựng làm lại từ đầu
    if (id === 'ee') this.state.order = [];
    if (id === 'me') { this.state.a = null; this.state.b = null; }
    if (id === 'ce') this.state = {};
    setTimeout(() => { if (this.view) { const t = this.el.querySelector('.task-msg')?.textContent; this.render(); this.msg(t, true); } }, 300);
  }
  render() { this['r_' + this.view.id](); }

  // ---------------------------------------------------------------- Điện
  r_ee() {
    const { pub, spec } = this.view, s = this.state;
    s.wires ??= []; s.order ??= []; s.mode ??= 'measure'; s.sel ??= null; s.reads ??= [];
    const term = pub.terminals.map((t, i) => `<button class="term ${s.sel === t ? 'on' : ''}" data-t="${t}" style="grid-row:${(i % 3) + 1};grid-column:${i < 3 ? 1 : 3}">${t}</button>`).join('');
    const wires = s.wires.map((w, k) => `<span class="chip" data-w="${k}">${w[0]}–${w[1]} ✕</span>`).join('') || '<i>chưa nối</i>';
    const reads = s.reads.slice(-6).map((r) => `<div>${r.a}–${r.b}: <b>${fmt(r.v, r.v < 1 ? 1 : 0)} V</b>${r.ok == null ? '' : r.ok ? ' <span class="good">✓ đúng ngưỡng</span>' : ' <span class="bad">✗</span>'}</div>`).join('') || '<i>chưa đo</i>';
    const legend = spec ? `<div class="spec">${spec.legend.map((l) => `<div><b>${l.code}</b>: ${escapeHtml(l.text)}</div>`).join('')}<div class="rule">${escapeHtml(spec.rule)}</div></div>` : '';
    const brk = pub.breakers.map((b) => `<button class="brk ${s.order.includes(b.code) ? 'on' : ''}" data-b="${b.code}"><span>${ICON[b.icon]}</span>${b.code}</button>`).join('');
    this.shell(`
      <p>Khôi phục điện phòng bảo vệ: dùng đồng hồ vạn năng tìm 3 cặp đầu dây đúng, nối lại, rồi đóng 4 cầu dao theo đúng thứ tự.</p>
      <div class="ee-grid">
        <div>
          <div class="seg"><button data-m="measure" class="${s.mode === 'measure' ? 'on' : ''}">🔎 Đo điện áp</button><button data-m="wire" class="${s.mode === 'wire' ? 'on' : ''}">🔌 Nối dây</button></div>
          <div class="terms">${term}<div class="terms-mid">${s.mode === 'measure' ? 'Chọn 2 đầu để đo' : 'Chọn 2 đầu để nối'}</div></div>
          <div class="row">Dây đã nối (${s.wires.length}/3): ${wires}</div>
        </div>
        <div>
          <div class="meter"><div class="meter-title">ĐỒNG HỒ VẠN NĂNG</div>${reads}</div>
          ${legend}
        </div>
      </div>
      <div class="row">Cầu dao (bấm theo thứ tự muốn đóng): ${brk}</div>
      <div class="row">Thứ tự: <b>${s.order.join(' → ') || '–'}</b> <button class="small" data-reset>Mở hết cầu dao</button></div>`,
      `<button class="primary" data-go ${s.wires.length === 3 && s.order.length === 4 ? '' : 'disabled'}>Đóng điện</button>`);
    const E = this.el;
    E.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { s.mode = b.dataset.m; s.sel = null; this.render(); }));
    E.querySelectorAll('.term').forEach((b) => (b.onclick = () => {
      const t = b.dataset.t;
      this.sfx('click');
      if (!s.sel) { s.sel = t; this.render(); return; }
      if (s.sel === t) { s.sel = null; this.render(); return; }
      const a = s.sel; s.sel = null;
      if (s.mode === 'measure') this.query({ kind: 'measure', a, b: t });
      else {
        const used = new Set(s.wires.flat());
        if (used.has(a) || used.has(t)) this.msg('Mỗi đầu dây chỉ nối một sợi.', true);
        else if (s.wires.length < 3) s.wires.push([a, t]);
      }
      this.render();
    }));
    E.querySelectorAll('[data-w]').forEach((c) => (c.onclick = () => { s.wires.splice(+c.dataset.w, 1); this.render(); }));
    E.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { if (!s.order.includes(b.dataset.b)) { s.order.push(b.dataset.b); this.sfx('click'); this.render(); } }));
    E.querySelector('[data-reset]').onclick = () => { s.order = []; this.render(); };
    E.querySelector('[data-go]').onclick = () => this.submit({ wires: s.wires, order: s.order });
  }
  q_ee(q, r) { if (r) { this.state.reads.push({ a: q.a, b: q.b, ...r }); this.render(); } }

  // ---------------------------------------------------------------- Máy tính
  r_cs() {
    const { pub, spec } = this.view, s = this.state;
    const sus = new Set(spec ? spec.suspect : []);
    const code = pub.code.map((ln, i) => `<div class="ln ${s.line === i ? 'on' : ''} ${sus.has(i) ? 'sus' : ''}" data-l="${i}"><span>${i + 1}</span><code>${escapeHtml(ln)}</code>${sus.has(i) ? '<em>⚠ nghi ngờ</em>' : ''}</div>`).join('');
    const log = pub.log.map((l, i) => `<div>${escapeHtml(l)}${spec ? `<em class="note"> ← ${escapeHtml(spec.notes[i] || '')}</em>` : ''}</div>`).join('');
    const fixes = pub.fixes.map((f, i) => `<label class="opt ${s.fix === i ? 'on' : ''}"><input type="radio" name="fix" value="${i}" ${s.fix === i ? 'checked' : ''}> <code>${escapeHtml(f)}</code></label>`).join('');
    this.shell(`
      <p><b>${escapeHtml(pub.title)}</b>: đọc log lỗi, chọn dòng sai và cách sửa.</p>
      <div class="code">${code}</div>
      <div class="log">${log}</div>
      <div class="fixes">Sửa dòng ${s.line != null ? s.line + 1 : '?'} thành:${fixes}</div>`,
      `<button class="primary" data-go ${s.line != null && s.fix != null ? '' : 'disabled'}>Nạp lại chương trình</button>`);
    this.el.querySelectorAll('[data-l]').forEach((d) => (d.onclick = () => { s.line = +d.dataset.l; this.render(); }));
    this.el.querySelectorAll('input[name=fix]').forEach((r) => (r.onchange = () => { s.fix = +r.value; this.render(); }));
    this.el.querySelector('[data-go]').onclick = () => this.submit({ line: s.line, fix: s.fix });
  }

  // ---------------------------------------------------------------- Cơ khí
  r_me() {
    const { pub, spec } = this.view, s = this.state;
    this.shell(`
      <p>Lắp hộp số: chọn bánh dẫn (z₁) rồi bánh bị dẫn (z₂) sao cho tỉ số truyền <b>i = z₂ / z₁ = ${fmt(pub.ratio, 2)}</b>.</p>
      <canvas class="gears" width="760" height="300"></canvas>
      <div class="row">Bánh dẫn: <b>${s.a != null ? '#' + (s.a + 1) : '–'}</b> · Bánh bị dẫn: <b>${s.b != null ? '#' + (s.b + 1) : '–'}</b> <button class="small" data-reset>Chọn lại</button></div>
      ${spec ? '' : '<div class="hint">Mẹo: đếm số răng trên hình.</div>'}`,
      `<button class="primary" data-go ${s.a != null && s.b != null ? '' : 'disabled'}>Lắp và quay thử</button>`);
    const cv = this.el.querySelector('canvas'), g = cv.getContext('2d');
    const n = pub.gears.length, maxZ = Math.max(...pub.gears.map((x) => x.z));
    const pos = pub.gears.map((x, i) => ({ x: 60 + (i * 640) / (n - 1), y: i % 2 ? 190 : 110, r: 18 + (x.z / maxZ) * 46, z: x.z }));
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      pos.forEach((p, i) => {
        const sel = s.a === i ? '#4fc3f7' : s.b === i ? '#ffb74d' : '#b0bec5';
        g.save(); g.translate(p.x, p.y);
        g.beginPath();
        for (let k = 0; k < p.z * 2; k++) {
          const a0 = (k / (p.z * 2)) * Math.PI * 2, rr = k % 2 ? p.r : p.r + 6;
          g.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
          g.lineTo(Math.cos(a0 + Math.PI / p.z) * rr, Math.sin(a0 + Math.PI / p.z) * rr);
        }
        g.closePath(); g.fillStyle = sel; g.fill(); g.strokeStyle = '#263238'; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fillStyle = '#263238'; g.fill();
        g.fillStyle = '#eceff1'; g.font = '600 13px sans-serif'; g.textAlign = 'center';
        g.fillText('#' + (i + 1), 0, p.r + 24);
        if (spec) { g.fillStyle = '#263238'; g.font = '700 14px sans-serif'; g.fillText('z=' + p.z, 0, 5 - p.r * 0.4); }
        g.restore();
      });
    };
    draw();
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) * cv.width) / r.width, y = ((e.clientY - r.top) * cv.height) / r.height;
      const i = pos.findIndex((p) => Math.hypot(p.x - x, p.y - y) < p.r + 8);
      if (i < 0) return;
      this.sfx('click');
      if (s.a == null) s.a = i; else if (s.b == null && i !== s.a) s.b = i; else { s.a = i; s.b = null; }
      this.render();
    };
    this.el.querySelector('[data-reset]').onclick = () => { s.a = s.b = null; this.render(); };
    this.el.querySelector('[data-go]').onclick = () => this.submit({ driver: s.a, driven: s.b });
  }

  // ---------------------------------------------------------------- Hoá
  r_ch() {
    const { pub, spec } = this.view, s = this.state;
    s.v ??= 0;
    const label = spec
      ? `<div class="label-big">${pub.formula}</div><div>Nồng độ: <b>${fmt(spec.C1, 2)} M</b></div><div class="rule">C₁V₁ = C₂V₂</div>`
      : `<div class="label-big">${pub.formula}</div><div>Hàm lượng: ${fmt(pub.label.w, 2)} % (khối lượng)</div><div>Khối lượng riêng: ${fmt(pub.label.d, 3)} g/mL</div><div>M = ${fmt(pub.label.M, 2)} g/mol</div>`;
    this.shell(`
      <p>Cần pha <b>${pub.V2} mL</b> dung dịch ${pub.formula} nồng độ <b>${fmt(pub.C2, 3)} M</b> từ chai dung dịch gốc.</p>
      <div class="ch-grid">
        <div class="bottle">${label}</div>
        <div>
          <div>Hút dung dịch gốc bằng pipet: <b class="big">${s.v} mL</b></div>
          <div class="row">${[-10, -5, -1, 1, 5, 10].map((d) => `<button class="small" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}</div>
          <div class="cyl"><i style="height:${Math.min(100, (s.v / pub.V2) * 100)}%"></i><span>${pub.V2} mL</span></div>
        </div>
      </div>`,
      `<button class="primary" data-go ${s.v > 0 ? '' : 'disabled'}>Cho vào bình định mức, thêm nước tới vạch ${pub.V2} mL</button>`);
    this.el.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { s.v = Math.max(0, Math.min(pub.V2, s.v + +b.dataset.d)); this.render(); }));
    this.el.querySelector('[data-go]').onclick = () => this.submit({ v1: s.v });
  }

  // ---------------------------------------------------------------- Xây dựng
  r_ce() {
    const { pub, spec } = this.view, s = this.state;
    s.braces ??= 0; s.up ??= true;
    const cost = (s.section != null ? pub.sections[s.section].cost : 0) + s.braces * pub.braceCost;
    const secs = pub.sections.map((x, i) => `<button class="sec ${s.section === i ? 'on' : ''}" data-s="${i}">${x.b}×${x.h} cm<small>${x.cost} đơn vị</small></button>`).join('');
    this.shell(`
      <p>Khung thử tải: nhịp dầm L = ${pub.L} m, tải tập trung giữa nhịp <b>P = ${pub.P} kN</b>, có tải ngang. Ngân sách vật liệu: <b>${pub.budget}</b> đơn vị.</p>
      <div class="ce-grid">
        <div>
          <div class="row">Tiết diện dầm (b×h): ${secs}</div>
          <div class="row">Hướng đặt dầm: <button class="small ${s.up ? 'on' : ''}" data-up="1">Đặt đứng (h thẳng đứng)</button><button class="small ${!s.up ? 'on' : ''}" data-up="0">Đặt nằm</button></div>
          <div class="row">Thanh giằng chéo: <button class="small" data-br="-1">−</button> <b>${s.braces}</b> <button class="small" data-br="1">+</button> (${pub.braceCost} đơn vị/thanh)</div>
          <div class="row">Chi phí: <b class="${cost > pub.budget ? 'bad' : ''}">${cost}</b> / ${pub.budget}</div>
        </div>
        <canvas class="frame" width="360" height="240"></canvas>
      </div>
      ${spec ? '<div class="hint">Màu trên mô hình: xanh = an toàn, đỏ = quá tải (ứng suất cao).</div>' : ''}`,
      `<button class="primary" data-go ${s.section != null ? '' : 'disabled'}>Chạy thử tải</button>`);
    const E = this.el;
    E.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { s.section = +b.dataset.s; this.ceChanged(); }));
    E.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { s.up = b.dataset.up === '1'; this.ceChanged(); }));
    E.querySelectorAll('[data-br]').forEach((b) => (b.onclick = () => { s.braces = Math.max(0, Math.min(pub.maxBraces, s.braces + +b.dataset.br)); this.ceChanged(); }));
    E.querySelector('[data-go]').onclick = () => this.submit({ section: s.section, up: s.up, braces: s.braces });
    this.drawFrame();
  }
  ceChanged() {
    const s = this.state;
    if (this.view.spec && s.section != null) this.query({ kind: 'stress', section: s.section, up: s.up, braces: s.braces });
    this.render();
  }
  q_ce(q, r) { this.state.stress = r; this.drawFrame(); }
  drawFrame() {
    const cv = this.el.querySelector('canvas.frame');
    if (!cv) return;
    const g = cv.getContext('2d'), s = this.state, st = this.view.spec ? s.stress : null;
    const col = (u) => (u == null ? '#b0bec5' : u <= 0.7 ? '#43a047' : u <= 1 ? '#fdd835' : '#e53935');
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineCap = 'round';
    const L = 40, R = 320, T = 60, B = 210;
    g.strokeStyle = col(st?.frame); g.lineWidth = 8;
    g.beginPath(); g.moveTo(L, B); g.lineTo(L, T); g.moveTo(R, B); g.lineTo(R, T); g.stroke();
    g.strokeStyle = col(st?.beam); g.lineWidth = s.section != null ? 6 + s.section * 3 * (s.up ? 1.3 : 0.7) : 6;
    g.beginPath(); g.moveTo(L, T); g.lineTo(R, T); g.stroke();
    g.strokeStyle = col(st?.frame); g.lineWidth = 3;
    for (let k = 0; k < s.braces; k++) { const x0 = L + ((R - L) * k) / Math.max(1, s.braces), x1 = L + ((R - L) * (k + 1)) / Math.max(1, s.braces); g.beginPath(); g.moveTo(x0, k % 2 ? T : B); g.lineTo(x1, k % 2 ? B : T); g.stroke(); }
    g.fillStyle = '#eceff1'; g.font = '700 14px sans-serif'; g.textAlign = 'center';
    g.fillText('P', 180, 22); g.strokeStyle = '#eceff1'; g.lineWidth = 2; g.beginPath(); g.moveTo(180, 28); g.lineTo(180, T - 6); g.lineTo(174, T - 14); g.moveTo(180, T - 6); g.lineTo(186, T - 14); g.stroke();
    g.fillRect(L - 20, B, R - L + 40, 6);
  }
}
