// Tien trinh chinh cua Electron (CommonJS de tranh loi ESM-interop cua Electron).
// Engine viet bang ESM nen duoc nap qua dynamic import() khi app san sang.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Tray, Menu, nativeImage, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VID_EXT = ["mp4", "webm", "ogg", "ogv", "mov", "m4v"];
const PREVIEW_DIR = path.join(os.tmpdir(), "driver-cloud-view");
let sharp = null;
try { sharp = require("sharp"); } catch {}
// Mount kieu Google Drive (Windows Cloud Files API). Co the chua nap duoc neu sai ABI -> guard.
let cloudmount = null;
try { cloudmount = require("./cloudmount.cjs"); } catch (e) { console.log("[cloudmount] khong nap duoc:", e && e.message); }

// Dang ky scheme dcmedia (phai goi TRUOC khi app ready) de phat anh/video trong app
protocol.registerSchemesAsPrivileged([
  { scheme: "dcmedia", privileges: { secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
]);

const APP_ROOT = __dirname;
let masterKey = null;
let win = null;
let E = null; // gom cac module engine sau khi import

// Dia chi web ma app desktop se mo (de desktop = web 100%, dung chung du lieu).
// Uu tien: bien moi truong -> file cau hinh -> mac dinh (Railway online).
const URL_CFG = path.join(os.homedir(), ".driver-cloud", "app-url.txt");
const DEFAULT_URL = "https://web-production-b012.up.railway.app";
function getAppUrl() {
  if (process.env.DRIVER_CLOUD_URL) return process.env.DRIVER_CLOUD_URL;
  try { const u = fs.readFileSync(URL_CFG, "utf8").trim(); if (u) return u; } catch {}
  return DEFAULT_URL;
}
function setAppUrl(u) {
  fs.mkdirSync(path.dirname(URL_CFG), { recursive: true });
  fs.writeFileSync(URL_CFG, u.trim());
}

// Chi cho phep 1 ban app chay cung luc (tranh chiem cong OAuth / xung dot du lieu)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Nap engine ESM tu thu muc dist
async function loadEngine() {
  const imp = (p) => import(pathToFileURL(path.join(APP_ROOT, "dist", p)).href);
  const [config, crypto, accounts, auth, uploader, downloader, metadata, webdav, bridge] = await Promise.all([
    imp("config.js"),
    imp("crypto.js"),
    imp("accounts.js"),
    imp("auth.js"),
    imp("uploader.js"),
    imp("downloader.js"),
    imp("metadata.js"),
    imp("webdav.js"),
    imp("webdav-bridge.js"),
  ]);
  E = { config, crypto, accounts, auth, uploader, downloader, metadata, webdav, bridge };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#f5f7fb",
    title: "Driver Cloud",
    icon: path.join(APP_ROOT, "build", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(APP_ROOT, "preload.cjs") },
  });
  win.removeMenu();
  // Tu dong luu file tai ve vao thu muc Downloads (khong hoi)
  win.webContents.session.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    let out = path.join(dir, item.getFilename());
    if (fs.existsSync(out)) {
      const ext = path.extname(out), base = path.basename(out, ext);
      let i = 1; while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
      out = path.join(dir, `${base} (${i})${ext}`);
    }
    item.setSavePath(out);
    item.once("done", (_ev, state) => { if (state === "completed") new Notification({ title: "Driver Cloud", body: "Đã tải về: " + path.basename(out) }).show(); });
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3) return; // bo qua abort
    console.log(`[did-fail-load] ${code} ${desc} ${url}`);
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      `<body style="font-family:sans-serif;background:#0a0d16;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2>Không kết nối được server</h2><p>${getAppUrl()}</p><p style="color:#8b90a8">Kiểm tra mạng, hoặc đổi địa chỉ server ở khay hệ thống (chuột phải icon Driver Cloud).</p></div></body>`));
  });
  const target = getAppUrl();
  console.log("[main] loading web:", target);
  win.loadURL(target);

  // Sau khi tai trang / dang nhap xong -> tu mount o dia (neu bat va da dang nhap)
  win.webContents.on("did-finish-load", () => setTimeout(autoMountIfNeeded, 900));
  win.webContents.on("did-navigate", () => setTimeout(autoMountIfNeeded, 900));

  // Dong cua so = thu nho xuong khay (chay ngam), khong thoat han
  win.on("close", (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

let tray = null;
let davServer = null;
const DAV_PORT = 4000;
const { exec } = require("node:child_process");

function showWin() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } }

// Tu dong mount khi mo app (mac dinh bat) - luu trong prefs
function readPref(key, def) { try { const p = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".driver-cloud", "prefs.json"), "utf8")); return key in p ? p[key] : def; } catch { return def; } }
function writePref(key, val) { const f = path.join(os.homedir(), ".driver-cloud", "prefs.json"); let p = {}; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch {} p[key] = val; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(p)); }
let autoMount = readPref("autoMount", true);

async function getSessionCookie() {
  try { const c = await win.webContents.session.cookies.get({ url: getAppUrl(), name: "dcsid" }); return c.length ? `dcsid=${c[0].value}` : null; } catch { return null; }
}
function mapDrive() {
  if (process.platform === "win32") {
    const doMap = () => exec(`net use * \\\\localhost@${DAV_PORT}\\DavWWWRoot /persistent:no`, () => {});
    exec("sc query webclient", (_e, out) => {
      if (/RUNNING/.test(out || "")) return doMap();
      // WebClient chua chay -> bat tu dong + nang gioi han kich thuoc file (can admin, UAC 1 lan)
      const bat = path.join(os.tmpdir(), "dc-webclient.bat");
      try {
        fs.writeFileSync(bat, [
          "sc config webclient start=auto",
          'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters" /v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f',
          "net start webclient",
        ].join("\r\n") + "\r\n");
        exec(`powershell -Command "Start-Process -FilePath '${bat}' -Verb RunAs -WindowStyle Hidden"`, () => setTimeout(doMap, 5000));
      } catch { doMap(); }
    });
  } else if (process.platform === "darwin") {
    exec(`osascript -e 'mount volume "http://localhost:${DAV_PORT}"'`, () => {});
  }
}
function unmapDrive() {
  if (process.platform === "win32") exec(`net use \\\\localhost@${DAV_PORT}\\DavWWWRoot /delete /y`, () => {});
}
// Bat o dia (im lang). Tra ve true neu thanh cong.
async function doMount() {
  if (davServer) return true;
  const cookie = await getSessionCookie();
  if (!cookie) return false;
  try { davServer = E.bridge.startWebdavBridge(DAV_PORT, getAppUrl(), cookie); } catch { return false; }
  mapDrive();
  buildTrayMenu();
  return true;
}
function doUnmount() {
  if (davServer) { try { davServer.close(); } catch {} davServer = null; }
  unmapDrive();
  buildTrayMenu();
}
// Goi sau khi dang nhap / mo app -> tu mount neu bat
async function autoMountIfNeeded() {
  if (!autoMount) return;
  // Windows: tu dong hien kho dang o Google Drive (placeholder). macOS: WebDAV.
  if (process.platform === "win32" && cloudmount) {
    if (!cloudmount.isStarted()) await startGoogleMount({ silent: true });
  } else if (!davServer) {
    await doMount();
  }
}
// Bam tay trong tray
async function toggleMount() {
  if (davServer) { doUnmount(); new Notification({ title: "Driver Cloud", body: "Đã ngắt ổ đĩa." }).show(); return; }
  const ok = await doMount();
  if (!ok) return dialog.showMessageBox(win, { type: "warning", title: "Mount ổ đĩa", message: "Hãy đăng nhập trước", detail: "Mở app + đăng nhập tài khoản, rồi Mount." });
  if (process.platform === "win32") {
    new Notification({ title: "Driver Cloud", body: "Đã mount ổ đĩa. Mở This PC để xem (nếu chưa có: bật dịch vụ WebClient)." }).show();
  } else new Notification({ title: "Driver Cloud", body: "Đã mount ổ đĩa vào Finder." }).show();
}

// ===== ENGINE TRUC TIEP: desktop upload/download THANG may<->Google Drive (nhanh ~10x) =====
// Lay token+key cua chinh user tu server -> chay engine cuc bo -> chi dong bo metadata ve server.
const SYNC_DIR = path.join(os.homedir(), ".driver-cloud", "web");      // creds + metadata mirror
const HYDRATE_CACHE = path.join(os.homedir(), ".driver-cloud", "cache"); // file da tai ve (hydrate)
let credsPulled = false;
function apiBase() { return getAppUrl().replace(/\/+$/, ""); }
async function pullCreds() {
  const cookie = await getSessionCookie();
  if (!cookie) throw new Error("Chưa đăng nhập");
  const r = await fetch(apiBase() + "/api/engine/creds", { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error("Không lấy được thông tin tài khoản (" + r.status + ")");
  const j = await r.json();
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  if (j.accounts) fs.writeFileSync(path.join(SYNC_DIR, "accounts.json"), JSON.stringify(j.accounts));
  if (j.keyfile) fs.writeFileSync(path.join(SYNC_DIR, "keyfile.json"), JSON.stringify(j.keyfile));
  if (j.oauthClient) fs.writeFileSync(path.join(SYNC_DIR, "oauth_client.json"), JSON.stringify(j.oauthClient));
  credsPulled = true;
}
function engineKey() { return E.crypto.ensureKeyNoPassword(SYNC_DIR); }
async function listDirRemote(cloudDir) {
  const cookie = await getSessionCookie();
  const r = await fetch(apiBase() + "/api/list?dir=" + encodeURIComponent(cloudDir), { headers: { Cookie: cookie } });
  if (!r.ok) return { folders: [], files: [] };
  const d = await r.json();
  return { folders: d.folders || [], files: (d.files || []).map((f) => ({ id: f.id, name: f.name, size: f.size, complete: f.complete })) };
}
async function ensureMeta(id) {
  if (E.metadata.findFile(id, SYNC_DIR)) return;
  const cookie = await getSessionCookie();
  const r = await fetch(apiBase() + "/api/engine/meta/" + id, { headers: { Cookie: cookie } });
  if (r.ok) { const f = await r.json(); E.metadata.upsertFile(f, SYNC_DIR); }
}
// Tai 1 doan file (cho mount hydrate): tai ca file ve cache 1 lan (thang tu Drive) roi doc range
async function fetchRange(id, offset, length) {
  await ensureMeta(id);
  fs.mkdirSync(HYDRATE_CACHE, { recursive: true });
  const cp = path.join(HYDRATE_CACHE, id);
  if (!fs.existsSync(cp)) await E.downloader.downloadFile(id, cp, engineKey(), { dataDir: SYNC_DIR });
  const fd = fs.openSync(cp, "r"); const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset); fs.closeSync(fd);
  return buf.subarray(0, n);
}
// Noi tiep moi upload truc tiep: 1 file da dung 16 luong (no day bang thong) -> lam tung file
// mot vua nhanh nhat vua tranh no RAM/luong khi copy nhieu file cung luc.
let _uploadTail = Promise.resolve();
function serializeUpload(fn) {
  const result = _uploadTail.then(fn, fn);
  _uploadTail = result.catch(() => {});
  return result;
}
// Upload THANG len Drive roi commit metadata ve server (web thay file ngay)
function uploadDirect(localPath, cloudDir, replaceId) {
  return serializeUpload(async () => {
    if (!credsPulled) await pullCreds();
    const logical = await E.uploader.uploadFile(localPath, engineKey(), { dir: cloudDir || "/", dataDir: SYNC_DIR });
    const cookie = await getSessionCookie();
    await fetch(apiBase() + "/api/engine/commit", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(logical) });
    if (replaceId) await fetch(apiBase() + "/api/remove", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ id: replaceId }) });
    return logical;
  });
}

// ===== MOUNT KIEU GOOGLE DRIVE (Windows Cloud Files API - placeholder/hydrate) =====
const GMOUNT_ROOT = path.join(os.homedir(), "Driver Cloud");
async function startGoogleMount(opts = {}) {
  const silent = !!opts.silent; // tu dong mount thi khong hien dialog/loi
  const warn = (o) => { if (!silent) dialog.showMessageBox(win, o); };
  if (process.platform !== "win32") { warn({ type: "info", title: "Mount kiểu Google", message: "Hiện chỉ hỗ trợ Windows", detail: "Tính năng placeholder dùng Windows Cloud Files API. macOS dùng WebDAV/Mở để sửa." }); return false; }
  if (!cloudmount) { warn({ type: "error", title: "Mount kiểu Google", message: "Module native chưa sẵn sàng", detail: "Bản cài này chưa kèm Cloud Files (cần build lại với addon native)." }); return false; }
  const cookie = await getSessionCookie();
  if (!cookie) { warn({ type: "warning", title: "Mount", message: "Hãy đăng nhập trước rồi thử lại." }); return false; }
  try {
    await pullCreds(); // lay token+key de tai THANG tu Drive (nhanh)
    await cloudmount.startCloudMount({ root: GMOUNT_ROOT, listDir: listDirRemote, fetchRange });
    startMountWatcher(); // dong bo NGUOC: file moi tha vao o -> upload thang len Drive
    if (!silent) { new Notification({ title: "Driver Cloud", body: "Đã hiện kho dưới dạng ổ như Google Drive. Đang mở thư mục…" }).show(); shell.openPath(GMOUNT_ROOT); }
    buildTrayMenu();
    return true;
  } catch (e) {
    warn({ type: "error", title: "Mount kiểu Google", message: "Không mount được", detail: String((e && e.message) || e) });
    return false;
  }
}
function stopGoogleMount() {
  stopMountWatcher();
  if (cloudmount) { try { cloudmount.stopCloudMount(); } catch {} }
  buildTrayMenu();
}

// ===== Phase 2: dong bo NGUOC - file MOI tha vao o -> upload THANG len Drive =====
let mountWatcher = null;
const knownPaths = new Set();   // path cloud da co (de khong up lai khi hydrate)
const uploadingPaths = new Set();
async function buildKnownPaths(cloudDir) {
  const d = await listDirRemote(cloudDir);
  for (const f of d.files) knownPaths.add((cloudDir === "/" ? "" : cloudDir) + "/" + f.name);
  for (const fold of d.folders) await buildKnownPaths(fold);
}
async function startMountWatcher() {
  knownPaths.clear();
  try { await buildKnownPaths("/"); } catch {}
  if (mountWatcher) return;
  try {
    mountWatcher = fs.watch(GMOUNT_ROOT, { recursive: true }, (_ev, rel) => {
      if (!rel) return;
      if (/(\.tmp$|~$|\.crdownload$|\.partial$)/i.test(rel)) return;
      const cloudPath = "/" + rel.split(path.sep).join("/");
      if (knownPaths.has(cloudPath) || uploadingPaths.has(cloudPath)) return;
      setTimeout(() => maybeUpload(path.join(GMOUNT_ROOT, rel), cloudPath), 1500);
    });
  } catch (e) { console.log("[mount watcher] loi:", e && e.message); }
}
function stopMountWatcher() { if (mountWatcher) { try { mountWatcher.close(); } catch {} mountWatcher = null; } }
async function maybeUpload(full, cloudPath) {
  try {
    if (knownPaths.has(cloudPath) || uploadingPaths.has(cloudPath) || !fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory() || st.size === 0) return;
    // cho copy xong (kich thuoc on dinh)
    const s1 = st.size; await new Promise((r) => setTimeout(r, 1500));
    if (!fs.existsSync(full) || fs.statSync(full).size !== s1) { setTimeout(() => maybeUpload(full, cloudPath), 1500); return; }
    uploadingPaths.add(cloudPath);
    const cloudDir = cloudPath.slice(0, cloudPath.lastIndexOf("/")) || "/";
    await uploadDirect(full, cloudDir);
    knownPaths.add(cloudPath);
    new Notification({ title: "Driver Cloud", body: "Đã tải lên cloud: " + path.basename(full) }).show();
  } catch (e) { console.log("[mount upload] loi:", e && e.message); }
  finally { uploadingPaths.delete(cloudPath); }
}

// ===== MO FILE DE SUA: tai ve -> mo bang editor mac dinh -> tu dong bo len cloud khi luu =====
// Day la cach edit file cloud thuc te (Google Drive cung tai ve cache roi sync nguoc).
const activeEdits = new Map(); // localPath -> { id, dir, name, busy, timer, baseUrl }
function editsDir() { const d = path.join(os.homedir(), ".driver-cloud", "edits"); fs.mkdirSync(d, { recursive: true }); return d; }

async function uploadEdited(local) {
  const st = activeEdits.get(local);
  if (!st || st.busy) return;
  st.busy = true;
  try {
    if (!fs.statSync(local).size) { st.busy = false; return; }
    // Upload THANG len Drive (nhanh ~10x) roi commit metadata + thay the ban cu
    const logical = await uploadDirect(local, st.dir, st.id);
    if (logical && logical.id) st.id = logical.id;
    new Notification({ title: "Driver Cloud", body: "Đã đồng bộ bản sửa lên cloud: " + st.name }).show();
  } catch (e) {
    new Notification({ title: "Driver Cloud", body: "Đồng bộ thất bại: " + st.name }).show();
  } finally { st.busy = false; }
}

function watchEdit(local) {
  // Poll mtime/size (ben voi kieu luu atomic cua nhieu editor). Luu xong -> debounce roi upload.
  fs.watchFile(local, { interval: 2000 }, (cur, prev) => {
    if (cur.size > 0 && cur.mtimeMs !== prev.mtimeMs) {
      const st = activeEdits.get(local); if (!st) return;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => uploadEdited(local), 1500);
    }
  });
}

ipcMain.handle("upload:direct", async (_e, { localPath, dir, replaceId }) => {
  try { const lf = await uploadDirect(localPath, dir || "/", replaceId); return { ok: true, id: lf.id }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle("edit:open", async (_e, { id, name, dir }) => {
  try {
    const cookie = await getSessionCookie();
    if (!cookie) return { ok: false, error: "Chưa đăng nhập" };
    const baseUrl = getAppUrl().replace(/\/+$/, "");
    const safe = String(name || id).replace(/[\\/:*?"<>|]/g, "_");
    const local = path.join(editsDir(), id + "__" + safe);
    if (!activeEdits.has(local)) {
      const r = await fetch(`${baseUrl}/api/download/${id}`, { headers: { Cookie: cookie } });
      if (!r.ok) return { ok: false, error: "Tải file thất bại" };
      const ab = await r.arrayBuffer();
      fs.writeFileSync(local, Buffer.from(ab));
      activeEdits.set(local, { id, dir: dir || "/", name: safe, busy: false, baseUrl });
      watchEdit(local);
    }
    await shell.openPath(local);
    new Notification({ title: "Driver Cloud", body: "Đang sửa: " + safe + "\nLưu trong editor là tự đồng bộ lên cloud." }).show();
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

function changeServer() {
  const r = dialog.showMessageBoxSync(win, {
    type: "question", title: "Địa chỉ server",
    message: "Chọn server Driver Cloud để mở:",
    detail: `Hiện tại: ${getAppUrl()}\n\n• Online = web của bạn (Railway), dùng ở đâu cũng giống.\n• Localhost = server chạy trên máy này (npm run web).`,
    buttons: ["Online (Railway)", "Localhost:3000", "Hủy"], cancelId: 2,
  });
  if (r === 0) setAppUrl(DEFAULT_URL);
  else if (r === 1) setAppUrl("http://localhost:3000");
  else return;
  if (win) win.loadURL(getAppUrl());
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mở Driver Cloud", click: showWin },
      ...(process.platform === "win32" && cloudmount ? [{ label: cloudmount.isStarted() ? "⏏ Ngắt ổ Google Drive" : "💎 Hiện kho như ổ Google Drive", click: () => { cloudmount.isStarted() ? stopGoogleMount() : startGoogleMount(); } }] : []),
      { label: davServer ? "⏏ Ngắt ổ đĩa (WebDAV)" : "💽 Mount ổ mạng (WebDAV)", click: toggleMount },
      {
        label: "Tự mount khi mở app", type: "checkbox", checked: autoMount,
        click: (mi) => { autoMount = mi.checked; writePref("autoMount", autoMount); if (autoMount) autoMountIfNeeded(); },
      },
      { label: "🔄 Tải lại", click: () => win && win.webContents.reload() },
      { label: "🌐 Đổi địa chỉ server…", click: changeServer },
      {
        label: "Khởi động cùng máy", type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, openAsHidden: true }),
      },
      { type: "separator" },
      { label: "Thoát", click: () => { app.isQuitting = true; doUnmount(); stopGoogleMount(); app.quit(); } },
    ])
  );
}

function createTray() {
  if (tray) return;
  let img = nativeImage.createFromPath(path.join(APP_ROOT, "build", "icon.png"));
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? path.join(APP_ROOT, "build", "icon.ico") : img);
  tray.setToolTip("Driver Cloud");
  buildTrayMenu();
  tray.on("double-click", showWin);
}

function send(channel, data) {
  if (win) win.webContents.send(channel, data);
}
function requireKey() {
  if (!masterKey) throw new Error("Chua mo khoa. Hay nhap mat khau.");
  return masterKey;
}

function registerIpc() {
  ipcMain.handle("auth:hasClient", () => fs.existsSync(E.config.OAUTH_CLIENT_PATH));
  ipcMain.handle("auth:saveClient", (_e, { clientId, clientSecret }) => {
    E.config.writeJSON(E.config.OAUTH_CLIENT_PATH, {
      client_id: clientId,
      client_secret: clientSecret,
    });
    return true;
  });

  ipcMain.handle("key:exists", () => E.crypto.keyfileExists());
  ipcMain.handle("key:init", (_e, password) => {
    masterKey = E.crypto.initMasterKey(password);
    return true;
  });
  ipcMain.handle("key:unlock", (_e, password) => {
    masterKey = E.crypto.unlockMasterKey(password);
    return true;
  });
  ipcMain.handle("key:isUnlocked", () => !!masterKey);

  ipcMain.handle("accounts:list", async () => {
    const quotas = await E.accounts.getAllQuotas();
    return quotas.map((q) => ({
      id: q.account.id,
      email: q.account.email,
      totalBytes: q.totalBytes,
      usedBytes: q.usedBytes,
      freeBytes: q.freeBytes,
    }));
  });
  ipcMain.handle("accounts:connect", async () => {
    const { email, refreshToken } = await E.auth.runOAuthFlow();
    E.accounts.addAccount({
      id: email,
      email,
      refreshToken,
      addedAt: new Date().toISOString(),
    });
    return email;
  });
  ipcMain.handle("accounts:disconnect", (_e, id) => {
    E.accounts.removeAccount(id);
    return true;
  });

  const emailMap = () => new Map(E.accounts.loadAccounts().map((a) => [a.id, a.email]));
  const mapFile = (f, emails) => ({
    id: f.id,
    name: f.name,
    path: f.path,
    dir: f.dir,
    size: f.size,
    blocks: f.blocks.length,
    complete: f.complete,
    createdAt: f.createdAt,
    thumb: f.thumb || null,
    account: f.blocks[0] ? emails.get(f.blocks[0].accountId) || "?" : "?",
  });

  ipcMain.handle("files:list", () => {
    const em = emailMap();
    return E.metadata.listFiles().map((f) => mapFile(f, em));
  });

  // Liet ke noi dung 1 thu muc: { folders: string[], files: [...] }
  ipcMain.handle("fs:listDir", (_e, dir) => {
    const em = emailMap();
    const r = E.metadata.listDir(dir || "/");
    return { folders: r.folders, files: r.files.map((f) => mapFile(f, em)) };
  });

  ipcMain.handle("fs:createFolder", (_e, { dir, name }) =>
    E.metadata.createFolder(dir || "/", name)
  );

  ipcMain.handle("fs:renameFolder", (_e, { dir, newName }) => {
    E.metadata.renameFolder(dir, newName);
    return true;
  });

  ipcMain.handle("fs:removeFolder", async (_e, dir) => {
    const files = E.metadata.filesUnder(dir);
    const accById = new Map(E.accounts.loadAccounts().map((a) => [a.id, a]));
    for (const f of files) {
      for (const b of f.blocks) {
        if (!b.driveFileId) continue;
        const acc = accById.get(b.accountId);
        if (acc) {
          try {
            await E.accounts.driveFor(acc).files.delete({ fileId: b.driveFileId });
          } catch {}
        }
      }
    }
    E.metadata.removeFolderEntries(dir);
    return true;
  });

  ipcMain.handle("files:rename", (_e, { id, newName }) => {
    E.metadata.renameFile(id, newName);
    return true;
  });

  ipcMain.handle("files:move", (_e, { id, dir }) => {
    E.metadata.moveFile(id, dir);
    return true;
  });

  ipcMain.handle("dialog:pickFiles", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });

  // Upload 1 file (co the huy). uploadId do renderer cap de map tien trinh + huy.
  const uploads = new Map(); // uploadId -> { controller, logicalId }
  ipcMain.handle("files:uploadOne", async (_e, { filePath, dir, uploadId }) => {
    const key = requireKey();
    const name = path.basename(filePath);
    const controller = new AbortController();
    const logicalId = require("node:crypto").randomUUID();
    uploads.set(uploadId, { controller, logicalId });
    try {
      const logical = await E.uploader.uploadFile(filePath, key, {
        dir: dir || "/",
        id: logicalId,
        signal: controller.signal,
        onProgress: (done, total) => send("progress", { kind: "upload", name, uploadId, done, total }),
      });
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (sharp && IMG_EXT.includes(ext)) {
        try {
          const buf = await sharp(filePath).rotate().resize(300, 300, { fit: "cover" }).webp({ quality: 72 }).toBuffer();
          E.metadata.setThumb(logical.id, "data:image/webp;base64," + buf.toString("base64"));
        } catch {}
      }
      uploads.delete(uploadId);
      return { ok: true };
    } catch (err) {
      uploads.delete(uploadId);
      // Don dep cac chunk da up dang do + entry metadata
      const partial = E.metadata.findFile(logicalId);
      if (partial) await purge(partial);
      const canceled = controller.signal.aborted;
      if (!canceled) send("toast", { type: "error", message: `Loi tai len ${name}: ${err.message}` });
      return { ok: false, canceled };
    }
  });

  ipcMain.handle("files:cancelUpload", (_e, uploadId) => {
    const u = uploads.get(uploadId);
    if (u) u.controller.abort();
    return true;
  });

  // Mo file de xem: tai + giai ma ra file tam roi mo bang ung dung mac dinh
  ipcMain.handle("files:open", async (_e, id) => {
    const key = requireKey();
    const f = E.metadata.findFile(id);
    if (!f) throw new Error("Khong tim thay file.");
    const dir = path.join(os.tmpdir(), "driver-cloud-view");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, f.name);
    await E.downloader.downloadFile(id, out, key, {
      onProgress: (done, total) => send("progress", { kind: "download", name: f.name, done, total }),
    });
    await shell.openPath(out);
    return true;
  });

  function uniquePath(dir, name) {
    if (!fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    const ext = path.extname(name), base = path.basename(name, ext);
    let i = 1;
    while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
    return path.join(dir, `${base} (${i})${ext}`);
  }

  // Tai ve: TU DONG luu vao thu muc Downloads (khong hoi cho luu)
  ipcMain.handle("files:download", async (_e, id) => {
    const key = requireKey();
    const f = E.metadata.findFile(id);
    if (!f) throw new Error("Khong tim thay file.");
    const out = uniquePath(app.getPath("downloads"), f.name);
    await E.downloader.downloadFile(id, out, key, {
      onProgress: (done, total) => send("progress", { kind: "download", name: f.name, done, total }),
    });
    send("toast", { type: "ok", message: `Đã tải về Downloads: ${path.basename(out)}` });
    return true;
  });

  // Xem trong app: tai+giai ma ra PREVIEW_DIR, tra ve loai (image/video/other)
  ipcMain.handle("files:preview", async (_e, id) => {
    const key = requireKey();
    const f = E.metadata.findFile(id);
    if (!f) throw new Error("Khong tim thay file.");
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const kind = IMG_EXT.includes(ext) ? "image" : VID_EXT.includes(ext) ? "video" : "other";
    if (kind === "other") return { kind, name: f.name };
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    const out = path.join(PREVIEW_DIR, f.name);
    if (!fs.existsSync(out) || fs.statSync(out).size !== f.size) {
      await E.downloader.downloadFile(id, out, key, {
        onProgress: (done, total) => send("progress", { kind: "download", name: f.name, done, total }),
      });
    }
    return { kind, name: f.name };
  });

  // Bat/tat trang thai trashed cua tat ca chunk cua 1 file, QUA API GOOGLE DRIVE.
  // Cac chunk se vao/ra khoi Thung rac that cua tung account (Google tu xoa sau 30 ngay).
  async function setChunksTrashed(f, trashed) {
    const accById = new Map(E.accounts.loadAccounts().map((a) => [a.id, a]));
    await Promise.all(
      f.blocks.map(async (b) => {
        if (!b.driveFileId) return;
        const acc = accById.get(b.accountId);
        if (!acc) return;
        try {
          await E.accounts.driveFor(acc).files.update({
            fileId: b.driveFileId,
            requestBody: { trashed },
          });
        } catch {}
      })
    );
  }

  // Xoa: dua file vao Thung rac that cua Google Drive (tren tung account)
  ipcMain.handle("files:remove", async (_e, id) => {
    const f = E.metadata.findFile(id);
    if (!f) return false;
    await setChunksTrashed(f, true);
    E.metadata.trashFile(id, new Date().toISOString());
    return true;
  });

  // Khoi phuc: bo trashed tren Google Drive
  ipcMain.handle("files:restore", async (_e, id) => {
    const f = E.metadata.findFile(id);
    if (!f) return false;
    await setChunksTrashed(f, false);
    E.metadata.restoreFile(id);
    return true;
  });

  ipcMain.handle("trash:list", () => {
    const em = emailMap();
    return E.metadata.listTrash().map((f) => mapFile(f, em));
  });

  // Xoa that 1 file (block tren Drive + metadata)
  async function purge(f) {
    const accById = new Map(E.accounts.loadAccounts().map((a) => [a.id, a]));
    for (const b of f.blocks) {
      if (!b.driveFileId) continue;
      const acc = accById.get(b.accountId);
      if (acc) {
        try {
          await E.accounts.driveFor(acc).files.delete({ fileId: b.driveFileId });
        } catch {}
      }
    }
    E.metadata.removeFile(f.id);
  }

  ipcMain.handle("files:deleteForever", async (_e, id) => {
    const f = E.metadata.findFile(id);
    if (f) await purge(f);
    return true;
  });

  ipcMain.handle("trash:empty", async () => {
    for (const f of E.metadata.listTrash()) await purge(f);
    return true;
  });
}

app.whenReady().then(async () => {
  await loadEngine();
  // Che do khong mat khau: tu tao/doc khoa ngam -> bo qua buoc nhap mat khau
  masterKey = E.crypto.ensureKeyNoPassword();
  // Phuc vu file da giai ma trong PREVIEW_DIR qua dcmedia:// (ho tro tua video)
  protocol.handle("dcmedia", (request) => {
    const u = new URL(request.url);
    const name = path.basename(decodeURIComponent(u.pathname.replace(/^\//, "")));
    const fp = path.join(PREVIEW_DIR, name);
    return net.fetch(pathToFileURL(fp).toString());
  });
  registerIpc();
  createWindow();
  createTray();
  setupAutoUpdate();
});

// ===== Tu dong cap nhat (electron-updater) =====
function setupAutoUpdate() {
  if (!app.isPackaged) return; // chi chay o ban da dong goi
  let autoUpdater;
  try { autoUpdater = require("electron-updater").autoUpdater; } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", (info) => {
    try { new Notification({ title: "Driver Cloud", body: `Có bản mới ${info.version}, đang tải nền…` }).show(); } catch {}
  });
  autoUpdater.on("update-downloaded", (info) => {
    const r = dialog.showMessageBoxSync(win, {
      type: "info", title: "Cập nhật Driver Cloud",
      message: `Đã tải bản mới ${info.version}`,
      detail: "Khởi động lại để cập nhật (không cần tải/cài lại thủ công).",
      buttons: ["Cập nhật & khởi động lại", "Để sau"], cancelId: 1,
    });
    if (r === 0) { app.isQuitting = true; autoUpdater.quitAndInstall(); }
  });
  autoUpdater.on("error", (e) => console.log("[updater]", e?.message || e));
  autoUpdater.checkForUpdates().catch(() => {});
  // kiem tra lai moi 6 tieng
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}
// Khong thoat khi dong cua so - app chay ngam trong khay (chi thoat qua menu Thoat)
app.on("window-all-closed", () => {});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
