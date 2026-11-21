import { WEAPONS, WEAPON_SVGS, SHOP_LAYOUT, getWeapon } from './weapons.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class BuyMenu {
  constructor({ onSelect, onClose, getLoadout }) {
    this.el = $('buyMenu');
    this.grid = $('buyGrid');
    this.stats = $('buyStats');
    this.closeBtn = $('buyCloseBtn');
    this.onSelect = onSelect;
    this.onClose = onClose;
    this.getLoadout = getLoadout;
    this.open = false;
    this.previewId = 'operator';
    this.cards = new Map();

    this._buildGrid();
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.setOpen(false));
    if (this.el) {
      const bd = this.el.querySelector('.bm-backdrop');
      if (bd) bd.addEventListener('click', () => this.setOpen(false));
    }
    this.renderStats(this.previewId);
  }

  _buildGrid() {
    if (!this.grid) return;
    this.grid.innerHTML = '';
    for (const colDef of SHOP_LAYOUT) {
      const col = document.createElement('div');
      col.className = 'bm-col';
      for (const sec of colDef.sections) {
        const secEl = document.createElement('div');
        secEl.className = 'bm-sec';
        const head = document.createElement('div');
        head.className = 'bm-sec-head';
        head.textContent = sec.title;
        secEl.appendChild(head);

        for (const id of sec.items) {
          const w = WEAPONS[id];
          if (!w) continue;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'bm-card' + (sec.tall ? ' tall' : '');
          btn.dataset.weapon = id;
          const subText = id === 'knife'
            ? 'Ẩn Nắm đấm · Xoay F'
            : id === 'fist'
              ? 'Ẩn Dao Butterfly'
              : '';
          btn.innerHTML = `
            <div class="bm-card-svg">${WEAPON_SVGS[id] || ''}</div>
            <div class="bm-card-meta">
              <span class="bm-card-price">${w.price ? `¤ ${w.price.toLocaleString('en-US')}` : 'MIỄN PHÍ'}</span>
              <span class="bm-card-name">${w.name}</span>
              ${subText ? `<span class="bm-card-sub">${subText}</span>` : ''}
            </div>`;
          btn.addEventListener('mouseenter', () => {
            this.previewId = id;
            this.renderStats(id);
            this._syncCardClasses();
          });
          btn.addEventListener('click', () => {
            this.previewId = id;
            if (this.onSelect) this.onSelect(w);
            this.refresh();
          });
          secEl.appendChild(btn);
          this.cards.set(id, btn);
        }
        col.appendChild(secEl);
      }
      this.grid.appendChild(col);
    }
  }

  _isEquipped(id) {
    const L = this.getLoadout ? this.getLoadout() : null;
    if (!L) return false;
    return L.primary === id || L.secondary === id || L.melee === id;
  }

  _syncCardClasses() {
    for (const [id, btn] of this.cards.entries()) {
      const eq = this._isEquipped(id);
      btn.classList.toggle('equipped', eq);
      btn.classList.toggle('selected', id === this.previewId);
      const priceEl = btn.querySelector('.bm-card-price');
      if (priceEl) {
        const w = WEAPONS[id];
        if (eq) priceEl.textContent = 'ĐANG DÙNG · OWNED';
        else priceEl.textContent = w.price ? `¤ ${w.price.toLocaleString('en-US')}` : 'MIỄN PHÍ';
      }
    }
  }

  renderStats(id) {
    if (!this.stats) return;
    const w = getWeapon(id);
    const eq = this._isEquipped(w.id);

    const pct = (val, max) => `${Math.round(clamp(val / max, 0.04, 1) * 100)}%`;
    const firePct = pct(w.fireRate, 16);
    const runPct = pct(w.runSpeed, 6.5);
    const equipPct = pct(Math.max(0.2, 2.0 - w.equipSec), 1.8);
    const spreadPct = pct(Math.max(0.15, 5.5 - w.spreadHip), 5.5);
    const reloadPct = w.reloadSec > 0 ? pct(Math.max(0.4, 5.5 - w.reloadSec), 5.0) : '100%';
    const magNum = typeof w.mag === 'number' ? w.mag : 100;
    const magPct = pct(Math.min(magNum, 100), 100);

    const spreadTxt = w.slot === 'melee'
      ? '0 / 0'
      : `${w.spreadHip} / ${w.spreadAds}`;
    const reloadTxt = w.reloadSec > 0 ? w.reloadSec.toFixed(2).replace(/\.00$/, '') : '—';
    const rangeTxt = w.slot === 'melee' ? `0–${w.range}m` : w.pellets > 1 ? `0–${w.range}m (×${w.pellets} bi)` : `0–${Math.min(w.range, 50)}m+`;

    this.stats.innerHTML = `
      <div class="bm-st-head">
        <span class="bm-st-name">${w.name}</span>
        <span class="bm-st-cat">${w.catVi}</span>
      </div>
      <div class="bm-st-sub">
        <span>PRIMARY FIRE</span>
        <div class="bm-st-tags">
          <span>${w.mode}</span>
          <span>Xuyên: ${w.penVi}</span>
        </div>
      </div>
      <div class="bm-st-grid">
        <div class="bm-st-box">
          <span class="bm-st-lbl">FIRE RATE</span>
          <span class="bm-st-val">${w.fireRate}</span>
          <span class="bm-st-unit">RDS / SEC</span>
          <div class="bm-st-bar"><i style="width:${firePct}"></i></div>
        </div>
        <div class="bm-st-box">
          <span class="bm-st-lbl">RUN SPEED</span>
          <span class="bm-st-val">${w.runSpeed}</span>
          <span class="bm-st-unit">M / SEC</span>
          <div class="bm-st-bar"><i style="width:${runPct}"></i></div>
        </div>
        <div class="bm-st-box">
          <span class="bm-st-lbl">EQUIP SPEED</span>
          <span class="bm-st-val">${w.equipSec}</span>
          <span class="bm-st-unit">SEC</span>
          <div class="bm-st-bar"><i style="width:${equipPct}"></i></div>
        </div>
        <div class="bm-st-box">
          <span class="bm-st-lbl">1ST SHOT SPREAD</span>
          <span class="bm-st-val">${spreadTxt}</span>
          <span class="bm-st-unit">DEG (HIP/ADS)</span>
          <div class="bm-st-bar"><i style="width:${spreadPct}"></i></div>
        </div>
        <div class="bm-st-box">
          <span class="bm-st-lbl">RELOAD SPEED</span>
          <span class="bm-st-val">${reloadTxt}</span>
          <span class="bm-st-unit">SEC</span>
          <div class="bm-st-bar"><i style="width:${reloadPct}"></i></div>
        </div>
        <div class="bm-st-box">
          <span class="bm-st-lbl">MAGAZINE</span>
          <span class="bm-st-val">${w.mag}</span>
          <span class="bm-st-unit">RDS</span>
          <div class="bm-st-bar"><i style="width:${magPct}"></i></div>
        </div>
      </div>
      <div class="bm-dmg-wrap">
        <div class="bm-dmg-head"><span>DAMAGE · SÁT THƯƠNG</span><span>${rangeTxt}</span></div>
        <div class="bm-dmg-table">
          <div class="bm-dmg-row"><span>HEAD</span><b>${w.dmg.head}</b></div>
          <div class="bm-dmg-row"><span>BODY</span><b>${w.dmg.body}</b></div>
          <div class="bm-dmg-row"><span>LEGS</span><b>${w.dmg.legs}</b></div>
        </div>
      </div>
      <div class="bm-alt">
        <div class="bm-alt-title">${w.altTitle || 'ĐẶC ĐIỂM'}</div>
        <ul>${(w.altBullets || []).map((b) => `<li>${b}</li>`).join('')}</ul>
      </div>
      <button type="button" id="bmEquipBtn" class="bm-equip-btn ${eq ? 'active' : ''}">
        ${eq ? '✓ ĐANG TRANG BỊ' : w.slot === 'melee' ? `CHỌN ${w.name}` : `MUA & TRANG BỊ ${w.name}`}
      </button>
    `;

    const eqBtn = this.stats.querySelector('#bmEquipBtn');
    if (eqBtn) {
      eqBtn.addEventListener('click', () => {
        if (this.onSelect) this.onSelect(w);
        this.refresh();
      });
    }
  }

  refresh() {
    this._syncCardClasses();
    this.renderStats(this.previewId);
  }

  setOpen(on) {
    const want = !!on;
    if (this.open === want) return;
    this.open = want;
    if (this.el) this.el.classList.toggle('hidden', !want);
    if (want) {
      const L = this.getLoadout ? this.getLoadout() : null;
      if (L) this.previewId = L.activeWeaponId || L.primary || 'operator';
      this.refresh();
    } else if (this.onClose) {
      this.onClose();
    }
  }

  toggle() {
    this.setOpen(!this.open);
  }
}
