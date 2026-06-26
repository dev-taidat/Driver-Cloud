import { drive, drive_v3 } from "@googleapis/drive";
import { DATA_DIR, FREE_SPACE_MARGIN, dataPaths, readJSON, writeJSON } from "./config.js";
import { makeOAuth2Client } from "./auth.js";
import type { Account, AccountQuota } from "./types.js";

// `dir` = thu muc du lieu cua user (web). Mac dinh DATA_DIR (desktop).
export function loadAccounts(dir: string = DATA_DIR): Account[] {
  return readJSON<Account[]>(dataPaths(dir).accounts, []);
}

export function saveAccounts(accounts: Account[], dir: string = DATA_DIR): void {
  writeJSON(dataPaths(dir).accounts, accounts);
}

export function addAccount(acc: Account, dir: string = DATA_DIR): void {
  const accounts = loadAccounts(dir).filter((a) => a.id !== acc.id);
  accounts.push(acc);
  saveAccounts(accounts, dir);
}

export function removeAccount(id: string, dir: string = DATA_DIR): void {
  saveAccounts(loadAccounts(dir).filter((a) => a.id !== id), dir);
}

// Tao Drive client (da xac thuc) cho 1 account tu refresh_token
export function driveFor(acc: Account, dir: string = DATA_DIR): drive_v3.Drive {
  const oauth2 = makeOAuth2Client(dir);
  oauth2.setCredentials({ refresh_token: acc.refreshToken });
  return drive({ version: "v3", auth: oauth2 });
}

// Lay quota (con trong bao nhieu) cua 1 account
export async function getQuota(acc: Account, dir: string = DATA_DIR): Promise<AccountQuota> {
  const d = driveFor(acc, dir);
  const res = await d.about.get({ fields: "storageQuota" });
  const q = res.data.storageQuota!;
  const total = Number(q.limit ?? 0); // 0 = khong gioi han (hiem)
  const used = Number(q.usage ?? 0);
  const rawFree = total > 0 ? total - used : Number.MAX_SAFE_INTEGER;
  const free = Math.max(0, rawFree - FREE_SPACE_MARGIN);
  return { account: acc, totalBytes: total, usedBytes: used, freeBytes: free };
}

// Lay quota cua tat ca account (song song)
export async function getAllQuotas(dir: string = DATA_DIR): Promise<AccountQuota[]> {
  const accounts = loadAccounts(dir);
  return Promise.all(accounts.map((a) => getQuota(a, dir)));
}
