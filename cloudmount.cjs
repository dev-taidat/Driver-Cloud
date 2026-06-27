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
      const d = await listDirFn(cloudDir);
      const lines = [];
      for (const folderPath of (d.folders || [])) {
        const name = folderPath.replace(/\/+$/, "").split("/").pop();
        lines.push(name + "\t1\t0\t");
      }
      for (const f of (d.files || [])) {
        if (f.complete === false) continue;
        lines.push(f.name + "\t0\t" + (f.size || 0) + "\t" + f.id);
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
  const hrReg = cf.register(rootDir, "Driver Cloud", "1.0");
  if (hrReg !== 0) throw new Error("register HRESULT 0x" + (hrReg >>> 0).toString(16));
  const hrConn = cf.connect(rootDir, onFetch, onList);
  // 0x8007017A = da connect roi -> coi nhu thanh cong (idempotent)
  if (hrConn !== 0 && (hrConn >>> 0) !== 0x8007017a) throw new Error("connect HRESULT 0x" + (hrConn >>> 0).toString(16));
  started = true;
  return rootDir;
}

function stopCloudMount() {
  if (!started) return;
  try { cf.disconnect(); } catch {}
  started = false;
}
function unregister(root) { loadAddon(); try { return cf.unregister(root || rootDir); } catch { return -1; } }
function isStarted() { return started; }

module.exports = { startCloudMount, stopCloudMount, unregister, isStarted };
