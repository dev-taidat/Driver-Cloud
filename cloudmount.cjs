// ===== MOUNT KIEU GOOGLE DRIVE (Windows Cloud Files API) =====
// File cloud hien dang placeholder (chua ton dung luong). Mo / "Available offline" -> Windows
// goi onFetch -> ta lay du lieu (electron-main tai THANG tu Google Drive, nhanh ~10x) -> tra ve.
// "Online only" -> Windows tu giai phong dung luong. Co che y het Google Drive File Stream.
//
// I/O do electron-main cap qua callback (listDir, fetchRange) de tai truc tiep may<->Drive.
const path = require("node:path");
const fs = require("node:fs");

let cf = null;
function loadAddon() {
  if (cf) return cf;
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "cloudfiles.node") : null, // ban dong goi (extraResources)
    path.join(__dirname, "native", "cloudfiles", "prebuilt", "cloudfiles.node"),        // prebuilt commit san
    path.join(__dirname, "native", "cloudfiles", "build", "Release", "cloudfiles.node"), // khi chay dev (vua build)
  ].filter(Boolean);
  let lastErr;
  for (const p of candidates) { try { cf = require(p); return cf; } catch (e) { lastErr = e; } }
  throw new Error("Khong nap duoc cloudfiles.node: " + (lastErr && lastErr.message));
}

let rootDir = null, started = false, rootName = "";
let listDirFn = null, fetchRangeFn = null;
const SYNC_ROOT_ID = "DriverCloud!{DC10AD00-0000-4000-8000-000000000001}";
const populatedDirs = new Set(); // cac thu muc da mo -> sync nen cap nhat
const cloudInfo = new Map();     // cloudPath -> {id, isDir}: cac file/folder LA CUA CLOUD
let syncTimer = null;
function childCloud(dir, name) { return (dir === "/" ? "" : dir) + "/" + name; }
function isCloudPath(cloudPath) { return cloudInfo.has(cloudPath); }
function getInfo(cloudPath) { return cloudInfo.get(cloudPath) || null; }
function addCloudPath(cloudPath, id, isDir) { cloudInfo.set(cloudPath, { id: id || "", isDir: !!isDir }); }
function forget(cloudPath) { cloudInfo.delete(cloudPath); }

// Windows can du lieu file -> goi fetchRange (tai thang tu Drive) roi tra ve
function onFetch(reqId, identity, offset, length) {
  (async () => {
    try {
      const id = String(identity).replace(/\0/g, "");
      const start = Number(offset), len = Number(length);
      let buf = await fetchRangeFn(id, start, len);
      if (!buf) buf = Buffer.alloc(0);
      if (buf.length > len) buf = buf.subarray(0, len);
      cf.transferData(reqId, buf, start);
    } catch (e) {
      console.log("[cloudmount] fetch loi:", e && e.message);
      try { cf.transferData(reqId, Buffer.alloc(0), Number(offset)); } catch {}
    }
  })();
}

// Windows liet ke 1 thu muc -> tra danh sach con (placeholder on-demand)
function onList(reqId, rawPath) {
  (async () => {
    try {
      // rawPath = NormalizedPath: duong dan tuyet doi tuong doi volume, vd "\Users\cudat\Driver Cloud\Sub"
      // -> bo prefix duong dan root (khong ke o dia) de ra cloud dir.
      let p = String(rawPath || "").replace(/\\/g, "/");
      const rootRel = rootDir.replace(/\\/g, "/").replace(/^[A-Za-z]:/, ""); // "/Users/cudat/Driver Cloud"
      if (p.toLowerCase().startsWith(rootRel.toLowerCase())) p = p.slice(rootRel.length);
      let cloudDir = "/" + p.replace(/^\/+/, "");
      cloudDir = cloudDir.replace(/\/+$/, "") || "/";
      populatedDirs.add(cloudDir); // de sync nen cap nhat thu muc nay
      const d = await listDirFn(cloudDir);
      const lines = [];
      for (const folderPath of (d.folders || [])) {
        const name = folderPath.replace(/\/+$/, "").split("/").pop();
        lines.push(name + "\t1\t0\t");
        cloudInfo.set(childCloud(cloudDir, name), { id: "", isDir: true });
      }
      for (const f of (d.files || [])) {
        if (f.complete === false) continue;
        lines.push(f.name + "\t0\t" + (f.size || 0) + "\t" + f.id);
        cloudInfo.set(childCloud(cloudDir, f.name), { id: f.id, isDir: false });
      }
      cf.transferPlaceholders(reqId, lines.join("\n"));
    } catch (e) {
      console.log("[cloudmount] list loi:", e && e.message);
      try { cf.transferPlaceholders(reqId, ""); } catch {}
    }
  })();
}

async function startCloudMount({ root, listDir, fetchRange }) {
  loadAddon();
  if (started) return rootDir; // da mount roi -> khong mount lai (tranh 0x17A)
  rootDir = root;
  rootName = path.basename(root);
  listDirFn = listDir;
  fetchRangeFn = fetchRange;
  fs.mkdirSync(rootDir, { recursive: true });
  // Don dang ky cu/stale tu lan chay truoc bi crash (tranh "0x17A: da connect boi provider khac")
  try { cf.disconnect(); } catch {}
  try { cf.unregister(rootDir); } catch {}
  try { cf.unregisterSp(SYNC_ROOT_ID); } catch {}
  const icon = (process.execPath || "") + ",0";
  // Co package identity (sparse package) -> dang ky Storage Provider (CO menu chuot phai + icon).
  // Khong co -> dang ky goc (CfRegisterSyncRoot): van chay file ops, khong menu, khong tao muc trung.
  let useSp = false; try { useSp = !!cf.hasIdentity(); } catch {}
  const hrReg = useSp
    ? cf.registerSp(rootDir, "Driver Cloud", "1.0", icon, SYNC_ROOT_ID)
    : cf.register(rootDir, "Driver Cloud", "1.0");
  if (hrReg !== 0) throw new Error("register HRESULT 0x" + (hrReg >>> 0).toString(16));
  const hrConn = cf.connect(rootDir, onFetch, onList);
  // 0x8007017A = da connect roi -> coi nhu thanh cong (idempotent)
  if (hrConn !== 0 && (hrConn >>> 0) !== 0x8007017a) throw new Error("connect HRESULT 0x" + (hrConn >>> 0).toString(16));
  started = true;
  startSync(); // server -> o realtime
  return rootDir;
}

function stopCloudMount() {
  if (!started) return;
  stopSync();
  try { cf.disconnect(); } catch {}
  started = false;
}
function unregister(root) { loadAddon(); try { return cf.unregister(root || rootDir); } catch { return -1; } }
function isStarted() { return started; }

// ===== SYNC NEN (server -> o, realtime): doi chieu thu muc da mo voi server moi ~20s =====
async function syncOnce() {
  for (const cloudDir of Array.from(populatedDirs)) {
    let d;
    try { d = await listDirFn(cloudDir); } catch { continue; }
    const base = cloudDir === "/" ? rootDir : path.join(rootDir, cloudDir.replace(/^\//, "").replace(/\//g, path.sep));
    let localEntries;
    try { localEntries = fs.readdirSync(base); } catch { continue; }
    const localSet = new Set(localEntries);
    const serverFolders = (d.folders || []).map((f) => f.replace(/\/+$/, "").split("/").pop());
    const serverFiles = (d.files || []).filter((f) => f.complete !== false);
    const serverNames = new Set([...serverFolders, ...serverFiles.map((f) => f.name)]);
    // dong bo danh sach cloud path cho thu muc nay
    for (const name of serverFolders) cloudInfo.set(childCloud(cloudDir, name), { id: "", isDir: true });
    for (const f of serverFiles) cloudInfo.set(childCloud(cloudDir, f.name), { id: f.id, isDir: false });
    // THEM: file/folder moi tren server -> tao placeholder online vao o
    for (const name of serverFolders) if (!localSet.has(name)) { try { cf.createPlaceholder(base, name, "", 0, true); } catch {} }
    for (const f of serverFiles) if (!localSet.has(f.name)) { try { cf.createPlaceholder(base, f.name, f.id, f.size || 0, false); } catch {} }
    // XOA: local la placeholder cloud nhung server da xoa -> xoa khoi o (khong dung file FULL user dang cho upload)
    for (const name of localEntries) {
      if (serverNames.has(name)) continue;
      const fp = path.join(base, name);
      // bo khoi cloudInfo TRUOC khi xoa -> tranh watcher tuong user xoa roi xoa lai tren server
      try { if (cf.isPlaceholder(fp)) { cloudInfo.delete(childCloud(cloudDir, name)); fs.rmSync(fp, { recursive: true, force: true }); } } catch {}
    }
  }
}
function startSync() { if (syncTimer) return; syncTimer = setInterval(() => { syncOnce().catch(() => {}); }, 20000); }
function stopSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } populatedDirs.clear(); cloudInfo.clear(); }

// cloudPath ("/folder/file") -> duong dan file thuc trong o mount
function mountPathFor(cloudPath) {
  return path.join(rootDir, String(cloudPath || "").replace(/^\/+/, "").replace(/\//g, path.sep));
}
// Dua file OFFLINE (tai ve may, ghim) / ONLINE (giai phong o, van o cloud)
function setOffline(cloudPath) { loadAddon(); return cf.hydrate(mountPathFor(cloudPath)); }
function setOnline(cloudPath) { loadAddon(); return cf.dehydrate(mountPathFor(cloudPath)); }
// File vua copy vao (full) da upload xong -> bien thanh ONLINE placeholder + giai phong o
function convertToOnline(localPath, fileId) { loadAddon(); try { return cf.convert(localPath, fileId, true); } catch { return -1; } }
// File cloud ONLINE (placeholder chua tai) -> watcher bo qua, khong re-upload
function isPlaceholder(localPath) { loadAddon(); try { return !!cf.isPlaceholder(localPath); } catch { return false; } }
function hasIdentity() { loadAddon(); try { return !!cf.hasIdentity(); } catch { return false; } }

module.exports = { startCloudMount, stopCloudMount, unregister, isStarted, setOffline, setOnline, convertToOnline, isPlaceholder, isCloudPath, addCloudPath, getInfo, forget, hasIdentity };
