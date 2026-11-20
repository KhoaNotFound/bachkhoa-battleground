# Báo Cáo Kiến Trúc Dự Án, AWP Dragon Lore & Hệ Thống Animation Múa Dao Butterfly

**Dự án:** Bách Khoa Battleground  
**Công nghệ cốt lõi:** HTML5, CSS3, Vanilla ES Modules, Three.js (`v0.164.1`), Blender 5.3 NLA Rigging (`THREE.AnimationMixer`), Web Audio API, WebSocket (`ws`) & MQTT (`mqtt`)  
**Cập nhật lần cuối:** 20/11/2026

---

## 1. Sơ Đồ Cây Thư Mục & Công Dụng Từng Thành Phần

```text
bachkhoa-battleground/
├── index.html                  # Giao diện gốc: importmap Three.js, màn hình Loading, Sảnh (Lobby), HUD, Scope, Bảng điểm
├── style.css                   # Toàn bộ giao diện UI/UX (glassmorphism), tâm ngắm, thanh máu, slot vũ khí & icon SVG
├── README.md                   # Tài liệu giới thiệu game, phím điều khiển và kiến trúc mạng
├── server.json                 # Lưu URL Cloudflare Tunnel công khai của relay server (client tự đọc khi chơi online)
├── start-server.sh             # Script bash tự khởi chạy Node relay server + mở Cloudflare quick tunnel & cập nhật server.json
├── .gitignore                  # Bỏ qua file tạm/log/node_modules khi commit Git
│
├── assets/                     # Chứa tài nguyên 3D nhị phân glTF 2.0 (không nén Draco) cho trình duyệt
│   ├── awp-dragon-lore.glb     # CS:GO AWP Dragon Lore (~4.31 MB): Armature 8 xương, tay hộp chữ nhật, 2 texture nhúng & 5 clip NLA (draw, idle, fire, reload, inspect)
│   ├── butterfly-viewmodel.glb # Rig ViewModel dao Butterfly (~1.37 MB): Armature 23 xương, tay khối hộp chữ nhật & 6 clip NLA (draw, idle, slash_1, slash_2, heavy, inspect)
│   └── butterfly-knife.glb     # Mô hình 3D dao Valorant Champions Butterfly gốc (~594 KB) có 2 chốt bản lề SafePinPivot & BitePinPivot
│
├── js/                         # Toàn bộ mã nguồn client (ES Modules, không cần bước build)
│   ├── main.js                 # Điểm khởi chạy chính: game loop, input, điều khiển nhân vật, bắn/cận chiến, đồng bộ mạng
│   ├── butterfly.js            # Điều khiển dao Butterfly: nạp butterfly-viewmodel.glb qua THREE.AnimationMixer, vật lý 6-DOF Tầng 1 & clack audio đồng bộ frame
│   ├── viewmodel.js            # Scene góc nhìn thứ nhất (FOV 62°), PMREM studio lighting, quản lý 3 vũ khí & AnimationMixer cho AWP Dragon Lore
│   ├── physics.js              # Hệ va chạm AABB theo lưới 2D (CollisionWorld + 2D DDA raycast) & bộ di chuyển nhân vật (Mover)
│   ├── map.js                  # Dựng khuôn viên 3D ĐH Bách Khoa TP.HCM (268 Lý Thường Kiệt) bằng procedural geometry merging
│   ├── textures.js             # Sinh toàn bộ texture 2D bằng Canvas (mặt tiền, mái, sân bóng, sân bóng rổ, khuôn mặt, nametag, tia lửa)
│   ├── avatar.js               # Mô hình nhân vật góc nhìn thứ 3 (dùng AWP Dragon Lore clone + Butterfly 3rd-person), hitbox 3 vùng & hiệu ứng vỡ khối Debris
│   ├── hud.js                  # Quản lý HUD: minimap xoay theo hướng nhìn, thanh máu, đạn, hitmarker, killfeed, bảng điểm
│   ├── vfx.js                  # Hệ thống hạt (3000 hạt additive/normal), đường đạn tracer, chớp nòng, vết đạn decal, máu & vòng xung
│   ├── audio.js                # Bộ tổng hợp âm thanh 100% bằng Web Audio API (không dùng file mp3/wav), hỗ trợ âm thanh 3D HRTF
│   ├── net.js                  # Lớp mạng lai: ưu tiên WebSocket Relay Server và tự động fallback sang Public MQTT Broker
│   └── util.js                 # Hàm toán học & tiện ích (clamp, lerp, damp, góc xoay, PRNG mulberry32, escapeHtml)
│
├── server/                     # Backend nhẹ để relay dữ liệu multiplayer độ trễ thấp
│   ├── server.js               # HTTP static server (hỗ trợ .glb) + WebSocket room relay + cầu nối 2 chiều sang MQTT broker
│   ├── package.json            # Khai báo dependencies (ws, mqtt) và lệnh khởi chạy server
│   └── package-lock.json       # Khóa phiên bản chính xác các gói npm của server
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

### 3.3. Hướng Dẫn Debug, Slow-Motion & Kiểm Thử (`window.__game`)

```js
// Vào trận & kiểm tra AWP Dragon Lore (slot 2)
window.__game.spawn();
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

## 4. Lưu Ý Khi Chạy Game Ở Máy Local

- **Không mở trực tiếp `index.html` bằng `file:///`**: trình duyệt chặn `<script type="module">` và `fetch()` tới các file `.glb` (`assets/awp-dragon-lore.glb`, `assets/butterfly-viewmodel.glb`) do chính sách CORS khiến màn hình tải dừng ở 0%.
- **Cách chạy chuẩn**: Khởi động một HTTP server trong thư mục gốc dự án rồi truy cập `http://localhost:8787`:
  - Bằng Python: `python -m http.server 8787`
  - Hoặc bằng Node.js relay server (hỗ trợ cả WebSocket nội bộ): `cd server && npm install && node server.js`
