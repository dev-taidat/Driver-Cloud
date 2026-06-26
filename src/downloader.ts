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
