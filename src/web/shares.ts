import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./users.js";

const SHARES_FILE = path.join(DATA_ROOT, "shares.json");

export interface Share {
  id: string;
  ownerId: string;
  ownerUsername: string;
  targetId: string;
  targetUsername: string;
  type: "folder"; // hien tai chia se theo thu muc (bao gom "/" = ca kho)
  path: string;   // duong dan thu muc duoc chia se (vd "/" hoac "/Photos")
  permission: "view" | "edit";
  createdAt: string;
}

function read(): Share[] {
  try { return JSON.parse(fs.readFileSync(SHARES_FILE, "utf8")); } catch { return []; }
}
function write(list: Share[]): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(SHARES_FILE, JSON.stringify(list, null, 2));
}

export function createShare(s: Omit<Share, "id" | "createdAt">): Share {
  const list = read();
  // tranh trung: cung owner+target+path -> cap nhat quyen
  const existing = list.find(
    (x) => x.ownerId === s.ownerId && x.targetId === s.targetId && x.path === s.path
  );
  if (existing) {
    existing.permission = s.permission;
    write(list);
    return existing;
  }
  const share: Share = { ...s, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  list.push(share);
  write(list);
  return share;
}

export function listMine(ownerId: string): Share[] {
  return read().filter((s) => s.ownerId === ownerId);
}
export function listForUser(targetId: string): Share[] {
  return read().filter((s) => s.targetId === targetId);
}
export function getById(id: string): Share | undefined {
  return read().find((s) => s.id === id);
}
export function revoke(id: string, ownerId: string): void {
  write(read().filter((s) => !(s.id === id && s.ownerId === ownerId)));
}

// Kiem tra `p` (duong dan file/folder) co nam trong pham vi share khong
export function pathInShare(share: Share, p: string): boolean {
  if (share.path === "/") return true;
  return p === share.path || p.startsWith(share.path + "/");
}
