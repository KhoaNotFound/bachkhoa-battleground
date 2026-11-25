import * as THREE from 'three';
import { loadGLB, warmUpModel, disposeObject3D } from './glb-loader.js';
import { WEAPONS, WEAPON_SVGS, getWeapon } from './weapons.js';
import {
  TIER_META,
  getWeaponSkins,
  isSkinOwned,
  getEquippedSkin,
  equipSkin,
  getWeaponSkinCounts,
  getTotalSkinCounts,
  onSkinsChange,
} from './skins.js';
import { buildProceduralWeaponMesh } from './viewmodel.js';
import { clamp, damp } from './util.js';

const $ = (id) => document.getElementById(id);

// 4-column layout matching Valorant Collection screen (Image 1)
const COLLECTION_COLUMNS = [
  {
    sections: [
      { title: 'SIDEARMS', items: ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff'] },
    ],
  },
  {
    sections: [
      { title: 'SMGS', items: ['stinger', 'spectre'] },
      { title: 'SHOTGUNS', items: ['bucky', 'judge'] },
    ],
  },
  {
    sections: [
      { title: 'RIFLES', items: ['bulldog', 'guardian', 'phantom', 'vandal'] },
      { title: 'MELEE', items: ['knife'] },
    ],
  },
  {
    sections: [
      { title: 'SNIPER RIFLES', items: ['marshal', 'outlaw', 'operator'] },
      { title: 'MACHINE GUNS', items: ['ares', 'odin'] },
    ],
  },
];

const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 10h-1V7a4 4 0 0 0-8 0v3H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7-3a2 2 0 1 1 4 0v3h-4V7zm3 9.72V18a1 1 0 1 1-2 0v-1.28a1.75 1.75 0 1 1 2 0z"/></svg>`;

function buildPreviewEnv(renderer) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x162a3a);
    const addPanel = (color, pos, rot, size) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], rot[1], rot[2]);
      envScene.add(m);
    };
    addPanel(0xfff5e4, [0, 5, 1], [Math.PI / 2, 0, 0], [10, 10]);
    addPanel(0x7be0ff, [-5, 1.5, 2], [0, Math.PI / 2, 0], [8, 6]);
    addPanel(0xffd28a, [5, 2, -2], [0, -Math.PI / 2, 0], [8, 6]);
    addPanel(0xffffff, [0, 2, 6], [0, Math.PI, 0], [8, 4]);
    addPanel(0x102030, [0, -4, 0], [-Math.PI / 2, 0, 0], [12, 12]);
    const rt = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    return rt.texture;
  } catch {
    return null;
  }
}

class CollectionPreview3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.01, 50);
    this.camera.position.set(0, 0.04, 1.35);

    this.scene.add(new THREE.HemisphereLight(0xd9f2ff, 0x203242, 1.35));
    const key = new THREE.DirectionalLight(0xfff4e2, 2.2);
    key.position.set(2.2, 2.6, 2.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6de8ff, 1.4);
    rim.position.set(-2.5, 1.2, -2.0);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xb5d6f5, 0.85);
    fill.position.set(-1.5, -1.0, 2.2);
    this.scene.add(fill);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.glbCache = new Map();
    this.maxCache = 3;
    this.currentModel = null;
    this.loadSeq = 0;
    this.stageEl = canvas ? canvas.closest('.col-stage') : null;

    this.yaw = -Math.PI / 2 + 0.18;
    this.pitch = 0.06;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.zoom = 1.32;
    this.targetZoom = 1.32;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.autoOrbit = true;
    this.active = false;
    this.rafId = 0;
    this.lastTime = 0;

    this._bindEvents();
  }

  _ensureRenderer() {
    if (this.renderer || !this.canvas) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    const env = buildPreviewEnv(this.renderer);
    if (env) this.scene.environment = env;
    this.resize();
  }

  _bindEvents() {
    if (!this.canvas) return;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.autoOrbit = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.targetYaw += dx * 0.0095;
      this.targetPitch = clamp(this.targetPitch + dy * 0.007, -1.05, 1.05);
    });
    const endDrag = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetZoom = clamp(this.targetZoom + e.deltaY * 0.0012, 0.75, 2.3);
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.active) this.resize(); });
  }

  resize() {
    if (!this.renderer || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _normalizeAndMount(obj) {
    this.pivot.clear();
    const holder = new THREE.Group();
    holder.add(obj);
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(holder);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = 1.08 / maxDim;
    obj.position.sub(center);
    holder.scale.setScalar(scale);

    this.pivot.add(holder);
    this.currentModel = holder;
  }

  _extractCleanStaticModel(sceneRoot) {
    // Convert SkinnedMesh -> static THREE.Mesh so clone(true), Box3, and pivot 360° rotation work cleanly
    sceneRoot.updateMatrixWorld(true);
    const clean = new THREE.Group();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();

    sceneRoot.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.name || '').toLowerCase();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const isArmMat = mats.some((m) => m && (m.name === 'SleeveMat' || m.name === 'SkinMat'));
      if (n.includes('sleeve') || n.includes('handmesh') || n.includes('icosphere') || isArmMat) {
        return;
      }

      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) {
          m.envMapIntensity = Math.max(m.envMapIntensity || 1.0, 1.3);
          m.needsUpdate = true;
        }
      }

      const staticMesh = new THREE.Mesh(o.geometry, o.material);
      staticMesh.frustumCulled = false;
      o.matrixWorld.decompose(pos, quat, scl);
      staticMesh.position.copy(pos);
      staticMesh.quaternion.copy(quat);
      staticMesh.scale.copy(scl);
      clean.add(staticMesh);
    });

    return clean;
  }

  _evictCache(keepUrl) {
    if (this.glbCache.size <= this.maxCache) return;
    for (const [k, obj] of this.glbCache.entries()) {
      if (this.glbCache.size <= this.maxCache) break;
      if (k === keepUrl) continue;
      disposeObject3D(obj);
      this.glbCache.delete(k);
    }
  }

  _setLoading(on) {
    if (this.stageEl) this.stageEl.classList.toggle('is-loading', !!on);
  }

  show(weaponDef, skinDef) {
    this._ensureRenderer();
    this.resize();
    // Side profile (barrel pointing left, matching Valorant showcase)
    this.targetYaw = Math.PI / 2 - 0.14;
    this.targetPitch = 0.05;
    this.targetZoom = 1.18;
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.zoom = this.targetZoom;
    this.autoOrbit = true;

    const seq = ++this.loadSeq;
    const glbUrl = skinDef?.glb || null;

    if (glbUrl) {
      const cached = this.glbCache.get(glbUrl);
      if (cached) {
        // Refresh LRU order
        this.glbCache.delete(glbUrl);
        this.glbCache.set(glbUrl, cached);
        this._setLoading(false);
        this._normalizeAndMount(cached.clone(true));
        return;
      }
      this.pivot.clear();
      this._setLoading(true);
      loadGLB(glbUrl)
        .then(async (gltf) => {
          const clean = this._extractCleanStaticModel(gltf.scene);
          await warmUpModel(this.renderer, this.scene, this.camera, clean);
          this.glbCache.set(glbUrl, clean);
          this._evictCache(glbUrl);
          if (seq !== this.loadSeq) return;
          this._setLoading(false);
          this._normalizeAndMount(clean.clone(true));
        })
        .catch(() => {
          if (seq !== this.loadSeq) return;
          this._setLoading(false);
          this._normalizeAndMount(buildProceduralWeaponMesh(weaponDef));
        });
    } else if (weaponDef.id === 'fist' || skinDef?.meleeType === 'fist') {
      this._setLoading(false);
      // Stylish blocky gloves pair for Fist (default melee skin)
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.65 });
      const cuff = new THREE.MeshStandardMaterial({ color: 0x1e88e5, roughness: 0.7 });
      for (const s of [-1, 1]) {
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), mat);
        hand.position.set(s * 0.18, 0, 0);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.24), cuff);
        arm.position.set(s * 0.18, 0, 0.2);
        g.add(hand, arm);
      }
      this._normalizeAndMount(g);
    } else {
      this._setLoading(false);
      this._normalizeAndMount(buildProceduralWeaponMesh(weaponDef));
    }
  }

  setActive(on) {
    const want = !!on;
    if (this.active === want) return;
    this.active = want;
    if (want) {
      this._ensureRenderer();
      this.resize();
      this.lastTime = performance.now();
      const tick = (now) => {
        if (!this.active) return;
        this.rafId = requestAnimationFrame(tick);
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;
        if (this.autoOrbit && !this.dragging) {
          this.targetYaw += dt * 0.22;
        }
        this.yaw = damp(this.yaw, this.targetYaw, 10, dt);
        this.pitch = damp(this.pitch, this.targetPitch, 10, dt);
        this.zoom = damp(this.zoom, this.targetZoom, 10, dt);
        this.pivot.rotation.set(this.pitch, this.yaw, 0);
        this.camera.position.z = this.zoom;
        this.renderer.render(this.scene, this.camera);
      };
      this.rafId = requestAnimationFrame(tick);
    } else if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}

export class CollectionUI {
  constructor({ onEquipSkin, onSound } = {}) {
    this.screen = $('collectionScreen');
    this.arsenalView = $('colArsenalView');
    this.detailView = $('colDetailView');
    this.arsenalGrid = $('colArsenalGrid');
    this.breadcrumb = $('colBreadcrumb');
    this.totalBadge = $('colTotalBadge');
    this.backBtn = $('colBackBtn');
    this.closeBtn = $('colCloseBtn');

    // Detail view elements
    this.searchInput = $('colSearchInput');
    this.filterBtn = $('colFilterBtn');
    this.skinCounter = $('colSkinCounter');
    this.skinGrid = $('colSkinGrid');
    this.tierSymbol = $('colTierSymbol');
    this.skinTitle = $('colSkinTitle');
    this.skinSub = $('colSkinSub');
    this.skinDesc = $('colSkinDesc');
    this.equipBtn = $('colEquipBtn');
    this.previewCanvas = $('colPreviewCanvas');

    this.onEquipSkin = onEquipSkin;
    this.onSound = onSound;
    this.preview3D = new CollectionPreview3D(this.previewCanvas);

    this.open = false;
    this.mode = 'arsenal'; // 'arsenal' | 'detail'
    this.activeWeaponId = null;
    this.selectedSkinId = null;
    this.searchQuery = '';
    this.ownedOnly = false;

    this._bindEvents();
    onSkinsChange(() => {
      if (this.open) this.refresh();
    });
  }

  _playUi() {
    if (this.onSound) this.onSound();
  }

  _bindEvents() {
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        this._playUi();
        if (this.mode === 'detail') this.showArsenal();
        else this.setOpen(false);
      });
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this._playUi();
        this.setOpen(false);
      });
    }
    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.searchQuery = this.searchInput.value.trim().toLowerCase();
        this._renderSkinGrid();
      });
      this.searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (this.filterBtn) {
      this.filterBtn.addEventListener('click', () => {
        this._playUi();
        this.ownedOnly = !this.ownedOnly;
        this.filterBtn.classList.toggle('active', this.ownedOnly);
        this.filterBtn.title = this.ownedOnly ? 'Đang lọc: Đã sở hữu' : 'Hiển thị tất cả skin';
        this._renderSkinGrid();
      });
    }
    if (this.equipBtn) {
      this.equipBtn.addEventListener('click', () => {
        if (!this.activeWeaponId || !this.selectedSkinId) return;
        if (!isSkinOwned(this.activeWeaponId, this.selectedSkinId)) return;
        const ok = equipSkin(this.activeWeaponId, this.selectedSkinId);
        if (ok) {
          this._playUi();
          if (this.onEquipSkin) {
            this.onEquipSkin(this.activeWeaponId, getEquippedSkin(this.activeWeaponId));
          }
          this.refresh();
        }
      });
    }
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.mode === 'detail') this.showArsenal();
        else this.setOpen(false);
      }
    });
  }

  setOpen(on) {
    const want = !!on;
    if (this.open === want) return;
    this.open = want;
    if (this.screen) this.screen.classList.toggle('hidden', !want);
    if (want) {
      this.showArsenal();
    } else {
      this.preview3D.setActive(false);
    }
  }

  showArsenal() {
    this.mode = 'arsenal';
    this.activeWeaponId = null;
    this.preview3D.setActive(false);
    this.arsenalView?.classList.remove('hidden');
    this.detailView?.classList.add('hidden');
    if (this.breadcrumb) this.breadcrumb.textContent = 'COLLECTION // KHO VŨ KHÍ';
    this._renderTotalBadge();
    this._renderArsenalGrid();
  }

  showWeaponDetail(weaponId) {
    const w = getWeapon(weaponId);
    if (!w) return;
    this.mode = 'detail';
    this.activeWeaponId = w.id;
    const eq = getEquippedSkin(w.id);
    this.selectedSkinId = eq ? eq.id : null;
    this.searchQuery = '';
    this.ownedOnly = false;
    if (this.searchInput) this.searchInput.value = '';
    if (this.filterBtn) this.filterBtn.classList.remove('active');

    this.arsenalView?.classList.add('hidden');
    this.detailView?.classList.remove('hidden');
    if (this.breadcrumb) this.breadcrumb.textContent = `COLLECTION // ${w.id === 'knife' ? 'MELEE' : w.name}`;
    this._renderTotalBadge();
    this._renderSkinGrid();
    this._renderSkinPreview();
    this.preview3D.setActive(true);
  }

  refresh() {
    this._renderTotalBadge();
    if (this.mode === 'arsenal') {
      this._renderArsenalGrid();
    } else if (this.activeWeaponId) {
      this._renderSkinGrid();
      this._renderSkinPreview();
    }
  }

  _renderTotalBadge() {
    if (!this.totalBadge) return;
    const { owned, total } = getTotalSkinCounts();
    this.totalBadge.textContent = `${owned} / ${total} SKINS ĐÃ SỞ HỮU`;
  }

  _renderArsenalGrid() {
    if (!this.arsenalGrid) return;
    this.arsenalGrid.innerHTML = '';

    for (const colDef of COLLECTION_COLUMNS) {
      const col = document.createElement('div');
      col.className = 'col-column';
      for (const sec of colDef.sections) {
        const secEl = document.createElement('div');
        secEl.className = 'col-section';
        const head = document.createElement('div');
        head.className = 'col-sec-title';
        head.textContent = sec.title;
        secEl.appendChild(head);

        for (const wid of sec.items) {
          const w = WEAPONS[wid];
          if (!w) continue;
          const eq = getEquippedSkin(wid);
          const { owned, total } = getWeaponSkinCounts(wid);

          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'col-weapon-card' + (total > 1 ? ' has-skins' : '');
          card.dataset.weapon = wid;

          const svgKey = eq?.svgKey || wid;
          const displayName = wid === 'knife' ? 'MELEE' : w.name;
          const mediaHtml = eq?.thumb
            ? `<img class="col-weapon-img" src="${eq.thumb}" alt="${displayName}" loading="lazy">`
            : `<div class="col-weapon-svg">${WEAPON_SVGS[svgKey] || ''}</div>`;

          const skinLabel = eq ? `<span class="col-weapon-skin">${eq.subtitle || eq.name}</span>` : '';
          const badgeHtml = total > 1
            ? `<span class="col-weapon-count ${owned === total ? 'full' : ''}">${owned}/${total}</span>`
            : '';

          card.innerHTML = `
            ${badgeHtml}
            <div class="col-weapon-media">${mediaHtml}</div>
            <div class="col-weapon-footer">
              <span class="col-weapon-name">${displayName}</span>
              ${skinLabel}
            </div>
          `;
          card.addEventListener('click', () => {
            this._playUi();
            this.showWeaponDetail(wid);
          });
          secEl.appendChild(card);
        }
        col.appendChild(secEl);
      }
      this.arsenalGrid.appendChild(col);
    }
  }

  _renderSkinGrid() {
    if (!this.skinGrid || !this.activeWeaponId) return;
    const skins = getWeaponSkins(this.activeWeaponId);
    const eq = getEquippedSkin(this.activeWeaponId);
    const { owned, total } = getWeaponSkinCounts(this.activeWeaponId);

    if (this.skinCounter) this.skinCounter.textContent = `${owned} / ${total}`;

    const filtered = skins.filter((s) => {
      if (this.ownedOnly && !isSkinOwned(this.activeWeaponId, s.id)) return false;
      if (this.searchQuery && !s.name.toLowerCase().includes(this.searchQuery) && !(s.subtitle || '').toLowerCase().includes(this.searchQuery)) {
        return false;
      }
      return true;
    });

    this.skinGrid.innerHTML = '';
    for (const s of filtered) {
      const isOwned = isSkinOwned(this.activeWeaponId, s.id);
      const isEq = eq && eq.id === s.id;
      const isSel = this.selectedSkinId === s.id;
      const tier = TIER_META[s.tier] || TIER_META.standard;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'col-skin-tile' +
        (isOwned ? ' owned' : ' locked') +
        (isEq ? ' equipped' : '') +
        (isSel ? ' selected' : '');
      tile.dataset.skin = s.id;
      tile.title = isOwned ? s.name : `${s.name} (Chưa sở hữu)`;

      const imgHtml = s.thumb
        ? `<img class="col-skin-thumb" src="${s.thumb}" alt="${s.name}">`
        : `<div class="col-skin-svg">${WEAPON_SVGS[s.svgKey || this.activeWeaponId] || ''}</div>`;

      const lockOverlay = !isOwned
        ? `<span class="col-lock-badge" title="Chưa sở hữu">${LOCK_SVG}</span>`
        : '';
      const eqBadge = isEq
        ? `<span class="col-eq-badge" title="Đang trang bị">◆</span>`
        : '';

      tile.innerHTML = `
        <span class="col-tier-dot" style="color:${tier.color}">${tier.symbol}</span>
        ${eqBadge}
        <div class="col-skin-media">${imgHtml}</div>
        ${lockOverlay}
        <span class="col-skin-caption">${s.name}</span>
      `;
      tile.addEventListener('click', () => {
        this._playUi();
        this.selectedSkinId = s.id;
        this._renderSkinGrid();
        this._renderSkinPreview();
      });
      this.skinGrid.appendChild(tile);
    }

    if (!filtered.length) {
      this.skinGrid.innerHTML = '<div class="col-empty">Không tìm thấy skin phù hợp.</div>';
    }
  }

  _renderSkinPreview() {
    if (!this.activeWeaponId) return;
    const w = getWeapon(this.activeWeaponId);
    const skins = getWeaponSkins(this.activeWeaponId);
    const skin = skins.find((s) => s.id === this.selectedSkinId) || skins[0];
    if (!skin) return;

    this.selectedSkinId = skin.id;
    const isOwned = isSkinOwned(this.activeWeaponId, skin.id);
    const eq = getEquippedSkin(this.activeWeaponId);
    const isEq = eq && eq.id === skin.id;
    const tier = TIER_META[skin.tier] || TIER_META.standard;

    if (this.tierSymbol) {
      this.tierSymbol.textContent = tier.symbol;
      this.tierSymbol.style.color = tier.color;
    }
    if (this.skinTitle) this.skinTitle.textContent = skin.name;
    if (this.skinSub) this.skinSub.textContent = `${tier.label.toUpperCase()} · ${skin.subtitle || w.catVi}`;
    if (this.skinDesc) this.skinDesc.textContent = skin.desc || '';

    if (this.equipBtn) {
      this.equipBtn.classList.remove('is-equipped', 'is-locked');
      if (!isOwned) {
        this.equipBtn.disabled = true;
        this.equipBtn.classList.add('is-locked');
        this.equipBtn.innerHTML = `${LOCK_SVG} <span>CHƯA SỞ HỮU</span>`;
      } else if (isEq) {
        this.equipBtn.disabled = true;
        this.equipBtn.classList.add('is-equipped');
        this.equipBtn.innerHTML = `<span>✓ ĐANG TRANG BỊ</span>`;
      } else {
        this.equipBtn.disabled = false;
        this.equipBtn.innerHTML = `<span>TRANG BỊ SKIN</span>`;
      }
    }

    this.preview3D.show(w, skin);
  }
}
