# Chế độ "Ở lại trường vào buổi tối"

Bản demo theo đặc tả `newmod.md`: co-op 2–5 người, góc nhìn thứ nhất, proximity voice, 5 task
chuyên ngành và "ma" giả ngoại hình + giọng thật của người chơi.

Mở `night/` trên GitHub Pages (hoặc bất kỳ web tĩnh HTTPS nào). Không cần server riêng.

## Khác với kiến trúc đề xuất trong spec (mục 4) và lý do

Spec đề xuất 3 tiến trình chạy localhost (client Vite + game-server FastAPI + ai-service).
Yêu cầu sau đó là chơi online với bạn bè, không localhost, nên bản này chuyển mọi thứ vào trình duyệt:

| Spec | Bản này | Đánh đổi |
| --- | --- | --- |
| `game-server` FastAPI, 20 tick/s | `js/host.js` chạy trong tab của **người tạo phòng**, 20 tick/s | Chủ phòng tắt tab là hết trận (chưa có chuyển host). Vị trí người chơi do client gửi lên (co-op với bạn bè nên chấp nhận). |
| WebSocket tới game-server | MQTT công cộng (signaling, danh sách phòng, dự phòng) + WebRTC data channel | Broker công cộng giới hạn ~10 tin/s mỗi client, nên đường dự phòng chỉ gửi gộp 8 lần/s. |
| `ai-service` faster-whisper + sentence-transformers | `js/asr-worker.js`: transformers.js (Whisper + `paraphrase-multilingual-MiniLM-L12-v2`) trong Web Worker | Lần đầu tải ~210–400 MB mô hình (trình duyệt cache lại). Máy có WebGPU dùng whisper-small; không có thì whisper-base trên CPU (kém chính xác hơn với tiếng Việt). |
| Kho clip trên server | Clip nằm trong RAM của các tab cùng phòng; metadata + hàm điểm ở host | Mất khi đóng tab (đúng yêu cầu "xoá khi phiên kết thúc"). |
| Silero VAD (`@ricky0123/vad-web`) | VAD theo năng lượng có ngưỡng thích nghi (`voice.js`) | Ít chống nhiễu hơn Silero; đoạn nhiễu không ra chữ sau ASR thì bị bỏ. |
| Vite + TypeScript | JS thuần, dùng lại three.js, physics, avatar của game chính | Không có kiểm tra kiểu tĩnh, nhưng không cần bước build. |

Mỗi client tự nhận dạng giọng của chính mình rồi gửi chữ + vector cho host; host tự gắn ngữ cảnh
(phòng, task, người ở gần, `heard_by_ghost`) từ trạng thái game của nó.

## Chạy thử

- Online: mở trang, tạo phòng, gửi mã 5 ký tự hoặc link mời cho bạn bè. Tối đa 5, đủ 2 người là bắt đầu.
- Máy mình: `python3 -m http.server 8000` ở thư mục gốc repo, mở `http://localhost:8000/night/`.
- `?debug=1`: hiện nút "Chơi một mình (test)" (ma giả dạng chính bạn, bỏ điều kiện đi lẻ khi sinh ma)
  và bảng debug F1 (trạng thái ma, kho clip, top-3 điểm S(c), tua nhanh thời gian).
- `?cfg=R_HEAR:15,T_ALONE:10,KNOWLEDGE_RULE:false`: ghi đè tham số (chủ phòng đặt là đủ, xem `js/config.js`).

## Điều khiển

WASD đi · Shift chạy · C hoặc Ctrl cúi · F đèn pin · E tương tác · 1 tay không · 2 cầm súng ·
chuột trái bắn · V push-to-talk (bật trong menu Esc; mặc định mic luôn mở) · Esc tạm dừng.

## Tệp

| Tệp | Nội dung |
| --- | --- |
| `js/config.js` | Toàn bộ tham số mục 11 |
| `js/map.js` | Bản đồ khối 1 tầng, lưới 0.5 m dùng cho va chạm, tìm đường A*, tầm nhìn, che chắn âm |
| `js/net.js` | MQTT + WebRTC mesh (audio + data channel) |
| `js/host.js` | Trạng thái game có thẩm quyền, máy trạng thái của ma, điều kiện bắt, hàm điểm |
| `js/clips.js` | Intent theo từ khoá (8.3), hàm điểm S(c) (8.4) |
| `js/tasks-logic.js` / `js/tasks-ui.js` | 5 task: sinh đề, chấm (host) / mini-game overlay (client) |
| `js/voice.js` | Mic, VAD, PannerNode HRTF + lowpass che chắn, phát giọng ma, hiệu ứng |
| `js/asr-worker.js` | Whisper + embedding trong trình duyệt |

## Giới hạn đã biết

- Không có TURN server: hai người sau NAT đối xứng (một số mạng 4G/công ty) có thể không nối P2P
  được. Khi đó dữ liệu game đi đường MQTT (chậm hơn) nhưng **không nghe được giọng nhau**.
- Chủ phòng nên dùng máy khoẻ nhất và không thu nhỏ trình duyệt quá lâu.
- Đáp án task dùng bảng tra đơn giản hoá (ghi ở đầu `tasks-logic.js`).
