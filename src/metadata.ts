import { DATA_DIR, dataPaths, readJSON, writeJSON } from "./config.js";
import type { LogicalFile } from "./types.js";

interface MetaStore {
  files: LogicalFile[];
  folders: string[]; // duong dan thu muc day du, vd "/Photos", "/Photos/2024"
}

// `dataDir` = thu muc du lieu user (web). Mac dinh DATA_DIR (desktop).
function load(dataDir: string): MetaStore {
  const s = readJSON<MetaStore>(dataPaths(dataDir).metadata, { files: [], folders: [] });
  if (!s.folders) s.folders = [];
  for (const f of s.files) if (!f.dir) f.dir = parentOf(f.path) || "/";
  return s;
}
function save(store: MetaStore, dataDir: string): void {
  writeJSON(dataPaths(dataDir).metadata, store);
}

// ===== Tien ich duong dan (pure) =====
export function parentOf(p: string): string {
  if (p === "/" || !p) return "/";
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? "/" : t.slice(0, i);
}
export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}
export function baseName(p: string): string {
  const t = p.replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1);
}

// ===== File =====
export function listFiles(dataDir: string = DATA_DIR): LogicalFile[] {
  return load(dataDir).files;
}
export function upsertFile(file: LogicalFile, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const i = store.files.findIndex((f) => f.id === file.id);
  if (i >= 0) store.files[i] = file;
  else store.files.push(file);
  save(store, dataDir);
}
export function findFile(idOrPath: string, dataDir: string = DATA_DIR): LogicalFile | undefined {
  return load(dataDir).files.find(
    (f) => f.id === idOrPath || f.path === idOrPath || f.name === idOrPath
  );
}
export function removeFile(id: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  store.files = store.files.filter((f) => f.id !== id);
  save(store, dataDir);
}

// ===== Thung rac =====
export function trashFile(id: string, when: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.trashed = true; f.trashedAt = when;
  save(store, dataDir);
}
export function restoreFile(id: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.trashed = false; delete f.trashedAt;
  save(store, dataDir);
}
export function listTrash(dataDir: string = DATA_DIR): LogicalFile[] {
  return load(dataDir).files.filter((f) => f.trashed);
}
export function setThumb(id: string, dataUri: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.thumb = dataUri;
  save(store, dataDir);
}
export function renameFile(id: string, newName: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.name = newName; f.path = joinPath(f.dir, newName);
  save(store, dataDir);
}
export function moveFile(id: string, newDir: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.dir = newDir; f.path = joinPath(newDir, f.name);
  save(store, dataDir);
}

// ===== Thu muc ('dir' = duong dan thu muc; 'dataDir' = thu muc du lieu user) =====
export function listFolders(dataDir: string = DATA_DIR): string[] {
  return load(dataDir).folders;
}
export function createFolder(dir: string, name: string, dataDir: string = DATA_DIR): string {
  const store = load(dataDir);
  const full = joinPath(dir, name);
  if (!store.folders.includes(full)) { store.folders.push(full); save(store, dataDir); }
  return full;
}
export function listDir(dir: string, dataDir: string = DATA_DIR): { folders: string[]; files: LogicalFile[] } {
  const store = load(dataDir);
  const folders = store.folders.filter((f) => parentOf(f) === dir).sort();
  // kho cua chu: loai file thuoc grant (cua thanh vien) va file trong thung rac
  const files = store.files.filter((f) => f.dir === dir && !f.trashed && !f.grantId);
  return { folders, files };
}

// ===== Kho duoc cap cho thanh vien (grant) - luu trong metadata cua CHU pool =====
export function grantFiles(grantId: string, dataDir: string = DATA_DIR): LogicalFile[] {
  return load(dataDir).files.filter((f) => f.grantId === grantId && !f.trashed);
}
export function grantUsage(grantId: string, dataDir: string = DATA_DIR): number {
  return grantFiles(grantId, dataDir).reduce((s, f) => s + f.size, 0);
}
export function setGrant(fileId: string, grantId: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const f = store.files.find((x) => x.id === fileId);
  if (f) { f.grantId = grantId; save(store, dataDir); }
}
export function filesUnder(dir: string, dataDir: string = DATA_DIR): LogicalFile[] {
  const store = load(dataDir);
  const prefix = dir === "/" ? "/" : dir + "/";
  return store.files.filter((f) => f.dir === dir || f.path.startsWith(prefix));
}
export function removeFolderEntries(dir: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const prefix = dir === "/" ? "/" : dir + "/";
  store.folders = store.folders.filter((f) => f !== dir && !f.startsWith(prefix));
  store.files = store.files.filter((f) => !(f.dir === dir || f.path.startsWith(prefix)));
  save(store, dataDir);
}
export function renameFolder(dir: string, newName: string, dataDir: string = DATA_DIR): void {
  const store = load(dataDir);
  const parent = parentOf(dir);
  const newPath = joinPath(parent, newName);
  const prefix = dir === "/" ? "/" : dir + "/";
  store.folders = store.folders.map((f) => {
    if (f === dir) return newPath;
    if (f.startsWith(prefix)) return newPath + f.slice(dir.length);
    return f;
  });
  for (const file of store.files) {
    if (file.dir === dir) { file.dir = newPath; file.path = joinPath(newPath, file.name); }
    else if (file.path.startsWith(prefix)) { file.dir = newPath + file.dir.slice(dir.length); file.path = joinPath(file.dir, file.name); }
  }
  save(store, dataDir);
}
