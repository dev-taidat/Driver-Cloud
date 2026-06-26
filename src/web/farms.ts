import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./users.js";

// Mot "farm" = mot nhom luu tru co ten, do 1 chu (ownerId) tao. Moi chu co the tao
// NHIEU farm. Trong moi farm, chu cap dung luong cho cac thanh vien (xem grants.ts).
const FILE = path.join(DATA_ROOT, "farms.json");

export interface Farm {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

function read(): Farm[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}
function write(list: Farm[]): void {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export function createFarm(ownerId: string, name: string): Farm {
  const farm: Farm = { id: crypto.randomUUID(), ownerId, name: (name || "Farm").trim().slice(0, 40) || "Farm", createdAt: new Date().toISOString() };
  const list = read();
  list.push(farm);
  write(list);
  return farm;
}
export function listByOwner(ownerId: string): Farm[] { return read().filter((f) => f.ownerId === ownerId); }
export function getById(id: string): Farm | undefined { return read().find((f) => f.id === id); }
export function rename(id: string, ownerId: string, name: string): void {
  const list = read(); const f = list.find((x) => x.id === id && x.ownerId === ownerId);
  if (f) { f.name = (name || "").trim().slice(0, 40) || f.name; write(list); }
}
export function remove(id: string, ownerId: string): void {
  write(read().filter((f) => !(f.id === id && f.ownerId === ownerId)));
}
