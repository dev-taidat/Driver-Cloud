# Driver Cloud

App desktop gộp nhiều tài khoản Google Drive (mỗi acc 30TB) thành **một pool lưu trữ
thống nhất**. File tự động **chia nhỏ (striping) qua nhiều account** theo dung lượng trống,
**mã hóa AES-256** trước khi tải lên, và **ghép lại** khi tải về.

## Tính năng

- ✅ Gộp nhiều account Google Drive thành 1 pool (xem tổng dung lượng)
- ✅ **File striping**: lấp đầy account này rồi tràn sang account khác; file nhỏ bỏ trọn vào acc còn chỗ thừa (best-fit)
- ✅ **Mã hóa AES-256-GCM** từng block, khóa bảo vệ bằng mật khẩu (file trên Drive không đọc được nếu không có app + mật khẩu)
- ✅ **Checksum SHA-256** mỗi block — phát hiện dữ liệu hỏng khi tải về
- ✅ **Resume**: upload dở dang → mở lại bỏ qua block đã xong
- ✅ Upload/Download **song song nhiều account** → tốc độ cao
- ✅ Giao diện kéo-thả + thanh tiến trình
- ✅ **File cài đặt .exe** — cài lên máy nào cũng được, dữ liệu/khóa nằm riêng từng máy

## Cài đặt cho người dùng cuối

File cài đặt: **`release/Driver-Cloud-Setup-0.1.0.exe`** — chạy là cài như app bình thường.
Toàn bộ cấu hình/khóa/metadata lưu ở `%USERPROFILE%\.driver-cloud\` trên *từng máy*,
KHÔNG đi kèm trong bộ cài → cài máy khác không lộ file của bạn.

### Lần đầu mở app
1. **Nhập Google OAuth Client ID/Secret** (xem mục dưới) — 1 lần.
2. **Đặt mật khẩu mã hóa** — nhớ kỹ, **quên = mất dữ liệu**.
3. Bấm **+ Thêm** để đăng nhập từng tài khoản Google Drive.
4. Kéo-thả file vào để tải lên.

## Tạo OAuth Client (bắt buộc, 1 lần)

Cách *đúng* để có token vĩnh viễn + tốc độ cao (không cào trình duyệt):

1. https://console.cloud.google.com → tạo project.
2. **APIs & Services → Enable APIs** → bật **Google Drive API**.
3. **OAuth consent screen** → **External** → thêm tất cả email Drive vào **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
5. Lấy **Client ID** + **Client Secret**, nhập vào màn hình đầu của app.

> 1 client dùng chung cho mọi account.

## Dành cho lập trình viên

```bash
npm install
npm run dev          # chay app o che do phat trien (build + electron)
npm run dist         # tao file cai dat .exe trong thu muc release/
npm run cli -- ls    # CLI (can DCLOUD_PASSWORD=...)
```

### Kiến trúc

```
renderer/ (UI)  <--IPC-->  electron-main.cjs (main process)
                                  |
        uploader / downloader  (chia block, ma hoa, song song, resume)
                                  |
        allocator (planBlocks)  <- thuat toan phan bo theo dung luong trong
        crypto    (AES-256-GCM + scrypt + sha256)
        accounts (quota) + metadata (map file -> [block@account...])
                                  |
                 Google Drive API v3 (moi account 1 OAuth)
```

File chính:
- `src/allocator.ts` — logic chia file
- `src/crypto.ts` — mã hóa + quản lý khóa bằng mật khẩu
- `src/uploader.ts` / `src/downloader.ts` — engine truyền song song + resume
- `electron-main.cjs` — main process Electron (nạp engine ESM qua dynamic import)
- `renderer/` — giao diện

## Giới hạn Google (phải biết)

| Giới hạn / account / ngày | Con số |
|---|---|
| Upload | ~750 GB |
| Download | ~10 TB |
| API rate | ~12.000 req/phút |

Chia file qua nhiều account giúp **vượt giới hạn 750GB/ngày một cách hợp lệ**.

## Còn có thể nâng cấp

- True resumable upload theo session URI của Drive (hiện resume ở mức block)
- Thư mục/đổi tên trong app, tìm kiếm
- Đồng bộ metadata giữa nhiều máy (hiện metadata theo từng máy)
- Icon riêng + ký số installer (hiện chưa ký → Windows SmartScreen có thể cảnh báo)
