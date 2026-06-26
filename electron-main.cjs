// Tien trinh chinh cua Electron (CommonJS de tranh loi ESM-interop cua Electron).
// Engine viet bang ESM nen duoc nap qua dynamic import() khi app san sang.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VID_EXT = ["mp4", "webm", "ogg", "ogv", "mov", "m4v"];
const PREVIEW_DIR = path.join(os.tmpdir(), "driver-cloud-view");
let sharp = null;
try { sharp = require("sharp"); } catch {}

// Dang ky scheme dcmedia (phai goi TRUOC khi app ready) de phat anh/video trong app
protocol.registerSchemesAsPrivileged([
  { scheme: "dcmedia", privileges: { secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
]);

const APP_ROOT = __dirname;
let masterKey = null;
let win = null;
let E = null; // gom cac module engine sau khi import

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
  const [config, crypto, accounts, auth, uploader, downloader, metadata, webdav] = await Promise.all([
    imp("config.js"),
    imp("crypto.js"),
    imp("accounts.js"),
    imp("auth.js"),
    imp("uploader.js"),
    imp("downloader.js"),
    imp("metadata.js"),
    imp("webdav.js"),
  ]);
  E = { config, crypto, accounts, auth, uploader, downloader, metadata, webdav };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#0f1220",
    title: "Driver Cloud",
    icon: path.join(APP_ROOT, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  const indexPath = path.join(APP_ROOT, "renderer", "index.html");
  console.log("[main] loading", indexPath, "exists?", fs.existsSync(indexPath));
  win.loadFile(indexPath);

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

function toggleMount() {
  if (!davServer) {
    try { davServer = E.webdav.startWebdav(DAV_PORT); } catch (e) {
      return dialog.showMessageBox(win, { type: "error", message: "Không bật được WebDAV", detail: String(e) });
    }
    if (process.platform === "win32") {
      // Thu map o dia tu dong (can dich vu WebClient dang chay)
      exec(`net use * \\\\localhost@${DAV_PORT}\\DavWWWRoot /persistent:no`, (err, stdout) => {
        dialog.showMessageBox(win, {
          type: "info", title: "Mount ổ đĩa",
          message: err ? "Đã bật ổ đĩa WebDAV." : "Đã mount thành ổ đĩa!",
          detail: (err
            ? `Map thủ công: File Explorer → This PC → Map network drive → http://localhost:${DAV_PORT}\n(Cần bật dịch vụ "WebClient" trong services.msc.)`
            : (stdout || "")) + `\n\nĐịa chỉ: http://localhost:${DAV_PORT}`,
        });
      });
    } else if (process.platform === "darwin") {
      exec(`osascript -e 'mount volume "http://localhost:${DAV_PORT}"'`, (err) => {
        if (err) dialog.showMessageBox(win, { type: "info", message: "Đã bật WebDAV", detail: `Finder → Go → Connect to Server → http://localhost:${DAV_PORT}` });
      });
    } else {
      dialog.showMessageBox(win, { type: "info", message: "Đã bật WebDAV", detail: `Mount: dav://localhost:${DAV_PORT}/` });
    }
  } else {
    davServer.close(); davServer = null;
    if (process.platform === "win32") exec(`net use \\\\localhost@${DAV_PORT}\\DavWWWRoot /delete /y`, () => {});
    dialog.showMessageBox(win, { type: "info", message: "Đã ngắt ổ đĩa WebDAV." });
  }
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mở Driver Cloud", click: showWin },
      { label: davServer ? "⏏ Ngắt ổ đĩa (WebDAV)" : "💽 Mount thành ổ đĩa (WebDAV)", click: toggleMount },
      {
        label: "Khởi động cùng máy", type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, openAsHidden: true }),
      },
      { type: "separator" },
      { label: "Thoát", click: () => { app.isQuitting = true; if (davServer) try { davServer.close(); } catch {} ; app.quit(); } },
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
});
// Khong thoat khi dong cua so - app chay ngam trong khay (chi thoat qua menu Thoat)
app.on("window-all-closed", () => {});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
