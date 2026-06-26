import crypto from "node:crypto";
import fs from "node:fs";
import { KEYFILE_PATH, readJSON, writeJSON } from "./config.js";

// ===== Quan ly master key =====
// Master key (32 byte) duoc sinh ngau nhien 1 lan, roi BOC LAI (wrap) bang khoa
// suy ra tu mat khau nguoi dung (scrypt). Tren dia chi luu ban da ma hoa.
// Nho vay file/block tren Drive deu ma hoa bang master key, va master key chi
// mo duoc khi co dung mat khau.

interface KeyFile {
  salt: string;      // base64 - salt cho scrypt
  iv: string;        // base64 - iv khi boc master key
  authTag: string;   // base64
  wrapped: string;   // base64 - master key da ma hoa
}

function deriveKEK(password: string, salt: Buffer): Buffer {
  // scrypt: cham co chu dich -> chong do mat khau.
  // Phai set maxmem vi N=2^15,r=8 can ~32MB, vuot gioi han mac dinh 32MB cua Node.
  return crypto.scryptSync(password, salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
}

export function keyfileExists(): boolean {
  return fs.existsSync(KEYFILE_PATH);
}

// Che do KHONG mat khau: tu tao (hoac doc lai) master key luu thang ra dia.
// Dung de bo qua buoc nhap mat khau. File van duoc ma hoa bang key nay.
export function ensureKeyNoPassword(): Buffer {
  const existing = readJSON<any>(KEYFILE_PATH, null);
  if (existing && existing.raw) return Buffer.from(existing.raw, "base64");
  const masterKey = crypto.randomBytes(32);
  writeJSON(KEYFILE_PATH, { raw: masterKey.toString("base64") });
  return masterKey;
}

// Tao master key moi, boc bang mat khau, luu ra dia.
export function initMasterKey(password: string): Buffer {
  const masterKey = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  const kek = deriveKEK(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const kf: KeyFile = {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    wrapped: wrapped.toString("base64"),
  };
  writeJSON(KEYFILE_PATH, kf);
  return masterKey;
}

// Mo khoa master key bang mat khau. Sai mat khau -> nem loi.
export function unlockMasterKey(password: string): Buffer {
  const kf = readJSON<KeyFile | null>(KEYFILE_PATH, null);
  if (!kf) throw new Error("Chua khoi tao khoa. Hay dat mat khau truoc.");
  const salt = Buffer.from(kf.salt, "base64");
  const kek = deriveKEK(password, salt);
  const iv = Buffer.from(kf.iv, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(Buffer.from(kf.authTag, "base64"));
  try {
    const masterKey = Buffer.concat([
      decipher.update(Buffer.from(kf.wrapped, "base64")),
      decipher.final(),
    ]);
    return masterKey;
  } catch {
    throw new Error("Sai mat khau.");
  }
}

// ===== Ma hoa / giai ma 1 block =====
export interface EncryptResult {
  data: Buffer;     // du lieu da ma hoa
  iv: string;       // base64
  authTag: string;  // base64
  sha256: string;   // checksum cua du lieu GOC
}

export function encryptBlock(masterKey: Buffer, plain: Buffer): EncryptResult {
  const sha256 = crypto.createHash("sha256").update(plain).digest("hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    data,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    sha256,
  };
}

export function decryptBlock(
  masterKey: Buffer,
  data: Buffer,
  iv: string,
  authTag: string,
  expectedSha256?: string
): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  if (expectedSha256) {
    const got = crypto.createHash("sha256").update(plain).digest("hex");
    if (got !== expectedSha256) throw new Error("Checksum khong khop - block bi hong.");
  }
  return plain;
}
