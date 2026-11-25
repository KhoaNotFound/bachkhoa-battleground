# Báo Cáo Kiến Trúc Dự Án, AWP Dragon Lore, Vandal 3D Skins, Kho Bộ Sưu Tập, Dao Butterfly & Hiệu Ứng Kill Effect Valorant

**Dự án:** Bách Khoa Battleground  
**Công nghệ cốt lõi:** HTML5, CSS3, Vanilla ES Modules, Three.js (`v0.164.1`), Meshopt (`EXT_meshopt_compression` + `EXT_texture_webp`), Blender 5.3 NLA Rigging (`THREE.AnimationMixer`), Canvas 2D Real-time Chroma Key, Web Audio API, WebSocket (`ws`) & MQTT (`mqtt`)  
**Cập nhật lần cuối:** 25/11/2026

---

## 1. Sơ Đồ Cây Thư Mục & Công Dụng Từng Thành Phần

```text
bachkhoa-battleground/
├── index.html                  # Giao diện gốc: importmap Three.js, Loading, Sảnh (Lobby + nút Bộ Sưu Tập), HUD, Buy Menu (B), Collection UI, Scope, Bảng điểm
├── style.css                   # Toàn bộ giao diện UI/UX (glassmorphism), tâm ngắm, thanh máu, slot vũ khí, Buy Menu, Collection 2 tầng & xem trước 3D
├── README.md                   # Tài liệu giới thiệu game, phím điều khiển và kiến trúc mạng
├── server.json                 # Lưu URL Cloudflare Tunnel công khai của relay server (client tự đọc khi chơi online)
├── start-server.sh             # Script bash tự khởi chạy Node relay server + mở Cloudflare quick tunnel & cập nhật server.json
├── .gitattributes              # Cấu hình chuẩn hóa line-ending / binary attributes trong Git
├── .gitignore                  # Bỏ qua file tạm/log/node_modules khi commit Git
│
├── assets/                     # Chứa tài nguyên 3D nhị phân glTF 2.0 (đã tối ưu WebP + Meshopt, tổng ~10.72 MB), bản đồ nhị phân, âm thanh, ảnh và video hiệu ứng hạ gục
│   ├── awp-dragon-lore.glb     # CS:GO AWP Dragon Lore (~1.18 MB): Armature 8 xương, tay hộp chữ nhật, texture WebP 2K & 5 clip NLA (draw, idle, fire, reload, inspect)
│   ├── butterfly-viewmodel.glb # Rig ViewModel dao Butterfly (~0.34 MB): Armature 23 xương, tay khối hộp chữ nhật & 6 clip NLA (draw, idle, slash_1, slash_2, heavy, inspect)
│   ├── butterfly-knife.glb     # Mô hình 3D dao Valorant Champions Butterfly gốc (~0.22 MB) có 2 chốt bản lề SafePinPivot & BitePinPivot
│   ├── karambit.glb            # Mô hình 3D dao Karambit (~0.03 MB) dự phòng cho kho cận chiến
│   ├── skins/                  # Tài nguyên 3D & ảnh thumbnail cho hệ thống Bộ Sưu Tập (Collection)
│   │   ├── cs2/                # 5 mô hình CS2 HD làm bản Default CS2 (gắn rig tay khối hộp + 5 clip NLA 60 FPS, đã nén WebP 2K + Meshopt FILTER)
│   │   │   ├── m4a1s-cs2.glb   # M4A1-S (CS2 Default cho Phantom, ~2.20 MB) — Inspect hất-xoay-hứng
│   │   │   ├── ak47-cs2.glb    # AK-47 (CS2 Default cho Vandal, ~1.19 MB) — Inspect hất-xoay-hứng
│   │   │   ├── deagle-cs2.glb  # Desert Eagle (CS2 Default cho Sheriff, ~0.84 MB) — Inspect xoay trái -> ngẩng nòng -> xoay phải
│   │   │   ├── usps-cs2.glb    # USP-S (CS2 Default cho Classic, ~0.79 MB) — Inspect xoay trái -> ngẩng nòng -> xoay phải
│   │   │   └── awp-cs2.glb     # AWP (CS2 Default cho Operator, ~1.20 MB) — Inspect súng ngắm riêng
│   │   ├── vandal/             # 3 mô hình Vandal chuẩn hóa cùng tỷ lệ (0.76m), gắn rig tay độc lập + Inspect hất-xoay-hứng
│   │   │   ├── vandal-default.glb   # Vandal mặc định Valorant (~0.74 MB): texture PBR WebP 2K
│   │   │   ├── vandal-forsaken.glb  # Forsaken Vandal (White) (~1.00 MB): texture trắng mạ vàng + tinh thể xanh ngọc (WebP 2K)
│   │   │   └── vandal-rgx.glb       # RGX 11z Pro Vandal (~1.00 MB): khung vỏ trong suốt + dải LED phát sáng emission PBR (WebP 2K)
│   │   └── thumbs/             # Ảnh thumbnail PNG nền trong suốt (512×256)
│   │       ├── vandal-default.png · vandal-cs2.png · vandal-forsaken.png · vandal-rgx.png
│   │       ├── phantom-cs2.png · sheriff-cs2.png · classic-cs2.png
│   │       ├── operator-cs2.png · operator-default.png
│   │       └── knife-butterfly.png
│   ├── audio/
│   │   └── awm.mp3             # Mẫu âm thanh phát bắn AWM chân thực (~113 KB)
│   ├── img/
│   │   └── logo-bk.png         # Biểu trưng Trường ĐH Bách Khoa TP.HCM
│   ├── map/                    # Dữ liệu khuôn viên Bách Khoa bản chính (mesh nhị phân campus.bin, metadata campus.json, va chạm collision.bin, minimap.png)
│   ├── map-review/             # Bản đồ thử nghiệm (?map=review) dựng lại chi tiết các tòa nhà cho phép đi vào các tầng (phòng chơi tách biệt)
│   └── killfx/                 # 6 đoạn video hiệu ứng hạ gục liên tiếp Valorant (1080p 60fps + âm thanh stereo 48kHz)
│       ├── kill_1.mp4          # Mạng 1 (1.65s · 99 frames, cắt từ 0.25s – 1.88s)
│       ├── kill_2.mp4          # Mạng 2 liên tiếp (1.67s · 100 frames, cắt từ 1.90s – 3.55s)
│       ├── kill_3.mp4          # Mạng 3 liên tiếp (1.67s · 100 frames, cắt từ 3.57s – 5.22s)
│       ├── kill_4.mp4          # Mạng 4 liên tiếp (1.53s · 92 frames, cắt từ 5.23s – 6.75s)
│       ├── kill_5.mp4          # Mạng 5 liên tiếp / ACE (6.90s · 414 frames, cắt từ 6.77s – 13.65s)
│       └── kill_6.mp4          # Mạng 6+ liên tiếp (6.90s · 414 frames, cắt từ 14.60s – 21.48s)
│
├── js/                         # Toàn bộ mã nguồn client (ES Modules, không cần bước build)
│   ├── main.js                 # Điểm khởi chạy chính: game loop, input, chu kỳ ngày/đêm 10 phút, hệ thống vũ khí, Collection, /dummy, /unlock all, killStreak & đồng bộ mạng
│   ├── weapons.js              # Danh mục 18 khẩu súng (Sidearms, SMGs, Shotguns, Rifles, Snipers, Machine Guns) + 2 cận chiến (Dao Butterfly / Nắm đấm) & icon SVG
│   ├── skins.js                # Danh mục skin toàn bộ 20 vũ khí, lưu trạng thái sở hữu & trang bị trong localStorage (bkbg.skins), API unlockAllSkins / resetSkins
│   ├── collection.js           # Giao diện Bộ Sưu Tập 2 tầng kiểu Valorant (View 1 lưới vũ khí, View 2 chi tiết skin + ổ khóa 🔒 + xem trước 3D xoay 360° trực tiếp)
│   ├── shop.js                 # Bảng mua vũ khí kiểu Valorant (nhấn B): 5 cột vũ khí + bảng thông số chi tiết bên phải + tùy chọn dùng Dao hoặc Nắm đấm
│   ├── butterfly.js            # Điều khiển dao Butterfly: lazy-load butterfly-viewmodel.glb qua glb-loader.js, THREE.AnimationMixer, vật lý 6-DOF Tầng 1 & clack audio đồng bộ frame
│   ├── glb-loader.js           # Module nạp .glb dùng chung: singleton GLTFLoader + MeshoptDecoder, cache ArrayBuffer chống tải trùng, warmUpModel() (upload 1 texture/frame + compileAsync) & disposeObject3D()
│   ├── viewmodel.js            # Scene góc nhìn thứ nhất (FOV 62°), PMREM studio lighting, lazy-load AWP/Vandal/CS2 GLB, LRU VRAM cache (tối đa 4), idle preload & procedural ViewModel
│   ├── admin.js                # Xác thực khóa Admin (?admin=<key> hoặc /admin <key>) và chế độ camera bay tự do Inspector (nút ADMIN · INSPECT MAP)
│   ├── chat.js                 # Khung chat toàn phòng (phím /), giới hạn tốc độ gửi tin (RateLimit) và xử lý các lệnh slash (/time, /tp, /dummy, /killfx, /unlock all...)
│   ├── campus-data.js          # Dữ liệu hình học & tọa độ các khu vực, tòa nhà khuôn viên ĐH Bách Khoa
│   ├── landmarks.js            # Điểm mốc định vị, biển chỉ dẫn và nhãn khu vực trong khuôn viên trường
│   ├── physics.js              # Hệ va chạm AABB theo lưới 2D (CollisionWorld + 2D DDA raycast) & bộ di chuyển nhân vật (Mover)
│   ├── map.js                  # Nạp bản đồ khuôn viên 3D ĐH Bách Khoa (tự chuyển giữa assets/map và assets/map-review theo tham số ?map=review)
│   ├── textures.js             # Sinh toàn bộ texture 2D bằng Canvas (mặt tiền, mái, sân bóng, sân bóng rổ, khuôn mặt, nametag, chat bubble, tia lửa)
│   ├── avatar.js               # Mô hình nhân vật góc nhìn thứ 3 (dùng AWP Dragon Lore clone + Butterfly 3rd-person), hitbox 3 vùng & hiệu ứng vỡ khối Debris
│   ├── hud.js                  # Quản lý HUD: minimap xoay theo hướng nhìn, bản đồ lớn (giữ M), thanh máu, đạn, hitmarker, killfeed, kill banner (Chroma Key) & bảng điểm
│   ├── vfx.js                  # Hệ thống hạt (3000 hạt additive/normal), đường đạn tracer, chớp nòng, vết đạn decal, máu & vòng xung
│   ├── audio.js                # Bộ tổng hợp âm thanh Web Audio API + phát mẫu awm.mp3 + hỗ trợ âm thanh 3D HRTF
│   ├── net.js                  # Lớp mạng lai: ưu tiên WebSocket Relay Server và tự động fallback sang Public MQTT Broker
│   └── util.js                 # Hàm toán học & tiện ích (clamp, lerp, damp, góc xoay, PRNG mulberry32, escapeHtml)
│
├── night/                      # Chế độ chơi phụ: "Ở lại trường vào buổi tối" (Co-op 2–5 người, nhiệm vụ ban đêm & voice chat WebRTC)
│   ├── index.html              # Giao diện chế độ chơi ban đêm
│   ├── night.css               # Style tối cho chế độ Co-op đêm
│   ├── README.md               # Hướng dẫn vận hành chế độ night
│   └── js/                     # Logic riêng (main.js, map.js, net.js, tasks-logic.js, tasks-ui.js, voice.js)
│
├── server/                     # Backend nhẹ để relay dữ liệu multiplayer độ trễ thấp
│   ├── server.js               # HTTP static server (streaming, ETag, 304 Not Modified, Cache-Control 7 ngày cho .glb/.bin/.webp) + WebSocket room relay + cầu nối 2 chiều sang MQTT broker
│   ├── package.json            # Khai báo dependencies (ws, mqtt) và lệnh khởi chạy server
│   └── package-lock.json       # Khóa phiên bản chính xác các gói npm của server
│
├── tools/                      # Bộ công cụ Python & Node.js ngoại tuyến xây dựng bản đồ, va chạm, tối ưu GLB và khóa Admin
│   ├── optimize-weapons.mjs    # Script Node.js chuẩn hóa & nén toàn bộ model súng .glb (lọc animation thừa, resize WebP 2K/1K, Meshopt FILTER lossless)
│   ├── package.json            # Dependencies cho pipeline tối ưu GLB (@gltf-transform, sharp, meshoptimizer)
│   ├── build_campus.py         # Biên dịch dữ liệu OSM / khuôn viên thành campus.bin & minimap.png
│   ├── build_obj_map.py        # Chuyển đổi các file .obj từ Blender sang định dạng bản đồ tối ưu (map-review)
│   ├── voxel_collision.py      # Sinh lưới hộp va chạm AABB nhị phân (collision.bin) từ hình học 3D
│   ├── extract_frames.py       # Hỗ trợ tách khung hình video hiệu ứng
│   ├── admin_key.py            # Sinh và kiểm tra hash khóa Admin
│   ├── landmarks.json          # Cấu hình tọa độ các địa điểm nổi bật trong trường
│   └── osm-campus.json         # Dữ liệu bản đồ OpenStreetMap khu vực 268 Lý Thường Kiệt
│
├── vendor/                     # Thư viện cục bộ không phụ thuộc CDN (three.module.js, GLTFLoader.js, BufferGeometryUtils.js, addons/libs/meshopt_decoder.module.js, mqtt.esm.js)
│
└── report/                     # Thư mục lưu trữ các báo cáo kỹ thuật & tài liệu phân tích dự án
    └── bao-cao-kien-truc-va-dao-butterfly.md  # Báo cáo hiện tại
```

### Bảng tóm tắt vai trò từng thư mục

| Thư mục | Vai trò chính |
| :--- | :--- |
| `/` (Root) | Entry point web (`index.html`, `style.css`), cấu hình địa chỉ server (`server.json`) và script vận hành (`start-server.sh`). |
| `assets/` | Lưu tài sản 3D định dạng `.glb` (glTF 2.0 nhị phân tự chứa mesh, armature skinning, NLA animations, vật liệu PBR và texture PNG). |
| `js/` | Kiến trúc client thuần ES Modules, tách biệt rõ ràng giữa lõi vòng lặp (`main.js`), vật lý (`physics.js`), bản đồ/đồ họa (`map.js`, `textures.js`, `vfx.js`, `avatar.js`), góc nhìn thứ nhất (`viewmodel.js`, `butterfly.js`), giao diện (`hud.js`), âm thanh (`audio.js`) và mạng (`net.js`). |
| `server/` | Relay server viết bằng Node.js giúp đồng bộ vị trí/hành động giữa các người chơi trong cùng phòng qua WebSocket, đồng thời bắt cầu (bridge) với MQTT. |
| `report/` | Nơi lưu trữ báo cáo kiến trúc, thiết kế và hướng dẫn kỹ thuật của dự án. |

---

## 2. Tóm Tắt Cơ Chế Game (Bách Khoa Battleground)

### 2.1. Vòng đời trận đấu & Luồng Render
- **4 trạng thái chính (`state` trong `js/main.js`)**: `loading` → `lobby` (camera bay vòng quanh khuôn viên trường) → `playing` (khóa con trỏ Pointer Lock, điều khiển FPS) → `dead` (camera quay về phía kẻ hạ gục trong 4.2 giây rồi trở về sảnh).
- **Kỹ thuật Render 2-Pass (`js/main.js`)**:
  1. `renderer.clear()` → `renderer.render(scene, camera)`: vẽ bầu trời shader, khuôn viên Bách Khoa, hiệu ứng hạt và các người chơi khác.
  2. `renderer.clearDepth()` → `renderer.render(vm.scene, vm.camera)`: xóa depth buffer rồi vẽ cảnh ViewModel (tay khối hộp + vũ khí) ở FOV riêng (`62°`), giúp vũ khí **không bao giờ xuyên vào tường** khi đứng sát vật cản.

### 2.2. Di chuyển & Vật lý Va chạm (`js/physics.js`, `js/main.js`)
- **Bản đồ va chạm (`CollisionWorld`)**: Tất cả tường, tòa nhà, mái, cầu thang, bục chắn được lưu dưới dạng hộp trục song song (AABB) và băm vào lưới không gian 2D ô `8m × 8m`. Tia bắn (`raycast`) dùng thuật toán **2D DDA** (tối đa 400 bước).
- **Điều khiển nhân vật (`Mover`)**:
  - Bán kính nhân vật `R = 0.34m`, chiều cao đứng `1.8m` (tầm mắt `1.62m`), chiều cao ngồi `1.2m` (tầm mắt `1.05m`), tự động bước bậc tối đa `STEP = 0.5m`.
  - **Tốc độ di chuyển**: Ngồi `2.8 m/s`, đi bộ `5.4 m/s`, chạy nhanh (`Shift`) `8.2 m/s`. Cầm **Nắm đấm** tăng `+8%` tốc độ, cầm **Dao Butterfly** tăng `+15%` tốc độ; bật scope AWP giảm còn `55%`.
  - **Nhảy & Sát thương rơi**: Vận tốc nhảy `vy = 6.8 m/s`, trọng lực thế giới `21 m/s²`. Nếu `fallV < -16 m/s`, chịu sát thương `round((-fallV - 16) * 6)`.

### 2.3. Hệ thống Vũ khí & Chiến đấu
Mỗi người chơi có **100 HP**, **2.5 giây bảo vệ khi hồi sinh** (hết ngay nếu tấn công), hạ gục đối thủ được **+25 HP**, và sau **7 giây không nhận sát thương** sẽ tự hồi `8 HP/s`.

| Ô | Phím | Vũ khí | Sát thương (Đầu / Thân / Chân) | Tầm đánh / Băng đạn | Hồi chiêu | Đặc điểm nổi bật |
| :-: | :-: | :--- | :--- | :--- | :--- | :--- |
| 1 | `1` | **Nắm đấm** | `35 / 25 / 25` | `2.7 m` (có hình nón hỗ trợ) | `420 ms` | Chạy nhanh `+8%`, đấm luân phiên 2 tay |
| 2 | `2` | **AWP Dragon Lore** | `250 / 85 / 65` | `1500 m` · `5 viên / ∞` | `1350 ms` (nạp `2.8s`) | Chuột phải ngắm scope (`FOV 13°` + đo khoảng cách), mô hình CS:GO AWP Dragon Lore có animation bắn (`fire`), nạp đạn (`reload`) và soi súng nhấn/giữ `F` (`inspect`, tự ngắt khi ngắm/bắn/nạp/đổi súng) |
| 3 | `3` | **Dao Butterfly** | Nhẹ: `70 / 45 / 45`<br>Mạnh: `110 / 75 / 75` | `2.9 m` (có hình nón hỗ trợ) | Nhẹ: `380 ms`<br>Mạnh: `680 ms` | Chạy nhanh `+15%`, tay khối hộp chữ nhật phong cách BKLON, chuột trái chém combo 2 nhịp, chuột phải Icepick đâm mạnh, **ấn `F` 1 lần** để múa hết 4 pha (giữ `F` sẽ lặp) |

- **Đổi vũ khí linh hoạt**: Phím `1` / `2` / `3`, cuộn chuột (`wheel`), hoặc `Q` (`lastWeapon`).
- **Hitbox 3 vùng (`rayPlayer` trong `js/avatar.js`)**: Biến đổi tia bắn về hệ tọa độ cục bộ đối thủ rồi kiểm tra `head`, `body`, `legs` (tự hạ `0.36m` khi ngồi).

### 2.4. Bản đồ, Đồ họa, Âm thanh & Mạng Multiplayer
- **Bản đồ khuôn viên ĐH Bách Khoa (`js/map.js`, `js/textures.js`)**: Dựng trong khung `300m × 200m` (`x ∈ [-150, 150]`, `z ∈ [-100, 100]`), gộp hình học theo vật liệu để giảm draw call và tự vẽ minimap (`HUD.buildMapImage`).
- **Âm thanh tổng hợp (`js/audio.js`)**: Tổng hợp 100% bằng Web Audio API + `PannerNode` HRTF + độ trễ truyền âm (`dist / 343`s).
- **Mạng Multiplayer (`js/net.js`, `server/server.js`)**: Gửi trạng thái `50ms` (WebSocket) / `80ms` (MQTT), nội suy lùi `100ms` / `170ms` kèm ngoại suy ngắn tối đa `150ms`.

---

## 3. Kiến Trúc ViewModel Rigging & Animation (`THREE.AnimationMixer`)

Cả **AWP Dragon Lore** (Slot `2`) và **Dao Butterfly** (Slot `3`) đều được dựng **Armature + Animation Keyframe 60 FPS (Bezier `AUTO_CLAMPED`) trực tiếp trong Blender 5.3**, đẩy thành từng NLA Track độc lập để xuất `.glb` không nén Draco và phát qua `THREE.AnimationMixer` với `crossFadeTo` mượt mà, trong khi toàn bộ tay/cánh tay đều giữ tạo hình **khối hình hộp chữ nhật phẳng** đồng bộ mỹ thuật của game.

### 3.1. Rig & Animation Dao Butterfly (`assets/butterfly-viewmodel.glb`, `js/butterfly.js`)

#### A. Cấu trúc Rig `ButterflyViewModelRig` (23 xương) & Tay khối hộp
- **Chuỗi xương chính**: `Root` → `Forearm` → `Hand` (kèm các xương phụ `Index/Middle/Ring/Pinky/Thumb.01..03` giữ chuẩn khung rig) → `KnifeSocket` → `KnifePivot` (chuyển tâm xoay tức thời giữa `PALM`, `THUMB`, `INDEX`, `FAN`, `ICEPICK`) → `SafeHandleBone` → `SafePinBone` (`Blade`) → `BitePinBone` (`BiteHandle`).
- **Tạo hình tay đồng bộ (`SleeveMesh` & `HandMesh`)**:
  - `HandMesh`: Khối hình hộp chữ nhật (`8` đỉnh / `6` mặt phẳng, vật liệu `SkinMat`, tách hết ngón tay), gán `100%` weight vào xương `Hand`.
  - `SleeveMesh`: Khối hình hộp chữ nhật (`8` đỉnh / `6` mặt phẳng, vật liệu `SleeveMat` đồng bộ động màu áo từ Lobby), gán `100%` weight vào xương `Forearm`.
- **Kiểm tra chống xuyên mesh (`BVHTree`)**: Quét giao cắt giữa `Blade` và `HandMesh`/`SleeveMesh` trên toàn bộ khung hình của cả 6 clip → **`0` khung hình xuyên mesh**.

#### B. 6 Clip NLA (60 FPS) & Mốc Âm Thanh Tang-Pin (`CLACK_SCHEDULES`)

| Clip | Frame | Thời lượng | Chế độ phát | Mô tả chuyển động & Mốc tiếng `knifeClack` |
| :--- | :-: | :-: | :--- | :--- |
| **`draw`** | `0 → 42` | `0.700 s` | `LoopOnce` | Rút dao Y2K Thumb Rollover `360°`. Clack tại f`22` (`0.367s`) & f`35` (`0.583s`). |
| **`idle`** | `0 → 120` | `2.000 s` | `LoopRepeat` | Thế cầm sẵn ổn định với nhịp thở vi mô. |
| **`slash_1`** | `0 → 24` | `0.400 s` | `LoopOnce` | Vung chém chéo thuận tay + quán tính cán. |
| **`slash_2`** | `0 → 24` | `0.400 s` | `LoopOnce` | Lật cổ tay chém ngược tay nối combo. |
| **`heavy`** | `0 → 44` | `0.733 s` | `LoopOnce` | Lật `180°` Icepick đâm mạnh (`-Z`) rồi lật trả. Clack tại f`13` (`0.217s`) & f`38` (`0.633s`). |
| **`inspect`** | `0 → 114` | `1.900 s` | `LoopOnce` (ấn `F` 1 lần chạy trọn 4 pha; giữ `F` để lặp) | **Pha 1** (f0–28): Thumb Rollover; **Pha 2** (f28–68): Helicopter Fan `720°`; **Pha 3** (f68–94): Index Chaplin `360°`; **Pha 4** (f94–114): Wrist Pass & Snap Catch. Clack tại f`18` (`0.300s`), f`30` (`0.500s`), f`70` (`1.167s`), f`106` (`1.767s`). |

#### C. Vật lý Tầng 1 (`inertiaPivot`) trong `js/butterfly.js`
Dù animation múa do `THREE.AnimationMixer` điều khiển, Tầng 1 `inertiaPivot` vẫn tính toán theo thời gian thực với **0 cấp phát bộ nhớ heap trong `update()`**:
- **Trọng lực & Quán tính D'Alembert**: $\vec{f}_{\text{eff}} = q_{\text{cam}}^{-1}(0,-g,0) - q_{\text{cam}}^{-1}\vec{a}_{\text{world}}$ kết hợp moment xoay chuột `(lookDX, lookDY)` đi qua 2 lò xo giảm chấn 6-DOF (`linPos/linVel`, `angPos/angVel`).
- **Locomotion Gait**: Nhịp đánh tay Lissajous khi đi bộ/chạy nhanh (`sprintBlend`), trạng thái không trọng lực khi nhảy (`jumpImpulse`), nén cổ tay khi tiếp đất (`landImpulse`) và thu gọn khi ngồi (`crouchBlend`).

---

### 3.2. Rig & Animation Súng Ngắm AWP Dragon Lore (`assets/awp-dragon-lore.glb`, `js/viewmodel.js`, `js/avatar.js`)

#### A. Xử lý Mô hình Nguồn & Tách Mesh Chuyển Động
Mô hình gốc từ `DRAGONLORE.fbx` được chuẩn hóa về hệ tọa độ ViewModel mét (`SCALE = 0.0145`, tâm thu nhận `P0 = (-0.0315, -8.20, 8.50)` → chiều dài `0.78m`, tâm ống ngắm `+0.038m` khớp `adsPos.y = -0.038`) và tách thành 4 phần độc lập dựa theo liên thông đồ thị:
- **`AwpBody`** (`10,870` đỉnh): Thân súng sơn họa tiết Rồng Vàng (Dragon Lore), nòng, chân chống, ray ống ngắm.
- **`AwpBolt`** (`365` đỉnh): Cụm khóa nòng gồm ống xi-lanh thoi (`98` đỉnh), cổ thoi (`49`), tay đòn (`36`) và bi nắm thoi (`182`).
- **`AwpMag`** (`342` đỉnh): Băng đạn rời dưới hộp khóa nòng.
- **`AwpScopeLens`** (`336` đỉnh): Thấu kính ống ngắm (`scopehider_basecolor.png`).
- **Sửa kênh vật liệu PBR**: Kết cấu `dragon_awp.png` (`2048×2048`) và `scopehider_basecolor.png` (`507×280`) được nhúng trực tiếp vào GLB ở chế độ `OPAQUE` (`Alpha = 1.0`, ngắt liên kết kênh Alpha Phong mặc định từ CS:GO để thân súng không bị trong suốt).

#### B. Armature `AwpViewModelRig` (8 xương) & 2 Tay Khối Hộp Chữ Nhật
- **Xương điều khiển**: `Root` → `GunBone` → {`BoltBone`, `MagBone`, `RightArmBone` → `RightHandBone`, `LeftArmBone` → `LeftHandBone`}.
- **2 Tay khối hộp chữ nhật**: `RightSleeveMesh`, `RightHandMesh`, `LeftSleeveMesh`, `LeftHandMesh` (mỗi khối `8` đỉnh / `6` mặt phẳng `SleeveMat` & `SkinMat`) đồng bộ màu áo người chơi thông qua `vm.setColor(c)`.

#### C. 5 Clip NLA (60 FPS) & Tích Hợp Góc Nhìn Thứ 1 + Thứ 3

| Clip | Frame | Thời lượng | Diễn hoạt chi tiết |
| :--- | :-: | :-: | :--- |
| **`draw`** | `0 → 36` | `0.600 s` | Nhấc súng từ dưới lên, tay phải đẩy & khóa thoi (`BoltBone.rot.y → 0`) vào nòng rồi giữ thế sẵn sàng. |
| **`idle`** | `0 → 120` | `2.000 s` | Nhịp thở nhẹ trên `GunBone` (`LoopRepeat`). |
| **`fire`** | `0 → 81` | `1.350 s` | **f0–4**: Giật nảy mạnh về sau (`dy = -0.065m`, ngẩng nòng `+0.155 rad`); **f16–26**: Nghiêng nhẹ thân súng sang trái, tay phải rời báng nắm bi thoi xoay mở lên (`BoltBone.rot.y = -1.10 rad`); **f39**: Kéo thẳng thoi lùi (`-0.064m`) tống vỏ đạn; **f51–60**: Đẩy thoi lên & khóa xuống; **f81**: Về lại báng tay cầm. Khớp hồi chiêu `AWM.cd = 1350ms` & âm thanh `audio.bolt(0.35)`. |
| **`reload`** | `0 → 168` | `2.800 s` | **f0–22**: Nghiêng súng sang trái & nâng cao góc nhìn lộ hộp đạn, tay trái lùi về nắm `AwpMag`; **f54–74**: Rút băng đạn cũ xuống (`dz = -0.175m`); **f100–108**: Đưa băng đạn mới lên & vỗ khớp dứt khoát; **f124–158**: Tay trái về ốp lót, tay phải gạt khóa nòng lên-lui-tới-xuống nạp viên mới; **f168**: Ổn định thế ngắm (`timeScale` tự đồng bộ theo `AWM.reload = 2.8s`). |
| **`inspect`** | `0 → 210` | `3.500 s` | **Pha 1 (f0–45)**: Nghiêng khoe họa tiết Rồng Vàng mặt trái; **Pha 2 (f45–105)**: Lật soi thân dưới, chân chống & vỗ nhẹ kiểm tra băng đạn (`MagBone +1.5mm` tại f`82`, click `audio.bolt`); **Pha 3 (f105–165)**: Nghiêng phải soi khóa nòng, gạt mở hé `40%` press-check tại f`135` (`-0.026m`) rồi đóng khóa tại f`152` (âm thanh mở/đóng tại f`122` & f`152`); **Pha 4 (f165–210)**: Thu về thế `idle` (`BVHTree` **0** frame xuyên mesh). Ấn `F` 1 lần chạy trọn 1 vòng và cross-fade `0.15s` về `idle`, giữ `F` để lặp liên tục, và tự ngắt ưu tiên khi ngắm ADS / bắn / nạp đạn / đổi vũ khí. |

- **Đồng bộ góc nhìn thứ 3 (`js/avatar.js`)**: `buildAwmMesh()` tải và cache tĩnh các phần `AwpBody`, `AwpBolt`, `AwpMag`, `AwpScopeLens` từ `assets/awp-dragon-lore.glb` (phóng tỷ lệ `2.2×`, dùng `THREE.Mesh` thường để tương thích trực tiếp với hiệu ứng vỡ khối `Debris.burst()` khi bị hạ).

---

### 3.3. Hệ Thống Hiệu Ứng Hạ Gục Liên Tiếp Valorant (`assets/killfx/`, `js/hud.js`, `js/main.js`)

#### A. Phân Tách 6 Đoạn Video Kill Effect Chuẩn Từng Khung Hình (60 FPS)
Từ video hiệu ứng gốc (`1920×1080`, `60 FPS`, âm thanh stereo `48 kHz`), hệ thống được cắt chính xác theo biên độ âm thanh và khung hình bắt đầu hiệu ứng trong Blender 5.3 VSE (hệ màu `Standard`) thành 6 clip độc lập đặt tại `assets/killfx/`:

| Clip | Cấp Chuỗi (`killStreak`) | Đoạn Gốc (`60 FPS`) | Thời Lượng | Đặc Điểm Hiệu Ứng & Âm Thanh |
| :--- | :-: | :---: | :---: | :--- |
| **`kill_1.mp4`** | **Mạng 1** | `0.25s – 1.88s` (f`16–114`) | `1.65 s` (`99` frames) | Huy hiệu đầu lâu 1 vạch + âm thanh hạ gục nốt thứ 1 |
| **`kill_2.mp4`** | **Mạng 2** | `1.90s – 3.55s` (f`115–214`) | `1.67 s` (`100` frames) | Huy hiệu đầu lâu 2 vạch + âm thanh hạ gục nốt thứ 2 |
| **`kill_3.mp4`** | **Mạng 3** | `3.57s – 5.22s` (f`215–314`) | `1.67 s` (`100` frames) | Huy hiệu đầu lâu 3 vạch + âm thanh hạ gục nốt thứ 3 |
| **`kill_4.mp4`** | **Mạng 4** | `5.23s – 6.75s` (f`315–406`) | `1.53 s` (`92` frames) | Huy hiệu đầu lâu 4 vạch + âm thanh hạ gục nốt thứ 4 |
| **`kill_5.mp4`** | **Mạng 5 (ACE)** | `6.77s – 13.65s` (f`407–820`) | `6.90 s` (`414` frames) | Huy hiệu 5 vạch + nhạc hiệu ACE ngân dài & vòng tâm thu dần |
| **`kill_6.mp4`** | **Mạng 6+ liên tiếp** | `14.60s – 21.48s` (f`877–1290`) | `6.90 s` (`414` frames) | Huy hiệu đầu lâu tia văng cực đại + nhạc hiệu hạ gục thứ 6+ |

#### B. Cơ Chế Tích Lũy Chuỗi Hạ Gục (`me.killStreak`) & Xóa Phông Xanh Thời Gian Thực (Chroma Key)
- **Logic chuỗi hạ gục không chết giữa chừng (`js/main.js`)**:
  - Mỗi khi người chơi hạ gục 1 kẻ địch trong cùng một mạng sống (`m.k === net.id`), `me.killStreak` tăng thêm `1` và kích hoạt `hud.showKillEffect(Math.min(6, me.killStreak), settings.vol)`.
  - Nếu hạ thêm kẻ địch tiếp theo khi hiệu ứng trước chưa kết thúc, clip cũ tự động dừng ngay và chuyển tức thì sang clip của mạng kế tiếp (`kill_1` → `kill_2` → `kill_3` → `kill_4` → `kill_5` → `kill_6`).
  - Khi người chơi bị hạ (`die()`), hồi sinh mới (`spawn()`) hoặc thoát ra sảnh (`leaveToLobby()`), `me.killStreak` tự động reset về `0` và ẩn banner.
- **Thuật toán Chroma Key & Despill Thời Gian Thực (`HUD.drawKillEffectFrame` trong `js/hud.js`)**:
  - Chỉ cắt vùng huy hiệu trung tâm phía dưới (`600×320` tại tọa độ `x = 660, y = 710` của khung `1920×1080`) vẽ lên `<canvas id="killBanner" width="520" height="280">`.
  - Do nền phông xanh có `RGB ≈ (28, 119, 0)` và huy hiệu đầu lâu màu trắng sáng `RGB ≈ (195, 196, 195)`, kênh Alpha được khôi phục trực tiếp từ kênh Đỏ & Xanh dương: $\alpha = \max((B - 10)\times 1.45,\ (R - 38)\times 1.62)$ kết hợp khử tràn viền xanh (despill) sang trắng sáng và làm mờ mượt `0.25s` cuối cho các clip `1..4`.

---

### 3.4. Bảng Mua Vũ Khí Kiểu Valorant (Phím `B`) & Lệnh `/dummy` (`js/weapons.js`, `js/shop.js`, `js/main.js`)

- **Bảng mua vũ khí (`B`)**:
  - Bố cục 5 cột vũ khí bên trái + **Bảng thông số chi tiết bên phải** (hiển thị ngay khi rê chuột hoặc chọn: `Fire Rate`, `Run Speed`, `Equip Speed`, `1st Shot Spread`, `Reload Speed`, `Magazine`, bảng `Damage Head/Body/Legs` và `Alt Fire`):
    1. **Sidearms (Súng lục · Ô `2`)**: Classic, Shorty, Frenzy, Ghost (giảm thanh), Sheriff.
    2. **SMGs & Shotguns (Ô `1`)**: Stinger, Spectre (giảm thanh), Bucky (12 bi), Judge (tự động 10 bi).
    3. **Rifles (Súng trường · Ô `1`)**: Bulldog, Guardian, Phantom (giảm thanh), Vandal.
    4. **Sniper Rifles & Machine Guns (Ô `1`)**: Marshal, Outlaw, Operator / AWP Dragon Lore (`awp-dragon-lore.glb`), Ares (50 viên), Odin (100 viên).
    5. **Melee / Cận chiến (Ô `3` — loại trừ nhau)**: Chọn **Dao Butterfly** sẽ tự động **ẩn Nắm đấm** khỏi HUD và vòng đổi vũ khí; chọn **Nắm đấm** sẽ tự động **ẩn Dao Butterfly**.
- **Lệnh tập bắn `/dummy`**:
  - Gõ `/dummy` (hoặc `/dummy 1..10`) trong khung chat (`/`) để spawn mục tiêu tập bắn ngay phía trước (hiển thị HP trên đầu và chấm cam trên minimap); gõ `/dummy clear` để xoá toàn bộ dummy.
  - Khi bắn hoặc chém hạ dummy, game kích hoạt đầy đủ hiệu ứng vỡ khối `Debris`, killfeed, hồi `+25 HP` và **chuỗi Kill Effect Valorant (`1 → 6+`)**.

---

### 3.5. Hệ Thống Model Vandal 3D, Kho Bộ Sưu Tập (Collection) & Skin Khóa/Mở (`assets/skins/`, `js/skins.js`, `js/collection.js`, `js/viewmodel.js`)

#### A. Bộ 2 Skin Default (CS2 & Valorant) & Hệ Thống Hoạt Ảnh Inspect Chung (`F`)
- **2 skin Default mở sẵn (CS2 + Valorant)**:
  - **Vandal**: `VANDAL (Valorant Default)` + `AK-47 (CS2 Default)` (kèm 2 skin khóa 🔒: `Forsaken Vandal`, `RGX 11z Pro Vandal`).
  - **Phantom**: `M4A1-S (CS2 Default)` + `PHANTOM (Valorant Default)`.
  - **Sheriff**: `DESERT EAGLE (CS2 Default)` + `SHERIFF (Valorant Default)`.
  - **Classic**: `USP-S (CS2 Default)` + `CLASSIC (Valorant Default)`.
  - **Operator**: `AWP (CS2 Default)` + `OPERATOR (Valorant Default)` (kèm skin khóa 🔒: `AWP Dragon Lore`).
  - **Melee**: `NẮM ĐẤM (Mặc định)` (kèm skin khóa 🔒: `Dao Butterfly Champions`).
- **Hoạt ảnh Inspect chung cho tất cả súng cầm 2 tay trừ `Operator` (`3.4s`, cả GLB lẫn procedural)**:
  1. Hất súng lên cao (`+0.135m`) và xoay nằm ngang `90°` trên không trung (hai tay tách độc lập khỏi `GunBone` để thực hiện động tác hất & đón).
  2. Hứng súng bằng hai tay (có độ nhún bắt súng + âm thanh click cơ khí `audio.bolt`) để ngắm rõ mặt bên thứ nhất.
  3. Cầm súng dựng dọc trở lại trục ngắm, sau đó nghiêng xoay sang phía đối diện để nhìn trọn mặt bên còn lại rồi thu về `idle`.
- **Hoạt ảnh Inspect chung cho tất cả súng lục (`2.8s`, cả `USP-S`, `Desert Eagle` lẫn súng lục procedural)**:
  1. Xoay tay sang bên trái với góc nhìn ngang súng hướng xéo lên trời (`pitch +30°`, `yaw +70°` theo thứ tự `YXZ`).
  2. Đưa mũi súng chĩa thẳng lên phía trên (`pitch +68°`).
  3. Giữ mũi súng chĩa lên trên và xoay cổ tay (`yaw -80°`) để quay mặt bên còn lại của súng về phía góc nhìn nhân vật, rồi thu mượt về thế `idle`.
- **Tích hợp `ViewModel` (`js/viewmodel.js`)**: Thống nhất cơ chế nạp động mọi skin có `.glb` (`this.vandalCache`) và tự động chuyển về procedural `customGun` khi người chơi chọn bản `Valorant Default` chưa có `.glb`.

#### B. Giao Diện Bộ Sưu Tập (Collection) & Xem Trước 3D Xoay 360°
- **Nút mở ngoài nền Lobby**: Nút **`BỘ SƯU TẬP · SKINS`** (`#collectionBtn`) đặt nổi bật ở phía trên màn hình Lobby.
- **Tầng 1 (Danh sách toàn bộ vũ khí)**: Lưới 4 cột theo đúng bố cục Valorant (`SIDEARMS`, `SMGS` + `SHOTGUNS`, `RIFLES` + `MELEE`, `SNIPER RIFLES` + `MACHINE GUNS`), hiển thị ảnh thumbnail của skin đang trang bị và bộ đếm skin (`1/3` trên Vandal).
- **Tầng 2 (Chi tiết skin từng súng)**:
  - **Cột trái**: Bộ lọc skin đã sở hữu, ô tìm kiếm theo tên và lưới các skin. **Mặc định chỉ mở khóa skin `Default`** (riêng mục **MELEE / Cận chiến** mặc định là **Nắm đấm**, còn **Dao Butterfly** bị khóa); mọi skin chưa sở hữu hiển thị làm mờ kèm **biểu tượng ổ khóa (🔒)** ngay trước ảnh skin.
  - **Cột phải (`CollectionPreview3D`)**: Khung canvas Three.js riêng biệt với studio PMREM lighting cho phép **kéo chuột xoay 360° và cuộn zoom** trực tiếp model 3D sạch (tự ẩn tay khối hộp đối với file `.glb`, và tái sử dụng `buildProceduralWeaponMesh()` cho các súng procedural còn lại).
- **Lưu trữ & Lệnh Admin**: Trạng thái sở hữu và trang bị lưu trong `localStorage['bkbg.skins']`. Hỗ trợ lệnh Admin trong chat `/unlock all` (mở khóa toàn bộ skin để test), `/unlock <id>` và `/lock all` (đặt lại chỉ còn Default).

---

### 3.6. Các Tính Năng Hỗ Trợ Khác (Ngày/Đêm, Chat, Admin Inspector, Bản Đồ Thử Nghiệm & Chế Độ Ban Đêm)
- **Chu kỳ Ngày / Đêm (`js/main.js`)**: Chế độ bắn nhau mặc định khóa ở ban ngày sáng rõ (`phase = 0.16 · 09:50`, tắt tự động chuyển tối); vẫn có thể bật buổi tối hoặc chu kỳ tự động bằng lệnh Admin `/night`, `/sunset`, `/sunrise`, `/time set`, `/auto` hoặc tham số `?daytime=`.
- **Chat & Lệnh Admin (`js/chat.js`, `js/admin.js`)**: Mở chat bằng phím `/`, kích hoạt quyền Admin qua `?admin=<key>` hoặc `/admin <key>` để dùng camera bay tự do (`ADMIN · INSPECT MAP`), dịch chuyển `/tp`, chỉnh tốc độ `/speed`, `/heal`, `/god`, `/ammo`, `/unlock all`.
- **Thử Map Mới (`?map=review`)**: Tải bản đồ từ `assets/map-review/` với các tòa nhà dựng chi tiết vào được từng tầng, tự động tách phòng multiplayer (`review-main`).
- **Chế độ Co-op Ban Đêm (`night/`)**: Chế độ chơi 2–5 người hợp tác làm nhiệm vụ trong khuôn viên buổi tối kèm voice chat WebRTC.

---

### 3.7. Hướng Dẫn Debug, Slow-Motion & Kiểm Thử (`window.__game`)

```js
// Kiểm tra Bộ Sưu Tập (Collection), Skin Vandal & lệnh mở khóa
window.__game.collectionUI.setOpen(true);                   // Mở giao diện Bộ Sưu Tập (Collection)
window.__game.unlockAllSkins();                             // Mở khóa toàn bộ skin (tương đương lệnh admin /unlock all)
window.__game.resetSkins();                                 // Khóa lại toàn bộ skin (chỉ giữ Mặc định, tương đương /lock all)

// Vào trận & kiểm tra Bảng mua vũ khí (B), /dummy và Kill Streak 1 -> 6
window.__game.spawn();
window.__game.toggleBuyMenu(true);                        // Mở bảng mua vũ khí (hoặc ấn phím B)
window.__game.spawnDummy(6);                              // Spawn 6 dummy tập bắn phía trước (hoặc gõ /dummy 6)
window.__game.triggerKillStreak(5);                       // Thử hiệu ứng Mạng 5 / ACE (kill_5.mp4)
// Hoặc mở khung chat trong trận (phím /) và gõ: /dummy · /killfx [1..6|reset] · /admin dev · /unlock all · /lock all

// Kiểm tra AWP Dragon Lore (slot 2)
window.__game.vm.setInspect(true);                        // Bắt đầu anim inspect 3.5s trên AWP Dragon Lore
window.__game.vm.fire();                                  // Chạy hoạt ảnh giật + kéo khóa nòng (fire)
window.__game.vm.reload(2.8);                             // Chạy hoạt ảnh tháo/lắp băng đạn & gạt khóa nòng (reload)
window.__game.vm._playAwmClip('inspect', 0.08, true, 7.0); // Xem chậm inspect 2x

// Đổi sang dao Butterfly (slot 3) & test animation / trục xương
window.__game.switchWeapon(2);
window.__game.vm.butterfly.setTimeScale(0.25);            // Slow-motion 0.25x
window.__game.vm.butterfly.setDebugAxes(true);            // Bật trục xương debug
window.__game.vm.butterfly.playTrick('inspect', false);   // Chạy trọn 1 vòng inspect (như ấn F 1 lần)
```

---

## 4. Pipeline Tối Ưu Hóa Model 3D (.glb) & Hướng Dẫn Thêm Skin Mới

### 4.1. Tại sao cần tối ưu hóa & Kết quả đạt được

Trước khi tối ưu, 12 file `.glb` nặng tổng cộng **257.60 MB** (riêng bộ CS2 từ 30–53.7 MB/khẩu) do nhúng texture PNG `4096×4096` chưa nén (~256 MB VRAM/khẩu khi giải nén kèm mipmap) và chứa tới 27–58 animation thừa không dùng đến. Việc giải mã PNG 4K + upload 256 MB texture + biên dịch shader PBR đồng bộ trên 1 frame gây tải lâu và đứng/lag máy ngay sau khi load xong.

Sau khi áp dụng pipeline tối ưu (`tools/optimize-weapons.mjs` + `js/glb-loader.js`):
- **Tổng dung lượng kho súng**: **257.60 MB → 10.72 MB (giảm 95.8%)**.
- **Hình học (Geometry)**: giữ nguyên **100% số đỉnh, số tam giác và tọa độ thực** (`maxDiff = 0.00e+0`), **không giảm đa giác**.
- **VRAM mỗi khẩu CS2**: giảm 4–6× (~256 MB → ~40–64 MB).
- **Chất lượng hình ảnh**: giữ nguyên độ sắc nét PBR ở 1080p/1440p (WebP `2048×2048` q=90–92 cho Albedo/Normal/Emissive; `1024×1024` cho Roughness/Metallic/AO).
- **Bản gốc**: tự động sao lưu tại `_backup_glb/` (đã thêm vào `.gitignore`, không đẩy lên Git).

| File `.glb` | Trước | Sau | Giảm | Animations giữ lại |
| :--- | ---: | ---: | ---: | :--- |
| `assets/skins/cs2/ak47-cs2.glb` | 53.70 MB | **1.19 MB** | -97.8% | 58 → 5 (`draw, idle, fire, reload, inspect`) |
| `assets/skins/cs2/awp-cs2.glb` | 48.25 MB | **1.20 MB** | -97.5% | 27 → 5 |
| `assets/skins/cs2/deagle-cs2.glb` | 45.91 MB | **0.84 MB** | -98.2% | 57 → 5 |
| `assets/skins/cs2/usps-cs2.glb` | 44.34 MB | **0.79 MB** | -98.2% | 53 → 5 |
| `assets/skins/cs2/m4a1s-cs2.glb` | 30.22 MB | **2.20 MB** | -92.7% | 5 → 5 |
| `assets/skins/vandal/vandal-rgx.glb` | 10.72 MB | **1.00 MB** | -90.7% | 10 → 5 |
| `assets/skins/vandal/vandal-default.glb` | 10.03 MB | **0.74 MB** | -92.6% | 10 → 5 |
| `assets/skins/vandal/vandal-forsaken.glb` | 8.38 MB | **1.00 MB** | -88.0% | 10 → 5 |
| `assets/awp-dragon-lore.glb` | 4.11 MB | **1.18 MB** | -71.3% | 5 → 5 |
| `assets/butterfly-viewmodel.glb` | 1.31 MB | **0.34 MB** | -74.0% | 6 → 6 (`draw, idle, slash_1, slash_2, heavy, inspect`) |
| `assets/butterfly-knife.glb` | 0.58 MB | **0.22 MB** | -62.2% | 0 |
| `assets/karambit.glb` | 0.03 MB | **0.03 MB** | -1.2% | 0 |

### 4.2. Kiến Trúc Tải & Chống Lag Runtime

1. **Shared Loader & MeshoptDecoder (`js/glb-loader.js`, `vendor/addons/libs/meshopt_decoder.module.js`)**:
   - Dùng duy nhất 1 singleton `GLTFLoader` gắn `MeshoptDecoder` (~25 KB, hoạt động offline) và bộ đệm `ArrayBuffer` dùng chung giữa `ViewModel`, `CollectionPreview3D` và `Avatar` (không tải mạng 2 lần cùng 1 URL).
2. **Async GPU Warm-up (`warmUpModel()` trong `js/glb-loader.js`)**:
   - Trước khi bật `root.visible = true`, tự động upload từng texture rải đều **1 texture / frame** (`renderer.initTexture(tex)`) và gọi `await renderer.compileAsync(root, camera, scene)` để biên dịch shader bất đồng bộ → loại bỏ hoàn toàn cú khựng frame sau khi load.
3. **Lazy-Load, Lobby Idle Preload & Quản Lý VRAM LRU**:
   - `ViewModel` và `ButterflyController` không còn tải sẵn các model không được trang bị lúc boot.
   - Khi vào sảnh Lobby (`js/main.js`), trình duyệt dùng `requestIdleCallback` tải trước âm thầm đúng súng chính, súng phụ (và dao nếu trang bị) để lúc bấm **VÀO TRẬN** xuất hiện ngay lập tức.
   - `ViewModel` giữ tối đa **4 model** trên GPU, `CollectionPreview3D` giữ tối đa **3 model** trên GPU; model cũ hơn tự động bị giải phóng bằng `disposeObject3D()`.
4. **HTTP Caching & Streaming (`server/server.js`)**:
   - Dùng `fs.createReadStream` thay cho `fs.readFile`, trả về `ETag`, `Last-Modified`, hỗ trợ **`304 Not Modified`** và `Cache-Control: public, max-age=604800, stale-while-revalidate=86400` cho `.glb`, `.bin`, `.png`, `.webp`, `.wasm`.

### 4.3. Quy Trình Chuẩn 5 Bước Khi Thêm Skin Súng 3D Mới

Mỗi khi thêm một skin `.glb` mới vào game, làm đúng 5 bước sau để đảm bảo **tải nhanh, không lag và không lỗi hiển thị trong Collection**:

1. **Chuẩn bị file `.glb` từ Blender**:
   - Đảm bảo có đủ 5 clip NLA (60 FPS) đặt đúng tên: `draw`, `idle`, `fire`, `reload`, `inspect` (với dao cận chiến là `draw`, `idle`, `slash_1`, `slash_2`, `heavy`, `inspect`).
   - Vật liệu tay áo và da tay đặt tên chính xác là `SleeveMat` và `SkinMat` để `ViewModel` tự đồng bộ màu áo người chơi và `CollectionPreview3D` tự ẩn tay khi xoay 360°.
   - Đặt file `.glb` vào `assets/skins/<nhom>/<ten-skin>.glb` và ảnh thumbnail PNG nền trong suốt (`512×256`) vào `assets/skins/thumbs/<ten-skin>.png`.

2. **Đăng ký vào script tối ưu `tools/optimize-weapons.mjs`**:
   - Mở `tools/optimize-weapons.mjs` và thêm 1 dòng vào mảng `TARGETS`:
     ```js
     { rel: 'assets/skins/vandal/vandal-new-skin.glb', clips: GUN_CLIPS },
     ```
   - **Lưu ý kỹ thuật cực kỳ quan trọng**: **KHÔNG BAO GIỜ** bật `quantize()` trên các model súng `SkinnedMesh`. `quantize()` chuẩn hóa `POSITION` về `[-1, 1]` và bù tỉ lệ vào `inverseBindMatrices` của bộ xương — khi `CollectionPreview3D._extractCleanStaticModel()` hoặc `avatar.js` tách mesh tĩnh (bỏ bộ xương), các bộ phận nhỏ như băng đạn/khóa nòng sẽ bị phóng to bất thường. Script `optimize-weapons.mjs` đã khóa sẵn chế độ nén `EXTMeshoptCompression.EncoderMethod.FILTER` (lossless, giữ nguyên 100% tọa độ thực).

3. **Chạy tối ưu hóa (tự động backup bản gốc vào `_backup_glb/`)**:
   ```bash
   # Chỉ cần cài 1 lần duy nhất nếu chưa có tools/node_modules:
   npm install --prefix tools

   # Chạy tối ưu toàn bộ danh sách TARGETS (script tự đọc từ _backup_glb/ cho file cũ):
   node tools/optimize-weapons.mjs
   ```
   - Kiểm tra log đầu ra: xác nhận `tris:OK` và danh sách `anims` đủ 5 clip `[draw,fire,idle,inspect,reload]`.

4. **Khai báo skin trong `js/skins.js`**:
   - Thêm object skin vào `CUSTOM_SKINS[<weaponId>]` (trỏ `glb` và `thumb` tới file vừa thêm, đặt `tier` là `standard | select | deluxe | premium | exclusive`, `ownedByDefault: true/false`).

5. **Kiểm tra trên trình duyệt**:
   - Nhấn **`Ctrl + Shift + R`** (hard reload) để bỏ cache cũ.
   - Mở **Bộ Sưu Tập · Skins** xoay 360° kiểm tra tỉ lệ thân súng, băng đạn, vật liệu PBR (nhấn `/` gõ `/admin dev` rồi `/unlock all` nếu skin đang bị khóa).
   - Bấm **VÀO TRẬN**, chọn súng (phím `B`), kiểm tra đủ 5 hoạt ảnh: rút súng, đứng yên, bắn, nạp đạn (`R`), soi súng (`F`).

---

## 5. Lưu Ý Khi Chạy Game Ở Máy Local

- **Không mở trực tiếp `index.html` bằng `file:///`**: trình duyệt chặn `<script type="module">` và `fetch()` tới các file `.glb` (`assets/awp-dragon-lore.glb`, `assets/butterfly-viewmodel.glb`) do chính sách CORS khiến màn hình tải dừng ở 0%.
- **Cách chạy chuẩn**: Khởi động một HTTP server trong thư mục gốc dự án rồi truy cập `http://localhost:8787`:
  - Bằng Python: `python -m http.server 8787`
  - Hoặc bằng Node.js relay server (hỗ trợ cả WebSocket nội bộ): `cd server && npm install && node server.js`
