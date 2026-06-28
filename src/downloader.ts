import fs from "node:fs";
import { Readable } from "node:stream";
import { driveFor, loadAccounts } from "./accounts.js";
import { findFile } from "./metadata.js";
import { decryptBlock } from "./crypto.js";
import { runPool, withRetry } from "./pool.js";
import { CONCURRENCY, DATA_DIR } from "./config.js";
import type { Account, BlockRef } from "./types.js";

// Tai 1 block (da ma hoa) ve buffer
async function fetchBlock(acc: Account, block: BlockRef, dataDir: string): Promise<Buffer> {
  const drive = driveFor(acc, dataDir);
  // Thu lai ca thao tac lay stream + doc het (rot giua chung -> tai lai block)
  return withRetry(async () => {
    const res = await drive.files.get(
      { fileId: block.driveFileId!, alt: "media" },
      { responseType: "stream" }
    );
    const stream = res.data as unknown as Readable;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return Buffer.concat(chunks);
  });
}

export interface DownloadOptions {
  dataDir?: string; // thu muc du lieu user (web). Mac dinh DATA_DIR.
  onProgress?: (downloaded: number, total: number) => void;
  signal?: AbortSignal;
}

// Tai 1 DAI byte [start, start+length) cua file (chi tai cac block phu de -> stream video/mo nhanh,
// khong phai tai het file). Dung cho mount kieu NAS (WebDAV) phuc vu Range request.
export async function downloadRange(
  idOrPath: string,
  start: number,
  length: number,
  masterKey: Buffer,
  opts: DownloadOptions = {}
): Promise<Buffer> {
  const dataDir = opts.dataDir || DATA_DIR;
  const logical = findFile(idOrPath, dataDir);
  if (!logical) throw new Error(`Khong tim thay file: ${idOrPath}`);
  if (!logical.complete) throw new Error("File chua upload xong.");
  const accById = new Map(loadAccounts(dataDir).map((a) => [a.id, a]));
  const sorted = [...logical.blocks].sort((a, b) => a.index - b.index);
  const offsets: number[] = []; let acc = 0;
  for (const b of sorted) { offsets.push(acc); acc += b.plainSize; }
  const end = Math.min(start + length, logical.size); // exclusive
  const out = Buffer.alloc(Math.max(0, end - start));
  if (out.length === 0) return out;
  // Chi cac block giao voi [start, end)
  const tasks = sorted
    .map((block, i) => ({ block, bs: offsets[i], be: offsets[i] + block.plainSize }))
    .filter((t) => t.be > start && t.bs < end);
  await runPool(tasks, CONCURRENCY, async (t) => {
    const account = accById.get(t.block.accountId);
    if (!account) throw new Error(`Thieu account ${t.block.accountId}`);
    const enc = await fetchBlock(account, t.block, dataDir);
    const plain = decryptBlock(masterKey, enc, t.block.iv, t.block.authTag, t.block.sha256);
    const from = Math.max(t.bs, start), to = Math.min(t.be, end);
    plain.copy(out, from - start, from - t.bs, to - t.bs);
  });
  return out;
}

export async function downloadFile(
  idOrPath: string,
  destPath: string,
  masterKey: Buffer,
  opts: DownloadOptions = {}
): Promise<void> {
  const dataDir = opts.dataDir || DATA_DIR;
  const logical = findFile(idOrPath, dataDir);
  if (!logical) throw new Error(`Khong tim thay file: ${idOrPath}`);
  if (!logical.complete) throw new Error("File chua upload xong, khong the tai.");

  const accById = new Map(loadAccounts(dataDir).map((a) => [a.id, a]));
  const sorted = [...logical.blocks].sort((a, b) => a.index - b.index);

  // Offset byte cua tung block trong file goc
  const offsets: number[] = [];
  let acc = 0;
  for (const b of sorted) {
    offsets.push(acc);
    acc += b.plainSize;
  }

  const fd = fs.openSync(destPath, "w");
  try {
    fs.ftruncateSync(fd, logical.size);
    let downloaded = 0;

    // Tai SONG SONG (gioi han CONCURRENCY) tu nhieu account -> nhanh
    await runPool(sorted, CONCURRENCY, async (block, i) => {
      if (opts.signal?.aborted) throw new Error("Da huy.");
      const account = accById.get(block.accountId);
      if (!account) throw new Error(`Thieu account ${block.accountId} cho block ${block.index}`);
      const encData = await fetchBlock(account, block, dataDir);
      // Giai ma + kiem tra checksum
      const plain = decryptBlock(masterKey, encData, block.iv, block.authTag, block.sha256);
      fs.writeSync(fd, plain, 0, plain.length, offsets[i]);
      downloaded += plain.length;
      opts.onProgress?.(downloaded, logical.size);
    });
  } finally {
    fs.closeSync(fd);
  }
}
