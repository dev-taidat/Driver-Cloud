import type { AccountQuota, BlockPlan } from "./types.js";

/**
 * Dat TRON 1 file vao MOT account duy nhat (KHONG chia file ra nhieu account).
 *
 * Chien luoc theo dung yeu cau nguoi dung:
 *  - Chon account theo "best-fit": account co cho trong NHO NHAT ma van du chua
 *    ca file -> don file cho gon, giu lai cac khoang trong lon cho file lon sau,
 *    va tan dung cho thua o account gan day (do phi).
 *    Vd: acc1 con 100GB, cac acc khac 30TB. File 50GB -> vao acc1 (best-fit).
 *        File 105GB -> acc1 khong du -> vao 1 acc 30TB. acc1 van giu 100GB.
 *  - Neu KHONG account nao du chua ca file -> bao loi (khong chia nho).
 *
 * Ben trong file van duoc cat thanh block (de ma hoa + resume) NHUNG TAT CA
 * block deu nam tren CUNG 1 account.
 */
export function planBlocks(
  fileSize: number,
  blockSize: number,
  quotas: AccountQuota[]
): BlockPlan[] {
  const usable = quotas.filter((q) => q.freeBytes > 0);

  // best-fit: account co cho trong nho nhat ma van du chua ca file
  const fits = usable
    .filter((q) => q.freeBytes >= fileSize)
    .sort((a, b) => a.freeBytes - b.freeBytes);

  if (fits.length === 0) {
    const maxFree = usable.reduce((m, q) => Math.max(m, q.freeBytes), 0);
    throw new Error(
      `Khong co tai khoan nao du cho ca file (${human(fileSize)}). ` +
        `Tai khoan trong nhat chi con ${human(maxFree)}. Hay them tai khoan hoac giai phong dung luong.`
    );
  }

  const accountId = fits[0].account.id;

  // Cat file thanh block, tat ca tren cung 1 account
  const plan: BlockPlan[] = [];
  let off = 0;
  let idx = 0;
  while (off < fileSize) {
    const size = Math.min(blockSize, fileSize - off);
    plan.push({ index: idx, accountId, start: off, size });
    off += size;
    idx++;
  }
  if (plan.length === 0) {
    // File rong
    plan.push({ index: 0, accountId, start: 0, size: 0 });
  }
  return plan;
}

export function human(bytes: number): string {
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 0)} ${u[i]}`;
}
