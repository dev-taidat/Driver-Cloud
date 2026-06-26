// ===== WebDAV server cho Driver Cloud =====
// Map kho luu tru (gop Drive + ma hoa + chunk) thanh o dia mang. HDH co san client WebDAV
// (Windows Map network drive / macOS Connect to Server) -> KHONG can cai driver.
// Dung duoc: chay standalone (`npm run webdav`) hoac goi startWebdav() tu app desktop.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "./config.js";
import { ensureKeyNoPassword } from "./crypto.js";
import {
  listDir, findFile, createFolder, removeFolderEntries, filesUnder,
  renameFile, moveFile, renameFolder, listFolders, removeFile, parentOf, baseName,
} from "./metadata.js";
import { loadAccounts, driveFor } from "./accounts.js";
import { uploadFile } from "./uploader.js";
import { downloadFile } from "./downloader.js";

const TMP = path.join(os.tmpdir(), "driver-cloud-dav");
let KEY: Buffer;
let DIR = DATA_DIR;

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function urlToPath(u: string): string {
  let p = decodeURIComponent((u.split("?")[0] || "/"));
  p = p.replace(/\/+$/, "");
  if (!p.startsWith("/")) p = "/" + p;
  return p === "" ? "/" : p;
}
function isFolder(p: string): boolean {
  return p === "/" || listFolders(DIR).includes(p);
}
function propResponse(href: string, isCol: boolean, size: number, name: string, mtime: string): string {
  const collProp = isCol ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>";
  const sizeProp = isCol ? "" : `<D:getcontentlength>${size}</D:getcontentlength>`;
  return `<D:response><D:href>${xmlEsc(href)}</D:href><D:propstat><D:prop>` +
    `<D:displayname>${xmlEsc(name)}</D:displayname>${collProp}${sizeProp}` +
    `<D:getlastmodified>${new Date(mtime || Date.now()).toUTCString()}</D:getlastmodified>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}
function hrefFor(p: string, isCol: boolean): string {
  const enc = p === "/" ? "/" : p.split("/").map(encodeURIComponent).join("/");
  return isCol && p !== "/" ? enc + "/" : enc;
}

async function handlePropfind(p: string, depth: string, res: http.ServerResponse) {
  const file = isFolder(p) ? null : findFile(p, DIR);
  if (!isFolder(p) && !file) { res.writeHead(404).end(); return; }
  let body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
  if (isFolder(p)) {
    body += propResponse(hrefFor(p, true), true, 0, p === "/" ? "Driver Cloud" : baseName(p), "");
    if (depth !== "0") {
      const { folders, files } = listDir(p, DIR);
      for (const f of folders) body += propResponse(hrefFor(f, true), true, 0, baseName(f), "");
      for (const f of files) if (f.complete) body += propResponse(hrefFor(f.path, false), false, f.size, f.name, f.createdAt);
    }
  } else if (file) {
    body += propResponse(hrefFor(file.path, false), false, file.size, file.name, file.createdAt);
  }
  body += `</D:multistatus>`;
  res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' });
  res.end(body);
}

async function handleGet(p: string, req: http.IncomingMessage, res: http.ServerResponse, headOnly: boolean) {
  const file = findFile(p, DIR);
  if (!file || !file.complete) { res.writeHead(404).end(); return; }
  const out = path.join(TMP, file.id + "_" + file.name);
  if (!fs.existsSync(out) || fs.statSync(out).size !== file.size) await downloadFile(file.id, out, KEY, { dataDir: DIR });
  const total = file.size;
  const range = req.headers.range;
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1]) : 0;
    const end = m && m[2] ? parseInt(m[2]) : total - 1;
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
    headers["Content-Length"] = String(end - start + 1);
    res.writeHead(206, headers);
    if (headOnly) return res.end();
    fs.createReadStream(out, { start, end }).pipe(res);
  } else {
    headers["Content-Length"] = String(total);
    res.writeHead(200, headers);
    if (headOnly) return res.end();
    fs.createReadStream(out).pipe(res);
  }
}

async function purge(f: any) {
  const accById = new Map(loadAccounts(DIR).map((a) => [a.id, a]));
  for (const b of f.blocks) {
    if (!b.driveFileId) continue;
    const acc = accById.get(b.accountId);
    if (acc) { try { await driveFor(acc, DIR).files.delete({ fileId: b.driveFileId }); } catch {} }
  }
  removeFile(f.id, DIR);
}

async function handlePut(p: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const dir = parentOf(p);
  const name = baseName(p);
  const tmp = path.join(TMP, crypto.randomUUID() + "_" + name);
  const ws = fs.createWriteStream(tmp);
  req.pipe(ws);
  ws.on("close", async () => {
    try {
      const existing = findFile(p, DIR);
      if (existing) await purge(existing);
      await uploadFile(tmp, KEY, { dir, dataDir: DIR });
      fs.unlink(tmp, () => {});
      res.writeHead(existing ? 204 : 201).end();
    } catch (e: any) { fs.unlink(tmp, () => {}); res.writeHead(500).end(e.message); }
  });
  ws.on("error", () => res.writeHead(500).end());
}

async function handleDelete(p: string, res: http.ServerResponse) {
  if (isFolder(p)) { for (const f of filesUnder(p, DIR)) await purge(f); removeFolderEntries(p, DIR); }
  else { const f = findFile(p, DIR); if (f) await purge(f); }
  res.writeHead(204).end();
}

async function handleMove(p: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const destRaw = (req.headers["destination"] as string) || "";
  let dest = destRaw;
  try { dest = urlToPath(new URL(destRaw).pathname); } catch { dest = urlToPath(destRaw.replace(/^https?:\/\/[^/]+/, "")); }
  const newName = baseName(dest);
  const newDir = parentOf(dest);
  if (isFolder(p)) {
    renameFolder(p, newName, DIR);
  } else {
    const f = findFile(p, DIR);
    if (f) { if (f.dir !== newDir) moveFile(f.id, newDir, DIR); if (f.name !== newName) renameFile(f.id, newName, DIR); }
  }
  res.writeHead(201).end();
}

export function startWebdav(port = Number(process.env.DAV_PORT) || 4000, dataDir = DATA_DIR): http.Server {
  DIR = dataDir;
  fs.mkdirSync(TMP, { recursive: true });
  KEY = ensureKeyNoPassword(DIR);
  const server = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const p = urlToPath(req.url || "/");
    try {
      switch (method) {
        case "OPTIONS":
          res.writeHead(200, { DAV: "1,2", "MS-Author-Via": "DAV", Allow: "OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,PROPPATCH,MKCOL,MOVE,COPY,LOCK,UNLOCK" }).end();
          break;
        case "PROPFIND": await handlePropfind(p, (req.headers["depth"] as string) || "1", res); break;
        case "GET": await handleGet(p, req, res, false); break;
        case "HEAD": await handleGet(p, req, res, true); break;
        case "PUT": await handlePut(p, req, res); break;
        case "DELETE": await handleDelete(p, res); break;
        case "MKCOL": createFolder(parentOf(p), baseName(p), DIR); res.writeHead(201).end(); break;
        case "MOVE": await handleMove(p, req, res); break;
        case "COPY": res.writeHead(403).end(); break;
        case "PROPPATCH":
          res.writeHead(207, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${xmlEsc(req.url || "/")}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
          break;
        case "LOCK": {
          const token = "opaquelocktoken:" + crypto.randomUUID();
          res.writeHead(200, { "Content-Type": "application/xml", "Lock-Token": `<${token}>` })
            .end(`<?xml version="1.0"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
          break;
        }
        case "UNLOCK": res.writeHead(204).end(); break;
        default: res.writeHead(405).end();
      }
    } catch (e: any) { res.writeHead(500).end(String(e.message || e)); }
  });
  server.listen(port, () => console.log(`Driver Cloud WebDAV: http://localhost:${port}`));
  return server;
}

// Chay standalone (npm run webdav / tsx src/webdav.ts)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebdav();
}
