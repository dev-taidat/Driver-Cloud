const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Ban WEB chay trong app desktop. CHI expose window.dcDesktop.
// (KHONG expose window.api - se dung ten voi `const api` trong web app.js -> SyntaxError lam chet ca trang.)
contextBridge.exposeInMainWorld("dcDesktop", {
  isDesktop: true,
  // Mo file de SUA: tai ve -> mo editor -> luu la tu dong bo len cloud
  edit: (id, name, dir) => ipcRenderer.invoke("edit:open", { id, name, dir }),
  // Lay duong dan that cua file keo-tha (de upload THANG len Drive)
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  // Upload THANG may<->Drive (nhanh ~10x), bo qua server trung gian
  upload: (localPath, dir, replaceId) => ipcRenderer.invoke("upload:direct", { localPath, dir, replaceId }),
  // Online/offline tung file trong o mount (thay menu Windows)
  makeOffline: (cloudPath) => ipcRenderer.invoke("mount:offline", cloudPath),
  makeOnline: (cloudPath) => ipcRenderer.invoke("mount:online", cloudPath),
});
