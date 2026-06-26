import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./users.js";

const FILE = path.join(DATA_ROOT, "notifications.json");

export interface Notif {
  id: string;
  userId: string;   // nguoi nhan
  message: string;
  read: boolean;
  createdAt: string;
}

function read(): Notif[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function write(list: Notif[]): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export function add(userId: string, message: string, when: string): void {
  const list = read();
  list.push({ id: crypto.randomUUID(), userId, message, read: false, createdAt: when });
  write(list);
}
export function listFor(userId: string): Notif[] {
  return read().filter((n) => n.userId === userId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function unreadCount(userId: string): number {
  return read().filter((n) => n.userId === userId && !n.read).length;
}
export function markAllRead(userId: string): void {
  const list = read();
  list.forEach((n) => { if (n.userId === userId) n.read = true; });
  write(list);
}
