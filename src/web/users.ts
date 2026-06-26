import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Thu muc goc luu du lieu server (co the doi qua DATA_ROOT khi deploy)
export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "server-data");
const USERS_FILE = path.join(DATA_ROOT, "users.json");

export interface User {
  id: string;
  username: string;
  salt: string;
  hash: string;
  createdAt: string;
}

function readUsers(): User[] {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return []; }
}
function writeUsers(users: User[]): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPw(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString("hex");
}

// Thu muc du lieu RIENG cua moi user (chua accounts/metadata/keyfile/oauth_client)
export function userDir(userId: string): string {
  return path.join(DATA_ROOT, "u", userId);
}

export function findByUsername(username: string): User | undefined {
  return readUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
}
export function findById(id: string): User | undefined {
  return readUsers().find((u) => u.id === id);
}

export function register(username: string, password: string): User {
  username = username.trim();
  if (username.length < 3) throw new Error("Tên đăng nhập tối thiểu 3 ký tự.");
  if (password.length < 4) throw new Error("Mật khẩu tối thiểu 4 ký tự.");
  if (findByUsername(username)) throw new Error("Tên đăng nhập đã tồn tại.");
  const salt = crypto.randomBytes(16).toString("hex");
  const user: User = {
    id: crypto.randomUUID(),
    username,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString(),
  };
  const users = readUsers();
  users.push(user);
  writeUsers(users);
  fs.mkdirSync(userDir(user.id), { recursive: true });
  return user;
}

export function verify(username: string, password: string): User | null {
  const u = findByUsername(username);
  if (!u) return null;
  const h = hashPw(password, u.salt);
  // so sanh an toan
  if (h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return u;
  return null;
}
