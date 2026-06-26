# Driver Cloud — Bản Web (SaaS nhiều người dùng)

Server web tái dùng toàn bộ engine (gộp account, không chia file, mã hóa, thùng rác,
thư mục, preview). Code ở [src/web/](src/web/). Đã deploy mẫu trên Railway.

## Tính năng
- **Đăng ký / Đăng nhập** bằng username + email (login bằng username hoặc email).
- Mỗi user có **kho riêng** (Drive accounts + dữ liệu tách biệt). Đồng bộ qua server.
- **Kết nối nhiều Google Drive** (BYO OAuth, có hướng dẫn setup console trong app).
- Thư mục, upload kéo-thả + **hủy**, mã hóa, **thùng rác** (API Google thật), thumbnail ảnh,
  **xem ảnh/video trong app**, tải về, **tìm kiếm toàn bộ**.
- 👥 **Chia sẻ dữ liệu**: chia sẻ cả kho hoặc 1 thư mục cho user khác (xem / sửa).
- 👨‍👩‍👧 **Family — nhiều Farm**: tạo nhiều farm (nhóm lưu trữ), trong mỗi farm **cấp X GB**
  cho từng thành viên (kho riêng của họ, bạn không thấy file họ). **Chặn quota ngay** khi vượt.
  Quản lý: tạo/đổi tên/xóa farm, sửa hạn mức, xem đã dùng từng người.
- 🔔 **Thông báo** (chuông + badge) khi được chia sẻ / cấp dung lượng.
- Gợi ý username khi nhập, đổi username.

## Chạy thử trên máy (localhost)
```bash
npm install
npm run web
# Mo http://localhost:3000 -> Dang ky -> ⚙️ nhap OAuth (co huong dan) -> ket noi Drive
```
> Localhost dùng được OAuth client **Desktop** hiện tại (Google cho phép loopback). Khi
> đăng nhập gặp "unverified app" → Advanced → Go to Driver Cloud.

## Deploy online (Railway / VPS / Render)
1. Push code lên GitHub (đã có repo dev-taidat/Driver-Cloud).
2. Railway → New Project → GitHub Repository → chọn repo (đọc `Procfile` → `npm run web`).
3. **⚠️ Thêm Volume** mount `/data` + biến `DATA_ROOT=/data` (BẮT BUỘC — nếu không, redeploy
   mất sạch user + khóa mã hóa).
4. Settings → Networking → Generate Domain → đặt biến `BASE_URL=https://<domain>`.
5. Mỗi user tạo **OAuth Web client** với redirect `https://<domain>/oauth/callback`.

## Di chuyển dữ liệu từ desktop sang web (Import)
App desktop có dữ liệu ở `~/.driver-cloud`. Tạo file bundle gộp `oauth_client.json`,
`accounts.json`, `keyfile.json`, `metadata.json` → vào web ⚙️ → **Nhập dữ liệu từ máy (.json)**.

## ⚠️ Bảo mật
Server giữ refresh_token + khóa mã hóa của user → dùng host tin cậy, HTTPS, không lộ link.

## Còn lại (milestone riêng)
- **Mount ổ đĩa ảo** (hiện thành ổ đĩa/Finder như Google Drive File Stream) — cần
  WinFsp/macFUSE, là dự án riêng lớn.
