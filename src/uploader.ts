import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { driveFor, getAllQuotas, loadAccounts } from "./accounts.js";
import { planBlocks, human } from "./allocator.js";
import { upsertFile, findFile, joinPath } from "./metadata.js";
import { encryptBlock } from "./crypto.js";
import { runPool } from "./pool.js";
import { Mutex } from "./mutex.js";
import { BLOCK_SIZE, CONCURRENCY, DATA_DIR } from "./config.js";
import type { Account, BlockRef, LogicalFile } from "./types.js";

// Doc 1 lat [start, start+size) cua file vao buffer
function readSlice(filePath: string, start: number, size: number): Promise<Buffer> {
  if (size === 0) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = fs.createReadStream(filePath, { start, end: start + size - 1 });
    s.on("data", (c) => chunks.push(c as Buffer));
    s.on("end", () => resolve(Buffer.concat(chunks)));
    s.on("error", reject);
  });
}

// Upload 1 buffer (da ma hoa) len 1 account, tra ve driveFileId
async function uploadBuffer(
  acc: Account,
  name: string,
  data: Buffer,
  signal: AbortSignal | undefined,
  dataDir: string
): Promise<string> {
  const drive = driveFor(acc, dataDir);
  const res = await drive.files.create(
    {
      requestBody: { name, appProperties: { app: "driver-cloud" } },
      media: { body: Readable.from(data) },
      fields: "id",
    },
    { signal }
  );
  return res.data.id!;
}

export interface UploadOptions {
  dir?: string; // thu muc dich (vd "/" hoac "/Photos")
  dataDir?: string; // thu muc du lieu user (web). Mac dinh DATA_DIR.
  id?: string; // id file logic (de main biet truoc, phuc vu huy/don dep)
  resumeId?: string; // id file logic de upload tiep (resume)
  onProgress?: (uploaded: number, total: number) => void;
  signal?: AbortSignal;
}

export async function uploadFile(
  filePath: string,
  masterKey: Buffer,
  opts: UploadOptions = {}
): Promise<LogicalFile> {
  const dataDir = opts.dataDir || DATA_DIR;
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const name = path.basename(filePath);

  let logical: LogicalFile;

  if (opts.resumeId) {
    const existing = findFile(opts.resumeId, dataDir);
    if (!existing) throw new Error("Khong tim thay file de resume.");
    logical = existing;
  } else {
    const quotas = await getAllQuotas(dataDir);
    if (quotas.length === 0) throw new Error("Chua ket noi account nao.");
    const plan = planBlocks(size, BLOCK_SIZE, quotas);
    const blocks: BlockRef[] = plan.map((p) => ({
      index: p.index,
      accountId: p.accountId,
      driveFileId: null,
      plainSize: p.size,
      sha256: "",
      iv: "",
      authTag: "",
    }));
    const dir = opts.dir || "/";
    logical = {
      id: opts.id || crypto.randomUUID(),
      name,
      dir,
      path: joinPath(dir, name),
      size,
      blockSize: BLOCK_SIZE,
      blocks,
      complete: false,
      createdAt: new Date().toISOString(),
    };
    upsertFile(logical, dataDir);
  }

  const accById = new Map(loadAccounts(dataDir).map((a) => [a.id, a]));
  const lock = new Mutex();

  // Tinh start offset cho moi block
  const starts: number[] = [];
  let acc = 0;
  for (const b of logical.blocks) {
    starts.push(acc);
    acc += b.plainSize;
  }

  // Da upload xong bao nhieu byte (de tinh progress)
  let uploaded = logical.blocks
    .filter((b) => b.driveFileId)
    .reduce((s, b) => s + b.plainSize, 0);
  opts.onProgress?.(uploaded, size);

  // Chi upload nhung block CHUA co driveFileId (ho tro resume)
  const todo = logical.blocks.filter((b) => !b.driveFileId);

  await runPool(todo, CONCURRENCY, async (block) => {
    if (opts.signal?.aborted) throw new Error("Da huy.");
    const account = accById.get(block.accountId)!;
    const plain = await readSlice(filePath, starts[block.index], block.plainSize);
    const enc = encryptBlock(masterKey, plain);
    const driveName = `${logical.id}.${block.index}.dcblk`;
    const fileId = await uploadBuffer(account, driveName, enc.data, opts.signal, dataDir);

    // Cap nhat block + luu tien do (co khoa)
    block.driveFileId = fileId;
    block.iv = enc.iv;
    block.authTag = enc.authTag;
    block.sha256 = enc.sha256;
    uploaded += block.plainSize;
    opts.onProgress?.(uploaded, size);
    await lock.run(() => upsertFile(logical, dataDir));
  });

  logical.complete = logical.blocks.every((b) => !!b.driveFileId);
  upsertFile(logical, dataDir);
  return logical;
}
