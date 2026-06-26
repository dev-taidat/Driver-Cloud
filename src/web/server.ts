import express from "express";
import busboy from "busboy";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAccounts,
  addAccount,
  removeAccount,
  getAllQuotas,
  driveFor,
} from "../accounts.js";
import { getAuthUrl, exchangeCode } from "../auth.js";
import { ensureKeyNoPassword } from "../crypto.js";
import { uploadFile } from "../uploader.js";
import { downloadFile } from "../downloader.js";
import {
  listDir,
  findFile,
  createFolder,
  renameFolder,
  filesUnder,
  removeFolderEntries,
  renameFile,
  moveFile,
  trashFile,
  restoreFile,
  listTrash,
  setThumb,
} from "../metadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const TMP = path.join(os.tmpdir(), "driver-cloud-web");
fs.mkdirSync(TMP, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
// Dia chi cong khai cua server (de Google redirect ve dung). Vd: https://abc.com
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

// Mat khau dang nhap web (BAT BUOC khi deploy online)
let WEB_PASSWORD = process.env.WEB_PASSWORD || "";
if (!WEB_PASSWORD) {
  WEB_PASSWORD = crypto.randomBytes(4).toString("hex");
  console.log(`\n[!] Chua dat WEB_PASSWORD. Mat khau tam thoi: ${WEB_PASSWORD}\n`);
}

const masterKey = ensureKeyNoPassword();
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VID_EXT = ["mp4", "webm", "ogg", "ogv", "mov", "m4v"];

const sessions = new Set<string>();
const app = express();
app.use(express.json());

// ===== Cookie + dang nhap =====
function parseCookie(h: string | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  (h || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
function authed(req: express.Request): boolean {
  const sid = parseCookie(req.headers.cookie)["dcsid"];
  return !!sid && sessions.has(sid);
}

app.post("/login", (req, res) => {
  if (req.body?.password === WEB_PASSWORD) {
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.add(sid);
    res.setHeader("Set-Cookie", `dcsid=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Sai mat khau" });
  }
});

// Chan moi route tru trang login & tai nguyen tinh login
app.use((req, res, next) => {
  if (req.path === "/login" || req.path === "/login.html" || req.path === "/login.js") return next();
  if (authed(req)) return next();
  if (req.path.startsWith("/api") || req.path.startsWith("/oauth")) return res.status(401).json({ error: "Chua dang nhap" });
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

// ===== OAuth them tai khoan =====
app.get("/oauth/start", (_req, res) => res.redirect(getAuthUrl(REDIRECT_URI)));
app.get("/oauth/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const { email, refreshToken } = await exchangeCode(code, REDIRECT_URI);
    addAccount({ id: email, email, refreshToken, addedAt: new Date().toISOString() });
    res.redirect("/");
  } catch (e: any) {
    res.status(500).send("Loi OAuth: " + e.message);
  }
});

// ===== API tai khoan & dung luong =====
app.get("/api/accounts", async (_req, res) => {
  const quotas = await getAllQuotas();
  res.json(
    quotas.map((q) => ({
      id: q.account.id,
      email: q.account.email,
      totalBytes: q.totalBytes,
      usedBytes: q.usedBytes,
      freeBytes: q.freeBytes,
    }))
  );
});
app.post("/api/accounts/disconnect", (req, res) => {
  removeAccount(req.body.id);
  res.json({ ok: true });
});

// ===== Helper map file (kem account + thumb) =====
const emailMap = () => new Map(loadAccounts().map((a) => [a.id, a.email]));
function mapFile(f: any, emails: Map<string, string>) {
  return {
    id: f.id, name: f.name, path: f.path, dir: f.dir, size: f.size,
    complete: f.complete, thumb: f.thumb || null,
    account: f.blocks[0] ? emails.get(f.blocks[0].accountId) || "?" : "?",
  };
}

// ===== Duyet thu muc =====
app.get("/api/list", (req, res) => {
  const em = emailMap();
  const r = listDir(String(req.query.dir || "/"));
  res.json({ folders: r.folders, files: r.files.map((f) => mapFile(f, em)) });
});
app.get("/api/trash", (_req, res) => {
  const em = emailMap();
  res.json(listTrash().map((f) => mapFile(f, em)));
});
app.post("/api/folder", (req, res) => res.json({ path: createFolder(req.body.dir || "/", req.body.name) }));
app.post("/api/folder/rename", (req, res) => { renameFolder(req.body.dir, req.body.newName); res.json({ ok: true }); });
app.post("/api/rename", (req, res) => { renameFile(req.body.id, req.body.newName); res.json({ ok: true }); });
app.post("/api/move", (req, res) => { moveFile(req.body.id, req.body.dir); res.json({ ok: true }); });

// ===== Trash qua API Google + metadata =====
async function setChunksTrashed(f: any, trashed: boolean) {
  const accById = new Map(loadAccounts().map((a) => [a.id, a]));
  await Promise.all(
    f.blocks.map(async (b: any) => {
      if (!b.driveFileId) return;
      const acc = accById.get(b.accountId);
      if (!acc) return;
      try { await driveFor(acc).files.update({ fileId: b.driveFileId, requestBody: { trashed } }); } catch {}
    })
  );
}
async function purge(f: any) {
  const accById = new Map(loadAccounts().map((a) => [a.id, a]));
  for (const b of f.blocks) {
    if (!b.driveFileId) continue;
    const acc = accById.get(b.accountId);
    if (acc) { try { await driveFor(acc).files.delete({ fileId: b.driveFileId }); } catch {} }
  }
  const { removeFile } = await import("../metadata.js");
  removeFile(f.id);
}
app.post("/api/remove", async (req, res) => { const f = findFile(req.body.id); if (f) { await setChunksTrashed(f, true); trashFile(f.id, new Date().toISOString()); } res.json({ ok: true }); });
app.post("/api/restore", async (req, res) => { const f = findFile(req.body.id); if (f) { await setChunksTrashed(f, false); restoreFile(f.id); } res.json({ ok: true }); });
app.post("/api/deleteForever", async (req, res) => { const f = findFile(req.body.id); if (f) await purge(f); res.json({ ok: true }); });
app.post("/api/emptyTrash", async (_req, res) => { for (const f of listTrash()) await purge(f); res.json({ ok: true }); });
app.post("/api/removeFolder", async (req, res) => {
  const dir = req.body.dir;
  for (const f of filesUnder(dir)) await purge(f);
  removeFolderEntries(dir);
  res.json({ ok: true });
});

// ===== Upload (stream tu trinh duyet -> file tam -> engine) =====
app.post("/api/upload", (req, res) => {
  const dir = String(req.query.dir || "/");
  const bb = busboy({ headers: req.headers });
  let tmpPath = "";
  let fileName = "";
  let finished = false;
  bb.on("file", (_name, stream, info) => {
    fileName = info.filename;
    tmpPath = path.join(TMP, crypto.randomUUID() + "_" + info.filename);
    const ws = fs.createWriteStream(tmpPath);
    stream.pipe(ws);
    ws.on("close", async () => {
      if (finished) return;
      finished = true;
      try {
        const logical = await uploadFile(tmpPath, masterKey, { dir });
        const ext = (fileName.split(".").pop() || "").toLowerCase();
        if (IMG_EXT.includes(ext)) {
          try {
            const sharp = (await import("sharp")).default;
            const buf = await sharp(tmpPath).rotate().resize(300, 300, { fit: "cover" }).webp({ quality: 72 }).toBuffer();
            setThumb(logical.id, "data:image/webp;base64," + buf.toString("base64"));
          } catch {}
        }
        fs.unlink(tmpPath, () => {});
        res.json({ ok: true, id: logical.id });
      } catch (e: any) {
        fs.unlink(tmpPath, () => {});
        res.status(500).json({ error: e.message });
      }
    });
  });
  bb.on("error", (e: any) => res.status(500).json({ error: e.message }));
  req.pipe(bb);
});

// ===== Download / Preview (giai ma ra file tam roi gui, ho tro tua video) =====
async function ensureDecrypted(id: string): Promise<{ file: any; out: string }> {
  const f = findFile(id);
  if (!f) throw new Error("Khong tim thay file");
  const out = path.join(TMP, "view_" + id + "_" + f.name);
  if (!fs.existsSync(out) || fs.statSync(out).size !== f.size) {
    await downloadFile(id, out, masterKey, {});
  }
  return { file: f, out };
}
app.get("/api/download/:id", async (req, res) => {
  try { const { file, out } = await ensureDecrypted(req.params.id); res.download(out, file.name); }
  catch (e: any) { res.status(404).send(e.message); }
});
app.get("/api/preview/:id", async (req, res) => {
  try {
    const { file, out } = await ensureDecrypted(req.params.id);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (IMG_EXT.includes(ext) || VID_EXT.includes(ext)) res.sendFile(out); // sendFile ho tro Range
    else res.download(out, file.name);
  } catch (e: any) { res.status(404).send(e.message); }
});

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`\nDriver Cloud Web chay tai: ${BASE_URL}`);
  console.log(`(local: http://localhost:${PORT})`);
  console.log(`OAuth redirect URI can dang ky o Google: ${REDIRECT_URI}\n`);
});
