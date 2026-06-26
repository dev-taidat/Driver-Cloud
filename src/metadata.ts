import { METADATA_PATH, readJSON, writeJSON } from "./config.js";
import type { LogicalFile } from "./types.js";

interface MetaStore {
  files: LogicalFile[];
  folders: string[]; // danh sach duong dan thu muc day du, vd "/Photos", "/Photos/2024"
}

function load(): MetaStore {
  const s = readJSON<MetaStore>(METADATA_PATH, { files: [], folders: [] });
  if (!s.folders) s.folders = [];
  // tuong thich du lieu cu: file thieu `dir` thi suy ra tu path
  for (const f of s.files) {
    if (!f.dir) f.dir = parentOf(f.path) || "/";
  }
  return s;
}

function save(store: MetaStore): void {
  writeJSON(METADATA_PATH, store);
}

// ===== Tien ich duong dan =====
export function parentOf(p: string): string {
  if (p === "/" || !p) return "/";
  const trimmed = p.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}
export function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}
export function baseName(p: string): string {
  const t = p.replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1);
}

// ===== File =====
export function listFiles(): LogicalFile[] {
  return load().files;
}

export function upsertFile(file: LogicalFile): void {
  const store = load();
  const i = store.files.findIndex((f) => f.id === file.id);
  if (i >= 0) store.files[i] = file;
  else store.files.push(file);
  save(store);
}

export function findFile(idOrPath: string): LogicalFile | undefined {
  return load().files.find(
    (f) => f.id === idOrPath || f.path === idOrPath || f.name === idOrPath
  );
}

export function removeFile(id: string): void {
  const store = load();
  store.files = store.files.filter((f) => f.id !== id);
  save(store);
}

// ===== Thung rac =====
export function trashFile(id: string, when: string): void {
  const store = load();
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.trashed = true;
  f.trashedAt = when;
  save(store);
}
export function restoreFile(id: string): void {
  const store = load();
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.trashed = false;
  delete f.trashedAt;
  save(store);
}
export function listTrash(): LogicalFile[] {
  return load().files.filter((f) => f.trashed);
}

export function setThumb(id: string, dataUri: string): void {
  const store = load();
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.thumb = dataUri;
  save(store);
}

export function renameFile(id: string, newName: string): void {
  const store = load();
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.name = newName;
  f.path = joinPath(f.dir, newName);
  save(store);
}

export function moveFile(id: string, newDir: string): void {
  const store = load();
  const f = store.files.find((x) => x.id === id);
  if (!f) return;
  f.dir = newDir;
  f.path = joinPath(newDir, f.name);
  save(store);
}

// ===== Thu muc =====
export function listFolders(): string[] {
  return load().folders;
}

export function createFolder(dir: string, name: string): string {
  const store = load();
  const full = joinPath(dir, name);
  if (!store.folders.includes(full)) {
    store.folders.push(full);
    save(store);
  }
  return full;
}

// Liet ke noi dung 1 thu muc: thu muc con + file truc tiep ben trong
export function listDir(dir: string): { folders: string[]; files: LogicalFile[] } {
  const store = load();
  const folders = store.folders.filter((f) => parentOf(f) === dir).sort();
  const files = store.files.filter((f) => f.dir === dir && !f.trashed);
  return { folders, files };
}

// Lay tat ca file nam trong thu muc (de quy) - dung khi xoa thu muc
export function filesUnder(dir: string): LogicalFile[] {
  const store = load();
  const prefix = dir === "/" ? "/" : dir + "/";
  return store.files.filter((f) => f.dir === dir || f.path.startsWith(prefix));
}

// Xoa thu muc + moi thu muc con khoi danh sach (file da duoc xoa rieng o tang tren)
export function removeFolderEntries(dir: string): void {
  const store = load();
  const prefix = dir === "/" ? "/" : dir + "/";
  store.folders = store.folders.filter((f) => f !== dir && !f.startsWith(prefix));
  store.files = store.files.filter((f) => !(f.dir === dir || f.path.startsWith(prefix)));
  save(store);
}

export function renameFolder(dir: string, newName: string): void {
  const store = load();
  const parent = parentOf(dir);
  const newPath = joinPath(parent, newName);
  const prefix = dir === "/" ? "/" : dir + "/";
  store.folders = store.folders.map((f) => {
    if (f === dir) return newPath;
    if (f.startsWith(prefix)) return newPath + f.slice(dir.length);
    return f;
  });
  for (const file of store.files) {
    if (file.dir === dir) {
      file.dir = newPath;
      file.path = joinPath(newPath, file.name);
    } else if (file.path.startsWith(prefix)) {
      file.dir = newPath + file.dir.slice(dir.length);
      file.path = joinPath(file.dir, file.name);
    }
  }
  save(store);
}
