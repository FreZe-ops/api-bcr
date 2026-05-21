# Deploy scratch-data API lên VPS (hướng dẫn ngắn gọn)

Stack: **Node.js (Express)**, **MongoDB**, **Socket.IO**, **Playwright (Firefox)**. Port mặc định API: **3201** (đổi bằng `SERVER_PORT` trong `.env`).

---

## 1. Chuẩn bị VPS

- **OS**: Ubuntu 22.04/24.04 LTS (khuyến nghị).
- **RAM**: tối thiểu **2 GB** (Playwright + browser; nhiều session thì nên **4 GB+**).
- Mở firewall/security group cho port API (ví dụ `3201`), hoặc chỉ mở `80/443` nếu dùng Nginx reverse proxy.

---

## 2. Cài Node.js (LTS)

```bash
# Ví dụ Node 20 LTS (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

---

## 3. MongoDB

Chọn một trong hai:

- **MongoDB Atlas**: tạo cluster, lấy connection string → gán vào `URL_CONNECT_MONGODB` trong `.env`.
- **Cài trên VPS**: cài MongoDB Community, tạo user/DB, dùng URI dạng `mongodb://user:pass@127.0.0.1:27017/ten_db`.

Không có MongoDB hợp lệ thì app vẫn chạy nhưng thao tác DB/API phụ thuộc DB sẽ lỗi.

---

## 4. Thư viện hệ thống cho Playwright (bắt buộc nếu chạy session/crawl)

Sau khi đã có `node_modules` (bước 6), trên thư mục project:

```bash
cd /path/to/tool-baccarat-v2-scratch-data
sudo npx playwright install-deps
npx playwright install firefox
```

Nếu thiếu package hệ thống, Playwright thường báo rõ tên gói `apt` cần cài — cài thêm theo gợi ý đó.

---

## 5. Đưa source lên VPS

- **Git**: `git clone ...` rồi `cd tool-baccarat-v2-scratch-data`
- Hoặc **zip/scp/rsync** từ máy dev lên VPS (nhớ **không** commit file `.env` chứa secret).

---

## 6. Cấu hình `.env`

Copy từ máy dev (hoặc tạo mới) file `.env` cạnh `server.js`. Các biến quan trọng:

| Biến | Ý nghĩa |
|------|--------|
| `URL_CONNECT_MONGODB` | Chuỗi kết nối MongoDB (bắt buộc cho DB) |
| `SERVER_PORT` | Port HTTP (mặc định `3201` nếu không set) |
| `SERVER_HOSTNAME` | URL gốc tới server Socket.IO, ví dụ `http://IP_VPS` hoặc `http://127.0.0.1` (worker session dùng kết hợp với `SERVER_PORT`) |
| `URI_REQUEST_DATA` | Base URL gọi lấy dữ liệu (code ghép `+ sessionId`) |
| `JWT_SECRET` | Secret ký/verify JWT cho các route `/predict`, `/NH` |
| `LOGS_SERVER_SEXY` | Tên log (hiện code chủ yếu in `console`; giữ biến để tương thích) |

Các biến selector Puppeteer/Playwright (`DOMAIN`, `USER_AGENT`, `CLOSE_DIALOG_WELCOME`, …) — giữ đúng như môi trường đang chạy ổn trên máy dev.

---

## 7. Cài dependency và chạy API

```bash
cd /path/to/tool-baccarat-v2-scratch-data
npm install
```

**Production**: dùng `node` trực tiếp (script `npm start` trong repo đang gọi **nodemon** — phù hợp dev, không nên làm process chính trên VPS).

```bash
node server.js
```

Kiểm tra log có dạng: `Running server http://localhost:3201` (port theo `.env`).

**Giữ process chạy nền (đơn giản, ổn định)** — cài PM2:

```bash
sudo npm install -g pm2
pm2 start server.js --name scratch-data-api
pm2 save
pm2 startup   # làm theo hướng dẫn in ra để tự chạy khi reboot
```

---

## 8. Kiểm tra nhanh

- Từ máy khác: `curl -sS http://IP_VPS:3201/` (nếu có route/static; không có thì có thể nhận 404 nhưng chứng tỏ server đã lắng nghe).
- API REST có JWT: ví dụ prefix `/predict`, `/NH` — cần header/token đúng như client đang dùng.

---

## 9. (Tuỳ chọn) Nginx reverse proxy

Nếu muốn domain + HTTPS: Nginx `proxy_pass` tới `http://127.0.0.1:3201`, cấu hình WebSocket upgrade cho Socket.IO (`Upgrade`, `Connection` headers). Chi tiết tùy domain/chứng chỉ (Let’s Encrypt).

---

## Gỡ lỗi thường gặp

| Hiện tượng | Hướng xử lý |
|------------|-------------|
| Playwright/Firefox không chạy | Chạy lại `sudo npx playwright install-deps` và `npx playwright install firefox` |
| Lỗi kết nối MongoDB | Kiểm tra `URL_CONNECT_MONGODB`, firewall MongoDB, user/password |
| Client không kết nối Socket.IO được | `SERVER_HOSTNAME` phải là URL mà **máy chạy browser** truy cập được tới VPS (IP public hoặc domain), đúng `http`/`https` và port (hoặc qua proxy) |
| Port không vào được | Mở port trên cloud firewall + `ufw` (nếu dùng) |

---

File entry chính: `server.js`. Router API: `/predict`, `/NH` (xem `routers/index.js`).
