// ===== WebDAV BRIDGE (o kieu NAS) =====
// Metadata (liet ke/xoa/tao/doi ten) goi API web bang cookie. Byte (GET/PUT) di THANG engine
// cuc bo (io.fetchRange / io.uploadDirect) -> nhanh, stream theo block (khong tai het, khong OOM).
import http from "node:http";
import { Readable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

type IO = {
  fetchRange?: (id: string, offset: number, length: number) => Promise<Buffer>;
  uploadDirect?: (localPath: string, cloudDir: string, replaceId?: string) => Promise<any>;
};
type Ctx = { base: string; cookie: string; io: IO };

const CAP = 150 * 1024 * 1024 * 1024 * 1024; // 150 TB - bao cho Explorer (hien dung luong "NAS")
const STREAM_CHUNK = 64 * 1024 * 1024;

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function parentOf(p: string): string { if (p === "/" || !p) return "/"; const t = p.replace(/\/+$/, ""); const i = t.lastIndexOf("/"); return i <= 0 ? "/" : t.slice(0, i); }
function baseName(p: string): string { const t = p.replace(/\/+$/, ""); return t.slice(t.lastIndexOf("/") + 1); }
function hrefFor(p: string, col: boolean): string { const enc = p === "/" ? "/" : p.split("/").map(encodeURIComponent).join("/"); return col && p !== "/" ? enc + "/" : enc; }

async function apiGet(ctx: Ctx, p: string) { return fetch(ctx.base + p, { headers: { Cookie: ctx.cookie } }); }
async function apiPost(ctx: Ctx, p: string, body: any) { return fetch(ctx.base + p, { method: "POST", headers: { Cookie: ctx.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

async function listDir(ctx: Ctx, dir: string): Promise<{ folders: string[]; files: any[] } | null> {
  const r = await apiGet(ctx, `/api/list?dir=${encodeURIComponent(dir)}`);
  if (!r.ok) return null;
  return (await r.json()) as any;
}
async function resolve(ctx: Ctx, p: string): Promise<{ kind: "folder" } | { kind: "file"; f: any } | null> {
  if (p === "/") return { kind: "folder" };
  const parent = await listDir(ctx, parentOf(p));
  if (!parent) return null;
  if (parent.folders.includes(p)) return { kind: "folder" };
  const f = parent.files.find((x: any) => x.path === p);
  return f ? { kind: "file", f } : null;
}

function propXml(href: string, col: boolean, size: number, name: string, root = false): string {
  const quota = root ? `<D:quota-available-bytes>${CAP}</D:quota-available-bytes><D:quota-used-bytes>0</D:quota-used-bytes>` : "";
  return `<D:response><D:href>${xmlEsc(href)}</D:href><D:propstat><D:prop>` +
    `<D:displayname>${xmlEsc(name)}</D:displayname>` +
    (col ? "<D:resourcetype><D:collection/></D:resourcetype>" : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength>`) +
    `<D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>${quota}` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}
function isJunk(p: string): boolean {
  const n = baseName(p);
  return n.startsWith(".") || n.startsWith("._") || n === "desktop.ini" || n === "Thumbs.db";
}
function urlToPath(u: string): string {
  let p = decodeURIComponent((u.split("?")[0] || "/")).replace(/\/+$/, "");
  if (!p.startsWith("/")) p = "/" + p;
  return p === "" ? "/" : p;
}

export function startWebdavBridge(port: number, base: string, cookie: string, io: IO = {}): http.Server {
  const ctx: Ctx = { base: base.replace(/\/+$/, ""), cookie, io };
  const server = http.createServer(async (req, res) => {
    const m = req.method || "GET";
    const p = urlToPath(req.url || "/");
    try {
      if (m === "OPTIONS") { res.writeHead(200, { DAV: "1,2", "MS-Author-Via": "DAV", Allow: "OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,PROPPATCH,MKCOL,MOVE,LOCK,UNLOCK" }).end(); return; }

      if (p !== "/" && isJunk(p)) {
        if (m === "PROPFIND" || m === "GET" || m === "HEAD") { res.writeHead(404).end(); return; }
        if (m === "LOCK") { res.writeHead(200, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktoken><D:href>opaquelocktoken:junk</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`); return; }
        res.writeHead(m === "PUT" || m === "MKCOL" ? 201 : 204).end(); return;
      }

      if (m === "PROPFIND") {
        const info = await resolve(ctx, p);
        if (!info) { res.writeHead(404).end(); return; }
        let body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
        if (info.kind === "folder") {
          body += propXml(hrefFor(p, true), true, 0, p === "/" ? "Driver Cloud" : baseName(p), p === "/");
          if ((req.headers["depth"] || "1") !== "0") {
            const d = await listDir(ctx, p);
            if (d) {
              for (const f of d.folders) body += propXml(hrefFor(f, true), true, 0, baseName(f));
              for (const f of d.files) if (f.complete) body += propXml(hrefFor(f.path, false), false, f.size, f.name);
            }
          }
        } else body += propXml(hrefFor(p, false), false, info.f.size, info.f.name);
        body += `</D:multistatus>`;
        res.writeHead(207, { "Content-Type": 'application/xml; charset="utf-8"' }).end(body);
        return;
      }

      if (m === "GET" || m === "HEAD") {
        const info = await resolve(ctx, p);
        if (!info || info.kind !== "file") { res.writeHead(404).end(); return; }
        const size = info.f.size as number;
        if (m === "HEAD") { res.writeHead(200, { "Content-Length": String(size), "Accept-Ranges": "bytes" }).end(); return; }
        // Range
        let start = 0, end = size - 1, status = 200;
        const range = req.headers.range;
        if (range) { const mm = /bytes=(\d+)-(\d*)/.exec(range); if (mm) { start = +mm[1]; end = mm[2] ? Math.min(+mm[2], size - 1) : size - 1; status = 206; } }
        const len = Math.max(0, end - start + 1);
        const h: Record<string, string> = { "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream", "Content-Length": String(len) };
        if (status === 206) h["Content-Range"] = `bytes ${start}-${end}/${size}`;
        res.writeHead(status, h);
        if (io.fetchRange) {
          // stream theo block 64MB -> khong nap het vao RAM, video phat ngay
          let pos = start;
          while (pos <= end) {
            const n = Math.min(STREAM_CHUNK, end - pos + 1);
            const buf = await io.fetchRange(info.f.id, pos, n);
            if (!res.write(buf)) await new Promise<void>((r) => res.once("drain", () => r()));
            pos += n;
          }
          res.end();
        } else { // fallback: proxy Railway
          const up = await fetch(`${ctx.base}/api/download/${info.f.id}`, { headers: range ? { Cookie: ctx.cookie, Range: range } : { Cookie: ctx.cookie } });
          if (up.body) Readable.fromWeb(up.body as any).pipe(res); else res.end();
        }
        return;
      }

      if (m === "PUT") {
        if (io.uploadDirect) {
          // ghi body ra file tam roi upload THANG (nhanh ~50MB/s, stream khong OOM)
          const tmp = path.join(os.tmpdir(), "dcdav_" + crypto.randomUUID());
          const ws = fs.createWriteStream(tmp);
          req.pipe(ws);
          ws.on("close", async () => {
            try {
              const existing = await resolve(ctx, p);
              const replaceId = existing && (existing as any).kind === "file" ? (existing as any).f.id : undefined;
              await io.uploadDirect!(tmp, parentOf(p), replaceId);
              res.writeHead(201).end();
            } catch (e: any) { res.writeHead(500).end(String(e?.message || e)); }
            finally { fs.unlink(tmp, () => {}); }
          });
          ws.on("error", () => { try { res.writeHead(500).end(); } catch {} });
        } else {
          const len = req.headers["content-length"]; const headers: any = { Cookie: ctx.cookie, "Content-Type": "application/octet-stream" }; if (len) headers["Content-Length"] = len;
          const up = await fetch(`${ctx.base}/api/upload-raw?dir=${encodeURIComponent(parentOf(p))}&name=${encodeURIComponent(baseName(p))}`, { method: "POST", headers, body: req as any, duplex: "half" } as any);
          res.writeHead(up.ok ? 201 : 500).end();
        }
        return;
      }

      if (m === "DELETE") {
        const info = await resolve(ctx, p);
        if (info?.kind === "folder") await apiPost(ctx, "/api/removeFolder", { dir: p });
        else if (info?.kind === "file") await apiPost(ctx, "/api/remove", { id: (info as any).f.id });
        res.writeHead(204).end();
        return;
      }

      if (m === "MKCOL") { await apiPost(ctx, "/api/folder", { dir: parentOf(p), name: baseName(p) }); res.writeHead(201).end(); return; }

      if (m === "MOVE") {
        const destRaw = (req.headers["destination"] as string) || "";
        let dest = destRaw; try { dest = urlToPath(new URL(destRaw).pathname); } catch { dest = urlToPath(destRaw.replace(/^https?:\/\/[^/]+/, "")); }
        const info = await resolve(ctx, p);
        if (info?.kind === "file") {
          if (parentOf(p) !== parentOf(dest)) await apiPost(ctx, "/api/move", { id: (info as any).f.id, dir: parentOf(dest) });
          if (baseName(p) !== baseName(dest)) await apiPost(ctx, "/api/rename", { id: (info as any).f.id, newName: baseName(dest) });
        } else if (info?.kind === "folder") {
          await apiPost(ctx, "/api/folder/rename", { dir: p, newName: baseName(dest) });
        }
        res.writeHead(201).end();
        return;
      }

      if (m === "LOCK") {
        const token = "opaquelocktoken:" + crypto.randomBytes(8).toString("hex");
        res.writeHead(200, { "Content-Type": "application/xml", "Lock-Token": `<${token}>` })
          .end(`<?xml version="1.0"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
        return;
      }
      if (m === "UNLOCK") { res.writeHead(204).end(); return; }
      if (m === "PROPPATCH") { res.writeHead(207, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"></D:multistatus>`); return; }
      res.writeHead(405).end();
    } catch (e: any) { try { res.writeHead(502).end(String(e?.message || e)); } catch {} }
  });
  server.listen(port, () => console.log(`WebDAV NAS bridge: http://localhost:${port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebdavBridge(Number(process.env.DAV_PORT) || 4000, process.env.DAV_BASE || "http://localhost:3000", process.env.DAV_COOKIE || "");
}
