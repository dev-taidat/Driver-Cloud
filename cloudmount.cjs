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
  cf = require(path.join(__dirname, "native", "cloudfiles", "build", "Release", "cloudfiles.node"));
  return cf;
}

let rootDir = null, started = false;
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

// Tao placeholder cho toan bo cay thu muc cloud (de quy)
async function populate(cloudDir) {
  const base = cloudDir === "/" ? rootDir : path.join(rootDir, cloudDir.replace(/^\//, "").replace(/\//g, path.sep));
  let d;
  try { d = await listDirFn(cloudDir); } catch { return; }
  for (const folderPath of (d.folders || [])) {
    const name = folderPath.replace(/\/+$/, "").split("/").pop();
    try { cf.createPlaceholder(base, name, "", 0, true); } catch {}
    await populate(folderPath);
  }
  for (const f of (d.files || [])) {
    if (f.complete === false) continue;
    try { cf.createPlaceholder(base, f.name, f.id, f.size || 0, false); } catch {}
  }
}

async function startCloudMount({ root, listDir, fetchRange }) {
  loadAddon();
  rootDir = root;
  listDirFn = listDir;
  fetchRangeFn = fetchRange;
  fs.mkdirSync(rootDir, { recursive: true });
  const hrReg = cf.register(rootDir, "Driver Cloud", "1.0");
  if (hrReg !== 0) throw new Error("register HRESULT 0x" + (hrReg >>> 0).toString(16));
  const hrConn = cf.connect(rootDir, onFetch);
  if (hrConn !== 0) throw new Error("connect HRESULT 0x" + (hrConn >>> 0).toString(16));
  started = true;
  await populate("/");
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
