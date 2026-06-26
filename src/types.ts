// Thong tin xac thuc cua 1 tai khoan Google da ket noi
export interface Account {
  id: string;          // dia chi email (dinh danh duy nhat)
  email: string;
  refreshToken: string;
  addedAt: string;
}

// Quota cua 1 account (lay tu Drive about.get)
export interface AccountQuota {
  account: Account;
  totalBytes: number;  // tong dung luong (vd 30TB)
  usedBytes: number;
  freeBytes: number;   // da tru margin an toan
}

// Mot block (manh co kich thuoc co dinh) cua file logic, nam tren 1 account.
// Block duoc ma hoa truoc khi upload; luu kem checksum & tham so giai ma.
export interface BlockRef {
  index: number;        // thu tu block trong file (0,1,2...)
  accountId: string;    // account dang giu block nay
  driveFileId: string | null; // id file tren Drive (null = chua upload xong -> de resume)
  plainSize: number;    // so byte goc (chua ma hoa) cua block
  sha256: string;       // checksum cua du lieu GOC (de kiem tra toan ven)
  iv: string;           // base64 IV cho AES-GCM
  authTag: string;      // base64 GCM auth tag
}

// Mot file logic ma nguoi dung thay (co the trai tren nhieu account)
export interface LogicalFile {
  id: string;          // uuid
  name: string;        // ten file goc
  path: string;        // duong dan day du (vd /Photos/file.zip)
  dir: string;         // thu muc cha (vd "/" hoac "/Photos")
  size: number;        // tong kich thuoc file goc
  blockSize: number;   // kich thuoc block dung khi chia file nay
  blocks: BlockRef[];  // danh sach block theo thu tu
  complete: boolean;   // true khi tat ca block da upload xong
  createdAt: string;
  trashed?: boolean;   // true = dang o thung rac
  trashedAt?: string;
  thumb?: string;      // data URI thumbnail (chi cho anh)
  grantId?: string;    // neu set: file nay thuoc kho duoc CAP cho 1 thanh vien (luu trong pool chu so huu)
}

// Ke hoach gan tung block vao account nao
export interface BlockPlan {
  index: number;
  accountId: string;
  start: number;       // offset byte trong file goc
  size: number;        // so byte goc cua block
}
