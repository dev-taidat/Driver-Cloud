import { drive, drive_v3 } from "@googleapis/drive";
import { ACCOUNTS_PATH, FREE_SPACE_MARGIN, readJSON, writeJSON } from "./config.js";
import { makeOAuth2Client } from "./auth.js";
import type { Account, AccountQuota } from "./types.js";

export function loadAccounts(): Account[] {
  return readJSON<Account[]>(ACCOUNTS_PATH, []);
}

export function saveAccounts(accounts: Account[]): void {
  writeJSON(ACCOUNTS_PATH, accounts);
}

export function addAccount(acc: Account): void {
  const accounts = loadAccounts().filter((a) => a.id !== acc.id);
  accounts.push(acc);
  saveAccounts(accounts);
}

export function removeAccount(id: string): void {
  saveAccounts(loadAccounts().filter((a) => a.id !== id));
}

// Tao Drive client (da xac thuc) cho 1 account tu refresh_token
export function driveFor(acc: Account): drive_v3.Drive {
  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({ refresh_token: acc.refreshToken });
  return drive({ version: "v3", auth: oauth2 });
}

// Lay quota (con trong bao nhieu) cua 1 account
export async function getQuota(acc: Account): Promise<AccountQuota> {
  const drive = driveFor(acc);
  const res = await drive.about.get({ fields: "storageQuota" });
  const q = res.data.storageQuota!;
  const total = Number(q.limit ?? 0); // 0 = khong gioi han (hiem)
  const used = Number(q.usage ?? 0);
  const rawFree = total > 0 ? total - used : Number.MAX_SAFE_INTEGER;
  const free = Math.max(0, rawFree - FREE_SPACE_MARGIN);
  return { account: acc, totalBytes: total, usedBytes: used, freeBytes: free };
}

// Lay quota cua tat ca account (song song)
export async function getAllQuotas(): Promise<AccountQuota[]> {
  const accounts = loadAccounts();
  return Promise.all(accounts.map(getQuota));
}
