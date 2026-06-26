#!/usr/bin/env node
import { runOAuthFlow } from "./auth.js";
import { addAccount, getAllQuotas, loadAccounts, driveFor, removeAccount } from "./accounts.js";
import { uploadFile } from "./uploader.js";
import { downloadFile } from "./downloader.js";
import { listFiles, findFile, removeFile } from "./metadata.js";
import { human } from "./allocator.js";
import { keyfileExists, initMasterKey, unlockMasterKey } from "./crypto.js";

function bar(done: number, total: number): string {
  const pct = total > 0 ? done / total : 1;
  const n = Math.round(pct * 20);
  return `[${"#".repeat(n)}${"-".repeat(20 - n)}] ${(pct * 100).toFixed(1)}%`;
}

// Lay master key tu mat khau trong bien moi truong DCLOUD_PASSWORD
function getKey(): Buffer {
  const pw = process.env.DCLOUD_PASSWORD;
  if (!pw) throw new Error("Hay dat bien moi truong DCLOUD_PASSWORD (mat khau ma hoa).");
  if (!keyfileExists()) return initMasterKey(pw);
  return unlockMasterKey(pw);
}

function progress(label: string) {
  let last = 0;
  return (d: number, t: number) => {
    const now = Date.now();
    if (now - last > 200 || d >= t) {
      last = now;
      process.stdout.write(`\r${label} ${bar(d, t)} ${human(d)}/${human(t)}   `);
    }
  };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "connect": {
      const { email, refreshToken } = await runOAuthFlow();
      addAccount({ id: email, email, refreshToken, addedAt: new Date().toISOString() });
      console.log(`Da ket noi account: ${email}`);
      break;
    }

    case "accounts": {
      const quotas = await getAllQuotas();
      if (quotas.length === 0) return console.log("Chua co account. Chay: connect");
      let tf = 0, ta = 0;
      for (const q of quotas) {
        console.log(`${q.account.email.padEnd(30)} con ${human(q.freeBytes).padStart(10)} / ${human(q.totalBytes)}`);
        tf += q.freeBytes; ta += q.totalBytes;
      }
      console.log("-".repeat(60));
      console.log(`TONG: con trong ${human(tf)} / ${human(ta)} (${quotas.length} account)`);
      break;
    }

    case "disconnect":
      if (!args[0]) return console.log("Dung: disconnect <email>");
      removeAccount(args[0]);
      console.log(`Da go account ${args[0]}.`);
      break;

    case "upload": {
      if (!args[0]) return console.log("Dung: upload <file>");
      const f = await uploadFile(args[0], getKey(), { onProgress: progress("Upload") });
      console.log(`\nXong! ${f.path} (id=${f.id}, ${f.blocks.length} block, complete=${f.complete})`);
      break;
    }

    case "ls": {
      const files = listFiles();
      if (files.length === 0) return console.log("Chua co file.");
      for (const f of files)
        console.log(`${f.path.padEnd(36)} ${human(f.size).padStart(10)}  ${f.blocks.length} block  ${f.complete ? "" : "[CHUA XONG] "}id=${f.id}`);
      break;
    }

    case "download": {
      if (!args[0] || !args[1]) return console.log("Dung: download <id|path> <dich>");
      await downloadFile(args[0], args[1], getKey(), { onProgress: progress("Download") });
      console.log(`\nDa tai ve: ${args[1]}`);
      break;
    }

    case "rm": {
      if (!args[0]) return console.log("Dung: rm <id|path>");
      const f = findFile(args[0]);
      if (!f) return console.log("Khong tim thay file.");
      const accById = new Map(loadAccounts().map((a) => [a.id, a]));
      for (const b of f.blocks) {
        if (!b.driveFileId) continue;
        const acc = accById.get(b.accountId);
        if (acc) {
          try { await driveFor(acc).files.delete({ fileId: b.driveFileId }); }
          catch { console.log(`Canh bao: khong xoa duoc block ${b.index}`); }
        }
      }
      removeFile(f.id);
      console.log(`Da xoa ${f.path} va ${f.blocks.length} block.`);
      break;
    }

    default:
      console.log(
        `Driver Cloud CLI\n\n` +
          `  connect              Ket noi 1 tai khoan Google\n` +
          `  accounts             Xem account + dung luong\n` +
          `  disconnect <email>   Go account\n` +
          `  upload <file>        Tai len (chia + ma hoa qua nhieu acc)\n` +
          `  ls                   Liet ke file\n` +
          `  download <id> <dich> Tai ve + giai ma + ghep\n` +
          `  rm <id>              Xoa file\n\n` +
          `Can: DCLOUD_PASSWORD=<mat khau ma hoa>`
      );
  }
}

main().catch((e) => {
  console.error("\nLoi:", e.message || e);
  process.exit(1);
});
