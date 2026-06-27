// ===== WebDAV BRIDGE -> proxy sang API web (Railway/localhost) =====
// Khac webdav.ts (dung engine local), file nay GOI API web bang phien dang nhap (cookie).
// Nho vay o dia mount ra dung du lieu ONLINE cua tai khoan web.
import http from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

type Ctx = { base: string; cookie: string };

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function parentOf(p: string): string { if (p === "/" || !p) return "/"; const t = p.replace(/\/+$/, ""); const i = t.lastIndexOf("/"); return i <= 0 ? "/" : t.slice(0, i); }
function baseName(p: string): string { const t = p.replace(/\/+$/, ""); return t.slice(t.lastIndexOf("/") + 1); }
function hrefFor(p: string, col: boolean): string { const enc = p === "/" ? "/" : p.split("/").map(encodeURIComponent).join("/"); return col && p !== "/" ? enc + "/" : enc; }

const pathToId = new Map<string, string>();

async function apiGet(ctx: Ctx, p: string) { return fetch(ctx.base + p, { headers: { Cookie: ctx.cookie } }); }
async function apiPost(ctx: Ctx, p: string, body: any) { return fetch(ctx.base + p, { method: "POST", headers: { Cookie: ctx.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

async function listDir(ctx: Ctx, dir: string): Promise<{ folders: string[]; files: any[] } | null> {
  const r = await apiGet(ctx, `/api/list?dir=${encodeURIComponent(dir)}`);
  if (!r.ok) return null;
  const d: any = await r.json();
  (d.files || []).forEach((f: any) => pathToId.set(f.path, f.id));
  return d;
}
// Xac dinh loai cua 1 path: 'folder' | file-object | null
async function resolve(ctx: Ctx, p: string): Promise<{ kind: "folder" } | { kind: "file"; f: any } | null> {
  if (p === "/") return { kind: "folder" };
  const parent = await listDir(ctx, parentOf(p));
  if (!parent) return null;
  if (parent.folders.includes(p)) return { kind: "folder" };
  const f = parent.files.find((x: any) => x.path === p);
  return f ? { kind: "file", f } : null;
}

function propXml(href: string, col: boolean, size: number, name: string): string {
  return `<D:response><D:href>${xmlEsc(href)}</D:href><D:propstat><D:prop>` +
    `<D:displayname>${xmlEsc(name)}</D:displayname>` +
    (col ? "<D:resourcetype><D:collection/></D:resourcetype>" : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength>`) +
    `<D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

function urlToPath(u: string): string {
  let p = decodeURIComponent((u.split("?")[0] || "/")).replace(/\/+$/, "");
  if (!p.startsWith("/")) p = "/" + p;
  return p === "" ? "/" : p;
}

export function startWebdavBridge(port: number, base: string, cookie: string): http.Server {
  const ctx: Ctx = { base: base.replace(/\/+$/, ""), cookie };
  pathToId.clear();
  const server = http.createServer(async (req, res) => {
    const m = req.method || "GET";
    const p = urlToPath(req.url || "/");
    try {
      if (m === "OPTIONS") { res.writeHead(200, { DAV: "1,2", "MS-Author-Via": "DAV", Allow: "OPTIONS,GET,HEAD,PUT,DELETE,PROPFIND,PROPPATCH,MKCOL,MOVE,LOCK,UNLOCK" }).end(); return; }

      if (m === "PROPFIND") {
        const info = await resolve(ctx, p);
        if (!info) { res.writeHead(404).end(); return; }
        let body = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
        if (info.kind === "folder") {
          body += propXml(hrefFor(p, true), true, 0, p === "/" ? "Driver Cloud" : baseName(p));
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
        if (m === "HEAD") { res.writeHead(200, { "Content-Length": String(info.f.size), "Accept-Ranges": "bytes" }).end(); return; }
        const up = await apiGet(ctx, `/api/download/${info.f.id}`);
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(info.f.size) });
        if (up.body) Readable.fromWeb(up.body as any).pipe(res); else res.end();
        return;
      }

      if (m === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          const buf = Buffer.concat(chunks);
          const fd = new FormData();
          fd.append("file", new Blob([buf]), baseName(p));
          const up = await fetch(`${ctx.base}/api/upload?dir=${encodeURIComponent(parentOf(p))}`, { method: "POST", headers: { Cookie: ctx.cookie }, body: fd });
          res.writeHead(up.ok ? 201 : 500).end();
        });
        return;
      }

      if (m === "DELETE") {
        const info = await resolve(ctx, p);
        if (info?.kind === "folder") await apiPost(ctx, "/api/removeFolder", { dir: p });
        else if (info?.kind === "file") await apiPost(ctx, "/api/remove", { id: info.f.id });
        res.writeHead(204).end();
        return;
      }

      if (m === "MKCOL") { await apiPost(ctx, "/api/folder", { dir: parentOf(p), name: baseName(p) }); res.writeHead(201).end(); return; }

      if (m === "MOVE") {
        const destRaw = (req.headers["destination"] as string) || "";
        let dest = destRaw; try { dest = urlToPath(new URL(destRaw).pathname); } catch { dest = urlToPath(destRaw.replace(/^https?:\/\/[^/]+/, "")); }
        const info = await resolve(ctx, p);
        if (info?.kind === "file") {
          if (parentOf(p) !== parentOf(dest)) await apiPost(ctx, "/api/move", { id: info.f.id, dir: parentOf(dest) });
          if (baseName(p) !== baseName(dest)) await apiPost(ctx, "/api/rename", { id: info.f.id, newName: baseName(dest) });
        } else if (info?.kind === "folder") {
          await apiPost(ctx, "/api/folder/rename", { dir: p, newName: baseName(dest) });
        }
        res.writeHead(201).end();
        return;
      }

      if (m === "LOCK") {
        const token = "opaquelocktoken:" + Math.random().toString(16).slice(2);
        res.writeHead(200, { "Content-Type": "application/xml", "Lock-Token": `<${token}>` })
          .end(`<?xml version="1.0"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
        return;
      }
      if (m === "UNLOCK") { res.writeHead(204).end(); return; }
      if (m === "PROPPATCH") { res.writeHead(207, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"></D:multistatus>`); return; }
      res.writeHead(405).end();
    } catch (e: any) { res.writeHead(502).end(String(e?.message || e)); }
  });
  server.listen(port, () => console.log(`WebDAV bridge: http://localhost:${port} -> ${ctx.base}`));
  return server;
}

// Chay standalone de test: DAV_BASE, DAV_COOKIE, DAV_PORT
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebdavBridge(Number(process.env.DAV_PORT) || 4000, process.env.DAV_BASE || "http://localhost:3000", process.env.DAV_COOKIE || "");
}
