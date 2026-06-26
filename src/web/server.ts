import express from "express";
import busboy from "busboy";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAccounts, addAccount, removeAccount, getAllQuotas, driveFor,
} from "../accounts.js";
import { getAuthUrl, exchangeCode } from "../auth.js";
import { ensureKeyNoPassword } from "../crypto.js";
import { uploadFile } from "../uploader.js";
import { downloadFile } from "../downloader.js";
import { writeJSON, dataPaths } from "../config.js";
import {
  listDir, findFile, createFolder, renameFolder, filesUnder, removeFolderEntries,
  renameFile, moveFile, trashFile, restoreFile, listTrash, setThumb, removeFile,
} from "../metadata.js";
import { register, verify, findById, userDir, DATA_ROOT } from "./users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const TMP = path.join(os.tmpdir(), "driver-cloud-web");
fs.mkdirSync(TMP, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VID_EXT = ["mp4", "webm", "ogg", "ogv", "mov", "m4v"];

const sessions = new Map<string, string>(); // sid -> userId
const app = express();
app.use(express.json());

function parseCookie(h?: string): Record<string, string> {
  const o: Record<string, string> = {};
  (h || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function setSession(res: express.Response, userId: string) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, userId);
  res.setHeader("Set-Cookie", `dcsid=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
}
function currentUserId(req: express.Request): string | null {
  const sid = parseCookie(req.headers.cookie)["dcsid"];
  return sid && sessions.has(sid) ? sessions.get(sid)! : null;
}
// dir du lieu cua user dang dang nhap
function reqDir(req: express.Request): string {
  return userDir(currentUserId(req)!);
}

// ===== Auth routes (khong can dang nhap) =====
app.post("/register", (req, res) => {
  try {
    const u = register(req.body.username, req.body.password);
    setSession(res, u.id);
    res.json({ ok: true, username: u.username });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.post("/login", (req, res) => {
  const u = verify(req.body.username || "", req.body.password || "");
  if (!u) return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  setSession(res, u.id);
  res.json({ ok: true, username: u.username });
});
app.post("/logout", (req, res) => {
  const sid = parseCookie(req.headers.cookie)["dcsid"];
  if (sid) sessions.delete(sid);
  res.json({ ok: true });
});

// ===== Chan: moi route khac phai dang nhap =====
app.use((req, res, next) => {
  const open = ["/login", "/register", "/login.html", "/style.css", "/login.js"];
  if (open.includes(req.path)) return next();
  if (currentUserId(req)) return next();
  if (req.path.startsWith("/api") || req.path.startsWith("/oauth")) return res.status(401).json({ error: "Chưa đăng nhập" });
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/api/me", (req, res) => {
  const u = findById(currentUserId(req)!);
  res.json({ username: u?.username });
});

// ===== OAuth client (BYO) cua tung user =====
app.get("/api/oauth/status", (req, res) => {
  res.json({ hasClient: fs.existsSync(dataPaths(reqDir(req)).oauthClient), redirectUri: REDIRECT_URI });
});
app.post("/api/oauth/client", (req, res) => {
  writeJSON(dataPaths(reqDir(req)).oauthClient, { client_id: req.body.clientId, client_secret: req.body.clientSecret });
  res.json({ ok: true });
});
app.get("/oauth/start", (req, res) => {
  try { res.redirect(getAuthUrl(REDIRECT_URI, reqDir(req))); }
  catch (e: any) { res.status(400).send(e.message); }
});
app.get("/oauth/callback", async (req, res) => {
  try {
    const dir = reqDir(req);
    const { email, refreshToken } = await exchangeCode(String(req.query.code || ""), REDIRECT_URI, dir);
    addAccount({ id: email, email, refreshToken, addedAt: new Date().toISOString() }, dir);
    res.redirect("/");
  } catch (e: any) { res.status(500).send("Loi OAuth: " + e.message); }
});

// ===== Accounts =====
app.get("/api/accounts", async (req, res) => {
  const quotas = await getAllQuotas(reqDir(req));
  res.json(quotas.map((q) => ({ id: q.account.id, email: q.account.email, totalBytes: q.totalBytes, usedBytes: q.usedBytes, freeBytes: q.freeBytes })));
});
app.post("/api/accounts/disconnect", (req, res) => { removeAccount(req.body.id, reqDir(req)); res.json({ ok: true }); });

// ===== Helper =====
const emailMap = (dir: string) => new Map(loadAccounts(dir).map((a) => [a.id, a.email]));
function mapFile(f: any, emails: Map<string, string>) {
  return { id: f.id, name: f.name, path: f.path, dir: f.dir, size: f.size, complete: f.complete, thumb: f.thumb || null, account: f.blocks[0] ? emails.get(f.blocks[0].accountId) || "?" : "?" };
}

// ===== Duyet =====
app.get("/api/list", (req, res) => {
  const dir = reqDir(req); const em = emailMap(dir);
  const r = listDir(String(req.query.dir || "/"), dir);
  res.json({ folders: r.folders, files: r.files.map((f) => mapFile(f, em)) });
});
app.get("/api/trash", (req, res) => { const dir = reqDir(req); const em = emailMap(dir); res.json(listTrash(dir).map((f) => mapFile(f, em))); });
app.post("/api/folder", (req, res) => res.json({ path: createFolder(req.body.dir || "/", req.body.name, reqDir(req)) }));
app.post("/api/folder/rename", (req, res) => { renameFolder(req.body.dir, req.body.newName, reqDir(req)); res.json({ ok: true }); });
app.post("/api/rename", (req, res) => { renameFile(req.body.id, req.body.newName, reqDir(req)); res.json({ ok: true }); });
app.post("/api/move", (req, res) => { moveFile(req.body.id, req.body.dir, reqDir(req)); res.json({ ok: true }); });

// ===== Trash qua API Google =====
async function setChunksTrashed(f: any, trashed: boolean, dir: string) {
  const accById = new Map(loadAccounts(dir).map((a) => [a.id, a]));
  await Promise.all(f.blocks.map(async (b: any) => {
    if (!b.driveFileId) return; const acc = accById.get(b.accountId); if (!acc) return;
    try { await driveFor(acc, dir).files.update({ fileId: b.driveFileId, requestBody: { trashed } }); } catch {}
  }));
}
async function purge(f: any, dir: string) {
  const accById = new Map(loadAccounts(dir).map((a) => [a.id, a]));
  for (const b of f.blocks) { if (!b.driveFileId) continue; const acc = accById.get(b.accountId); if (acc) { try { await driveFor(acc, dir).files.delete({ fileId: b.driveFileId }); } catch {} } }
  removeFile(f.id, dir);
}
app.post("/api/remove", async (req, res) => { const dir = reqDir(req); const f = findFile(req.body.id, dir); if (f) { await setChunksTrashed(f, true, dir); trashFile(f.id, new Date().toISOString(), dir); } res.json({ ok: true }); });
app.post("/api/restore", async (req, res) => { const dir = reqDir(req); const f = findFile(req.body.id, dir); if (f) { await setChunksTrashed(f, false, dir); restoreFile(f.id, dir); } res.json({ ok: true }); });
app.post("/api/deleteForever", async (req, res) => { const dir = reqDir(req); const f = findFile(req.body.id, dir); if (f) await purge(f, dir); res.json({ ok: true }); });
app.post("/api/emptyTrash", async (req, res) => { const dir = reqDir(req); for (const f of listTrash(dir)) await purge(f, dir); res.json({ ok: true }); });
app.post("/api/removeFolder", async (req, res) => { const dir = reqDir(req); for (const f of filesUnder(req.body.dir, dir)) await purge(f, dir); removeFolderEntries(req.body.dir, dir); res.json({ ok: true }); });

// ===== Upload =====
app.post("/api/upload", (req, res) => {
  const dir = reqDir(req);
  const key = ensureKeyNoPassword(dir);
  const targetDir = String(req.query.dir || "/");
  const bb = busboy({ headers: req.headers });
  let finished = false;
  bb.on("file", (_n, stream, info) => {
    const fileName = info.filename;
    const tmpPath = path.join(TMP, crypto.randomUUID() + "_" + fileName);
    const ws = fs.createWriteStream(tmpPath);
    stream.pipe(ws);
    ws.on("close", async () => {
      if (finished) return; finished = true;
      try {
        const logical = await uploadFile(tmpPath, key, { dir: targetDir, dataDir: dir });
        const ext = (fileName.split(".").pop() || "").toLowerCase();
        if (IMG_EXT.includes(ext)) {
          try {
            const sharp = (await import("sharp")).default;
            const buf = await sharp(tmpPath).rotate().resize(300, 300, { fit: "cover" }).webp({ quality: 72 }).toBuffer();
            setThumb(logical.id, "data:image/webp;base64," + buf.toString("base64"), dir);
          } catch {}
        }
        fs.unlink(tmpPath, () => {});
        res.json({ ok: true, id: logical.id });
      } catch (e: any) { fs.unlink(tmpPath, () => {}); res.status(500).json({ error: e.message }); }
    });
  });
  bb.on("error", (e: any) => res.status(500).json({ error: e.message }));
  req.pipe(bb);
});

// ===== Download / Preview =====
async function ensureDecrypted(req: express.Request, id: string): Promise<{ file: any; out: string }> {
  const dir = reqDir(req);
  const f = findFile(id, dir);
  if (!f) throw new Error("Khong tim thay file");
  const out = path.join(TMP, currentUserId(req) + "_" + id + "_" + f.name);
  if (!fs.existsSync(out) || fs.statSync(out).size !== f.size) {
    await downloadFile(id, out, ensureKeyNoPassword(dir), { dataDir: dir });
  }
  return { file: f, out };
}
app.get("/api/download/:id", async (req, res) => {
  try { const { file, out } = await ensureDecrypted(req, req.params.id); res.download(out, file.name); }
  catch (e: any) { res.status(404).send(e.message); }
});
app.get("/api/preview/:id", async (req, res) => {
  try {
    const { file, out } = await ensureDecrypted(req, req.params.id);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (IMG_EXT.includes(ext) || VID_EXT.includes(ext)) res.sendFile(out);
    else res.download(out, file.name);
  } catch (e: any) { res.status(404).send(e.message); }
});

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`\nDriver Cloud Web (multi-user) chay tai: ${BASE_URL}`);
  console.log(`Du lieu luu o: ${DATA_ROOT}`);
  console.log(`OAuth redirect URI (moi user dang ky o console cua ho): ${REDIRECT_URI}\n`);
});
