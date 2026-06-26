# Mount Driver Cloud thành ổ đĩa (WebDAV)

Biến kho lưu trữ (gộp nhiều Drive + mã hóa) thành **một ổ đĩa** trong File Explorer / Finder.
Dùng **WebDAV** có sẵn trong hệ điều hành → **KHÔNG cần cài WinFsp/macFUSE/driver nào**.

## 1. Chạy server WebDAV
```bash
npm run webdav
# -> http://localhost:4000  (dung chung du lieu ~/.driver-cloud nhu app desktop)
```
Giữ cửa sổ này chạy. (Đổi cổng: `DAV_PORT=5000 npm run webdav`.)

## 2A. Windows — map thành ổ đĩa
1. Mở **services.msc** → đảm bảo dịch vụ **WebClient** đang **Running** (nếu chưa: chuột phải → Start; đặt Startup type = Automatic).
2. File Explorer → **This PC** → **Map network drive** → Folder: `http://localhost:4000` → **Finish**.
   → Hiện thành ổ (vd **Z:**), mở file trực tiếp như ổ đĩa thường.

> ⚠️ Windows giới hạn kích thước tải qua WebDAV (~50MB) theo registry. Để tải/mở file lớn:
> regedit → `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters` →
> `FileSizeLimitInBytes` = `ffffffff` (hex) → restart dịch vụ WebClient.

## 2B. macOS — Connect to Server
Finder → **Go → Connect to Server** (⌘K) → `http://localhost:4000` → **Connect** → Guest.
→ Hiện trong Finder như một ổ mạng.

## 2C. Linux
`gio mount dav://localhost:4000/` hoặc dùng davfs2.

## Làm được gì trên ổ này
- ✅ Duyệt thư mục, xem danh sách file (đã giải mã tên/size).
- ✅ Mở / đọc file (tự tải + giải mã qua engine, hỗ trợ tua video).
- ✅ Tạo thư mục, đổi tên, di chuyển, xóa.
- ✅ Copy file VÀO ổ = upload lên pool (chia + mã hóa tự động).

## Hạn chế hiện tại
- Mỗi máy chạy `npm run webdav` riêng (dùng dữ liệu local `~/.driver-cloud`).
- Ghi file = upload toàn bộ file (không ghi sửa từng phần) — phù hợp lưu trữ.
- Client WebDAV của Windows đôi khi “khó tính” với file rất lớn (xem chỉnh registry ở trên).

## Sắp tới (tùy chọn)
- Nút **"Mount ổ đĩa"** ngay trong app desktop (tự chạy WebDAV + map sẵn), không cần dòng lệnh.
