import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Thu muc cau hinh & du lieu cua app (~/.driver-cloud)
export const DATA_DIR = path.join(os.homedir(), ".driver-cloud");
export const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json");
export const METADATA_PATH = path.join(DATA_DIR, "metadata.json");
export const OAUTH_CLIENT_PATH = path.join(DATA_DIR, "oauth_client.json");

// Scope chi can quyen quan ly file do CHINH APP tao ra (an toan nhat).
// Neu muon thay/quan ly file co san trong Drive thi doi sang "drive".
export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Cong loopback cho OAuth redirect
export const OAUTH_PORT = 53682;
export const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/callback`;

// De an toan, chua bao gio dung het 100% quota cua account.
// Giu lai mot khoang trong (margin) tren moi account.
export const FREE_SPACE_MARGIN = 100 * 1024 * 1024; // 100 MB

// Kich thuoc moi BLOCK khi chia file. File se duoc cat thanh nhieu block co
// kich thuoc nay (block cuoi co the nho hon). Block la don vi upload/ma hoa/resume.
export const BLOCK_SIZE = 256 * 1024 * 1024; // 256 MB

// So block upload/download song song cung luc (gioi han de khong qua tai)
export const CONCURRENCY = 4;

// Duong dan file luu master key (da ma hoa bang mat khau nguoi dung)
export const KEYFILE_PATH = path.join(DATA_DIR, "keyfile.json");

// Tra ve duong dan cac file du lieu trong MOT thu muc bat ky (per-user cho ban web).
// Mac dinh la DATA_DIR (~/.driver-cloud) cho ban desktop.
export function dataPaths(dir: string = DATA_DIR) {
  return {
    dir,
    accounts: path.join(dir, "accounts.json"),
    metadata: path.join(dir, "metadata.json"),
    keyfile: path.join(dir, "keyfile.json"),
    oauthClient: path.join(dir, "oauth_client.json"),
  };
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(file: string, data: unknown): void {
  // Tao thu muc cha cua file neu chua co (ho tro thu muc per-user)
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
