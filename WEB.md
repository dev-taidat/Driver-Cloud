# Driver Cloud — Bản Web

Server web tái dùng toàn bộ engine (gộp account, không chia file, mã hóa, thùng rác,
thư mục, preview). Code ở [src/web/](src/web/).

## Chạy thử trên máy (localhost)

```bash
npm install
WEB_PASSWORD=matkhaucuaban npm run web
# Mo trinh duyet: http://localhost:3000
```

- `WEB_PASSWORD`: mật khẩu đăng nhập web (nếu không đặt, server in ra 1 mật khẩu tạm).
- Đăng nhập → bấm ⚙️ → **＋ Thêm tài khoản Google** để kết nối acc (qua OAuth).

> Chạy localhost dùng được luôn OAuth client **Desktop** hiện tại (Google cho phép loopback).

## Deploy online (vào từ mọi nơi) — 3 việc bạn phải làm

### 1. Tạo OAuth client loại **Web application**
Google Cloud Console → **Clients** → Create client → **Web application**:
- **Authorized redirect URIs**: thêm `https://TÊN-MIỀN-CỦA-BẠN/oauth/callback`
- Lấy Client ID/Secret mới, ghi vào `~/.driver-cloud/oauth_client.json` **trên server**.

### 2. Deploy lên 1 host chạy Node 18+ (VD: Render, Railway, VPS)
Đặt biến môi trường:
```
BASE_URL=https://TÊN-MIỀN-CỦA-BẠN      # bắt buộc, để Google redirect đúng
WEB_PASSWORD=mat-khau-manh             # bắt buộc
PORT=3000                              # hoặc theo host
```
Lệnh chạy: `npm install && npm run web`

### 3. Kết nối lại các tài khoản trên server
Dữ liệu (token, khóa, metadata) nằm ở `~/.driver-cloud/` **trên server**, tách biệt với máy
cá nhân. Lần đầu deploy là trống → đăng nhập web → ⚙️ → Thêm từng acc Google lại.
(Hoặc copy thư mục `~/.driver-cloud/` từ máy bạn lên server nếu muốn giữ nguyên dữ liệu cũ.)

## ⚠️ Cảnh báo bảo mật (QUAN TRỌNG)
- Server giữ **refresh_token + khóa mã hóa** của tất cả acc. Ai chiếm được server = chiếm
  toàn bộ 5 acc 30TB. → Dùng host riêng tin cậy, HTTPS, mật khẩu mạnh, không chia sẻ link.
- Mọi file upload/download đều **đi qua server** (user → server → Drive), nên băng thông và
  tốc độ phụ thuộc server. File lớn sẽ tốn băng thông server gấp đôi.

## Hạn chế bản web hiện tại (v1)
- Tìm kiếm chỉ trong thư mục đang mở (chưa tìm toàn bộ).
- Chưa có thanh tiến trình cho tải về (trình duyệt tự tải).
- Chưa hỗ trợ nhiều người dùng (1 mật khẩu chung).
