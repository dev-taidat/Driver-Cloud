import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./users.js";

// Mot "grant" = chu pool (ownerId) cap cho thanh vien (memberId) mot luong dung luong
// rieng trong pool cua chu. Thanh vien tu upload file cua ho (chu khong thay).
const FILE = path.join(DATA_ROOT, "grants.json");

export interface Grant {
  id: string;
  farmId: string;
  ownerId: string;
  ownerUsername: string;
  memberId: string;
  memberUsername: string;
  quotaBytes: number;
  createdAt: string;
}

function read(): Grant[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function write(list: Grant[]): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export function createGrant(g: Omit<Grant, "id" | "createdAt">): Grant {
  const list = read();
  // 1 thanh vien trong 1 farm chi co 1 grant -> trung thi cap nhat quota
  const existing = list.find((x) => x.farmId === g.farmId && x.memberId === g.memberId);
  if (existing) { existing.quotaBytes = g.quotaBytes; write(list); return existing; }
  const grant: Grant = { ...g, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  list.push(grant);
  write(list);
  return grant;
}
export function listByOwner(ownerId: string): Grant[] { return read().filter((g) => g.ownerId === ownerId); }
export function listByFarm(farmId: string): Grant[] { return read().filter((g) => g.farmId === farmId); }
export function listByMember(memberId: string): Grant[] { return read().filter((g) => g.memberId === memberId); }
export function getById(id: string): Grant | undefined { return read().find((g) => g.id === id); }
export function setQuota(id: string, ownerId: string, quotaBytes: number): void {
  const list = read(); const g = list.find((x) => x.id === id && x.ownerId === ownerId);
  if (g) { g.quotaBytes = quotaBytes; write(list); }
}
export function revoke(id: string, ownerId: string): void {
  write(read().filter((g) => !(g.id === id && g.ownerId === ownerId)));
}
export function revokeByFarm(farmId: string): void {
  write(read().filter((g) => g.farmId !== farmId));
}
