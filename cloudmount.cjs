// ===== MOUNT KIEU GOOGLE DRIVE (Windows Cloud Files API) =====
// Bien thu muc thanh "sync root": file cloud hien ra duoi dang placeholder (co kich thuoc that,
// chua ton dung luong). Mo / "Available offline" -> Windows goi onFetch -> ta tai tu cloud ve.
// "Online only" -> Windows tu giai phong dung luong. Day la co che y het Google Drive File Stream.
const path = require("node:path");
const fs = require("node:fs");

let cf = null;
function loadAddon() {
  if (cf) return cf;
  cf = require(path.join(__dirname, "native", "cloudfiles", "build", "Release", "cloudfiles.node"));
  return cf;
}

let rootDir = null, baseUrl = null, getCookie = null, started = false;

async function api(p) {
  const cookie = await getCookie();
  const r = await fetch(baseUrl + p, { headers: cookie ? { Cookie: cookie } : {} });
  if (!r.ok) throw new Error("API " + p + " -> " + r.status);
  return r.json();
}

// Windows can du lieu file -> tai dung doan can (Range) tu cloud roi tra ve
function onFetch(reqId, identity, offset, length) {
  (async () => {
    try {
      const id = String(identity).replace(/\0/g, "");
      const start = Number(offset), len = Number(length);
      const cookie = await getCookie();
      const headers = { Range: `bytes=${start}-${start + len - 1}` };
      if (cookie) headers.Cookie = cookie;
      const r = await fetch(`${baseUrl}/api/download/${id}`, { headers });
      const ab = await r.arrayBuffer();
      let buf = Buffer.from(ab);
      if (buf.length > len) buf = buf.subarray(0, len); // chi tra dung doan duoc yeu cau
      cf.transferData(reqId, buf, start);
    } catch (e) {
      console.log("[cloudmount] fetch loi:", e.message);
    }
  })();
}

// Tao placeholder cho toan bo cay thu muc cloud (de quy)
async function populate(cloudDir) {
  const base = cloudDir === "/" ? rootDir : path.join(rootDir, cloudDir.replace(/^\//, "").replace(/\//g, path.sep));
  let d;
  try { d = await api(`/api/list?dir=${encodeURIComponent(cloudDir)}`); } catch { return; }
  for (const folderPath of d.folders || []) {
    const name = folderPath.replace(/\/+$/, "").split("/").pop();
    try { cf.createPlaceholder(base, name, "", 0, true); } catch {}
    await populate(folderPath);
  }
  for (const f of d.files || []) {
    if (f.complete === false) continue;
    try { cf.createPlaceholder(base, f.name, f.id, f.size || 0, false); } catch {}
  }
}

async function startCloudMount({ root, base, cookieFn }) {
  loadAddon();
  rootDir = root;
  baseUrl = base.replace(/\/+$/, "");
  getCookie = cookieFn;
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
function unregister(root) {
  loadAddon();
  try { return cf.unregister(root || rootDir); } catch { return -1; }
}
function isStarted() { return started; }

module.exports = { startCloudMount, stopCloudMount, unregister, isStarted };
