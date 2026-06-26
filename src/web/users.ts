import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "server-data");
const USERS_FILE = path.join(DATA_ROOT, "users.json");

export interface User {
  id: string;
  username: string;
  email: string;
  salt: string;
  hash: string;
  createdAt: string;
  familyName?: string;
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

export function userDir(userId: string): string {
  return path.join(DATA_ROOT, "u", userId);
}

export function findByUsername(username: string): User | undefined {
  return readUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
}
export function findByEmail(email: string): User | undefined {
  return readUsers().find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
}
export function findById(id: string): User | undefined {
  return readUsers().find((u) => u.id === id);
}

export function register(username: string, email: string, password: string): User {
  username = (username || "").trim();
  email = (email || "").trim();
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) throw new Error("Username 3-20 ký tự, chỉ chữ/số/_/. (không dấu, không khoảng trắng).");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (password.length < 4) throw new Error("Mật khẩu tối thiểu 4 ký tự.");
  if (findByUsername(username)) throw new Error("Username đã tồn tại.");
  if (findByEmail(email)) throw new Error("Email đã được dùng.");
  const salt = crypto.randomBytes(16).toString("hex");
  const user: User = { id: crypto.randomUUID(), username, email, salt, hash: hashPw(password, salt), createdAt: new Date().toISOString() };
  const users = readUsers();
  users.push(user);
  writeUsers(users);
  fs.mkdirSync(userDir(user.id), { recursive: true });
  return user;
}

// Dang nhap bang username HOAC email
export function verify(usernameOrEmail: string, password: string): User | null {
  const id = (usernameOrEmail || "").trim();
  const u = findByUsername(id) || findByEmail(id);
  if (!u) return null;
  const h = hashPw(password, u.salt);
  if (h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash))) return u;
  return null;
}

export function setFamilyName(userId: string, name: string): void {
  const users = readUsers();
  const u = users.find((x) => x.id === userId);
  if (u) { u.familyName = (name || "").trim().slice(0, 40); writeUsers(users); }
}

// Doi username (cho tai khoan da ton tai)
export function setUsername(userId: string, newUsername: string): User {
  newUsername = (newUsername || "").trim();
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(newUsername)) throw new Error("Username 3-20 ký tự, chỉ chữ/số/_/.");
  const existing = findByUsername(newUsername);
  if (existing && existing.id !== userId) throw new Error("Username đã tồn tại.");
  const users = readUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new Error("Không tìm thấy tài khoản.");
  u.username = newUsername;
  writeUsers(users);
  return u;
}
